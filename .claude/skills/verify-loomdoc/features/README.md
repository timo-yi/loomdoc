# loomdoc verification map

This directory is the maintained source for verifying loomdoc's user-facing behavior. Read this index before driving the app, then use the matching feature file as the recipe. `control-loomdoc` means `.claude/skills/verify-loomdoc/scripts/control-loomdoc`, run from the repo root in a Bash call that starts with `export LOOMDOC_RUN=<dir>;`.

## Baseline preconditions

- The repo has `node_modules/` installed and `npm run typecheck` passes.
- `ffmpeg` is on `PATH`. loomdoc's preflight blocks every run and every UI launch without it.
- Each verification uses a fresh run directory from `control-loomdoc new`.
- UI features run against an instance started by this run (`start-ui`), never one that the user started.
- A paid run needs `ANTHROPIC_API_KEY` exported, a public or unlisted video that has a transcript, and the user's approval for that run.

## Driving conventions

- Treat every command as literal. Keep quoted values and flags unchanged.
- Never pass `--yes` or `-y`, because they install software.
- Use `start-ui --placeholder-key` for every UI feature that should spend nothing.
- Spend the launch link in exactly one client.
- Run `control-loomdoc stop` after every UI drive, including failed ones.

## Proof and skip reporting

- CLI proof includes the command, stdout, stderr, and exit code.
- UI proof includes each request with its status and body.
- Generation proof includes the files written and a read of the document, not only progress lines.
- Record the feature ID and entry point with each result.
- Report an unreachable path with the command you tried and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.

## Features

- [CLI flag validation](./cli-validation.md): bad `--formats`, `--preset`, `--effort`, and `--pdf-layout` values fail before setup checks or spend.
- [Setup doctor](./doctor.md): `loomdoc doctor` and per-run preflight report what is missing and install nothing without consent.
- [UI session](./ui-session.md): `loomdoc ui` launch, the single-use link, the session cookie, and the 401 pages.
- [UI runs](./ui-runs.md): submit validation, the single run slot, the SSE progress stream, and output file serving.
- [Generate a document](./generate.md): a full paid run from a video link to Markdown, Word, and PDF, from the CLI or the UI.
