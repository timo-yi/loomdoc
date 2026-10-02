import { installedManagedTool, toolCommand, type ManagedTool } from "../core/util/tools.js";
import { capture, commandExists, hostInfo, runInteractive, type HostInfo } from "./platform.js";
import { FFMPEG_MANUAL, ffmpegInstallPlan, installManaged, denoAsset, ytDlpAsset } from "./install.js";

/**
 * What loomdoc needs on the machine, and how to check each thing (PRD decision D15).
 *
 * A requirement's check returns either OK (with a one-line summary) or a Finding that says
 * what is wrong, how serious it is, and, where loomdoc can fix it, a Fix to offer the user.
 * Checks never change anything; fixes only run after consent (see preflight.ts).
 */

export type Severity = "error" | "warning";

export interface Fix {
  /** The consent question, naming exactly what will happen. */
  prompt: string;
  run(log: (line: string) => void): Promise<void>;
  /** Shown if the fix ran but a re-check still fails (e.g. PATH not refreshed yet). */
  afterFixHint?: string;
}

export interface Finding {
  severity: Severity;
  /** One line: what is wrong. */
  title: string;
  fix?: Fix;
  /** How to resolve it by hand. Always present so non-interactive runs can say what to do. */
  manual: string;
}

export type CheckResult = { ok: true; summary: string } | { ok: false; finding: Finding };

export interface Requirement {
  id: "ffmpeg" | "yt-dlp" | "deno" | "api-key";
  check(): Promise<CheckResult>;
}

/** yt-dlp older than this is likely to be broken by YouTube's frequent player changes. */
export const YTDLP_MAX_AGE_DAYS = 60;
/** yt-dlp's YouTube support requires Deno 2 or newer. */
export const DENO_MIN_MAJOR = 2;

export interface RequirementNeeds {
  youtube: boolean;
}

export function requirementsFor(needs: RequirementNeeds, host: HostInfo = hostInfo()): Requirement[] {
  const reqs: Requirement[] = [ffmpegRequirement(host), apiKeyRequirement()];
  if (needs.youtube) reqs.push(ytDlpRequirement(host), denoRequirement(host));
  return reqs;
}

// --- ffmpeg ------------------------------------------------------------------------------

export function ffmpegRequirement(host: HostInfo): Requirement {
  return {
    id: "ffmpeg",
    async check() {
      const out = await capture("ffmpeg", ["-version"]);
      if (out.launched && out.code === 0) {
        return { ok: true, summary: `ffmpeg ${parseFfmpegVersion(out.stdout) ?? "(unknown version)"}` };
      }
      const plan = ffmpegInstallPlan(host, commandExists);
      return {
        ok: false,
        finding: {
          severity: "error",
          title: "ffmpeg is not installed (loomdoc uses it to download videos and cut screenshots).",
          manual: FFMPEG_MANUAL,
          fix: plan
            ? {
                prompt: `Install ffmpeg with ${plan.via}? This runs: ${plan.display}`,
                run: async (log) => {
                  for (const step of plan.steps) {
                    const code = await runInteractive(step.command, step.args);
                    const shown = [step.command, ...step.args].join(" ");
                    if (code === 0) continue;
                    if (step.optional) {
                      log(`${shown} exited with code ${code}; continuing with the install.`);
                      continue;
                    }
                    throw new Error(`${shown} exited with code ${code}`);
                  }
                },
                afterFixHint:
                  host.platform === "win32"
                    ? "ffmpeg was installed, but this terminal can't see it yet. Open a new terminal and run loomdoc again."
                    : undefined,
              }
            : undefined,
        },
      };
    },
  };
}

export function parseFfmpegVersion(output: string): string | null {
  return /ffmpeg version (\S+)/.exec(output)?.[1] ?? null;
}

// --- API key -----------------------------------------------------------------------------

export function apiKeyRequirement(): Requirement {
  return {
    id: "api-key",
    async check() {
      if (process.env["ANTHROPIC_API_KEY"]?.trim()) return { ok: true, summary: "ANTHROPIC_API_KEY is set" };
      return {
        ok: false,
        finding: {
          severity: "error",
          title: "ANTHROPIC_API_KEY is not set (loomdoc needs it to write the document).",
          manual:
            "Create a key at https://console.anthropic.com/settings/keys, then run " +
            "`export ANTHROPIC_API_KEY=sk-ant-...` (add it to your shell profile to keep it). See README step 1d.",
        },
      };
    },
  };
}

// --- yt-dlp ------------------------------------------------------------------------------

