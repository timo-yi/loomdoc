# CLI flag validation

loomdoc rejects a bad option value with a message that lists the valid choices. It does this before setup checks, downloads, or model calls, so a typo costs nothing.

## Sub-features

- `flags-help` prints usage on `--help` and exits 0. With no URL, it prints usage and exits 1.
- `flags-formats` rejects an unknown `--formats` entry.
- `flags-preset` rejects an unknown `--preset`, and redirects the retired `training` preset.
- `flags-custom` requires `--guidance` with `--preset custom`.
- `flags-effort` rejects an unknown `--effort`.
- `flags-pdf-layout` rejects an unknown `--pdf-layout`.

## How to get to it (user POV)

- Run `loomdoc <url> <flags>` in a terminal.
- Run `npm run dev -- <url> <flags>` from the repo. This is the same entry point.

## Driving it with control-loomdoc

Preconditions:

- A run directory exists (`control-loomdoc new`).
- No API key or network is needed. Use any well-formed Loom URL, such as `https://www.loom.com/share/abcdef0123456789abcdef0123456789`.

- **Help.** Run `control-loomdoc cli -- --help`. Exit `0`, and stdout starts with `loomdoc – turn a Loom or YouTube walkthrough`.
- **Formats.** Run `control-loomdoc cli -- <url> --formats markdown,html`. Exit `1`, and stderr contains `Unknown --formats "html". Choose from: markdown, docx, pdf.`
- **Retired preset.** Run `control-loomdoc cli -- <url> --preset training`. Exit `1`, and stderr contains `--preset training was replaced by --preset tutorial`.
- **Custom without guidance.** Run `control-loomdoc cli -- <url> --preset custom`. Exit `1`, and stderr contains `--preset custom needs --guidance`.
- **Effort.** Run `control-loomdoc cli -- <url> --effort turbo`. Exit `1`, and stderr contains `Unknown --effort "turbo". Choose one of: low, medium, high, xhigh, max.`
- **PDF layout.** Run `control-loomdoc cli -- <url> --pdf-layout a4`. Exit `1`, and stderr contains `Unknown --pdf-layout "a4". Choose one of: pageless, paged.`
- **Proof.** Each case's `evidence/cli-NN.stderr` holds the error, and it has no `✓`, `✗`, or `!` preflight lines. That shows the run failed before setup checks.

## Gotchas

- An unknown `--preset` lists the ids from `src/core/generate/styles.ts`. Compare the output with that file, not with an old copy.
- A valid flag set with no `ANTHROPIC_API_KEY` fails in preflight (`ANTHROPIC_API_KEY is not set`). That is the doctor feature, not a validation failure.
