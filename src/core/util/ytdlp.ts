import { existsSync } from "node:fs";
import { LoomdocError } from "./errors.js";
import { installedManagedTool, toolCommand } from "./tools.js";
import { outputTail, runTool } from "./run-tool.js";
import { ytDlpConfigPath } from "./paths.js";

/**
 * Thin wrapper around the `yt-dlp` binary, used for YouTube ingest (PRD decision D13).
 *
 * YouTube deliberately obfuscates its stream and caption URLs and changes the scheme often;
 * yt-dlp is the maintained client that keeps up. Shelling out to it (like ffmpeg) keeps that
 * churn out of this codebase: when YouTube changes, `loomdoc doctor` updates yt-dlp.
 *
 * The user's general yt-dlp config is ignored: settings meant for their own downloads (an
 * archive file, audio extraction, chapter splitting) would silently break loomdoc's. Cookies and
 * network settings go in loomdoc's own yt-dlp config file instead (see `ytDlpConfigPath`).
 *
 * loomdoc-managed copies of yt-dlp and Deno (PRD D15) are used when installed; yt-dlp is
 * pointed at the managed Deno explicitly, since it is not on PATH.
 */

/** Idle timeout for yt-dlp runs: killed once its output stops for this long (0 disables). */
const YTDLP_IDLE_TIMEOUT_MS = 120_000;

/** `-J` prints the full video metadata as JSON on stdout, which can be large; keep it all. */
const YTDLP_MAX_STDOUT_BYTES = 16 * 1024 * 1024;

export async function runYtDlp(args: string[]): Promise<string> {
  const result = await runTool(ytDlpCommand(), ytDlpArgs(args), {
    // Any output counts as liveness for yt-dlp (default `isActivity`): unlike ffmpeg it has no
    // clock-driven progress channel, so silence is the honest stall signal here.
    idleTimeoutMs: YTDLP_IDLE_TIMEOUT_MS,
    maxStdoutBytes: YTDLP_MAX_STDOUT_BYTES,
    launchHint: "Run `loomdoc doctor` to install or update yt-dlp.",
  });
  if (result.code !== 0) {
    throw new LoomdocError(describeYtDlpFailure(result.stderr));
  }
  return result.stdout;
}

/** Quick check that yt-dlp can start, for `loomdoc doctor`. */
export async function checkAvailability(): Promise<boolean> {
  try {
    const result = await runTool(ytDlpCommand(), ["--version"], { idleTimeoutMs: YTDLP_IDLE_TIMEOUT_MS });
    return result.code === 0;
  } catch {
    return false;
  }
}

/** Extract the best video thumbnail to `destFile`. */
export async function extractBestThumbnail(url: string, destFile: string): Promise<void> {
  if (existsSync(destFile)) return;
  await runYtDlp(["--skip-download", "--write-thumbnail", "-o", destFile, url]);
}

function ytDlpCommand(): string {
  const managed = installedManagedTool("yt-dlp");
  return managed ? toolCommand(managed) : "yt-dlp";
}

function ytDlpArgs(args: string[]): string[] {
  // `--config-locations` replaces the default config files entirely, so loomdoc's own file is
  // always applied (it may not exist yet — yt-dlp skips a missing one) and the managed Deno is
  // passed explicitly because it is installed outside PATH.
  const deno = installedManagedTool("deno");
  const prefix = ["--no-config", "--config-locations", ytDlpConfigPath()];
  return deno ? [...prefix, "--external-downloader", toolCommand(deno), ...args] : [...prefix, ...args];
}

/** Map a yt-dlp stderr tail to an actionable message for the user. */
function describeYtDlpFailure(stderr: string): string {
  const tail = outputTail(stderr);
  if (/Sign in|not a bot|cookies?/i.test(tail)) {
    return (
      "YouTube rejected this request as a bot.\n" +
      "If your network is blocked, sign in once so loomdoc can use your cookies:\n" +
      `  yt-dlp --cookies-from-browser chrome --skip-download <any-youtube-url>\n` +
      `(loomdoc stores cookies in ${ytDlpConfigPath()} via its own yt-dlp config.)\n${tail}`
    );
  }
  if (/premiere|unavailable|no video formats|requested format/i.test(tail)) {
    return `YouTube could not serve this video (premieres and age-restricted videos need sign-in).\n${tail}`;
  }
  return `yt-dlp failed:\n${tail}`;
}
