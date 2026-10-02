import { DEFAULT_PDF_LAYOUT, type LoomDoc, type OutputFormat, type PdfLayout } from "../types.js";
import { writeMarkdown } from "./markdown.js";
import { writeDocx } from "./docx.js";
import { writePdf } from "./pdf.js";

/**
 * Render the structured document to each requested format. Every renderer reads the
 * same LoomDoc, so adding a format later (e.g. PowerPoint) is a new case here plus one
 * renderer file (PRD decision D8).
 */
export async function renderAll(
  doc: LoomDoc,
  outputDir: string,
  formats: OutputFormat[],
  imagesDirName = "images",
  pdfLayout: PdfLayout = DEFAULT_PDF_LAYOUT,
): Promise<string[]> {
  const files: string[] = [];
  for (const fmt of formats) {
    switch (fmt) {
      case "markdown":
        files.push(await writeMarkdown(doc, outputDir, imagesDirName));
        break;
      case "docx":
        files.push(await writeDocx(doc, outputDir));
        break;
      case "pdf":
        files.push(await writePdf(doc, outputDir, { layout: pdfLayout }));
        break;
    }
  }
  return files;
}
