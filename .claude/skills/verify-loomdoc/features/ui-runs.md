# UI runs

The page posts the form to `POST /api/runs`. The server validates the body, allows one run at a time, streams progress over `GET /api/runs/<id>/events` (SSE, replayed from the start for late clients), and serves only that run's output files under `/files/<id>/…`.

## Sub-features

- `runs-validate` returns 400 for an empty URL, no formats, an unknown preset, or the Custom style without guidance.
- `runs-start` returns 202 with a run id.
- `runs-single-slot` returns 409 for a second POST while a run is active.
- `runs-events` streams `progress` events, then ends with exactly one `done` or `error` event.
- `runs-slot-release` sets `activeRunId` back to `null` once a run ends.
- `runs-files` serves only files inside the run's output dir, returning 404 for unknown runs and 403 for traversal, other file types, or a symlink that resolves outside the folder.

## How to get to it (user POV)

- Fill in the form and choose `Generate document`. The page shows `#progress`, then `#result` or the error in `#form-error`.

## Driving it with control-loomdoc

Preconditions:

- A UI is started with `start-ui --placeholder-key` and `login` has run (see [UI session](./ui-session.md)).
- `doctor` reports `"activeRunId":null`.

- **Custom without guidance.** Run `control-loomdoc post /api/runs '{"url":"https://www.loom.com/share/abcdef0123456789abcdef0123456789","preset":"custom","formats":["markdown"]}'`. `400` with `The Custom style needs guidance describing the document you want.`
- **Empty URL.** Run `control-loomdoc post /api/runs '{"url":"","preset":"how-to","formats":["markdown"]}'`. `400`, and the body starts with `Invalid request:`.
- **No formats.** Run `control-loomdoc post /api/runs '{"url":"https://www.loom.com/share/x","preset":"how-to","formats":[]}'`. `400`, and the body starts with `Invalid request:`.
- **Start, no spend.** Run `control-loomdoc post /api/runs '{"url":"https://www.loom.com/share/abcdef0123456789abcdef0123456789","preset":"how-to","formats":["markdown"]}'`. `202` with `{"id":"<uuid>"}`. The placeholder key and a nonexistent video mean the run fails at ingest.
- **Single slot.** Immediately repeat the same POST. `409` with `A document is already being generated.` This needs the first run still active, so send it right away.
- **Events.** Run `control-loomdoc get /api/runs/<uuid>/events`. One `"type":"progress","stage":"ingest"` event, then `"type":"error","message":"No transcript is available for this Loom video. …"`, then the stream closes.
- **Slot released.** Run `control-loomdoc doctor`. The output contains `"activeRunId":null`.
- **Scratch removed.** Run `ls -d "${TMPDIR%/}"/loomdoc-* 2>/dev/null`. It lists no dir created during this run.
- **Unknown run files.** Run `control-loomdoc get /files/00000000-0000-0000-0000-000000000000/document.md`. `404` with `Unknown run.`
- **Proof.** Keep `evidence/http-NN.*` for every request, plus `ui-server.log`.
- **Cleanup.** Run `control-loomdoc stop`.

## Gotchas

- The ingest failure in the no-spend start needs network access to loom.com. Offline, the error message differs, but 202, 409, and the slot release should still hold.
- `post /api/runs` with a real key is refused unless `LOOMDOC_VERIFY_ALLOW_SPEND=1`. Do not set it for this feature, because a nonexistent video is enough.
- Proving 403 for traversal, other file types, or an escaping symlink under `/files/` needs a completed run (`record.outputDir` set). Only a paid run gets there, so it is covered by [Generate a document](./generate.md) and by `test/ui-server.test.ts`. Containment is checked on real paths, so a symlink to a file inside the folder is still served.
