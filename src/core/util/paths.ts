import { homedir } from "node:os";
import { join } from "node:path";

/** Per-user loomdoc data dir: `LOOMDOC_HOME`, else the platform's conventional location. */
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

/**
 * Optional yt-dlp config file that loomdoc passes to yt-dlp (PRD D13): the place for cookies or
 * network settings. loomdoc ignores the user's general yt-dlp config, whose download settings
 * (an archive file, audio extraction, chapter splitting) can silently break its downloads.
 */
export function ytDlpConfigPath(): string {
  return join(loomdocHome(), "yt-dlp.conf");
}
