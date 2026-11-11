# CLI flag validation

loomdoc rejects a bad option before setup checks, downloads, or model calls. The message names the valid choices.

## Sub-features

- `flags-help` prints usage for `--help` and exits 0. With no URL, it prints usage and exits 1.
- `flags-formats` rejects an unknown `--formats` entry.
- `flags-preset` rejects an unknown `--preset`, and names the replacement for the retired `training` preset.
- `flags-custom` requires `--guidance` with `--preset custom`.
- `flags-effort` rejects an unknown `--effort`.
- `flags-pdf-layout` rejects an unknown `--pdf-layout`.

## How to get to it (user POV)

- Run `loomdoc <url> <flags>` in a terminal.
- From the repo, `npm run dev -- <url> <flags>` is the same entry point.

## Driving it with control-loomdoc

Preconditions:

- A run directory exists.
- No API key is required. Use `https://www.loom.com/share/abcdef0123456789abcdef0123456789` as `<url>`.

- **Help.** Run `control-loomdoc cli -- --help`. The exit code is 0. stdout starts with `loomdoc` and `turn a Loom or YouTube walkthrough`.
- **Formats.** Run `control-loomdoc cli -- <url> --formats markdown,html`. The exit code is 1. stderr contains `Unknown --formats "html". Choose from: markdown, docx, pdf.`
- **Retired preset.** Run `control-loomdoc cli -- <url> --preset training`. The exit code is 1. stderr contains `--preset training was replaced by --preset tutorial`.
- **Custom without guidance.** Run `control-loomdoc cli -- <url> --preset custom`. The exit code is 1. stderr contains `--preset custom needs --guidance`.
- **Effort.** Run `control-loomdoc cli -- <url> --effort turbo`. The exit code is 1. stderr contains `Unknown --effort "turbo". Choose one of: low, medium, high, xhigh, max.`
- **PDF layout.** Run `control-loomdoc cli -- <url> --pdf-layout a4`. The exit code is 1. stderr contains `Unknown --pdf-layout "a4". Choose one of: pageless, paged.`
- **Proof.** Each `evidence/cli-NN.stderr` holds the error and has no setup check marks. The run failed before the setup check.

## Gotchas

- An unknown `--preset` lists the ids from `src/core/generate/styles.ts`. Compare the output with that file.
- A valid flag set with no `ANTHROPIC_API_KEY` fails in the setup check. That is [Setup doctor](doctor.md), not a validation failure.
- With a real `ANTHROPIC_API_KEY` set, the helper refuses a command that would generate a document unless `LOOMDOC_VERIFY_ALLOW_SPEND=1`. Flag checks do not need the key, so unset it for this feature.
