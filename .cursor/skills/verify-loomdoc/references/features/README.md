# loomdoc feature map

This directory is the maintained source for verifying loomdoc. Read this index before driving the app, then use the matching feature file as the recipe.

`control-loomdoc` means `node .cursor/skills/verify-loomdoc/control-loomdoc.mjs`. Run it from the repo root. For every command after `up` or `new`, the same shell call starts with `export LOOMDOC_RUN=<dir>;`.

## Baseline preconditions

- Node 22, ffmpeg, and Chrome or Chromium are on `PATH`. `control-loomdoc doctor` exits 0 and names anything missing.
- `up --placeholder-key` has been run for a UI feature. It installs npm dependencies when `tsx` is missing and opens the page.
- UI features run against that page only. Do not attach to a `loomdoc ui` the user started.
- A paid run needs `ANTHROPIC_API_KEY`, a public or unlisted video that has a transcript, and the user's approval. This map's no-spend paths do not need those.

## Driving conventions

- Treat every command as literal. Keep quoted values and flags unchanged.
- Never pass `--yes` or `-y`.
- Prefer the accessibility name from `browser snapshot`. Use a CSS selector when the name is the long preset card text and a short prefix is ambiguous.
- `browser fill` types into text fields. For a `select`, it sets the option value, because the menu is a browser widget.
- Run `control-loomdoc stop` after every UI drive, including a failed one. `stop` keeps `evidence/` and `out/`.

## Proof and skip reporting

- CLI proof includes the command, stdout, stderr, and exit code.
- Page proof includes the action and the resulting alert, progress text, or file list. Capture a snapshot or a screenshot of that state.
- Generation proof includes the files written, or the error the page shows, not only a progress line.
- Record the feature id and the entry point with each result.
- Report an unreachable path with the command you tried and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.

## Features

- [Setup doctor](doctor.md). `loomdoc doctor` and the per-run check. They report what is missing and install nothing without consent.
- [CLI flag validation](cli-validation.md). Bad `--formats`, `--preset`, `--effort`, and `--pdf-layout` values fail before setup checks or spend.
- [UI session](ui-session.md). `loomdoc ui` starts, the private link is spent by this run's Chrome, and the form loads.
- [UI form](ui-form.md). Document style, guidance, audience, output options, and the errors the page shows before it starts a run.
- [UI runs](ui-runs.md). Submit starts one run, streams progress, shows the failure, and releases the slot.
- [Generate a document](generate.md). A paid run from a video link to Markdown, Word, and PDF.

## Entry contract

Each feature file uses these four headings, in order.

1. `Sub-features`
2. `How to get to it (user POV)`
3. `Driving it with control-loomdoc`
4. `Gotchas`
