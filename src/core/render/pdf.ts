import { createWriteStream } from "node:fs";
import { once } from "node:events";
import { join } from "node:path";
import sharp from "sharp";
import PDFDocument from "pdfkit";
import type { LoomDoc } from "../types.js";
import { fitWithin } from "./fit.js";

/**
 * PDF renderer (PRD decision D8). Self-contained: screenshots embedded in the file. Uses
 * pdfkit (pure JS, no native deps), keeping with the lightweight goal.
 *
 * pdfkit auto-paginates text but NOT images, so we compute each image's fitted size and add a
 * page before drawing it if it wouldn't fit — otherwise images near a page break are silently
 * clipped.
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
      await drawImage(pdf, shot.path);
      if (shot.caption) {
        pdf.moveDown(0.25).font("Helvetica-Oblique").fontSize(9).text(shot.caption);
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

async function drawImage(pdf: PDFKit.PDFDocument, imagePath: string): Promise<void> {
  try {
    const meta = await sharp(imagePath).metadata();
    const { width, height } = fitWithin(meta.width, meta.height, CONTENT_WIDTH, MAX_IMAGE_HEIGHT);
    pdf.moveDown(0.25);
    const bottom = pdf.page.height - pdf.page.margins.bottom;
    if (pdf.y + height > bottom) pdf.addPage();
    pdf.image(imagePath, { width, height });
  } catch {
    // Unreadable image: skip it rather than fail the whole document.
  }
}
