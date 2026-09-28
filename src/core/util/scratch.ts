import { rmSync } from "node:fs";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { killTrackedChildren } from "./children.js";

/**
 * Per-run scratch directory (PRD decision D14).
 *
 * Holds the downloaded video, captions, and sampled frames: hundreds of MB for a long video,
 * so it must never accumulate. Three layers make sure it doesn't:
 *   1. `dispose()` removes it when the run ends (the pipeline calls it in a `finally`).
 *   2. While the run is live, the terminating signals (Ctrl-C, SIGTERM, closing the terminal
 *      window, Ctrl-Break on Windows) and process exit stop loomdoc's ffmpeg/yt-dlp children
 *      and remove it synchronously.
 *   3. A hard kill (SIGKILL, power loss) can't be intercepted, so each new run sweeps any
 *      leftover scratch dirs older than STALE_AFTER_MS.
 */

const PREFIX = "loomdoc-";
/**
 * Signals that end the process by default. SIGHUP is sent when the terminal window closes (and
 * on Windows when the console closes); SIGBREAK is Ctrl-Break on Windows.
 */
const TERMINATING_SIGNALS: NodeJS.Signals[] =
  process.platform === "win32" ? ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"] : ["SIGINT", "SIGTERM", "SIGHUP"];

/** Old enough that no live run can still own it. */
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export interface ScratchDir {
  path: string;
  /** Remove the directory and detach the signal handlers. Safe to call more than once. */
  dispose(): Promise<void>;
}

export async function createScratchDir(baseDir: string = tmpdir()): Promise<ScratchDir> {
  await sweepStaleScratchDirs(baseDir);
  const path = await mkdtemp(join(baseDir, PREFIX));

  const removeSync = (): void => {
    killTrackedChildren();
    try {
      rmSync(path, { recursive: true, force: true });
    } catch {
      // Best effort: the stale sweep catches anything left behind.
    }
  };
  const detach = (): void => {
    for (const signal of TERMINATING_SIGNALS) process.off(signal, onSignal);
    process.off("exit", removeSync);
  };
  // Clean up, then re-raise the signal with our handler gone so the process still terminates
  // the way it would have without us.
  const onSignal = (signal: NodeJS.Signals): void => {
    removeSync();
    detach();
    process.kill(process.pid, signal);
  };

  for (const signal of TERMINATING_SIGNALS) process.on(signal, onSignal);
  process.on("exit", removeSync);

  return {
    path,
    dispose: async () => {
      detach();
      await rm(path, { recursive: true, force: true });
    },
  };
}

/** Remove loomdoc scratch dirs in `baseDir` last modified more than `STALE_AFTER_MS` ago. */
export async function sweepStaleScratchDirs(baseDir: string = tmpdir(), now = Date.now()): Promise<void> {
  let names: string[];
  try {
    names = await readdir(baseDir);
  } catch {
    return;
  }
  await Promise.all(
    names
      .filter((name) => name.startsWith(PREFIX))
      .map(async (name) => {
        const dir = join(baseDir, name);
        try {
          const info = await stat(dir);
          if (info.isDirectory() && now - info.mtimeMs > STALE_AFTER_MS) {
            await rm(dir, { recursive: true, force: true });
          }
        } catch {
          // Vanished or unreadable: not ours to worry about.
        }
      }),
  );
}
