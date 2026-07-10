import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function commandExists(cmd: string, args: string[]): Promise<boolean> {
  try {
    await execFileAsync(cmd, args, { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

export async function detectAdbDevices(): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync("adb", ["devices"], { timeout: 3000 });
    return stdout
      .split("\n")
      .slice(1)
      .map((line) => line.trim())
      .filter((line) => line.endsWith("\tdevice"))
      .map((line) => line.split("\t")[0]);
  } catch {
    return [];
  }
}

export async function detectCapabilities() {
  const [adbDevices, hasAapt] = await Promise.all([
    detectAdbDevices(),
    commandExists("aapt2", ["version"]).then((ok) => ok || commandExists("aapt", ["version"])),
  ]);

  let playwright = false;
  try {
    // Resolving the package is enough to report the dependency is present;
    // actual browser-binary availability is only confirmed when a launch is attempted.
    require.resolve("playwright");
    playwright = true;
  } catch {
    playwright = false;
  }

  return {
    playwright,
    adb: adbDevices.length > 0,
    adbDevices,
    aapt: hasAapt,
  };
}
