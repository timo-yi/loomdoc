/**
 * The local UI's page, stylesheet, and script (PRD decision D17).
 *
 * Kept as strings in a module so they ship inside the compiled package with no bundler or
 * asset-copy step. Script and style are served as separate same-origin files so the page can
 * run under a strict Content-Security-Policy with no inline code. The script uses no framework
 * and builds all dynamic content with DOM APIs and textContent, never innerHTML.
 */

export function pageHtml(token: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="loomdoc-token" content="${token}">
<title>loomdoc</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/app.css">
<script src="/app.js" defer></script>
</head>
<body>
<main>
  <header class="masthead">
    <h1>loomdoc</h1>
    <p class="lede">Turn a Loom or YouTube walkthrough into a finished, screenshot-rich document.</p>
  </header>

  <div id="notices" class="notices" hidden></div>

  <form id="run-form" novalidate>
    <section class="field">
      <label for="url" class="label">Video link</label>
      <input id="url" name="url" type="url" required autocomplete="off" spellcheck="false"
        placeholder="https://www.loom.com/share/… or https://www.youtube.com/watch?v=…">
    </section>

    <fieldset class="field">
      <legend class="label">Document style</legend>
      <div id="presets" class="presets" role="radiogroup"></div>
    </fieldset>

    <section class="field">
      <label for="guidance" class="label">Guidance for the AI <span id="guidance-optional" class="muted">(optional)</span></label>
      <textarea id="guidance" name="guidance" rows="4" maxlength="4000"
        placeholder="For example: The prospect is a mid-size logistics company worried about onboarding time. Emphasize the reporting dashboard and skip the billing settings."></textarea>
      <p id="guidance-hint" class="hint">Anything the AI should know or do: who it is for, what to emphasize or skip, tone, terminology.</p>
    </section>

    <details class="field group">
      <summary>Audience and context <span class="muted">(optional, inferred from the video if blank)</span></summary>
      <div class="grid">
        <label>Audience<input name="audience" maxlength="300" placeholder="e.g. new support agents"></label>
        <label>Their role<input name="role" maxlength="300" placeholder="e.g. operations manager"></label>
        <label>Industry<input name="industry" maxlength="300" placeholder="e.g. logistics"></label>
        <label>Use case<input name="useCase" maxlength="300" placeholder="e.g. weekly reporting"></label>
      </div>
    </details>

    <details class="field group">
      <summary>Output options</summary>
      <div class="formats" role="group" aria-label="Formats">
        <label class="check"><input type="checkbox" name="formats" value="markdown"> Markdown</label>
        <label class="check"><input type="checkbox" name="formats" value="docx"> Word (.docx)</label>
        <label class="check"><input type="checkbox" name="formats" value="pdf"> PDF</label>
      </div>
      <div class="grid">
        <label>Model<input name="model" maxlength="100" spellcheck="false"></label>
        <label>Effort
          <select name="effort">
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="xhigh">Extra high</option>
            <option value="max">Max</option>
          </select>
        </label>
      </div>
    </details>

    <div class="actions">
      <button id="submit" type="submit" class="primary">Generate document</button>
      <p id="form-error" class="error" role="alert" hidden></p>
    </div>
  </form>

  <section id="progress" class="panel" hidden aria-live="polite">
    <div class="panel-head">
      <h2>Generating</h2>
      <span id="elapsed" class="muted"></span>
    </div>
    <ol id="stages" class="stages"></ol>
    <ul id="log" class="log"></ul>
  </section>

  <section id="result" class="panel" hidden>
    <div class="panel-head">
      <h2>Done</h2>
      <button id="new-run" type="button" class="secondary">Make another</button>
    </div>
    <div id="files" class="files"></div>
    <p class="path"><span class="muted">Saved to</span> <code id="output-dir"></code> <button id="reveal" type="button" class="link">Show in folder</button></p>
    <article id="preview" class="preview"></article>
  </section>
</main>
</body>
</html>
`;
}

const UNAUTHORIZED_REASONS = {
  missing:
    "This page needs the private link printed in the terminal where you ran <code>loomdoc ui</code>. " +
    "Open that link (it changes every time loomdoc ui starts).",
  invalid:
    "That link doesn't match this loomdoc session. Open the link printed in the terminal where you ran " +
    "<code>loomdoc ui</code> (it changes every time loomdoc ui starts).",
  used:
    "That link has already been used, and each link works only once. If you opened it in another browser, " +
    "stop loomdoc ui in the terminal (Ctrl-C) and start it again to get a new link.",
} as const;

export function unauthorizedHtml(reason: keyof typeof UNAUTHORIZED_REASONS): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>loomdoc</title><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/app.css"></head>
<body><main><header class="masthead"><h1>loomdoc</h1></header>
<p class="lede">${UNAUTHORIZED_REASONS[reason]}</p></main></body></html>
`;
}

