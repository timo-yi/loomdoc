/** Thrown by scaffold stubs that are not implemented yet. */
export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`Not implemented yet: ${what}`);
    this.name = "NotImplementedError";
  }
}

/** Thrown when a run's inputs or environment are invalid (bad URL, missing ffmpeg, etc.). */
export class LoomdocError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoomdocError";
  }
}
