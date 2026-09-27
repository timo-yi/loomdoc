import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loomdocHome, managedToolPath, toolCommand } from "../src/core/util/tools.js";

test("managed tools live under LOOMDOC_HOME and take precedence once installed", async () => {
  const home = await mkdtemp(join(tmpdir(), "loomdoc-home-test-"));
  const previous = process.env["LOOMDOC_HOME"];
  process.env["LOOMDOC_HOME"] = home;
  try {
    assert.equal(loomdocHome(), home);
    assert.equal(toolCommand("yt-dlp"), "yt-dlp"); // not installed: PATH lookup
    await mkdir(join(home, "bin"));
    await writeFile(managedToolPath("yt-dlp"), "");
    assert.equal(toolCommand("yt-dlp"), managedToolPath("yt-dlp"));
    assert.ok(managedToolPath("yt-dlp").startsWith(join(home, "bin")));
  } finally {
    if (previous === undefined) delete process.env["LOOMDOC_HOME"];
    else process.env["LOOMDOC_HOME"] = previous;
    await rm(home, { recursive: true, force: true });
  }
});
