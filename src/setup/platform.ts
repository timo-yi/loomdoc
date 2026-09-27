import { spawn, spawnSync } from "node:child_process";

/**
 * Small facts about the host that the setup checks and installers depend on, gathered in one
 * place so the decision logic elsewhere stays pure and testable.
 */

export interface HostInfo {
  platform: NodeJS.Platform;
  arch: string;
  /** Linux only: true when the C library is musl (Alpine) rather than glibc. */
  musl: boolean;
  isRoot: boolean;
}

export function hostInfo(): HostInfo {
  return {
    platform: process.platform,
    arch: process.arch,
    musl: process.platform === "linux" && !glibcVersion(),
    isRoot: typeof process.getuid === "function" && process.getuid() === 0,
  };
}

function glibcVersion(): string | undefined {
  try {
    const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined;
    return report?.header?.glibcVersionRuntime;
  } catch {
    return undefined;
  }
}

/** True if `command` resolves on PATH. */
export function commandExists(command: string): boolean {
  const result =
    process.platform === "win32"
      ? spawnSync("where", [command], { stdio: "ignore" })
      : spawnSync("sh", ["-c", 'command -v "$1" >/dev/null 2>&1', "sh", command], { stdio: "ignore" });
  return result.status === 0;
}

export interface CaptureResult {
  /** False when the command could not be launched at all (not installed). */
  launched: boolean;
  code: number | null;
  stdout: string;
}

/** Run a command briefly and capture stdout; never throws. */
export function capture(command: string, args: string[], timeoutMs = 20_000): Promise<CaptureResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let settled = false;
    const done = (result: CaptureResult): void => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    let proc;
    try {
      proc = spawn(command, args, { stdio: ["ignore", "pipe", "ignore"], timeout: timeoutMs });
    } catch {
      done({ launched: false, code: null, stdout: "" });
      return;
    }
    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    proc.on("error", () => done({ launched: false, code: null, stdout }));
    proc.on("close", (code) => done({ launched: true, code, stdout }));
  });
}

/** Run a command with the user's terminal attached (so sudo can ask for a password). */
export function runInteractive(command: string, args: string[]): Promise<number | null> {
  return new Promise((resolve, reject) => {
    // Windows package managers such as scoop and choco are .cmd/.ps1 shims that need a shell.
    // The arguments are fixed strings chosen by loomdoc, never user input.
    const proc = spawn(command, args, { stdio: "inherit", shell: process.platform === "win32" });
    proc.on("error", reject);
    proc.on("close", resolve);
  });
}
