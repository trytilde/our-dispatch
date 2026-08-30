// Runs desktop development tasks on a configured remote host over ssh.
import { spawn } from "node:child_process";
import arg from "arg";
import { loadHosts, resolveHost } from "../hosts.js";
import { repositoryRoot } from "../workspace.js";

const tasks: Record<string, string> = {
  desktop: "pnpm dev:desktop",
  "desktop-package": "pnpm desktop:package",
};

export async function runRemote(argv: readonly string[]): Promise<number> {
  const options = arg({}, { argv: [...argv], permissive: true });
  const [name, task = "desktop"] = options._;
  if (!name || !(task in tasks)) {
    console.error(
      `Usage: openbot remote <host> <${Object.keys(tasks).join("|")}>  (default: desktop)`,
    );
    return 1;
  }
  const host = resolveHost(name, loadHosts(repositoryRoot()));
  // Electron Builder targets the host platform, so a mac artifact needs a mac host.
  if (task === "desktop-package" && host.platform !== "mac")
    console.log(`note: ${name} is ${host.platform}; this produces ${host.platform} artifacts only`);
  const repositoryPath = host.path ?? "~/openbot";
  const command = `cd ${repositoryPath} && ${tasks[task]}`;
  console.log(`${host.ssh}: ${command}`);
  // -t keeps interactive desktop development attached to this terminal.
  const child = spawn("ssh", ["-t", host.ssh, command], { stdio: "inherit" });
  const code = await new Promise<number>((resolvePromise) => {
    child.on("exit", (exitCode, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      resolvePromise(exitCode ?? 0);
    });
  });
  if (code === 0 && task === "desktop") console.log(`next: openbot connect ${name}`);
  return code;
}
