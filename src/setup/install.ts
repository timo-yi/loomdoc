import { createHash } from "node:crypto";
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { unzipSync } from "fflate";
import { LoomdocError } from "../core/util/errors.js";
import { managedToolPath, type ManagedTool } from "../core/util/tools.js";
import type { HostInfo } from "./platform.js";

/**
 * Installers used by the setup checks (PRD decision D15). Nothing here runs without the
 * user's consent; the prompting lives in preflight.ts.
 *
 * - ffmpeg: installed through the system package manager, because there is no official
 *   cross-platform ffmpeg binary to download.
 * - yt-dlp and Deno: downloaded from their official GitHub releases into loomdoc's own bin
 *   dir (no admin rights, nothing else on the system touched) and verified against the
 *   SHA-256 checksums each release publishes. Both files come from the same pinned release
 *   tag, so a release published mid-install can't cause a mismatch.
 */

// --- ffmpeg via the system package manager ----------------------------------------------

export interface CommandStep {
  command: string;
  args: string[];
}

export interface CommandPlan {
  /** Run in order; the install stops at the first step that fails. */
  steps: CommandStep[];
  /** Human-readable form shown in the consent prompt. */
  display: string;
  /** e.g. "Homebrew". */
  via: string;
}

interface ManagerSpec {
  via: string;
  command: string;
  /** Argument lists for each invocation of `command`. */
  steps: string[][];
  sudo: boolean;
}

const FFMPEG_MANAGERS: Partial<Record<NodeJS.Platform, ManagerSpec[]>> = {
  darwin: [
    { via: "Homebrew", command: "brew", steps: [["install", "ffmpeg"]], sudo: false },
    { via: "MacPorts", command: "port", steps: [["install", "ffmpeg"]], sudo: true },
  ],
  win32: [
    {
      via: "winget",
      command: "winget",
      steps: [["install", "--id", "Gyan.FFmpeg", "-e", "--accept-source-agreements", "--accept-package-agreements"]],
      sudo: false,
    },
    { via: "Scoop", command: "scoop", steps: [["install", "ffmpeg"]], sudo: false },
    { via: "Chocolatey", command: "choco", steps: [["install", "ffmpeg", "-y"]], sudo: false },
  ],
  linux: [
    // Fresh systems and containers often ship with empty package lists, so refresh them first.
    { via: "apt", command: "apt-get", steps: [["update"], ["install", "-y", "ffmpeg"]], sudo: true },
    // Stock Fedora ships ffmpeg as "ffmpeg-free"; the full build needs RPM Fusion.
    { via: "dnf", command: "dnf", steps: [["install", "-y", "ffmpeg-free"]], sudo: true },
    { via: "pacman", command: "pacman", steps: [["-S", "--needed", "--noconfirm", "ffmpeg"]], sudo: true },
    { via: "apk", command: "apk", steps: [["add", "--no-cache", "ffmpeg"]], sudo: true },
  ],
};

/**
 * The commands that install ffmpeg on this host, or null if no supported package manager is
 * present (or root is needed and neither root nor sudo is available).
 */
export function ffmpegInstallPlan(host: HostInfo, has: (command: string) => boolean): CommandPlan | null {
  for (const spec of FFMPEG_MANAGERS[host.platform] ?? []) {
    if (!has(spec.command)) continue;
    const useSudo = spec.sudo && !host.isRoot;
    if (useSudo && !has("sudo")) continue;
    const steps = spec.steps.map((args) =>
      useSudo ? { command: "sudo", args: [spec.command, ...args] } : { command: spec.command, args },
    );
    const display = steps.map((st) => [st.command, ...st.args].join(" ")).join(" && ");
    return { steps, display, via: spec.via };
  }
  return null;
}

export const FFMPEG_MANUAL =
  "Install ffmpeg from https://ffmpeg.org/download.html (or with your package manager), " +
  "make sure `ffmpeg -version` works in a new terminal, then run loomdoc again.";

// --- managed yt-dlp and Deno ------------------------------------------------------------

/** The yt-dlp release asset for this host, or null if there is no standalone build. */
export function ytDlpAsset(host: HostInfo): string | null {
  if (host.platform === "darwin") return "yt-dlp_macos"; // universal binary
  if (host.platform === "win32") {
    if (host.arch === "x64") return "yt-dlp.exe";
    if (host.arch === "arm64") return "yt-dlp_arm64.exe";
    if (host.arch === "ia32") return "yt-dlp_x86.exe";
    return null;
  }
  if (host.platform === "linux") {
    const prefix = host.musl ? "yt-dlp_musllinux" : "yt-dlp_linux";
    if (host.arch === "x64") return prefix;
    if (host.arch === "arm64") return `${prefix}_aarch64`;
  }
  return null;
}

/** The Deno release asset (a zip) for this host, or null if Deno has no build for it. */
export function denoAsset(host: HostInfo): string | null {
  const targets: Record<string, string> = {
    "darwin-x64": "x86_64-apple-darwin",
    "darwin-arm64": "aarch64-apple-darwin",
    "linux-x64": "x86_64-unknown-linux-gnu",
    "linux-arm64": "aarch64-unknown-linux-gnu",
    "win32-x64": "x86_64-pc-windows-msvc",
  };
  if (host.platform === "linux" && host.musl) return null; // Deno publishes glibc builds only
  const target = targets[`${host.platform}-${host.arch}`];
  return target ? `deno-${target}.zip` : null;
}

