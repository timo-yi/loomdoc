import { stat } from "node:fs/promises";
import { runFfmpeg } from "../util/ffmpeg.js";
import { LoomdocError } from "../util/errors.js";

/**
 * On-demand exact-timestamp frame extraction (PRD decision D7).
 *
 * Backs the LLM's `getFrameAtTimestamp` tool and the final "cut the chosen screenshots"
 * step. Uses a fast input seek (`-ss` BEFORE `-i`), which fetches only the segment around
 * the timestamp — cheap even against a remote HLS stream. Because the source is always
 * available for a targeted seek, no frame is ever permanently lost by winnowing.
 *
 * Guards against a subtle ffmpeg behavior: seeking at/after the end of the stream exits 0
 * while writing no file. We verify a non-empty file was produced and raise a clear error
 * otherwise, so a bad timestamp never yields a doc with a silently missing screenshot.
 */
export async function extractFrameAt(
  streamUrl: string,
  timestampSeconds: number,
  outPath: string,
): Promise<string> {
  const ss = Math.max(0, timestampSeconds);
  await runFfmpeg([
    "-nostdin",
    "-loglevel",
    "error",
    "-y",
    "-ss",
    ss.toString(),
    "-i",
    streamUrl,
    "-frames:v",
    "1",
    "-q:v",
    "2",
    outPath,
  ]);

  let size = 0;
  try {
    size = (await stat(outPath)).size;
  } catch {
    size = 0;
  }
  if (size === 0) {
    throw new LoomdocError(
      `ffmpeg produced no frame at ${ss}s (likely past the end of the video).`,
    );
  }
  return outPath;
}
