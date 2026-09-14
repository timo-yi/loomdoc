import type { LoomDoc, OutputFormat } from "../types.js";
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
        files.push(await writePdf(doc, outputDir));
        break;
    }
  }
  return files;
}
