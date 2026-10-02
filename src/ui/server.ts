import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { runLoomdoc } from "../core/pipeline.js";
import { STYLE_PRESET_IDS, STYLE_PRESETS } from "../core/generate/styles.js";
import {
  DEFAULT_EFFORT,
  DEFAULT_FORMATS,
  DEFAULT_MODEL,
  type LoomdocOptions,
  type LoomdocResult,
  type ProgressStage,
} from "../core/types.js";
import { APP_CSS, APP_JS, FAVICON_SVG, pageHtml, unauthorizedHtml } from "./page.js";
import { revealInFileManager } from "./open.js";

/**
 * The local UI server behind `loomdoc ui` (PRD decision D17).
 *
 * It spends the user's API credits and reads local files, so it is locked down even though it
 * only listens on loopback:
 *   - Binds to 127.0.0.1 only, and rejects any Host header other than 127.0.0.1/localhost on
 *     its own port (blocks DNS-rebinding attacks from web pages).
 *   - The launch URL carries a random, single-use launch token. The first visit trades it for a
 *     separate random session id in an HttpOnly, SameSite=Strict cookie and redirects to a clean
 *     URL; the launch token is then dead, so a copy of the URL (browser argv visible to other
 *     local users, shell history) is useless.
 *   - State-changing requests also need a third random value, the request token, in an
 *     X-Loomdoc-Token header. It is only ever delivered inside the page, so other web pages
 *     can't read it, and they can't send that header cross-origin without a CORS preflight,
 *     which this server never approves.
 *   - A strict Content-Security-Policy on the page; all script and style are served from the
 *     server itself.
 * Residual risk (PRD D17): browsers don't scope cookies by port, so another web server on
 * 127.0.0.1 that the user browses to while loomdoc ui runs receives the session cookie.
 * One run at a time: runs are CPU-heavy and each one costs money.
 */

export interface UiServerOptions {
  /** Output root for documents. Default "./out". */
  outDir?: string;
  /** Port to listen on; 0 picks a free one. */
  port?: number;
  /** Returns blocking setup problems for a URL (empty = ready). Checks only; never installs. */
  checkRequirements?: (url: string) => Promise<string[]>;
  /** Setup warnings to show in the page (e.g. YouTube tools missing). */
  setupNotices?: () => Promise<string[]>;
  /** Injected for tests; defaults to the real pipeline. */
  run?: (options: LoomdocOptions) => Promise<LoomdocResult>;
}

export interface UiServer {
  /** The launch URL, including the single-use launch token. */
  url: string;
  port: number;
  close(): Promise<void>;
}

const runRequestSchema = z.object({
  url: z.string().trim().min(1).max(2048),
  preset: z.enum(STYLE_PRESET_IDS),
  guidance: z.string().max(4000).optional(),
  audience: z.string().max(300).optional(),
  role: z.string().max(300).optional(),
  industry: z.string().max(300).optional(),
  useCase: z.string().max(300).optional(),
  formats: z.array(z.enum(["markdown", "docx", "pdf"])).min(1),
  model: z.string().trim().max(100).optional(),
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
});

export type RunRequest = z.infer<typeof runRequestSchema>;

type RunEvent =
  | { type: "progress"; stage: ProgressStage; message: string; at: number }
  | { type: "done"; result: RunResultView; at: number }
  | { type: "error"; message: string; at: number };

interface RunResultView {
  title: string;
  overview: string;
  audience?: string;
  outputDir: string;
  files: Array<{ name: string; href: string }>;
  steps: Array<{
    heading: string;
    body: string;
    needsDeeperReasoning?: boolean;
    screenshot?: { href: string; caption?: string };
  }>;
}

interface RunRecord {
  id: string;
  status: "running" | "done" | "error";
  events: RunEvent[];
  listeners: Set<(event: RunEvent) => void>;
  outputDir?: string;
}

const MAX_BODY_BYTES = 64 * 1024;

