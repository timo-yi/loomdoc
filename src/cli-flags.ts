/**
 * Parsing for loomdoc's enum-like CLI flags (--formats, --pdf-layout, --effort).
 *
 * This lives in the CLI/UI layer, not in the public library API: the messages name the flags
 * themselves. Library callers never see these — `runLoomdoc` validates its options with its own
 * wording (see core/pipeline.ts), and the UI's zod schema checks request bodies directly.
 */

import {
  EFFORT_LEVELS,
  OUTPUT_FORMATS,
  PDF_LAYOUTS,
  type Effort,
  type OutputFormat,
  type PdfLayout,
  isEffort,
  isOutputFormat,
  isPdfLayout,
} from "./core/types.js";
import { LoomdocError } from "./core/util/errors.js";

/** Parse a `--formats` list ("markdown,pdf"). Throws with the valid choices on any bad input. */
export function parseOutputFormats(value: string): OutputFormat[] {
  const parts = value.split(",").map((f) => f.trim()).filter(Boolean);
  if (parts.length === 0) {
    throw new LoomdocError(`--formats needs at least one of: ${OUTPUT_FORMATS.join(", ")}.`);
  }
  const unknown = [...new Set(parts.filter((p) => !isOutputFormat(p)))];
  if (unknown.length > 0) {
    throw new LoomdocError(
      `Unknown --formats "${unknown.join(", ")}". Choose from: ${OUTPUT_FORMATS.join(", ")}.`,
    );
  }
  // Dedupe so a typo like "pdf,pdf" doesn't render the same file twice.
  return [...new Set(parts)] as OutputFormat[];
}

/** Parse a `--pdf-layout` value. Throws with the valid choices on bad input. */
export function parsePdfLayout(value: string): PdfLayout {
  if (!isPdfLayout(value)) {
    throw new LoomdocError(`Unknown --pdf-layout "${value}". Choose one of: ${PDF_LAYOUTS.join(", ")}.`);
  }
  return value;
}

/** Parse an `--effort` value. Throws with the valid choices on bad input. */
export function parseEffort(value: string): Effort {
  if (!isEffort(value)) {
    throw new LoomdocError(`Unknown --effort "${value}". Choose one of: ${EFFORT_LEVELS.join(", ")}.`);
  }
  return value;
}
