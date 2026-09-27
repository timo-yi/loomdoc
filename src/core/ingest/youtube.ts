import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { LoomdocError } from "../util/errors.js";
import { runYtDlp } from "../util/ytdlp.js";
import { assertNonEmptyFile } from "../util/download.js";
import { parseYouTubeJson3 } from "../util/youtube-json3.js";
import type { SourceVideo, TranscriptCue } from "./types.js";

/**
 * YouTube ingestion (PRD decision D13), via the `yt-dlp` binary.
 *
 * Flow:
 *   1. Normalize the URL -> 11-char video id -> canonical watch URL (drops playlist/time
 *      params so yt-dlp fetches exactly one video).
 *   2. `yt-dlp -J` -> title, duration, language, and the available caption tracks.
 *   3. Pick one caption track (creator-uploaded first, then the original-language auto
 *      captions). Fail here, before any download, if there is none: loomdoc needs a transcript.
 *   4. One yt-dlp call downloads the video track (<= 1080p is plenty for readable screenshots)
 *      and that caption track as json3 into the run's scratch dir (PRD D14).
 *
 * Like the Loom module, this is the one place that knows anything about YouTube.
 */

const ID_RE = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = ["youtube.com", "youtube-nocookie.com"];
/** Path prefixes whose next segment is the video id. */
const ID_PATH_PREFIXES = new Set(["shorts", "embed", "live", "v", "e"]);

/** True if `url` points at a YouTube host. Says nothing about whether it holds a video id. */
export function isYouTubeUrl(url: string): boolean {
  const host = hostOf(url);
  if (!host) return false;
  return host === "youtu.be" || YOUTUBE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

/** Resolve a YouTube watch/short/embed/live/youtu.be URL into its 11-char video id. */
export function parseYouTubeUrl(url: string): string {
  const parsed = toUrl(url);
  const host = parsed?.hostname.toLowerCase();
  let id: string | null | undefined = null;

  if (parsed && host === "youtu.be") {
    id = parsed.pathname.split("/")[1];
  } else if (parsed && isYouTubeUrl(url)) {
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments[0] === "watch") id = parsed.searchParams.get("v");
    else if (segments[0] && ID_PATH_PREFIXES.has(segments[0])) id = segments[1];
  }

  if (id && ID_RE.test(id)) return id;
  throw new LoomdocError(
    `Could not find a YouTube video id in "${url}". Expected a link like ` +
      `https://www.youtube.com/watch?v=<id> or https://youtu.be/<id>.`,
  );
}

/** The subset of `yt-dlp -J` output loomdoc reads. */
export interface YouTubeMetadata {
  id?: string;
  title?: string;
  duration?: number | null;
  language?: string | null;
  live_status?: string | null;
  subtitles?: Record<string, CaptionFormat[] | undefined> | null;
  automatic_captions?: Record<string, CaptionFormat[] | undefined> | null;
}

interface CaptionFormat {
  ext?: string;
}

export interface CaptionChoice {
  lang: string;
  /** True for YouTube's speech-recognition captions, false for creator-uploaded ones. */
  automatic: boolean;
}

/**
 * Choose the caption track to use as the transcript.
 *
 * Creator-uploaded captions beat auto captions (they are usually edited). For uploaded
 * tracks, prefer the video's own language, then English, then whatever exists. For auto
 * captions, only the original-language track is real speech recognition; YouTube also lists
 * machine translations of it into every language, which would be a lossy second hop, so
 * those are never chosen. Only tracks YouTube serves as json3 are eligible.
 */
export function chooseCaptionTrack(meta: YouTubeMetadata): CaptionChoice | null {
  const hasJson3 = (formats: CaptionFormat[] | undefined): boolean =>
    Array.isArray(formats) && formats.some((f) => f.ext === "json3");

  const lang = meta.language?.toLowerCase() ?? null;

  const manual = Object.entries(meta.subtitles ?? {})
    .filter(([key, formats]) => key !== "live_chat" && hasJson3(formats))
    .map(([key]) => key);
  const manualPick =
    (lang ? manual.find((k) => matchesLang(k, lang)) : undefined) ??
    manual.find((k) => matchesLang(k, "en")) ??
    manual[0];
  if (manualPick) return { lang: manualPick, automatic: false };

  const auto = meta.automatic_captions ?? {};
  const autoCandidates = [
    ...(lang ? [`${lang}-orig`, lang] : []),
    // Language unknown: the "-orig" track is the original speech, whatever the language.
    ...Object.keys(auto).filter((k) => k.endsWith("-orig")),
  ];
  const autoPick = autoCandidates.find((k) => hasJson3(auto[k]));
  if (autoPick) return { lang: autoPick, automatic: true };

  return null;
}

