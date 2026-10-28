/**
 * Document style presets (PRD decision D16).
 *
 * A preset sets the document's purpose, reader, and tone. It does not change the output
 * schema: every preset still produces an ordered list of sections ("steps") with optional
 * screenshots, so every renderer works unchanged. The instructions steer emphasis and framing
 * and leave structure within that container to the model (PRD D5, D9).
 *
 * Four presets are the Diátaxis technical-writing modes (tutorial, how-to, reference,
 * explanation), adapted from the technical-writing skill in cursor/plugins
 * (pstack/skills/technical-writing). Those four also get TECHNICAL_WRITING_RULES, the skill's
 * sentence-level layers, condensed for a document written from a video.
 */

export const STYLE_PRESET_IDS = [
  "tutorial",
  "how-to",
  "reference",
  "explanation",
  "release-notes",
  "sales-walkthrough",
  "product-launch",
  "custom",
] as const;

export type StylePresetId = (typeof STYLE_PRESET_IDS)[number];

export const DIATAXIS_MODES = ["tutorial", "how-to", "reference", "explanation"] as const;
export type DiataxisMode = (typeof DIATAXIS_MODES)[number];

/** Where a technical-writing preset sits on the Diátaxis compass, shown in the web UI. */
export interface DiataxisInfo {
  mode: DiataxisMode;
  /** Does the content inform action or understanding, and does it serve learning or work? */
  quadrant: string;
  /** What sets this mode apart, in a sentence or two. */
  definition: string;
}

export interface StylePreset {
  id: StylePresetId;
  label: string;
  /** One line for pickers and --help. */
  summary: string;
  /** What the document is, in the system prompt's words. */
  documentType: string;
  instructions: string[];
  /** Set on the four technical-writing presets; they also get TECHNICAL_WRITING_RULES. */
  diataxis?: DiataxisInfo;
  /** The preset has no content of its own, so a run without guidance has nothing to steer it. */
  requiresGuidance?: boolean;
}

export const DEFAULT_PRESET: StylePresetId = "how-to";

/**
 * The skill's sentence-level layers (Google developer style, STE, Global English) for the four
 * technical-writing presets. Left out on purpose: bold UI names and code font (the Word and PDF
 * renderers print body text as plain text, so markup would show as literal asterisks), and the
 * repo-specific rules about PR descriptions, commit messages, and code indentation.
 */
export const TECHNICAL_WRITING_RULES: string[] = [
  "Write so a tired engineer understands on the first read. Cut every word that does no work (\"in order to\" is \"to\"). Use the short, everyday word (\"use\", not \"utilize\").",
  "Keep to this one document type. Do not mix in another: no reference tables in a tutorial, no teaching in a how-to, no opinion in reference.",
  "Use the real names: the exact UI labels, commands, file names, and terms from the screen and the transcript, not synonyms or descriptions of them. Do not invent jargon.",
  "Address the reader as \"you\" in the present tense, unless the document type above says otherwise. Say who does what. Use the passive voice only when the actor is unknown or beside the point.",
  "Write instructions as commands, one instruction per sentence. Put the condition or warning before the instruction it guards (\"To delete the report, click Delete.\"). Put the common case first and exceptions after.",
  "Never write \"simply\", \"easy\", \"quickly\", or \"please\" in a procedure. Leave out buzzwords, idioms, metaphors, and Latin abbreviations.",
  "Split instructions longer than about 20 words and other sentences longer than about 25. Vary sentence length on purpose so the text does not read as machine-written.",
  "Keep \"the\" and \"a\". Give each word one meaning, and call each thing by one name throughout. Make every \"it\", \"they\", and \"this\" point at one obvious noun.",
  "Keep \"only\" and \"not\" next to the word they change. Break up long noun strings. Use periods, not semicolons. Do not use slashes (write \"a, b, or both\") or plurals like \"file(s)\".",
  "Be specific: \"the export fails if the date range is empty\", not \"issues can occur\". Write headings in sentence case that carry the point. A task heading is a verb phrase (\"Create a project\").",
];

