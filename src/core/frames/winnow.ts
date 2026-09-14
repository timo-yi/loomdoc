import { hammingDistance, perceptualHash, type PerceptualHash } from "./hash.js";
import type { SampledFrame } from "./sample.js";

/**
 * Winnowing (PRD §4, decision D6). Group consecutive near-identical sampled frames
 * (Hamming distance <= threshold from the group's anchor) into "screen states" and pick
 * one representative per state. This is the ONLY deterministic step and it has no notion
 * of meaning — it just removes near-duplicates (cursor jitter, scrolling, highlight flicker
 * that leaves the screen otherwise unchanged). Which surviving frames matter is the LLM's
 * call, so this stays deliberately conservative (recall-biased): every distinct screen
 * survives; duplicates collapse.
 */

export interface CandidateFrame {
  timestamp: number;
  path: string;
}

/** Collapse a run of sampled frames into distinct representative frames. */
export async function winnowFrames(
  frames: SampledFrame[],
  hammingThreshold: number,
): Promise<CandidateFrame[]> {
  if (frames.length === 0) return [];

  const hashes: PerceptualHash[] = [];
  for (const frame of frames) {
    hashes.push(await perceptualHash(frame.path));
  }

  // Group consecutive frames by similarity to the group's anchor (the first frame of the
  // group), which avoids slow drift merging genuinely different screens.
  const groups: number[][] = [];
  let group: number[] = [0];
  let anchor = hashes[0]!;

  for (let i = 1; i < frames.length; i++) {
    if (hammingDistance(anchor, hashes[i]!) <= hammingThreshold) {
      group.push(i);
    } else {
      groups.push(group);
      group = [i];
      anchor = hashes[i]!;
    }
  }
  groups.push(group);

  // Representative = the middle frame of each group: past the transition into the screen,
  // and before the transition out — the most "settled" moment.
  return groups.map((g) => {
    const mid = g[Math.floor(g.length / 2)]!;
    const frame = frames[mid]!;
    return { timestamp: frame.timestamp, path: frame.path };
  });
}
