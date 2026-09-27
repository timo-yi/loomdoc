/**
 * Document style presets (PRD decision D16).
 *
 * A preset sets the document's purpose, reader, and tone. It does not change the output
 * schema: every preset still produces an ordered list of sections ("steps") with optional
 * screenshots, so every renderer works unchanged. The instructions steer emphasis and framing
 * and leave structure within that container to the model (PRD D5, D9).
 */

export const STYLE_PRESET_IDS = [
  "how-to",
  "sales-walkthrough",
  "training",
  "support-article",
  "release-notes",
  "product-launch",
  "custom",
] as const;

export type StylePresetId = (typeof STYLE_PRESET_IDS)[number];

export interface StylePreset {
  id: StylePresetId;
  label: string;
  /** One line for pickers and --help. */
  summary: string;
  /** What the document is, in the system prompt's words. */
  documentType: string;
  instructions: string[];
}

export const DEFAULT_PRESET: StylePresetId = "how-to";

export const STYLE_PRESETS: Record<StylePresetId, StylePreset> = {
  "how-to": {
    id: "how-to",
    label: "How-to documentation",
    summary: "Step-by-step instructions someone can follow to do what the video shows.",
    documentType: "a clear, step-by-step how-to document",
    instructions: [
      "Each step is one action, or a few tightly related actions, in the order they were performed.",
      "Write direct instructions (\"Open Settings, then select Billing\") and name UI elements exactly as they appear on screen.",
      "Put any prerequisites in the overview. Where it helps, say what the reader should see after a step so they know they are on track.",
    ],
  },
  "sales-walkthrough": {
    id: "sales-walkthrough",
    label: "Sales walkthrough",
    summary: "A guided product tour for a prospect or customer, focused on value.",
    documentType: "a guided product tour written for a prospect or customer",
    instructions: [
      "The reader is evaluating the product, not operating it. Write each section as a stop on a guided tour: what they are looking at and why it matters to them.",
      "Lead with outcomes and business value (time saved, risk reduced, visibility gained) over mechanics. Mention clicks only where they show how easy something is.",
      "Reflect the specific goals, pains, or use cases the presenter mentions for this prospect.",
      "Keep every claim grounded in what the video shows or says. Never invent pricing, metrics, customer names, integrations, or commitments.",
      "The overview summarizes what the tour covers and the core value. The last section recaps the key benefits and the next step the presenter proposes, if any.",
      "Tone: confident, warm, and concise, without hard-sell language.",
    ],
  },
  training: {
    id: "training",
    label: "Training / onboarding",
    summary: "Onboarding material that builds understanding, not just steps.",
    documentType: "training material for someone new to this tool or process",
    instructions: [
      "Explain why as well as how, and define product terms or jargon the first time they appear.",
      "Organize the sections so each builds on the previous one. State what the reader will be able to do in the overview.",
      "Include the tips, best practices, and common mistakes the presenter mentions.",
      "End with a short section recapping the key takeaways.",
    ],
  },
  "support-article": {
    id: "support-article",
    label: "Support article",
    summary: "A help-center article that answers one question or fixes one problem.",
    documentType: "a customer-facing help-center article",
    instructions: [
      "Phrase the title as the task or problem a customer would search for (for example, \"How to reset your password\").",
      "The overview says, in one or two sentences, when this article applies and any prerequisites or permissions needed.",
      "Keep steps short and direct, one action each, with exact UI labels. Where the video shows it, say what the customer should see after a step, and include any troubleshooting the presenter mentions.",
      "Use plain, neutral language. Leave out internal jargon, internal team names, and anything not meant for customers.",
    ],
  },
  "release-notes": {
    id: "release-notes",
    label: "Release notes",
    summary: "What changed, written for existing users.",
    documentType: "release notes for existing users",
    instructions: [
      "Each section covers one new feature, improvement, or fix shown in the video, with a heading that names it.",
      "For each: what changed, who benefits, and briefly how to find or use it. Use screenshots to show new or changed UI.",
      "The overview is a one-paragraph summary of the highlights. Keep entries scannable; do not narrate the demo.",
      "Only include changes the video shows or describes. Do not state version numbers, dates, or availability unless the video does.",
    ],
  },
  "product-launch": {
    id: "product-launch",
    label: "Product / feature launch",
    summary: "An announcement that makes the case for something new.",
    documentType: "a product or feature launch announcement",
    instructions: [
      "The overview opens with the headline benefit: the problem this solves and who it is for.",
      "Each section presents one key capability as a benefit, with a short explanation of how it works and a screenshot where it helps.",
      "Mention availability, pricing, or rollout only if the video states them.",
      "Tone: energetic but credible. Avoid superlatives the video does not support. The last section tells readers how to get started.",
    ],
  },
  custom: {
    id: "custom",
    label: "Custom",
    summary: "Describe the document you want in your own words.",
    documentType: "the document described in the direction below",
    instructions: [
      "Take the document's purpose, reader, structure, and tone from the person's direction below. Where it is silent, choose what best serves that purpose.",
    ],
  },
};

export function isStylePresetId(value: string): value is StylePresetId {
  return (STYLE_PRESET_IDS as readonly string[]).includes(value);
}
