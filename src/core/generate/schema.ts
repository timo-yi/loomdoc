import { z } from "zod";

/**
 * LLM-facing output schema (PRD decision D8).
 *
 * The model references screenshots by the id of a frame it was actually shown — a candidate
 * (`c0`, `c1`, …) or one it fetched via getFrameAtTimestamp (`f0`, `f1`, …). Referencing by id
 * (not a free timestamp) means the exact bytes the model reasoned over are what ship, with no
 * re-extraction and no drift.
 */

export const screenshotSchema = z.object({
  screenshotId: z
    .string()
    .describe('The id of a shown screenshot: a candidate ("c3") or a fetched frame ("f1").'),
  caption: z.string().optional().describe("Short caption describing what the screenshot shows."),
});

export const stepSchema = z.object({
  heading: z.string().min(1).describe("Short title for this step."),
  body: z.string().describe("The instruction/explanation for this step, in the target voice."),
  screenshot: screenshotSchema
    .optional()
    .describe("Include only when a screenshot genuinely helps this step."),
  needsDeeperReasoning: z
    .boolean()
    .optional()
    .describe(
      "Set true if this step is ambiguous: the screenshot is unclear, the transcript is silent on it, or you inferred UI you could not fully see.",
    ),
});

export const loomDocSchema = z.object({
  title: z.string().min(1),
  overview: z.string().describe("A short orientation paragraph for the whole walkthrough."),
  audience: z.string().describe("Who this doc is for — supplied context or inferred from the video."),
  steps: z.array(stepSchema).min(1),
});

export type LoomDocOutput = z.infer<typeof loomDocSchema>;
