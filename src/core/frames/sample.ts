import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { runFfmpeg } from "../util/ffmpeg.js";

/**
 * Frame sampling (PRD §4). Sample the video at a modest rate (default ~2 fps) into a
 * scratch directory, so downstream steps inspect a manageable number of frames rather
 * than every frame.
 */

export interface SampledFrame {
  /** Seconds into the video (approximate: sample index / fps). */
  timestamp: number;
  /** Path to the sampled image on disk. */
  path: string;
}

const FRAME_RE = /^frame-(\d+)\.png$/;

/** Sample frames from a stream URL into `workDir` at `fps`. */
export async function sampleFrames(
  streamUrl: string,
  workDir: string,
  fps: number,
): Promise<SampledFrame[]> {
  const pattern = join(workDir, "frame-%06d.png");
  await runFfmpeg([
    "-nostdin",
    "-loglevel",
    "error",
    "-y",
    "-i",
    streamUrl,
    "-vf",
    `fps=${fps}`,
    pattern,
  ]);

  const entries = (await readdir(workDir))
    .map((name) => ({ name, match: FRAME_RE.exec(name) }))
    .filter((e): e is { name: string; match: RegExpExecArray } => e.match !== null)
    // Sort by the numeric frame index, not lexically.
    .sort((a, b) => Number(a.match[1]) - Number(b.match[1]));

  // ffmpeg's fps filter emits frames spaced 1/fps apart, with index 1 near t=0.
  return entries.map((e, idx) => ({
    timestamp: idx / fps,
    path: join(workDir, e.name),
  }));
}
