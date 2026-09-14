import { runFfmpeg } from "../util/ffmpeg.js";

/**
 * On-demand exact-timestamp frame extraction (PRD decision D7).
 *
 * Backs the LLM's `getFrameAtTimestamp` tool and the final "cut the chosen screenshots"
 * step. Uses a fast input seek (`-ss` BEFORE `-i`), which fetches only the segment around
 * the timestamp — cheap even against a remote HLS stream. Because the source is always
 * available for a targeted seek, no frame is ever permanently lost by winnowing.
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
  return outPath;
}
