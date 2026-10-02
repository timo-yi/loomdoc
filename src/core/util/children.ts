import { spawnSync, type ChildProcess } from "node:child_process";

/**
 * Registry of the external processes loomdoc starts (ffmpeg, yt-dlp), so a signal that ends
 * the run can stop them too. A terminal Ctrl-C reaches the whole process group, but a signal
 * sent to loomdoc alone (SIGTERM from a supervisor, closing the window) would otherwise leave
 * a download running into a scratch dir that no longer exists.
 */

const live = new Set<ChildProcess>();

export function trackChild<T extends ChildProcess>(proc: T): T {
  live.add(proc);
  const forget = (): void => {
    live.delete(proc);
  };
  proc.once("exit", forget);
  proc.once("error", forget);
  return proc;
}

/** Ask every tracked process to stop. Synchronous, so it is safe in signal and exit handlers. */
export function killTrackedChildren(): void {
  for (const proc of live) {
    try {
      if (process.platform === "win32" && proc.pid !== undefined) {
        // The standalone yt-dlp.exe is a launcher that starts a separate worker process, and
        // killing a process on Windows does not stop its children, so end the whole tree.
        spawnSync("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      } else {
        proc.kill("SIGTERM");
      }
    } catch {
      // Already gone.
    }
  }
  live.clear();
}

export function trackedChildCount(): number {
  return live.size;
}
