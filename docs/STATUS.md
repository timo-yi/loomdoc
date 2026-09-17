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

Follow-ups (not blockers): tune the frame thresholds and the `maxCandidates` cap against more
Looms, and the deferred items in PRD §8 (Google Docs, PPTX, batch, private-Loom auth,
Sonnet→Opus escalation, Vercel AI SDK / Claude Code plugin packaging).

## Commands

```bash
npm run typecheck   # tsc --noEmit
npm run dev -- <loom-url> [options]   # run from source via tsx
npm run build       # emit dist/
```
