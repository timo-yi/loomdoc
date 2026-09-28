# loomdoc

A lightweight local CLI that turns a **Loom or YouTube walkthrough** into a screenshot-rich,
audience-tailored **how-to document** (Markdown, Word, and PDF).

Point it at a public or unlisted Loom share link or YouTube video and get back finished
documentation with the right screenshots in the right places, the kind you would otherwise
write by hand.

> **Status:** v1. See [`docs/PRD.md`](docs/PRD.md) for the full design, the decisions behind
> it, and what is deliberately deferred. The PRD is the durable source of truth; this README
> is how you run it.

## How it works

1. **Ingest** a Loom or YouTube link: fetch the timestamped transcript and download the video
   track to a temporary folder (no login, no browser). The temporary folder is deleted when the
   run ends, including when it fails or you press Ctrl-C.
2. **Winnow frames**: sample the video and collapse near-duplicate frames, ignoring cursor
   jitter and scrolling (the only deterministic step; it has no notion of "meaning").
3. **Let a vision LLM do the judgment**: it receives the full transcript and the deduped
   screenshots, decides the steps, picks which screenshots matter, writes the captions and
   prose, and can pull any exact-moment frame it needs.
4. **Render** the resulting document to Markdown, Word (.docx), and PDF.

Everything except the LLM step is free and runs locally.

---

## Getting started (local walkthrough)

This is the whole thing, start to finish. If you have never installed Node or ffmpeg, follow
each step; skip the ones you already have.

### 1. Install the prerequisites

**a) Node.js** (version 18 or newer). Check whether you already have it:

```bash
node -v      # prints e.g. v20.x.x if installed; "command not found" if not
```

If it prints a version of 18+, you are set. Otherwise install it:

