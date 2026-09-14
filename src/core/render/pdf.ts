import { createWriteStream } from "node:fs";
import { once } from "node:events";
import { join } from "node:path";
import PDFDocument from "pdfkit";
import type { LoomDoc } from "../types.js";

/**
 * PDF renderer (PRD decision D8). Self-contained: screenshots embedded in the file. Uses
 * pdfkit (pure JS, no native deps), keeping with the lightweight goal.
 */

const CONTENT_WIDTH = 460; // px within the default page margins
const MAX_IMAGE_HEIGHT = 340;

export async function writePdf(doc: LoomDoc, outputDir: string): Promise<string> {
  const path = join(outputDir, "document.pdf");
  const pdf = new PDFDocument({ margin: 54, autoFirstPage: true });
  const stream = createWriteStream(path);
  pdf.pipe(stream);

  pdf.font("Helvetica-Bold").fontSize(20).text(doc.title);
  if (doc.overview) {
    pdf.moveDown(0.5).font("Helvetica").fontSize(11).text(doc.overview);
  }

  let i = 0;
  for (const step of doc.steps) {
    i++;
    pdf.moveDown(0.75).font("Helvetica-Bold").fontSize(14).text(`${i}. ${step.heading}`);
    const shot = step.screenshot;
    if (shot?.path) {
      try {
        pdf.moveDown(0.25).image(shot.path, { fit: [CONTENT_WIDTH, MAX_IMAGE_HEIGHT] });
        if (shot.caption) {
          pdf.moveDown(0.25).font("Helvetica-Oblique").fontSize(9).text(shot.caption);
        }
      } catch {
        // Unreadable image: skip it rather than fail the whole document.
      }
    }
    if (step.body) {
      pdf.moveDown(0.25).font("Helvetica").fontSize(11).text(step.body);
    }
  }

  pdf.end();
  await once(stream, "finish");
  return path;
}
