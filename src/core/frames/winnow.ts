import { changedFraction, computeSignature, type Signature } from "./signature.js";
import type { SampledFrame } from "./sample.js";
import type { FrameOptions } from "../types.js";

/**
 * Winnowing with a stability gate (PRD §4, decision D6). This is the ONLY deterministic
 * step, and it has no notion of meaning — it decides which frames are worth showing the LLM.
 *
 * Two ideas:
 *   1. Skip frames while the screen is IN MOTION (a scroll, an animation, a page load). A
 *      frame is "moving" if it differs from the next frame by more than `motionThreshold`.
 *      This avoids emitting blurry mid-transition frames.
 *   2. Among settled frames, emit one representative each time the screen reaches a new
 *      distinct state — i.e. it differs from the last emitted representative by at least
 *      `sameScreenThreshold`. Cursor-only movement is below that floor, so it collapses;
 *      a dropdown / selection / typed text is above it, so it survives.
 *
 * Deliberately recall-biased: it errs toward emitting an extra candidate rather than dropping
 * a real step, because the vision LLM is the judge of what actually matters (PRD D5/D7).
 */

export interface CandidateFrame {
  timestamp: number;
  path: string;
}

const HASH_CONCURRENCY = 8;

export async function winnowFrames(
  frames: SampledFrame[],
  options: FrameOptions,
): Promise<CandidateFrame[]> {
  if (frames.length === 0) return [];

  const signatures = await mapLimit(frames, HASH_CONCURRENCY, (f) => computeSignature(f.path));
  const { pixelDelta, motionThreshold, sameScreenThreshold } = options;
  const n = frames.length;

  // moving[i]: the screen is actively changing between frame i and i+1. The last frame is
  // settled by definition.
  const moving: boolean[] = [];
  for (let i = 0; i < n - 1; i++) {
    moving.push(changedFraction(signatures[i]!, signatures[i + 1]!, pixelDelta) > motionThreshold);
  }
  moving.push(false);

  // A frame is a settle point if it stays quiet through the dwell window.
  const dwellFrames = Math.max(1, Math.round(options.dwellSeconds * options.sampleFps));
  const isSettled = (i: number): boolean => {
    for (let k = 0; k < dwellFrames && i + k < n; k++) {
      if (moving[i + k]) return false;
    }
    return true;
  };

  const keptIndices: number[] = [];
  let lastSig: Signature | null = null;
  for (let i = 0; i < n; i++) {
    if (!isSettled(i)) continue;
    const sig = signatures[i]!;
    if (lastSig === null || changedFraction(sig, lastSig, pixelDelta) >= sameScreenThreshold) {
      keptIndices.push(i);
      lastSig = sig;
    }
  }

  const capped = capCandidates(keptIndices, signatures, pixelDelta, options.maxCandidates);
  return capped.map((i) => ({ timestamp: frames[i]!.timestamp, path: frames[i]!.path }));
}

/**
 * Enforce the candidate cap (the cost lever, PRD §6) by repeatedly dropping the least-distinct
 * screen — the one most similar to its predecessor — so the surviving set stays maximally
 * distinct. The first frame is always kept.
 */
function capCandidates(
  indices: number[],
  signatures: Signature[],
  pixelDelta: number,
  maxCandidates: number,
): number[] {
  if (maxCandidates <= 0 || indices.length <= maxCandidates) return indices;
  const kept = [...indices];
  while (kept.length > maxCandidates) {
    let minPos = 1;
    let minVal = Infinity;
    for (let p = 1; p < kept.length; p++) {
      const d = changedFraction(signatures[kept[p]!]!, signatures[kept[p - 1]!]!, pixelDelta);
      if (d < minVal) {
        minVal = d;
        minPos = p;
      }
    }
    kept.splice(minPos, 1);
  }
  return kept;
}

/** Run `fn` over `items` with bounded concurrency, preserving order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!);
    }
  };
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