- **macOS** (with [Homebrew](https://brew.sh)): `brew install node`
- **Windows**: `winget install OpenJS.NodeJS.LTS`
- **Linux (Debian/Ubuntu)**: `sudo apt-get update && sudo apt-get install -y nodejs npm`
- **Any OS, version-managed**: install [nvm](https://github.com/nvm-sh/nvm), then `nvm install --lts`

**b) ffmpeg** (loomdoc uses it to sample and cut frames). Check:

```bash
ffmpeg -version   # prints a version if installed; "command not found" if not
```

If it is missing, install it:

- **macOS**: `brew install ffmpeg`
- **Windows**: `winget install ffmpeg` (or `choco install ffmpeg`)
- **Linux (Debian/Ubuntu)**: `sudo apt-get install -y ffmpeg`

**c) yt-dlp and Deno (only needed for YouTube links; loomdoc can install these for you).**
loomdoc uses [yt-dlp](https://github.com/yt-dlp/yt-dlp) to download YouTube videos and
captions, and yt-dlp uses [Deno](https://deno.com) to run YouTube's player code in a sandbox.
Skip this step if you only use Loom.

The easiest route is to let loomdoc handle it: the first time you use a YouTube link (or run
`loomdoc doctor`), it offers to download both from their official GitHub releases into its own
folder, verifies their checksums, and needs no admin rights. It also offers to update yt-dlp
when your copy is more than 60 days old, which matters because YouTube regularly breaks older
versions.

If you prefer to install them yourself instead:

- **macOS**: `brew install yt-dlp deno`
- **Windows**: `winget install yt-dlp.yt-dlp DenoLand.Deno`
- **Linux / any OS**: `pipx install yt-dlp`, and
  `curl -fsSL https://deno.land/install.sh | sh`

**d) An Anthropic API key** (only the final writing step calls the model). Create one at
[console.anthropic.com](https://console.anthropic.com/settings/keys), then export it in your
terminal:

```bash
export ANTHROPIC_API_KEY=sk-ant-...your-key...
```

Note: `export` only sets the key for the **current** terminal window. To avoid re-exporting it
every time, add that same line to your shell profile (`~/.zshrc` on modern macOS, `~/.bashrc`
on most Linux) and open a new terminal. Verify it is set:

```bash
echo $ANTHROPIC_API_KEY   # should print your key, not an empty line
```

**e) Check everything at once (optional).** After step 2, run `loomdoc doctor` (or
`npm run dev -- doctor`). It lists what is installed, and for anything missing it explains the
problem and asks before installing it. Nothing is installed unless you answer `y`; pressing
Enter means no, and Ctrl-C stops loomdoc. Every normal run does the same check for just what that run needs.

### 2. Get loomdoc

```bash
git clone https://github.com/timo-yi/loomdoc.git
cd loomdoc
npm install
```

`npm install` also builds a small native image library (sharp); if it fails, make sure your
Node is 18+ and re-run it.

### 3. Run it

You have two options. Both do the same thing.

**Option A – run it directly from the project (no extra setup):**

```bash
npm run dev -- <loom-or-youtube-url>
```

The `--` matters: everything after it is passed to loomdoc. Example:

```bash
npm run dev -- https://www.loom.com/share/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
npm run dev -- https://www.youtube.com/watch?v=xxxxxxxxxxx
```

**Option B – install a real `loomdoc` command on your PATH** (so you can run it from anywhere,
like `loomdoc <url>`):

```bash
npm run build     # compiles the TypeScript into dist/
npm link          # puts a `loomdoc` command on your PATH, pointing at this build
```

Now, from any directory:

```bash
loomdoc https://www.loom.com/share/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

To remove that command later: `npm unlink -g loomdoc`. (If you prefer a one-time copy instead
of a live link, use `npm install -g .` after `npm run build`, and `npm uninstall -g loomdoc`
to remove it. Re-run `npm run build` after pulling changes so the `loomdoc` command reflects
them.)

### 4. Find your output

The run prints the paths when it finishes. Output lands in:

```
out/<video-title>/
├── document.md
├── document.docx
├── document.pdf
└── images/
```

Open `document.md` (or the `.docx` / `.pdf`) and review it. The Markdown file references images
in the adjacent `images/` folder, so keep them together if you move the `.md`.

---

## Options

```
loomdoc <loom-or-youtube-url> [options]

  --out <dir>        Output root directory (default: ./out)
  --formats <list>   Comma-separated: markdown,docx,pdf (default: all three)
  --model <id>       Model id (default: claude-sonnet-5)
  --effort <level>   low|medium|high|xhigh|max (default: medium)

Relevance context (all optional; inferred from the video when omitted):
  --role <text>
  --industry <text>
  --function <text>
  --audience <text>
  --use-case <text>
  --intent <text>
  --style <text>     Free-text voice/style steer

Setup:
  -y, --yes          Answer "yes" to install prompts (also works without a terminal)

  -h, --help         Show help

loomdoc doctor [--yes]   Check (and offer to install) everything loomdoc needs
```

With Option A, pass options after the `--`, e.g.
`npm run dev -- <url> --audience "new engineers" --formats markdown`.

Typical cost is roughly **$0.10 to $0.20** per short video (Sonnet 5, medium effort).

## Troubleshooting

| You see | What it means | Fix |
|---------|---------------|-----|
| `ffmpeg not found on PATH` | ffmpeg isn't installed | Run `loomdoc doctor` and accept the install, or install it yourself (step 1b) |
| An error mentioning `ANTHROPIC_API_KEY` or authentication | The key isn't set in this terminal | `export ANTHROPIC_API_KEY=...` (step 1d) and check `echo $ANTHROPIC_API_KEY` |
| `Could not resolve a video stream URL ... (last HTTP status 403)` with "network is blocking loom.com" | Either the video is private/password-protected, or your network/proxy blocks loom.com | Use a public/unlisted link; if on a restricted network, run somewhere with open access |
| `No transcript is available for this Loom video` | The video has no captions/transcript | loomdoc needs the transcript; pick a video that has one |
| `Failed to launch yt-dlp` | yt-dlp isn't installed (YouTube links only) | Run `loomdoc doctor` and accept the install, or install it yourself (step 1c) |
| `yt-dlp failed ... Sign in to confirm you're not a bot` | YouTube is challenging your network (common on cloud servers and VPNs) | Run from a normal home or office connection, or put `--cookies-from-browser chrome` (or your browser) in loomdoc's yt-dlp config file: `~/Library/Application Support/loomdoc/yt-dlp.conf` (macOS), `~/.local/share/loomdoc/yt-dlp.conf` (Linux), or `%LOCALAPPDATA%\loomdoc\yt-dlp.conf` (Windows). loomdoc ignores your general yt-dlp config so its download settings can't interfere. |
| `yt-dlp failed ... HTTP Error 403` or `Requested format is not available` | yt-dlp is out of date, or Deno is missing | Run `loomdoc doctor` to update yt-dlp and install Deno |
| An install step fails inside `loomdoc doctor` | The package manager or download failed (network, permissions) | The message says what failed; the printed manual instructions always work as a fallback |
| `No usable captions are available for this YouTube video` | The video has neither uploaded nor automatic captions in its original language | loomdoc needs the transcript; pick a video that has captions |
| A wall of `Deprecated: "image" content part` warnings | Harmless AI SDK deprecation notices | Cosmetic only; safe to ignore |

## Scope (v1)

- Public / unlisted Loom share links and public / unlisted YouTube videos.
- Walkthrough-style recordings. Lectures, talking-head videos, and heavily edited content work
  but produce weaker how-to documents.
- Downloading YouTube videos is against YouTube's Terms of Service. Use it for videos you own or
  have permission to use.
- One video per run.
- Outputs: Markdown, Word, PDF.

Deferred by design (see the PRD): Google Docs export, PowerPoint decks, batch input,
workspace-private Loom auth, Sonnet to Opus auto-escalation, and packaging as a Vercel AI SDK
tool or Claude Code plugin. The architecture keeps each of these low-friction to add.

## License

[MIT](LICENSE)
