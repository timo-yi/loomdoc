import { spawn } from "node:child_process";
import { outputTail, runTool } from "./run-tool.js";
import { LoomdocError } from "./errors.js";

/**
 * Thin wrapper around the `ffmpeg` binary. loomdoc shells out to ffmpeg rather
 * than depending on a native binding — ffmpeg is language-agnostic and does the
 * heavy lifting for both frame sampling and single-frame seeks (PRD decision D1).
 *
 * A stalled run (a network stream that stops delivering) must not hang forever, so
 * every run gets an idle timeout via `runTool`. The liveness signal cannot be raw
 * output bytes: callers pass `-loglevel error` (a healthy ffmpeg is silent), while
 * `runFfmpeg` adds `-progress pipe:3`, and modern ffmpeg writes those progress
 * blocks on a clock — even when its input has stalled and the encoded position is
 * frozen. So this wrapper parses the progress lines and counts only runs whose
 * values actually change; repeated identical blocks prove nothing.
 */

/** Default idle timeout for ffmpeg runs; `FFMPEG_IDLE_TIMEOUT_MS` overrides (0 disables). */
export const DEFAULT_FFMPEG_IDLE_TIMEOUT_MS = 60_000;

/**
 * Progress fields that only move when ffmpeg is really making progress: the encoded
 * position, frame count, and the final `progress=end` marker. Deliberately excludes
 * `fps=`/`speed=`, which ffmpeg recomputes against wall-clock time and can vary on a
 * stalled run.
 */
const LIVE_PROGRESS_KEYS = new Set(["out_time_ms", "out_time", "frame", "progress"]);

/**
 * Run ffmpeg with the given args. Resolves on exit code 0, rejects otherwise.
 * `-progress pipe:3` is prepended as the liveness signal (see the file comment).
 */
export async function runFfmpeg(args: string[]): Promise<void> {
  const result = await runTool("ffmpeg", ["-progress", "pipe:3", ...args], {
    idleTimeoutMs: ffmpegIdleTimeoutMs(),
    extraOutputPipes: 1, // stdio index 3 — the fd `-progress pipe:3` writes to.
    isActivity: createProgressLiveness(),
  });
  if (result.code !== 0) {
    throw new LoomdocError(`ffmpeg exited with code ${result.code}:\nstderr:\n${outputTail(result.stderr)}`);
  }
}

function ffmpegIdleTimeoutMs(): number {
  const raw = process.env.FFMPEG_IDLE_TIMEOUT_MS?.trim();
  if (!raw) return DEFAULT_FFMPEG_IDLE_TIMEOUT_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_FFMPEG_IDLE_TIMEOUT_MS;
}

/**
 * Build a per-run `isActivity` parser for ffmpeg's progress pipe: a chunk counts as
 * liveness only if it completes at least one `key=value` line whose tracked value
 * differs from the last time loomdoc saw it. Bytes on stdout/stderr never count —
 * an ffmpeg that loops on error output is stuck, not alive.
 */
export function createProgressLiveness(): (chunk: Buffer, stream: "stdout" | "stderr" | "pipe") => boolean {
  const lastValues = new Map<string, string>();
  let partialLine = "";

  return (chunk, stream) => {
    if (stream !== "pipe") return false;
    partialLine += chunk.toString();
    const lines = partialLine.split("\n");
    partialLine = lines.pop() ?? ""; // keep a trailing incomplete line for the next chunk

    let live = false;
    for (const line of lines) {
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      if (!LIVE_PROGRESS_KEYS.has(key)) continue;
      const value = line.slice(eq + 1).trim();
      if (lastValues.get(key) !== value) {
        lastValues.set(key, value);
        live = true;
      }
    }
    return live;
  };
}

/** Verify ffmpeg is available before a run starts, failing early with a clear message. */
export function assertFfmpegAvailable(): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", ["-version"], { stdio: "ignore" });
    proc.on("error", () =>
      reject(new LoomdocError("ffmpeg not found on PATH. Install ffmpeg (or run `loomdoc doctor`) to run loomdoc.")),
    );
    proc.on("close", (code) =>
      code === 0 ? resolve() : reject(new LoomdocError("ffmpeg -version failed.")),
    );
  });
}
