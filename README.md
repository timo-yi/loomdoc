# loomdoc

A lightweight local CLI that turns a **Loom walkthrough** into a screenshot-rich,
audience-tailored **how-to document** (Markdown, Word, and PDF).

Point it at a public/unlisted Loom share link and get back finished documentation with the
right screenshots in the right places — the kind you would otherwise write by hand.

> **Status:** v1 in development. Read [`docs/PRD.md`](docs/PRD.md) for the full design,
> the decisions behind it, and what is deliberately deferred. The PRD is the durable source
> of truth; this README is the short version.

## How it works

1. **Ingest** a Loom share link — fetch the timestamped transcript and the video stream
   (no login, no browser).
2. **Winnow frames** — sample the video and collapse near-duplicate frames with perceptual
   hashing (the only deterministic step; it has no notion of "meaning", so cursor jitter,
   scrolling, and highlighting are ignored).
3. **Let a vision LLM do the judgment** — it receives the full transcript and the deduped
   screenshots, decides the steps, picks which screenshots matter, writes the captions and
   prose, and can pull any exact-moment frame it needs.
4. **Render** the resulting structured document to Markdown, Word (.docx), and PDF.

Everything except the LLM step is free and runs locally.

## Requirements

- Node.js (LTS)
- `ffmpeg` on your PATH
- An Anthropic API key in `ANTHROPIC_API_KEY`

## Usage

```bash
loomdoc <loom-share-url>
```

Output is written to `./out/<video-title>/` containing the document files and an `images/`
folder. The run prints the absolute output paths when it finishes.

## Scope (v1)

- Public / unlisted Loom share links.
- One video per run.
- Outputs: Markdown, Word, PDF.

Deferred by design (see the PRD): Google Docs export, PowerPoint decks, batch input,
workspace-private Loom auth, Sonnet→Opus auto-escalation, and packaging as a Vercel AI SDK
tool / Claude Code plugin. The architecture keeps each of these low-friction to add.

## License

[MIT](LICENSE)
