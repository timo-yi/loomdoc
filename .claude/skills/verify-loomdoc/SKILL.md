---
name: verify-loomdoc
description: Drive loomdoc the way a user does (the `loomdoc` CLI and the `loomdoc ui` local web page) and capture proof that a change works. Use after changing CLI flags, setup checks, the UI server or page, or the generation pipeline, or whenever you need evidence of loomdoc behavior beyond unit tests.
---

# Verify loomdoc

loomdoc has two user surfaces. Both run from this repo with no build step.

- **CLI** (primary): `loomdoc <loom-or-youtube-url> [options]`, `loomdoc doctor`, `loomdoc --help`. It is short-lived, with no server to keep alive.
- **Web UI**: `loomdoc ui` serves one page on `127.0.0.1` behind a single-use launch link, and runs the same pipeline.

All driving goes through `scripts/control-loomdoc`, which is in this skill's folder. It runs `node --import tsx src/cli.ts …` from the repo root, with stdin from `/dev/null`. With no TTY, preflight never prompts and never installs anything. Never pass `--yes` or `-y`, because they install ffmpeg, yt-dlp, or Deno on the user's machine.

Before driving a feature, read [`features/README.md`](features/README.md), then use the feature's own file as the recipe.

## Money and keys

- A full generation run calls Anthropic and costs roughly $0.10 to $0.20. Ask the user before every paid run, even when `ANTHROPIC_API_KEY` is set.
- Never ask the user to paste a key into chat. A real run needs the key exported in the shell that runs the helper.
- `start-ui --placeholder-key` sets a fake `ANTHROPIC_API_KEY`. It is verification scaffolding: it gets past the presence-only setup check so the UI can start, and nothing it does can spend money. A run that gets as far as the model fails with an auth error. The helper refuses it when a real key is already set.
- With a real key, the helper refuses `post /api/runs` unless `LOOMDOC_VERIFY_ALLOW_SPEND=1` is set. Set it only after the user approves.

## Launch

1. Make a run directory. All later commands find it through `LOOMDOC_RUN`. Shell state does not persist between tool calls, so start every Bash call with `export LOOMDOC_RUN=<dir>;`. Use `export`, not an inline `LOOMDOC_RUN=<dir> cmd` prefix, because recipes also expand `"$LOOMDOC_RUN"` in their arguments.

   ```bash
   .claude/skills/verify-loomdoc/scripts/control-loomdoc new
   # prints e.g. /var/folders/…/T/verify-loomdoc/20261027-202200-84946
   ```

   The root is `${TMPDIR}/verify-loomdoc`, or `$LOOMDOC_VERIFY_ROOT` when set. It must not start with `loomdoc-`, because loomdoc deletes temp-dir entries with that prefix that are more than 24h old.

2. **CLI features** need nothing more. Each drive is `export LOOMDOC_RUN=<dir>; control-loomdoc cli -- <loomdoc args>`. The base must already have `npm install` done (`node_modules/` exists).

3. **UI features**: start one instance per run directory.

   ```bash
   export LOOMDOC_RUN=<dir>; .claude/skills/verify-loomdoc/scripts/control-loomdoc start-ui --placeholder-key   # no-spend
   export LOOMDOC_RUN=<dir>; .claude/skills/verify-loomdoc/scripts/control-loomdoc start-ui                     # real key from env
   ```

   Ready means the private link `http://127.0.0.1:<port>/?token=<hex>` appeared in the server's stderr. The helper waits up to 60s for it. It prints `ready: pid …, port …, key: placeholder|real` and the launch URL. If the process exits first, it prints the server log and fails. The usual cause is a missing ffmpeg or a missing `ANTHROPIC_API_KEY` without `--placeholder-key`.

   The server listens on a random port (`--port 0`), writes documents to `<dir>/out`, and names its cookie after the port. Several instances can run side by side.

## Doctor

Run this first, and again whenever anything looks off.

```bash
export LOOMDOC_RUN=<dir>; .claude/skills/verify-loomdoc/scripts/control-loomdoc doctor
```

It checks that the recorded pid is alive and owns the listening port, then calls `GET /api/config` with the session. When healthy, it prints `session: valid; /api/config -> {…}`, including `defaults`, `notices`, and `activeRunId`. A non-null `activeRunId` means a run is in progress, so wait before posting another one.

For machine setup without a UI instance, `control-loomdoc cli -- doctor` lists ✓, ✗, and ! lines and exits 0 or 1. It is read-only here.

## Drive

| Command | What it does |
| --- | --- |
| `cli -- <args>` | Runs `loomdoc <args>` and saves `.cmd`, `.stdout`, `.stderr`, `.exit` as `evidence/cli-NN.*` |
| `login` | Spends the launch link: expects `303` and a session cookie, saves the page as `evidence/page.html` with the request token redacted |
| `get <path>` | Authenticated GET. SSE streams such as `/api/runs/<id>/events` return when the run ends |
| `post <path> [json]` | Authenticated POST with `X-Loomdoc-Token` and `Content-Type: application/json` |

Each `get` or `post` saves `evidence/http-NN.{request,status,headers,body}`.

**The launch link works once, in one client.** If `login` spends it, a browser that opens it gets the 401 "already been used" page, and the reverse is also true. To drive the page in a browser, don't run `login`. Open the printed launch URL in the browser, and use another run directory for any curl driving. In the page, use the stable handles: `#url` (Video link), the `#presets` radiogroup, `#guidance`, `input[name=formats]` checkboxes, `select[name=pdfLayout]`, `select[name=effort]`, `#submit` ("Generate document"), `#form-error` (role alert), `#progress`, `#result`, `#files`, `#output-dir`, `#preview`. The browser path has not been run by this skill's generator yet. Treat its first use as a check of these handles.

Preset ids change with `src/core/generate/styles.ts`. Read the live list from `/api/config` or `cli -- --help`, not from memory.

## Evidence

Everything under `<dir>/evidence/` and `<dir>/out/` is proof, and cleanup keeps both.

- CLI proof: the command, stdout, stderr, and exit code (`cli-NN.*`).
- UI proof: each request with its status and body (`http-NN.*`), plus `ui-server.log`.
- Generation proof: the run's own output (`Done. Wrote:` paths, or the SSE `done` event), a listing of `out/<slug>/` with `document.*` and `images/`, a read of `document.md` that matches the video, and a check that no `loomdoc-*` scratch dir is left in `$TMPDIR`. A progress line alone does not prove that a document was made.
- Exercise the user path: `src/cli.ts` or the HTTP routes the page calls. Do not call `runLoomdoc` or the server's injected `run` option. Those are test seams.
- Report an unmet precondition, such as no key, no URL, or the user declining spend, as **not verified**, with the command you tried. Never report it as passed through some other path.

## Cleanup

```bash
export LOOMDOC_RUN=<dir>; .claude/skills/verify-loomdoc/scripts/control-loomdoc stop
```

`stop` kills only the pid this run started (TERM, then KILL after 5s) and deletes `<dir>/state/`, which holds the cookies, tokens, and pid. It keeps `evidence/` and `out/` and prints where they are. Run it after every UI drive, including failed ones. Never kill `node` or `tsx` by name, because the user may have their own `loomdoc ui` running.

## Helpers

- `scripts/control-loomdoc`: the only helper. It is executable. Run it with no arguments to see its usage.
