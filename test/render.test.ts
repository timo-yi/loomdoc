import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import type { LoomDoc } from "../src/core/types.js";
import { renderMarkdown, writeMarkdown } from "../src/core/render/markdown.js";
import { writeDocx } from "../src/core/render/docx.js";
import { writePdf } from "../src/core/render/pdf.js";

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
      { heading: "Open the page", body: "Navigate to the dashboard.", screenshot: { timestamp: 1, path: shot, caption: "The dashboard" } },
      { heading: "Click save", body: "Press the Save button." },
    ],
  };
}

test("renderMarkdown includes headings, image reference, and caption", () => {
  const md = renderMarkdown({
    title: "T",
    overview: "O",
    steps: [{ heading: "H1", body: "B1", screenshot: { timestamp: 1, path: "/x/images/step-01.png", caption: "C1" } }],
  });
  assert.match(md, /# T/);
  assert.match(md, /## 1\. H1/);
  assert.match(md, /!\[C1\]\(images\/step-01\.png\)/);
  assert.match(md, /\*C1\*/);
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
