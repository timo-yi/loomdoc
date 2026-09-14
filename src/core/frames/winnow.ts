import { NotImplementedError } from "../util/errors.js";
import type { SampledFrame } from "./sample.js";

/**
 * Winnowing (PRD §4, decision D6). Group consecutive near-identical sampled frames
 * (Hamming distance <= threshold) into "screen states" and pick one settled
 * representative per state. This is the ONLY deterministic step and it has no notion
 * of meaning — it just removes near-duplicates. Which surviving frames matter is the
 * LLM's call, so this step is deliberately conservative (recall-biased).
 */

export interface CandidateFrame {
  timestamp: number;
  path: string;
}

/**
 * Collapse a run of sampled frames into distinct settled representatives.
 * Intended: hash each frame, group consecutive frames within `hammingThreshold`,
 * and choose the sharpest/most-settled frame of each group as its representative.
 */
export async function winnowFrames(
  _frames: SampledFrame[],
  _hammingThreshold: number,
): Promise<CandidateFrame[]> {
  throw new NotImplementedError("frames/winnow.winnowFrames");
}
