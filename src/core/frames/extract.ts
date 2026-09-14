import { NotImplementedError } from "../util/errors.js";

/**
 * On-demand exact-timestamp frame extraction (PRD decision D7).
 *
 * Backs the LLM's `getFrameAtTimestamp` tool and the final "cut the chosen
 * screenshots" step. Uses a fast ffmpeg input seek, which fetches only the segment
 * around the timestamp — cheap even against a remote HLS stream:
 *   `ffmpeg -ss <ts> -i <stream> -frames:v 1 <out>.png`
 *
 * Because the source is always available for a targeted seek, no frame is ever
 * permanently lost by winnowing.
 */

/** Extract a single frame at `timestampSeconds` into `outPath`. Returns outPath. */
export async function extractFrameAt(
  _streamUrl: string,
  _timestampSeconds: number,
  _outPath: string,
): Promise<string> {
  throw new NotImplementedError("frames/extract.extractFrameAt");
}
