# Contributing to loomdoc

This guide covers how to set up the repo, run the checks CI runs, and make the common kinds of change: a new video source, output format, document style, or option. For what loomdoc does and how to use it, read the [README](README.md). For why it is built this way, read the decisions in [docs/PRD.md](docs/PRD.md).

## Set up the repo

You need Node and `ffmpeg` on your `PATH`. CI uses Node 22, and `package.json` allows Node 18 and newer. Several tests run the real `ffmpeg`.

```bash
npm install
npm run typecheck
npm test
```

Both checks must pass before you open a pull request. CI runs the same two commands on Ubuntu with Node 22. The test run takes about 10 seconds. A few tests skip themselves when an optional tool is missing (`pdftotext`) or on a platform they do not support. The skip reason is in the test output.

To run your working copy as a user would, use `npm run dev -- <url> [options]` or `npm run dev -- ui`. A real generation run calls Anthropic and costs money, so you need `ANTHROPIC_API_KEY` set. No test makes that call.

## Know where things live

`runLoomdoc` in `src/core/pipeline.ts` runs one document from start to finish. Each stage hands a typed object to the next:

1. **Ingest** (`src/core/ingest/`) turns a URL into a `SourceVideo`: the downloaded video track plus a timestamped transcript.
2. **Frames** (`src/core/frames/`) samples screenshots with `ffmpeg` and keeps the distinct ones.
3. **Generate** (`src/core/generate/`) sends the transcript and screenshots to the model and gets back a `LoomDocOutput` that matches `loomDocSchema`.
4. **Render** (`src/core/render/`) writes the `LoomDoc` as Markdown, Word, or PDF.

The rest of `src/`:

- `src/index.ts` is the public library API. Everything it exports is a public contract.
- `src/core/types.ts` holds the shared types, the option lists (`OUTPUT_FORMATS`, `PDF_LAYOUTS`, `EFFORT_LEVELS`), and the defaults.
- `src/core/util/` holds the child-process wrappers (`run-tool.ts`, `ffmpeg.ts`, `ytdlp.ts`), the scratch directory, and the transcript parsers.
- `src/cli.ts` and `src/cli-flags.ts` are the command line.
- `src/ui/server.ts` is the `loomdoc ui` HTTP server. `src/ui/page.ts` holds the page's HTML, CSS, and client JavaScript as strings. `src/ui/options.ts` holds the UI's labels for the core option lists and the form's length limits.
- `src/setup/` checks for and installs `ffmpeg`, `yt-dlp`, and Deno.

## Follow the rules that keep the core safe

- **Validate in the core, not only at the edges.** `runLoomdoc` is public API, so it checks its own options before any download or model call. The CLI and the UI also check their input first, with their own wording. Library error messages never name a CLI flag such as `--effort`.
- **Key extension tables by their union type.** Sources (`SOURCES` in `src/core/ingest/index.ts`), renderers (`RENDERERS` in `src/core/render/index.ts`), and presets (`STYLE_PRESETS`) are `Record` tables. Then the compiler rejects a new union member that has no entry. Do not replace one with a `switch` or an `if` chain.
- **Start child processes through the wrappers.** Use `runFfmpeg`, `runYtDlp`, or `runTool`. They track the process so a Ctrl-C stops it, and they bound its output. A process that you `spawn` directly is not stopped when the run is cancelled.
- **Throw `LoomdocError` for problems a user can fix**, with a code from `LOOMDOC_ERROR_CODES` in `src/core/util/errors.ts` and a message that says what to do next. Library callers branch on the code, so pick the closest one, or add a code if none fits. When you wrap a caught error, pass it as `cause`.
- **Do not add an `await` to the UI's run-slot path** between the `slotTaken` check and `slotTaken = true` in the `POST /api/runs` handler. That gap lets two paid runs start at once. If you change that handler, run the `verify-ui-run-slot` check described in `.claude/skills/verify-ui-run-slot/SKILL.md`.
- **Treat the client JavaScript in `src/ui/page.ts` as plain ES5 inside a template string.** The compiler does not check it. Write every regex backslash twice (`\\/`), and never write `${` in it. The page gets server data only from `/api/config`.

## Add a video source

