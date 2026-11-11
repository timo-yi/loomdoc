#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const TMP = process.env.TMPDIR || "/tmp";
const VERIFY_ROOT = (process.env.LOOMDOC_VERIFY_ROOT || path.join(TMP, "verify-loomdoc")).replace(/\/$/, "");
const PLACEHOLDER_KEY = "verify-placeholder-not-a-real-key";
const SAMPLE_URL = "https://www.loom.com/share/abcdef0123456789abcdef0123456789";

const GLOBAL_FLAGS = new Set(["help", "json", "run"]);

function emit(obj) {
  fs.writeSync(1, JSON.stringify(redactValue(obj), null, 2) + "\n");
}

function redact(text) {
  return String(text)
    .replace(/token=[0-9a-f]+/gi, "token=REDACTED")
    .replace(/\b[0-9a-f]{64}\b/g, "REDACTED");
}

function redactValue(value) {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = redactValue(item);
    return out;
  }
  return value;
}

class Fail extends Error {
  constructor(error, hint, extra = {}) {
    super(error);
    this.hint = hint;
    this.extra = extra;
  }
}

function fail(error, hint, extra = {}) {
  throw new Fail(error, hint, extra);
}

function report(err) {
  if (err instanceof Fail) emit({ ok: false, error: err.message, hint: err.hint, ...err.extra });
  else {
    emit({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      hint: "Run doctor. If the page is wedged, run stop, then up --placeholder-key.",
    });
  }
  process.exit(1);
}

function ok(data) {
  emit({ ok: true, ...data });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function commandExists(bin) {
  const result = spawnSync("which", [bin], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

function chromeBin() {
  if (process.env.LOOMDOC_CHROME) return process.env.LOOMDOC_CHROME;
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    const found = commandExists(name);
    if (found) return found;
  }
  return null;
}

function ffmpegSummary() {
  const result = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
  if (result.status !== 0) return null;
  return /^ffmpeg version (\S+)/.exec(result.stdout)?.[1] ?? "present";
}

function repoVersion() {
  const pkg = readJson(path.join(REPO, "package.json"));
  return pkg?.version ?? "unknown";
}

function gitRevision() {
  const result = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

function depsInstalled() {
  return fs.existsSync(path.join(REPO, "node_modules", "tsx", "package.json"));
}

function alive(pid) {
  if (!pid || pid < 2) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function pidsWithArg(arg) {
  const pids = [];
  for (const entry of fs.readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    let cmd = "";
    try {
      cmd = fs.readFileSync(`/proc/${entry}/cmdline`, "utf8").replaceAll("\0", " ");
    } catch {
      continue;
    }
    if (cmd.includes(arg)) pids.push(Number(entry));
  }
  return pids;
}

async function killPid(pid) {
  if (!alive(pid)) return;
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      return;
    }
  }
  for (let i = 0; i < 20; i++) {
    if (!alive(pid)) return;
    await sleep(250);
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      return;
    }
  }
}

function listeningPid(port) {
  const hex = port.toString(16).toUpperCase().padStart(4, "0");
  const inodes = new Set();
  for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    let text = "";
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of text.trim().split("\n").slice(1)) {
      const parts = line.trim().split(/\s+/);
      if (parts[3] !== "0A") continue;
      const localPort = parts[1]?.split(":")[1]?.toUpperCase();
      if (localPort === hex) inodes.add(parts[9]);
    }
  }
  if (inodes.size === 0) return null;
  for (const entry of fs.readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    let fds = [];
    try {
      fds = fs.readdirSync(`/proc/${entry}/fd`);
    } catch {
      continue;
    }
    for (const fd of fds) {
      try {
        const target = fs.readlinkSync(`/proc/${entry}/fd/${fd}`);
        const match = /^socket:\[(\d+)\]$/.exec(target);
        if (match && inodes.has(match[1])) return Number(entry);
      } catch {
        continue;
      }
    }
  }
  return null;
}

function isAncestor(ancestor, pid) {
  let current = pid;
  for (let i = 0; i < 12; i++) {
    if (current === ancestor) return true;
    let status = "";
    try {
      status = fs.readFileSync(`/proc/${current}/status`, "utf8");
    } catch {
      return false;
    }
    const ppid = Number(/^PPid:\s+(\d+)/m.exec(status)?.[1] ?? 0);
    if (ppid < 2) return false;
    current = ppid;
  }
  return false;
}

function stamp() {
  const date = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}-${process.pid}`;
}

function createRun() {
  if (path.basename(VERIFY_ROOT).startsWith("loomdoc-")) {
    fail(
      `LOOMDOC_VERIFY_ROOT basename "${path.basename(VERIFY_ROOT)}" starts with loomdoc-.`,
      "Pick another directory. loomdoc deletes temp directories whose names start with loomdoc-.",
    );
  }
  const dir = path.join(VERIFY_ROOT, stamp());
  fs.mkdirSync(path.join(dir, "evidence"), { recursive: true });
  fs.mkdirSync(path.join(dir, "state"), { recursive: true });
  fs.mkdirSync(path.join(dir, "out"), { recursive: true });
  return dir;
}

function requireRun(flags) {
  if (!flags.run) {
    fail(
      "No run directory.",
      "Run `up` or `new`, then pass --run <dir> or export LOOMDOC_RUN to that path. Each command is a new process, so the shell must carry the path.",
    );
  }
  if (!fs.existsSync(path.join(flags.run, "evidence"))) {
    fail(
      `${flags.run} is not a loomdoc verification run (no evidence/).`,
      "Pass the directory printed by `up` or `new`.",
    );
  }
  return flags.run;
}

function statePath(run) {
  return path.join(run, "state", "session.json");
}

function loadState(run) {
  return readJson(statePath(run));
}

function saveState(run, state) {
  fs.mkdirSync(path.join(run, "state"), { recursive: true });
  fs.writeFileSync(statePath(run), JSON.stringify(state, null, 2));
}

function nextId(run) {
  const evidence = path.join(run, "evidence");
  let max = 0;
  if (fs.existsSync(evidence)) {
    for (const name of fs.readdirSync(evidence)) {
      const match = /-(\d+)\./.exec(name);
      if (match) max = Math.max(max, Number(match[1]));
    }
  }
  return String(max + 1).padStart(2, "0");
}

function tailFile(file, lines) {
  if (!fs.existsSync(file)) return "";
  return fs.readFileSync(file, "utf8").split("\n").slice(-lines).join("\n");
}

function knownFlags(extra) {
  return new Set([...GLOBAL_FLAGS, ...extra]);
}

function rejectUnknown(parsed, allowed) {
  const okFlags = knownFlags(allowed);
  for (const key of Object.keys(parsed.kv)) {
    if (!okFlags.has(key)) {
      fail(
        `Unknown flag --${key}.`,
        `Run \`${parsed.positionals[0] || "help"} --help\` for the flags this command accepts.`,
      );
    }
  }
  if (parsed.flags.dryRun && !allowed.includes("dry-run")) {
    fail("This command has no --dry-run.", "Use --dry-run on `up` or `stop`.");
  }
}

