import { LoomdocError } from "../util/errors.js";
import { fetchLoomVideo, parseLoomUrl } from "./loom.js";
import { fetchYouTubeVideo, isYouTubeUrl } from "./youtube.js";
import type { SourceVideo, VideoSource } from "./types.js";

export type { SourceVideo, TranscriptCue, VideoSource } from "./types.js";

/** Which source a URL belongs to. Throws a clear error for anything unsupported. */
export function detectSource(url: string): VideoSource {
  if (isYouTubeUrl(url)) return "youtube";
  try {
    parseLoomUrl(url);
    return "loom";
  } catch {
    throw new LoomdocError(
      `Unsupported video URL "${url}". loomdoc accepts Loom share links ` +
        `(https://www.loom.com/share/<id>) and YouTube links (https://www.youtube.com/watch?v=<id>).`,
    );
  }
}

/**
 * Resolve any supported URL into a SourceVideo whose video track is downloaded into
 * `scratchDir`. The caller owns `scratchDir` and its cleanup.
 */
export function fetchVideo(url: string, scratchDir: string): Promise<SourceVideo> {
  return detectSource(url) === "youtube" ? fetchYouTubeVideo(url, scratchDir) : fetchLoomVideo(url, scratchDir);
}
