import { test } from "node:test";
import assert from "node:assert/strict";
import { checksumFor, denoAsset, ffmpegInstallPlan, sha256, ytDlpAsset } from "../src/setup/install.js";
import { parseDenoVersion, parseFfmpegVersion, parseYtDlpDate, type Requirement } from "../src/setup/checks.js";
import { runPreflight, type PreflightIO } from "../src/setup/preflight.js";
import type { HostInfo } from "../src/setup/platform.js";

const host = (over: Partial<HostInfo>): HostInfo => ({ platform: "linux", arch: "x64", musl: false, isRoot: false, ...over });

// --- ffmpeg install plan ------------------------------------------------------------------

test("ffmpeg plan uses the first available package manager, with sudo when needed", () => {
  const has = (...cmds: string[]) => (c: string) => cmds.includes(c);

  assert.equal(ffmpegInstallPlan(host({ platform: "darwin" }), has("brew"))?.display, "brew install ffmpeg");
  assert.equal(ffmpegInstallPlan(host({}), has("apt-get", "sudo"))?.display, "sudo apt-get install -y ffmpeg");
  assert.equal(ffmpegInstallPlan(host({ isRoot: true }), has("apt-get"))?.display, "apt-get install -y ffmpeg");
  assert.equal(ffmpegInstallPlan(host({}), has("dnf", "sudo"))?.display, "sudo dnf install -y ffmpeg-free");
  assert.match(ffmpegInstallPlan(host({ platform: "win32" }), has("winget", "choco"))!.display, /^winget install --id Gyan\.FFmpeg/);
  assert.equal(ffmpegInstallPlan(host({ platform: "win32" }), has("choco"))?.via, "Chocolatey");
});

test("ffmpeg plan is null when nothing usable is available", () => {
  assert.equal(ffmpegInstallPlan(host({ platform: "darwin" }), () => false), null);
  // apt present but no root and no sudo: can't install.
  assert.equal(ffmpegInstallPlan(host({}), (c) => c === "apt-get"), null);
  assert.equal(ffmpegInstallPlan(host({ platform: "freebsd" }), () => true), null);
});

// --- release assets -----------------------------------------------------------------------

test("picks the right yt-dlp and Deno release assets", () => {
  assert.equal(ytDlpAsset(host({ platform: "darwin", arch: "arm64" })), "yt-dlp_macos");
  assert.equal(ytDlpAsset(host({})), "yt-dlp_linux");
  assert.equal(ytDlpAsset(host({ arch: "arm64" })), "yt-dlp_linux_aarch64");
  assert.equal(ytDlpAsset(host({ musl: true })), "yt-dlp_musllinux");
  assert.equal(ytDlpAsset(host({ platform: "win32" })), "yt-dlp.exe");
  assert.equal(ytDlpAsset(host({ platform: "win32", arch: "arm64" })), "yt-dlp_arm64.exe");
  assert.equal(ytDlpAsset(host({ arch: "riscv64" })), null);

  assert.equal(denoAsset(host({ platform: "darwin", arch: "arm64" })), "deno-aarch64-apple-darwin.zip");
  assert.equal(denoAsset(host({})), "deno-x86_64-unknown-linux-gnu.zip");
  assert.equal(denoAsset(host({ platform: "win32" })), "deno-x86_64-pc-windows-msvc.zip");
  assert.equal(denoAsset(host({ musl: true })), null);
  assert.equal(denoAsset(host({ platform: "win32", arch: "ia32" })), null);
});

// --- checksums ----------------------------------------------------------------------------

const H1 = "a".repeat(64);
const H2 = "B".repeat(64);

test("checksumFor reads sha256sum listings and PowerShell output", () => {
  const listing = `${H1}  yt-dlp\n${H2}  yt-dlp_linux\n${"c".repeat(64)}  yt-dlp_linux.zip\n`;
  assert.equal(checksumFor(listing, "yt-dlp_linux"), "b".repeat(64));
  assert.equal(checksumFor(listing, "yt-dlp"), H1);
  assert.equal(checksumFor(listing, "yt-dlp_macos"), null);

  assert.equal(checksumFor(`${H1}  deno-x86_64-unknown-linux-gnu.zip\n`, "deno-x86_64-unknown-linux-gnu.zip"), H1);
  const powershell = `\nAlgorithm : SHA256\nHash      : ${H2}\nPath      : C:\\a\\deno-x86_64-pc-windows-msvc.zip\n`;
  assert.equal(checksumFor(powershell, "deno-x86_64-pc-windows-msvc.zip"), "b".repeat(64));
  assert.equal(checksumFor(powershell, "something-else.zip"), null);
});

