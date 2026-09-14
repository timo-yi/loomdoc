import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { changedFraction, computeSignature } from "../src/core/frames/signature.js";
import { winnowFrames } from "../src/core/frames/winnow.js";
import type { SampledFrame } from "../src/core/frames/sample.js";
import { sampleFrames } from "../src/core/frames/sample.js";
import { extractFrameAt } from "../src/core/frames/extract.js";
import { assertFfmpegAvailable, runFfmpeg } from "../src/core/util/ffmpeg.js";
import { DEFAULT_FRAME_OPTIONS, type FrameOptions } from "../src/core/types.js";
import { LoomdocError } from "../src/core/util/errors.js";

// --- realistic grayscale fixtures (a "UI page", not a gradient) -------------------------

const W = 640;
const H = 360;

function canvas(): Buffer {
  return Buffer.alloc(W * H, 255); // white page
}
function rect(buf: Buffer, x: number, y: number, w: number, h: number, val: number): void {
  for (let j = y; j < y + h && j < H; j++) {
    for (let i = x; i < x + w && i < W; i++) {
      buf[j * W + i] = val;
    }
  }
}
function drawTextLines(buf: Buffer, offsetY = 0): void {
  for (let r = 0; r < 8; r++) rect(buf, 40, 40 + offsetY + r * 30, 300, 8, 40);
}
async function writePng(buf: Buffer, path: string): Promise<void> {
  await sharp(buf, { raw: { width: W, height: H, channels: 1 } }).png().toFile(path);
}

// Each fixture is the base page plus one realistic difference.
async function makeFixtures(dir: string) {
  const base = canvas();
  drawTextLines(base);

  const cursorA = Buffer.from(base);
  rect(cursorA, 500, 300, 8, 8, 30); // small pointer
  const cursorB = Buffer.from(base);
  rect(cursorB, 522, 316, 8, 8, 30); // pointer moved

  const typed = Buffer.from(base);
  rect(typed, 380, 300, 130, 12, 30); // text typed into a field

  const dialog = Buffer.from(base);
  rect(dialog, 200, 110, 240, 130, 150); // a modal appears

  const scroll1 = canvas();
  drawTextLines(scroll1, -60);
  const scroll2 = canvas();
  drawTextLines(scroll2, -120);

  const different = canvas();
  rect(different, 0, 0, W, 180, 90); // a totally different layout

  // Dense full-width block at three positions: a large content shift, i.e. a real scroll
  // that changes enough of the frame to read as motion.
  const denseA = canvas();
  rect(denseA, 0, 20, W, 160, 100);
  const denseB = canvas();
  rect(denseB, 0, 90, W, 160, 100);
  const denseC = canvas();
  rect(denseC, 0, 160, W, 160, 100);

  const paths = {
    base: join(dir, "base.png"),
    cursorA: join(dir, "cursorA.png"),
    cursorB: join(dir, "cursorB.png"),
    typed: join(dir, "typed.png"),
    dialog: join(dir, "dialog.png"),
    scroll1: join(dir, "scroll1.png"),
    scroll2: join(dir, "scroll2.png"),
    different: join(dir, "different.png"),
    denseA: join(dir, "denseA.png"),
    denseB: join(dir, "denseB.png"),
    denseC: join(dir, "denseC.png"),
  };
  await Promise.all([
    writePng(base, paths.base),
    writePng(cursorA, paths.cursorA),
    writePng(cursorB, paths.cursorB),
    writePng(typed, paths.typed),
    writePng(dialog, paths.dialog),
    writePng(scroll1, paths.scroll1),
    writePng(scroll2, paths.scroll2),
    writePng(different, paths.different),
    writePng(denseA, paths.denseA),
    writePng(denseB, paths.denseB),
    writePng(denseC, paths.denseC),
  ]);
  return paths;
}

function frames(...specs: Array<[number, string]>): SampledFrame[] {
  return specs.map(([timestamp, path]) => ({ timestamp, path }));
}

// --- change metric calibration ---------------------------------------------------------

