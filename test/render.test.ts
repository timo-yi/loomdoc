import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import type { LoomDoc } from "../src/core/types.js";
import { renderMarkdown, writeMarkdown } from "../src/core/render/markdown.js";
import { writeDocx } from "../src/core/render/docx.js";
import { groupIntoPages, MIN_IMAGE_SCALE, planImage, writePdf } from "../src/core/render/pdf.js";
import { spawnSync } from "node:child_process";
import { unzipSync, strFromU8 } from "fflate";

async function sampleDoc(dir: string): Promise<LoomDoc> {
  const shot = join(dir, "images", "step-01.png");
  await sharp({
    create: { width: 320, height: 180, channels: 3, background: { r: 200, g: 210, b: 220 } },
  })
    .png()
    .toFile(shot);
  return {
    title: "How to do the thing",
    overview: "A short overview.",
    audience: "end users",
    steps: [
      { heading: "Open the page", body: "Navigate to the dashboard.", screenshot: { path: shot, caption: "The dashboard" } },
      { heading: "Click save", body: "Press the Save button." },
    ],
  };
}

async function tallImageDoc(dir: string): Promise<LoomDoc> {
  const steps = [];
  for (let i = 1; i <= 3; i++) {
    const shot = join(dir, "images", `tall-${i}.png`);
    await sharp({ create: { width: 400, height: 900, channels: 3, background: { r: 180, g: 190, b: 200 } } })
      .png()
      .toFile(shot);
    steps.push({ heading: `Step ${i}`, body: "Body text.", screenshot: { path: shot } });
  }
  return { title: "Tall", overview: "", audience: "a", steps };
}

