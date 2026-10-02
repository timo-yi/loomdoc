import { createWriteStream } from "node:fs";
import { once } from "node:events";
import { join } from "node:path";
import sharp from "sharp";
import PDFDocument from "pdfkit";
import type { LoomDoc, PdfLayout, Step } from "../types.js";
import { fitWithin } from "./fit.js";

/**
 * PDF renderer (PRD decisions D8, D18). Self-contained: screenshots embedded in the file. Uses
 * pdfkit (pure JS, no native deps), keeping with the lightweight goal.
 *
 * Two layouts:
 *   - "pageless" (default): one continuous page sized to the content, like Google Docs'
 *     pageless mode, so there are no page breaks and no gaps. The document is laid out twice:
 *     a measuring pass on an effectively endless page, then the real pass on a page of exactly
 *     that height. Readers such as Acrobat reject pages taller than 200 in, so a very long
 *     document becomes a few tall pages, broken only between steps, never inside one. The file
 *     asks viewers to open it at "fit width" so a tall page isn't shown as a thin strip.
 *   - "paged": US Letter pages for printing. pdfkit paginates text but not images, so this
 *     keeps each step heading with what follows it, and shrinks a screenshot (down to
 *     MIN_IMAGE_SCALE) when that lets it finish the current page instead of leaving a gap.
 */

const PAGE_WIDTH = 612; // US Letter width, pt
const MARGIN = 54;
const IMAGE_MAX_WIDTH = 460;
const IMAGE_MAX_HEIGHT = 340;
/** Adobe Acrobat's maximum page dimension (200 in). */
export const MAX_PDF_PAGE_HEIGHT = 14_400;
/** Smallest a screenshot may be shrunk to finish a page in the paged layout. */
export const MIN_IMAGE_SCALE = 0.7;
/** Safety margin when fitting a screenshot and its caption into the rest of a page. */
const FIT_HEADROOM = 6;
/** Smallest content area on a pageless page (one line of the largest text). */
const MIN_CONTENT_HEIGHT = 30;
/** Headroom on pageless pages so rounding can never trip pdfkit's automatic page break. */
const PAGELESS_SLACK = 12;

export interface PdfOptions {
  layout?: PdfLayout;
  /** Tallest pageless page; overridable for tests. */
  maxPageHeight?: number;
}

interface FittedImage {
  /** The file itself, or a PNG re-encoding of it when pdfkit can't read the original. */
  source: string | Buffer;
  width: number;
  height: number;
}

interface StepBlock {
  number: number;
  step: Step;
  image?: FittedImage;
}

export async function writePdf(doc: LoomDoc, outputDir: string, options: PdfOptions = {}): Promise<string> {
  const path = join(outputDir, "document.pdf");
  const blocks = await prepareSteps(doc);
  const pdf =
    (options.layout ?? "pageless") === "pageless"
      ? pagelessPdf(doc, blocks, options.maxPageHeight ?? MAX_PDF_PAGE_HEIGHT)
      : pagedPdf(doc, blocks);

  const stream = createWriteStream(path);
  pdf.pipe(stream);
  pdf.end();
  await once(stream, "finish");
  return path;
}

// --- pageless ------------------------------------------------------------------------------

function pagelessPdf(doc: LoomDoc, blocks: StepBlock[], maxPageHeight: number): PDFKit.PDFDocument {
  // Pass 1: measure every block on a page tall enough that nothing paginates.
  const probe = new PDFDocument({ margin: MARGIN, size: [PAGE_WIDTH, 1_000_000] });
  const heights: number[] = [];
  let y = probe.y;
  drawHeader(probe, doc);
  heights.push(probe.y - y);
  for (const block of blocks) {
    y = probe.y;
    drawStep(probe, block);
    heights.push(probe.y - y);
  }
  probe.end();

  // Group blocks (header first) into pages no taller than the limit, breaking only between them.
  const pages = groupIntoPages(heights, maxPageHeight - 2 * MARGIN - PAGELESS_SLACK);

  // Pass 2: draw each group on a page of exactly its measured height.
  const pdf = new PDFDocument({ margin: MARGIN, autoFirstPage: false });
  for (const [p, group] of pages.entries()) {
    // At least one line tall: pdfkit needs a full line of room even for empty text.
    const contentHeight = Math.max(MIN_CONTENT_HEIGHT, group.reduce((sum, i) => sum + heights[i]!, 0));
    const height = Math.min(maxPageHeight, Math.ceil(contentHeight + 2 * MARGIN + PAGELESS_SLACK));
    pdf.addPage({ size: [PAGE_WIDTH, height], margin: MARGIN });
    if (p === 0) openAtFitWidth(pdf);
    for (const i of group) {
      if (i === 0) drawHeader(pdf, doc);
      else drawStep(pdf, blocks[i - 1]!);
    }
  }
  return pdf;
}