test("changedFraction orders real transitions relative to the default thresholds", async () => {
  const dir = await mkdtemp(join(tmpdir(), "loomdoc-sig-"));
  try {
    const p = await makeFixtures(dir);
    const sig = async (path: string) => computeSignature(path);
    const [base, cursorB, typed, dialog] = [
      await sig(p.base),
      await sig(p.cursorB),
      await sig(p.typed),
      await sig(p.dialog),
    ];
    const d = DEFAULT_FRAME_OPTIONS;

    assert.equal(changedFraction(base, base, d.pixelDelta), 0);

    const cursor = changedFraction(base, cursorB, d.pixelDelta);
    const type = changedFraction(base, typed, d.pixelDelta);
    const modal = changedFraction(base, dialog, d.pixelDelta);

    assert.ok(cursor < d.sameScreenThreshold, `cursor move (${cursor}) should be below sameScreen`);
    assert.ok(
      type >= d.sameScreenThreshold && type < d.motionThreshold,
      `typing (${type}) should be a new screen but not motion`,
    );
    assert.ok(modal > d.motionThreshold, `modal open (${modal}) should read as motion`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// --- winnow behavior -------------------------------------------------------------------

const OPTS: FrameOptions = DEFAULT_FRAME_OPTIONS;

test("winnow collapses cursor-only movement to one candidate", async () => {
  const dir = await mkdtemp(join(tmpdir(), "loomdoc-w1-"));
  try {
    const p = await makeFixtures(dir);
    const candidates = await winnowFrames(
      frames([0, p.base], [0.5, p.cursorA], [1, p.cursorB]),
      OPTS,
    );
    assert.equal(candidates.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("winnow keeps a modal that opens (localized change survives)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "loomdoc-w2-"));
  try {
    const p = await makeFixtures(dir);
    const candidates = await winnowFrames(
      frames([0, p.base], [0.5, p.base], [1, p.dialog], [1.5, p.dialog]),
      OPTS,
    );
    assert.equal(candidates.length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("winnow keeps typed text even though it never spikes into 'motion'", async () => {
  const dir = await mkdtemp(join(tmpdir(), "loomdoc-w3-"));
  try {
    const p = await makeFixtures(dir);
    const candidates = await winnowFrames(frames([0, p.base], [0.5, p.typed], [1, p.typed]), OPTS);
    assert.equal(candidates.length, 2, "empty field and typed field are both captured");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("winnow skips mid-scroll frames and keeps the settled screens", async () => {
  const dir = await mkdtemp(join(tmpdir(), "loomdoc-w4-"));
  try {
    const p = await makeFixtures(dir);
    // denseA settled, then a fast scroll through denseB, settling on denseC.
    const candidates = await winnowFrames(
      frames(
        [0, p.denseA],
        [0.5, p.denseA],
        [1, p.denseB],
        [1.5, p.denseC],
        [2, p.denseC],
        [2.5, p.denseC],
      ),
      OPTS,
    );
    assert.equal(candidates.length, 2, "before-scroll and after-scroll, no mid-scroll junk");
    assert.equal(candidates[0]?.timestamp, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("winnow edge cases: empty and single frame", async () => {
  const dir = await mkdtemp(join(tmpdir(), "loomdoc-w5-"));
  try {
    const p = await makeFixtures(dir);
    assert.deepEqual(await winnowFrames([], OPTS), []);
    const one = await winnowFrames(frames([0, p.base]), OPTS);
    assert.equal(one.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// --- ffmpeg-backed: timestamps, extraction, end-to-end ---------------------------------

test("sampleFrames timestamps are (index + 0.5) / fps", async (t) => {
  try {
    await assertFfmpegAvailable();
  } catch {
    t.skip("ffmpeg not available");
    return;
  }
  const dir = await mkdtemp(join(tmpdir(), "loomdoc-ts-"));
  try {
    const video = join(dir, "in.mp4");
    await runFfmpeg([
      "-nostdin", "-loglevel", "error", "-y", "-f", "lavfi",
      "-i", "testsrc=duration=3:size=320x240:rate=30", video,
    ]);
    const workDir = join(dir, "frames");
    await mkdir(workDir, { recursive: true });
    const sampled = await sampleFrames(video, workDir, 2);
    assert.ok(sampled.length >= 4);
    assert.equal(sampled[0]?.timestamp, 0.25); // (0 + 0.5) / 2
    assert.equal((sampled[1]?.timestamp ?? 0) - (sampled[0]?.timestamp ?? 0), 0.5);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("extractFrameAt throws when seeking past the end of the video", async (t) => {
  try {
    await assertFfmpegAvailable();
  } catch {
    t.skip("ffmpeg not available");
    return;
  }
  const dir = await mkdtemp(join(tmpdir(), "loomdoc-past-"));
  try {
    const video = join(dir, "in.mp4");
    await runFfmpeg([
      "-nostdin", "-loglevel", "error", "-y", "-f", "lavfi",
      "-i", "testsrc=duration=2:size=320x240:rate=10", video,
    ]);
    await assert.rejects(() => extractFrameAt(video, 50, join(dir, "past.png")), LoomdocError);

    const ok = join(dir, "ok.png");
    await extractFrameAt(video, 1, ok);
    assert.ok((await stat(ok)).size > 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("end-to-end sample -> winnow on a real 3-scene video", async (t) => {
  try {
    await assertFfmpegAvailable();
  } catch {
    t.skip("ffmpeg not available");
    return;
  }
  const dir = await mkdtemp(join(tmpdir(), "loomdoc-e2e-"));
  try {
    const video = join(dir, "scenes.mp4");
    await runFfmpeg([
      "-nostdin", "-loglevel", "error", "-y",
      // Luma-distinct colors (CSS "green" is dark and collides with red in grayscale).
      "-f", "lavfi", "-i", "color=white:s=320x240:d=1",
      "-f", "lavfi", "-i", "color=gray:s=320x240:d=1",
      "-f", "lavfi", "-i", "color=black:s=320x240:d=1",
      "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1[v]",
      "-map", "[v]", video,
    ]);
    const workDir = join(dir, "frames");
    await mkdir(workDir, { recursive: true });
    const sampled = await sampleFrames(video, workDir, 3);
    const candidates = await winnowFrames(sampled, OPTS);
    assert.ok(candidates.length >= 3, `expected >= 3 distinct scenes, got ${candidates.length}`);
    assert.ok(candidates.length < sampled.length, "winnow actually deduplicated");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
