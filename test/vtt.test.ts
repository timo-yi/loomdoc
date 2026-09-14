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
