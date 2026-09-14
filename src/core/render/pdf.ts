import { NotImplementedError } from "../util/errors.js";
import type { LoomDoc } from "../types.js";

/**
 * PDF renderer (PRD decision D8). Self-contained: screenshots embedded in the file.
 *
 * Rendering approach is an open item in the PRD (§10) — likely a lightweight PDF
 * builder or a Markdown/HTML-to-PDF step. Kept as a stub until that's decided so we
 * don't pin a dependency prematurely.
 */
export async function writePdf(_doc: LoomDoc, _outputDir: string): Promise<string> {
  throw new NotImplementedError("render/pdf.writePdf");
}
