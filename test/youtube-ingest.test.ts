import { test } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fetchYouTubeVideo } from "../src/core/ingest/youtube.js";
import { configArgs } from "../src/core/util/ytdlp.js";

/**
 * A stand-in yt-dlp on PATH that answers the two calls loomdoc makes (metadata, then download)
 * and records its arguments, so the real invocation and output parsing are exercised without
 * reaching YouTube.
 */
const FAKE_YTDLP = `#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_YTDLP_LOG, JSON.stringify(args) + "\\n");
if (args.includes("-J")) {
  process.stdout.write(JSON.stringify({
    id: "dQw4w9WgXcQ", title: "Fake walkthrough", duration: 42, language: "en",
    subtitles: {}, automatic_captions: { "en-orig": [{ ext: "json3" }], fr: [{ ext: "json3" }] },
  }));
  process.exit(0);
}
const outputs = args.flatMap((a, i) => (a === "-o" ? [args[i + 1]] : []));
const video = outputs.find((o) => !o.startsWith("subtitle:")).replace("%(ext)s", "mp4");
const captions = outputs.find((o) => o.startsWith("subtitle:")).slice("subtitle:".length).replace("%(ext)s", "en-orig.json3");
fs.writeFileSync(video, "fake video bytes");
fs.writeFileSync(captions, JSON.stringify({ events: [{ tStartMs: 500, dDurationMs: 1500, segs: [{ utf8: "hello there" }] }] }));
process.stdout.write(video + "\\n");
`;

test("fetchYouTubeVideo drives yt-dlp as intended and parses its output", { skip: process.platform === "win32" }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "loomdoc-ytfake-"));
  const bin = join(dir, "bin");
  const scratch = join(dir, "scratch");
  const log = join(dir, "args.log");
  const saved = { PATH: process.env["PATH"], LOG: process.env["FAKE_YTDLP_LOG"], HOME: process.env["LOOMDOC_HOME"] };
  try {
    await mkdir(bin);
    await mkdir(scratch);
    await writeFile(join(bin, "yt-dlp"), FAKE_YTDLP);
    await chmod(join(bin, "yt-dlp"), 0o755);
    process.env["PATH"] = `${bin}${delimiter}${saved.PATH}`;
    process.env["FAKE_YTDLP_LOG"] = log;
    process.env["LOOMDOC_HOME"] = join(dir, "home"); // no managed tools, no loomdoc yt-dlp config

    const video = await fetchYouTubeVideo("https://youtu.be/dQw4w9WgXcQ?t=5", scratch);
    assert.equal(video.source, "youtube");
    assert.equal(video.title, "Fake walkthrough");
    assert.equal(video.durationSeconds, 42);
    assert.equal(video.videoPath, join(scratch, "video.mp4"));
    assert.deepEqual(video.transcript, [{ start: 0.5, end: 2, text: "hello there" }]);

    const calls = (await readFile(log, "utf8")).trim().split("\n").map((l) => JSON.parse(l) as string[]);
    assert.equal(calls.length, 2);
    for (const call of calls) {
      assert.ok(call.includes("--ignore-config"), "user yt-dlp config must be ignored");
      assert.ok(call.includes("--no-download-archive"));
      assert.equal(call.at(-1), "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "canonical URL, no playlist/time params");
    }
    const download = calls[1]!;
    assert.equal(download[download.indexOf("-f") + 1], "bv/b");
    assert.equal(download[download.indexOf("--sub-langs") + 1], "en-orig");
    assert.ok(download.includes("--write-auto-subs"));
    assert.ok(!download.includes("--write-subs"));
  } finally {
    process.env["PATH"] = saved.PATH;
    if (saved.LOG === undefined) delete process.env["FAKE_YTDLP_LOG"];
    else process.env["FAKE_YTDLP_LOG"] = saved.LOG;
    if (saved.HOME === undefined) delete process.env["LOOMDOC_HOME"];
    else process.env["LOOMDOC_HOME"] = saved.HOME;
    await rm(dir, { recursive: true, force: true });
  }
});

test("configArgs ignores the user's yt-dlp config and adds loomdoc's own only if present", async () => {
  const dir = await mkdtemp(join(tmpdir(), "loomdoc-ytconf-"));
  try {
    const conf = join(dir, "yt-dlp.conf");
    assert.deepEqual(configArgs(conf), ["--ignore-config", "--no-download-archive"]);
    await writeFile(conf, "--cookies-from-browser firefox\n");
    assert.deepEqual(configArgs(conf), ["--ignore-config", "--config-locations", conf, "--no-download-archive"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
