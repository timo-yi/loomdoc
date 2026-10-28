# UI session

`loomdoc ui` checks setup in the terminal, then serves one page on `127.0.0.1` and prints a private launch link. The link works once. It trades its token for a session cookie and redirects to a clean URL. Without that session, every page and API route refuses.

## Sub-features

- `ui-launch` prints `loomdoc UI is running` and the private link on stderr.
- `ui-login` returns `303` for the launch link, with an HttpOnly, SameSite=Strict cookie and `Location: /`.
- `ui-page` serves the form with a request token in `<meta name="loomdoc-token">`.
- `ui-link-reuse` returns 401 and the "already been used" page when a cookieless client reopens a spent link.
- `ui-no-session` returns 401 for `/` and the API without a cookie.
- `ui-config` returns presets, defaults, setup notices, and `activeRunId` from `GET /api/config`.

## How to get to it (user POV)

- Run `loomdoc ui`. It opens the default browser.
- Run `loomdoc ui --no-open` and paste the printed link into a browser.

## Driving it with control-loomdoc

Preconditions:

- A fresh run directory. ffmpeg is on `PATH`.

- **Launch.** Run `control-loomdoc start-ui --placeholder-key`. It prints `ready: pid <pid>, port <port>, key: placeholder` and the launch URL. `evidence/ui-server.log` contains `loomdoc UI is running`.
- **Health before login.** Run `control-loomdoc doctor`. It prints `process: pid … listening on 127.0.0.1:<port>` and `session: not logged in yet`.
- **Log in.** Run `control-loomdoc login`. It prints `logged in: launch link -> 303 + session cookie`. `evidence/page.html` contains `<h1>loomdoc</h1>` and `id="run-form"`.
- **Config.** Run `control-loomdoc doctor`. It prints `session: valid; /api/config -> {"presets":[…],"defaults":{"formats":["markdown","docx","pdf"],"pdfLayout":"pageless",…},"activeRunId":null}`.
- **Spent link.** Run `curl -s -o /dev/null -w '%{http_code}\n' "$(cat "$LOOMDOC_RUN/state/launch-url")"`. It prints `401`.
- **No session.** Run `curl -s -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:$(cat "$LOOMDOC_RUN/state/port")/"`. It prints `401`.
- **Proof.** Keep the helper output together with `evidence/page.html` and `evidence/ui-server.log`.
- **Cleanup.** Run `control-loomdoc stop`. Afterward, `lsof -nP -iTCP:<port> -sTCP:LISTEN` finds nothing.

## Gotchas

- `login` spends the link. After that, the browser path for this instance is gone, because a cookieless browser gets 401. To use a browser, skip `login` and open the launch URL there.
- Without `--placeholder-key` and with no key in the environment, `start-ui` fails before it is ready (`loomdoc can't start until the items above are fixed.`).
- The server rejects any `Host` other than `127.0.0.1:<port>` or `localhost:<port>` with 403. Use the URL exactly as printed.
