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
| `src/core/ingest/loom.ts` | ✅ done | GraphQL + REST + CDN-fallback ingest; reviewed by skeptics and hardened. |
| `src/core/pipeline.ts` | ✅ wired | Orchestrates all stages; throws at the first unimplemented stage. |
| `src/cli.ts` | ✅ wired | Thin CLI over the core (arg parsing + output paths). |
| `src/index.ts` | ✅ done | Public library API. |
| `src/core/frames/sample.ts` | ✅ done | ffmpeg fps sampling to JPEG scratch; (idx+0.5)/fps timestamps. |
| `src/core/frames/signature.ts` | ✅ done | 64×64 grayscale signature + `changedFraction` metric. |
| `src/core/frames/winnow.ts` | ✅ done | Stability gate: skip motion, emit one rep per settled distinct screen. |
| `src/core/frames/extract.ts` | ✅ done | Fast ffmpeg input-seek; verifies a non-empty frame was written. |
| `src/core/generate/generate.ts` | 🚧 stub | Agentic vision LLM + `getFrameAtTimestamp` tool. |
| `src/core/render/docx.ts` | 🚧 stub | `docx` package, embedded images. |
| `src/core/render/pdf.ts` | 🚧 stub | Approach still an open item (PRD §10). |

## Suggested implementation order

1. `ingest/loom.ts` — get a real transcript + stream URL from a share link (unblocks everything).
2. `frames/extract.ts` — single-frame seek (also backs the model's frame tool).
3. `frames/sample.ts` + `hash.ts` + `winnow.ts` — the winnowing track.
4. `generate/generate.ts` — the agentic doc generation (the core value).
5. `render/docx.ts`, then `render/pdf.ts`.

The Markdown renderer already works, so an end-to-end run producing a `.md` is reachable
after steps 1–4, before the other two renderers exist.

## Commands

```bash
npm run typecheck   # tsc --noEmit
npm run dev -- <loom-url> [options]   # run from source via tsx
npm run build       # emit dist/
```
