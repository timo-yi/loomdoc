import { existsSync } from "node:fs";
import { join } from "node:path";
import { loomdocHome } from "./paths.js";

export { loomdocHome } from "./paths.js";

/**
 * Where loomdoc keeps the tools it manages itself (PRD decision D15).
 *
 * yt-dlp and Deno can be installed by loomdoc (with the user's consent) as private,
 * checksum-verified copies in `<loomdocHome>/bin`. A managed copy always takes precedence
 * over one on PATH: it only exists because the user asked loomdoc to install it, and
 * loomdoc keeps it current.
 */

export type ManagedTool = "yt-dlp" | "deno";

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
