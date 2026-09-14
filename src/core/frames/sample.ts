import { NotImplementedError } from "../util/errors.js";

/**
 * Frame sampling (PRD §4). Sample the video at a modest rate (default ~2 fps) so
 * downstream steps inspect a manageable number of frames rather than every frame.
 */

export interface SampledFrame {
  /** Seconds into the video. */
  timestamp: number;
  /** Path to the sampled image on disk. */
  path: string;
}

/**
 * Sample frames from a stream URL into `workDir` at `fps`.
 * Intended: `ffmpeg -i <stream> -vf fps=<fps> <workDir>/frame-%06d.png`, then map
 * frame indices back to timestamps.
 */
export async function sampleFrames(
  _streamUrl: string,
  _workDir: string,
  _fps: number,
): Promise<SampledFrame[]> {
  throw new NotImplementedError("frames/sample.sampleFrames");
}
