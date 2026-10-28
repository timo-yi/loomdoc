import { LoomdocError } from "../util/errors.js";
import { fetchLoomVideo, parseLoomUrl } from "./loom.js";
import { fetchYouTubeVideo, isYouTubeUrl } from "./youtube.js";
import type { SourceVideo, VideoSource } from "./types.js";

export type { SourceVideo, TranscriptCue, VideoSource } from "./types.js";

interface SourceAdapter {
  matches(url: string): boolean;
  /** Download the video track into `scratchDir` and return its transcript and metadata. */
  fetch(url: string, scratchDir: string): Promise<SourceVideo>;
}

/**
 * Every supported source. Keyed by VideoSource so the compiler rejects a source that is added
 * to the union without a matcher and a fetcher. Checked in key order.
 */
const SOURCES: Record<VideoSource, SourceAdapter> = {
  youtube: { matches: isYouTubeUrl, fetch: fetchYouTubeVideo },
  loom: {
    matches: (url) => {
      try {
        parseLoomUrl(url);
        return true;
      } catch {
        return false;
      }
    },
    fetch: fetchLoomVideo,
  },
};

/** Which source a URL belongs to. Throws a clear error for anything unsupported. */
export function detectSource(url: string): VideoSource {
  for (const [source, adapter] of Object.entries(SOURCES) as [VideoSource, SourceAdapter][]) {
    if (adapter.matches(url)) return source;
  }
  throw new LoomdocError(
    "UNSUPPORTED_URL",
    `Unsupported video URL "${url}". loomdoc accepts Loom share links ` +
      `(https://www.loom.com/share/<id>) and YouTube links (https://www.youtube.com/watch?v=<id>).`,
  );
}

/**
 * Resolve any supported URL into a SourceVideo whose video track is downloaded into
 * `scratchDir`. The caller owns `scratchDir` and its cleanup.
 */
export function fetchVideo(url: string, scratchDir: string): Promise<SourceVideo> {
  return SOURCES[detectSource(url)].fetch(url, scratchDir);
}
