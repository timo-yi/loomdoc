import type { TranscriptCue } from "../ingest/types.js";

/**
 * Parser for YouTube's native "json3" caption format (PRD decision D13).
 *
 * json3 is used instead of VTT because YouTube's auto-caption VTT is a "rolling" format:
 * each line is repeated across several cues (and in tiny 10ms cues) to animate the scroll,
 * so parsing it naively duplicates most of the transcript. In json3 each event carries only
 * its own words (`segs[].utf8`), with the start and duration in milliseconds. Events with no
 * text (window setup, the "\n" line-break appends) are skipped.
 */
export function parseYouTubeJson3(jsonText: string): TranscriptCue[] {
  let data: unknown;
  try {
    data = JSON.parse(jsonText);
  } catch {
    return [];
  }
  const events = (data as { events?: unknown } | null)?.events;
  if (!Array.isArray(events)) return [];

  const cues: TranscriptCue[] = [];
  for (const event of events) {
    if (!event || typeof event !== "object") continue;
    const e = event as { tStartMs?: unknown; dDurationMs?: unknown; segs?: unknown };
    if (!Array.isArray(e.segs) || typeof e.tStartMs !== "number") continue;

    const text = e.segs
      .map((seg) => (seg && typeof seg === "object" ? (seg as { utf8?: unknown }).utf8 : undefined))
      .filter((t): t is string => typeof t === "string")
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (text.length === 0) continue;

    const durationMs = typeof e.dDurationMs === "number" ? e.dDurationMs : 0;
    cues.push({ start: e.tStartMs / 1000, end: (e.tStartMs + durationMs) / 1000, text });
  }
  return cues;
}
