import { access, chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderFileTemplatePath } from "@tryopenbot/utilities";
import type { DeploymentContext } from "@tryopenbot/runtime-provider";
import type { CommandRunner } from "./command.js";

export interface LocalServiceOptions {
  id: string;
  description: string;
  command: readonly string[];
  environmentFile: string;
  platform: NodeJS.Platform;
  homeDirectory: string;
  uid?: number;
}

export type RetiredLocalServiceOptions = Pick<
  LocalServiceOptions,
  "id" | "platform" | "homeDirectory" | "uid"
>;

const systemdTemplate = fileURLToPath(
  new URL("./local/assets/openbot.service.hbs", import.meta.url),
);
const launchdTemplate = fileURLToPath(new URL("./local/assets/openbot.plist.hbs", import.meta.url));
const environmentTemplate = fileURLToPath(
  new URL("./local/assets/environment.hbs", import.meta.url),
);

export async function installLocalService(
  context: DeploymentContext,
  runner: CommandRunner,
  options: LocalServiceOptions,
): Promise<void> {
  const environmentFile = resolve(context.repositoryRoot, options.environmentFile);
  await atomicWrite(environmentFile, await renderEnvironment(context), 0o600);
  if (options.platform === "linux") {
    const unitPath = resolve(options.homeDirectory, `.config/systemd/user/${options.id}.service`);
    const unit = await renderFileTemplatePath(systemdTemplate, {
      DESCRIPTION: options.description,
      WORKING_DIRECTORY: systemdPath(context.repositoryRoot),
      DEPLOYMENT_ENVIRONMENT: quote(`DEPLOYMENT_ENV_FILE=${environmentFile}`),
      ENVIRONMENT_FILE: systemdPath(environmentFile),
      COMMAND: options.command.map(quote).join(" "),
    });
    await atomicWrite(unitPath, unit, 0o644);
    await runner.run("systemctl", ["--user", "daemon-reload"], {
      cwd: context.repositoryRoot,
      environment: context.environment,
    });
    await runner.run("systemctl", ["--user", "enable", `${options.id}.service`], {
      cwd: context.repositoryRoot,
      environment: context.environment,
    });
    await runner.run("systemctl", ["--user", "restart", `${options.id}.service`], {
      cwd: context.repositoryRoot,
      environment: context.environment,
    });
    return;
  }
  if (options.platform === "darwin") {
    if (options.uid === undefined) throw new Error("Unable to determine current uid for launchd");
    const label = `ai.openbot.${options.id}`;
    const plistPath = resolve(options.homeDirectory, `Library/LaunchAgents/${label}.plist`);
    const command = [
      options.command[0]!,
      `--env-file=${environmentFile}`,
      ...options.command.slice(1),
    ];
    const plist = await renderFileTemplatePath(launchdTemplate, {
      LABEL: xml(label),
      COMMAND: command.map((value) => `<string>${xml(value)}</string>`).join(""),
      WORKING_DIRECTORY: xml(context.repositoryRoot),
      ENVIRONMENT_FILE: xml(environmentFile),
    });
    await atomicWrite(plistPath, plist, 0o600);
    const domain = `gui/${options.uid}`;
    try {
      await runner.run("launchctl", ["bootout", domain, plistPath], {
        cwd: context.repositoryRoot,
        environment: context.environment,
      });
    } catch {
      /* first install */
    }
    await runner.run("launchctl", ["bootstrap", domain, plistPath], {
      cwd: context.repositoryRoot,
      environment: context.environment,
    });
    await runner.run("launchctl", ["kickstart", "-k", `${domain}/${label}`], {
      cwd: context.repositoryRoot,
      environment: context.environment,
    });
    return;
  }
  throw new Error(`Local service deployment does not support ${options.platform}`);
}

/** Stop a superseded user service and preserve its definition for manual recovery. */
export async function retireLocalService(
  context: DeploymentContext,
  runner: CommandRunner,
  options: RetiredLocalServiceOptions,
): Promise<void> {
  if (options.platform === "linux") {
    const unitPath = resolve(options.homeDirectory, `.config/systemd/user/${options.id}.service`);
    if (!(await exists(unitPath))) return;
    await runner.run("systemctl", ["--user", "disable", "--now", `${options.id}.service`], {
      cwd: context.repositoryRoot,
      environment: context.environment,
    });
    await rename(unitPath, await retiredPath(unitPath));
    await runner.run("systemctl", ["--user", "daemon-reload"], {
      cwd: context.repositoryRoot,
      environment: context.environment,
    });
    return;
  }
  if (options.platform === "darwin") {
    if (options.uid === undefined) throw new Error("Unable to determine current uid for launchd");
    const label = `ai.openbot.${options.id}`;
    const plistPath = resolve(options.homeDirectory, `Library/LaunchAgents/${label}.plist`);
    if (!(await exists(plistPath))) return;
    try {
      await runner.run("launchctl", ["bootout", `gui/${options.uid}`, plistPath], {
        cwd: context.repositoryRoot,
        environment: context.environment,
      });
    } catch {
      /* already unloaded */
    }
    await rename(plistPath, await retiredPath(plistPath));
    return;
  }
  throw new Error(`Local service retirement does not support ${options.platform}`);
}

export async function waitForHealth(request: typeof fetch, origin: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const response = await request(`${origin}/healthz`, { signal: AbortSignal.timeout(2_000) });
      if (!response.ok || ((await response.json()) as { ok?: unknown }).ok !== true)
        throw new Error(`Health smoke failed at ${origin}`);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 19) await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError;
}

async function renderEnvironment(context: DeploymentContext): Promise<string> {
  const values = new Map(
    Object.entries(context.environment).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  return renderFileTemplatePath(environmentTemplate, {
    entries: [...values]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, value]) => ({ name, value: JSON.stringify(value) })),
  });
}
async function atomicWrite(path: string, contents: string, mode: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, contents, { mode });
  await chmod(temporary, mode);
  await rename(temporary, path);
}
async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
async function retiredPath(path: string): Promise<string> {
  const stable = `${path}.retired`;
  if (!(await exists(stable))) return stable;
  return `${stable}.${Date.now()}`;
}
function quote(value: string): string {
  if (/[\n\r\0]/.test(value)) throw new Error("Service values must not contain control characters");
  return `"${value.replace(/%/g, "%%").replace(/([\\"])/g, "\\$1")}"`;
}
function systemdPath(value: string): string {
  if (!value.startsWith("/") || /[\n\r\0]/.test(value))
    throw new Error("Systemd service paths must be absolute and contain no control characters");
  return value
    .replace(/%/g, "%%")
    .replace(/\\/g, "\\x5c")
    .replace(/ /g, "\\x20")
    .replace(/\t/g, "\\x09");
}
function xml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
