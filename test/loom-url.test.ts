import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLoomUrl } from "../src/core/ingest/loom.js";

const ID = "abcdef0123456789abcdef0123456789";

test("parses a standard share link", () => {
  assert.equal(parseLoomUrl(`https://www.loom.com/share/${ID}`), ID);
});

test("parses an embed link", () => {
  assert.equal(parseLoomUrl(`https://www.loom.com/embed/${ID}`), ID);
});

test("tolerates query strings and trailing content", () => {
  assert.equal(parseLoomUrl(`https://www.loom.com/share/${ID}?t=30&sid=x`), ID);
});

test("accepts a raw id", () => {
  assert.equal(parseLoomUrl(ID), ID);
});

test("lowercases the id", () => {
  assert.equal(parseLoomUrl(ID.toUpperCase()), ID);
});

test("throws on a non-Loom url", () => {
  assert.throws(() => parseLoomUrl("https://example.com/video/123"));
});

test("throws on empty input", () => {
  assert.throws(() => parseLoomUrl(""));
});
