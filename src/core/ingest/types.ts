/**
 * The source-neutral contract between ingest and the rest of the pipeline (PRD decision D13).
 *
 * Every source (Loom, YouTube) resolves a URL into this shape. Nothing downstream of ingest
 * knows or cares where the video came from.
 */

export interface TranscriptCue {
  /** Start time in seconds. */
  start: number;
  /** End time in seconds. */
  end: number;
  text: string;
}

export type VideoSource = "loom" | "youtube";

export interface SourceVideo {
  source: VideoSource;
  id: string;
  title: string;
  /** From source metadata; falls back to the last transcript cue's end only if absent. */
  durationSeconds: number;
  /**
   * Local file holding the video track, downloaded into the run's scratch directory
   * (PRD decision D14). It is deleted when the run ends, success or failure.
   */
  videoPath: string;
  transcript: TranscriptCue[];
}
