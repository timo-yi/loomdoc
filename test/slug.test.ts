import { test } from "node:test";
import assert from "node:assert/strict";
import { slugify } from "../src/core/util/slug.js";

test("slugify keeps Latin titles readable and falls back per video otherwise", () => {
  assert.equal(slugify("Getting Started with Loom!", "loom-x"), "getting-started-with-loom");
  assert.equal(slugify("Café résumé", "x"), "cafe-resume");
  // Titles with no Latin letters or digits must not all collapse into one shared folder.
  assert.equal(slugify("使い方ガイド", "youtube-abc123def45"), "youtube-abc123def45");
  assert.equal(slugify("Как настроить отчеты", "youtube-zzz"), "youtube-zzz");
  assert.equal(slugify("", "loom-0123"), "loom-0123");
});
