---
name: verify-loomdoc
description: "Drive loomdoc's CLI and local web page with control-loomdoc, and capture proof. Use after changing flags, setup checks, the page, or the generation pipeline, or whenever unit tests are not enough."
---

# Verify loomdoc

loomdoc has two surfaces. Both run from this repo.

- The CLI is `node --import tsx src/cli.ts`. It is short-lived. There is no server to keep.
- `loomdoc ui` serves one page on `127.0.0.1`. The private link works once, in one browser.

Drive both through `node .cursor/skills/verify-loomdoc/control-loomdoc.mjs`. Below, that command is `control-loomdoc`. It prints one JSON object. `ok: false` means the command failed, and `hint` says what to do next. Run `control-loomdoc --help` for the full command list.

Before driving a feature, read [`references/features/README.md`](references/features/README.md), then follow that feature's file.

## Money and keys

A generation calls Anthropic and spends the user's API credit. Ask the user before every paid run.

`up --placeholder-key` sets a fake `ANTHROPIC_API_KEY` on the UI process only. The setup check is presence-only, so the page can start, and the key cannot spend money. The command refuses to run when a real key is already set.

With a real key and without `LOOMDOC_VERIFY_ALLOW_SPEND=1`:

- `cli` will not spawn loomdoc when its first argument is not `doctor`, `ui`, or `--help`.
- A POST to `/api/runs` does not leave the browser. Chrome fails that request before the server sees it, whether a click, Enter in a field, `requestSubmit()`, or `eval` asked for it.
- `http post` refuses the same endpoint when the path's pathname, with a trailing slash removed, is `/api/runs`. That includes `/api/runs/`, `/api/runs?x=1`, and `//api/runs`.

The placeholder key does not enable the block, so the form checks and the missing-video run still reach the server. Set the spend flag only after the user approves. Never pass `--yes` or `-y`. Those flags install ffmpeg, yt-dlp, or Deno.

## Launch

From a clean checkout, with Node 22, ffmpeg, and Chrome or Chromium on `PATH`:

```bash
node .cursor/skills/verify-loomdoc/control-loomdoc.mjs doctor
node .cursor/skills/verify-loomdoc/control-loomdoc.mjs up --placeholder-key
```

`doctor` is read-only. It passes when the machine can host loomdoc, before `node_modules` exists. `up` runs `npm install` when `tsx` is missing, starts `loomdoc ui --no-open` on a free port, and opens the private link in a Chrome profile for this run.

Ready means the JSON says `"ready": true` and the page has the document-style radios. A listening port is not enough.

Export the `run` path before the next command. Each command is a new process.

```bash
export LOOMDOC_RUN=<run>
```

Use `export` in the same shell call as the command. An inline `LOOMDOC_RUN=<dir> cmd` prefix does not set the variable for later arguments in that call.

The run root is `${TMPDIR}/verify-loomdoc`, or `$LOOMDOC_VERIFY_ROOT`. Its basename must not start with `loomdoc-`. loomdoc deletes temp directories with that prefix.

Two runs can proceed side by side. Each has its own port, Chrome profile, and `out/` directory. Do not drive a `loomdoc ui` this run did not start.

## Doctor

Run `control-loomdoc doctor` first, and again whenever something looks wrong.

With no `LOOMDOC_RUN`, it checks Node, ffmpeg, and Chrome. `ready` is false until a page is up. `hint` names `up`.

With `LOOMDOC_RUN` pointing at a live page, `ready` is true only when the recorded pid owns the port, Chrome answers, the form is present, and `GET /api/config` returns 200. Read `instance.config.activeRunId`. A non-null value means a document is already being generated.

`control-loomdoc cli -- doctor` is the product's own setup check. It installs nothing here, because stdin is `/dev/null` and the helper never passes `--yes`.

## Drive

| Command | What it does |
| --- | --- |
| `up --placeholder-key` | Installs deps if needed, starts the page, opens it in Chrome. `--dry-run` starts nothing. |
| `cli -- <args>` | Runs loomdoc and saves `evidence/cli-NN.cmd`, `.stdout`, `.stderr`, and `.exit`. |
| `browser snapshot` | Writes the accessibility tree. |
| `browser screenshot --path <file>` | Full-page PNG, also kept under `evidence/`. |
| `browser click --role <role> --name <name>` | Clicks one element. A prefix matches when it hits one name. |
| `browser click --selector <css>` | Clicks `#url`, `#submit`, a preset radio, or a format checkbox. |
| `browser fill --selector <css> --value <text>` | Types into a text field. On a `select`, sets the option value. |
| `browser press --key Enter` | Enter, Tab, Escape, Backspace, or Space. |
| `browser wait --text <string>` | Waits until the visible page contains the string. |
| `browser eval --expression <js>` | Reads the DOM after a click or fill. |
| `browser console` / `browser network` | Console lines and `fetch` calls since the hook was installed. |
| `browser open --url /` | Reloads this run's page. Refuses the private launch link. |
| `http get <path>` / `http post <path> <json>` | Authenticated request from inside the page. |
| `info` / `logs` | Pids and port, or the server and Chrome logs. |
| `stop` | Stops the processes this run started. `--dry-run` only prints the pids. |

Stable handles: `#url`, `#guidance`, `#submit`, `#form-error`, `#presets`, `#notices`, `#progress`, `#log`, `#result`, `#files`, `#output-dir`, `input[name=preset]`, `input[name=formats]`, `select[name=pdfLayout]`, `select[name=effort]`.

Preset ids come from `src/core/generate/styles.ts`. Read the live list from `browser snapshot` or `/api/config`, not from memory.

`browser eval` is for reading. Do not call `runLoomdoc` or any other pipeline entry from it. The same rule covers the server's test-only `run` option.

## Evidence

Proof lives in `<run>/evidence/` and `<run>/out/`. `stop` keeps both.

- CLI proof is the command, stdout, stderr, and exit code.
- Page proof is an accessibility snapshot and a screenshot that show the action's result, plus `ui-server.log` when the server matters.
- A generation's proof is the progress text and the error or the written files. A progress line alone does not prove that a document was made.
- `http` proof is `evidence/http-NN.request`, `.status`, and `.body`.
- Record the feature id and the entry point with the artifacts.
- Report an unmet precondition, such as no key or no approval to spend, as not verified, with the command you tried.

## Cleanup

```bash
export LOOMDOC_RUN=<dir>
node .cursor/skills/verify-loomdoc/control-loomdoc.mjs stop
```

`stop` signals only the pid this run started, and any Chrome process whose command line contains this run's profile directory. It deletes `<run>/state/` and keeps `evidence/` and `out/`. Run it after every UI drive, including a failed one. Do not kill `node` or `chrome` by name.

After `stop`, confirm a screenshot or `cli-NN.stderr` is still in `evidence/`.

## Helpers

`control-loomdoc.mjs` is the only helper. It is executable and uses Node's built-in WebSocket, so it has no package of its own. `node .cursor/skills/verify-loomdoc/control-loomdoc.mjs --help` prints the command list.

## Maintenance

When the page or the CLI changes, update the feature file in the same change. `/maintain-verification-skill` is the pass that checks the map against the app.
