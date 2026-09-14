import { spawn } from "node:child_process";
import { LoomdocError } from "./errors.js";

/**
 * Thin wrapper around the `ffmpeg` binary. loomdoc shells out to ffmpeg rather
 * than depending on a native binding — ffmpeg is language-agnostic and does the
 * heavy lifting for both frame sampling and single-frame seeks (PRD decision D1).
 */

/** Run ffmpeg with the given args. Resolves on exit code 0, rejects otherwise. */
export function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", (err) => {
      reject(new LoomdocError(`Failed to launch ffmpeg. Is it installed and on PATH? (${err.message})`));
    });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new LoomdocError(`ffmpeg exited with code ${code}:\n${stderr.slice(-2000)}`));
    });
  });
}

/** Verify ffmpeg is available before a run starts, failing early with a clear message. */
export function assertFfmpegAvailable(): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", ["-version"], { stdio: "ignore" });
    proc.on("error", () =>
      reject(new LoomdocError("ffmpeg not found on PATH. Install ffmpeg to run loomdoc.")),
    );
    proc.on("close", (code) =>
      code === 0 ? resolve() : reject(new LoomdocError("ffmpeg -version failed.")),
    );
  });
}
