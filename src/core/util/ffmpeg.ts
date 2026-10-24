import { spawn, type StdioOptions } from "node:child_process";
import { LoomdocError } from "./errors.js";
import { trackChild } from "./children.js";

/**
 * Thin wrapper around the `ffmpeg` binary. loomdoc shells out to ffmpeg rather
 * than depending on a native binding — ffmpeg is language-agnostic and does the
 * heavy lifting for both frame sampling and single-frame seeks (PRD decision D1).
 *
 * Two failure modes must not hang a run forever: a tool that stalls mid-work
 * (a network stream that stops delivering, a corrupt file), and one that floods
 * its stderr. So every run gets an idle timeout — killed if it produces no
 * output for a while — and stderr is kept only as a bounded tail.
 *
 * Callers all pass `-loglevel error`, so a healthy ffmpeg is silent on stderr;
 * `runFfmpeg` therefore adds `-progress pipe:3`, which makes ffmpeg report
 * encoding progress roughly once a second on a dedicated fd. Any output on an
 * output pipe counts as liveness, and the progress lines stay out of the error
 * text because only stderr is captured.
 */

/** Default idle timeout for ffmpeg runs; `FFMPEG_IDLE_TIMEOUT_MS` overrides (0 disables). */
export const DEFAULT_FFMPEG_IDLE_TIMEOUT_MS = 60_000;

/** Grace period between SIGTERM and SIGKILL when a stalled tool is killed. */
const SIGKILL_GRACE_MS = 5_000;

/** Most stderr kept in memory (tail); bounds RAM against a chatty or looping tool. */
const STDERR_MEMORY_CAP = 64 * 1024;

/** Most captured stderr shown in the error message. */
const STDERR_REPORT_CHARS = 2_000;

export interface RunToolOptions {
  /** Kill the tool if it writes nothing to its output pipes for this long. `0` disables. */
  idleTimeoutMs?: number;
}

/** Run a command with captured stderr and an optional idle timeout. Resolves on exit code 0. */
export function runTool(
  command: string,
  args: string[],
  options: RunToolOptions = {},
): Promise<void> {
  return runWithOutputPipes(command, args, options, ["ignore", "ignore", "pipe"]);
}

/**
 * Run ffmpeg with the given args. Resolves on exit code 0, rejects otherwise.
 * `-progress pipe:3` is prepended as a liveness signal (see the file comment).
 */
export function runFfmpeg(args: string[]): Promise<void> {
  return runWithOutputPipes(
    "ffmpeg",
    ["-progress", "pipe:3", ...args],
    { idleTimeoutMs: ffmpegIdleTimeoutMs() },
    ["ignore", "ignore", "pipe", "pipe"],
  );
}

function ffmpegIdleTimeoutMs(): number {
  const raw = process.env.FFMPEG_IDLE_TIMEOUT_MS?.trim();
  if (!raw) return DEFAULT_FFMPEG_IDLE_TIMEOUT_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_FFMPEG_IDLE_TIMEOUT_MS;
}

/**
 * Shared core: `stdio` beyond index 1 adds output pipes that count as liveness
 * (and are drained so the tool never blocks on a full pipe), while only stderr
 * is captured for error reporting.
 */
function runWithOutputPipes(
  command: string,
  args: string[],
  options: RunToolOptions,
  stdio: StdioOptions,
): Promise<void> {
  const idleTimeoutMs = options.idleTimeoutMs ?? 0;
  return new Promise((resolve, reject) => {
    const proc = trackChild(spawn(command, args, { stdio }));
    let stderr = "";
    let settled = false;
    let killedOnIdle = false;
    let idleTimer: NodeJS.Timeout | undefined;
    let escalationTimer: NodeJS.Timeout | undefined;

    const finish = (settle: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(idleTimer);
      clearTimeout(escalationTimer);
      settle();
    };

    const armIdleTimer = (): void => {
      if (idleTimeoutMs <= 0 || killedOnIdle) return;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        killedOnIdle = true;
        proc.kill("SIGTERM");
        escalationTimer = setTimeout(() => proc.kill("SIGKILL"), SIGKILL_GRACE_MS).unref();
      }, idleTimeoutMs).unref();
    };

    for (const pipe of proc.stdio.slice(2)) {
      if (!pipe) continue;
      // A data listener puts the pipe in flowing mode, which also drains it —
      // ffmpeg must never stall because nobody reads its progress output.
      pipe.on("data", armIdleTimer);
    }
    proc.stderr?.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-STDERR_MEMORY_CAP);
    });

    proc.on("error", (err) => {
      finish(() =>
        reject(
          new LoomdocError(`Failed to launch ${command}. Is it installed and on PATH? (${err.message})`),
        ),
      );
    });
    proc.on("close", (code) => {
      if (killedOnIdle) {
        finish(() =>
          reject(
            new LoomdocError(
              `${command} produced no output for ${Math.round(idleTimeoutMs / 1000)}s and was killed ` +
                `(stalled input or corrupt file?).${tailSuffix(stderr, "Last output")}`,
            ),
          ),
        );
      } else if (code === 0) {
        finish(resolve);
      } else {
        finish(() =>
          reject(
            new LoomdocError(`${command} exited with code ${code}:${tailSuffix(stderr, "stderr")}`),
          ),
        );
      }
    });

    armIdleTimer();
  });
}

function tailSuffix(captured: string, label: string): string {
  const tail = captured.slice(-STDERR_REPORT_CHARS);
  return tail ? `\n${label}:\n${tail}` : "";
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
