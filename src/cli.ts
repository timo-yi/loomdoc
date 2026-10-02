#!/usr/bin/env node
import { parseArgs } from "node:util";
import { runLoomdoc } from "./index.js";
import type { DocContext, Effort, OutputFormat } from "./core/types.js";
import { detectSource } from "./core/ingest/index.js";
import { isStylePresetId, STYLE_PRESET_IDS, STYLE_PRESETS } from "./core/generate/styles.js";
import { blockingProblems, requirementsFor, type Requirement } from "./setup/checks.js";
import { isInteractiveTerminal, runPreflight, terminalIO } from "./setup/preflight.js";
import { startUiServer } from "./ui/server.js";
import { openInBrowser } from "./ui/open.js";

const USAGE = `loomdoc – turn a Loom or YouTube walkthrough into a screenshot-rich how-to doc

Usage:
  loomdoc <loom-or-youtube-url> [options]
  loomdoc ui [--port <n>] [--no-open] [--out <dir>]   Open the local web UI
  loomdoc doctor [--yes]     Check (and offer to install) everything loomdoc needs

Options:
  --out <dir>        Output root directory (default: ./out)
  --formats <list>   Comma-separated: markdown,docx,pdf (default: all three)
  --pdf-layout <l>   pageless (one continuous page, for screens) | paged (Letter pages,
                     for printing). Default: pageless
  --model <id>       Model id (default: claude-sonnet-5)
  --effort <level>   low|medium|high|xhigh|max (default: medium)

Document style:
  --preset <id>      ${STYLE_PRESET_IDS.join(" | ")}
                     (default: how-to; "custom" requires --guidance)
  --guidance <text>  Free-text direction for the AI (what to emphasize, skip, tone…)

Relevance context (all optional; inferred from the video when omitted):
  --role <text>
  --industry <text>
  --function <text>
  --audience <text>
  --use-case <text>
  --intent <text>
  --style <text>     Free-text voice/style steer

Setup:
  -y, --yes          Answer "yes" to install prompts (also works without a terminal)

  -h, --help         Show this help

Requires ffmpeg and ANTHROPIC_API_KEY; YouTube links also need yt-dlp and Deno.
loomdoc checks these at launch and offers to install anything missing.
`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: "string" },
      formats: { type: "string" },
      "pdf-layout": { type: "string" },
      model: { type: "string" },
      effort: { type: "string" },
      role: { type: "string" },
      industry: { type: "string" },
      function: { type: "string" },
      audience: { type: "string" },
      "use-case": { type: "string" },
      intent: { type: "string" },
      style: { type: "string" },
      preset: { type: "string" },
      guidance: { type: "string" },
      port: { type: "string" },
      "no-open": { type: "boolean" },
      yes: { type: "boolean", short: "y" },
      help: { type: "boolean", short: "h" },
    },
  });

  const url = positionals[0];
  if (values.help || !url) {
    process.stdout.write(USAGE);
    process.exit(values.help ? 0 : 1);
  }

  const preflight = { interactive: isInteractiveTerminal(), assumeYes: values.yes ?? false };

  if (url === "doctor") {
    process.stderr.write("Checking what loomdoc needs:\n");
    const ready = await runPreflight(requirementsFor({ youtube: true }), terminalIO(), { ...preflight, verbose: true });
    process.stderr.write(ready ? "\nAll set.\n" : "\nSome requirements are still missing (see above).\n");
    process.exit(ready ? 0 : 1);
  }

  if (url === "ui") {
    await startUi({ ...preflight, port: values.port, open: !values["no-open"], outDir: values.out });
    return;
  }

  if (values.preset !== undefined && !isStylePresetId(values.preset)) {
    throw new Error(`Unknown --preset "${values.preset}". Choose one of: ${STYLE_PRESET_IDS.join(", ")}.`);
  }
  if (values.preset === "custom" && !values.guidance?.trim()) {
    throw new Error('--preset custom needs --guidance describing the document you want.');
  }

  // Check only what this run needs, before any download or spend.
  const needs = { youtube: detectSource(url) === "youtube" };
  const ready = await runPreflight(requirementsFor(needs), terminalIO(), { ...preflight, verbose: false });
  if (!ready) {
    process.stderr.write("\nloomdoc can't run until the items above are fixed.\n");
    process.exit(1);
  }

  const pdfLayout = values["pdf-layout"];
  if (pdfLayout !== undefined && pdfLayout !== "pageless" && pdfLayout !== "paged") {
    throw new Error(`Unknown --pdf-layout "${pdfLayout}". Choose pageless or paged.`);
  }

  const formats = values.formats
    ? (values.formats.split(",").map((f) => f.trim()).filter(Boolean) as OutputFormat[])
    : undefined;

  const context: DocContext = {
    role: values.role,
    industry: values.industry,
    function: values.function,
    audience: values.audience,
    useCase: values["use-case"],
    intent: values.intent,
    style: values.style,
    preset: values.preset as DocContext["preset"],
    guidance: values.guidance,
  };

  const result = await runLoomdoc({
    url,
    outDir: values.out,
    formats,
    pdfLayout,
    model: values.model,
    effort: values.effort as Effort | undefined,
    context,
    onProgress: (e) => process.stderr.write(`› ${e.message}\n`),
  });

  process.stdout.write("\nDone. Wrote:\n");
  for (const f of result.files) process.stdout.write(`  ${f}\n`);
  process.stdout.write(`\nImages:        ${result.imagesDir}\n`);
  process.stdout.write(`Output folder: ${result.outputDir}\n`);
}

