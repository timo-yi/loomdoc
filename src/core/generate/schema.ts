import { z } from "zod";

/**
 * LLM-facing output schema (PRD decision D8).
 *
 * This is the fixed container the model fills. It is intentionally narrower than the
 * domain types: the model chooses a `timestamp` for each screenshot; the pipeline
 * extracts the actual image afterward and attaches the on-disk path. Keeping the
 * schema fixed is what lets every renderer — and the future PowerPoint deck — work
 * off one structure while the model keeps full freedom over the contents.
 */

export const screenshotSchema = z.object({
  timestamp: z
    .number()
    .describe("Seconds into the video for the frame that best illustrates this step."),
  caption: z.string().optional().describe("Short caption describing what the screenshot shows."),
});

export const stepSchema = z.object({
  heading: z.string().describe("Short title for this step."),
  body: z.string().describe("The instruction/explanation for this step, in the target voice."),
  screenshot: screenshotSchema
    .optional()
    .describe("Include only when a screenshot genuinely helps this step."),
  needsDeeperReasoning: z
    .boolean()
    .optional()
    .describe("Set true if this step was ambiguous and would benefit from a stronger model."),
});

export const loomDocSchema = z.object({
  title: z.string(),
  overview: z.string().describe("A short orientation paragraph for the whole walkthrough."),
  audience: z
    .string()
    .optional()
    .describe("Who this doc is for — inferred from the video if not supplied."),
  steps: z.array(stepSchema),
});

export type LoomDocOutput = z.infer<typeof loomDocSchema>;