export function ytDlpRequirement(host: HostInfo, now: Date = new Date()): Requirement {
  return {
    id: "yt-dlp",
    async check() {
      const managed = installedManagedTool("yt-dlp") !== null;
      const out = await capture(toolCommand("yt-dlp"), ["--version"]);
      const version = out.launched && out.code === 0 ? out.stdout.trim() : null;

      if (version === null) {
        return missing(host, "yt-dlp", "yt-dlp is not installed (loomdoc needs it for YouTube links).", YTDLP_MANUAL);
      }

      const released = parseYtDlpDate(version);
      const ageDays = released ? Math.floor((now.getTime() - released.getTime()) / 86_400_000) : null;
      const where = managed ? "loomdoc-managed" : "system";
      if (ageDays === null || ageDays <= YTDLP_MAX_AGE_DAYS) {
        return { ok: true, summary: `yt-dlp ${version} (${where})` };
      }

      const title =
        `yt-dlp ${version} is ${ageDays} days old; YouTube regularly breaks older versions.`;
      return outdated(
        host,
        "yt-dlp",
        title,
        managed
          ? "Update loomdoc's copy of yt-dlp to the latest release?"
          : "Install an up-to-date loomdoc-managed copy of yt-dlp? (Your system copy is left untouched; loomdoc will use its own.)",
        managed
          ? "Run `loomdoc doctor` to update loomdoc's copy of yt-dlp."
          : "Update your yt-dlp (e.g. `yt-dlp -U`, `brew upgrade yt-dlp`, or `pipx upgrade yt-dlp`), or run " +
            "`loomdoc doctor` to install a loomdoc-managed copy.",
      );
    },
  };
}

/** yt-dlp versions are release dates: 2026.08.19, or 2026.08.19.123456 for nightlies. */
export function parseYtDlpDate(version: string): Date | null {
  const m = /^(\d{4})\.(\d{2})\.(\d{2})/.exec(version.trim());
  if (!m) return null;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

const YTDLP_MANUAL =
  "Install yt-dlp (https://github.com/yt-dlp/yt-dlp#installation), e.g. `brew install yt-dlp`, " +
  "`winget install yt-dlp.yt-dlp`, or `pipx install yt-dlp`.";

// --- Deno --------------------------------------------------------------------------------

export function denoRequirement(host: HostInfo): Requirement {
  return {
    id: "deno",
    async check() {
      const managed = installedManagedTool("deno") !== null;
      const out = await capture(toolCommand("deno"), ["--version"]);
      const version = out.launched && out.code === 0 ? parseDenoVersion(out.stdout) : null;

      if (version === null) {
        return missing(
          host,
          "deno",
          "Deno is not installed (yt-dlp uses it, sandboxed, to handle YouTube's player).",
          DENO_MANUAL,
        );
      }
      const major = Number(version.split(".")[0]);
      if (major >= DENO_MIN_MAJOR) {
        return { ok: true, summary: `Deno ${version} (${managed ? "loomdoc-managed" : "system"})` };
      }
      return outdated(
        host,
        "deno",
        `Deno ${version} is too old for yt-dlp (needs ${DENO_MIN_MAJOR}.0 or newer).`,
        "Install an up-to-date loomdoc-managed copy of Deno? (Your system copy is left untouched.)",
        "Upgrade Deno (`deno upgrade`, or your package manager).",
      );
    },
  };
}

export function parseDenoVersion(output: string): string | null {
  return /deno (\d+\.\d+\.\d+)/.exec(output)?.[1] ?? null;
}

const DENO_MANUAL =
  "Install Deno (https://docs.deno.com/runtime/getting_started/installation/), e.g. " +
  "`brew install deno` or `winget install DenoLand.Deno`.";

// --- shared ------------------------------------------------------------------------------

const TOOL_LABEL: Record<ManagedTool, string> = { "yt-dlp": "yt-dlp", deno: "Deno" };

function managedFix(host: HostInfo, tool: ManagedTool, prompt: string): Fix | undefined {
  const supported = tool === "yt-dlp" ? ytDlpAsset(host) : denoAsset(host);
  if (!supported) return undefined;
  return {
    prompt,
    run: async (log) => {
      await installManaged(tool, host, log);
    },
  };
}

function missing(host: HostInfo, tool: ManagedTool, title: string, manual: string): CheckResult {
  return {
    ok: false,
    finding: {
      severity: "error",
      title,
      manual,
      fix: managedFix(
        host,
        tool,
        `Download ${TOOL_LABEL[tool]} from its official GitHub release into loomdoc's own folder ` +
          `(checksum-verified, no admin rights needed)?`,
      ),
    },
  };
}

function outdated(host: HostInfo, tool: ManagedTool, title: string, prompt: string, manual: string): CheckResult {
  return { ok: false, finding: { severity: "warning", title, manual, fix: managedFix(host, tool, prompt) } };
}
