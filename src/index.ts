/**
 * Public library API (PRD decision D4).
 *
 * The whole tool is a library first; the CLI (src/cli.ts) is a thin adapter over this.
 * A future Vercel AI SDK tool or Claude Code plugin wraps `runLoomdoc` the same way.
 */
export { runLoomdoc } from "./core/pipeline.js";
export * from "./core/types.js";
export { loomDocSchema, type LoomDocOutput } from "./core/generate/schema.js";
