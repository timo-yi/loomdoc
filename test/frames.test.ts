import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { hammingDistance, perceptualHash } from "../src/core/frames/hash.js";
import { winnowFrames } from "../src/core/frames/winnow.js";
import type { SampledFrame } from "../src/core/frames/sample.js";
import { sampleFrames } from "../src/core/frames/sample.js";
import { extractFrameAt } from "../src/core/frames/extract.js";
import { assertFfmpegAvailable, runFfmpeg } from "../src/core/util/ffmpeg.js";

/** Write a horizontal grayscale gradient PNG (ascending = dark->light left to right). */
async function writeGradient(path: string, ascending: boolean, w = 64, h = 32): Promise<void> {
  const buf = Buffer.alloc(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = Math.round((x / (w - 1)) * 255);
      buf[y * w + x] = ascending ? v : 255 - v;
    }
  }
  await sharp(buf, { raw: { width: w, height: h, channels: 1 } }).png().toFile(path);
}

test("hammingDistance counts differing bits", () => {
  assert.equal(hammingDistance(0b1010n, 0b1000n), 1);
  assert.equal(hammingDistance(0n, 0xffffffffffffffffn), 64);
  assert.equal(hammingDistance(42n, 42n), 0);
});

test("perceptualHash: identical images match, opposite gradients differ widely", async () => {
  const dir = await mkdtemp(join(tmpdir(), "loomdoc-hash-"));
  try {
    const a1 = join(dir, "a1.png");
    const a2 = join(dir, "a2.png");
    const b = join(dir, "b.png");
    await writeGradient(a1, true);
    await writeGradient(a2, true);
    await writeGradient(b, false);

    const [ha1, ha2, hb] = [await perceptualHash(a1), await perceptualHash(a2), await perceptualHash(b)];
    assert.equal(hammingDistance(ha1, ha2), 0, "identical gradients hash the same");
    assert.ok(hammingDistance(ha1, hb) > 8, "opposite gradients are far apart");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("winnowFrames collapses duplicates and separates distinct screens", async () => {
  const dir = await mkdtemp(join(tmpdir(), "loomdoc-winnow-"));
  try {
    const a = join(dir, "a.png");
    const b = join(dir, "b.png");
    await writeGradient(a, true);
    await writeGradient(b, false);

    // Three "screen A" frames, then three "screen B" frames.
    const frames: SampledFrame[] = [
      { timestamp: 0.0, path: a },
      { timestamp: 0.2, path: a },
      { timestamp: 0.4, path: a },
      { timestamp: 0.6, path: b },
      { timestamp: 0.8, path: b },
      { timestamp: 1.0, path: b },
    ];

    const candidates = await winnowFrames(frames, 8);
    assert.equal(candidates.length, 2, "six frames collapse to two distinct screens");
    assert.equal(candidates[0]?.timestamp, 0.2, "representative is the middle of group A");
    assert.equal(candidates[1]?.timestamp, 0.8, "representative is the middle of group B");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("winnowFrames returns one candidate for all-identical frames", async () => {
  const dir = await mkdtemp(join(tmpdir(), "loomdoc-winnow1-"));
  try {
    const a = join(dir, "a.png");
    await writeGradient(a, true);
    const frames: SampledFrame[] = [
      { timestamp: 0, path: a },
      { timestamp: 0.5, path: a },
      { timestamp: 1, path: a },
    ];
    const candidates = await winnowFrames(frames, 8);
    assert.equal(candidates.length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("sampleFrames + extractFrameAt work against a generated video", async (t) => {
  try {
    await assertFfmpegAvailable();
  } catch {
    t.skip("ffmpeg not available");
    return;
  }

  const dir = await mkdtemp(join(tmpdir(), "loomdoc-ff-"));
  try {
    const video = join(dir, "in.mp4");
    await runFfmpeg([
      "-nostdin",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc=duration=2:size=320x240:rate=10",
      video,
    ]);

    const workDir = join(dir, "frames");
    await mkdir(workDir, { recursive: true });
    const sampled = await sampleFrames(video, workDir, 3);
    assert.ok(sampled.length >= 3, `expected several sampled frames, got ${sampled.length}`);
    assert.equal(sampled[0]?.timestamp, 0);

    const shot = join(dir, "shot.png");
    await extractFrameAt(video, 1, shot);
    const info = await stat(shot);
    assert.ok(info.size > 0, "extracted frame is non-empty");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
