import { test } from "node:test";
import assert from "node:assert/strict";
import { EFFORT_LEVELS, OUTPUT_FORMATS, PDF_LAYOUTS, isEffort, isOutputFormat, isPdfLayout } from "../src/core/types.js";
import { parseEffort, parseOutputFormats, parsePdfLayout } from "../src/cli-flags.js";

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

test("parsePdfLayout accepts every layout and rejects anything else", () => {
  for (const layout of PDF_LAYOUTS) assert.equal(parsePdfLayout(layout), layout);
  assert.throws(() => parsePdfLayout("slides"), /Unknown --pdf-layout "slides".*pageless, paged/);
});

test("parseEffort accepts every level and rejects anything else", () => {
  for (const level of EFFORT_LEVELS) assert.equal(parseEffort(level), level);
  assert.throws(() => parseEffort("ultra"), /Unknown --effort "ultra".*low, medium, high, xhigh, max/);
});

test("type guards agree with the enum constants", () => {
  for (const f of OUTPUT_FORMATS) assert.ok(isOutputFormat(f));
  assert.ok(!isOutputFormat("pptx"));
  for (const l of PDF_LAYOUTS) assert.ok(isPdfLayout(l));
  assert.ok(!isPdfLayout("slides"));
  for (const e of EFFORT_LEVELS) assert.ok(isEffort(e));
  assert.ok(!isEffort("ultra"));
});
