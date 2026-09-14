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
import type { LoomVideo } from "../src/core/ingest/loom.js";

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

    const video: LoomVideo = {
      id: "vid",
      title: "Demo",
      durationSeconds: 10,
      streamUrl: "https://example.com/s.m3u8",
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
    assert.match((first as { text: string }).text, /TRANSCRIPT/);
    assert.match((first as { text: string }).text, /Hello/);

    const image1 = parts[2];
    assert.equal(image1?.type, "image");
    assert.equal((image1 as { mediaType: string }).mediaType, "image/jpeg");

    const label2 = parts[3];
    assert.match((label2 as { text: string }).text, /3\.50s/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
