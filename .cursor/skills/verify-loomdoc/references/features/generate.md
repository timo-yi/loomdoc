# Generate a document

A paid run turns a public or unlisted Loom or YouTube link into a document. The CLI prints the file paths. The page shows **Done**, links to the files, and a preview. Both paths call Anthropic.

## Sub-features

- `generate-cli` writes the requested formats under `out/<title>/` and prints `Done. Wrote:`.
- `generate-ui` shows **Done**, the output directory, and a preview built from the same result.
- `generate-files` serves `document.md` and the images for that run, and refuses a path that leaves the output directory.

## How to get to it (user POV)

- Run `loomdoc <url>` in a terminal and wait for `Done. Wrote:`.
- Or open `loomdoc ui`, paste the link, press **Generate document**, and wait for **Done**.

## Driving it with control-loomdoc

Preconditions:

- The user has approved this spend.
- `ANTHROPIC_API_KEY` is set to a real key.
- `LOOMDOC_VERIFY_ALLOW_SPEND=1` is set in the same shell.
- The URL is a public or unlisted video with a transcript. A YouTube URL also needs yt-dlp and Deno to show as a check or a warning in `control-loomdoc cli -- doctor`, not as a cross.
- For the page, run `control-loomdoc up` without `--placeholder-key`.

- **CLI run.** Run `control-loomdoc cli -- <url> --out "$LOOMDOC_RUN/out" --formats markdown,pdf`. The exit code is 0. stderr contains the progress lines for the transcript, the screenshots, the model, and rendering. stdout contains `Done. Wrote:` and the `document.md` and `document.pdf` paths.
- **Page run.** Fill `#url`, leave **How-to guide** selected, and click `#submit`. Wait until `#result` is visible. The preview contains the document title. `browser network` includes a `POST /api/runs` with status 202.
- **Files.** `control-loomdoc http get /files/<id>/document.md` returns 200 and the Markdown. `control-loomdoc http get /files/<id>/../../etc/passwd` returns 403 or 404, and the body is not that file.
- **Proof.** Keep the CLI evidence, a screenshot of **Done**, and a read of `document.md` whose steps match the video. List `out/<title>/` and confirm `images/` is beside the Markdown.
- **Cleanup.** Run `control-loomdoc stop`. Keep `out/` with the evidence.

## Gotchas

- This feature was not run while the verification skill was created. There was no API key and no approval to spend. Do not mark it verified from [UI runs](ui-runs.md). That path stops at ingest.
- The helper refuses the CLI command, the **Generate document** click, Enter, and `POST /api/runs` until `LOOMDOC_VERIFY_ALLOW_SPEND=1` is set. A screenshot of the form is not a substitute.
- `--formats markdown,pdf` omits Word on purpose, so the proof can show that the flag was honored.
- A symlink inside the output directory that resolves outside it is refused. A symlink that stays inside the directory is still served. Check the real path, not the link's name.
