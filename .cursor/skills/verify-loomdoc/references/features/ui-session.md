# UI session

`loomdoc ui` checks setup in the terminal, listens on `127.0.0.1`, and prints a private link. The link works once. The first visit trades it for a session cookie and redirects to a clean URL. Without that cookie, the page and the API refuse the request.

## Sub-features

- `ui-launch` starts the server and opens the link in this run's Chrome.
- `ui-page` shows the form, with the document-style radios filled from `/api/config`.
- `ui-notices` shows YouTube setup warnings when yt-dlp or Deno is missing. Those warnings do not block the page.
- `ui-reload` loads `/` again with the same cookie.
- `ui-link-reuse` cannot spend the private link a second time from this helper.

## How to get to it (user POV)

- Run `loomdoc ui`. It opens the default browser.
- Run `loomdoc ui --no-open` and paste the printed link into the browser you want to use.

## Driving it with control-loomdoc

Preconditions:

- `control-loomdoc doctor` exits 0. ffmpeg and Chrome are present. A missing API key is fine.

- **Launch.** Run `control-loomdoc up --placeholder-key`. The JSON has `"ready": true`, `"key": "placeholder"`, a port, and `"form": true` with 8 presets. `evidence/ui-server.log` contains the running line.
- **Health.** Run `control-loomdoc doctor`. `ready` is true, `ownsPort` is true, and `instance.config.status` is 200. `activeRunId` is null when nothing is generating.
- **Reload.** Run `control-loomdoc browser open --url /`, then `control-loomdoc browser wait --selector 'input[name=preset]'`. The form is back.
- **Spent link.** Run `control-loomdoc browser open --url '/?token=abcdef'`. The command fails and the hint says the link was already spent. The page stays on the form.
- **Proof.** Keep the `up` JSON, a `browser screenshot`, and `evidence/ui-server.log`. The screenshot shows the loomdoc heading and the **Video link** field.
- **Cleanup.** Run `control-loomdoc stop`. The port no longer has a listener. `evidence/` is still there.

## Gotchas

- `up` spends the private link in its own Chrome profile. Do not curl the link, and do not paste it into another browser. A second client gets the "already been used" page, and this profile loses the race.
- `--placeholder-key` fails when `ANTHROPIC_API_KEY` is already set. Unset it for a no-spend page.
- The server rejects any Host other than `127.0.0.1:<port>` or `localhost:<port>`. The helper opens `127.0.0.1`.
- A second `up` for a run that is already ready does not start another server. The JSON says `alreadyRunning: true`.
