/** What went wrong, so a caller can branch without parsing the message. */
export const LOOMDOC_ERROR_CODES = [
  "INVALID_OPTIONS", // a caller passed a bad option (format, effort, layout, preset, guidance, url missing)
  "UNSUPPORTED_URL", // detectSource cannot match the URL, or the matched source finds no video id in it
  "SOURCE_UNAVAILABLE", // the video is private, deleted, live, or the source's API refused it
  "NO_TRANSCRIPT", // the video has no usable transcript
  "TOOL_MISSING", // ffmpeg, yt-dlp, or deno is not installed or cannot launch
  "TOOL_FAILED", // an external tool exited non-zero or produced unusable output
  "TOOL_STALLED", // the idle watchdog killed a tool
  "NETWORK", // a fetch failed or returned a bad status
  "MODEL_INCOMPLETE", // the model did not return a complete, valid document
  "SETUP_FAILED", // loomdoc doctor could not install or update a tool
  "REQUEST_TOO_LARGE", // the UI server got a request body over its size limit
] as const;
export type LoomdocErrorCode = (typeof LOOMDOC_ERROR_CODES)[number];

/** Thrown for problems a user can fix (bad URL, missing ffmpeg, etc.). The message says what to do next. */
export class LoomdocError extends Error {
  readonly code: LoomdocErrorCode;

  constructor(code: LoomdocErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LoomdocError";
    this.code = code;
  }
}
