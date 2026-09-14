/**
 * Minimal WebVTT parser. Loom serves auto-captions as a VTT file with per-cue
 * timestamps; that's the timestamped transcript loomdoc feeds to the LLM.
 *
 * Kept dependency-free and defensive: it skips the header, NOTE blocks, and cue
 * identifier lines, and tolerates both `.` and `,` millisecond separators and
 * both `hh:mm:ss` and `mm:ss` forms.
 */

export interface VttCue {
  /** Start time in seconds. */
  start: number;
  /** End time in seconds. */
  end: number;
  text: string;
}

const TIME = String.raw`(\d{1,2}:\d{1,2}:\d{1,2}[.,]\d{1,3}|\d{1,2}:\d{1,2}[.,]\d{1,3})`;
const CUE_TIMING = new RegExp(`${TIME}\\s*-->\\s*${TIME}`);

export function parseVtt(vtt: string): VttCue[] {
  const cues: VttCue[] = [];
  const normalized = vtt.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const blocks = normalized.split(/\n\n+/);

  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
    if (lines.length === 0) continue;

    const timeIdx = lines.findIndex((l) => l.includes("-->"));
    if (timeIdx === -1) continue; // header / NOTE / non-cue block

    const match = CUE_TIMING.exec(lines[timeIdx]!);
    if (!match) continue;

    const start = parseTimestamp(match[1]!);
    const end = parseTimestamp(match[2]!);
    const text = lines
      .slice(timeIdx + 1)
      .join(" ")
      .replace(/<[^>]+>/g, "") // strip inline VTT tags
      .trim();

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
