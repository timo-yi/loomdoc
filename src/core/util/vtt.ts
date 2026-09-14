/**
 * Minimal WebVTT parser. Loom serves auto-captions as a VTT file with per-cue
 * timestamps; that's the timestamped transcript loomdoc feeds to the LLM.
 *
 * Dependency-free and defensive. It is line-driven (not block-split) so that a
 * "blank" separator line containing stray spaces or tabs cannot silently merge
 * two cues and drop transcript text. It skips the header, NOTE/STYLE/REGION
 * blocks, and cue-identifier lines; tolerates `.`/`,` millisecond separators,
 * `hh:mm:ss` and `mm:ss` forms, hours of any length, and CRLF; strips inline VTT
 * tags; and decodes the standard character references.
 */

export interface VttCue {
  /** Start time in seconds. */
  start: number;
  /** End time in seconds. */
  end: number;
  text: string;
}

// Hours may be any number of digits (spec allows >99h); minutes/seconds are two.
const TIME = String.raw`(\d+:\d{2}:\d{2}[.,]\d{1,3}|\d+:\d{2}[.,]\d{1,3})`;
const CUE_TIMING = new RegExp(`${TIME}\\s*-->\\s*${TIME}`);

export function parseVtt(vtt: string): VttCue[] {
  const cues: VttCue[] = [];
  const lines = vtt
    .replace(/^﻿/, "") // strip BOM
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n");

  let i = 0;
  while (i < lines.length) {
    const match = CUE_TIMING.exec(lines[i]!);
    if (!match) {
      i++;
      continue;
    }
    const start = parseTimestamp(match[1]!);
    const end = parseTimestamp(match[2]!);
    i++;

    // Text runs until a blank (whitespace-only) line or the next timing line.
    const textLines: string[] = [];
    while (i < lines.length) {
      const raw = lines[i]!;
      if (raw.trim().length === 0 || raw.includes("-->")) break;
      textLines.push(raw.trim());
      i++;
    }

    const text = decodeEntities(stripTags(textLines.join(" "))).trim();
    if (text.length > 0 && Number.isFinite(start) && Number.isFinite(end)) {
      cues.push({ start, end, text });
    }
  }

  return cues;
}

/** Parse `hh:mm:ss.mmm` / `mm:ss.mmm` (or `,` variant) into seconds. */
export function parseTimestamp(ts: string): number {
  const parts = ts.replace(",", ".").split(":");
  let seconds = 0;
  for (const part of parts) {
    seconds = seconds * 60 + Number(part);
  }
  return seconds;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "");
}

/**
 * Decode the character references WebVTT requires. `&amp;` is decoded last so an
 * encoded `&amp;lt;` becomes the literal text `&lt;` rather than being over-decoded.
 * Tags are stripped before this runs, so decoding `&lt;`/`&gt;` cannot forge tags.
 */
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => fromCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => fromCode(parseInt(d, 10)))
    .replace(/&nbsp;/g, " ")
    .replace(/&lrm;/g, "‎")
    .replace(/&rlm;/g, "‏")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function fromCode(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}