function parseArgv(argv) {
  const flags = { help: false, json: false, dryRun: false, run: process.env.LOOMDOC_RUN || "" };
  const kv = {};
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (arg === "--help" || arg === "-h") {
      flags.help = true;
      continue;
    }
    if (arg === "--json") {
      flags.json = true;
      continue;
    }
    if (arg === "--dry-run") {
      flags.dryRun = true;
      kv["dry-run"] = true;
      continue;
    }
    if (arg === "--run") {
      const value = argv[++i];
      if (!value || value.startsWith("--")) {
        fail("--run needs a directory.", "Pass the path printed by `up` or `new`.");
      }
      flags.run = value;
      continue;
    }
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) kv[key] = true;
      else kv[key] = argv[++i];
      continue;
    }
    positionals.push(arg);
  }
  return { flags, kv, positionals };
}

function machineReport() {
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  const ffmpeg = ffmpegSummary();
  const chrome = chromeBin();
  const problems = [];
  if (nodeMajor < 22) {
    problems.push(`Node ${process.version} is older than Node 22. This repo's CI uses Node 22, and the driver needs the built-in WebSocket.`);
  }
  if (!ffmpeg) problems.push("ffmpeg is not on PATH. On Debian/Ubuntu run: sudo apt-get update && sudo apt-get install -y ffmpeg");
  if (!chrome) problems.push("Google Chrome or Chromium is not on PATH. Install google-chrome, or set LOOMDOC_CHROME to the binary.");
  if (!fs.existsSync(path.join(REPO, "package.json"))) problems.push(`package.json is missing under ${REPO}.`);
  let chromeVersion = null;
  if (chrome) {
    const result = spawnSync(chrome, ["--version"], { encoding: "utf8" });
    chromeVersion = result.stdout.trim() || result.stderr.trim() || chrome;
  }
  return {
    loomdoc: repoVersion(),
    git: gitRevision(),
    node: process.version,
    ffmpeg,
    chrome: chromeVersion,
    chromeBin: chrome,
    deps: depsInstalled() ? "installed" : "missing",
    problems,
  };
}

async function pageFacts(state) {
  return withPage(state, async (cdp) => {
    const facts = await evaluate(cdp, `(() => {
      const error = document.querySelector("#form-error");
      return {
        title: document.title,
        href: location.href.split("?")[0],
        form: Boolean(document.querySelector("#run-form")),
        presets: document.querySelectorAll('input[name="preset"]').length,
        error: error && !error.hidden ? error.textContent : "",
      };
    })()`);
    let config = null;
    try {
      config = await evaluate(cdp, `fetch("/api/config").then(async (res) => {
        const body = await res.json();
        return { status: res.status, activeRunId: body.activeRunId ?? null, notices: body.notices ?? [], presetIds: (body.presets || []).map((p) => p.id) };
      })`);
    } catch (err) {
      config = { error: err instanceof Error ? err.message : String(err) };
    }
    return { facts, config };
  });
}

async function instanceReport(run) {
  const state = loadState(run);
  if (!state) return { instance: null };
  const uiUp = alive(state.uiPid);
  const owner = state.uiPort ? listeningPid(state.uiPort) : null;
  const ownsPort = Boolean(owner && (owner === state.uiPid || isAncestor(state.uiPid, owner)));
  const chromeUp = alive(state.chromePid) || pidsWithArg(state.userDataDir).length > 0;
  const report = {
    instance: {
      uiPid: state.uiPid,
      uiUp,
      port: state.uiPort,
      portOwner: owner,
      ownsPort,
      chromePid: state.chromePid,
      chromeUp,
      cdpPort: state.cdpPort,
      key: state.keyMode,
      page: state.pageUrl,
    },
  };
  if (uiUp && ownsPort && chromeUp) {
    try {
      const page = await pageFacts(state);
      report.instance.page = page.facts;
      report.instance.config = page.config;
      report.instance.ready = Boolean(page.facts?.form && page.facts.presets > 0 && page.config?.status === 200);
    } catch (err) {
      report.instance.ready = false;
      report.instance.pageError = err instanceof Error ? err.message : String(err);
    }
  } else {
    report.instance.ready = false;
  }
  return report;
}

function connectCdp(wsUrl) {
  const socket = new WebSocket(wsUrl);
  const pending = new Map();
  let next = 0;
  const ready = new Promise((resolve, reject) => {
    socket.addEventListener("open", () => resolve());
    socket.addEventListener("error", () => reject(new Error("Could not open the Chrome DevTools socket.")));
  });
  socket.addEventListener("message", (ev) => {
    const text = typeof ev.data === "string" ? ev.data : String(ev.data);
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (!msg.id || !pending.has(msg.id)) return;
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message || "Chrome DevTools call failed."));
    else resolve(msg.result ?? {});
  });
  return {
    ready,
    send(method, params = {}) {
      const id = ++next;
      return ready.then(() => new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      }));
    },
    close() {
      socket.close();
    },
  };
}