test("sha256 matches the known digest", () => {
  assert.equal(sha256(new TextEncoder().encode("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

// --- version parsing ----------------------------------------------------------------------

test("parses tool versions", () => {
  assert.equal(parseFfmpegVersion("ffmpeg version 6.1.1-3ubuntu5 Copyright (c) 2000-2023"), "6.1.1-3ubuntu5");
  assert.equal(parseFfmpegVersion("garbage"), null);
  assert.equal(parseDenoVersion("deno 2.9.7 (stable, release, x86_64-unknown-linux-gnu)\nv8 13"), "2.9.7");
  assert.equal(parseYtDlpDate("2026.08.19")?.toISOString(), "2026-08-19T00:00:00.000Z");
  assert.equal(parseYtDlpDate("2026.08.19.232500\n")?.toISOString(), "2026-08-19T00:00:00.000Z");
  assert.equal(parseYtDlpDate("nightly"), null);
});

// --- preflight flow -----------------------------------------------------------------------

function fakeIO(answers: boolean[] = []): PreflightIO & { lines: string[]; asked: string[] } {
  const lines: string[] = [];
  const asked: string[] = [];
  return {
    lines,
    asked,
    write: (l) => lines.push(l),
    confirm: async (q) => {
      asked.push(q);
      return answers.shift() ?? false;
    },
  };
}

/** A requirement that fails until its fix runs. */
function fixable(severity: "error" | "warning", opts: { fixThrows?: boolean; hint?: string; staysBroken?: boolean } = {}) {
  let fixed = false;
  let runs = 0;
  const req: Requirement = {
    id: "yt-dlp",
    async check() {
      if (fixed && !opts.staysBroken) return { ok: true, summary: "tool OK" };
      return {
        ok: false,
        finding: {
          severity,
          title: "tool missing",
          manual: "install it by hand",
          fix: {
            prompt: "Install tool?",
            afterFixHint: opts.hint,
            run: async (log) => {
              runs++;
              if (opts.fixThrows) throw new Error("boom");
              log("installing");
              fixed = true;
            },
          },
        },
      };
    },
  };
  return { req, runs: () => runs };
}

const ok: Requirement = { id: "ffmpeg", check: async () => ({ ok: true, summary: "ffmpeg 7" }) };

test("interactive yes runs the fix and re-checks", async () => {
  const io = fakeIO([true]);
  const t = fixable("error");
  assert.equal(await runPreflight([ok, t.req], io, { interactive: true, assumeYes: false, verbose: false }), true);
  assert.equal(t.runs(), 1);
  assert.deepEqual(io.asked, ["    Install tool?"]);
  assert.deepEqual(io.lines, ["  ✗ tool missing", "    installing", "  ✓ tool OK"]);
});

test("declining never installs and blocks on errors", async () => {
  const io = fakeIO([false]);
  const t = fixable("error");
  assert.equal(await runPreflight([t.req], io, { interactive: true, assumeYes: false, verbose: false }), false);
  assert.equal(t.runs(), 0);
  assert.ok(io.lines.includes("    install it by hand"));
});

test("warnings do not block the run", async () => {
  const io = fakeIO([false]);
  assert.equal(await runPreflight([fixable("warning").req], io, { interactive: true, assumeYes: false, verbose: false }), true);
  assert.equal(io.lines[0], "  ! tool missing");
});

test("non-interactive runs never prompt or install without --yes", async () => {
  const io = fakeIO([true]);
  const t = fixable("error");
  assert.equal(await runPreflight([t.req], io, { interactive: false, assumeYes: false, verbose: false }), false);
  assert.equal(t.runs(), 0);
  assert.equal(io.asked.length, 0);
  assert.match(io.lines.at(-1)!, /Run `loomdoc doctor` in a terminal/);
});

test("--yes installs without prompting, even without a terminal", async () => {
  const io = fakeIO();
  const t = fixable("error");
  assert.equal(await runPreflight([t.req], io, { interactive: false, assumeYes: true, verbose: false }), true);
  assert.equal(t.runs(), 1);
  assert.equal(io.asked.length, 0);
});

test("a failed fix is reported and still blocks", async () => {
  const io = fakeIO([true]);
  const t = fixable("error", { fixThrows: true, hint: "open a new terminal" });
  assert.equal(await runPreflight([t.req], io, { interactive: true, assumeYes: false, verbose: false }), false);
  assert.ok(io.lines.includes("    That didn't work: boom"));
  // The post-install hint only applies when the install itself succeeded.
  assert.ok(!io.lines.includes("    open a new terminal"));
});

test("a successful fix that still fails the re-check shows the after-fix hint", async () => {
  const io = fakeIO([true]);
  const t = fixable("error", { hint: "open a new terminal", staysBroken: true });
  assert.equal(await runPreflight([t.req], io, { interactive: true, assumeYes: false, verbose: false }), false);
  assert.equal(io.lines.at(-1), "    open a new terminal");
});

test("verbose lists passing requirements; quiet mode does not", async () => {
  const loud = fakeIO();
  await runPreflight([ok], loud, { interactive: false, assumeYes: false, verbose: true });
  assert.deepEqual(loud.lines, ["  ✓ ffmpeg 7"]);
  const quiet = fakeIO();
  await runPreflight([ok], quiet, { interactive: false, assumeYes: false, verbose: false });
  assert.deepEqual(quiet.lines, []);
});