/**
 * Find the SHA-256 for `fileName` in a checksum listing. Handles `sha256sum` output (one or
 * many lines of "<hash>  <name>") and PowerShell's Get-FileHash format, where the hash and
 * the file name sit on separate lines.
 */
export function checksumFor(listing: string, fileName: string): string | null {
  const lines = listing.split(/\r?\n/);
  for (const line of lines) {
    const m = /^([0-9a-f]{64})\s+\*?(\S+)\s*$/i.exec(line.trim());
    if (m && m[2]!.split(/[\\/]/).pop() === fileName) return m[1]!.toLowerCase();
  }
  // Single-file listing (e.g. PowerShell format): accept its only hash if the name appears.
  const hashes = listing.match(/\b[0-9a-f]{64}\b/gi) ?? [];
  if (hashes.length === 1 && listing.includes(fileName)) return hashes[0]!.toLowerCase();
  return null;
}

export function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export async function installManagedYtDlp(host: HostInfo, log: (line: string) => void): Promise<string> {
  const asset = ytDlpAsset(host);
  if (!asset) throw new LoomdocError(`yt-dlp has no standalone build for ${host.platform}/${host.arch}.`);
  const tag = await latestTag("yt-dlp/yt-dlp");
  const base = `https://github.com/yt-dlp/yt-dlp/releases/download/${tag}`;

  log(`Downloading yt-dlp ${tag} from GitHub…`);
  const expected = checksumFor(await fetchText(`${base}/SHA2-256SUMS`), asset);
  if (!expected) throw new LoomdocError(`yt-dlp ${tag} does not list a checksum for ${asset}.`);
  const data = await fetchBytes(`${base}/${asset}`);
  verifyChecksum(data, expected, asset);

  const dest = managedToolPath("yt-dlp");
  await writeExecutable(dest, data);
  log(`Installed yt-dlp ${tag} to ${dest} (checksum verified).`);
  return dest;
}

export async function installManagedDeno(host: HostInfo, log: (line: string) => void): Promise<string> {
  const asset = denoAsset(host);
  if (!asset) throw new LoomdocError(`Deno has no prebuilt release for ${host.platform}/${host.arch}${host.musl ? " (musl)" : ""}.`);
  const tag = await latestTag("denoland/deno");
  const base = `https://github.com/denoland/deno/releases/download/${tag}`;

  log(`Downloading Deno ${tag} from GitHub…`);
  const expected = checksumFor(await fetchText(`${base}/${asset}.sha256sum`), asset);
  if (!expected) throw new LoomdocError(`Deno ${tag} does not publish a readable checksum for ${asset}.`);
  const zip = await fetchBytes(`${base}/${asset}`);
  verifyChecksum(zip, expected, asset);

  const exe = host.platform === "win32" ? "deno.exe" : "deno";
  const entry = unzipSync(zip, { filter: (f) => f.name === exe })[exe];
  if (!entry) throw new LoomdocError(`The Deno release archive did not contain ${exe}.`);

  const dest = managedToolPath("deno");
  await writeExecutable(dest, entry);
  log(`Installed Deno ${tag} to ${dest} (checksum verified).`);
  return dest;
}

export function installManaged(tool: ManagedTool, host: HostInfo, log: (line: string) => void): Promise<string> {
  return tool === "yt-dlp" ? installManagedYtDlp(host, log) : installManagedDeno(host, log);
}

function verifyChecksum(data: Uint8Array, expected: string, name: string): void {
  const actual = sha256(data);
  if (actual !== expected) {
    throw new LoomdocError(
      `Checksum mismatch for ${name} (expected ${expected}, got ${actual}). Nothing was installed.`,
    );
  }
}

/** Write atomically (temp file + rename) so an interrupted install never leaves a broken binary. */
async function writeExecutable(dest: string, data: Uint8Array): Promise<void> {
  await mkdir(dirname(dest), { recursive: true });
  const tmp = `${dest}.download-${process.pid}`;
  try {
    await writeFile(tmp, data);
    await chmod(tmp, 0o755);
    await rename(tmp, dest);
  } finally {
    await rm(tmp, { force: true });
  }
}

/** Resolve a repo's latest release tag from the /releases/latest redirect (no API token needed). */
async function latestTag(repo: string): Promise<string> {
  const res = await request(`https://github.com/${repo}/releases/latest`, { redirect: "manual" });
  const location = res.headers.get("location") ?? "";
  const tag = /\/releases\/tag\/([^/?#]+)/.exec(location)?.[1];
  if (!tag) throw new LoomdocError(`Could not determine the latest ${repo} release (HTTP ${res.status}).`);
  return decodeURIComponent(tag);
}

async function fetchText(url: string): Promise<string> {
  return (await okResponse(url)).text();
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  return new Uint8Array(await (await okResponse(url)).arrayBuffer());
}

async function okResponse(url: string): Promise<Response> {
  const res = await request(url);
  if (!res.ok) throw new LoomdocError(`Download failed (HTTP ${res.status}): ${url}`);
  return res;
}

async function request(url: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(10 * 60_000) });
  } catch (err) {
    throw new LoomdocError(`Network error downloading ${url}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
