#!/usr/bin/env node
import { parseArgs } from "node:util";
import { runLoomdoc } from "./index.js";
import type { DocContext, Effort, OutputFormat } from "./core/types.js";
import { detectSource } from "./core/ingest/index.js";
import { requirementsFor } from "./setup/checks.js";
import { isInteractiveTerminal, runPreflight, terminalIO } from "./setup/preflight.js";

const USAGE = `loomdoc – turn a Loom or YouTube walkthrough into a screenshot-rich how-to doc

Usage:
  loomdoc <loom-or-youtube-url> [options]
  loomdoc doctor [--yes]     Check (and offer to install) everything loomdoc needs

Options:
  --out <dir>        Output root directory (default: ./out)
  --formats <list>   Comma-separated: markdown,docx,pdf (default: all three)
  --model <id>       Model id (default: claude-sonnet-5)
  --effort <level>   low|medium|high|xhigh|max (default: medium)

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
      model: { type: "string" },
      effort: { type: "string" },
      role: { type: "string" },
      industry: { type: "string" },
      function: { type: "string" },
      audience: { type: "string" },
      "use-case": { type: "string" },
      intent: { type: "string" },
      style: { type: "string" },
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

  // Check only what this run needs, before any download or spend.
  const needs = { youtube: detectSource(url) === "youtube" };
  const ready = await runPreflight(requirementsFor(needs), terminalIO(), { ...preflight, verbose: false });
  if (!ready) {
    process.stderr.write("\nloomdoc can't run until the items above are fixed.\n");
    process.exit(1);
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
  };

  const result = await runLoomdoc({
    url,
    outDir: values.out,
    formats,
    model: values.model,
    effort: values.effort as Effort | undefined,
    context,
  });

  process.stdout.write("\nDone. Wrote:\n");
  for (const f of result.files) process.stdout.write(`  ${f}\n`);
  process.stdout.write(`\nImages:        ${result.imagesDir}\n`);
  process.stdout.write(`Output folder: ${result.outputDir}\n`);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`\nloomdoc error: ${message}\n`);
  process.exit(1);
});
