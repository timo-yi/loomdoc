import { test } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startUiServer, type UiServer } from "../src/ui/server.js";
import type { LoomdocOptions, LoomdocResult } from "../src/core/types.js";

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/** Raw HTTP so tests can set Host/Origin headers freely. */
function send(port: number, path: string, opts: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port, path, method: opts.method ?? "GET", headers: { host: `127.0.0.1:${port}`, ...opts.headers } },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function setup(
  run?: (o: LoomdocOptions) => Promise<LoomdocResult>,
  problems: string[] = [],
  checkDelayMs = 0,
) {
  const dir = await mkdtemp(join(tmpdir(), "loomdoc-ui-test-"));
  const outputDir = join(dir, "my-doc");
  await mkdir(join(outputDir, "images"), { recursive: true });
  await writeFile(join(outputDir, "document.md"), "# Doc\n");
  await writeFile(join(outputDir, "images", "step 01.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  await writeFile(join(dir, "secret.md"), "outside");

  const calls: LoomdocOptions[] = [];
  const fakeRun =
    run ??
    (async (o: LoomdocOptions): Promise<LoomdocResult> => {
      calls.push(o);
      o.onProgress?.({ stage: "ingest", message: "Downloading" });
      o.onProgress?.({ stage: "render", message: "Rendering" });
      return {
        outputDir,
        imagesDir: join(outputDir, "images"),
        files: [join(outputDir, "document.md")],
        doc: {
          title: "Doc",
          overview: "Overview",
          steps: [{ heading: "One", body: "Do it", screenshot: { path: join(outputDir, "images", "step 01.png"), caption: "c" } }],
        },
      };
    });

  const server = await startUiServer({
    run: fakeRun,
    checkRequirements: async () => {
      if (checkDelayMs) await new Promise((r) => setTimeout(r, checkDelayMs));
      return problems;
    },
  });
  const launchToken = new URL(server.url).searchParams.get("token")!;
  const boot = await send(server.port, `/?token=${launchToken}`);
  const cookie = String(boot.headers["set-cookie"]).split(";")[0]!;
  // The request token for POSTs is delivered only inside the page.
  const page = await send(server.port, "/", { headers: { cookie } });
  const token = /name="loomdoc-token" content="([0-9a-f]+)"/.exec(page.body)![1]!;
  return { dir, server, launchToken, token, cookie, boot, outputDir, calls };
}

const runBody = JSON.stringify({ url: "https://www.loom.com/share/abc", preset: "sales-walkthrough", guidance: "Focus on reporting", formats: ["markdown"] });

function postRun(s: { server: UiServer; token: string; cookie: string }, body = runBody, extra: Record<string, string> = {}) {
  return send(s.server.port, "/api/runs", {
    method: "POST",
    headers: { cookie: s.cookie, "content-type": "application/json", "x-loomdoc-token": s.token, ...extra },
    body,
  });
}

async function waitForEvents(s: { server: UiServer; cookie: string }, id: string): Promise<Array<{ type: string }>> {
  const res = await send(s.server.port, `/api/runs/${id}/events`, { headers: { cookie: s.cookie } });
  return res.body
    .split("\n\n")
    .filter((b) => b.startsWith("data: "))
    .map((b) => JSON.parse(b.slice(6)));
}

test("launch link trades the token for a strict cookie and redirects", async () => {
  const s = await setup();
  try {
    assert.equal(s.boot.status, 303);
    assert.equal(s.boot.headers.location, "/");
    assert.match(String(s.boot.headers["set-cookie"]), /HttpOnly; SameSite=Strict; Path=\//);
    const page = await send(s.server.port, "/", { headers: { cookie: s.cookie } });
    assert.equal(page.status, 200);
    assert.match(String(page.headers["content-security-policy"]), /script-src 'self'/);
    // Three separate secrets: the launch token, the session cookie, and the request token.
    const cookieValue = s.cookie.split("=")[1]!;
    assert.notEqual(cookieValue, s.launchToken);
    assert.notEqual(s.token, s.launchToken);
    assert.notEqual(s.token, cookieValue);
    assert.doesNotMatch(page.body, new RegExp(s.launchToken));
  } finally {
    await s.server.close();
    await rm(s.dir, { recursive: true, force: true });
  }
});

test("rejects requests without the token, with a wrong token, or with a foreign Host", async () => {
  const s = await setup();
  try {
    assert.equal((await send(s.server.port, "/")).status, 401);
    assert.equal((await send(s.server.port, "/?token=wrong")).status, 401);
    assert.equal((await send(s.server.port, "/api/config", { headers: { cookie: `loomdoc_${s.server.port}=${s.launchToken}` } })).status, 401);
    assert.equal((await send(s.server.port, "/api/config")).status, 401);
    assert.equal((await send(s.server.port, "/api/config", { headers: { cookie: "loomdoc_1=nope" } })).status, 401);
    // DNS rebinding: a page on evil.example resolving to 127.0.0.1 sends its own Host.
    const rebind = await send(s.server.port, "/api/config", { headers: { cookie: s.cookie, host: `evil.example:${s.server.port}` } });
    assert.equal(rebind.status, 403);
    assert.equal((await send(s.server.port, "/api/config", { headers: { cookie: s.cookie, host: `localhost:${s.server.port}` } })).status, 200);
  } finally {
    await s.server.close();
    await rm(s.dir, { recursive: true, force: true });
  }
});

test("POSTs need the header token and a same-origin Origin", async () => {
  const s = await setup();
  try {
    const noHeader = await send(s.server.port, "/api/runs", {
      method: "POST",
      headers: { cookie: s.cookie, "content-type": "application/json" },
      body: runBody,
    });
    assert.equal(noHeader.status, 403);
    assert.equal((await postRun(s, runBody, { origin: "https://evil.example" })).status, 403);
    assert.equal(s.calls.length, 0);
  } finally {
    await s.server.close();
    await rm(s.dir, { recursive: true, force: true });
  }
});

test("a run passes preset, guidance, and formats through and streams progress to completion", async () => {
  const s = await setup();
  try {
    const res = await postRun(s, runBody, { origin: `http://127.0.0.1:${s.server.port}` });
    assert.equal(res.status, 202);
    const { id } = JSON.parse(res.body) as { id: string };
    const events = await waitForEvents(s, id);
    assert.deepEqual(events.map((e) => e.type), ["progress", "progress", "done"]);
    const done = events.at(-1) as unknown as { result: { files: Array<{ href: string }>; steps: Array<{ screenshot: { href: string } }> } };

    assert.equal(s.calls[0]!.context?.preset, "sales-walkthrough");
    assert.equal(s.calls[0]!.context?.guidance, "Focus on reporting");
    assert.deepEqual(s.calls[0]!.formats, ["markdown"]);

    const md = await send(s.server.port, done.result.files[0]!.href, { headers: { cookie: s.cookie } });
    assert.equal(md.status, 200);
    assert.equal(md.body, "# Doc\n");
    const img = await send(s.server.port, done.result.steps[0]!.screenshot.href, { headers: { cookie: s.cookie } });
    assert.equal(img.status, 200);
    assert.equal(img.headers["content-type"], "image/png");

    // Path traversal out of the output folder is refused.
    for (const evil of ["..%2Fsecret.md", "images%2F..%2F..%2Fsecret.md", "%2Fetc%2Fpasswd"]) {
      const r = await send(s.server.port, `/files/${id}/${evil}`, { headers: { cookie: s.cookie } });
      assert.ok(r.status === 403 || r.status === 404, `${evil} -> ${r.status}`);
      assert.notEqual(r.body, "outside");
    }
  } finally {
    await s.server.close();
    await rm(s.dir, { recursive: true, force: true });
  }
});

test("validates input, refuses concurrent runs, and reports setup problems", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const slow = async (): Promise<LoomdocResult> => {
    await gate;
    throw new Error("stopped");
  };
  const s = await setup(slow);
  try {
    const custom = JSON.stringify({ url: "https://youtu.be/dQw4w9WgXcQ", preset: "custom", formats: ["pdf"] });
    assert.equal((await postRun(s, custom)).status, 400);
    assert.equal((await postRun(s, JSON.stringify({ url: "x", preset: "nope", formats: ["pdf"] }))).status, 400);
    assert.equal((await postRun(s, JSON.stringify({ url: "x", preset: "how-to", formats: [] }))).status, 400);

    const first = await postRun(s);
    assert.equal(first.status, 202);
    assert.equal((await postRun(s)).status, 409);
    release();
    const events = await waitForEvents(s, (JSON.parse(first.body) as { id: string }).id);
    const last = events.at(-1) as { type: string; message?: string };
    assert.equal(last.type, "error");
    assert.equal(last.message, "stopped");
    assert.equal((await postRun(s)).status, 202); // free again after the failure
  } finally {
    await s.server.close();
    await rm(s.dir, { recursive: true, force: true });
  }

  const blocked = await setup(undefined, ["yt-dlp is not installed."]);
  try {
    const res = await postRun(blocked);
    assert.equal(res.status, 412);
    assert.match(res.body, /yt-dlp is not installed/);
    assert.equal(blocked.calls.length, 0);
  } finally {
    await blocked.server.close();
    await rm(blocked.dir, { recursive: true, force: true });
  }
});

test("the page script is valid JavaScript and never uses innerHTML", async () => {
  const { Script } = await import("node:vm");
  const { APP_JS } = await import("../src/ui/page.js");
  assert.doesNotThrow(() => new Script(APP_JS));
  assert.doesNotMatch(APP_JS, /innerHTML/);
});

test("the launch link works once; the signed-in browser can revisit it", async () => {
  const s = await setup();
  try {
    const again = await send(s.server.port, `/?token=${s.launchToken}`);
    assert.equal(again.status, 401);
    assert.match(again.body, /already been used/);
    const sameBrowser = await send(s.server.port, `/?token=${s.launchToken}`, { headers: { cookie: s.cookie } });
    assert.equal(sameBrowser.status, 303);
  } finally {
    await s.server.close();
    await rm(s.dir, { recursive: true, force: true });
  }
});

test("simultaneous submissions start exactly one run", async () => {
  let started = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const slow = async (): Promise<LoomdocResult> => {
    started++;
    await gate;
    throw new Error("stopped");
  };
  // A slow requirements check widens the window the old check-then-set race lived in.
  const s = await setup(slow, [], 50);
  try {
    const replies = await Promise.all([postRun(s), postRun(s), postRun(s)]);
    assert.deepEqual(replies.map((r) => r.status).sort(), [202, 409, 409]);
    assert.equal(started, 1);
    release();
  } finally {
    await s.server.close();
    await rm(s.dir, { recursive: true, force: true });
  }
});

test("a failed requirements check releases the run slot", async () => {
  const s = await setup(undefined, ["ffmpeg is missing."]);
  try {
    assert.equal((await postRun(s)).status, 412);
    assert.equal((await postRun(s)).status, 412, "not 409: the slot was released");
  } finally {
    await s.server.close();
    await rm(s.dir, { recursive: true, force: true });
  }
});

test("output files are served without the page CSP, and a read error doesn't crash the server", { skip: process.platform !== "linux" }, async () => {
  const s = await setup();
  try {
    const res = await postRun(s);
    const { id } = JSON.parse(res.body) as { id: string };
    await waitForEvents(s, id);

    const md = await send(s.server.port, `/files/${id}/document.md`, { headers: { cookie: s.cookie } });
    assert.equal(md.status, 200);
    assert.equal(md.headers["content-security-policy"], undefined);
    assert.equal(md.headers["x-content-type-options"], "nosniff");

    // stat() reports a regular file but reading it fails (EIO).
    const { symlink } = await import("node:fs/promises");
    await symlink("/proc/self/mem", join(s.outputDir, "broken.md"));
    await send(s.server.port, `/files/${id}/broken.md`, { headers: { cookie: s.cookie } }).catch(() => undefined);
    const alive = await send(s.server.port, "/api/config", { headers: { cookie: s.cookie } });
    assert.equal(alive.status, 200, "server survived the stream error");
  } finally {
    await s.server.close();
    await rm(s.dir, { recursive: true, force: true });
  }
});
