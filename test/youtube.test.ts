import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chooseCaptionTrack,
  isYouTubeUrl,
  parseYouTubeUrl,
  type YouTubeMetadata,
} from "../src/core/ingest/youtube.js";
import { detectSource } from "../src/core/ingest/index.js";
import { parseYouTubeJson3 } from "../src/core/util/youtube-json3.js";
import { describeYtDlpFailure } from "../src/core/util/ytdlp.js";
import { LoomdocError } from "../src/core/util/errors.js";

const ID = "dQw4w9WgXcQ";

// --- URL parsing -------------------------------------------------------------------------

test("parses every common YouTube link form", () => {
  const forms = [
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&t=42s&list=PL123`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://music.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?si=abc&t=10`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/embed/${ID}?start=5`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
    `https://www.youtube.com/live/${ID}`,
    `www.youtube.com/watch?v=${ID}`,
    `  https://youtu.be/${ID}  `,
  ];
  for (const url of forms) assert.equal(parseYouTubeUrl(url), ID, url);
});

test("rejects YouTube URLs without a valid video id", () => {
  for (const url of [
    "https://www.youtube.com/",
    "https://www.youtube.com/@somechannel",
    "https://www.youtube.com/playlist?list=PL123",
    "https://www.youtube.com/watch?v=tooshort",
    "https://youtu.be/",
  ]) {
    assert.throws(() => parseYouTubeUrl(url), LoomdocError, url);
  }
});

test("isYouTubeUrl matches YouTube hosts only", () => {
  assert.equal(isYouTubeUrl(`https://youtu.be/${ID}`), true);
  assert.equal(isYouTubeUrl("https://www.youtube.com/"), true);
  assert.equal(isYouTubeUrl("https://notyoutube.com/watch?v=x"), false);
  assert.equal(isYouTubeUrl("https://youtube.com.evil.example/watch"), false);
  assert.equal(isYouTubeUrl("https://www.loom.com/share/abc"), false);
});

test("detectSource routes Loom and YouTube, and rejects anything else", () => {
  assert.equal(detectSource(`https://youtu.be/${ID}`), "youtube");
  assert.equal(detectSource("https://www.loom.com/share/abcdef0123456789abcdef0123456789"), "loom");
  assert.equal(detectSource("abcdef0123456789abcdef0123456789"), "loom");
  assert.throws(() => detectSource("https://vimeo.com/12345"), /Unsupported video URL/);
});

// --- caption selection -------------------------------------------------------------------

const json3 = [{ ext: "vtt" }, { ext: "json3" }];

test("prefers uploaded captions in the video's language", () => {
  const meta: YouTubeMetadata = {
    language: "de",
    subtitles: { en: json3, "de-DE": json3, live_chat: json3 },
    automatic_captions: { "de-orig": json3 },
  };
  assert.deepEqual(chooseCaptionTrack(meta), { lang: "de-DE", automatic: false });
});

test("falls back to English, then any uploaded track", () => {
  assert.deepEqual(
    chooseCaptionTrack({ language: "fr", subtitles: { es: json3, "en-US": json3 } }),
    { lang: "en-US", automatic: false },
  );
  assert.deepEqual(chooseCaptionTrack({ subtitles: { es: json3 } }), { lang: "es", automatic: false });
});

test("uses original-language auto captions, never a machine translation", () => {
  const auto = { "en-orig": json3, en: json3, fr: json3, de: json3 };
  assert.deepEqual(chooseCaptionTrack({ language: "en", automatic_captions: auto }), {
    lang: "en-orig",
    automatic: true,
  });
  // Unknown language: the -orig track is still the real speech recognition.
  assert.deepEqual(chooseCaptionTrack({ automatic_captions: { "ja-orig": json3, en: json3 } }), {
    lang: "ja-orig",
    automatic: true,
  });
  // Only translations available: nothing usable.
  assert.equal(chooseCaptionTrack({ automatic_captions: { fr: json3, de: json3 } }), null);
});

test("ignores live chat and tracks without json3", () => {
  assert.equal(
    chooseCaptionTrack({ subtitles: { live_chat: json3, en: [{ ext: "vtt" }] }, automatic_captions: {} }),
    null,
  );
  assert.equal(chooseCaptionTrack({}), null);
});

// --- json3 parsing -----------------------------------------------------------------------

test("parses json3 auto captions without rolling duplicates", () => {
  const body = JSON.stringify({
    wireMagic: "pb3",
    pens: [{}],
    events: [
      { tStartMs: 0, dDurationMs: 120000, id: 1, wpWinPosId: 1, wsWinStyleId: 1 },
      {
        tStartMs: 160,
        dDurationMs: 4000,
        wWinId: 1,
        segs: [{ utf8: "hi" }, { utf8: " everyone", tOffsetMs: 400 }],
      },
      { tStartMs: 2800, dDurationMs: 1360, wWinId: 1, aAppend: 1, segs: [{ utf8: "\n" }] },
      {
        tStartMs: 2810,
        dDurationMs: 3000,
        wWinId: 1,
        segs: [{ utf8: "and" }, { utf8: " welcome", tOffsetMs: 200 }],
      },
    ],
  });
  assert.deepEqual(parseYouTubeJson3(body), [
    { start: 0.16, end: 4.16, text: "hi everyone" },
    { start: 2.81, end: 5.81, text: "and welcome" },
  ]);
});

test("collapses line breaks inside uploaded caption events", () => {
  const body = JSON.stringify({
    events: [{ tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: "First line\nsecond  line" }] }],
  });
  assert.deepEqual(parseYouTubeJson3(body), [{ start: 1, end: 3, text: "First line second line" }]);
});

test("json3 parser returns [] for malformed input", () => {
  assert.deepEqual(parseYouTubeJson3("not json"), []);
  assert.deepEqual(parseYouTubeJson3("{}"), []);
  assert.deepEqual(parseYouTubeJson3("null"), []);
  assert.deepEqual(parseYouTubeJson3(JSON.stringify({ events: [null, { segs: [{ utf8: "no start" }] }] })), []);
});

// --- yt-dlp error mapping ----------------------------------------------------------------

test("maps yt-dlp failures to actionable hints", () => {
  const bot = describeYtDlpFailure(
    "WARNING: x\nERROR: [youtube] abc: Sign in to confirm you’re not a bot. Use --cookies\n",
    1,
  );
  assert.match(bot, /ERROR: \[youtube\] abc: Sign in/);
  assert.match(bot, /cookies-from-browser/);

  assert.match(describeYtDlpFailure("ERROR: [youtube] abc: Private video. Sign in", 1), /public and unlisted/);
  assert.match(describeYtDlpFailure("ERROR: unable to download: HTTP Error 403: Forbidden", 1), /loomdoc doctor/);
  assert.match(describeYtDlpFailure("something odd", 2), /exit code 2\): something odd$/);
});