async function withPage(state, fn) {
  let list;
  try {
    const res = await fetch(`http://127.0.0.1:${state.cdpPort}/json/list`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    list = await res.json();
  } catch {
    fail(
      `Chrome DevTools on port ${state.cdpPort} is not answering.`,
      "Run doctor. If Chrome died, run stop, then up.",
    );
  }
  const origin = `http://127.0.0.1:${state.uiPort}`;
  const page = list.find((target) => target.type === "page" && String(target.url).startsWith(origin))
    || list.find((target) => target.type === "page" && String(target.url).startsWith(`http://localhost:${state.uiPort}`));
  if (!page?.webSocketDebuggerUrl) {
    const urls = list.filter((target) => target.type === "page").map((target) => target.url);
    fail(
      "Chrome has no loomdoc tab.",
      "The private link works once. Run stop, then up, and let this CLI open the link. Do not open it yourself first.",
      { openPages: urls },
    );
  }
  const cdp = connectCdp(page.webSocketDebuggerUrl);
  try {
    await cdp.ready;
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    await cdp.send("Page.bringToFront").catch(() => {});
    await evaluate(cdp, HOOK);
    return await fn(cdp);
  } finally {
    cdp.close();
  }
}

const HOOK = `(() => {
  if (window.__loomdocVerify) return true;
  const rec = { console: [], network: [] };
  window.__loomdocVerify = rec;
  const push = (bucket, item) => {
    rec[bucket].push(item);
    if (rec[bucket].length > 200) rec[bucket].shift();
  };
  for (const level of ["log", "info", "warn", "error", "debug"]) {
    const orig = console[level].bind(console);
    console[level] = (...args) => {
      push("console", { level, text: args.map((item) => {
        try { return typeof item === "string" ? item : JSON.stringify(item); }
        catch { return String(item); }
      }).join(" "), at: Date.now() });
      orig(...args);
    };
  }
  window.addEventListener("error", (event) => push("console", { level: "error", text: String(event.message), at: Date.now() }));
  window.addEventListener("unhandledrejection", (event) => push("console", { level: "error", text: String(event.reason), at: Date.now() }));
  const origFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const method = (init && init.method) || (input && input.method) || "GET";
    const url = typeof input === "string" ? input : (input && input.url) || "";
    const started = Date.now();
    try {
      const res = await origFetch(input, init);
      push("network", { method, url, status: res.status, ms: Date.now() - started });
      return res;
    } catch (err) {
      push("network", { method, url, error: String(err), ms: Date.now() - started });
      throw err;
    }
  };
  return true;
})()`;

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    const text = result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Evaluation failed.";
    throw new Error(text);
  }
  return result.result?.value;
}

async function waitFor(state, predicate, timeoutMs, label) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    try {
      last = await withPage(state, (cdp) => evaluate(cdp, predicate));
      if (last) return last;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    await sleep(200);
  }
  fail(`Timed out after ${timeoutMs}ms waiting for ${label}.`, "Run browser snapshot to see the page, or doctor if the server died.", { last });
}

function requireState(run) {
  const state = loadState(run);
  if (!state?.uiPort || !state.cdpPort) {
    fail("This run has no loomdoc page.", "Run `up --placeholder-key` with the same --run directory.");
  }
  return state;
}

function assertSpendAllowed(state, action) {
  if (state?.keyMode !== "real") return;
  if (process.env.LOOMDOC_VERIFY_ALLOW_SPEND === "1") return;
  fail(
    `${action} can start a paid Anthropic run.`,
    "Ask the user before spending. After they approve, export LOOMDOC_VERIFY_ALLOW_SPEND=1 and run the command again. Omit the export to keep the guard.",
  );
}

function axLines(nodes) {
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const childIds = new Map();
  const listed = new Set();
  for (const node of nodes) {
    if (Array.isArray(node.childIds)) {
      childIds.set(node.nodeId, node.childIds);
      for (const id of node.childIds) listed.add(id);
    }
  }
  for (const node of nodes) {
    if (!node.parentId || listed.has(node.nodeId)) continue;
    if (!childIds.has(node.parentId)) childIds.set(node.parentId, []);
    childIds.get(node.parentId).push(node.nodeId);
  }
  const lines = [];
  const skip = new Set(["none", "generic", "InlineTextBox", "StaticText", "ignored", "LineBreak"]);
  function walk(id, depth) {
    const node = byId.get(id);
    if (!node || node.ignored) {
      for (const child of childIds.get(id) ?? []) walk(child, depth);
      return;
    }
    const role = node.role?.value ?? "node";
    const name = node.name?.value ?? "";
    const valueProp = (node.properties || []).find((prop) => prop.name === "value");
    const value = valueProp?.value?.value;
    const shown = !skip.has(role) && (name || ["button", "link", "textbox", "searchbox", "radio", "checkbox", "combobox", "heading", "alert", "form"].includes(role));
    if (shown) {
      let line = `${"  ".repeat(Math.min(depth, 8))}${role}`;
      if (name) line += ` "${name.replaceAll(/\s+/g, " ").slice(0, 180)}"`;
      if (value !== undefined && value !== "") line += ` value=${JSON.stringify(String(value).slice(0, 120))}`;
      lines.push(line);
    }
    for (const child of childIds.get(id) ?? []) walk(child, shown ? depth + 1 : depth);
  }
  const roots = nodes.filter((node) => !node.parentId || !byId.has(node.parentId));
  for (const root of roots) walk(root.nodeId, 0);
  return lines.join("\n");
}

async function axTree(cdp) {
  const tree = await cdp.send("Accessibility.getFullAXTree");
  return tree.nodes ?? [];
}

function matchAx(nodes, role, name) {
  const wantedRole = role.toLowerCase();
  const wantedName = name.toLowerCase();
  const candidates = nodes.filter((node) => {
    if (node.ignored) return false;
    if (String(node.role?.value ?? "").toLowerCase() !== wantedRole) return false;
    return node.backendDOMNodeId;
  });
  const named = candidates.map((node) => ({ node, name: node.name?.value ?? "" }));
  const exact = named.filter((item) => item.name.toLowerCase() === wantedName);
  const prefix = named.filter((item) => item.name.toLowerCase().startsWith(wantedName));
  const chosen = exact.length ? exact : prefix;
  if (chosen.length === 1) return chosen[0].node;
  const sample = named.map((item) => item.name).filter(Boolean).slice(0, 12);
  if (chosen.length === 0) {
    fail(
      `No ${role} named "${name}".`,
      "Run browser snapshot and copy the role and name from a line. Names are matched exactly, then by prefix.",
      { names: sample },
    );
  }
  fail(
    `More than one ${role} matches "${name}".`,
    "Pass a longer --name, or use --selector.",
    { names: chosen.map((item) => item.name) },
  );
}