/**
 * Pack consecutive block heights into pages whose content fits `maxContentHeight`. A block
 * taller than the limit gets a page of its own (it can't be split without breaking a step).
 * Returns the block indexes on each page.
 */
export function groupIntoPages(heights: number[], maxContentHeight: number): number[][] {
  const pages: number[][] = [];
  let current: number[] = [];
  let used = 0;
  heights.forEach((h, i) => {
    if (current.length > 0 && used + h > maxContentHeight) {
      pages.push(current);
      current = [];
      used = 0;
    }
    current.push(i);
    used += h;
  });
  if (current.length > 0) pages.push(current);
  return pages;
}

/** Ask viewers to open at the top of page 1, zoomed to the page width. */
function openAtFitWidth(pdf: PDFKit.PDFDocument): void {
  // pdfkit has no public API for the catalog's OpenAction; plain strings serialize as PDF names.
  const internals = pdf as unknown as {
    _root: { data: Record<string, unknown> };
    page: { dictionary: unknown };
  };
  internals._root.data["OpenAction"] = [internals.page.dictionary, "FitH", null];
}

// --- paged ---------------------------------------------------------------------------------

function pagedPdf(doc: LoomDoc, blocks: StepBlock[]): PDFKit.PDFDocument {
  const pdf = new PDFDocument({ margin: MARGIN, size: "LETTER" });
  drawHeader(pdf, doc);
  for (const block of blocks) {
    // Keep the heading with what follows: if the heading plus the smallest acceptable version
    // of its screenshot (or the first lines of its text) won't fit, start the step on a new page.
    const bottom = pdf.page.height - pdf.page.margins.bottom;
    const atTop = pdf.y <= pdf.page.margins.top + 1;
    if (!atTop && pdf.y + keepTogetherHeight(pdf, block) > bottom) pdf.addPage();
    drawStep(pdf, block, true);
  }
  return pdf;
}

/** Height the start of a step needs on the current page so its heading isn't stranded. */
function keepTogetherHeight(pdf: PDFKit.PDFDocument, block: StepBlock): number {
  return preservingFont(pdf, () => measureKeepTogether(pdf, block));
}

function measureKeepTogether(pdf: PDFKit.PDFDocument, block: StepBlock): number {
  const width = pdf.page.width - pdf.page.margins.left - pdf.page.margins.right;
  // Measure with the font the heading's leading space will actually use (the previous text's).
  const spacing = pdf.currentLineHeight(true) * 0.75;
  const caption = block.image ? captionHeight(pdf, block, width) : 0;
  useFont(pdf, "Helvetica-Bold", 14);
  const heading = pdf.heightOfString(headingText(block), { width });
  const imageGap = pdf.currentLineHeight(true) * 0.25; // drawStep's moveDown(0.25) in the heading font
  useFont(pdf, "Helvetica", 11);
  const twoLines = pdf.currentLineHeight(true) * 2;
  if (!block.image) return spacing + heading + twoLines;
  // The body may flow onto the next page; the screenshot and caption should not.
  // Mirrors drawStep's fitting check exactly, so a step that starts here never has its
  // screenshot pushed to the next page away from its heading.
  return spacing + heading + imageGap + block.image.height * MIN_IMAGE_SCALE + caption + FIT_HEADROOM;
}

/**
 * Where a screenshot of `imageHeight` goes given `available` space left on the page: its full
 * size, a scale down to MIN_IMAGE_SCALE that lets it fit, or the next page.
 */
export function planImage(imageHeight: number, available: number): { scale: number } | "next-page" {
  if (imageHeight <= available) return { scale: 1 };
  const scale = available / imageHeight;
  return scale >= MIN_IMAGE_SCALE ? { scale } : "next-page";
}

// --- shared drawing ------------------------------------------------------------------------

function drawHeader(pdf: PDFKit.PDFDocument, doc: LoomDoc): void {
  useFont(pdf, "Helvetica-Bold", 20).text(doc.title);
  if (doc.overview) {
    pdf.moveDown(0.5);
    useFont(pdf, "Helvetica", 11).text(doc.overview);
  }
}

