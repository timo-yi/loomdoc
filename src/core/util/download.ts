import { stat } from "node:fs/promises";
import { join } from "node:path";
import { runFfmpeg } from "./ffmpeg.js";
import { LoomdocError } from "./errors.js";

/**
 * Download a remote stream's video track to a local file (PRD decision D14).
 *
 * Stream-copies (no re-encode) the best video stream ffmpeg selects (for an HLS master
 * playlist, the highest resolution) and drops audio and subtitles, which loomdoc never uses.
 * Matroska accepts any codec a source may serve (H.264, VP9, AV1) and seeks well, so every
 * later ffmpeg step reads from local disk instead of a short-lived signed URL.
 */
export async function downloadVideoTrack(streamUrl: string, destDir: string): Promise<string> {
  const outPath = join(destDir, "video.mkv");
  await runFfmpeg([
    "-nostdin",
    "-loglevel",
    "error",
    "-y",
    // Abort a socket that stops delivering for 15s (microseconds). Covers a plain HTTP stream
    // stalling mid-body; HLS segment stalls fall back to the runFfmpeg progress watchdog.
    // Network inputs only — ffmpeg rejects `-timeout` on local-file inputs.
    ...(/^https?:\/\//i.test(streamUrl) ? ["-timeout", "15000000"] : []),
    "-i",
    streamUrl,
    "-an",
    "-sn",
    "-dn",
    "-c",
    "copy",
    outPath,
  ]);
  await assertNonEmptyFile(outPath, "video download");
  return outPath;
}

export async function assertNonEmptyFile(path: string, what: string): Promise<void> {
  let size = 0;
  try {
    size = (await stat(path)).size;
  } catch {
    size = 0;
  }
  if (size === 0) throw new LoomdocError("TOOL_FAILED", `The ${what} produced no data.`);
}