1. Create `src/core/ingest/<source>.ts` with a fetch function that returns a `SourceVideo`. Download the video track into the `scratchDir` you are given, and throw `LoomdocError("NO_TRANSCRIPT", ...)` if the video has no transcript. Use `loom.ts` and `youtube.ts` as models.
2. Add the source's name to `VideoSource` in `src/core/ingest/types.ts`. `VideoSource` is public API.
3. Add an entry to `SOURCES` in `src/core/ingest/index.ts` with a `matches` function and the fetch function. `npm run typecheck` fails until you do. Update the "Unsupported video URL" message in the same file.
4. If the source needs an external tool, add it to `requirementsFor` in `src/setup/checks.ts`. Today that function only knows `{ youtube: boolean }`, and `src/cli.ts` checks `detectSource(url) === "youtube"` in several places, so a new tool means changing both.
5. Update the URL check in `validate()` in `src/ui/page.ts`, the help text in `src/cli.ts`, and the README.
6. Add tests that do not use the network. `test/youtube-ingest.test.ts` shows how to put a fake tool on `PATH`.

## Add an output format

1. Add the format's name to `OUTPUT_FORMATS` in `src/core/types.ts`. `DEFAULT_FORMATS` copies that list, so the new format is on by default for every run.
2. Create `src/core/render/<format>.ts` with a function that writes the `LoomDoc` into `outputDir` and returns the file's path.
3. Add an entry to `RENDERERS` in `src/core/render/index.ts`. `npm run typecheck` fails until you do.
4. Add an entry to `FORMAT_DISPLAY` in `src/ui/options.ts` with the label, file extension, and content type. `npm run typecheck` fails until you do. The UI builds its checkbox, its file label, and the type it serves the file with from this entry. If the format can run script in a browser (HTML, SVG), decide how to serve it safely first, because the UI serves output files from its own origin.
5. Update the `--formats` help text in `src/cli.ts` and the README.
6. Add tests to `test/render.test.ts` that write a real file and check its content. Some tests match the list "markdown, docx, pdf", so update them too.

## Add a document style

1. Add the preset's id to `STYLE_PRESET_IDS` in `src/core/generate/styles.ts`.
2. Add its entry to `STYLE_PRESETS` in the same file. `npm run typecheck` fails until you do. Set `diataxis` only for a Diátaxis technical-writing mode, and add the mode to `DIATAXIS_MODES` too. Set `requiresGuidance` if the preset is empty without the user's guidance.

The CLI help, the CLI and UI checks, and the UI's style picker all read the registry, so you do not need to change them. `test/generate.test.ts` checks that every preset produces a different prompt and that only the Diátaxis presets get `TECHNICAL_WRITING_RULES`.

If you remove or rename a preset, users can still have the old id in scripts and in the UI's saved preferences. Add a message that names the replacement in `src/cli.ts`, as was done for `training` and `support-article`.

## Add an option

An option has to reach the core from both the CLI and the UI. The compiler does not catch a missed step, so work through all of them:

1. Add the field to `LoomdocOptions` or `DocContext` in `src/core/types.ts`. For a fixed set of values, also add an `as const` list, its type, an `isX` guard, and a default, the way `EFFORT_LEVELS` does.
2. Check the value in `validateOptions` in `src/core/pipeline.ts`, and use it.
3. CLI: add a parser to `src/cli-flags.ts`. In `src/cli.ts`, add the `parseArgs` entry, the help text, the parser call, and the field in the `runLoomdoc` call.
4. UI server: add the field to `runRequestSchema` in `src/ui/server.ts` and map it in `execute()`. The schema silently drops a field it does not list.
5. UI page: in `src/ui/page.ts`, add the control, read it in `collect()`, and save and restore it with the other preferences. A new value in an existing list (`PDF_LAYOUTS`, `EFFORT_LEVELS`) needs no page change, only its label in `src/ui/options.ts`. The page renders those lists from `/api/config`.
6. Add tests to `test/cli-flags.test.ts`, `test/library-validation.test.ts`, and `test/ui-server.test.ts`. Update the README.

## Write tests that check behavior

- Test what a caller can observe: a return value, a written file, an HTTP status and body. Do not test private helpers.
- Never call the network or the model. Fake external tools instead: a fake binary on `PATH` (`test/youtube-ingest.test.ts`), or the `run` and `checkRequirements` options of `startUiServer` (`test/ui-server.test.ts`).
- You can use the real `ffmpeg`, because CI installs it.
- If a test needs an optional tool or a specific platform, skip it with a reason rather than letting it fail.
- Test files are typechecked, so a type error in a test fails CI.

## Open a pull request

- Keep each commit to one change, with an imperative subject ("Validate the preset in runLoomdoc"). In the body, say why the change is needed.
- Say in the description how you checked the change, beyond the unit tests. For changes a user can see, `.claude/skills/verify-loomdoc/` has scripts that drive the CLI and the UI without spending money.
- If the change alters a design decision, update the matching entry in `docs/PRD.md`.
