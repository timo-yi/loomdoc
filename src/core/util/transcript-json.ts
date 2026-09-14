import type { VttCue } from "./vtt.js";

/**
 * Tolerant parser for Loom's JSON transcript.
 *
 * Loom exposes a transcript in two forms: `captions_source_url` (VTT) and
 * `source_url` (JSON). Some public videos have only the JSON form ("json subs
 * only"), so ingest must handle it or it hard-fails on a video that genuinely has
 * a transcript (skeptic finding M1).
 *
 * The exact JSON shape is not officially documented, so this is deliberately
 * tolerant: it finds the segment array wherever it lives and reads timing/text from
 * whichever of several known field spellings are present. If it can't extract
 * anything it returns [] and the caller falls back or errors clearly. This should be
 * validated against a real json-only Loom when one is available.
 */
export function parseJsonTranscript(jsonText: string): VttCue[] {
  let data: unknown;
  try {
    data = JSON.parse(jsonText);
  } catch {
    return [];
  }

  const segments = findSegments(data);
  const cues: VttCue[] = [];
  for (const seg of segments) {
    if (!seg || typeof seg !== "object") continue;
    const o = seg as Record<string, unknown>;
    const start = num(o["start_time"] ?? o["startSeconds"] ?? o["start"] ?? o["ts"] ?? o["from"] ?? o["startTime"]);
    const end = num(o["end_time"] ?? o["endSeconds"] ?? o["end"] ?? o["to"] ?? o["endTime"]);
    const text = str(o["value"] ?? o["text"] ?? o["phrase"] ?? o["content"] ?? o["transcript"]);
    if (text.length > 0 && Number.isFinite(start)) {
      cues.push({ start, end: Number.isFinite(end) ? end : start, text });
    }
  }
  return cues;
}

function findSegments(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    for (const key of ["transcript", "segments", "phrases", "captions", "words", "results", "data"]) {
      if (Array.isArray(o[key])) return o[key] as unknown[];
    }
    for (const value of Object.values(o)) {
      if (Array.isArray(value)) return value;
    }
  }
  return [];
}

function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return NaN;
}

function str(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (Array.isArray(v)) return v.map(str).filter((s) => s.length > 0).join(" ");
  if (v && typeof v === "object") {
    const t = (v as Record<string, unknown>)["text"];
    if (typeof t === "string") return t.trim();
  }
  return "";
}
