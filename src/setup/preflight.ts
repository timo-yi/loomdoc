import { createInterface } from "node:readline/promises";
import type { Requirement } from "./checks.js";

/**
 * Launch-time checks with consent-gated fixes (PRD decision D15).
 *
 * For each requirement that fails, explain the problem and, if loomdoc can fix it, ask
 * before doing anything. Declining is always safe: loomdoc prints how to fix it by hand.
 * With no interactive terminal (scripts, CI) nothing is ever installed unless `assumeYes`.
 * Errors block the run; warnings (e.g. an old yt-dlp) are reported and the run continues.
 */

export interface PreflightIO {
  write(line: string): void;
  confirm(question: string): Promise<boolean>;
}

export interface PreflightOptions {
  /** A person is at the terminal and can answer prompts. */
  interactive: boolean;
  /** Treat every consent prompt as answered "yes" (the --yes flag). */
  assumeYes: boolean;
  /** Also list requirements that pass (used by `loomdoc doctor`). */
  verbose: boolean;
}

/** Returns true when nothing blocking remains. */
export async function runPreflight(
  requirements: Requirement[],
  io: PreflightIO,
  options: PreflightOptions,
): Promise<boolean> {
  let ready = true;

  for (const requirement of requirements) {
    let result = await requirement.check();
    if (result.ok) {
      if (options.verbose) io.write(`  ✓ ${result.summary}`);
      continue;
    }

    const { finding } = result;
    io.write(`  ${finding.severity === "error" ? "✗" : "!"} ${finding.title}`);

    let fixRan = false;
    if (finding.fix) {
      const consent =
        options.assumeYes || (options.interactive && (await io.confirm(`    ${finding.fix.prompt}`)));
      if (consent) {
        try {
          await finding.fix.run((line) => io.write(`    ${line}`));
          fixRan = true;
          result = await requirement.check();
        } catch (err) {
          io.write(`    That didn't work: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    if (result.ok) {
      io.write(`  ✓ ${result.summary}`);
      continue;
    }
    if (fixRan && finding.fix?.afterFixHint) {
      io.write(`    ${finding.fix.afterFixHint}`);
    } else if (finding.fix && !options.interactive && !options.assumeYes) {
      io.write(`    Run \`loomdoc doctor\` in a terminal to fix this, or: ${finding.manual}`);
    } else {
      io.write(`    ${finding.manual}`);
    }
    if (result.finding.severity === "error") ready = false;
  }

  return ready;
}

/** Terminal IO: prompts default to "no" so pressing Enter never installs anything. */
export function terminalIO(): PreflightIO {
  return {
    write: (line) => process.stderr.write(`${line}\n`),
    confirm: async (question) => {
      const rl = createInterface({ input: process.stdin, output: process.stderr });
      try {
        const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
        return answer === "y" || answer === "yes";
      } catch {
        process.stderr.write("\n");
        return false; // Ctrl-D / closed input counts as "no"
      } finally {
        rl.close();
      }
    },
  };
}

export function isInteractiveTerminal(): boolean {
  return Boolean(process.stdin.isTTY && process.stderr.isTTY);
}