async function clickBackend(cdp, backendNodeId) {
  const { object } = await cdp.send("DOM.resolveNode", { backendNodeId });
  if (!object?.objectId) throw new Error("Chrome did not resolve that element.");
  await cdp.send("Runtime.callFunctionOn", {
    objectId: object.objectId,
    functionDeclaration: `function() {
      this.scrollIntoView({ block: "center", inline: "center" });
      if (typeof this.click === "function") this.click();
      return { tag: this.tagName, id: this.id || "", text: (this.innerText || this.value || "").slice(0, 160) };
    }`,
    returnByValue: true,
  }).then((result) => {
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "click failed");
    return result.result?.value;
  });
}

async function clickTarget(cdp, kv) {
  if (kv.selector && kv.selector !== true) {
    const found = await evaluate(cdp, `(() => {
      const el = document.querySelector(${JSON.stringify(kv.selector)});
      if (!el) return null;
      el.scrollIntoView({ block: "center", inline: "center" });
      el.click();
      return { tag: el.tagName, id: el.id || "", text: (el.innerText || el.value || el.getAttribute("aria-label") || "").slice(0, 160) };
    })()`);
    if (!found) {
      fail(
        `No element matches ${kv.selector}.`,
        "Run browser snapshot. Stable handles include #url, #guidance, #submit, #form-error, #presets, input[name=preset], input[name=formats], select[name=pdfLayout], select[name=effort], #progress, #result.",
      );
    }
    return found;
  }
  if (!kv.role || !kv.name || kv.role === true || kv.name === true) {
    fail("click needs --selector, or both --role and --name.", "Example: browser click --role button --name \"Generate document\"");
  }
  const nodes = await axTree(cdp);
  const node = matchAx(nodes, String(kv.role), String(kv.name));
  await clickBackend(cdp, node.backendDOMNodeId);
  return { role: kv.role, name: kv.name };
}

async function fillTarget(cdp, kv) {
  if (!kv.selector || kv.selector === true) fail("fill needs --selector.", "Example: browser fill --selector \"#url\" --value \"https://www.loom.com/share/…\"");
  if (kv.value === undefined || kv.value === true) fail("fill needs --value.", "Pass the text to type, including an empty string if you mean to clear the field.");
  const value = String(kv.value);
  const result = await evaluate(cdp, `(() => {
    const el = document.querySelector(${JSON.stringify(kv.selector)});
    if (!el) return { ok: false, error: "missing" };
    el.scrollIntoView({ block: "center", inline: "center" });
    el.focus();
    const tag = el.tagName;
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (tag === "SELECT") {
      el.value = ${JSON.stringify(value)};
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, value: el.value, mode: "select" };
    }
    if (type === "checkbox" || type === "radio") return { ok: false, error: "checkable" };
    return { ok: true, mode: "text" };
  })()`);
  if (!result?.ok && result?.error === "missing") {
    fail(`No element matches ${kv.selector}.`, "Run browser snapshot and use a selector from the page, such as #url or #guidance.");
  }
  if (!result?.ok && result?.error === "checkable") {
    fail(
      `${kv.selector} is a checkbox or radio.`,
      "Use browser click --selector for that control. fill types into text fields and selects an option in a select.",
    );
  }
  if (result.mode === "select") return result;
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    modifiers: 2,
    key: "a",
    code: "KeyA",
    windowsVirtualKeyCode: 65,
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    modifiers: 2,
    key: "a",
    code: "KeyA",
    windowsVirtualKeyCode: 65,
  });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
  if (value) await cdp.send("Input.insertText", { text: value });
  const actual = await evaluate(cdp, `document.querySelector(${JSON.stringify(kv.selector)})?.value ?? null`);
  return { value: actual, mode: "text" };
}

const KEYS = {
  Enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" },
  Tab: { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
  Escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
  Backspace: { key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 },
  Space: { key: " ", code: "Space", windowsVirtualKeyCode: 32, text: " " },
};

async function pressKey(cdp, key, selector) {
  const spec = KEYS[key];
  if (!spec) {
    fail(
      `Unsupported key "${key}".`,
      `Use one of: ${Object.keys(KEYS).join(", ")}.`,
    );
  }
  if (selector) {
    const focused = await evaluate(cdp, `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.focus();
      return true;
    })()`);
    if (!focused) fail(`No element matches ${selector}.`, "Run browser snapshot, then pass a selector that exists.");
  }
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", ...spec });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: spec.key, code: spec.code, windowsVirtualKeyCode: spec.windowsVirtualKeyCode });
}

async function screenshot(cdp, file) {
  const metrics = await cdp.send("Page.getLayoutMetrics");
  const width = Math.ceil(metrics.cssContentSize?.width || metrics.contentSize?.width || 1200);
  const height = Math.ceil(metrics.cssContentSize?.height || metrics.contentSize?.height || 900);
  const shot = await cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width, height, scale: 1 },
  });
  fs.writeFileSync(file, Buffer.from(shot.data, "base64"));
  return { path: file, bytes: fs.statSync(file).size, width, height };
}

function installDeps(run, dryRun) {
  if (depsInstalled()) return { installed: false };
  const log = path.join(run, "evidence", "npm-install.log");
  if (dryRun) return { installed: false, wouldInstall: true, log };
  const fd = fs.openSync(log, "w");
  const result = spawnSync("npm", ["install"], { cwd: REPO, stdio: ["ignore", fd, fd] });
  fs.closeSync(fd);
  if (result.status !== 0) {
    fail(
      "npm install failed.",
      "Read evidence/npm-install.log in the run directory. From the repo root, run npm install yourself, then run up again.",
      { log: tailFile(log, 40) },
    );
  }
  return { installed: true, log };
}

