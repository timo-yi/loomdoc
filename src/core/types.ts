/**
 * Core domain types for loomdoc.
 *
 * These describe the data that flows through the pipeline. The LLM-facing schema
 * (see ./generate/schema.ts) is intentionally narrower than these — the model
 * emits timestamps and captions; the pipeline resolves those into on-disk image
 * paths afterward.
 */

/** A screenshot embedded in the document. */
export interface Screenshot {
  /** Path to the image file on disk (a frame the model actually saw, copied into images/). */
  path: string;
  /** Model-authored caption. */
  caption?: string;
}

/** One step of the how-to document. A step maps to a doc section — or, later, a slide. */
export interface Step {
  heading: string;
  body: string;
  screenshot?: Screenshot;
  /**
   * Confidence flag. The LLM sets this when a step was ambiguous or needed more
   * reasoning than it could give. It enables future Sonnet->Opus auto-escalation
   * (PRD decision D10) with no schema change.
   */
  needsDeeperReasoning?: boolean;
}

/** The structured intermediate representation: what the LLM emits and renderers consume. */
export interface LoomDoc {
  title: string;
  overview: string;
  /** Who the doc is written for — supplied by the user or inferred from the video. */
  audience?: string;
  steps: Step[];
}

/** Optional context that sharpens output relevance (PRD decision D9). */
export interface DocContext {
  role?: string;
  industry?: string;
  function?: string;
  audience?: string;
  useCase?: string;
  intent?: string;
  /** Free-text style/voice steer, e.g. "terse engineer reference". */
  style?: string;
}

export type OutputFormat = "markdown" | "docx" | "pdf";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/**
 * Tunables for the deterministic frame-winnowing step (PRD §4). All are thresholds on the
 * fraction of a downscaled frame's cells that change; sensible defaults below, tune against
 * real Looms.
 */
export interface FrameOptions {
  /** Frames per second to sample from the video. */
  sampleFps: number;
  /** Per-cell intensity delta (0-255) below which a change counts as noise, not a change. */
  pixelDelta: number;
  /** Cell-change fraction above which two settled frames count as different screens. */
  sameScreenThreshold: number;
  /** Cell-change fraction between consecutive frames above which the screen is "in motion". */
  motionThreshold: number;
  /** Seconds a screen must stay quiet to count as a settled state. */
  dwellSeconds: number;
  /** Hard cap on candidate screenshots shown to the LLM (the cost lever); least-distinct dropped. */
  maxCandidates: number;
}

/** Everything a single run needs. */
export interface LoomdocOptions {
  url: string;
  /** Output root; a per-video subfolder is created under it. Default "./out". */
  outDir?: string;
  /** Which document formats to produce. Default: all three. */
  formats?: OutputFormat[];
  /** Model id for the doc-generation step. Default "claude-sonnet-5". */
  model?: string;
  /** Reasoning effort. Default "medium". */
  effort?: Effort;
  /** Optional relevance context. */
  context?: DocContext;
  /** Frame-winnowing tunables. Sensible defaults applied when omitted. */
  frames?: Partial<FrameOptions>;
  /** Cap on model-driven getFrameAtTimestamp calls in one run (PRD open item). */
  maxFrameRequests?: number;
}

/** The outcome of a run. `files` and the dirs are absolute paths, printed to the user. */
export interface LoomdocResult {
  doc: LoomDoc;
  /** Absolute path to the per-video output directory. */
  outputDir: string;
  /** Absolute path to the images subfolder. */
  imagesDir: string;
  /** Absolute paths of the document files written. */
  files: string[];
}

export const DEFAULT_FRAME_OPTIONS: FrameOptions = {
  sampleFps: 2,
  pixelDelta: 24,
  sameScreenThreshold: 0.004,
  motionThreshold: 0.04,
  dwellSeconds: 0.5,
  maxCandidates: 30,
};

export const DEFAULT_MODEL = "claude-sonnet-5";
export const DEFAULT_EFFORT: Effort = "medium";
export const DEFAULT_FORMATS: OutputFormat[] = ["markdown", "docx", "pdf"];
export const DEFAULT_MAX_FRAME_REQUESTS = 10;
