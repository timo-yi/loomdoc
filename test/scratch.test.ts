import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createScratchDir, STALE_AFTER_MS, sweepStaleScratchDirs } from "../src/core/util/scratch.js";

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

test("dispose removes the scratch dir and its contents, and detaches signal handlers", async () => {
  const base = await mkdtemp(join(tmpdir(), "scratch-test-"));
  try {
    const before = process.listenerCount("SIGINT");
    const scratch = await createScratchDir(base);
    assert.ok(basename(scratch.path).startsWith("loomdoc-"));
    assert.equal(process.listenerCount("SIGINT"), before + 1);

    await mkdir(join(scratch.path, "frames"));
    await writeFile(join(scratch.path, "frames", "frame-000001.jpg"), "x");
    await writeFile(join(scratch.path, "video.mkv"), "x");

    await scratch.dispose();
    assert.equal(await exists(scratch.path), false);
    assert.equal(process.listenerCount("SIGINT"), before);
    await scratch.dispose(); // idempotent
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("sweep removes only stale loomdoc scratch dirs", async () => {
  const base = await mkdtemp(join(tmpdir(), "scratch-test-"));
  try {
    const stale = join(base, "loomdoc-stale");
    const fresh = join(base, "loomdoc-fresh");
    const unrelated = join(base, "someone-else");
    for (const dir of [stale, fresh, unrelated]) {
      await mkdir(dir);
      await writeFile(join(dir, "f"), "x");
    }
    const old = new Date(Date.now() - STALE_AFTER_MS - 60_000);
    await utimes(stale, old, old);
    await utimes(unrelated, old, old);

    await sweepStaleScratchDirs(base);
    assert.equal(await exists(stale), false);
    assert.equal(await exists(fresh), true);
    assert.equal(await exists(unrelated), true);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("sweep tolerates a missing base dir", async () => {
  await sweepStaleScratchDirs(join(tmpdir(), "does-not-exist-loomdoc-test"));
});

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  // An exited child reparented to an init that reaps lazily lingers as a zombie ("Z").
  try {
    return !/^\d+ \(.*\) Z/.test(readFileSync(`/proc/${pid}/stat`, "utf8"));
  } catch {
    return true;
  }
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  test(`${signal} removes the scratch dir and stops tracked children`, { skip: process.platform === "win32" }, async () => {
    const base = await mkdtemp(join(tmpdir(), "scratch-sig-"));
    try {
      const proc = spawn(process.execPath, ["--import", "tsx", join("test", "fixtures", "scratch-child.ts"), base], {
        stdio: ["ignore", "pipe", "inherit"],
      });
      const info = await new Promise<{ path: string; childPid: number }>((resolve, reject) => {
        let out = "";
        proc.stdout!.on("data", (c) => {
          out += c;
          if (out.includes("\n")) resolve(JSON.parse(out));
        });
        proc.on("exit", () => reject(new Error("helper exited early")));
      });
      assert.equal(await exists(info.path), true);
      assert.equal(alive(info.childPid), true);

      const exited = new Promise<NodeJS.Signals | null>((resolve) => proc.on("exit", (_code, sig) => resolve(sig)));
      proc.kill(signal);
      assert.equal(await exited, signal, "the process still terminates by the original signal");
      assert.equal(await exists(info.path), false);
      for (let i = 0; i < 150 && alive(info.childPid); i++) await new Promise((r) => setTimeout(r, 20));
      assert.equal(alive(info.childPid), false, "tracked child was stopped");
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
}
