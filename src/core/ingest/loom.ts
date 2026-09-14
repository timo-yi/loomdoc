import { NotImplementedError } from "../util/errors.js";

/**
 * Loom ingestion (PRD decision D1, D11).
 *
 * v1 targets public / unlisted share links only. This module is the single place
 * that knows anything about Loom's (unofficial) public endpoints, so if they change,
 * the break is contained here.
 *
 * Intended implementation:
 *   1. Normalize the share URL -> video id.
 *   2. Call Loom's public GraphQL (GetVideoSSR + FetchVideoTranscript) for metadata
 *      and the transcript resource, OR read the SSR JSON blob embedded in the share page.
 *   3. Return the timestamped transcript plus the signed HLS/MP4 stream URL.
 *
 * Note: signed CDN URLs expire quickly — callers should use the returned streamUrl
 * promptly within the same run and not cache it (PRD §9).
 */

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
  durationSeconds: number;
  /** Signed HLS (.m3u8) or MP4 URL. Short-lived. */
  streamUrl: string;
  transcript: TranscriptCue[];
}

/** Resolve a Loom share URL into its video id. */
export function parseLoomUrl(_url: string): string {
  // TODO: handle share links, embed links, iframe snippets, and raw ids.
  throw new NotImplementedError("ingest/loom.parseLoomUrl");
}

/** Fetch metadata, transcript, and stream URL for a public/unlisted Loom video. */
export async function fetchLoomVideo(_url: string): Promise<LoomVideo> {
  // TODO: implement the GraphQL/SSR fetch described above.
  throw new NotImplementedError("ingest/loom.fetchLoomVideo");
}
