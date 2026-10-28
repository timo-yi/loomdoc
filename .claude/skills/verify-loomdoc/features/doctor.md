# Setup doctor

`loomdoc doctor` lists everything loomdoc needs: ffmpeg, `ANTHROPIC_API_KEY`, yt-dlp (with an age warning), and Deno. For anything missing, it explains the fix and asks before installing. Every normal run does the same check for just what that run needs. A Loom run skips the YouTube tools.

## Sub-features

- `doctor-list` prints ✓ for each satisfied requirement, ✗ for each blocking one, and ! for warnings, then exits 0 if nothing blocks and 1 otherwise.
- `doctor-no-tty` installs nothing and never prompts when no terminal is attached.
- `preflight-run` blocks a run whose requirements are missing, with `loomdoc can't run until the items above are fixed.`

## How to get to it (user POV)

- Run `loomdoc doctor` in a terminal.
- Run any `loomdoc <url>`, which checks just what that URL needs.
- Run `loomdoc ui`, which checks at startup and shows YouTube notices in the page.

## Driving it with control-loomdoc

Preconditions:

- A run directory exists.
- Record whether `ANTHROPIC_API_KEY` is set in this shell, because it changes the expected output.

- **List requirements.** Run `control-loomdoc cli -- doctor`. stderr starts with `Checking what loomdoc needs:`, and each requirement has its own ✓, ✗, or ! line. Exit is `0` only when no line is ✗.
- **Missing key blocks a run.** With `ANTHROPIC_API_KEY` unset, run `control-loomdoc cli -- https://www.loom.com/share/abcdef0123456789abcdef0123456789`. Exit `1`, and stderr contains `✗ ANTHROPIC_API_KEY is not set` and `loomdoc can't run until the items above are fixed.`
- **Nothing installed.** Compare `ls "$HOME/Library/Application Support/loomdoc/bin"` (macOS) before and after. It is unchanged.
- **Proof.** Keep `evidence/cli-NN.stderr` for each case.

## Gotchas

- The helper's stdin is `/dev/null`, so this proves only the non-interactive path. The interactive consent prompt (Enter means no) needs a real TTY. The helper does not drive it.
- yt-dlp and Deno may be loomdoc-managed copies under the loomdoc data dir, not on `PATH`. A ✓ next to `(loomdoc-managed)` is correct.
- An old yt-dlp is a warning (!), not a blocker. It does not change the exit code.