/**
 * Fetch metadata and transcript for a public/unlisted YouTube video, and download its video
 * track into `scratchDir`.
 */
export async function fetchYouTubeVideo(url: string, scratchDir: string): Promise<SourceVideo> {
  const id = parseYouTubeUrl(url);
  const watchUrl = `https://www.youtube.com/watch?v=${id}`;

  const meta = await fetchMetadata(watchUrl);
  if (meta.live_status === "is_live" || meta.live_status === "is_upcoming") {
    throw new LoomdocError("This YouTube video is a live or upcoming stream. Try again once it has ended.");
  }

  const caption = chooseCaptionTrack(meta);
  if (!caption) {
    throw new LoomdocError(
      "No usable captions are available for this YouTube video (neither uploaded nor automatic). " +
        "loomdoc needs the transcript to work.",
    );
  }

  const stdout = await runYtDlp([
    "--no-playlist",
    "--no-progress",
    "--no-warnings",
    // Video only (loomdoc never uses audio), preferring the largest size up to 1080p and
    // H.264, which every ffmpeg build decodes quickly.
    "-f",
    "bv*/b",
    "-S",
    "res:1080,vcodec:h264",
    "-o",
    join(scratchDir, "video.%(ext)s"),
    "-o",
    `subtitle:${join(scratchDir, "captions.%(ext)s")}`,
    caption.automatic ? "--write-auto-subs" : "--write-subs",
    "--sub-langs",
    caption.lang,
    "--sub-format",
    "json3",
    "--print",
    "after_move:filepath",
    watchUrl,
  ]);

  const videoPath = stdout.trim().split("\n").pop()?.trim();
  if (!videoPath) throw new LoomdocError("yt-dlp did not report where it saved the video.");
  await assertNonEmptyFile(videoPath, "YouTube video download");

  const transcript = await readCaptions(scratchDir);
  const lastCueEnd = transcript.length > 0 ? transcript[transcript.length - 1]!.end : 0;
  const duration = typeof meta.duration === "number" && meta.duration > 0 ? meta.duration : lastCueEnd;
  const title = meta.title?.trim() || `YouTube video ${id}`;

  return { source: "youtube", id, title, durationSeconds: duration, videoPath, transcript };
}

async function fetchMetadata(watchUrl: string): Promise<YouTubeMetadata> {
  const stdout = await runYtDlp(["-J", "--no-playlist", "--no-warnings", "--skip-download", watchUrl]);
  try {
    return JSON.parse(stdout) as YouTubeMetadata;
  } catch {
    throw new LoomdocError("yt-dlp returned metadata loomdoc could not parse.");
  }
}

async function readCaptions(scratchDir: string): Promise<TranscriptCue[]> {
  const file = (await readdir(scratchDir)).find((n) => n.startsWith("captions.") && n.endsWith(".json3"));
  if (!file) throw new LoomdocError("yt-dlp did not download the YouTube captions.");
  const cues = parseYouTubeJson3(await readFile(join(scratchDir, file), "utf8"));
  if (cues.length === 0) throw new LoomdocError("The YouTube captions were empty or unparseable.");
  return cues;
}

/** `key` is `lang` itself or a regional/variant form of it (en, en-US, en-GB). */
function matchesLang(key: string, lang: string): boolean {
  const k = key.toLowerCase();
  return k === lang || k.startsWith(`${lang}-`);
}

function toUrl(url: string): URL | null {
  const trimmed = url.trim();
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
}

function hostOf(url: string): string | null {
  return toUrl(url)?.hostname.toLowerCase() ?? null;
}
