import { NotImplementedError } from "../util/errors.js";
import type { DocContext, Effort } from "../types.js";
import type { LoomVideo } from "../ingest/loom.js";
import type { CandidateFrame } from "../frames/winnow.js";
import type { LoomDocOutput } from "./schema.js";

/**
 * Doc generation — where all judgment lives (PRD decisions D5, D7, D9, D10).
 *
 * Intended implementation (Vercel AI SDK, Anthropic provider):
 *   - `generateObject` (or `generateText` + a tool loop) with `loomDocSchema` as the
 *     output schema, so the result is schema-validated.
 *   - Input: the full timestamped transcript (as text) + the winnowed candidate frames
 *     (as images), plus any supplied DocContext. When context is absent, the prompt
 *     instructs the model to infer role/industry/function/audience/use case/intent from
 *     the video and tailor the writing accordingly.
 *   - Tool: `getFrameAtTimestamp(ts)` — lets the model pull any exact-moment frame it
 *     judges necessary (backed by frames/extract.extractFrameAt). Cap the number of
 *     calls at `maxFrameRequests` so the loop can't run away.
 *   - Default model "claude-sonnet-5" at `effort` "medium"; both configurable. The
 *     schema's per-step `needsDeeperReasoning` flag is what a future Sonnet->Opus
 *     escalation would read.
 */

export interface GenerateInput {
  video: LoomVideo;
  candidates: CandidateFrame[];
  context?: DocContext;
  model: string;
  effort: Effort;
  maxFrameRequests: number;
  /** Pull an extra frame the model asks for; returns the on-disk image path. */
  requestFrame: (timestampSeconds: number) => Promise<string>;
}

export async function generateDoc(_input: GenerateInput): Promise<LoomDocOutput> {
  throw new NotImplementedError("generate/generate.generateDoc");
}
