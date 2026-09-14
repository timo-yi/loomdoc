import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { runFfmpeg } from "../util/ffmpeg.js";

/**
 * Frame sampling (PRD §4). Sample the video at a modest rate (default ~2 fps) into a
 * scratch directory as JPEGs (small; these are throwaway inputs to the winnower, not the
 * final screenshots), so downstream steps inspect a manageable number of frames.
 */

export interface SampledFrame {
  /** Seconds into the video. */
  timestamp: number;
  /** Path to the sampled image on disk. */
  path: string;
}

const FRAME_RE = /^frame-(\d+)\.jpg$/;

/** Sample frames from a stream URL into `workDir` at `fps`. */
export async function sampleFrames(
  streamUrl: string,
  workDir: string,
  fps: number,
): Promise<SampledFrame[]> {
  const pattern = join(workDir, "frame-%06d.jpg");
  await runFfmpeg([
    "-nostdin",
    "-loglevel",
    "error",
    "-y",
    "-i",
    streamUrl,
    "-vf",
    `fps=${fps}`,
    "-q:v",
    "3",
    pattern,
  ]);

  const entries = (await readdir(workDir))
    .map((name) => ({ name, match: FRAME_RE.exec(name) }))
    .filter((e): e is { name: string; match: RegExpExecArray } => e.match !== null)
    // Sort by the numeric frame index, not lexically.
    .sort((a, b) => Number(a.match[1]) - Number(b.match[1]));

  // ffmpeg's fps filter centers each output sample in the middle of its interval, so
  // sample index `idx` corresponds to time (idx + 0.5) / fps, not idx / fps.
  return entries.map((e, idx) => ({
    timestamp: (idx + 0.5) / fps,
    path: join(workDir, e.name),
  }));
}
