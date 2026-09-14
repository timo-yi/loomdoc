import { writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { LoomDoc } from "../types.js";

/**
 * Markdown renderer (PRD decision D8). Fully implemented — it needs no dependencies.
 * Images are referenced by relative path into the adjacent images folder (the one
 * format that isn't a single self-contained file, so the folder must travel with the
 * .md). Reads cleanly in Notion and most Markdown viewers.
 */
export function renderMarkdown(doc: LoomDoc, imagesDirName = "images"): string {
  const lines: string[] = [];
  lines.push(`# ${doc.title}`, "");
  if (doc.overview) lines.push(doc.overview, "");

  doc.steps.forEach((step, i) => {
    lines.push(`## ${i + 1}. ${step.heading}`, "");
    const shot = step.screenshot;
    if (shot?.path) {
      const rel = `${imagesDirName}/${basename(shot.path)}`;
      const alt = shot.caption ?? step.heading;
      lines.push(`![${alt}](${rel})`, "");
      if (shot.caption) lines.push(`*${shot.caption}*`, "");
    }
    if (step.body) lines.push(step.body, "");
  });

  return lines.join("\n").trimEnd() + "\n";
}

/** Render and write the Markdown document. Returns the absolute file path. */
export async function writeMarkdown(
  doc: LoomDoc,
  outputDir: string,
  imagesDirName = "images",
): Promise<string> {
  const content = renderMarkdown(doc, imagesDirName);
  const path = join(outputDir, "document.md");
  await writeFile(path, content, "utf8");
  return path;
}