export const APP_CSS = `
:root {
  --bg: #f7f7f5;
  --surface: #ffffff;
  --text: #1c1c1a;
  --muted: #6b6b66;
  --border: #deded9;
  --accent: #4f46e5;
  --accent-text: #ffffff;
  --accent-soft: #eef0ff;
  --ok: #15803d;
  --warn-bg: #fff7e6;
  --warn-border: #f0c36d;
  --error: #b42318;
  --error-bg: #fdecea;
  --radius: 10px;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #151514;
    --surface: #1f1f1d;
    --text: #ececea;
    --muted: #a3a39d;
    --border: #353532;
    --accent: #8b87ff;
    --accent-text: #11111a;
    --accent-soft: #26264a;
    --ok: #4ade80;
    --warn-bg: #3a2f17;
    --warn-border: #8a6a2a;
    --error: #ff8a80;
    --error-bg: #3b1d1b;
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 16px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
main { max-width: 760px; margin: 0 auto; padding: 40px 16px 80px; }
h1 { font-size: 1.6rem; margin: 0; letter-spacing: -0.01em; }
h2 { font-size: 1.2rem; margin: 0; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.9em; overflow-wrap: anywhere; }
.masthead { margin-bottom: 28px; }
.lede { color: var(--muted); margin: 6px 0 0; }
.muted { color: var(--muted); font-weight: 400; }
.hint { color: var(--muted); font-size: 0.875rem; margin: 6px 0 0; }
.field { margin: 0 0 22px; padding: 0; border: 0; min-width: 0; }
.label, summary { display: block; font-weight: 600; margin-bottom: 8px; }
input, select, textarea {
  width: 100%;
  font: inherit;
  color: inherit;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
}
textarea { resize: vertical; min-height: 96px; }
input:focus, select:focus, textarea:focus, button:focus-visible, .preset:focus-within {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.presets { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
@media (max-width: 560px) { .presets { grid-template-columns: 1fr; } }
.preset {
  display: block;
  position: relative;
  padding: 12px 14px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer;
}
.preset input { position: absolute; opacity: 0; width: 1px; height: 1px; }
.preset .name { display: block; font-weight: 600; }
.preset .summary { display: block; color: var(--muted); font-size: 0.875rem; margin-top: 2px; }
.preset.selected { border-color: var(--accent); background: var(--accent-soft); }
.group { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 12px 14px; }
.group summary { cursor: pointer; margin: 0; }
.group[open] summary { margin-bottom: 12px; }
.grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
@media (max-width: 560px) { .grid { grid-template-columns: 1fr; } }
.grid label { font-size: 0.875rem; color: var(--muted); }
.grid input, .grid select { margin-top: 4px; }
.formats { display: flex; flex-wrap: wrap; gap: 8px 18px; margin-bottom: 12px; }
.check { display: inline-flex; align-items: center; gap: 6px; }
.check input { width: auto; }
.actions { display: flex; flex-direction: column; gap: 10px; }
button { font: inherit; cursor: pointer; border-radius: 8px; }
button.primary {
  align-self: flex-start;
  background: var(--accent);
  color: var(--accent-text);
  border: 0;
  padding: 11px 20px;
  font-weight: 600;
}
button.secondary { background: transparent; color: var(--text); border: 1px solid var(--border); padding: 6px 12px; }
button.link { background: none; border: 0; padding: 0; color: var(--accent); text-decoration: underline; }
button:disabled { opacity: 0.55; cursor: not-allowed; }
.error { color: var(--error); background: var(--error-bg); border-radius: 8px; padding: 10px 12px; margin: 0; white-space: pre-wrap; }
.notices { background: var(--warn-bg); border: 1px solid var(--warn-border); border-radius: var(--radius); padding: 12px 14px; margin-bottom: 22px; font-size: 0.925rem; }
.notices p { margin: 0; }
.notices p + p { margin-top: 6px; }
.panel { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 18px; margin-top: 8px; }
.panel-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 14px; }
.stages { list-style: none; margin: 0 0 12px; padding: 0; display: grid; gap: 6px; }
.stages li { display: flex; align-items: center; gap: 10px; color: var(--muted); }
.stages li::before {
  content: "";
  width: 10px; height: 10px; border-radius: 50%;
  border: 2px solid var(--border);
  flex: none;
}
.stages li.active { color: var(--text); font-weight: 600; }
.stages li.active::before { border-color: var(--accent); background: var(--accent); animation: pulse 1.2s ease-in-out infinite; }
.stages li.done { color: var(--text); }
.stages li.done::before { border-color: var(--ok); background: var(--ok); }
.stages li.failed::before { border-color: var(--error); background: var(--error); }
@keyframes pulse { 50% { opacity: 0.35; } }
@media (prefers-reduced-motion: reduce) { .stages li.active::before { animation: none; } }
.log { list-style: none; margin: 0; padding: 12px 0 0; border-top: 1px solid var(--border); font-size: 0.875rem; color: var(--muted); display: grid; gap: 4px; }
.log .t { font-variant-numeric: tabular-nums; margin-right: 8px; }
.files { display: flex; flex-wrap: wrap; gap: 8px; }
.files a {
  display: inline-block; padding: 8px 14px; border-radius: 8px;
  background: var(--accent); color: var(--accent-text); text-decoration: none; font-weight: 600;
}
.path { font-size: 0.875rem; margin: 12px 0 0; }
.preview { margin-top: 22px; padding-top: 18px; border-top: 1px solid var(--border); }
.preview h3 { font-size: 1.35rem; margin: 0 0 8px; }
.preview h4 { font-size: 1.05rem; margin: 24px 0 6px; }
.preview .aud { color: var(--muted); font-size: 0.875rem; margin: 0 0 12px; }
.preview p { margin: 0 0 10px; }
.preview ul, .preview ol { margin: 0 0 10px; padding-left: 22px; }
.preview figure { margin: 10px 0 0; }
.preview img { display: block; max-width: 100%; height: auto; border: 1px solid var(--border); border-radius: 8px; }
.preview figcaption { color: var(--muted); font-size: 0.85rem; margin-top: 6px; }
.badge { display: inline-block; font-size: 0.75rem; font-weight: 600; color: var(--muted); border: 1px solid var(--border); border-radius: 999px; padding: 1px 8px; margin-left: 8px; vertical-align: middle; }
[hidden] { display: none !important; }
`;

