// Test helper: creates a scratch dir, starts a tracked long-running child, prints both, waits.
import { spawn } from "node:child_process";
import { createScratchDir } from "../../src/core/util/scratch.js";
import { trackChild } from "../../src/core/util/children.js";

async function main(): Promise<void> {
  const scratch = await createScratchDir(process.argv[2]);
  const child = trackChild(spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" }));
  process.stdout.write(JSON.stringify({ path: scratch.path, childPid: child.pid }) + "\n");
  setInterval(() => {}, 1000);
}
void main();
