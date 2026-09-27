import { spawn } from "node:child_process";
import { LoomdocError } from "./errors.js";
import { installedManagedTool, toolCommand } from "./tools.js";

/**
 * Thin wrapper around the `yt-dlp` binary, used for YouTube ingest (PRD decision D13).
 *
 * YouTube deliberately obfuscates its stream and caption URLs and changes the scheme often;
 * yt-dlp is the maintained client that keeps up. Shelling out to it (like ffmpeg) keeps that
 * churn out of this codebase: when YouTube changes, `loomdoc doctor` updates yt-dlp.
 *
 * yt-dlp still reads the user's own config file, so settings such as
 * `--cookies-from-browser` can be supplied there without loomdoc knowing about them.
 *
 * loomdoc-managed copies of yt-dlp and Deno (PRD D15) are used when installed; yt-dlp is
 * pointed at the managed Deno explicitly, since it is not on PATH.
 */

/** Run yt-dlp and resolve with its stdout. Rejects with an actionable LoomdocError. */
export function runYtDlp(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(toolCommand("yt-dlp"), [...runtimeArgs(), ...args], { stdio: ["ignore", "pipe", "pipe"] });
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
          `Failed to launch yt-dlp, which loomdoc needs for YouTube videos. Run \`loomdoc doctor\` ` +
            `to install it. (${err.message})`,
        ),
      );
    });
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new LoomdocError(describeYtDlpFailure(stderr, code)));
    });
  });
}

function runtimeArgs(): string[] {
  const deno = installedManagedTool("deno");
  return deno ? ["--js-runtimes", `deno:${deno}`] : [];
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
      "to your yt-dlp config file.";
  } else if (/private video|members-only|join this channel/i.test(stderr)) {
    hint = " loomdoc supports public and unlisted YouTube videos only.";
  } else if (/HTTP Error 403|Requested format is not available|nsig|signature|no such option/i.test(stderr)) {
    hint =
      " yt-dlp may be out of date for YouTube's current player. Run `loomdoc doctor` to " +
      "check and update yt-dlp and Deno.";
  }
  return `yt-dlp failed (exit code ${code}): ${errorLine}${hint}`;
}
