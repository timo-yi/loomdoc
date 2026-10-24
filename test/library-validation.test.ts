/**
 * runLoomdoc is public API (PRD D4) and must validate its own options — CLI flag checking
 * doesn't cover library callers. These must reject before any preflight, download, or spend;
 * the URL below never resolves because validation runs first (and if it didn't, ingest would
 * reject the unsupported source rather than touch the network).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { runLoomdoc } from "../src/index.js";

const url = "https://example.invalid/watch?v=nope";

test("runLoomdoc rejects unknown output formats before doing any work", async () => {
  // Casts simulate a JavaScript caller bypassing the TS types.
  await assert.rejects(
    runLoomdoc({ url, formats: ["markdown", "docm"] as unknown as never }),
    /Unknown output format "docm"\. Choose from: markdown, docx, pdf\./,
  );
});

test("runLoomdoc rejects an empty formats list", async () => {
  await assert.rejects(runLoomdoc({ url, formats: [] }), /formats needs at least one/);
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

test("library errors never leak CLI flag names", async () => {
  await assert.rejects(runLoomdoc({ url, formats: ["nope"] as unknown as never }), (err: Error) => {
    assert.ok(!err.message.includes("--"), `message leaks a CLI flag: ${err.message}`);
    return true;
  });
});
