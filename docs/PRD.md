# loomdoc — Product Requirements Document (PRD)

> Status: **v1 design, pre-implementation.** This document is the durable record of what
> we are building, the decisions we made, why we made them, and what we deliberately deferred.
> It is written to be referred back to. When a decision here changes, update this file in the
> same change that alters the behavior.

Last updated: 2026-09-14

---

## 1. One-liner

**loomdoc** is a lightweight local CLI that turns a Loom walkthrough into a screenshot-rich,
audience-tailored how-to document. You give it a Loom share link; it gives you a finished doc
(Markdown, Word, and PDF) with the right screenshots in the right places.

Plain English: point it at a recorded walkthrough, get back documentation you would otherwise
write by hand.

---

## 2. Goals and non-goals

### Goals (v1)
- Ingest a **public / unlisted Loom share link** and produce a step-by-step how-to document.
- Embed **meaningful screenshots** pulled from the video at the right moments — this is the
  core value; a doc without good screenshots is a failure.
- Output **Markdown, Word (.docx), and PDF**, each with its screenshots.
- Keep the tool **extremely lightweight**: local CLI, one recurring cost (the LLM call),
  everything else free and open-source.
- Tailor the writing to the user's **role / industry / function / audience / use case / intent**,
  supplied explicitly or inferred from the video.

### Non-goals (v1)
- Not a hosted service, web app, or browser extension.
- Not a general video-to-text tool; it is specifically for **walkthroughs**.
- Does not aim to perfectly classify every on-screen action deterministically. Meaning
  extraction is the LLM's job, not code's (see Decision D6).

---

## 3. Key decisions and rationale

Each decision below was reached by stress-testing the original idea. The rationale is kept so
future readers understand *why*, not just *what*.

