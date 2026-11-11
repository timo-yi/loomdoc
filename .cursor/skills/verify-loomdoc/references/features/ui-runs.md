# UI runs

**Generate document** posts the form to the server. The server allows one run at a time, streams progress into the **Generating** section, and then shows either the files or an alert. Output files for a finished run are served under `/files/<id>/`.

## Sub-features

- `runs-start` shows **Generating** and a log line for the ingest stage.
- `runs-error` shows the failure in the alert and marks the ingest stage failed.
- `runs-slot` rejects a second start while the first run is still going.
- `runs-release` sets `activeRunId` back to null when the run ends.
- `runs-files` returns 404 for an unknown run id.

## How to get to it (user POV)

- Fill in a Loom or YouTube link and press **Generate document**.
- Watch **Generating**, then the alert or the **Done** section.

## Driving it with control-loomdoc

Preconditions:

- [UI session](ui-session.md) is ready with `--placeholder-key`.
- `doctor` reports `activeRunId` null.
- The form is on **How-to guide**, which does not require guidance. Reload with `browser open --url /` if an earlier case left **Custom** selected.

- **Start.** Run `control-loomdoc browser click --role radio --name "How-to guide"`. Fill `#url` with `https://www.loom.com/share/abcdef0123456789abcdef0123456789`. Run `control-loomdoc browser click --selector "#submit"`, then `control-loomdoc browser wait --selector '#progress:not([hidden])'`. The log text contains `Fetching the transcript and downloading the video`.
- **Missing video.** Run `control-loomdoc browser wait --selector '#form-error:not([hidden])' --timeout 60000`. The alert text is `Loom could not find this video, or it is not public (InvalidRequestWarning).`
- **Second start.** While that run is still in progress, run `control-loomdoc http post /api/runs '{"url":"https://www.loom.com/share/abcdef0123456789abcdef0123456789","preset":"how-to","formats":["markdown"]}'`. The status is 409 and the body says `A document is already being generated. Wait for it to finish.`
- **Slot released.** After the alert is visible, run `control-loomdoc http get /api/config`. `activeRunId` is null.
- **Unknown file.** Run `control-loomdoc http get /files/00000000-0000-0000-0000-000000000000/document.md`. The status is 404 and the body contains `Unknown run.`
- **Proof.** Screenshot the page after the alert. It shows the link, **Generating**, the failed ingest stage, and the alert. Keep `evidence/http-NN.*` for the 409 and the 404.
- **Cleanup.** Run `control-loomdoc stop`.

## Gotchas

- The missing-video failure can return in under a second. Send the second `http post` immediately after the click, in the same shell, or the run may already be over and the second post starts a new one instead of returning 409.
- This URL does not prove the "no transcript" error. That message belongs to a video Loom can find.
- A placeholder key never reaches the model on this URL, because ingest fails first. Do not describe that as a finished document.
- Proving that `/files/` rejects path traversal needs a finished run, so it belongs to [Generate a document](generate.md).
- With a real key, a POST whose path is `/api/runs` (including a trailing slash, a query string, or a doubled slash) is refused before the server handles it, unless `LOOMDOC_VERIFY_ALLOW_SPEND=1`. Do not set it for this feature. The placeholder key still lets the missing-video run reach the server.