export async function startUiServer(options: UiServerOptions = {}): Promise<UiServer> {
  let launchToken: string | null = randomBytes(32).toString("hex");
  const launchUrlToken = launchToken;
  const sessionId = randomBytes(32).toString("hex");
  const requestToken = randomBytes(32).toString("hex");
  const runner = options.run ?? runLoomdoc;
  const runs = new Map<string, RunRecord>();
  let activeRunId: string | null = null;
  // The single run slot. Claimed synchronously, before any await, so concurrent requests can't
  // all pass the check while the first one is still verifying requirements.
  let slotTaken = false;
  let port = 0;

  const cookieName = (): string => `loomdoc_${port}`;

  const server: Server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      if (!res.headersSent) sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      else res.end();
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    setSecurityHeaders(res);
    const host = req.headers.host ?? "";
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
      sendText(res, 403, "Forbidden host.");
      return;
    }
    const url = new URL(req.url ?? "/", `http://${host}`);
    const method = req.method ?? "GET";

    const hasSession = safeEqual(readCookie(req, cookieName()) ?? "", sessionId);

    // Launch URL: trade the single-use launch token for the session cookie, then drop it from
    // the address bar. Revisiting the link from an already signed-in browser just continues.
    if (method === "GET" && url.pathname === "/" && url.searchParams.has("token")) {
      const valid = launchToken !== null && safeEqual(url.searchParams.get("token") ?? "", launchToken);
      if (!valid && !hasSession) {
        sendHtml(res, 401, unauthorizedHtml(launchToken === null ? "used" : "invalid"));
        return;
      }
      launchToken = null;
      res.writeHead(303, {
        "Set-Cookie": `${cookieName()}=${sessionId}; HttpOnly; SameSite=Strict; Path=/`,
        Location: "/",
      });
      res.end();
      return;
    }

    // Static, non-sensitive assets also style the "open the link from your terminal" page.
    if (method === "GET" && url.pathname === "/favicon.svg") return sendText(res, 200, FAVICON_SVG, "image/svg+xml");
    if (method === "GET" && url.pathname === "/app.css") return sendText(res, 200, APP_CSS, "text/css; charset=utf-8");

    if (!hasSession) {
      if (method === "GET" && url.pathname === "/") sendHtml(res, 401, unauthorizedHtml("missing"));
      else sendJson(res, 401, { error: "Not authorized. Open the link printed in your terminal." });
      return;
    }

    if (method === "POST") {
      const origin = req.headers.origin;
      if (origin !== undefined && origin !== `http://${host}`) {
        sendJson(res, 403, { error: "Cross-origin request refused." });
        return;
      }
      if (!safeEqual(String(req.headers["x-loomdoc-token"] ?? ""), requestToken)) {
        sendJson(res, 403, { error: "Missing or invalid request token." });
        return;
      }
    }

    // --- routes ------------------------------------------------------------------------
    if (method === "GET" && url.pathname === "/") return sendHtml(res, 200, pageHtml(requestToken));
    if (method === "GET" && url.pathname === "/app.js") return sendText(res, 200, APP_JS, "text/javascript; charset=utf-8");
    if (method === "GET" && url.pathname === "/api/config") {
      sendJson(res, 200, {
        presets: STYLE_PRESET_IDS.map((id) => {
          const p = STYLE_PRESETS[id];
          return { id: p.id, label: p.label, summary: p.summary };
        }),
        defaults: { formats: DEFAULT_FORMATS, model: DEFAULT_MODEL, effort: DEFAULT_EFFORT },
        notices: options.setupNotices ? await options.setupNotices() : [],
        activeRunId,
      });
      return;
    }

    if (method === "POST" && url.pathname === "/api/runs") {
      if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) {
        sendJson(res, 415, { error: "Expected JSON." });
        return;
      }
      const parsed = runRequestSchema.safeParse(await readJson(req));
      if (!parsed.success) {
        sendJson(res, 400, { error: `Invalid request: ${parsed.error.issues[0]?.message ?? "unknown"}` });
        return;
      }
      const body = parsed.data;
      if (body.preset === "custom" && !body.guidance?.trim()) {
        sendJson(res, 400, { error: "The Custom style needs guidance describing the document you want." });
        return;
      }
      if (slotTaken) {
        sendJson(res, 409, { error: "A document is already being generated. Wait for it to finish." });
        return;
      }
      slotTaken = true;
      let problems: string[];
      try {
        problems = options.checkRequirements ? await options.checkRequirements(body.url) : [];
      } catch (err) {
        problems = [err instanceof Error ? err.message : String(err)];
      }
      if (problems.length > 0) {
        slotTaken = false;
        sendJson(res, 412, { error: problems.join("\n") });
        return;
      }

      const record: RunRecord = { id: randomUUID(), status: "running", events: [], listeners: new Set() };
      runs.set(record.id, record);
      activeRunId = record.id;
      void execute(record, body); // releases the slot when the run ends
      sendJson(res, 202, { id: record.id });
      return;
    }

    const eventsMatch = /^\/api\/runs\/([0-9a-f-]{36})\/events$/.exec(url.pathname);
    if (method === "GET" && eventsMatch) {
      const record = runs.get(eventsMatch[1]!);
      if (!record) return sendJson(res, 404, { error: "Unknown run." });
      streamEvents(req, res, record);
      return;
    }

    const revealMatch = /^\/api\/runs\/([0-9a-f-]{36})\/reveal$/.exec(url.pathname);
    if (method === "POST" && revealMatch) {
      const record = runs.get(revealMatch[1]!);
      if (!record?.outputDir) return sendJson(res, 404, { error: "No output folder for this run." });
      revealInFileManager(record.outputDir);
      sendJson(res, 200, { ok: true });
      return;
    }

    const fileMatch = /^\/files\/([0-9a-f-]{36})\/(.+)$/.exec(url.pathname);
    if (method === "GET" && fileMatch) {
      const record = runs.get(fileMatch[1]!);
      if (!record?.outputDir) return sendJson(res, 404, { error: "Unknown run." });
      await serveOutputFile(res, record.outputDir, fileMatch[2]!);
      return;
    }

    sendJson(res, 404, { error: "Not found." });
  }

  async function execute(record: RunRecord, body: RunRequest): Promise<void> {
    const emit = (event: RunEvent): void => {
      record.events.push(event);
      for (const listener of record.listeners) listener(event);
    };
    try {
      const result = await runner({
        url: body.url,
        outDir: options.outDir,
        formats: body.formats,
        model: body.model || undefined,
        effort: body.effort,
        context: {
          preset: body.preset,
          guidance: body.guidance?.trim() || undefined,
          audience: body.audience?.trim() || undefined,
          role: body.role?.trim() || undefined,
          industry: body.industry?.trim() || undefined,
          useCase: body.useCase?.trim() || undefined,
        },
        onProgress: (e) => emit({ type: "progress", stage: e.stage, message: e.message, at: Date.now() }),
      });
      record.outputDir = result.outputDir;
      record.status = "done";
      emit({ type: "done", result: toView(record.id, result), at: Date.now() });
    } catch (err) {
      record.status = "error";
      emit({ type: "error", message: err instanceof Error ? err.message : String(err), at: Date.now() });
    } finally {
      activeRunId = null;
      slotTaken = false;
    }
  }

  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", () => resolveListen());
  });
  port = (server.address() as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${port}/?token=${launchUrlToken}`,
    port,
    close: () =>
      new Promise<void>((resolveClose) => {
        server.closeAllConnections();
        server.close(() => resolveClose());
      }),
  };
}

// --- helpers ---------------------------------------------------------------------------

function toView(runId: string, result: LoomdocResult): RunResultView {
  const href = (absPath: string): string =>
    `/files/${runId}/${relative(result.outputDir, absPath).split(sep).map(encodeURIComponent).join("/")}`;
  return {
    title: result.doc.title,
    overview: result.doc.overview,
    audience: result.doc.audience,
    outputDir: result.outputDir,
    files: result.files.map((f) => ({ name: relative(result.outputDir, f), href: href(f) })),
    steps: result.doc.steps.map((s) => ({
      heading: s.heading,
      body: s.body,
      needsDeeperReasoning: s.needsDeeperReasoning,
      screenshot: s.screenshot ? { href: href(s.screenshot.path), caption: s.screenshot.caption } : undefined,
    })),
  };
}

function streamEvents(req: IncomingMessage, res: ServerResponse, record: RunRecord): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
  });
  const write = (event: RunEvent): void => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    if (event.type !== "progress") res.end();
  };
  // Replay history so a reload or late connection sees the whole run.
  for (const event of record.events) write(event);
  if (record.status !== "running") return;

  record.listeners.add(write);
  const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), 15_000);
  const cleanup = (): void => {
    clearInterval(heartbeat);
    record.listeners.delete(write);
  };
  req.on("close", cleanup);
  res.on("finish", cleanup);
}

const CONTENT_TYPES: Record<string, string> = {
  ".md": "text/markdown; charset=utf-8",
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

/** Serve a file from inside `outputDir` only; anything that resolves outside it is refused. */
export async function serveOutputFile(res: ServerResponse, outputDir: string, encodedPath: string): Promise<void> {
  let relPath: string;
  try {
    relPath = decodeURIComponent(encodedPath);
  } catch {
    return sendJson(res, 400, { error: "Bad path." });
  }
  const root = resolve(outputDir);
  const target = resolve(root, relPath);
  const rel = relative(root, target);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel) || relPath.includes("\0")) {
    return sendJson(res, 403, { error: "Refused." });
  }
  const type = CONTENT_TYPES[extname(target).toLowerCase()];
  if (!type) return sendJson(res, 403, { error: "Refused." });

  let size: number;
  try {
    const info = await stat(target);
    if (!info.isFile()) return sendJson(res, 404, { error: "Not found." });
    size = info.size;
  } catch {
    return sendJson(res, 404, { error: "Not found." });
  }
  const headers: Record<string, string | number> = { "Content-Type": type, "Content-Length": size };
  if (extname(target).toLowerCase() === ".docx") {
    headers["Content-Disposition"] = `attachment; filename="${encodeURIComponent(rel.split(sep).pop()!)}"`;
  }
  res.writeHead(200, headers);
  // pipeline() destroys both streams on error; an unhandled stream error would crash the server.
  pipeline(createReadStream(target), res, () => {});
}

function setSecurityHeaders(res: ServerResponse): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
}

/**
 * CSP for the app's own HTML pages only. Output files (images, Markdown, PDF) never carry it:
 * a policy on a PDF response blocks the browser's built-in PDF viewer, and none of those types
 * can run script.
 */
const PAGE_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; " +
  "form-action 'none'; base-uri 'none'; frame-ancestors 'none'";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function readCookie(req: IncomingMessage, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return undefined;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += (chunk as Buffer).length;
    if (total > MAX_BODY_BYTES) throw new Error("Request body too large.");
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  sendText(res, status, JSON.stringify(body), "application/json; charset=utf-8");
}

function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.setHeader("Content-Security-Policy", PAGE_CSP);
  sendText(res, status, html, "text/html; charset=utf-8");
}

function sendText(res: ServerResponse, status: number, text: string, type = "text/plain; charset=utf-8"): void {
  res.writeHead(status, { "Content-Type": type, "Content-Length": Buffer.byteLength(text) });
  res.end(text);
}
