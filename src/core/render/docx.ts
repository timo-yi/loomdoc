import { NotImplementedError } from "../util/errors.js";
import type { LoomDoc } from "../types.js";

/**
 * Word (.docx) renderer (PRD decision D8). Self-contained: screenshots are embedded
 * into the file, so it travels as a single portable document.
 *
 * Intended implementation uses the `docx` package: build a `Document` of headings,
 * paragraphs, and `ImageRun`s (embedding each screenshot's bytes), then `Packer.toBuffer`
 * and write it out.
 */
export async function writeDocx(_doc: LoomDoc, _outputDir: string): Promise<string> {
  throw new NotImplementedError("render/docx.writeDocx");
}
