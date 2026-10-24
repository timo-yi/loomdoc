import { spawn } from "node:child_process";
import { LoomdocError } from "./errors.js";
import { trackChild } from "./children.js";

/**
 * Shared runner for the external binaries loomdoc shells out to (ffmpeg, yt-dlp).
 *
 * Two failure modes must never hang or blow up a run: a tool that stalls mid-work
 * (a network stream that stops delivering data) and one that floods its output. So
 * every run gets an idle timeout — killed once it stops proving it is working — and
 * captured output is kept only as a bounded tail.
 *
 * What counts as "proving it is working" is tool-specific, so `isActivity` decides
 * per chunk. Raw bytes are the default, but that is not enough for ffmpeg: its
 * progress pipe writes on a clock even when its input has stalled, so runFfmpeg
 * parses those lines and counts only changing progress values (see ffmpeg.ts).
 */

/** Grace period between SIGTERM and SIGKILL when a stalled tool is killed. */
const SIGKILL_GRACE_MS = 5_000;

/** Default bytes of stdout/stderr kept in memory (tail); bounds RAM against a flooding tool. */
const DEFAULT_CAPTURE_BYTES = 64 * 1024;

/** Most captured output shown in an error message. */
const REPORT_CHARS = 2_000;

/** Largest delay setTimeout can hold before Node wraps it around to ~1ms. */
const MAX_TIMER_DELAY_MS = 2 ** 31 - 2;

export interface RunToolOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Kill the tool once it has gone this long without liveness activity. `0` disables. Default: off. */
  idleTimeoutMs?: number;
  /** Bytes of stdout kept (tail). Default 64 KiB — raise for tools whose real output rides on stdout. */
  maxStdoutBytes?: number;
  /** Bytes of stderr kept (tail). Default 64 KiB. */
  maxStderrBytes?: number;
  /** Append this many extra output pipes after stdin/stdout/stderr (stdio index 3+); drained, not captured. */
  extraOutputPipes?: number;
  /** Whether a chunk proves the tool is alive. Default: any byte on any output pipe counts. */
  isActivity?: (chunk: Buffer, stream: "stdout" | "stderr" | "pipe") => boolean;
  /** Extra sentence in the spawn-failure message, e.g. how to install the tool. */
  launchHint?: string;
}

export interface RunToolResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Run a command to completion with captured stdout/stderr. Resolves with the exit
 * code and output whatever the code is (callers phrase their own failure messages);
 * rejects only when the tool cannot be launched or was killed for stalling.
 */
export function runTool(command: string, args: string[], options: RunToolOptions = {}): Promise<RunToolResult> {
  const idleTimeoutMs = clampTimer(options.idleTimeoutMs ?? 0);
  const maxStdoutBytes = normalizeBytes(options.maxStdoutBytes ?? DEFAULT_CAPTURE_BYTES);
  const maxStderrBytes = normalizeBytes(options.maxStderrBytes ?? DEFAULT_CAPTURE_BYTES);
  const extraOutputPipes = Math.max(0, Math.trunc(options.extraOutputPipes ?? 0));
  const isActivity = options.isActivity ?? (() => true);

  return new Promise((resolve, reject) => {
    const stdio = ["ignore", "pipe", "pipe", ...Array.from({ length: extraOutputPipes }, () => "pipe" as const)];
    const proc = trackChild(spawn(command, args, { stdio, cwd: options.cwd, env: options.env }));

    let stdout = "";
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
      if (idleTimeoutMs <= 0 || killedOnIdle || settled) return;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(onIdleTimeout, idleTimeoutMs).unref();
    };

    function onIdleTimeout(): void {
      killedOnIdle = true;
      // `proc.kill` returns false once Node has seen the process exit: a run that
      // finished right as the timer fired must resolve with its real result, not be
      // reported as stalled.
      if (!proc.kill("SIGTERM")) return;
      escalationTimer = setTimeout(() => proc.kill("SIGKILL"), SIGKILL_GRACE_MS).unref();
    }

    // The data listeners put the pipes in flowing mode, which also drains them — a
    // tool must never block because nobody reads its output. stdout/stderr are kept
    // as bounded tails; extra pipes are only drained and offered to `isActivity`.
    proc.stdout?.on("data", (chunk: Buffer) => {
      if (isActivity(chunk, "stdout")) armIdleTimer();
      stdout = (stdout + chunk.toString()).slice(-maxStdoutBytes);
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      if (isActivity(chunk, "stderr")) armIdleTimer();
      stderr = (stderr + chunk.toString()).slice(-maxStderrBytes);
    });
    for (const pipe of proc.stdio.slice(3)) {
      if (!pipe) continue;
      pipe.on("data", (chunk: Buffer) => {
        if (isActivity(chunk, "pipe")) armIdleTimer();
      });
    }

    proc.on("error", (err) => {
      const hint = options.launchHint ? ` ${options.launchHint}` : "";
      finish(() =>
        reject(new LoomdocError(`Failed to launch ${command}. Is it installed and on PATH?${hint} (${err.message})`)),
      );
    });
    proc.on("close", (code) => {
      if (killedOnIdle) {
        finish(() =>
          reject(
            new LoomdocError(
              `${command} made no progress for ${formatDuration(idleTimeoutMs)} and was killed ` +
                `(stalled input or corrupt file?).${tailSuffix(stderr, "Last output")}`,
            ),
          ),
        );
      } else {
        finish(() => resolve({ code, stdout, stderr }));
      }
    });

    armIdleTimer();
  });
}

/** Keep a duration inside what Node's timers can represent (guards against wraparound to ~1ms). */
function clampTimer(ms: number): number {
  return Number.isFinite(ms) ? Math.min(Math.max(0, ms), MAX_TIMER_DELAY_MS) : 0;
}

/** A byte cap `slice()` can use: non-negative; `Infinity` means "keep everything". */
function normalizeBytes(bytes: number): number {
  return Number.isFinite(bytes) ? Math.max(0, bytes) : Number.MAX_SAFE_INTEGER;
}

/** "45s", "1.5s", "400ms" — never rounds a sub-second timeout down to "0s". */
function formatDuration(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1_000;
  return Number.isInteger(seconds) ? `${seconds}s` : `${seconds.toFixed(1)}s`;
}

/** The captured tail bounded for display — keeps error messages finite against a flooding tool. */
export function outputTail(captured: string): string {
  return captured.slice(-REPORT_CHARS);
}

function tailSuffix(captured: string, label: string): string {
  const tail = outputTail(captured);
  return tail ? `\n${label}:\n${tail}` : "";
}
