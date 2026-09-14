import { test } from "node:test";
import assert from "node:assert/strict";
import { parseVtt, parseTimestamp } from "../src/core/util/vtt.js";

test("parseTimestamp handles hh:mm:ss.mmm", () => {
  assert.equal(parseTimestamp("01:02:03.500"), 3723.5);
});

test("parseTimestamp handles mm:ss.mmm", () => {
  assert.equal(parseTimestamp("02:03.250"), 123.25);
});

test("parseTimestamp tolerates comma separator", () => {
  assert.equal(parseTimestamp("00:00:01,000"), 1);
});

test("parses a basic VTT into cues", () => {
  const vtt = `WEBVTT

00:00:00.000 --> 00:00:02.000
Hello there

00:00:02.000 --> 00:00:05.000
Second line`;
  const cues = parseVtt(vtt);
  assert.equal(cues.length, 2);
  assert.deepEqual(cues[0], { start: 0, end: 2, text: "Hello there" });
  assert.deepEqual(cues[1], { start: 2, end: 5, text: "Second line" });
});

test("skips NOTE blocks and cue identifiers, strips inline tags", () => {
  const vtt = `WEBVTT

NOTE this is a comment

1
00:00:01.000 --> 00:00:02.000
<v Speaker>Tagged</v> text`;
  const cues = parseVtt(vtt);
  assert.equal(cues.length, 1);
  assert.equal(cues[0]?.text, "Tagged text");
});

test("joins multi-line cue text", () => {
  const vtt = `WEBVTT

00:00:01.000 --> 00:00:03.000
line one
line two`;
  const cues = parseVtt(vtt);
  assert.equal(cues[0]?.text, "line one line two");
});

test("returns empty array for header-only input", () => {
  assert.deepEqual(parseVtt("WEBVTT\n"), []);
});

// --- Regression tests for skeptic findings ---------------------------------------------

test("a whitespace-only separator line does NOT merge cues (skeptic M1)", () => {
  // The 'blank' line between the two cues contains spaces.
  const vtt = ["00:00:01.000 --> 00:00:02.000", "Hello", "   ", "00:00:03.000 --> 00:00:04.000", "World"].join("\n");
  const cues = parseVtt(vtt);
  assert.equal(cues.length, 2);
  assert.deepEqual(cues[0], { start: 1, end: 2, text: "Hello" });
  assert.deepEqual(cues[1], { start: 3, end: 4, text: "World" });
});

test("cue settings on the timing line do not leak into time or text", () => {
  const vtt = `WEBVTT

00:00:01.000 --> 00:00:02.000 align:start position:0%
Body`;
  const cues = parseVtt(vtt);
  assert.equal(cues.length, 1);
  assert.equal(cues[0]?.start, 1);
  assert.equal(cues[0]?.end, 2);
  assert.equal(cues[0]?.text, "Body");
});

test("handles CRLF line endings", () => {
  const vtt = "WEBVTT\r\n\r\n00:00:01.000 --> 00:00:02.000\r\nHi\r\n";
  const cues = parseVtt(vtt);
  assert.equal(cues.length, 1);
  assert.equal(cues[0]?.text, "Hi");
});

test("decodes standard character references", () => {
  const vtt = `WEBVTT

00:00:01.000 --> 00:00:02.000
Tom &amp; Jerry cost &lt; $5 &gt; nothing`;
  const cues = parseVtt(vtt);
  assert.equal(cues[0]?.text, "Tom & Jerry cost < $5 > nothing");
});

test("keeps cues with hours >= 100", () => {
  const vtt = `WEBVTT

100:00:01.000 --> 100:00:02.000
Long`;
  const cues = parseVtt(vtt);
  assert.equal(cues.length, 1);
  assert.equal(cues[0]?.start, 360001);
  assert.equal(cues[0]?.text, "Long");
});

test("skips STYLE blocks before real cues", () => {
  const vtt = `WEBVTT

STYLE
::cue { color: yellow }

00:00:01.000 --> 00:00:02.000
Styled`;
  const cues = parseVtt(vtt);
  assert.equal(cues.length, 1);
  assert.equal(cues[0]?.text, "Styled");
});
