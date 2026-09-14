import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  DEFAULT_EFFORT,
  DEFAULT_FORMATS,
  DEFAULT_FRAME_OPTIONS,
  DEFAULT_MAX_FRAME_REQUESTS,
  DEFAULT_MODEL,
  type LoomDoc,
  type LoomdocOptions,
  type LoomdocResult,
  type Screenshot,
  type Step,
} from "./types.js";
import { assertFfmpegAvailable, } from "./util/ffmpeg.js";
import { LoomdocError } from "./util/errors.js";
import { slugify } from "./util/slug.js";
import { fetchLoomVideo } from "./ingest/loom.js";
import { sampleFrames } from "./frames/sample.js";
import { winnowFrames } from "./frames/winnow.js";
import { extractFrameAt } from "./frames/extract.js";
import { generateDoc } from "./generate/generate.js";
import type { LoomDocOutput } from "./generate/schema.js";
import { renderAll } from "./render/index.js";

const IMAGES_DIR = "images";

/**
 * The v1 pipeline, end to end (PRD §4). This wires the stages together and documents
 * the flow; the individual stages are implemented in their own modules.
 */
export async function runLoomdoc(options: LoomdocOptions): Promise<LoomdocResult> {
  if (!options.url) throw new LoomdocError("A Loom share URL is required.");

  const model = options.model ?? DEFAULT_MODEL;
  const effort = options.effort ?? DEFAULT_EFFORT;
  const formats = options.formats ?? DEFAULT_FORMATS;
  const maxFrameRequests = options.maxFrameRequests ?? DEFAULT_MAX_FRAME_REQUESTS;
  const frames = { ...DEFAULT_FRAME_OPTIONS, ...options.frames };
  const outRoot = resolve(options.outDir ?? "out");

  // Fail early and clearly if ffmpeg is missing.
  await assertFfmpegAvailable();

  // 1. Ingest: timestamped transcript + short-lived stream URL.
  const video = await fetchLoomVideo(options.url);

  // Output layout: out/<slug>/{document.*, images/}. A scratch dir holds sampled frames.
  const outputDir = join(outRoot, slugify(video.title));
  const imagesDir = join(outputDir, IMAGES_DIR);
  const workDir = join(outputDir, ".frames");
  await mkdir(imagesDir, { recursive: true });
  await mkdir(workDir, { recursive: true });

  // Steps 2-5 run against scratch frames; always clean them up afterward so the shared
  // deliverable folder isn't polluted and disk isn't leaked.
  try {
    // 2. Frame track (the only deterministic step): sample -> winnow to distinct screens.
    const sampled = await sampleFrames(video.streamUrl, workDir, frames.sampleFps);
    const candidates = await winnowFrames(sampled, frames);

    // 3. Generate: the vision LLM makes every judgment call and may request extra
    //    exact-timestamp frames via the tool below (capped).
    let frameRequests = 0;
    const requestFrame = async (timestampSeconds: number): Promise<string> => {
      if (frameRequests >= maxFrameRequests) {
        throw new LoomdocError(`Exceeded maxFrameRequests (${maxFrameRequests}).`);
      }
      frameRequests += 1;
      const out = join(imagesDir, `frame-${timestampSeconds.toFixed(2)}.png`);
      return extractFrameAt(video.streamUrl, timestampSeconds, out);
    };

    const output = await generateDoc({
      video,
      candidates,
      context: options.context,
      model,
      effort,
      maxFrameRequests,
      requestFrame,
    });

    // 4. Resolve the model's chosen screenshot timestamps into extracted image files.
    const doc = await materializeScreenshots(output, video.streamUrl, imagesDir);

    // 5. Render to each requested format off the one structured document.
    const files = await renderAll(doc, outputDir, formats, IMAGES_DIR);

    return { doc, outputDir, imagesDir, files };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

/**
 * Convert the model's output (which references screenshots by timestamp) into the
 * domain document (which references extracted image files on disk).
 */
async function materializeScreenshots(
  output: LoomDocOutput,
  streamUrl: string,
  imagesDir: string,
): Promise<LoomDoc> {
  const steps: Step[] = [];
  for (let i = 0; i < output.steps.length; i++) {
    const s = output.steps[i]!;
    let screenshot: Screenshot | undefined;
    if (s.screenshot) {
      const out = join(imagesDir, `step-${String(i + 1).padStart(2, "0")}.png`);
      try {
        const path = await extractFrameAt(streamUrl, s.screenshot.timestamp, out);
        screenshot = { timestamp: s.screenshot.timestamp, path, caption: s.screenshot.caption };
      } catch {
        // A single bad timestamp shouldn't sink the whole doc: keep the step's text and
        // drop just its screenshot.
        screenshot = undefined;
      }
    }
    steps.push({
      heading: s.heading,
      body: s.body,
      screenshot,
      needsDeeperReasoning: s.needsDeeperReasoning,
    });
  }
  return {
    title: output.title,
    overview: output.overview,
    audience: output.audience,
    steps,
  };
}