async function stopRun(run, dryRun) {
  const state = loadState(run);
  const actions = [];
  if (!state) {
    return { stopped: false, actions, evidence: path.join(run, "evidence"), output: path.join(run, "out") };
  }
  const chromePids = state.userDataDir ? pidsWithArg(state.userDataDir) : [];
  actions.push({ signal: "SIGTERM", uiPid: state.uiPid, chromePid: state.chromePid, chromePids });
  if (!dryRun) {
    await killPid(state.chromePid);
    for (const pid of chromePids) await killPid(pid);
    await killPid(state.uiPid);
    fs.rmSync(path.join(run, "state"), { recursive: true, force: true });
  }
  return {
    stopped: !dryRun,
    dryRun,
    actions,
    evidence: path.join(run, "evidence"),
    output: path.join(run, "out"),
  };
}

async function launchUi(run, keyMode, key) {
  const log = path.join(run, "evidence", "ui-server.log");
  const fd = fs.openSync(log, "a");
  const child = spawn(
    "node",
    ["--import", "tsx", "src/cli.ts", "ui", "--no-open", "--port", "0", "--out", path.join(run, "out")],
    {
      cwd: REPO,
      env: { ...process.env, ANTHROPIC_API_KEY: key },
      detached: true,
      stdio: ["ignore", fd, fd],
    },
  );
  child.unref();
  fs.closeSync(fd);
  const pid = child.pid;
  let launchUrl = "";
  for (let i = 0; i < 120; i++) {
    const text = fs.existsSync(log) ? fs.readFileSync(log, "utf8") : "";
    launchUrl = /http:\/\/127\.0\.0\.1:[0-9]+\/\?token=[0-9a-f]+/.exec(text)?.[0] ?? "";
    if (launchUrl) break;
    if (!alive(pid)) {
      fail(
        "loomdoc ui exited before it printed a private link.",
        "The usual cause is a missing ffmpeg or a missing ANTHROPIC_API_KEY. This command passes a placeholder key when you ask for one. Read the server log and fix the first error it names.",
        { log: tailFile(log, 40) },
      );
    }
    await sleep(500);
  }
  if (!launchUrl) {
    await killPid(pid);
    fail(
      "loomdoc ui did not print a private link within 60s.",
      "Read the log tail. The usual cause is ffmpeg missing, or npm dependencies not installed.",
      { log: tailFile(log, 40) },
    );
  }
  const port = Number(/:(\d+)\//.exec(launchUrl)?.[1]);
  return { pid, port, launchUrl, keyMode, log };
}

async function launchChrome(run, state) {
  const bin = chromeBin();
  if (!bin) {
    fail("Google Chrome or Chromium is not on PATH.", "Install google-chrome, or set LOOMDOC_CHROME to the binary, then run up again.");
  }
  const userDataDir = path.join(run, "state", "chrome");
  fs.mkdirSync(userDataDir, { recursive: true });
  const log = path.join(run, "evidence", "chrome.log");
  const fd = fs.openSync(log, "a");
  const headed = process.env.LOOMDOC_CHROME_HEADLESS !== "1" && Boolean(process.env.DISPLAY);
  const args = [
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "--disable-background-networking",
    "--disable-dev-shm-usage",
    "--force-device-scale-factor=1",
    "--window-size=1100,1400",
    "--window-position=40,40",
    `--user-data-dir=${userDataDir}`,
    "--remote-debugging-port=0",
    "--remote-allow-origins=*",
  ];
  if (!headed) args.push("--headless=new");
  args.push(state.launchUrl);
  const child = spawn(bin, args, { detached: true, stdio: ["ignore", fd, fd] });
  child.unref();
  fs.closeSync(fd);
  const portFile = path.join(userDataDir, "DevToolsActivePort");
  let cdpPort = 0;
  for (let i = 0; i < 40; i++) {
    if (fs.existsSync(portFile)) {
      cdpPort = Number(fs.readFileSync(portFile, "utf8").split("\n")[0]);
      if (cdpPort) break;
    }
    if (!alive(child.pid) && pidsWithArg(userDataDir).length === 0) {
      fail(
        "Chrome exited before DevTools opened.",
        "Read evidence/chrome.log. Install google-chrome, or set LOOMDOC_CHROME to a binary that starts on this machine.",
        { log: tailFile(log, 30) },
      );
    }
    await sleep(250);
  }
  if (!cdpPort) {
    await killPid(child.pid);
    for (const pid of pidsWithArg(userDataDir)) await killPid(pid);
    fail(
      "Chrome did not open a DevTools port.",
      "evidence/chrome.log has Chrome's own messages. Run up again after fixing the first error in that log.",
      { log: tailFile(log, 30) },
    );
  }
  return { chromePid: child.pid, cdpPort, userDataDir, headed, log };
}

async function cmdDoctor(parsed) {
  rejectUnknown(parsed, []);
  const machine = machineReport();
  const report = { command: "doctor", ...machine, ready: false };
  if (parsed.flags.run) {
    const run = requireRun(parsed.flags);
    Object.assign(report, await instanceReport(run));
    report.run = run;
  } else {
    report.instance = null;
  }
  if (machine.problems.length) {
    fail(machine.problems[0], machine.problems.join(" "), report);
  }
  report.ready = report.instance?.ready === true;
  if (report.instance && report.instance.ready === false) {
    fail(
      "The loomdoc page for this run is not usable.",
      "Run stop, then up --placeholder-key. If doctor listed a dead pid, that command replaces it.",
      report,
    );
  }
  const activeRunId = report.instance?.config?.activeRunId;
  if (activeRunId) {
    report.hint = `A document is already being generated (${activeRunId}). Wait until activeRunId is null before starting another.`;
  } else if (report.ready) {
    report.hint = "The page is up. Read references/features and drive a feature.";
  } else {
    report.hint = "The machine can run loomdoc. Start the page with: node .cursor/skills/verify-loomdoc/control-loomdoc.mjs up --placeholder-key";
  }
  ok(report);
}

async function cmdNew(parsed) {
  rejectUnknown(parsed, []);
  const run = createRun();
  ok({
    command: "new",
    run,
    export: `export LOOMDOC_RUN=${run}`,
    hint: "Export that path, or pass --run, on every later command.",
  });
}

async function cmdUp(parsed) {
  rejectUnknown(parsed, ["placeholder-key", "dry-run"]);
  const placeholder = parsed.kv["placeholder-key"] === true;
  const realKey = process.env.ANTHROPIC_API_KEY?.trim() || "";
  if (placeholder && realKey) {
    fail(
      "--placeholder-key was refused because ANTHROPIC_API_KEY is already set.",
      "Unset ANTHROPIC_API_KEY to start a no-spend page. To verify with the real key, run up without --placeholder-key, and do not submit a video until the user approves the spend.",
    );
  }
  const keyMode = placeholder || !realKey ? "placeholder" : "real";
  const key = keyMode === "placeholder" ? PLACEHOLDER_KEY : realKey;
  let run = parsed.flags.run;
  if (!run) {
    if (parsed.flags.dryRun) {
      ok({
        command: "up",
        dryRun: true,
        wouldCreateRun: path.join(VERIFY_ROOT, "<new>"),
        wouldInstall: !depsInstalled(),
        key: keyMode,
        hint: "Nothing was started.",
      });
      return;
    }
    run = createRun();
  } else {
    requireRun(parsed.flags);
  }
  const existing = await instanceReport(run);
  if (existing.instance?.ready) {
    ok({
      command: "up",
      run,
      export: `export LOOMDOC_RUN=${run}`,
      alreadyRunning: true,
      ...existing.instance,
      hint: "This run is already usable. Drive it, or run stop before starting another page in the same directory.",
    });
    return;
  }
  if (existing.instance && parsed.flags.dryRun) {
    ok({ command: "up", dryRun: true, run, wouldRestart: true, ...existing.instance, hint: "Would stop the unusable instance and start another." });
    return;
  }
  if (existing.instance) await stopRun(run, false);
  fs.mkdirSync(path.join(run, "evidence"), { recursive: true });
  fs.mkdirSync(path.join(run, "state"), { recursive: true });
  fs.mkdirSync(path.join(run, "out"), { recursive: true });
  const deps = installDeps(run, parsed.flags.dryRun);
  if (parsed.flags.dryRun) {
    ok({ command: "up", dryRun: true, run, key: keyMode, ...deps, hint: "Would start loomdoc ui and Chrome." });
    return;
  }
  let started = false;
  try {
    const ui = await launchUi(run, keyMode, key);
    started = true;
    const partial = {
      uiPid: ui.pid,
      uiPort: ui.port,
      keyMode,
      launchSpent: false,
      pageUrl: `http://127.0.0.1:${ui.port}/`,
    };
    saveState(run, partial);
    const chrome = await launchChrome(run, { launchUrl: ui.launchUrl });
    const state = {
      ...partial,
      chromePid: chrome.chromePid,
      cdpPort: chrome.cdpPort,
      userDataDir: chrome.userDataDir,
      headed: chrome.headed,
      launchSpent: true,
    };
    saveState(run, state);
    await waitFor(
      state,
      `document.querySelectorAll('input[name="preset"]').length > 0`,
      30000,
      "the document-style radios",
    );
    const page = await pageFacts(state);
    if (!page.facts?.form) {
      fail(
        "Chrome opened a page that is not the loomdoc form.",
        "The private link may have been spent before Chrome opened it. Run up again. Do not curl the link or open it in another browser.",
        { page: page.facts },
      );
    }
    ok({
      command: "up",
      run,
      export: `export LOOMDOC_RUN=${run}`,
      pid: state.uiPid,
      port: state.uiPort,
      chromePid: state.chromePid,
      key: keyMode,
      headed: state.headed,
      ready: true,
      page: page.facts,
      notices: page.config?.notices ?? [],
      deps,
      hint: keyMode === "real"
        ? "The page is up with the real API key. Submit a video only after the user approves the spend, with LOOMDOC_VERIFY_ALLOW_SPEND=1."
        : "The page is up with a placeholder key. Generating a document fails at the model and does not spend money. Export LOOMDOC_RUN before the next command.",
    });
  } catch (err) {
    if (started) {
      const uiLog = tailFile(path.join(run, "evidence", "ui-server.log"), 40);
      await stopRun(run, false);
      if (err instanceof Fail) err.extra = { ...err.extra, run, uiLog };
    }
    throw err;
  }
}

function looksLikeGeneration(args) {
  const [first] = args;
  if (!first || first === "doctor" || first === "ui" || first === "--help" || first === "-h") return false;
  return true;
}

async function cmdCli(parsed) {
  rejectUnknown(parsed, []);
  const run = requireRun(parsed.flags);
  const args = parsed.positionals.slice(1);
  if (args.length === 0) {
    fail("cli needs loomdoc's arguments after --.", "Example: cli -- --help    or    cli -- doctor");
  }
  if (looksLikeGeneration(args) && process.env.ANTHROPIC_API_KEY?.trim() && process.env.LOOMDOC_VERIFY_ALLOW_SPEND !== "1") {
    fail(
      "This loomdoc command can start a paid run because ANTHROPIC_API_KEY is set.",
      "Flag checks and doctor do not need a key. For a real document, ask the user, then export LOOMDOC_VERIFY_ALLOW_SPEND=1.",
    );
  }
  const id = nextId(run);
  const base = path.join(run, "evidence", `cli-${id}`);
  fs.writeFileSync(`${base}.cmd`, `loomdoc ${args.map(shellQuote).join(" ")}\n`);
  const result = spawnSync("node", ["--import", "tsx", "src/cli.ts", ...args], {
    cwd: REPO,
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const code = result.status ?? 1;
  fs.writeFileSync(`${base}.stdout`, result.stdout ?? "");
  fs.writeFileSync(`${base}.stderr`, result.stderr ?? "");
  fs.writeFileSync(`${base}.exit`, String(code));
  ok({
    command: "cli",
    run,
    id: `cli-${id}`,
    args,
    exit: code,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    evidence: { cmd: `${base}.cmd`, stdout: `${base}.stdout`, stderr: `${base}.stderr`, exit: `${base}.exit` },
  });
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

async function cmdInfo(parsed) {
  rejectUnknown(parsed, []);
  const run = requireRun(parsed.flags);
  const report = await instanceReport(run);
  ok({ command: "info", run, ...report, evidence: path.join(run, "evidence"), output: path.join(run, "out") });
}

async function cmdLogs(parsed) {
  rejectUnknown(parsed, []);
  const run = requireRun(parsed.flags);
  ok({
    command: "logs",
    run,
    ui: tailFile(path.join(run, "evidence", "ui-server.log"), 80),
    chrome: tailFile(path.join(run, "evidence", "chrome.log"), 40),
  });
}

async function cmdStop(parsed) {
  rejectUnknown(parsed, ["dry-run"]);
  const run = requireRun(parsed.flags);
  const result = await stopRun(run, parsed.flags.dryRun);
  ok({
    command: "stop",
    run,
    ...result,
    hint: parsed.flags.dryRun
      ? "No process was signaled and state/ was left in place."
      : "Evidence and out/ were kept. state/ (cookies, Chrome profile, pids) was removed.",
  });
}

async function cmdBrowser(parsed) {
  const sub = parsed.positionals[1] || "help";
  const spec = BROWSER[sub];
  if (!spec) {
    fail(`Unknown browser command "${sub}".`, `Use one of: ${Object.keys(BROWSER).join(", ")}.`);
  }
  if (parsed.flags.help || sub === "help") {
    ok({ command: "browser", text: browserHelp() });
    return;
  }
  rejectUnknown(parsed, spec.flags);
  const run = requireRun(parsed.flags);
  const state = requireState(run);
  if ((sub === "click" && (parsed.kv.selector === "#submit" || parsed.kv.name === "Generate document")) || (sub === "press" && parsed.kv.key === "Enter")) {
    assertSpendAllowed(state, sub === "press" ? "Pressing Enter" : "Clicking Generate document");
  }
  const result = await spec.run(run, state, parsed.kv);
  ok({ command: `browser ${sub}`, run, ...result });
}

const BROWSER = {
  help: { flags: [], run: async () => ({}) },
  snapshot: {
    flags: [],
    async run(run, state) {
      const text = await withPage(state, async (cdp) => axLines(await axTree(cdp)));
      const file = path.join(run, "evidence", `snapshot-${nextId(run)}.txt`);
      fs.writeFileSync(file, text + "\n");
      return { snapshot: text, path: file };
    },
  },
  screenshot: {
    flags: ["path", "selector"],
    async run(run, state, kv) {
      const id = nextId(run);
      const evidenceFile = path.join(run, "evidence", `screenshot-${id}.png`);
      const shot = await withPage(state, async (cdp) => {
        if (kv.selector && kv.selector !== true) {
          await evaluate(cdp, `document.querySelector(${JSON.stringify(kv.selector)})?.scrollIntoView({ block: "center" })`);
        }
        return screenshot(cdp, evidenceFile);
      });
      let copy = null;
      if (kv.path && kv.path !== true) {
        const dest = path.resolve(kv.path);
        if (dest !== path.resolve(evidenceFile)) {
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.copyFileSync(evidenceFile, dest);
          copy = dest;
        }
      }
      return { ...shot, copy };
    },
  },
  click: {
    flags: ["selector", "role", "name"],
    async run(_run, state, kv) {
      const clicked = await withPage(state, (cdp) => clickTarget(cdp, kv));
      return { clicked };
    },
  },
  fill: {
    flags: ["selector", "value"],
    async run(_run, state, kv) {
      const filled = await withPage(state, (cdp) => fillTarget(cdp, kv));
      return { filled };
    },
  },
  press: {
    flags: ["key", "selector"],
    async run(_run, state, kv) {
      if (!kv.key || kv.key === true) fail("press needs --key.", `Use one of: ${Object.keys(KEYS).join(", ")}.`);
      await withPage(state, (cdp) => pressKey(cdp, String(kv.key), kv.selector && kv.selector !== true ? String(kv.selector) : ""));
      return { key: kv.key };
    },
  },
  eval: {
    flags: ["expression"],
    async run(_run, state, kv) {
      if (!kv.expression || kv.expression === true) {
        fail("eval needs --expression.", "Use it to read the DOM after a click or fill. Do not call the pipeline from here.");
      }
      const value = await withPage(state, (cdp) => evaluate(cdp, String(kv.expression)));
      return { value };
    },
  },
  console: {
    flags: [],
    async run(_run, state) {
      const entries = await withPage(state, (cdp) => evaluate(cdp, "window.__loomdocVerify?.console ?? []"));
      return { entries };
    },
  },
  network: {
    flags: [],
    async run(_run, state) {
      const entries = await withPage(state, (cdp) => evaluate(cdp, "window.__loomdocVerify?.network ?? []"));
      return { entries };
    },
  },
  wait: {
    flags: ["selector", "text", "timeout"],
    async run(_run, state, kv) {
      const timeout = Number(kv.timeout ?? 10000);
      if (!Number.isFinite(timeout) || timeout < 0) fail("--timeout must be a number of milliseconds.", "Example: browser wait --text \"Paste a Loom\" --timeout 5000");
      if (kv.selector && kv.selector !== true) {
        await waitFor(state, `Boolean(document.querySelector(${JSON.stringify(kv.selector)}))`, timeout, kv.selector);
        return { found: kv.selector };
      }
      if (kv.text && kv.text !== true) {
        await waitFor(state, `document.body.innerText.includes(${JSON.stringify(String(kv.text))})`, timeout, JSON.stringify(kv.text));
        return { found: kv.text };
      }
      fail("wait needs --selector or --text.", "Example: browser wait --text \"Paste a Loom or YouTube link.\"");
    },
  },
  open: {
    flags: ["url"],
    async run(_run, state, kv) {
      const target = kv.url;
      if (!target || target === true) fail("open needs --url.", "Pass a path on this loomdoc page, such as --url / .");
      let url;
      try {
        url = new URL(target, state.pageUrl);
      } catch {
        fail(`Could not parse "${target}".`, "Pass / or a full http://127.0.0.1:<port>/ URL for this run.");
      }
      const allowed = new Set([`127.0.0.1:${state.uiPort}`, `localhost:${state.uiPort}`]);
      if (!allowed.has(url.host)) {
        fail(
          `Refusing to open ${url.host}.`,
          "This Chrome profile only drives the loomdoc page started for this run.",
        );
      }
      if (url.searchParams.has("token")) {
        fail(
          "Refusing to open the private launch link again.",
          "That link works once and this run already spent it. Open / instead.",
        );
      }
      await withPage(state, (cdp) => cdp.send("Page.navigate", { url: url.toString() }));
      await waitFor(state, `document.readyState === "complete"`, 15000, "the page to load");
      return { url: url.toString() };
    },
  },
};

async function cmdHttp(parsed) {
  const method = (parsed.positionals[1] || "").toUpperCase();
  const urlPath = parsed.positionals[2];
  if (!["GET", "POST"].includes(method) || !urlPath) {
    fail("http needs get or post, then a path.", "Example: http get /api/config");
  }
  rejectUnknown(parsed, []);
  const run = requireRun(parsed.flags);
  const state = requireState(run);
  if (method === "POST" && urlPath === "/api/runs") assertSpendAllowed(state, "POST /api/runs");
  const body = parsed.positionals[3];
  if (method === "POST" && body) {
    try {
      JSON.parse(body);
    } catch {
      fail("The POST body is not JSON.", "Pass one JSON object as the next argument.");
    }
  }
  const id = nextId(run);
  const base = path.join(run, "evidence", `http-${id}`);
  fs.writeFileSync(`${base}.request`, `${method} ${urlPath}\n${body ?? ""}`);
  const value = await withPage(state, (cdp) => evaluate(cdp, `(() => {
    const token = document.querySelector('meta[name="loomdoc-token"]')?.content || "";
    const init = { method: ${JSON.stringify(method)}, headers: { "X-Loomdoc-Token": token } };
    ${method === "POST" ? `init.headers["Content-Type"] = "application/json"; init.body = ${JSON.stringify(body ?? "{}")};` : ""}
    return fetch(${JSON.stringify(urlPath)}, init).then(async (res) => ({ status: res.status, body: await res.text() }));
  })()`));
  fs.writeFileSync(`${base}.status`, String(value.status));
  fs.writeFileSync(`${base}.body`, value.body ?? "");
  ok({
    command: "http",
    run,
    id: `http-${id}`,
    method,
    path: urlPath,
    status: value.status,
    body: value.body,
    evidence: { request: `${base}.request`, status: `${base}.status`, body: `${base}.body` },
  });
}

function helpText() {
  return `control-loomdoc drives the loomdoc CLI and the local web page.

Every command prints one JSON object. ok: false means the command failed, and hint says what to do next.
--json is accepted and changes nothing. --help on a command prints this text for that command.

The private link printed by loomdoc ui works once. up opens it in a Chrome profile owned by this run.
Do not curl it and do not paste it into another browser.

Setup, from a clean checkout:
  node .cursor/skills/verify-loomdoc/control-loomdoc.mjs doctor
  node .cursor/skills/verify-loomdoc/control-loomdoc.mjs up --placeholder-key

Then export the run path from the JSON (shells do not keep it for you):
  export LOOMDOC_RUN=<run>

Commands:
  doctor                         Machine checks. With --run, also the page. Read-only.
  new                            Create an empty run directory.
  up [--placeholder-key]         Install deps if needed, start loomdoc ui, open the page.
                                 --dry-run prints the plan and starts nothing.
                                 --placeholder-key refuses to run when a real API key is set.
  cli -- <loomdoc args>          Run the CLI. Evidence is cli-NN.cmd, stdout, stderr, and exit.
  info                           Pids, port, and whether the page is usable.
  logs                           Tail of the ui and Chrome logs for this run.
  browser <command>              Drive the open page. Run browser --help.
  http get <path>                Authenticated GET from inside the page.
  http post <path> <json>        Authenticated POST from inside the page.
  stop                           Stop only the processes this run started. Keeps evidence/ and out/.
                                 --dry-run prints the pids and does not signal them.

A paid document needs the user to approve first. With a real key, cli generation, Generate document,
Enter, and POST /api/runs fail until LOOMDOC_VERIFY_ALLOW_SPEND=1.

Example, no spend:
  node .cursor/skills/verify-loomdoc/control-loomdoc.mjs cli -- --help
  node .cursor/skills/verify-loomdoc/control-loomdoc.mjs cli -- ${SAMPLE_URL} --formats markdown,html
  node .cursor/skills/verify-loomdoc/control-loomdoc.mjs browser click --role button --name "Generate document"
  node .cursor/skills/verify-loomdoc/control-loomdoc.mjs browser wait --text "Paste a Loom or YouTube link."
  node .cursor/skills/verify-loomdoc/control-loomdoc.mjs browser screenshot --path /tmp/loomdoc-form.png
`;
}

function browserHelp() {
  return `browser drives the Chrome window up started.

  browser snapshot
  browser screenshot [--selector <css>] [--path <file>]
  browser click --selector <css>
  browser click --role <role> --name <accessible name>
  browser fill --selector <css> --value <text>
  browser press --key Enter|Tab|Escape|Backspace|Space [--selector <css>]
  browser eval --expression <javascript>
  browser console
  browser network
  browser wait --selector <css> | --text <string> [--timeout <ms>]
  browser open --url <path>

click uses the DOM click on a real element. Prefer #url, #submit, and the preset radios.
fill types into a text field. On a select it sets the option value, because the menu is a browser widget.
eval is for reading after a user action. The request token is redacted from the JSON this command prints.
`;
}

const HANDLERS = {
  help: async () => ok({ command: "help", text: helpText() }),
  doctor: cmdDoctor,
  new: cmdNew,
  up: cmdUp,
  cli: cmdCli,
  info: cmdInfo,
  logs: cmdLogs,
  stop: cmdStop,
  cleanup: cmdStop,
  browser: cmdBrowser,
  http: cmdHttp,
};

try {
  const parsed = parseArgv(process.argv.slice(2));
  const name = parsed.positionals[0] || "help";
  if (!HANDLERS[name]) {
    fail(`Unknown command "${name}".`, `Use one of: ${Object.keys(HANDLERS).join(", ")}.`);
  }
  if (parsed.flags.help && name !== "browser") ok({ command: name, text: helpText() });
  else await HANDLERS[name](parsed);
} catch (err) {
  report(err);
}