interface UiLaunch {
  interactive: boolean;
  assumeYes: boolean;
  port?: string;
  open: boolean;
  outDir?: string;
}

/**
 * `loomdoc ui`: check setup in this terminal (installs happen here, never from the web page),
 * then serve the UI on loopback and open it.
 */
async function startUi(launch: UiLaunch): Promise<void> {
  const port = launch.port === undefined ? 0 : Number(launch.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`Invalid --port "${launch.port}".`);

  const io = terminalIO();
  const opts = { interactive: launch.interactive, assumeYes: launch.assumeYes, verbose: false };
  if (!(await runPreflight(requirementsFor({ youtube: false }), io, opts))) {
    process.stderr.write("\nloomdoc can't start until the items above are fixed.\n");
    process.exit(1);
  }
  // YouTube tools are optional at startup: without them the UI still works for Loom links.
  const youtubeOnly = (): Requirement[] =>
    requirementsFor({ youtube: true }).filter((r) => r.id === "yt-dlp" || r.id === "deno");
  await runPreflight(youtubeOnly(), io, opts);

  const server = await startUiServer({
    outDir: launch.outDir,
    port,
    checkRequirements: async (videoUrl) =>
      blockingProblems(requirementsFor({ youtube: detectSource(videoUrl) === "youtube" })),
    setupNotices: async () => {
      const problems = await blockingProblems(youtubeOnly());
      return problems.length > 0 ? ["YouTube links won't work yet.", ...problems] : [];
    },
  });

  // The link is single-use, and auto-opening spends it in the default browser, so say which
  // browser holds the session and how to use a different one.
  process.stderr.write(
    launch.open
      ? "\nloomdoc UI is running and opening in your default browser.\n" +
          "If it didn't open, use this private link. It works once, and a new one is made each time\n" +
          `loomdoc ui starts (to use a different browser, restart with --no-open):\n\n  ${server.url}\n\n`
      : "\nloomdoc UI is running. Open this private link in the browser you want to use.\n" +
          `It works once, and a new one is made each time loomdoc ui starts:\n\n  ${server.url}\n\n`,
  );
  process.stderr.write("Keep this terminal open while you use it. Press Ctrl-C to stop.\n");
  if (launch.open) openInBrowser(server.url);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`\nloomdoc error: ${message}\n`);
  process.exit(1);
});
