import type { Effort, OutputFormat, PdfLayout, ProgressStage } from "../core/types.js";

/**
 * How the web UI shows each core option. Every table is keyed by its core union, so adding a
 * value to the core fails the typecheck until it has an entry here. The page reads these lists
 * from /api/config and hard-codes none of them.
 */

/** `extension` includes the dot, matching `extname()` and the renderers' file names. */
export const FORMAT_DISPLAY: Record<OutputFormat, { label: string; extension: string; contentType: string }> = {
  markdown: { label: "Markdown", extension: ".md", contentType: "text/markdown; charset=utf-8" },
  docx: {
    label: "Word (.docx)",
    extension: ".docx",
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  pdf: { label: "PDF", extension: ".pdf", contentType: "application/pdf" },
};

export const PDF_LAYOUT_LABELS: Record<PdfLayout, string> = {
  pageless: "Pageless (one continuous page)",
  paged: "Pages (for printing)",
};

export const EFFORT_LABELS: Record<Effort, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};

export const STAGE_LABELS: Record<ProgressStage, string> = {
  ingest: "Download the video and transcript",
  frames: "Pick the distinct screens",
  generate: "Write the document",
  render: "Save the files",
};

/** Maximum lengths of the run form's text fields, enforced by the page and the server. */
export const FIELD_LIMITS = { url: 2048, guidance: 4000, contextField: 300, model: 100 } as const;
