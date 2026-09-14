import { readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import sharp from "sharp";
import { Document, Packer, Paragraph, HeadingLevel, ImageRun, TextRun } from "docx";
import type { LoomDoc } from "../types.js";

/**
 * Word (.docx) renderer (PRD decision D8). Self-contained: screenshots are embedded into
 * the file via ImageRun, so it travels as a single portable document.
 */

const MAX_IMAGE_WIDTH = 600; // px; images wider than this are scaled down, aspect preserved.

export async function writeDocx(doc: LoomDoc, outputDir: string): Promise<string> {
  const children: Paragraph[] = [new Paragraph({ text: doc.title, heading: HeadingLevel.TITLE })];
  if (doc.overview) children.push(new Paragraph({ text: doc.overview }));

  let i = 0;
  for (const step of doc.steps) {
    i++;
    children.push(new Paragraph({ text: `${i}. ${step.heading}`, heading: HeadingLevel.HEADING_2 }));
    const shot = step.screenshot;
    if (shot?.path) {
      const image = await buildImageRun(shot.path);
      if (image) children.push(new Paragraph({ children: [image] }));
      if (shot.caption) {
        children.push(new Paragraph({ children: [new TextRun({ text: shot.caption, italics: true })] }));
      }
    }
    if (step.body) children.push(new Paragraph({ text: step.body }));
  }

  const document = new Document({ sections: [{ children }] });
  const buffer = await Packer.toBuffer(document);
  const path = join(outputDir, "document.docx");
  await writeFile(path, buffer);
  return path;
}

async function buildImageRun(imagePath: string): Promise<ImageRun | null> {
  try {
    const data = await readFile(imagePath);
    const meta = await sharp(data).metadata();
    const width = meta.width ?? MAX_IMAGE_WIDTH;
    const height = meta.height ?? Math.round(MAX_IMAGE_WIDTH * 0.6);
    const scale = width > MAX_IMAGE_WIDTH ? MAX_IMAGE_WIDTH / width : 1;
    const ext = extname(imagePath).toLowerCase();
    const type = ext === ".jpg" || ext === ".jpeg" ? "jpg" : "png";
    return new ImageRun({
      type,
      data,
      transformation: { width: Math.round(width * scale), height: Math.round(height * scale) },
    });
  } catch {
    return null; // unreadable image: skip it rather than fail the whole document
  }
}
