import { randomUUID } from "node:crypto";
import { LoomdocError } from "../util/errors.js";
import { parseVtt } from "../util/vtt.js";
import { parseJsonTranscript } from "../util/transcript-json.js";

/**
 * Loom ingestion (PRD decisions D1, D11).
 *
 * v1 targets public / unlisted share links only. This module is the single place that
 * knows anything about Loom's (unofficial) public endpoints, so if they change, the
 * break is contained here (PRD §9).
 *
 * Flow:
 *   1. Normalize the share URL -> 32-char video id.
 *   2. GraphQL GetVideoSSR -> title + duration.
 *   3. Resolve a short-lived signed stream URL, trying in order:
 *        POST /api/campaigns/sessions/{id}/transcoded-url
 *        POST /api/campaigns/sessions/{id}/raw-url
 *        GraphQL GetVideoSource -> nullableRawCdnUrl (Loom's REST media endpoints are
 *        documented to intermittently return empty/errors, so this CDN fallback matters).
 *   4. GraphQL FetchVideoTranscript -> a VTT captions URL and/or a JSON transcript URL,
 *      fetched and parsed into cues (either format is accepted).
 *
 * Header values and endpoint shapes mirror the yt-dlp Loom extractor, the authoritative
 * reference client. Signed CDN URLs expire quickly, so the returned streamUrl must be
 * used promptly within the same run and never cached.
 */

const GRAPHQL_ENDPOINT = "https://www.loom.com/graphql";
// Mirrors the web client's Apollo version. Loom sends this on every GraphQL call and may
// validate it or the Origin header for anti-abuse; this is the first thing to revisit if
// GraphQL calls start returning 403.
const APOLLO_VERSION = "45a5bd4";

export interface TranscriptCue {
  /** Start time in seconds. */
  start: number;
  /** End time in seconds. */
  end: number;
  text: string;
}

export interface LoomVideo {
  id: string;
  title: string;
  /** From Loom metadata; falls back to the last transcript cue's end only if absent. */
  durationSeconds: number;
  /** Signed HLS (.m3u8) or MP4 URL. Short-lived — do not cache. */
  streamUrl: string;
  transcript: TranscriptCue[];
}

/** Resolve a Loom share/embed URL (or a raw id) into its 32-char hex video id. */
export function parseLoomUrl(url: string): string {
  const trimmed = url.trim();

  // Raw id passed directly (exactly 32 hex chars).
  if (/^[0-9a-f]{32}$/i.test(trimmed)) return trimmed.toLowerCase();

  // share/embed/record links; the negative lookahead prevents over-capturing a longer
  // hex run, and the boundary keeps it to exactly 32 chars.
  const match = trimmed.match(/loom\.com\/(?:share|embed|record|v)\/([0-9a-f]{32})(?![0-9a-f])/i);
  if (match?.[1]) return match[1].toLowerCase();

  throw new LoomdocError(
    `Could not find a Loom video id in "${url}". Expected a share link like ` +
      `https://www.loom.com/share/<32-hex-id>.`,
  );
}

/** Fetch metadata, transcript, and a stream URL for a public/unlisted Loom video. */
export async function fetchLoomVideo(url: string): Promise<LoomVideo> {
  const id = parseLoomUrl(url);

  const meta = await fetchMetadata(id);
  const streamUrl = await fetchStreamUrl(id);
  const transcript = await fetchTranscript(id);

  const lastCueEnd = transcript.length > 0 ? transcript[transcript.length - 1]!.end : 0;
  const durationSeconds = meta.duration ?? lastCueEnd;

  return { id, title: meta.title, durationSeconds, streamUrl, transcript };
}

// --- GraphQL ---------------------------------------------------------------------------

async function graphql<T>(operationName: string, query: string, variables: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        origin: "https://www.loom.com",
        "apollographql-client-name": "web",
        "apollographql-client-version": APOLLO_VERSION,
        "graphql-operation-name": operationName,
        "x-loom-request-source": `loom_web_${APOLLO_VERSION}`,
      },
      body: JSON.stringify({ operationName, query, variables }),
    });
  } catch (err) {
    throw new LoomdocError(`Network error contacting Loom (${operationName}): ${asMessage(err)}`);
  }

  if (!res.ok) {
    throw new LoomdocError(`Loom GraphQL ${operationName} failed with HTTP ${res.status}.`);
  }

  const json = (await res.json()) as { data?: T; errors?: Array<{ message?: string }> };
  if (json.errors?.length) {
    throw new LoomdocError(`Loom GraphQL ${operationName} error: ${json.errors[0]?.message ?? "unknown"}`);
  }
  if (!json.data) {
    throw new LoomdocError(`Loom GraphQL ${operationName} returned no data.`);
  }
  return json.data;
}

interface Metadata {
  title: string;
  duration?: number;
}