test("renderMarkdown includes headings, image reference, and caption", () => {
  const md = renderMarkdown({
    title: "T",
    overview: "O",
    audience: "a",
    steps: [{ heading: "H1", body: "B1", screenshot: { path: "/x/images/step-01.png", caption: "C1" } }],
  });
  assert.match(md, /# T/);
  assert.match(md, /## 1\. H1/);
  assert.match(md, /!\[C1\]\(images\/step-01\.png\)/);
  assert.match(md, /\*C1\*/);
});

test("renderMarkdown escapes caption chars that would break alt/emphasis", () => {
  const md = renderMarkdown({
    title: "T",
    overview: "",
    audience: "a",
    steps: [{ heading: "H", body: "B", screenshot: { path: "/x/images/step-01.png", caption: "a ] b * c" } }],
  });
  // Alt text: the ] is escaped so the image link isn't broken.
  assert.ok(md.includes("![a \\] b * c](images/step-01.png)"), md);
  // Italic caption line: both ] and * are escaped so emphasis isn't broken.
  assert.ok(md.includes("*a \\] b \\* c*"), md);
});

test("writeMarkdown writes a .md file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "loomdoc-md-"));
  try {
    await sharp({ create: { width: 10, height: 10, channels: 3, background: "#fff" } })
      .png()
      .toFile(join(dir, "i.png")); // ensure dir exists via a write
    const md = await writeMarkdown(
      { title: "T", overview: "", steps: [{ heading: "H", body: "B" }] },
      dir,
    );
    const content = await readFile(md, "utf8");
    assert.match(content, /# T/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writeDocx produces a valid .docx (zip) with content", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "loomdoc-docx-"));
  try {
    await sharp({ create: { width: 4, height: 4, channels: 3, background: "#fff" } })
      .png()
      .toFile(join(dir, "seed.png")); // create dir
    await (await import("node:fs/promises")).mkdir(join(dir, "images"), { recursive: true });
    const doc = await sampleDoc(dir);
    const out = await writeDocx(doc, dir);
    const bytes = await readFile(out);
    assert.ok(bytes.length > 0);
    // .docx is a zip: first two bytes are "PK".
    assert.equal(bytes[0], 0x50);
    assert.equal(bytes[1], 0x4b);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writePdf produces a valid .pdf with content", async () => {
  const dir = await mkdtemp(join(tmpdir(), "loomdoc-pdf-"));
  try {
    await (await import("node:fs/promises")).mkdir(join(dir, "images"), { recursive: true });
    const doc = await sampleDoc(dir);
    const out = await writePdf(doc, dir);
    const bytes = await readFile(out);
    assert.ok((await stat(out)).size > 0);
    // PDF magic number "%PDF".
    assert.equal(bytes.subarray(0, 4).toString("latin1"), "%PDF");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("paged writePdf paginates tall images onto multiple pages (no clipping)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "loomdoc-pdfpage-"));
  try {
    await (await import("node:fs/promises")).mkdir(join(dir, "images"), { recursive: true });
    const doc = await tallImageDoc(dir);
    const out = await writePdf(doc, dir, { layout: "paged" });
    const text = (await readFile(out)).toString("latin1");
    // Count page objects ("/Type /Page" but not "/Type /Pages").
    const pageCount = (text.match(/\/Type\s*\/Page(?![sA-Za-z])/g) ?? []).length;
    assert.ok(pageCount >= 2, `three tall images should span multiple pages, got ${pageCount}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// --- PDF layouts ---------------------------------------------------------------------------

function pdfPages(bytes: Buffer): number[] {
  const text = bytes.toString("latin1");
  return [...text.matchAll(/\/MediaBox \[0 0 612 (\d+(?:\.\d+)?)\]/g)].map((m) => Number(m[1]));
}

async function manyStepDoc(dir: string, steps: number): Promise<LoomDoc> {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(dir, "images"), { recursive: true });
  const shot = join(dir, "images", "wide.png");
  await sharp({ create: { width: 1280, height: 720, channels: 3, background: { r: 120, g: 160, b: 200 } } })
    .png()
    .toFile(shot);
  return {
    title: "Many steps",
    overview: "Overview.",
    steps: Array.from({ length: steps }, (_, i) => ({
      heading: `Step ${i + 1}`,
      body: "Do the thing, then check the result. ".repeat(4),
      screenshot: { path: shot, caption: "What you should see" },
    })),
  };
}

test("pageless writePdf (the default) is one page sized to the content and opens at fit-width", async () => {
  const dir = await mkdtemp(join(tmpdir(), "loomdoc-pageless-"));
  try {
    const out = await writePdf(await manyStepDoc(dir, 8), dir);
    const bytes = await readFile(out);
    const heights = pdfPages(bytes);
    assert.equal(heights.length, 1, "one continuous page");
    assert.ok(heights[0]! > 792 * 2 && heights[0]! < 14_400, `height ${heights[0]}`);
    assert.match(bytes.toString("latin1"), /\/OpenAction \[\d+ 0 R \/FitH null\]/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("pageless writePdf splits only between steps when the page limit is reached", async () => {
  const dir = await mkdtemp(join(tmpdir(), "loomdoc-pageless-split-"));
  try {
    const out = await writePdf(await manyStepDoc(dir, 8), dir, { maxPageHeight: 1500 });
    const heights = pdfPages(await readFile(out));
    assert.ok(heights.length > 1, "split into several tall pages");
    for (const h of heights) assert.ok(h <= 1500, `page height ${h} within the limit`);
    // Each step block is ~400pt, so pages hold whole steps: no page is a near-empty spill-over.
    for (const h of heights.slice(0, -1)) assert.ok(h > 1000, `page ${h} is well filled`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("groupIntoPages packs blocks in order and never splits one", () => {
  assert.deepEqual(groupIntoPages([100, 200, 300], 1000), [[0, 1, 2]]);
  assert.deepEqual(groupIntoPages([400, 400, 400], 1000), [[0, 1], [2]]);
  // A block taller than the limit gets a page of its own.
  assert.deepEqual(groupIntoPages([100, 2000, 100], 1000), [[0], [1], [2]]);
  assert.deepEqual(groupIntoPages([], 1000), []);
});

test("planImage keeps full size, shrinks to finish a page, or moves to the next page", () => {
  assert.deepEqual(planImage(300, 500), { scale: 1 });
  assert.deepEqual(planImage(300, 240), { scale: 0.8 });
  assert.deepEqual(planImage(300, 300 * MIN_IMAGE_SCALE), { scale: MIN_IMAGE_SCALE });
  assert.equal(planImage(300, 150), "next-page");
});

const hasPdftotext = spawnSync("pdftotext", ["-v"], { stdio: "ignore" }).status === 0;

test("paged writePdf never strands a heading or orphans a caption", { skip: !hasPdftotext }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "loomdoc-paged-keep-"));
  try {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(dir, "images"), { recursive: true });
    const wide = join(dir, "images", "wide.png");
    const tall = join(dir, "images", "tall.png");
    await sharp({ create: { width: 1280, height: 720, channels: 3, background: "#79c" } }).png().toFile(wide);
    await sharp({ create: { width: 800, height: 1000, channels: 3, background: "#9c7" } }).png().toFile(tall);
    // Varied text lengths and image shapes put steps at every position on the page. The
    // previous renderer left 4 headings stranded and 4 captions orphaned on this document.
    const doc: LoomDoc = {
      title: "Varied",
      overview: "Overview sentence. ".repeat(10),
      steps: Array.from({ length: 12 }, (_, i) => ({
        heading: `Step ${i + 1}`,
        body: "Do the thing, then check the result. ".repeat(1 + ((i * 5) % 7)),
        screenshot: i % 4 === 2 ? undefined : { path: i % 3 === 1 ? tall : wide, caption: "What you should see" },
      })),
    };
    const out = await writePdf(doc, dir, { layout: "paged" });
    const text = spawnSync("pdftotext", ["-layout", out, "-"], { encoding: "utf8" }).stdout;
    const pages = text.split("\f").filter((p) => p.trim().length > 0);
    assert.ok(pages.length > 1);
    for (const [i, page] of pages.entries()) {
      const lines = page.split("\n").map((l) => l.trim()).filter(Boolean);
      // pdftotext omits images, so a heading as the last text line means its screenshot
      // started the next page without it.
      assert.doesNotMatch(lines.at(-1)!, /^\d+\. Step \d+$/, `page ${i + 1} ends with a stranded heading`);
      assert.notEqual(lines[0], "What you should see", `page ${i + 1} starts with an orphaned caption`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writeDocx keeps each step heading with what follows, and screenshots with captions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "loomdoc-docx-keep-"));
  try {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(dir, "images"), { recursive: true });
    const out = await writeDocx(await sampleDoc(dir), dir);
    const xml = strFromU8(unzipSync(new Uint8Array(await readFile(out)))["word/document.xml"]!);
    const paragraphs = xml.split("</w:p>");
    const heading = paragraphs.find((p) => p.includes("1. Open the page"))!;
    assert.match(heading, /<w:keepNext\/>/);
    const image = paragraphs.find((p) => p.includes("<w:drawing>"))!;
    assert.match(image, /<w:keepNext\/>/, "image paragraph kept with its caption");
    const lastHeading = paragraphs.find((p) => p.includes("2. Click save"))!;
    assert.match(lastHeading, /<w:keepNext\/>/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
