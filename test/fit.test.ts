import { test } from "node:test";
import assert from "node:assert/strict";
import { fitWithin } from "../src/core/render/fit.js";

test("scales down by width", () => {
  assert.deepEqual(fitWithin(1200, 600, 600, 700), { width: 600, height: 300 });
});

test("bounds height for tall/scrolling captures", () => {
  const r = fitWithin(200, 4000, 600, 700);
  assert.ok(r.height <= 700, `height ${r.height} should be bounded`);
  assert.equal(r.height, 700);
  assert.equal(r.width, 35); // aspect preserved
});

test("never enlarges a small image", () => {
  assert.deepEqual(fitWithin(100, 100, 600, 700), { width: 100, height: 100 });
});

test("falls back sanely for unknown dimensions", () => {
  const r = fitWithin(undefined, undefined, 600, 700);
  assert.ok(r.width <= 600 && r.height <= 700 && r.width >= 1 && r.height >= 1);
});