async function fetchMetadata(id: string): Promise<Metadata> {
  const query = `query GetVideoSSR($videoId: ID!, $password: String) {
    getVideo(id: $videoId, password: $password) {
      __typename
      ... on RegularUserVideo { id name video_properties { duration } }
    }
  }`;
  try {
    const data = await graphql<{
      getVideo?: { name?: string | null; video_properties?: { duration?: number | null } | null };
    }>("GetVideoSSR", query, { videoId: id, password: null });

    const name = data.getVideo?.name?.trim();
    const duration = data.getVideo?.video_properties?.duration;
    return {
      title: name && name.length > 0 ? name : `Loom video ${id.slice(0, 8)}`,
      duration: typeof duration === "number" && duration > 0 ? duration : undefined,
    };
  } catch {
    // Metadata is non-critical; a run can proceed with a fallback title and a
    // transcript-derived duration. The transcript step still surfaces real API breakage.
    return { title: `Loom video ${id.slice(0, 8)}` };
  }
}

// --- Stream URL ------------------------------------------------------------------------

async function fetchStreamUrl(id: string): Promise<string> {
  for (const endpoint of ["transcoded-url", "raw-url"]) {
    const url = await fetchSessionUrl(id, endpoint);
    if (url) return assertHttpUrl(url, "stream");
  }

  // Loom's REST media endpoints intermittently return empty/errors; the CDN GraphQL
  // query is the documented fallback.
  const cdnUrl = await fetchCdnUrl(id);
  if (cdnUrl) return assertHttpUrl(cdnUrl, "stream");

  throw new LoomdocError(
    `Could not resolve a video stream URL for ${id}. The video may be private, deleted, ` +
      `or password-protected (v1 supports public/unlisted links only).`,
  );
}

async function fetchSessionUrl(id: string, endpoint: string): Promise<string | null> {
  const apiUrl = `https://www.loom.com/api/campaigns/sessions/${id}/${endpoint}`;
  let res: Response;
  try {
    res = await fetch(apiUrl, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        anonID: randomUUID(),
        deviceID: null,
        force_original: false, // true can 401
        password: null,
      }),
    });
  } catch {
    // Transient error on this endpoint: let the caller try the next fallback rather than abort.
    return null;
  }

  if (!res.ok) return null;
  const json = (await res.json().catch(() => null)) as { url?: string } | null;
  return json?.url ?? null;
}

async function fetchCdnUrl(id: string): Promise<string | null> {
  // acceptableMimes is passed as inline enum values to avoid depending on the exact
  // GraphQL input-type name; an invalid query degrades to null rather than throwing.
  const query = `query GetVideoSource($videoId: ID!, $password: String) {
    getVideo(id: $videoId, password: $password) {
      __typename
      ... on RegularUserVideo {
        nullableRawCdnUrl(acceptableMimes: [DASH, M3U8, MP4, WEBM]) { url }
      }
    }
  }`;
  try {
    const data = await graphql<{
      getVideo?: { nullableRawCdnUrl?: { url?: string | null } | null };
    }>("GetVideoSource", query, { videoId: id, password: null });
    return data.getVideo?.nullableRawCdnUrl?.url ?? null;
  } catch {
    return null;
  }
}

// --- Transcript ------------------------------------------------------------------------

async function fetchTranscript(id: string): Promise<TranscriptCue[]> {
  const query = `query FetchVideoTranscript($videoId: ID!, $password: String) {
    fetchVideoTranscript(videoId: $videoId, password: $password) {
      __typename
      ... on VideoTranscriptDetails { captions_source_url source_url }
      ... on GenericError { message }
    }
  }`;

  const data = await graphql<{
    fetchVideoTranscript?: {
      __typename: string;
      captions_source_url?: string | null;
      source_url?: string | null;
      message?: string;
    };
  }>("FetchVideoTranscript", query, { videoId: id, password: null });

  const details = data.fetchVideoTranscript;
  // Try the VTT captions first, then the JSON transcript ("json subs only" videos).
  const urls = [details?.captions_source_url, details?.source_url].filter(
    (u): u is string => typeof u === "string" && u.length > 0,
  );
  if (urls.length === 0) {
    throw new LoomdocError(
      `No transcript is available for this Loom video. loomdoc needs the transcript to work.`,
    );
  }

  for (const url of urls) {
    const cues = await downloadCues(url);
    if (cues.length > 0) return cues;
  }

  throw new LoomdocError(`Loom returned a transcript URL but it was empty or unparseable.`);
}

/** Fetch a transcript file and parse it, auto-detecting VTT vs JSON. */
async function downloadCues(url: string): Promise<TranscriptCue[]> {
  assertHttpUrl(url, "transcript");
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new LoomdocError(`Network error fetching transcript file: ${asMessage(err)}`);
  }
  if (!res.ok) {
    throw new LoomdocError(`Failed to download transcript file (HTTP ${res.status}).`);
  }

  const body = await res.text();
  const vttCues = parseVtt(body);
  if (vttCues.length > 0) return vttCues;
  return parseJsonTranscript(body);
}

// --- helpers ---------------------------------------------------------------------------

/** Guard a Loom-returned URL before we fetch it or hand it to ffmpeg. */
function assertHttpUrl(u: string, what: string): string {
  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    throw new LoomdocError(`Loom returned an invalid ${what} URL.`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new LoomdocError(`Refusing non-HTTP ${what} URL from Loom (${parsed.protocol}).`);
  }
  return u;
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
