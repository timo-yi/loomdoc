import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { generateText, stepCountIs, tool, Output, type ImagePart, type TextPart } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { loomDocSchema, type LoomDocOutput } from "./schema.js";
import type { DocContext, Effort } from "../types.js";
import type { LoomVideo } from "../ingest/loom.js";
import type { CandidateFrame } from "../frames/winnow.js";

/**
 * Doc generation — where all judgment lives (PRD decisions D5, D7, D9, D10).
 *
 * The vision LLM receives the full timestamped transcript and the winnowed candidate
 * screenshots, and produces the schema-validated document. It may call
 * `getFrameAtTimestamp` to pull any exact moment it judges necessary; that tool returns the
 * frame as an image the model then sees, so its decision is grounded in what's actually on
 * screen. The call count is capped by `maxFrameRequests` (enforced by the pipeline's
 * requestFrame) and the overall loop by `stopWhen`.
 */

export interface GenerateInput {
  video: LoomVideo;
  candidates: CandidateFrame[];
  context?: DocContext;
  model: string;
  effort: Effort;
  maxFrameRequests: number;
  /** Pull an extra frame the model asks for; returns the on-disk image path. */
  requestFrame: (timestampSeconds: number) => Promise<string>;
}

// A few reasoning/finalize steps on top of the model's frame-tool budget.
const EXTRA_STEPS = 4;

export async function generateDoc(input: GenerateInput): Promise<LoomDocOutput> {
  const system = buildSystemPrompt(input.context);
  const content = await buildUserContent(input.video, input.candidates);

  const result = await generateText({
    model: anthropic(input.model),
    system,
    messages: [{ role: "user", content }],
    tools: { getFrameAtTimestamp: makeFrameTool(input) },
    stopWhen: stepCountIs(input.maxFrameRequests + EXTRA_STEPS),
    output: Output.object({ schema: loomDocSchema }),
    providerOptions: { anthropic: { effort: input.effort } },
  });

  return result.output;
}

/** Build the system prompt, folding in supplied context or asking the model to infer it. */
export function buildSystemPrompt(context?: DocContext): string {
  const lines: string[] = [
    "You turn a recorded software walkthrough into a clear, step-by-step how-to document.",
    "You are given the full timestamped transcript and a set of candidate screenshots, each labeled with its timestamp in seconds.",
    "Produce an ordered list of steps. Each step has a heading, body text in the target voice, and — only where a screenshot genuinely helps — a screenshot referenced by its timestamp in seconds.",
    "Prefer a candidate screenshot's timestamp. If the clearest moment for a step falls between candidates, call getFrameAtTimestamp(timestampSeconds) to fetch and view that exact frame before deciding.",
    "Do not put a screenshot on every step; use them where they add clarity. Never describe UI you cannot see in a screenshot or infer from the transcript.",
    "Set needsDeeperReasoning: true on any step you are unsure about.",
    "Write a short overview that orients the reader, and set the audience field.",
  ];

  const ctx = context ?? {};
  const supplied = [
    ctx.role ? `Role: ${ctx.role}` : null,
    ctx.industry ? `Industry: ${ctx.industry}` : null,
    ctx.function ? `Function: ${ctx.function}` : null,
    ctx.audience ? `Audience: ${ctx.audience}` : null,
    ctx.useCase ? `Use case: ${ctx.useCase}` : null,
    ctx.intent ? `Intent: ${ctx.intent}` : null,
    ctx.style ? `Style: ${ctx.style}` : null,
  ].filter((s): s is string => s !== null);

  if (supplied.length > 0) {
    lines.push("Tailor the document to this context so it is maximally relevant:", ...supplied);
  } else {
    lines.push(
      "No audience context was supplied. Infer the likely role, industry, function, audience, use case, and intent from the video, and tailor the document's framing, terminology, and emphasis accordingly.",
    );
  }
  return lines.join("\n");
}

/** Build the user message: the transcript, then each candidate screenshot as an image. */
export async function buildUserContent(
  video: LoomVideo,
  candidates: CandidateFrame[],
): Promise<Array<TextPart | ImagePart>> {
  const transcript = video.transcript.map((c) => `[${formatTs(c.start)}] ${c.text}`).join("\n");
  const parts: Array<TextPart | ImagePart> = [
    {
      type: "text",
      text:
        `Video title: ${video.title}\n\n` +
        `TRANSCRIPT (timestamps shown as mm:ss):\n${transcript}\n\n` +
        `CANDIDATE SCREENSHOTS follow. Each is labeled with its timestamp in seconds; reference screenshots by that number of seconds.`,
    },
  ];

  for (const candidate of candidates) {
    const data = await readFile(candidate.path);
    parts.push({
      type: "text",
      text: `Screenshot at ${formatTs(candidate.timestamp)} (timestamp ${candidate.timestamp.toFixed(2)}s):`,
    });
    parts.push({ type: "image", image: data, mediaType: mediaTypeFor(candidate.path) });
  }
  return parts;
}

function makeFrameTool(input: GenerateInput) {
  return tool({
    description:
      "Fetch the exact video frame at a timestamp (seconds) and return it as an image. Use when the best screenshot for a step falls between the provided candidates.",
    inputSchema: z.object({
      timestampSeconds: z.number().describe("Seconds into the video."),
    }),
    execute: async ({ timestampSeconds }) => {
      const path = await input.requestFrame(timestampSeconds);
      const data = await readFile(path);
      return { timestampSeconds, mediaType: mediaTypeFor(path), base64: data.toString("base64") };
    },
    // Return the frame to the model as an image so its judgment is grounded in the pixels.
    toModelOutput: ({ output }) => ({
      type: "content",
      value: [
        { type: "text", text: `Frame at ${output.timestampSeconds}s:` },
        { type: "file", data: { type: "data", data: output.base64 }, mediaType: output.mediaType },
      ],
    }),
  });
}

/** Seconds -> mm:ss (or h:mm:ss for long videos). */
export function formatTs(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function mediaTypeFor(path: string): string {
  return extname(path).toLowerCase() === ".jpg" || extname(path).toLowerCase() === ".jpeg"
    ? "image/jpeg"
    : "image/png";
}
