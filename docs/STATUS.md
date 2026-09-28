# Implementation status (v1 scaffold)

This tracks what the scaffold actually does today vs. what is still a stub. Update it as
modules get implemented. See [`PRD.md`](PRD.md) for the design and rationale.

| Module | Status | Notes |
|--------|--------|-------|
| `src/core/types.ts` | ✅ done | Domain types, defaults. |
| `src/core/generate/schema.ts` | ✅ done | Zod schema for the LLM output (fixed container). |
| `src/core/render/markdown.ts` | ✅ done | Fully implemented (no deps). |
| `src/core/render/index.ts` | ✅ done | Format dispatch. |
| `src/core/util/ffmpeg.ts` | ✅ done | `ffmpeg` shell-out + availability check. |
| `src/core/util/slug.ts` | ✅ done | Output-folder slug. |
| `src/core/util/errors.ts` | ✅ done | Error types. |
| `src/core/util/vtt.ts` | ✅ done | Line-driven WebVTT parser (entity decode, robust separators). |
| `src/core/util/transcript-json.ts` | ✅ done | Tolerant JSON-transcript parser (json-subs-only fallback). |
| `src/core/ingest/loom.ts` | ✅ done | GraphQL + REST + CDN-fallback ingest; downloads the video track locally (D14). |
| `src/core/ingest/youtube.ts` | ✅ done | yt-dlp ingest: metadata, caption-track choice, video + json3 captions download (D13). |
| `src/core/ingest/index.ts` | ✅ done | URL to source routing (`detectSource`, `fetchVideo`). |
| `src/core/util/scratch.ts` | ✅ done | Per-run temp dir; removed on finish, failure, Ctrl-C, and by a 24h stale sweep. |
| `src/core/util/download.ts` | ✅ done | ffmpeg stream-copy of the video track to local Matroska. |
| `src/core/util/ytdlp.ts` | ✅ done | yt-dlp shell-out with actionable error hints. |
| `src/core/util/youtube-json3.ts` | ✅ done | YouTube json3 caption parser. |
| `src/core/util/tools.ts` | ✅ done | loomdoc-managed tool locations; managed copies take precedence (D15). |
| `src/setup/checks.ts` | ✅ done | Requirement checks: ffmpeg, API key, yt-dlp (with age), Deno (>= 2). |
| `src/setup/install.ts` | ✅ done | ffmpeg via package manager; checksum-verified yt-dlp/Deno downloads. |
| `src/setup/preflight.ts` | ✅ done | Consent-gated fix flow; `loomdoc doctor` and per-run checks. |
| `src/core/generate/styles.ts` | ✅ done | Document style presets (D16), folded into the system prompt with guidance. |
| `src/ui/server.ts` | ✅ done | `loomdoc ui` server: auth, runs, SSE progress, output file serving (D17). |
| `src/ui/page.ts` | ✅ done | The single-page UI (HTML, CSS, script). |
| `src/ui/open.ts` | ✅ done | Opens the browser / file manager. |
| `src/core/pipeline.ts` | ✅ wired | Orchestrates all stages; throws at the first unimplemented stage. |
| `src/cli.ts` | ✅ wired | Thin CLI over the core (arg parsing + output paths). |
| `src/index.ts` | ✅ done | Public library API. |
| `src/core/frames/sample.ts` | ✅ done | ffmpeg fps sampling to JPEG scratch; (idx+0.5)/fps timestamps. |
| `src/core/frames/signature.ts` | ✅ done | 64×64 grayscale signature + `changedFraction` metric. |
| `src/core/frames/winnow.ts` | ✅ done | Stability gate: skip motion, emit one rep per settled distinct screen. |
| `src/core/frames/extract.ts` | ✅ done | Fast ffmpeg input-seek; verifies a non-empty frame was written. |
| `src/core/generate/generate.ts` | ✅ done¹ | Agentic vision LLM (Vercel AI SDK); id-referenced frames, guarded output, capped candidates; reviewed by skeptics and reworked. |
| `src/core/render/docx.ts` | ✅ done | `docx`; embedded images bounded in both dimensions; content-typed. |
| `src/core/render/pdf.ts` | ✅ done | `pdfkit` (pure JS); embedded images with pagination. |
| `src/core/render/fit.ts` | ✅ done | Shared aspect-preserving fit (bounds width AND height). |

¹ The deterministic parts (prompt building, transcript/image layout, the frame tool wiring)
are typed against the installed SDK and unit-tested. The live `generateText` call has **not**
been executed end-to-end yet — it needs `ANTHROPIC_API_KEY` and a real Loom. First real run is
its live validation.

## v1 status: shipped and validated

All modules are implemented, unit-tested, and skeptic-reviewed (55 tests). v1 has been run
**live, end to end**, against a real public Loom: ingest → frame winnowing → agentic
generation → Markdown/Word/PDF all worked, and a transcript fidelity check found the output
faithful (no fabrication, sensible screenshot selection, correct step structure). See the
README for the local walkthrough.

**YouTube support and local download (D13, D14):** Loom ingest with local download was
validated live (real public Loom: transcript, 59 MB video-only download, sampling, winnowing,
and frame seeks all worked, and the scratch dir was removed after the run and after a
mid-download Ctrl-C). YouTube ingest is unit-tested but has **not** been run live yet: the
development container's IP was blocked by YouTube's bot check. First real YouTube run from a
normal connection is its live validation.

**Launch checks (D15):** validated live on Linux: `doctor` without a terminal installs nothing
and prints manual steps; `--yes` downloaded and verified Deno and yt-dlp into the managed dir,
and yt-dlp detected the managed Deno and its bundled YouTube player component. The consent
prompt was exercised in a real terminal (Enter, "n" and Ctrl-D mean no; Ctrl-C aborts with exit code 130). Package-manager
installs of ffmpeg and the macOS/Windows paths are unit-tested but not run live.

**Style presets and web UI (D16, D17):** the UI was exercised in headless Chromium (light,
dark, and phone widths; no console errors, no horizontal overflow) and the real `loomdoc ui`
command ran a real Loom through ingest and frame selection over the API, surfacing the
generation error cleanly with a fake key. The presets' effect on real model output has **not**
been evaluated yet: that needs a real API key and a side-by-side read of each preset.

Follow-ups (not blockers): tune the frame thresholds and the `maxCandidates` cap against more
Looms, and the deferred items in PRD §8 (Google Docs, PPTX, batch, private-Loom auth,
Sonnet→Opus escalation, Vercel AI SDK / Claude Code plugin packaging).

## Commands

```bash
npm run typecheck   # tsc --noEmit
npm run dev -- <loom-url> [options]   # run from source via tsx
npm run build       # emit dist/
```
