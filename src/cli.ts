#!/usr/bin/env node
import { parseArgs } from "node:util";
import { runLoomdoc } from "./index.js";
import type { DocContext, Effort, OutputFormat } from "./core/types.js";

const USAGE = `loomdoc — turn a Loom walkthrough into a screenshot-rich how-to doc

Usage:
  loomdoc <loom-share-url> [options]

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

  -h, --help         Show this help

Requires ffmpeg on PATH and ANTHROPIC_API_KEY in the environment.
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
      help: { type: "boolean", short: "h" },
    },
  });

  const url = positionals[0];
  if (values.help || !url) {
    process.stdout.write(USAGE);
    process.exit(values.help ? 0 : 1);
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
