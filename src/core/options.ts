import { OUTPUT_FORMATS, type OutputFormat, isOutputFormat } from "./types.js";
import { LoomdocError } from "./util/errors.js";

/**
 * The one check for a list of output formats, shared by runLoomdoc (library wording) and the
 * CLI's --formats parser (flag wording): it must be a non-empty list of known formats (renderAll
 * runs after the model call, so an unknown format must fail before any spend), and
 * duplicates are dropped so the same file is never rendered twice. `label` names the input in
 * error messages ("formats" or "--formats").
 *
 * Not re-exported from the package (src/index.ts): library callers pass options to runLoomdoc,
 * which runs this itself.
 */
export function checkOutputFormats(formats: unknown, label: string): OutputFormat[] {
  const choices = OUTPUT_FORMATS.join(", ");
  // A JavaScript caller can pass anything; "pdf" instead of ["pdf"] must not surface as a TypeError.
  if (!Array.isArray(formats)) {
    throw new LoomdocError("INVALID_OPTIONS", `${label} must be a list of: ${choices}.`);
  }
  if (formats.length === 0) {
    throw new LoomdocError("INVALID_OPTIONS", `${label} needs at least one of: ${choices}.`);
  }
  const unknown = [
    ...new Set(formats.filter((f) => typeof f !== "string" || !isOutputFormat(f)).map(String)),
  ];
  if (unknown.length > 0) {
    throw new LoomdocError("INVALID_OPTIONS", `Unknown ${label} "${unknown.join(", ")}". Choose from: ${choices}.`);
  }
  return [...new Set(formats as OutputFormat[])];
}