export const APP_JS = `
"use strict";
(function () {
  var token = document.querySelector('meta[name="loomdoc-token"]').getAttribute("content");
  var STAGES = [
    ["ingest", "Download the video and transcript"],
    ["frames", "Pick the distinct screens"],
    ["generate", "Write the document"],
    ["render", "Save the files"]
  ];
  var PREF_KEY = "loomdoc.prefs";

  var $ = function (id) { return document.getElementById(id); };
  var form = $("run-form");
  var presetsBox = $("presets");
  var submit = $("submit");
  var formError = $("form-error");
  var config = null;
  var timer = null;
  var currentRun = null;

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function loadPrefs() {
    try { return JSON.parse(localStorage.getItem(PREF_KEY) || "{}") || {}; } catch (e) { return {}; }
  }
  function savePrefs(p) {
    try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch (e) { /* ignore */ }
  }

  function selectedPreset() {
    var checked = presetsBox.querySelector("input:checked");
    return checked ? checked.value : "how-to";
  }

  function renderPresets(presets, current) {
    presetsBox.textContent = "";
    presets.forEach(function (p) {
      var label = el("label", "preset");
      var input = document.createElement("input");
      input.type = "radio";
      input.name = "preset";
      input.value = p.id;
      input.checked = p.id === current;
      label.appendChild(input);
      label.appendChild(el("span", "name", p.label));
      label.appendChild(el("span", "summary", p.summary));
      presetsBox.appendChild(label);
    });
    syncPresetUi();
  }

  function syncPresetUi() {
    presetsBox.querySelectorAll(".preset").forEach(function (label) {
      label.classList.toggle("selected", label.querySelector("input").checked);
    });
    var custom = selectedPreset() === "custom";
    $("guidance-optional").textContent = custom ? "(required for Custom)" : "(optional)";
    $("guidance-hint").textContent = custom
      ? "Describe the document you want: its purpose, who reads it, how it should be structured, and the tone."
      : "Anything the AI should know or do: who it is for, what to emphasize or skip, tone, terminology.";
  }

  function showNotices(notices) {
    var box = $("notices");
    box.textContent = "";
    notices.forEach(function (n) { box.appendChild(el("p", null, n)); });
    box.hidden = notices.length === 0;
  }

  function setBusy(busy) {
    Array.prototype.forEach.call(form.elements, function (f) { f.disabled = busy; });
  }

  function showError(message) {
    formError.textContent = message;
    formError.hidden = !message;
  }

  function collect() {
    var data = new FormData(form);
    var body = {
      url: String(data.get("url") || "").trim(),
      preset: selectedPreset(),
      guidance: String(data.get("guidance") || ""),
      audience: String(data.get("audience") || ""),
      role: String(data.get("role") || ""),
      industry: String(data.get("industry") || ""),
      useCase: String(data.get("useCase") || ""),
      formats: data.getAll("formats").map(String),
      model: String(data.get("model") || "").trim(),
      effort: String(data.get("effort") || "medium")
    };
    return body;
  }

  function validate(body) {
    if (!body.url) return "Paste a Loom or YouTube link.";
    if (!/^https?:\\/\\//i.test(body.url) && !/^(www\\.)?(loom\\.com|youtube\\.com|youtu\\.be)\\//i.test(body.url)) {
      return "That doesn't look like a link. Paste the full Loom or YouTube URL.";
    }
    if (body.formats.length === 0) return "Pick at least one output format.";
    if (body.preset === "custom" && !body.guidance.trim()) return "The Custom style needs guidance describing the document you want.";
    return "";
  }

  function fmtElapsed(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var m = Math.floor(s / 60);
    s = s % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function resetProgress() {
    var stages = $("stages");
    stages.textContent = "";
    STAGES.forEach(function (s) {
      var li = el("li", null, s[1]);
      li.dataset.stage = s[0];
      stages.appendChild(li);
    });
    $("log").textContent = "";
    $("elapsed").textContent = "";
  }

  function markStage(stage, state) {
    var reached = false;
    $("stages").querySelectorAll("li").forEach(function (li) {
      if (li.dataset.stage === stage) {
        reached = true;
        li.className = state;
      } else if (!reached && state !== "failed") {
        li.className = "done";
      }
    });
  }

  function follow(runId) {
    currentRun = { id: runId, started: null };
    $("result").hidden = true;
    $("progress").hidden = false;
    resetProgress();
    setBusy(true);
    var source = new EventSource("/api/runs/" + runId + "/events");
    var lastStage = "ingest";
    // The server replays the whole run on every (re)connection; skip events already shown.
    var seen = 0;
    var index = 0;
    source.onopen = function () { index = 0; };
    source.onmessage = function (msg) {
      index += 1;
      if (index <= seen) return;
      seen = index;
      var event = JSON.parse(msg.data);
      if (currentRun.started === null) {
        currentRun.started = event.at;
        clearInterval(timer);
        timer = setInterval(function () { $("elapsed").textContent = fmtElapsed(Date.now() - currentRun.started); }, 1000);
      }
      if (event.type === "progress") {
        lastStage = event.stage;
        markStage(event.stage, "active");
        var li = el("li");
        li.appendChild(el("span", "t", fmtElapsed(event.at - currentRun.started)));
        li.appendChild(document.createTextNode(event.message));
        $("log").appendChild(li);
      } else if (event.type === "done") {
        source.close();
        finish();
        STAGES.forEach(function (s) { markStage(s[0], "done"); });
        showResult(runId, event.result);
      } else if (event.type === "error") {
        source.close();
        finish();
        markStage(lastStage, "failed");
        showError(event.message);
      }
    };
    source.onerror = function () {
      // The client closes the stream itself on the final event, so any error before that means
      // the loomdoc process stopped (Ctrl-C, terminal closed). Stop here rather than letting the
      // browser retry forever behind a disabled form.
      if (currentRun && !currentRun.finished) {
        source.close();
        finish();
        showError("Lost connection to loomdoc. Is it still running in your terminal? If you restarted it, open the new link it printed.");
      }
    };
  }

  function finish() {
    clearInterval(timer);
    if (currentRun) currentRun.finished = true;
    setBusy(false);
  }

  var FILE_LABELS = { ".md": "Markdown", ".docx": "Word", ".pdf": "PDF" };

  function showResult(runId, result) {
    $("progress").hidden = true;
    $("result").hidden = false;
    var files = $("files");
    files.textContent = "";
    result.files.forEach(function (f) {
      var ext = f.name.slice(f.name.lastIndexOf("."));
      var a = el("a", null, "Open " + (FILE_LABELS[ext] || f.name));
      a.href = f.href;
      a.target = "_blank";
      a.rel = "noopener";
      files.appendChild(a);
    });
    $("output-dir").textContent = result.outputDir;
    $("reveal").onclick = function () { post("/api/runs/" + runId + "/reveal", {}).catch(function () {}); };
    renderPreview(result);
    $("result").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Minimal, safe rendering of the model's plain text: paragraphs, "-" / "1." lists, **bold**.
  // Consecutive list lines become one list; other consecutive lines become one paragraph.
  var BULLET = /^\\s*[-*]\\s+/;
  var NUMBERED = /^\\s*\\d+[.)]\\s+/;
  function appendRich(parent, text) {
    var group = null;
    function flush() {
      if (!group) return;
      if (group.kind === "p") {
        var p = el("p");
        inline(p, group.lines.join(" "));
        parent.appendChild(p);
      } else {
        var list = el(group.kind);
        group.lines.forEach(function (l) {
          var li = el("li");
          inline(li, l);
          list.appendChild(li);
        });
        parent.appendChild(list);
      }
      group = null;
    }
    String(text || "").split("\\n").forEach(function (line) {
      if (line.trim() === "") { flush(); return; }
      var kind = BULLET.test(line) ? "ul" : NUMBERED.test(line) ? "ol" : "p";
      var content = kind === "p" ? line.trim() : line.replace(kind === "ul" ? BULLET : NUMBERED, "");
      if (!group || group.kind !== kind) { flush(); group = { kind: kind, lines: [] }; }
      group.lines.push(content);
    });
    flush();
  }
  function inline(parent, text) {
    text.split(/(\\*\\*[^*]+\\*\\*)/).forEach(function (part) {
      if (/^\\*\\*[^*]+\\*\\*$/.test(part)) parent.appendChild(el("strong", null, part.slice(2, -2)));
      else if (part) parent.appendChild(document.createTextNode(part));
    });
  }

  function renderPreview(result) {
    var preview = $("preview");
    preview.textContent = "";
    preview.appendChild(el("h3", null, result.title));
    if (result.audience) preview.appendChild(el("p", "aud", "For: " + result.audience));
    appendRich(preview, result.overview);
    result.steps.forEach(function (s, i) {
      var h = el("h4", null, (i + 1) + ". " + s.heading);
      if (s.needsDeeperReasoning) h.appendChild(el("span", "badge", "check this step"));
      preview.appendChild(h);
      appendRich(preview, s.body);
      if (s.screenshot) {
        var fig = el("figure");
        var img = el("img");
        img.src = s.screenshot.href;
        img.alt = s.screenshot.caption || s.heading;
        img.loading = "lazy";
        fig.appendChild(img);
        if (s.screenshot.caption) fig.appendChild(el("figcaption", null, s.screenshot.caption));
        preview.appendChild(fig);
      }
    });
  }

  function post(path, body) {
    return fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Loomdoc-Token": token },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (json) {
        if (!res.ok) throw new Error(json.error || ("Request failed (" + res.status + ")"));
        return json;
      });
    });
  }

  presetsBox.addEventListener("change", syncPresetUi);

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    showError("");
    var body = collect();
    var problem = validate(body);
    if (problem) { showError(problem); return; }
    savePrefs({ preset: body.preset, formats: body.formats, model: body.model, effort: body.effort });
    setBusy(true);
    post("/api/runs", body).then(function (json) {
      follow(json.id);
    }).catch(function (err) {
      setBusy(false);
      showError(err.message);
    });
  });

  $("new-run").addEventListener("click", function () {
    $("result").hidden = true;
    $("url").value = "";
    $("url").focus();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  fetch("/api/config").then(function (r) {
    if (!r.ok) throw new Error("Could not load settings (" + r.status + ")");
    return r.json();
  }).then(function (cfg) {
    config = cfg;
    var prefs = loadPrefs();
    renderPresets(cfg.presets, prefs.preset || "how-to");
    var formats = prefs.formats || cfg.defaults.formats;
    form.querySelectorAll('input[name="formats"]').forEach(function (c) { c.checked = formats.indexOf(c.value) !== -1; });
    form.elements.model.value = prefs.model || cfg.defaults.model;
    form.elements.effort.value = prefs.effort || cfg.defaults.effort;
    showNotices(cfg.notices || []);
    if (cfg.activeRunId) follow(cfg.activeRunId);
  }).catch(function (err) {
    showError(err.message);
  });
})();
`;

export const FAVICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#4f46e5"/>' +
  '<path d="M9 7h9l5 5v13H9z" fill="#fff"/><path d="M18 7v5h5" fill="#c7c4ff"/>' +
  '<path d="M12 16h8M12 19.5h8M12 23h5" stroke="#4f46e5" stroke-width="1.6" stroke-linecap="round"/></svg>';
