import { spawn } from "node:child_process";

/**
 * Hand a URL or folder to the OS (default browser / file manager). Best effort: failures are
 * ignored, because the CLI always prints the URL and the UI always shows the folder path.
 */
function launch(target: string): void {
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [target]]
      : process.platform === "win32"
        ? // Explorer opens folders, and hands URLs to the default browser, without cmd quoting pitfalls.
          ["explorer.exe", [target]]
        : ["xdg-open", [target]];
  try {
    const child = spawn(command, args as string[], { stdio: "ignore", detached: true, windowsHide: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    // Ignore: see above.
  }
}

export function openInBrowser(url: string): void {
  launch(url);
}

export function revealInFileManager(dir: string): void {
  launch(dir);
}
