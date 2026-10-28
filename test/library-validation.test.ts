/**
 * runLoomdoc is public API (PRD D4) and must validate its own options — CLI flag checking
 * doesn't cover library callers. These must reject before any preflight, download, or spend;
 * the URL below never resolves because validation runs first (and if it didn't, ingest would
 * reject the unsupported source rather than touch the network).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { LOOMDOC_ERROR_CODES, LoomdocError, runLoomdoc, type LoomdocErrorCode } from "../src/index.js";
import { checkOutputFormats } from "../src/core/options.js";

const url = "https://example.invalid/watch?v=nope";

test("runLoomdoc rejects unknown output formats before doing any work", async () => {
  // Casts simulate a JavaScript caller bypassing the TS types.
  await assert.rejects(
    runLoomdoc({ url, formats: ["markdown", "docm"] as unknown as never }),
    /Unknown formats "docm"\. Choose from: markdown, docx, pdf\./,
  );
});

test("runLoomdoc rejects an empty formats list", async () => {
  await assert.rejects(runLoomdoc({ url, formats: [] }), /formats needs at least one/);
});

test("runLoomdoc rejects a formats value that is not a list", async () => {
  await assert.rejects(
    runLoomdoc({ url, formats: "pdf" as unknown as never }),
    /formats must be a list of: markdown, docx, pdf\./,
  );
});

test("checkOutputFormats dedupes and names every unknown entry once", () => {
  assert.deepEqual(checkOutputFormats(["pdf", "markdown", "pdf"], "formats"), ["pdf", "markdown"]);
  assert.throws(() => checkOutputFormats(["docm", 3, "docm"], "formats"), /Unknown formats "docm, 3"/);
});

test("runLoomdoc rejects unknown effort and PDF layout", async () => {
  await assert.rejects(
    runLoomdoc({ url, effort: "ultra" as unknown as never }),
    /Unknown effort "ultra"\. Choose one of: low, medium, high, xhigh, max\./,
  );
  await assert.rejects(
    runLoomdoc({ url, pdfLayout: "slides" as unknown as never }),
    /Unknown PDF layout "slides"\. Choose one of: pageless, paged\./,
  );
});

test("runLoomdoc rejects an unknown preset, including a retired one", async () => {
  await assert.rejects(
    runLoomdoc({ url, context: { preset: "training" as unknown as never } }),
    /Unknown preset "training"\. Choose one of: tutorial, how-to, /,
  );
});

test("runLoomdoc rejects a preset that needs guidance when none is given", async () => {
  for (const guidance of [undefined, "", "   "]) {
    await assert.rejects(
      runLoomdoc({ url, context: { preset: "custom", guidance } }),
      /The Custom style needs guidance describing the document you want\./,
    );
  }
});

test("the package exports LoomdocError with a code and a cause", () => {
  const cause = new Error("socket hang up");
  const code: LoomdocErrorCode = "NETWORK";
  const err = new LoomdocError(code, "Network error.", { cause });
  assert.ok(err instanceof Error);
  assert.equal(err.name, "LoomdocError");
  assert.equal(err.code, "NETWORK");
  assert.equal(err.cause, cause);
  assert.ok(LOOMDOC_ERROR_CODES.includes("INVALID_OPTIONS"));
});

test("runLoomdoc rejects every bad option with code INVALID_OPTIONS", async () => {
  const invalid = [
    { url: "" },
    { url, formats: ["docm"] as unknown as never },
    { url, effort: "ultra" as unknown as never },
    { url, pdfLayout: "slides" as unknown as never },
    { url, context: { preset: "nope" as unknown as never } },
    { url, context: { preset: "custom" as const } },
  ];
  for (const options of invalid) {
    await assert.rejects(runLoomdoc(options), (err: unknown) => {
      assert.ok(err instanceof LoomdocError, `not a LoomdocError: ${String(err)}`);
      assert.equal(err.code, "INVALID_OPTIONS");
      return true;
    });
  }
});

test("library errors never leak CLI flag names", async () => {
  const invalid = [
    { url, formats: ["nope"] as unknown as never },
    { url, context: { preset: "nope" as unknown as never } },
    { url, context: { preset: "custom" as const } },
  ];
  for (const options of invalid) {
    await assert.rejects(runLoomdoc(options), (err: Error) => {
      assert.ok(!err.message.includes("--"), `message leaks a CLI flag: ${err.message}`);
      return true;
    });
  }
});
