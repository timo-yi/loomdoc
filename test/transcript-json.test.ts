import { test } from "node:test";
import assert from "node:assert/strict";
import { parseJsonTranscript } from "../src/core/util/transcript-json.js";

test("parses a top-level array with start_time/end_time/value", () => {
  const json = JSON.stringify([
    { id: "1", start_time: "0", end_time: "2", value: "Hello" },
    { id: "2", start_time: "2", end_time: "5", value: "World" },
  ]);
  const cues = parseJsonTranscript(json);
  assert.equal(cues.length, 2);
  assert.deepEqual(cues[0], { start: 0, end: 2, text: "Hello" });
  assert.deepEqual(cues[1], { start: 2, end: 5, text: "World" });
});

test("parses a wrapped segments array with startSeconds/endSeconds/text", () => {
  const json = JSON.stringify({
    segments: [
      { startSeconds: 1.5, endSeconds: 3, text: "Alpha" },
      { startSeconds: 3, endSeconds: 4, text: "Beta" },
    ],
  });
  const cues = parseJsonTranscript(json);
  assert.equal(cues.length, 2);
  assert.deepEqual(cues[0], { start: 1.5, end: 3, text: "Alpha" });
});

test("defaults end to start when end is missing", () => {
  const json = JSON.stringify([{ start: 4, text: "Solo" }]);
  const cues = parseJsonTranscript(json);
  assert.deepEqual(cues[0], { start: 4, end: 4, text: "Solo" });
});

test("skips segments with no text or no start", () => {
  const json = JSON.stringify([{ start: 1 }, { text: "no start" }, { start: 2, text: "ok" }]);
  const cues = parseJsonTranscript(json);
  assert.equal(cues.length, 1);
  assert.equal(cues[0]?.text, "ok");
});

test("returns empty array for invalid JSON", () => {
  assert.deepEqual(parseJsonTranscript("not json"), []);
});

test("returns empty array for JSON with no recognizable segments", () => {
  assert.deepEqual(parseJsonTranscript(JSON.stringify({ foo: "bar" })), []);
});
