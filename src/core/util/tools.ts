import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Where loomdoc keeps the tools it manages itself (PRD decision D15).
 *
 * yt-dlp and Deno can be installed by loomdoc (with the user's consent) as private,
 * checksum-verified copies in `<loomdocHome>/bin`. A managed copy always takes precedence
 * over one on PATH: it only exists because the user asked loomdoc to install it, and
 * loomdoc keeps it current.
 */

export type ManagedTool = "yt-dlp" | "deno";

/** Per-user data dir: `LOOMDOC_HOME`, else the platform's conventional location. */
export function loomdocHome(): string {
  const override = process.env["LOOMDOC_HOME"];
  if (override) return override;
  const home = homedir();
  if (process.platform === "win32") {
    return join(process.env["LOCALAPPDATA"] ?? join(home, "AppData", "Local"), "loomdoc");
  }
  if (process.platform === "darwin") return join(home, "Library", "Application Support", "loomdoc");
  return join(process.env["XDG_DATA_HOME"] ?? join(home, ".local", "share"), "loomdoc");
}

export function managedBinDir(): string {
  return join(loomdocHome(), "bin");
}

export function managedToolPath(tool: ManagedTool): string {
  return join(managedBinDir(), process.platform === "win32" ? `${tool}.exe` : tool);
}

/** The managed copy's path if one is installed, else null. */
export function installedManagedTool(tool: ManagedTool): string | null {
  const path = managedToolPath(tool);
  return existsSync(path) ? path : null;
}

/** The command to run for `tool`: the managed copy if installed, else the name (PATH lookup). */
export function toolCommand(tool: ManagedTool): string {
  return installedManagedTool(tool) ?? tool;
}
