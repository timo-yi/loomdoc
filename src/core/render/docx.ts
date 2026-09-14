import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { Document, Packer, Paragraph, HeadingLevel, ImageRun, TextRun } from "docx";
import type { LoomDoc } from "../types.js";
import { fitWithin } from "./fit.js";

/**
 * Word (.docx) renderer (PRD decision D8). Self-contained: screenshots are embedded into
 * the file via ImageRun, so it travels as a single portable document.
 */

const MAX_IMAGE_WIDTH = 600; // px
const MAX_IMAGE_HEIGHT = 700; // px — bounds tall/scrolling captures too

type DocxImageType = "png" | "jpg" | "gif" | "bmp";

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
    let data = await readFile(imagePath);
    let meta = await sharp(data).metadata();

    // Derive the image type from content, not the file extension. docx supports png/jpg/gif/bmp;
    // re-encode anything else (or unknown) to PNG so the embedded type always matches the bytes.
    let type = docxTypeFor(meta.format);
    if (type === null) {
      data = await sharp(data).png().toBuffer();
      meta = await sharp(data).metadata();
      type = "png";
    }

    const { width, height } = fitWithin(meta.width, meta.height, MAX_IMAGE_WIDTH, MAX_IMAGE_HEIGHT);
    return new ImageRun({ type, data, transformation: { width, height } });
  } catch {
    return null; // unreadable image: skip it rather than fail the whole document
  }
}

function docxTypeFor(format: string | undefined): DocxImageType | null {
  switch (format) {
    case "jpeg":
    case "jpg":
      return "jpg";
    case "png":
      return "png";
    case "gif":
      return "gif";
    case "bmp":
      return "bmp";
    default:
      return null;
  }
}
