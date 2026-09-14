import { randomUUID } from "node:crypto";
import { LoomdocError } from "../util/errors.js";
import { parseVtt } from "../util/vtt.js";

/**
 * Loom ingestion (PRD decisions D1, D11).
 *
 * v1 targets public / unlisted share links only. This module is the single place that
 * knows anything about Loom's (unofficial) public endpoints, so if they change, the
 * break is contained here (PRD §9).
 *
 * Flow:
 *   1. Normalize the share URL -> 32-char video id.
 *   2. GraphQL `GetVideoSSR` for the title.
 *   3. POST /api/campaigns/sessions/{id}/transcoded-url (falling back to raw-url) for the
 *      short-lived signed HLS/MP4 stream URL.
 *   4. GraphQL `FetchVideoTranscript` -> a VTT captions URL -> fetched and parsed into cues.
 *
 * Signed CDN URLs expire quickly, so the returned streamUrl must be used promptly within
 * the same run and never cached.
 */

const GRAPHQL_ENDPOINT = "https://www.loom.com/graphql";
// Loom validates a client-source header. This mirrors what the web client sends; if Loom
// tightens validation, this constant is the first thing to revisit.
const REQUEST_SOURCE = "loom_web_0.0.0";

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
  /** Approximate; derived from the last transcript cue when Loom doesn't provide it. */
  durationSeconds: number;
  /** Signed HLS (.m3u8) or MP4 URL. Short-lived — do not cache. */
  streamUrl: string;
  transcript: TranscriptCue[];
}

/** Resolve a Loom share/embed URL (or a raw id) into its 32+ char hex video id. */
export function parseLoomUrl(url: string): string {
  const trimmed = url.trim();

  // Raw id passed directly.
  if (/^[0-9a-f]{32,}$/i.test(trimmed)) return trimmed.toLowerCase();

  // share/embed/record links, tolerating query strings and trailing slashes.
  const match = trimmed.match(/loom\.com\/(?:share|embed|record|v)\/([0-9a-f]{32,})/i);
  if (match?.[1]) return match[1].toLowerCase();

  throw new LoomdocError(
    `Could not find a Loom video id in "${url}". Expected a share link like ` +
      `https://www.loom.com/share/<id>.`,
  );
}

/** Fetch metadata, transcript, and a stream URL for a public/unlisted Loom video. */
export async function fetchLoomVideo(url: string): Promise<LoomVideo> {
  const id = parseLoomUrl(url);

  const title = await fetchTitle(id);
  const streamUrl = await fetchStreamUrl(id);
  const transcript = await fetchTranscript(id);

  const durationSeconds = transcript.length > 0 ? transcript[transcript.length - 1]!.end : 0;

  return { id, title, durationSeconds, streamUrl, transcript };
}

// --- internals -------------------------------------------------------------------------

async function graphql<T>(operationName: string, query: string, variables: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "apollographql-client-name": "web",
        "graphql-operation-name": operationName,
        "x-loom-request-source": REQUEST_SOURCE,
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

async function fetchTitle(id: string): Promise<string> {
  const query = `query GetVideoSSR($videoId: ID!, $password: String) {
    getVideo(id: $videoId, password: $password) {
      __typename
      ... on RegularUserVideo { id name }
    }
  }`;
  try {
    const data = await graphql<{ getVideo?: { name?: string | null } }>("GetVideoSSR", query, {
      videoId: id,
      password: null,
    });
    const name = data.getVideo?.name?.trim();
    return name && name.length > 0 ? name : `Loom video ${id.slice(0, 8)}`;
  } catch {
    // Title is non-critical; fall back rather than fail the whole run.
    return `Loom video ${id.slice(0, 8)}`;
  }
}

async function fetchStreamUrl(id: string): Promise<string> {
  // Prefer the transcoded (HLS) URL; fall back to the raw (original) URL.
  for (const endpoint of ["transcoded-url", "raw-url"]) {
    const url = await fetchSessionUrl(id, endpoint);
    if (url) return url;
  }
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
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        anonID: randomUUID(),
        deviceID: null,
        force_original: false,
        password: null,
      }),
    });
  } catch (err) {
    throw new LoomdocError(`Network error resolving stream URL: ${asMessage(err)}`);
  }

  if (!res.ok) return null;

  const json = (await res.json().catch(() => null)) as { url?: string } | null;
  return json?.url ?? null;
}

async function fetchTranscript(id: string): Promise<TranscriptCue[]> {
  const query = `query FetchVideoTranscript($videoId: ID!, $password: String) {
    fetchVideoTranscript(videoId: $videoId, password: $password) {
      __typename
      ... on VideoTranscriptDetails { captions_source_url source_url }
      ... on GenericError { message }
    }
  }`;

  const data = await graphql<{
    fetchVideoTranscript?:
      | { __typename: string; captions_source_url?: string | null; source_url?: string | null; message?: string };
  }>("FetchVideoTranscript", query, { videoId: id, password: null });

  const details = data.fetchVideoTranscript;
  const captionsUrl = details?.captions_source_url ?? details?.source_url;
  if (!captionsUrl) {
    throw new LoomdocError(
      `No transcript is available for this Loom video. loomdoc needs the transcript to work.`,
    );
  }

  let res: Response;
  try {
    res = await fetch(captionsUrl);
  } catch (err) {
    throw new LoomdocError(`Network error fetching transcript file: ${asMessage(err)}`);
  }
  if (!res.ok) {
    throw new LoomdocError(`Failed to download transcript file (HTTP ${res.status}).`);
  }

  const body = await res.text();
  const cues = parseVtt(body);
  if (cues.length === 0) {
    throw new LoomdocError(`Transcript file was empty or unparseable.`);
  }
  return cues;
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
