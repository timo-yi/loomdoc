import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFfmpeg, runTool, assertFfmpegAvailable } from "../src/core/util/ffmpeg.js";

test("runTool kills a silent tool on the idle timeout", async () => {
  const started = Date.now();
  await assert.rejects(
    runTool(process.execPath, ["-e", "setTimeout(() => {}, 30_000)"], { idleTimeoutMs: 400 }),
    /produced no output for .* and was killed/,
  );
  // SIGTERM lands at ~400ms; the 5s SIGKILL escalation must not be what ends it.
  assert.ok(Date.now() - started < 5_000, "kill should not wait for the SIGKILL grace period");
});

test("runTool keeps a tool alive as long as it keeps writing to stderr", async () => {
  // Chatty every 100ms with an idle timeout of 400ms: each write resets the timer.
  const script = `
    let n = 0;
    const t = setInterval(() => console.error("tick " + n++), 100);
    setTimeout(() => { clearInterval(t); process.exit(0); }, 900);
  `;
  await runTool(process.execPath, ["-e", script], { idleTimeoutMs: 400 });
});

test("runTool rejects with the exit code and captured stderr tail", async () => {
  await assert.rejects(
    runTool(process.execPath, ["-e", 'console.error("boom"); process.exit(3);']),
    (err: Error) => {
      assert.match(err.message, /exited with code 3/);
      assert.match(err.message, /boom/);
      return true;
    },
  );
});

test("a flooding tool cannot blow up the error message", async () => {
  const script = `console.error("x".repeat(1_000_000)); process.exit(1);`;
  await assert.rejects(runTool(process.execPath, ["-e", script]), (err: Error) => {
    assert.ok(err.message.length < 3_000, `error message should stay bounded, got ${err.message.length}`);
    return true;
  });
});

test("idleTimeoutMs of 0 disables the idle kill", async () => {
  const script = `setTimeout(() => process.exit(0), 600);`; // silent longer than any test timeout above
  await runTool(process.execPath, ["-e", script], { idleTimeoutMs: 0 });
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
