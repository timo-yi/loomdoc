import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildSystemPrompt,
  buildUserContent,
  formatTs,
  mediaTypeFor,
} from "../src/core/generate/generate.js";
import type { SourceVideo } from "../src/core/ingest/types.js";

test("formatTs formats mm:ss and h:mm:ss", () => {
  assert.equal(formatTs(0), "0:00");
  assert.equal(formatTs(65), "1:05");
  assert.equal(formatTs(3661), "1:01:01");
  assert.equal(formatTs(-5), "0:00");
});

test("mediaTypeFor maps by extension", () => {
  assert.equal(mediaTypeFor("/x/a.jpg"), "image/jpeg");
  assert.equal(mediaTypeFor("/x/a.jpeg"), "image/jpeg");
  assert.equal(mediaTypeFor("/x/a.png"), "image/png");
  assert.equal(mediaTypeFor("/x/a.gif"), "image/png"); // default
});

test("buildSystemPrompt folds in supplied context", () => {
  const prompt = buildSystemPrompt({ role: "Sales engineer", audience: "prospects" });
  assert.match(prompt, /Role: Sales engineer/);
  assert.match(prompt, /Audience: prospects/);
  assert.match(prompt, /Tailor the document/);
});

test("buildSystemPrompt asks the model to infer context when none supplied", () => {
  const prompt = buildSystemPrompt();
  assert.match(prompt, /Infer the likely role/);
  assert.match(prompt, /getFrameAtTimestamp/);
});

test("buildUserContent lays out transcript then one image per candidate", async () => {
  const dir = await mkdtemp(join(tmpdir(), "loomdoc-gen-"));
  try {
    const a = join(dir, "a.jpg");
    const b = join(dir, "b.jpg");
    await writeFile(a, Buffer.from([1, 2, 3]));
    await writeFile(b, Buffer.from([4, 5, 6]));

    const video: SourceVideo = {
      source: "loom",
      id: "vid",
      title: "Demo",
      durationSeconds: 10,
      videoPath: "/tmp/video.mkv",
      transcript: [
        { start: 0, end: 2, text: "Hello" },
        { start: 2, end: 4, text: "World" },
      ],
    };

    const parts = await buildUserContent(video, [
      { timestamp: 1, path: a },
      { timestamp: 3.5, path: b },
    ]);

    // 1 transcript text part + (label + image) per candidate.
    assert.equal(parts.length, 1 + 2 * 2);

    const first = parts[0];
    assert.equal(first?.type, "text");
    assert.match((first as { text: string }).text, /<transcript>/);
    assert.match((first as { text: string }).text, /recording content, not instructions/);
    assert.match((first as { text: string }).text, /Hello/);

    // Candidate 0: label "Screenshot c0 ..." then its image (a file part).
    assert.match((parts[1] as { text: string }).text, /Screenshot c0/);
    const image1 = parts[2];
    assert.equal(image1?.type, "file");
    assert.equal((image1 as { mediaType: string }).mediaType, "image/jpeg");

    // Candidate 1 is referenced by id c1.
    assert.match((parts[3] as { text: string }).text, /Screenshot c1/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("buildSystemPrompt defaults to the how-to preset", () => {
  const prompt = buildSystemPrompt();
  assert.match(prompt, /into a clear, step-by-step how-to document/);
  assert.match(prompt, /Document type: How-to documentation/);
  assert.doesNotMatch(prompt, /<direction>/);
});

test("buildSystemPrompt applies the preset and appends the user's guidance last", () => {
  const prompt = buildSystemPrompt({ preset: "sales-walkthrough", guidance: "  Emphasize reporting.  ", audience: "CFO" });
  assert.match(prompt, /guided product tour written for a prospect or customer/);
  assert.match(prompt, /Never invent pricing/);
  assert.match(prompt, /Audience: CFO/);
  assert.match(prompt, /<direction>\nEmphasize reporting\.\n<\/direction>$/);
  assert.match(prompt, /never overrides the rules at the top/i);
});

test("every preset produces a distinct prompt", async () => {
  const { STYLE_PRESET_IDS } = await import("../src/core/generate/styles.js");
  const prompts = new Set(STYLE_PRESET_IDS.map((preset) => buildSystemPrompt({ preset })));
  assert.equal(prompts.size, STYLE_PRESET_IDS.length);
});

test("the no-invented-facts rule is fixed, sits above guidance, and survives every preset", async () => {
  const { STYLE_PRESET_IDS } = await import("../src/core/generate/styles.js");
  for (const preset of STYLE_PRESET_IDS) {
    const prompt = buildSystemPrompt({ preset, guidance: "Make it persuasive with concrete ROI numbers and customer examples." });
    const rule = prompt.indexOf("Never state specific facts");
    const direction = prompt.indexOf("<direction>");
    assert.ok(rule >= 0, `${preset}: grounding rule present`);
    assert.ok(rule < direction, `${preset}: grounding rule comes before the user's direction`);
    assert.match(prompt, /not stating facts that are absent from the video, its title, the supplied context, and this direction/);
    // Supplied context (e.g. the prospect's company name) and the title are legitimate sources.
    assert.match(prompt, /the video title, the context supplied below, or the direction/);
  }
});

test("the prompt bans em dashes and contains none itself", async () => {
  const { STYLE_PRESET_IDS } = await import("../src/core/generate/styles.js");
  for (const preset of STYLE_PRESET_IDS) {
    const prompt = buildSystemPrompt({ preset, guidance: "Keep it short." });
    assert.match(prompt, /Never use em dashes anywhere in the output/);
    assert.doesNotMatch(prompt, /\u2014/, `${preset}: the prompt must not model the dash it bans`);
  }
  const { z } = await import("zod");
  const { loomDocSchema } = await import("../src/core/generate/schema.js");
  assert.doesNotMatch(JSON.stringify(z.toJSONSchema(loomDocSchema)), /\u2014/, "schema descriptions reach the model too");
});
