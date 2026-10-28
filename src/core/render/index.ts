import { DEFAULT_PDF_LAYOUT, type LoomDoc, type OutputFormat, type PdfLayout } from "../types.js";
import { writeMarkdown } from "./markdown.js";
import { writeDocx } from "./docx.js";
import { writePdf } from "./pdf.js";

interface RenderOptions {
  imagesDirName: string;
  pdfLayout: PdfLayout;
}

/** Writes one format into `outputDir` and returns the file's path. */
type Renderer = (doc: LoomDoc, outputDir: string, options: RenderOptions) => Promise<string>;

/**
 * Keyed by OutputFormat so the compiler rejects a format that is added to OUTPUT_FORMATS
 * without a renderer (PRD decision D8: a new format is one entry here plus one renderer file).
 */
const RENDERERS: Record<OutputFormat, Renderer> = {
  markdown: (doc, outputDir, { imagesDirName }) => writeMarkdown(doc, outputDir, imagesDirName),
  docx: (doc, outputDir) => writeDocx(doc, outputDir),
  pdf: (doc, outputDir, { pdfLayout }) => writePdf(doc, outputDir, { layout: pdfLayout }),
};

/** Render the structured document to each requested format. Every renderer reads the same LoomDoc. */
export async function renderAll(
  doc: LoomDoc,
  outputDir: string,
  formats: OutputFormat[],
  imagesDirName = "images",
  pdfLayout: PdfLayout = DEFAULT_PDF_LAYOUT,
): Promise<string[]> {
  const files: string[] = [];
  for (const fmt of formats) {
    files.push(await RENDERERS[fmt](doc, outputDir, { imagesDirName, pdfLayout }));
  }
  return files;
}
