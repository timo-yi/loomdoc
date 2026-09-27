import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadVideoTrack } from "../src/core/util/download.js";
import { extractFrameAt } from "../src/core/frames/extract.js";
import { assertFfmpegAvailable, runFfmpeg } from "../src/core/util/ffmpeg.js";
import { frameOptionsFor } from "../src/core/pipeline.js";
import { DEFAULT_FRAME_OPTIONS } from "../src/core/types.js";

test("downloadVideoTrack keeps only the video track, and frames can be cut from it", async (t) => {
  try {
    await assertFfmpegAvailable();
  } catch {
    t.skip("ffmpeg not available");
    return;
  }
  const dir = await mkdtemp(join(tmpdir(), "download-test-"));
  try {
    const source = join(dir, "source.mp4");
    await runFfmpeg([
      "-nostdin", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc=duration=3:size=320x240:rate=10",
      "-f", "lavfi", "-i", "sine=duration=3",
      "-shortest", source,
    ]);
    const outDir = join(dir, "out");
    await mkdir(outDir);

    const videoPath = await downloadVideoTrack(source, outDir);
    assert.equal(videoPath, join(outDir, "video.mkv"));

    const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", videoPath], {
      encoding: "utf8",
    });
    if (probe.status === 0) assert.deepEqual(probe.stdout.trim().split("\n"), ["video"]);

    const frame = await extractFrameAt(videoPath, 1.5, join(outDir, "f.png"));
    assert.equal(frame, join(outDir, "f.png"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("frameOptionsFor lowers the sample rate only for long videos", () => {
  // 5 minutes at 2 fps = 600 frames: unchanged.
  assert.equal(frameOptionsFor(300).sampleFps, DEFAULT_FRAME_OPTIONS.sampleFps);
  // 1 hour: capped to maxSampledFrames across the whole video.
  const hour = frameOptionsFor(3600);
  assert.equal(hour.sampleFps, DEFAULT_FRAME_OPTIONS.maxSampledFrames / 3600);
  // Unknown duration: default rate.
  assert.equal(frameOptionsFor(0).sampleFps, DEFAULT_FRAME_OPTIONS.sampleFps);
  // Overrides are respected, including disabling the cap.
  assert.equal(frameOptionsFor(3600, { maxSampledFrames: 0 }).sampleFps, DEFAULT_FRAME_OPTIONS.sampleFps);
  assert.equal(frameOptionsFor(300, { sampleFps: 1 }).sampleFps, 1);
});
