import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchLoomVideo, parseLoomUrl } from "../src/core/ingest/loom.js";

const ID = "abcdef0123456789abcdef0123456789"; // exactly 32 hex

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

test("lowercases a raw id", () => {
  assert.equal(parseLoomUrl(ID.toUpperCase()), ID);
});

test("lowercases an uppercase id in a URL path", () => {
  assert.equal(parseLoomUrl(`https://www.loom.com/share/${ID.toUpperCase()}`), ID);
});

test("throws on a non-Loom url", () => {
  assert.throws(() => parseLoomUrl("https://example.com/video/123"));
});

test("throws on empty input", () => {
  assert.throws(() => parseLoomUrl(""));
});

// --- Regression tests for skeptic findings ---------------------------------------------

test("rejects a 31-char (too short) id", () => {
  assert.throws(() => parseLoomUrl(ID.slice(0, 31)));
});

test("does not over-capture an id followed by more hex", () => {
  // A 32-hex id immediately followed by more hex is ambiguous/malformed: reject rather
  // than silently return the wrong (concatenated) id.
  assert.throws(() => parseLoomUrl(`https://www.loom.com/share/${ID}deadbeef`));
});

test("returns exactly 32 chars for a valid link", () => {
  assert.equal(parseLoomUrl(`https://www.loom.com/share/${ID}`).length, 32);
});

test("a Loom reply that is not JSON rejects with SOURCE_UNAVAILABLE, not a SyntaxError", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("<html>blocked</html>", { status: 200 }));
  await assert.rejects(fetchLoomVideo(`https://www.loom.com/share/${ID}`, "/nonexistent"), (err: Error & { code?: string }) => {
    assert.equal(err.name, "LoomdocError");
    assert.equal(err.code, "SOURCE_UNAVAILABLE");
    assert.ok(err.cause instanceof SyntaxError);
    return true;
  });
});
