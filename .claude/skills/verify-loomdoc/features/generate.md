# Generate a document

The core job. Given a Loom or YouTube link, loomdoc fetches the transcript, downloads the video to a temp dir, picks distinct screenshots, has the vision model write the document, and renders it to Markdown, Word, and PDF under `out/<video-title>/`. The temp dir is gone afterward.

## Sub-features

- `gen-loom-cli` runs a Loom link from the CLI and prints `Done. Wrote:` with each file.
- `gen-youtube-cli` runs a YouTube link from the CLI. It also needs yt-dlp and Deno.
- `gen-formats` writes only the requested `--formats`.
- `gen-pdf-layout` makes one tall page for `pageless` (the default), or Letter pages for `paged`.
- `gen-preset` follows the requested `--preset` and `--guidance`.
- `gen-ui` runs from the page, with live progress, file links, a preview, and `/files/<id>/…` downloads.
- `gen-scratch-cleanup` leaves no `loomdoc-*` temp dir after success or failure.

## How to get to it (user POV)

- Run `loomdoc <url> [--formats …] [--preset …] [--guidance …] [--pdf-layout …]`.
- Use the UI: paste the link, pick a style, and choose `Generate document`.

## Driving it with control-loomdoc

Preconditions:

- `ANTHROPIC_API_KEY` is exported in the shell that runs the helper. The user exports it. Never ask for it in chat.
- The user has supplied a public or unlisted video **with a transcript**, and approved the spend (about $0.10 to $0.20 per short video).
- For YouTube, `control-loomdoc cli -- doctor` shows yt-dlp and Deno as ✓ or !, not ✗.

- **CLI run.** Run `control-loomdoc cli -- <url> --out "$LOOMDOC_RUN/out" --formats markdown,pdf`. Exit `0`. stderr has `› Fetching the transcript…`, `› Picked N candidate screenshots…`, `› Writing the document with claude-sonnet-5…`, and `› Rendering markdown, pdf`. stdout has `Done. Wrote:` with `document.md` and `document.pdf`, and no `.docx`.
- **Files.** Run `ls -R "$LOOMDOC_RUN/out"`. It shows one `<slug>/` dir with `document.md`, `document.pdf`, and `images/step-NN.*`.
- **Content.** Read `document.md`. Its steps match what the video shows and says, and every image it links exists in `images/`.
- **Scratch.** Run `ls -d "${TMPDIR%/}"/loomdoc-* 2>/dev/null`. No dir is left from this run.
- **UI run.** With `start-ui` (real key), `login`, and `LOOMDOC_VERIFY_ALLOW_SPEND=1`, run `control-loomdoc post /api/runs '{"url":"<url>","preset":"how-to","formats":["markdown"]}'` to get `202`. Then run `control-loomdoc get /api/runs/<id>/events`. The stream ends with `"type":"done"` and a `result.files` entry for `document.md`. Then run `control-loomdoc get /files/<id>/document.md` to get `200` and the Markdown. Run `control-loomdoc get /files/<id>/../../etc/passwd` to get `403` or `404`, never the file.
- **Proof.** Keep the `cli-NN.*` and `http-NN.*` files plus `out/`. Cleanup keeps all of them.

## Gotchas

- **Not yet verified by this skill.** When it was generated, the shell had no `ANTHROPIC_API_KEY` and the repo had no real video URL, so this journey has never run through the helper. Report it as not verified until a run with both preconditions passes.
- `No transcript is available for this Loom video` means the video has no captions. Pick another video. Don't weaken the journey.
- `--out` defaults to `./out` in the repo, which is gitignored. Always pass `--out "$LOOMDOC_RUN/out"` so the proof lives with the run's evidence.
- YouTube from cloud or VPN networks often fails with `Sign in to confirm you're not a bot`. That is the network, not loomdoc. Report it as unmet.
- Harmless `Deprecated: "image" content part` warnings can flood stderr. Ignore them.
