import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertFfmpegAvailable, createProgressLiveness, runFfmpeg } from "../src/core/util/ffmpeg.js";

type Liveness = ReturnType<typeof createProgressLiveness>;
const feed = (liveness: Liveness, text: string): boolean => liveness(Buffer.from(text), "pipe");

test("progress liveness ignores stdout and stderr bytes entirely", () => {
  const liveness = createProgressLiveness();
  assert.equal(liveness(Buffer.from("boom\n"), "stderr"), false);
  assert.equal(liveness(Buffer.from("junk"), "stdout"), false);
});

test("repeated identical progress blocks prove nothing; changing values do", () => {
  // ffmpeg writes -progress blocks on a wall clock: while its input stalls, the same frozen
  // block repeats ~2x/s forever. Only value changes are liveness.
  const liveness = createProgressLiveness();
  const block = "frame=10\nfps=25.0\nout_time_ms=5240000\nspeed=0.9x\nprogress=continue\n";
  assert.equal(feed(liveness, block), true); // first sighting of these values is progress
  assert.equal(feed(liveness, block), false); // same block again: stalled input
  assert.equal(feed(liveness, "out_time_ms=5240000\n"), false);
  assert.equal(feed(liveness, "out_time_ms=6120000\n"), true); // position moved
});

test("fps and speed alone do not count as progress", () => {
  // ffmpeg recomputes fps/speed against wall-clock time, so they drift on a stalled run.
  const liveness = createProgressLiveness();
  assert.equal(feed(liveness, "out_time_ms=100\n"), true);
  assert.equal(feed(liveness, "fps=24.9\nspeed=0.8x\n"), false);
});

test("a progress line split across chunks is still evaluated once complete", () => {
  const liveness = createProgressLiveness();
  assert.equal(feed(liveness, "out_time_m"), false); // incomplete line proves nothing yet
  assert.equal(feed(liveness, "s=100\nprogress=cont"), true); // completes out_time_ms=100 — a new value
  assert.equal(feed(liveness, "inue\n"), true); // now completes progress=continue — also new
  assert.equal(feed(liveness, "out_time_ms=100\nprogress=continue\n"), false); // nothing moves anymore
});

test("runFfmpeg encodes with the progress liveness pipe in place", async (t) => {
  try {
    await assertFfmpegAvailable();
  } catch {
    t.skip("ffmpeg not available");
    return;
  }
  const dir = await mkdtemp(join(tmpdir(), "ffmpeg-test-"));
  try {
    const out = join(dir, "clip.mp4");
    await runFfmpeg([
      "-nostdin", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc=duration=1:size=320x240:rate=10",
      "-pix_fmt", "yuv420p",
      out,
    ]);
    assert.ok((await stat(out)).size > 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runFfmpeg rejects with the exit code and a stderr tail on failure", async (t) => {
  try {
    await assertFfmpegAvailable();
  } catch {
    t.skip("ffmpeg not available");
    return;
  }
  await assert.rejects(
    runFfmpeg(["-nostdin", "-loglevel", "error", "-y", "-i", "/nope/missing-input.mkv", "-c", "copy", "/tmp/x.mp4"]),
    (err: Error) => {
      assert.match(err.message, /ffmpeg exited with code \d+/);
      assert.match(err.message, /No such file/); // stderr tail explains the failure
      return true;
    },
  );
});

test("runFfmpeg kills a stalled network input even though ffmpeg keeps reporting progress", { timeout: 60_000 }, async (t) => {
  try {
    await assertFfmpegAvailable();
  } catch {
    t.skip("ffmpeg not available");
    return;
  }
  const dir = await mkdtemp(join(tmpdir(), "ffmpeg-stall-"));
  const previousEnv = process.env.FFMPEG_IDLE_TIMEOUT_MS;
  let stalled: { url: string; close: () => Promise<void> } | undefined;
  try {
    // A real matroska file, served over HTTP but truncated mid-body: ffmpeg reads the first
    // chunk, encodes it, then blocks on the socket forever. Verified against ffmpeg 9.0.1:
    // -progress keeps emitting blocks (~2/s) with out_time_ms frozen — byte-based liveness
    // would reset the idle timer forever and never kill this run. Changing-value liveness must.
    const full = join(dir, "full.mkv");
    await runFfmpeg(["-nostdin", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=duration=20:size=320x240:rate=25", full]);
    const bytes = await readFile(full);

    stalled = await startTruncatedStreamServer(bytes.subarray(0, Math.floor(bytes.length * 0.6)), bytes.length);
    process.env.FFMPEG_IDLE_TIMEOUT_MS = "3000";
    const started = Date.now();
    await assert.rejects(
      runFfmpeg(["-nostdin", "-loglevel", "error", "-y", "-i", stalled.url, "-c", "copy", join(dir, "out.mp4")]),
      /ffmpeg made no progress for 3s and was killed/,
    );
    // Bounded: idle timeout + the SIGKILL grace period a stalled ffmpeg needs (it ignores SIGTERM).
    assert.ok(Date.now() - started < 30_000, "stalled run must end promptly");
  } finally {
    await stalled?.close();
    if (previousEnv === undefined) delete process.env.FFMPEG_IDLE_TIMEOUT_MS;
    else process.env.FFMPEG_IDLE_TIMEOUT_MS = previousEnv;
    await rm(dir, { recursive: true, force: true });
  }
});

/** Serve `body` for every request but advertise `contentLength` bytes, then stall forever. */
async function startTruncatedStreamServer(
  body: Buffer,
  contentLength: number,
): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((_req, res) => {
    res.on("error", () => {}); // writing after the killed client's socket dies is expected here
    res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": String(contentLength) });
    res.write(body); // then never finish — the client blocks mid-body
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/video.mkv`;
  const close = async (): Promise<void> => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
  return { url, close };
}
