import { test } from "node:test";
import assert from "node:assert/strict";
import { runTool } from "../src/core/util/run-tool.js";

test("runTool resolves with the exit code and captured output on natural exit", async () => {
  const result = await runTool(process.execPath, ["-e", 'console.log("hi"); console.error("bye"); process.exit(3);']);
  assert.equal(result.code, 3); // non-zero is a result, not a rejection — callers phrase their own errors
  assert.equal(result.stdout.trim(), "hi");
  assert.equal(result.stderr.trim(), "bye");
});

test("runTool kills a silent tool on the idle timeout", async () => {
  const started = Date.now();
  await assert.rejects(
    runTool(process.execPath, ["-e", "setTimeout(() => {}, 30_000)"], { idleTimeoutMs: 400 }),
    /made no progress for 400ms and was killed/, // sub-second timeouts render as ms, never "0s"
  );
  // SIGTERM lands at ~400ms; the 5s SIGKILL escalation must not be what ends a responsive tool.
  assert.ok(Date.now() - started < 5_000, "kill should not wait for the SIGKILL grace period");
});

test("output resets the idle timer by default", async () => {
  // Chatty every 100ms with an idle timeout of 400ms: each write resets the timer.
  const script = `
    let n = 0;
    const t = setInterval(() => console.error("tick " + n++), 100);
    setTimeout(() => { clearInterval(t); process.exit(0); }, 900);
  `;
  await runTool(process.execPath, ["-e", script], { idleTimeoutMs: 400 });
});

test("isActivity decides what counts as liveness — stderr chatter can be ignored", async () => {
  // A tool flooding stderr while the caller only trusts stdout must still be killed.
  const script = `
    const t = setInterval(() => console.error("chatter"), 100);
    setTimeout(() => { clearInterval(t); process.exit(0); }, 900);
  `;
  await assert.rejects(
    runTool(process.execPath, ["-e", script], {
      idleTimeoutMs: 300,
      isActivity: (chunk, stream) => stream === "stdout" && chunk.length > 0,
    }),
    /made no progress for 300ms/,
  );
});

test("a huge idle timeout does not wrap the timer and fire immediately", async () => {
  // setTimeout wraps delays above 2^31-1 ms to ~1ms; a silent run must survive them.
  const script = `setTimeout(() => process.exit(0), 500);`;
  await runTool(process.execPath, ["-e", script], { idleTimeoutMs: 8_640_000_000 }); // over 2^31-1
});

test("idleTimeoutMs of 0 disables the idle kill", async () => {
  const script = `setTimeout(() => process.exit(0), 600);`; // silent longer than any test timeout above
  await runTool(process.execPath, ["-e", script], { idleTimeoutMs: 0 });
});

test("captured stderr is bounded to a tail", async () => {
  const script = `console.error("x".repeat(1_000_000)); process.exit(0);`;
  const result = await runTool(process.execPath, ["-e", script], { maxStderrBytes: 1024 });
  assert.ok(result.stderr.length <= 1024, `stderr tail should be capped, got ${result.stderr.length}`);
});

test("stdout keeps large output when the caller raises the cap", async () => {
  // The yt-dlp case: real results ride on stdout and must not be truncated away.
  const script = `process.stdout.write("y".repeat(200_000));`;
  const result = await runTool(process.execPath, ["-e", script], { maxStdoutBytes: 16 * 1024 * 1024 });
  assert.equal(result.stdout.length, 200_000);
});

test("extra output pipes are drained so the tool never blocks on them", async () => {
  // Write 5 MB to fd 3 — far past an OS pipe buffer; a runner that does not drain it deadlocks.
  const script = `
    const { writeSync } = require("node:fs");
    const block = Buffer.alloc(1_000_000, 7);
    for (let i = 0; i < 5; i++) writeSync(3, block);
    process.exit(0);
  `;
  const result = await runTool(process.execPath, ["-e", script], { extraOutputPipes: 1, isActivity: () => false });
  assert.equal(result.code, 0);
});

test("runTool rejects with a launch hint when the tool cannot be spawned", async () => {
  await assert.rejects(
    runTool("loomdoc-test-no-such-binary", [], { launchHint: "Run `loomdoc doctor` to install it." }),
    /Failed to launch loomdoc-test-no-such-binary.*Run `loomdoc doctor`/,
  );
});