/** Draw one step. `paged` enables fitting the screenshot to the space left on the page. */
function drawStep(pdf: PDFKit.PDFDocument, block: StepBlock, paged = false): void {
  pdf.moveDown(0.75); // in the previous text's font, exactly as measured
  useFont(pdf, "Helvetica-Bold", 14).text(headingText(block));
  const { step, image } = block;
  if (image) {
    pdf.moveDown(0.25);
    let { width, height } = image;
    if (paged) {
      const contentWidth = pdf.page.width - pdf.page.margins.left - pdf.page.margins.right;
      const bottom = pdf.page.height - pdf.page.margins.bottom;
      // A little headroom: pdfkit breaks a text line onto a new page if it overshoots by any
      // fraction of a point, which would strand the caption.
      const available = bottom - pdf.y - captionHeight(pdf, block, contentWidth) - FIT_HEADROOM;
      const plan = planImage(height, available);
      if (plan === "next-page") pdf.addPage();
      else if (plan.scale < 1) {
        width = Math.round(width * plan.scale);
        height = Math.round(height * plan.scale);
      }
    }
    pdf.image(image.source, { width, height });
    if (step.screenshot?.caption) {
      pdf.moveDown(0.25);
      useFont(pdf, "Helvetica-Oblique", 9).text(step.screenshot.caption);
    }
  }
  if (step.body) {
    pdf.moveDown(0.25);
    useFont(pdf, "Helvetica", 11).text(step.body);
  }
}

function captionHeight(pdf: PDFKit.PDFDocument, block: StepBlock, width: number): number {
  const caption = block.step.screenshot?.caption;
  if (!caption) return 0;
  return preservingFont(pdf, () => {
    useFont(pdf, "Helvetica-Oblique", 9);
    return pdf.currentLineHeight(true) * 0.25 + pdf.heightOfString(caption, { width });
  });
}

// Font state: the spacing before a block (moveDown) depends on the font active at that moment,
// so the measuring helpers must leave it exactly as they found it. loomdoc records every font
// it sets rather than reading pdfkit's private state.
const activeFont = new WeakMap<PDFKit.PDFDocument, [name: string, size: number]>();

function useFont(pdf: PDFKit.PDFDocument, name: string, size: number): PDFKit.PDFDocument {
  activeFont.set(pdf, [name, size]);
  return pdf.font(name).fontSize(size);
}

function preservingFont<T>(pdf: PDFKit.PDFDocument, measure: () => T): T {
  const saved = activeFont.get(pdf);
  try {
    return measure();
  } finally {
    if (saved) useFont(pdf, saved[0], saved[1]);
  }
}

function headingText(block: StepBlock): string {
  return `${block.number}. ${block.step.heading}`;
}

/**
 * Prepare every screenshot once, up front, so both pageless passes see identical input and a
 * bad image can never fail the document after the model has already been paid for. Each image
 * is checked with pdfkit itself (sharp reads only the header); one pdfkit can't embed (a WebP,
 * GIF or TIFF) is re-encoded to PNG, and one that still can't be read (truncated, corrupt) is
 * dropped while the step's text is kept.
 */
async function prepareSteps(doc: LoomDoc): Promise<StepBlock[]> {
  const checker = new PDFDocument({ autoFirstPage: false });
  const blocks = await Promise.all(
    doc.steps.map(async (step, i) => {
      const block: StepBlock = { number: i + 1, step };
      const path = step.screenshot?.path;
      if (path) {
        const source = await embeddableImage(checker, path);
        if (source) {
          try {
            const meta = await sharp(source).metadata();
            block.image = { source, ...fitWithin(meta.width, meta.height, IMAGE_MAX_WIDTH, IMAGE_MAX_HEIGHT) };
          } catch {
            // Unreadable dimensions: keep the step's text, skip the image.
          }
        }
      }
      return block;
    }),
  );
  checker.end();
  return blocks;
}

async function embeddableImage(checker: PDFKit.PDFDocument, path: string): Promise<string | Buffer | null> {
  const opens = (src: string | Buffer): boolean => {
    try {
      (checker as unknown as { openImage(src: string | Buffer): unknown }).openImage(src);
      return true;
    } catch {
      return false;
    }
  };
  if (opens(path)) return path;
  try {
    const png = await sharp(path).png().toBuffer();
    return opens(png) ? png : null;
  } catch {
    return null;
  }
}
