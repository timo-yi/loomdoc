import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { LoomdocError } from "./errors.js";
import { trackChild } from "./children.js";
import { ytDlpConfigPath } from "./paths.js";

/**
 * Thin wrapper around the `yt-dlp` binary, used for YouTube ingest (PRD decision D13).
 *
 * YouTube deliberately obfuscates its stream and caption URLs and changes the scheme often;
 * yt-dlp is the maintained client that keeps up. Shelling out to it (like ffmpeg) keeps that
 * churn out of this codebase: when YouTube changes, users run `yt-dlp -U`.
 *
 * The user's general yt-dlp config is ignored: settings meant for their own downloads (an
 * archive file, audio extraction, chapter splitting) would silently break loomdoc's. Cookies and
 * network settings go in loomdoc's own yt-dlp config file instead (see `ytDlpConfigPath`).
 */

/** Run yt-dlp and resolve with its stdout. Rejects with an actionable LoomdocError. */
export function runYtDlp(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = trackChild(spawn("yt-dlp", [...configArgs(), ...args], { stdio: ["ignore", "pipe", "pipe"] }));
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", (err) => {
      reject(
        new LoomdocError(
          `Failed to launch yt-dlp, which loomdoc needs for YouTube videos. Is it installed and ` +
            `on PATH? (${err.message})`,
        ),
      );
    });
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new LoomdocError(describeYtDlpFailure(stderr, code)));
    });
  });
}

/** Config isolation: only loomdoc's own yt-dlp config file, if the user created one. */
export function configArgs(configPath: string = ytDlpConfigPath()): string[] {
  const args = ["--ignore-config"];
  if (existsSync(configPath)) args.push("--config-locations", configPath);
  // Even loomdoc's own config must not make yt-dlp skip a video it has "already downloaded".
  args.push("--no-download-archive");
  return args;
}

/** Turn yt-dlp's stderr into a message that says what went wrong and what to do about it. */
export function describeYtDlpFailure(stderr: string, code: number | null): string {
  const errorLine =
    stderr
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("ERROR:"))
      .pop() ?? stderr.trim().split("\n").pop() ?? "";

  let hint = "";
  if (/confirm you.re not a bot|sign in to confirm/i.test(stderr)) {
    hint =
      " YouTube is asking this network to prove it is not a bot (common on cloud/VPN IPs). " +
      "Run from a normal home or office connection, or add `--cookies-from-browser <browser>` " +
      `to loomdoc's yt-dlp config file (${ytDlpConfigPath()}).`;
  } else if (/private video|members-only|join this channel/i.test(stderr)) {
    hint = " loomdoc supports public and unlisted YouTube videos only.";
  } else if (/HTTP Error 403|Requested format is not available|nsig|signature/i.test(stderr)) {
    hint =
      " YouTube may have changed its player. Update yt-dlp (`yt-dlp -U`, or your package " +
      "manager) and make sure a JavaScript runtime such as Deno is installed.";
  }
  return `yt-dlp failed (exit code ${code}): ${errorLine}${hint}`;
}
