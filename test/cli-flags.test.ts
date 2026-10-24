import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EFFORT_LEVELS,
  OUTPUT_FORMATS,
  isEffort,
  isOutputFormat,
  parseEffort,
  parseOutputFormats,
} from "../src/core/types.js";

test("parseOutputFormats accepts valid lists and normalizes them", () => {
  assert.deepEqual(parseOutputFormats("markdown,pdf"), ["markdown", "pdf"]);
  // Surrounding whitespace and duplicate entries are tolerated.
  assert.deepEqual(parseOutputFormats(" docx , markdown ,docx "), ["docx", "markdown"]);
  assert.deepEqual(parseOutputFormats(OUTPUT_FORMATS.join(",")), [...OUTPUT_FORMATS]);
});

test("parseOutputFormats rejects unknown formats, naming them and the valid choices", () => {
  assert.throws(() => parseOutputFormats("docm"), /Unknown --formats "docm".*markdown, docx, pdf/);
  // Every bad entry is reported at once, so one run fixes all typos.
  assert.throws(() => parseOutputFormats("docm,xlsx,pdf"), /"docm, xlsx"/);
});

test("parseOutputFormats rejects an empty list", () => {
  assert.throws(() => parseOutputFormats(""), /at least one/);
  assert.throws(() => parseOutputFormats(" , "), /at least one/);
});

test("parseEffort accepts every level and rejects anything else", () => {
  for (const level of EFFORT_LEVELS) {
    assert.equal(parseEffort(level), level);
  }
  assert.throws(() => parseEffort("ultra"), /Unknown --effort "ultra".*low, medium, high, xhigh, max/);
});

test("guards recognize exactly the enum values", () => {
  for (const format of OUTPUT_FORMATS) assert.ok(isOutputFormat(format));
  assert.ok(!isOutputFormat("Markdown")); // case-sensitive
  assert.ok(!isOutputFormat(""));
  for (const level of EFFORT_LEVELS) assert.ok(isEffort(level));
  assert.ok(!isEffort("medium ")); // trimmed values are the parser's job, not the guard's
});
