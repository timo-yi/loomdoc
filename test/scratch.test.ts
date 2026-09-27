import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
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
