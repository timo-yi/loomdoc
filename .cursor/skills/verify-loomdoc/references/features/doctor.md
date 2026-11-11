# Setup doctor

`loomdoc doctor` lists ffmpeg, `ANTHROPIC_API_KEY`, yt-dlp, and Deno. A missing item includes the fix. Nothing is installed unless the user agrees. A normal run checks only what that run needs. A Loom URL does not require the YouTube tools. The page can still open without them, and it shows a notice that YouTube links will not work yet.

## Sub-features

- `doctor-list` prints a check, a cross, or a warning for each requirement, then exits 0 when nothing blocks.
- `doctor-no-tty` installs nothing and never prompts when no terminal is attached.
- `preflight-run` blocks a run whose requirements are missing.

## How to get to it (user POV)

- Run `loomdoc doctor` in a terminal.
- Run `loomdoc <url>`. That checks only what the URL needs.
- Run `loomdoc ui`. The terminal check runs first. YouTube warnings also appear in the page's notice box.

## Driving it with control-loomdoc

Preconditions:

- A run directory exists. `control-loomdoc new` creates one. `up` also creates one.
- Note whether `ANTHROPIC_API_KEY` is set. It changes the expected lines.

- **List requirements.** Run `control-loomdoc cli -- doctor`. stderr starts with `Checking what loomdoc needs:`. Each requirement has its own check, cross, or warning line. The exit code is 0 only when no line is a cross.
- **Missing key blocks a run.** With `ANTHROPIC_API_KEY` unset, run `control-loomdoc cli -- https://www.loom.com/share/abcdef0123456789abcdef0123456789`. The exit code is 1. stderr contains `ANTHROPIC_API_KEY is not set` and `loomdoc can't run until the items above are fixed.`
- **Nothing installed.** The helper does not pass `--yes`, and stdin is `/dev/null`. stderr contains the check lines and no install command.
- **Proof.** Keep `evidence/cli-NN.stderr` for each case.

## Gotchas

- This proves the non-interactive path. The consent prompt, where Enter means no, needs a real TTY. The helper does not drive that prompt.
- yt-dlp and Deno may be copies loomdoc installed for itself. A check next to `loomdoc-managed` is correct.
- An old yt-dlp is a warning, not a blocker. It does not change the exit code.
- `control-loomdoc doctor` is the helper's machine check. `control-loomdoc cli -- doctor` is the product's check. They answer different questions.