export const STYLE_PRESETS: Record<StylePresetId, StylePreset> = {
  tutorial: {
    id: "tutorial",
    label: "Tutorial",
    summary: "Learning by doing: a guided lesson where every step shows a visible result.",
    documentType: "a hands-on tutorial that teaches a newcomer by having them do what the video shows",
    diataxis: {
      mode: "tutorial",
      quadrant: "Action + learning",
      definition:
        "The learner's success is the writer's job. It says what you will build, gives a visible result at every step, and keeps explanation to a clause.",
    },
    instructions: [
      "The overview says what the learner will build or accomplish, not what they will \"learn\".",
      "Order the steps so each builds on the previous one, in the order the presenter performed them. Every step produces a visible result.",
      "After each step, say what the learner should see: the screen, the message, or the change. Use the screenshots as that evidence.",
      "Cut explanation to one clause. Leave out background, alternatives, and options the lesson does not need. Stay concrete.",
      "Write as \"we\", in commands: \"First, open Settings. Now, select Billing.\"",
    ],
  },
  "how-to": {
    id: "how-to",
    label: "How-to guide",
    summary: "Steps to a goal: instructions a competent reader follows to get a task done.",
    documentType: "a how-to guide that takes a competent reader through the task the video shows",
    diataxis: {
      mode: "how-to",
      quadrant: "Action + work",
      definition:
        "Solves a problem the reader already has. It assumes competence, skips teaching, and keeps to action only, with no background or digressions.",
    },
    instructions: [
      "Each step is one action, or a few tightly related actions, in the order they were performed. Name UI elements exactly as they appear on screen.",
      "Assume a competent reader. Skip teaching, background, and completeness for its own sake.",
      "Where the video shows a choice, allow the fork: \"If you want x, do y.\"",
      "Name the document by the task, the way a reader would search for it (\"How to export a report\"), not by the feature (\"Report exporting\").",
      "The overview says when this guide applies and lists any prerequisites or permissions. Where it helps, say what the reader should see after a step so they know they are on track.",
      "Include any troubleshooting the presenter mentions, next to the step it belongs to.",
      "If the reader is a customer, leave out internal jargon, internal team names, and anything not meant for customers.",
    ],
  },
  reference: {
    id: "reference",
    label: "Reference",
    summary: "Facts for lookup: a dry, complete description of the screens, settings, and options shown.",
    documentType: "a reference document that describes the screens, settings, and options the video shows",
    diataxis: {
      mode: "reference",
      quadrant: "Understanding + work",
      definition:
        "Only describes. No instructions, persuasion, or opinion. It mirrors the structure of the product so readers find each fact where they expect it.",
    },
    instructions: [
      "Describe the screens, fields, settings, options, defaults, limits, and errors the video shows. Only describe: no instructions, persuasion, or opinion.",
      "Mirror the structure of the product: one section per screen, panel, or feature area, in the order the product presents them.",
      "Be dry and sure. State each fact plainly, without hedging. Cover everything the video shows, and leave out what it does not show rather than guessing.",
      "The overview says what the reference covers. Use a screenshot to show the screen or panel a section describes.",
    ],
  },
  explanation: {
    id: "explanation",
    label: "Explanation",
    summary: "Understanding and why: the context, design decisions, and trade-offs behind what the video shows.",
    documentType: "an explanation that helps the reader understand the concepts and the reasons behind what the video shows",
    diataxis: {
      mode: "explanation",
      quadrant: "Understanding + learning",
      definition:
        "One bounded topic, readable away from the product. It answers a real why question with context, design decisions, and alternatives, and it is the only mode that allows opinion.",
    },
    instructions: [
      "Anchor the document on a real why question the video answers. Write a title that reads naturally with \"About\" in front of it.",
      "Give context: the concepts, design decisions, history, constraints, and alternatives the presenter discusses.",
      "Write prose that makes sense away from the product. Do not write step-by-step instructions or reference lists. Use a screenshot only where it illustrates a concept.",
      "Opinion is allowed here. Weigh the trade-offs the presenter raises and say what you make of them, without inventing facts the video does not give.",
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
    requiresGuidance: true,
    documentType: "the document described in the direction below",
    instructions: [
      "Take the document's purpose, reader, structure, and tone from the person's direction below. Where it is silent, choose what best serves that purpose.",
    ],
  },
};

export function isStylePresetId(value: string): value is StylePresetId {
  return (STYLE_PRESET_IDS as readonly string[]).includes(value);
}

/** True when `preset` needs guidance and `guidance` is missing or blank. */
export function isMissingGuidance(preset: StylePresetId, guidance: string | undefined): boolean {
  return STYLE_PRESETS[preset].requiresGuidance === true && !guidance?.trim();
}