| # | Decision | Rationale (incl. plain English) |
|---|----------|----------------------------------|
| D1 | **No headless browser.** Extract frames with `ffmpeg` directly, not by driving Claude-in-Chrome to screenshot a playing video. | Loom exposes the timestamped transcript (public GraphQL/SSR) *and* the video stream (HLS). Given both, a browser in the loop is the heaviest, most fragile, most expensive component and buys nothing — the recording already contains everything on screen. Plain English: we can download the video and cut frames from it, so we never need to watch it in a browser. |
| D2 | **Local CLI**, not hosted. | "Extremely lightweight, low cost." A CLI has no server, no hosting bill, no auth, no deploy. You pay only per run (the LLM). |
| D3 | **TypeScript / Node core.** | Two stated futures — a Claude Code plugin and a **Vercel AI SDK tool** — both want JS/TS. A Python core would force an awkward subprocess/HTTP bridge to reach the Vercel AI SDK. TS also lets the LLM step *use* the Vercel AI SDK directly. `ffmpeg` is a shelled-out binary either way, so nothing is lost on the media side. Local Whisper (Python's one advantage) is unnecessary because Loom gives us the transcript. |
| D4 | **Separable core library + thin CLI.** | Keeps every future distribution channel (Claude Code plugin, Vercel AI SDK tool, package, bot) a thin adapter over the same core — no rewrite. |
| D5 | **Vision LLM does all judgment; deterministic code only produces signals and winnows.** | As models improve, we want to give them room to reason rather than constrain them with brittle heuristics. Code narrows the haystack; the model picks the needles. |
| D6 | **The only deterministic step is visual de-duplication; it has no concept of "meaning."** | Trying to deterministically detect "meaningful" screen changes (scroll vs. real navigation, nervous highlight vs. intentional) is an endless edge-case spiral. We refuse it. A downscaled change-fraction metric collapses near-identical frames (cursor-only movement is sub-cell and vanishes) while keeping localized changes (dropdowns, selections, typed text); a stability gate skips in-motion frames. It is recall-biased — over-capture, and let the LLM decide what matters. *(An earlier 9×8 dHash sketch was replaced after review: it collapsed exactly the localized steps a how-to doc must capture.)* |
| D7 | **Transcript is a first-class input to frame selection, via the LLM — not via keyword heuristics.** | The transcript is handed to the LLM whole. The LLM can call a `getFrameAtTimestamp(ts)` tool to pull any exact moment it judges important (e.g. "they typed the email at 2:03") — covering small changes the hash smooths over — without any code-side keyword matching. |
| D8 | **Fixed step-granular output schema; renderers per format.** | One structured intermediate (ordered steps: heading + optional screenshot + body) renders to Markdown, Word, PDF today and PowerPoint later (a step = a doc section = a slide). The schema is the fixed container; the LLM owns the contents. |
| D9 | **Output genre = step-by-step how-to, with a free-text style/context steer.** | Covers the walkthrough use case. Audience/tone adapt via optional context (role, industry, function, audience, use case, intent) or inference from the video. No rigid template menu (that fights LLM judgment and adds surface). |
| D10 | **Sonnet 5 @ medium by default; model + effort configurable; auto-escalation deferred.** | We don't yet have evidence Sonnet 5 is insufficient. Building the Sonnet→Opus auto-router first would optimize an unmeasured problem. The schema carries a per-step confidence field so escalation slots in later with no refactor. On the Vercel AI SDK, swapping models is a one-line change. |
| D11 | **v1 targets public / unlisted share links only.** (Extended to YouTube by D13; the public/unlisted limit still applies.) | The clean, no-login GraphQL/SSR path works for unlisted links. Workspace-private videos need an authenticated session (cookie) — more setup, more fragility — deferred. |
| D12 | **Repo: `loomdoc`, private, MIT license, under `timo-yi`.** | Private keeps options open (private→public is trivial). MIT is the permissive norm for a tool this size and enables internal sharing / open-sourcing later with zero friction. |
| D13 | **YouTube is a second source, ingested via the `yt-dlp` binary; ingest returns a source-neutral `SourceVideo`.** | YouTube obfuscates stream and caption URLs (player-JS signatures, proof-of-origin tokens) and changes the scheme every few weeks. yt-dlp is the maintained client that tracks this; shelling out to it (like ffmpeg) keeps that churn out of this codebase, and users fix breakage with `yt-dlp -U`. Captions are read as YouTube's native json3, because the auto-caption VTT repeats each line across cues and would duplicate the transcript. Creator-uploaded captions win over automatic ones, and machine-translated auto tracks are never used. Everything after ingest is source-agnostic. Plain English: Loom and YouTube each have one module that knows how to fetch from them; the rest of loomdoc just sees "a video and its transcript." |
| D14 | **Download the video track to a per-run scratch dir; delete it however the run ends.** | Frame steps previously streamed from a short-lived signed URL, twice (sampling, then each model frame request). A local copy removes the expiry risk, makes seeks fast and reliable, and is required for YouTube, whose URLs are rate-limited and IP-bound. Only the video track is kept (no audio), stream-copied into Matroska (no re-encode). The scratch dir lives in the OS temp dir, outside the deliverable, and is removed in a `finally`, on SIGINT/SIGTERM, and on exit; any run also sweeps loomdoc scratch dirs older than 24h left by a hard kill. Plain English: the video is downloaded into a temporary folder that is always cleaned up, so nothing piles up on disk. |

---

## 4. Pipeline (end to end)

```
Loom share URL or YouTube URL
      │
      ├─ Transcript track ──────────────► full timestamped transcript (Loom GraphQL/SSR, or yt-dlp json3 captions)
      │
      └─ Video track ─► download to scratch dir ─► sample frames ─► change-fraction + stability gate ─► settled reps
                        (deleted at end of run)
                                               (only deterministic step; no notion of meaning)
      │
      ▼
  Agentic vision LLM  ◄──────── full transcript + deduped screenshots
      │  (all judgment: steps, which screenshots, captions, structure, wording)
      │  may call getFrameAtTimestamp(ts) → cheap ffmpeg seek → extra exact-moment frame
      ▼
  Structured step-granular document (schema-validated)
      │
      ├─► Markdown renderer  (images referenced in ./images/)
      ├─► Word (.docx) renderer  (images embedded)
      └─► PDF renderer  (images embedded)
      │
      ▼
  ./out/<video-title>/ { doc.md, doc.docx, doc.pdf, images/ }
  (absolute output paths printed at end of run)
```

### Notes on the mechanics
- **Frame track is non-destructive.** Winnowing chooses the *default* distinct screens; the
  full video remains available, so any exact-timestamp frame can be re-cut on demand. The order
  the two tracks finish in never costs a frame.
- **Change-fraction metric**: each frame is downscaled to a 64×64 grayscale signature; two
  frames differ by the fraction of cells that change beyond a per-cell noise floor. A ~15px
  cursor is sub-cell after downscale, so cursor-only movement collapses; a dropdown, selection,
  or typed text changes enough cells to be kept. (This replaced an initial 9×8 dHash, which
  review showed collapsed exactly those localized steps.)
- **Stability / settle gate**: frames are skipped while the screen is *in motion* (consecutive
  change above a motion threshold), so scrolls and animations don't yield blurry mid-transition
  representatives; one representative is emitted per settled, distinct screen.
- Thresholds (sample rate, per-cell delta, same-screen and motion fractions, dwell) are config
  with sane defaults, to be tuned against a couple of real Looms.

---

## 5. Output schema (intermediate representation)

The LLM emits this shape; renderers consume it. Illustrative, not final:

```ts
interface LoomDoc {
  title: string;
  overview: string;
  audience: string;           // inferred or supplied (always set)
  steps: Step[];              // >= 1
}

interface Step {
  heading: string;
  body: string;               // instruction/narration for this step
  screenshot?: {
    screenshotId: string;     // id of a frame the model was shown: "c3" (candidate) or "f1" (fetched)
    caption?: string;
  };
  needsDeeperReasoning?: boolean;  // confidence flag; enables future Sonnet→Opus escalation
}
```

Screenshots are referenced by **id**, not a free timestamp: the model can only cite a frame it
was actually shown (a candidate `cN`, or a `getFrameAtTimestamp` result `fN`). The pipeline then
ships that exact frame's bytes — copied into `images/`, never re-extracted — which removes both
timestamp drift and any dependence on the (short-lived, signed) stream URL after the LLM step.
The candidate set is capped (`FrameOptions.maxCandidates`, the cost lever) by dropping the
least-distinct screens.

---

## 6. Cost

Current pricing: Sonnet 5 $2/$10 per M in/out; Opus 5 $5/$25.

For a 5-minute walkthrough: ~10–20 deduped screenshots dominate input as vision tokens
(~1.2k tokens/image), transcript+prompt ~3k → ~21k input; structured output + medium-effort
thinking ~7k.

- **Default (Sonnet 5, medium): ~$0.10–0.15 per video.**
- **Ceiling (fully escalated to Opus 5): ~$0.30 per video.**
- Realistic blended (partial escalation, once implemented): ~$0.12–0.20.

The single cost lever is **image count**, controlled directly by the winnowing.

---

## 7. Stack and run behavior

- **Language:** TypeScript / Node.
- **Structure:** core library (pure functions: fetch, download, frames, structure, render) +
  thin CLI adapter.
- **External binaries:** `ffmpeg` (video download, frame sampling and extraction); `yt-dlp`
  (YouTube only, with a JavaScript runtime such as Deno).
- **LLM:** Vercel AI SDK with the Anthropic provider. Access via `ANTHROPIC_API_KEY` env var.
- **Invocation:** `loomdoc <url>` (a Loom or YouTube link), one video per run.
- **Output:** `./out/<video-title>/` containing `doc.md`, `doc.docx`, `doc.pdf`, and `images/`.
  Absolute paths printed at end of run.

---

## 8. Deliberately deferred (design keeps them low-friction)

| Deferred item | Why deferred | What keeps it cheap to add |
|---|---|---|
| **Google Docs export** | The Docs API image insert needs a public URL or Apps Script; real overhead. Word covers the "reliable embedded screenshots" need. | Renderer plugin; likely via docx→Drive upload-with-conversion (preserves inline images). |
| **PowerPoint / deck renderer** | Not needed for the proof of concept. | Step-granular schema maps a step → a slide directly; it's another renderer. |
| **Batch input** | One video per run proves the concept. | A trivial loop over the core. |
| **Workspace-private Loom auth** | Needs an authenticated session/cookie; fragile. | Swap the ingest fetcher; rest of pipeline unchanged. |
| **Sonnet→Opus auto-escalation** | No evidence Sonnet 5 is insufficient yet. | Confidence field already in the schema; model swap is one line on the Vercel AI SDK. |
| **Vercel AI SDK tool / Claude Code plugin packaging** | Distribution channel deferred. | Thin adapter over the separable core (D4). |

---

## 9. Risks and assumptions

- **Loom's public GraphQL/SSR endpoints are unofficial** and can change. Ingest is isolated behind
  one module so a break is contained and fixable in one place.
- **Signed CDN URLs expire quickly.** The video track is downloaded during ingest, right after
  the URL is issued (D14); every later frame step reads the local copy.
- **YouTube blocks some networks and changes often.** Cloud and VPN IPs are often challenged
  with a bot check, and an outdated yt-dlp stops working when YouTube changes its player. Errors
  name both causes and their fixes (a home connection or browser cookies via the user's yt-dlp
  config; `yt-dlp -U`). Downloading is against YouTube's Terms of Service; the tool is intended
  for videos the user owns or has permission to use.
- **Long videos.** YouTube videos are often far longer than a Loom. Sampling is capped at
  `maxSampledFrames` (default 2400, i.e. 20 minutes at 2 fps) by lowering the sample rate, which
  bounds scratch disk use and hashing time. The full transcript is still sent to the model.
- **Model swap and structured output.** The default `claude-sonnet-5` supports native structured
  output, so `output` + tools coexist cleanly. A model *without* native structured-output support
  would make the provider inject a forced JSON tool alongside `getFrameAtTimestamp` — a different,
  less-tested path. Prefer current-generation models when overriding `--model`.
- **Perceptual hashing is deliberately insensitive to small changes.** This is why cursor jitter
  is ignored — and why the LLM frame-request tool (D7) exists to recover genuinely small, narrated
  changes.
- **Self-assessed confidence (for future escalation) is noisy.** That's a reason escalation is
  deferred until measured, not built blind.

---

## 10. Open items to settle during/after v1

- Tune winnowing thresholds against real Looms.
- Decide the exact `getFrameAtTimestamp` call cap.
- Confirm PDF rendering approach (embedded-image fidelity across the three formats).
- Measure Sonnet 5 @ medium output quality → decide whether/how to implement escalation (D10).
