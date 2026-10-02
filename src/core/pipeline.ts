import { copyFile, mkdir } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
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
  type FrameOptions,
  type Step,
} from "./types.js";
import { assertFfmpegAvailable } from "./util/ffmpeg.js";
import { LoomdocError } from "./util/errors.js";
import { slugify } from "./util/slug.js";
import { createScratchDir } from "./util/scratch.js";
import { fetchVideo } from "./ingest/index.js";
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
  if (!options.url) throw new LoomdocError("A Loom or YouTube video URL is required.");

  const model = options.model ?? DEFAULT_MODEL;
  const effort = options.effort ?? DEFAULT_EFFORT;
  const formats = options.formats ?? DEFAULT_FORMATS;
  const maxFrameRequests = options.maxFrameRequests ?? DEFAULT_MAX_FRAME_REQUESTS;
  const outRoot = resolve(options.outDir ?? "out");

  // Fail early and clearly if ffmpeg is missing.
  await assertFfmpegAvailable();

  // Everything bulky and temporary (downloaded video, captions, sampled frames) lives in a
  // per-run scratch dir outside the deliverable, removed however the run ends (PRD D14).
  const scratch = await createScratchDir();
  try {
    // 1. Ingest: timestamped transcript + the video track, downloaded to local disk.
    const video = await fetchVideo(options.url, scratch.path);
    const frames = frameOptionsFor(video.durationSeconds, options.frames);

    // Output layout: out/<slug>/{document.*, images/}.
    const outputDir = join(outRoot, slugify(video.title, `${video.source}-${video.id}`));
    const imagesDir = join(outputDir, IMAGES_DIR);
    const framesDir = join(scratch.path, "frames");
    await mkdir(imagesDir, { recursive: true });
    await mkdir(framesDir, { recursive: true });

    // 2. Frame track (the only deterministic step): sample -> winnow to distinct screens.
    const sampled = await sampleFrames(video.videoPath, framesDir, frames.sampleFps);
    const candidates = await winnowFrames(sampled, frames);

    // 3. Generate: the vision LLM makes every judgment call and may request extra
    //    exact-timestamp frames via the tool below (capped). The model references all
    //    frames by id.
    let frameRequests = 0;
    const requestFrame = async (timestampSeconds: number): Promise<string> => {
      if (frameRequests >= maxFrameRequests) {
        throw new LoomdocError(`Exceeded maxFrameRequests (${maxFrameRequests}).`);
      }
      frameRequests += 1;
      const out = join(framesDir, `fetched-${timestampSeconds.toFixed(2)}.png`);
      return extractFrameAt(video.videoPath, timestampSeconds, out);
    };

    const { doc: output, frames: frameFiles } = await generateDoc({
      video,
      candidates,
      context: options.context,
      model,
      effort,
      maxFrameRequests,
      requestFrame,
    });

    // 4. Materialize screenshots by COPYING the exact frames the model saw (by id) into the
    //    deliverable, before the scratch dir is removed.
    const doc = await materializeScreenshots(output, frameFiles, imagesDir);

    // 5. Render to each requested format off the one structured document.
    const files = await renderAll(doc, outputDir, formats, IMAGES_DIR);

    return { doc, outputDir, imagesDir, files };
  } finally {
    await scratch.dispose();
  }
}

/**
 * Resolve frame options for a video, lowering the sample rate when the default would exceed
 * `maxSampledFrames`. Winnowing reads `sampleFps` too (for its dwell window), so the
 * effective rate is written back into the options both steps share.
 */
export function frameOptionsFor(durationSeconds: number, overrides?: Partial<FrameOptions>): FrameOptions {
  const frames = { ...DEFAULT_FRAME_OPTIONS, ...overrides };
  if (durationSeconds > 0 && frames.maxSampledFrames > 0) {
    frames.sampleFps = Math.min(frames.sampleFps, frames.maxSampledFrames / durationSeconds);
  }
  return frames;
}

/**
 * Convert the model's output (which references screenshots by id) into the domain document.
 * Each referenced frame is COPIED (not re-extracted) into images/ as step-NN.<ext>, so the doc
 * ships the exact bytes the model reasoned over. An unknown id just drops that screenshot.
 */
async function materializeScreenshots(
  output: LoomDocOutput,
  frameFiles: Map<string, string>,
  imagesDir: string,
): Promise<LoomDoc> {
  const steps: Step[] = [];
  for (let i = 0; i < output.steps.length; i++) {
    const s = output.steps[i]!;
    let screenshot: Screenshot | undefined;
    const source = s.screenshot ? frameFiles.get(s.screenshot.screenshotId) : undefined;
    if (s.screenshot && source) {
      const ext = extname(source) || ".png";
      const dest = join(imagesDir, `step-${String(i + 1).padStart(2, "0")}${ext}`);
      try {
        await copyFile(source, dest);
        screenshot = { path: dest, caption: s.screenshot.caption };
      } catch {
        screenshot = undefined; // unreadable source: keep the step text, drop the image
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
