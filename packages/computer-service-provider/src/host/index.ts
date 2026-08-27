import { execFile } from "node:child_process";
import { access, lstat, mkdir, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { DeploymentContext, DeploymentResult } from "@tryopenbot/runtime-provider";
import { renderFileTemplatePath } from "@tryopenbot/utilities";
import {
  BaseComputerProvider,
  computerWorkspacePath,
  deterministicComputerId,
  scopeComputerExecRequest,
} from "../base/index.js";
import { materializeComputerImageContext } from "../base/assets.js";
import { computerServiceApiKey, scopedCapability } from "../capability.js";
import {
  ComputerProviderError,
  type ComputerCallContext,
  type ComputerExecRequest,
  type ComputerHandle,
  type ComputerSpec,
  type DeployDevelopmentSandboxRequest,
} from "../core/index.js";

const execute = promisify(execFile);
const serviceTemplate = fileURLToPath(
  new URL("./assets/openbot-computer.service.hbs", import.meta.url),
);

export interface HostComputerProviderOptions {
  homeDirectory?: string;
  runner?: HostComputerCommandRunner;
}

export interface HostComputerCommandRunner {
  run(
    command: string,
    args: readonly string[],
    options?: { cwd?: string; environment?: NodeJS.ProcessEnv; timeoutMs?: number },
  ): Promise<{ stdout: string; stderr: string }>;
}

/** The current Linux host is the Computer. There is deliberately no process isolation. */
export class HostComputerProvider extends BaseComputerProvider {
  protected readonly providerId = "host";
  protected readonly deployedImageEnvironmentVariable = "HOST_COMPUTER_SOURCE";
  override readonly buildable = {
    check: (context: DeploymentContext) => this.#check(context),
    build: (context: DeploymentContext) => this.#build(context),
    watchPaths: async (context: DeploymentContext) => [
      resolve(context.repositoryRoot, "apps/computer-service/src"),
      resolve(context.repositoryRoot, "packages/computer-service-provider/src/base/assets"),
    ],
  };
  override readonly deployable = {
    plan: async () => ({
      summary: "Install the OpenBot Computer directly on this Linux host",
      steps: [
        "Install desktop, browser, Cua, noVNC, and Computer service assets",
        "Create the shared /workspace directory",
        "Supervise computer-service and desktop gateways with a systemd user service",
      ],
    }),
    deploy: (context: DeploymentContext) => this.#deployHost(context),
  };
  readonly #homeDirectory: string;
  readonly #runner: HostComputerCommandRunner;
  #computerId: string | undefined;

  constructor(options: HostComputerProviderOptions = {}) {
    super({}, { publish: false });
    this.#homeDirectory = options.homeDirectory ?? homedir();
    this.#runner = options.runner ?? processHostComputerCommandRunner;
  }

  async #check(context: DeploymentContext): Promise<void> {
    if (process.platform !== "linux")
      throw new ComputerProviderError(
        "not_supported",
        "The host Computer provider requires Linux and systemd",
      );
    for (const command of ["sudo", "systemctl", "pnpm"])
      await this.#runner.run("bash", ["-lc", `command -v ${command}`], {
        cwd: context.repositoryRoot,
      });
  }

  async #build(context: DeploymentContext): Promise<DeploymentResult> {
    await this.#runner.run("pnpm", ["--filter", "@tryopenbot/computer-service", "build"], {
      cwd: context.repositoryRoot,
      environment: context.environment,
      timeoutMs: 10 * 60 * 1000,
    });
    const materialized = await materializeComputerImageContext(context.repositoryRoot, "host");
    return { outputs: { HOST_COMPUTER_CONTEXT: materialized.contextDirectory } };
  }

  async #deployHost(context: DeploymentContext): Promise<void> {
    const source = context.inputs.require("HOST_COMPUTER_CONTEXT");
    const assets = resolve(source, "packages/computer-service-provider/src/base/assets");
    const installScript = [
      "set -euo pipefail",
      `sudo bash ${shell(resolve(assets, "bootstrap.sh"))}`,
      "sudo install -d -m 0755 /opt/openbot /usr/local/bin /usr/share/novnc /usr/share/applications",
      `sudo install -m 0755 ${shell(resolve(assets, "desktop-session.sh"))} /opt/openbot/desktop-session.sh`,
      `sudo rsvg-convert --width 1440 --height 810 ${shell(resolve(assets, "desktop-wallpaper.svg"))} --output /opt/openbot/desktop-wallpaper.png`,
      `sudo install -m 0755 ${shell(resolve(assets, "development-profile.sh"))} /opt/openbot/development-profile.sh`,
      `sudo install -m 0755 ${shell(resolve(assets, "development-setup.sh"))} /usr/local/bin/setup-openbot-development`,
      `sudo install -m 0755 ${shell(resolve(assets, "openbot-browser.sh"))} /usr/local/bin/openbot-browser`,
      `sudo install -m 0644 ${shell(resolve(assets, "openbot-browser.desktop"))} /usr/share/applications/openbot-browser.desktop`,
      `sudo install -m 0644 ${shell(resolve(assets, "openbot-files.desktop"))} /usr/share/applications/openbot-files.desktop`,
      `sudo install -m 0755 ${shell(resolve(assets, "start.sh"))} /usr/local/bin/start-openbot-computer`,
      `sudo install -m 0644 ${shell(resolve(assets, "xfce4-panel.xml"))} /opt/openbot/xfce4-panel.xml`,
      `sudo install -m 0644 ${shell(resolve(assets, "openbot-vnc.html"))} /usr/share/novnc/openbot.html`,
      `sudo ln -sfn ${shell(resolve(context.repositoryRoot, "apps/computer-service"))} /opt/openbot/computer-service`,
      "sudo touch /opt/openbot/novnc.tokens /var/log/openbot-novnc.log /var/log/openbot-computer-service.log /var/log/openbot-computer.log",
      `sudo chown ${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000} /opt/openbot/novnc.tokens /var/log/openbot-novnc.log /var/log/openbot-computer-service.log /var/log/openbot-computer.log`,
      "sudo install -d -m 0755 /workspace",
      `sudo chown ${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000} /workspace`,
    ].join("\n");
    await this.#runner.run("bash", ["-lc", installScript], {
      cwd: context.repositoryRoot,
      environment: context.environment,
      timeoutMs: 20 * 60 * 1000,
    });
    if (await exists(this.#environmentFile()))
      await this.#runner.run("systemctl", ["--user", "restart", "openbot-computer.service"], {
        environment: context.environment,
      });
  }

  async create(spec: ComputerSpec, context: ComputerCallContext): Promise<ComputerHandle> {
    const id = deterministicComputerId("openbot", spec.id);
    if (this.#computerId && this.#computerId !== id)
      throw new ComputerProviderError(
        "invalid_configuration",
        `Host Computer ${this.#computerId} already owns this machine`,
      );
    this.#computerId = id;
    await this.#installService(id, spec, context);
    return this.#handle(id, "running");
  }

  async get(id: string, context: ComputerCallContext): Promise<ComputerHandle> {
    const expected = deterministicComputerId("openbot", id);
    if (this.#computerId && expected !== this.#computerId)
      throw new ComputerProviderError("not_found", `Host Computer ${id} was not found`);
    try {
      await access(this.#environmentFile());
    } catch {
      throw new ComputerProviderError("not_found", `Host Computer ${id} was not found`);
    }
    const result = await this.#runner
      .run("systemctl", ["--user", "is-active", "openbot-computer.service"], {
        environment: context.environment,
      })
      .catch(() => ({ stdout: "inactive", stderr: "" }));
    this.#computerId = expected;
    return this.#handle(expected, result.stdout.trim() === "active" ? "running" : "sleeping");
  }

  async wake(id: string, context: ComputerCallContext): Promise<ComputerHandle> {
    const current = await this.get(id, context);
    await this.#restart(context);
    return { ...current, state: "running" };
  }

  async sleep(id: string, context: ComputerCallContext): Promise<ComputerHandle> {
    const current = await this.get(id, context);
    await this.#runner.run("systemctl", ["--user", "stop", "openbot-computer.service"], {
      environment: context.environment,
    });
    return { ...current, state: "sleeping" };
  }

  async delete(id: string, context: ComputerCallContext): Promise<void> {
    await this.get(id, context);
    await this.#runner
      .run("systemctl", ["--user", "disable", "--now", "openbot-computer.service"], {
        environment: context.environment,
      })
      .catch(() => undefined);
    await rm(this.#environmentFile(), { force: true });
    this.#computerId = undefined;
  }

  async exec(id: string, request: ComputerExecRequest, context: ComputerCallContext) {
    await this.get(id, context);
    const scoped = scopeComputerExecRequest(request, context.agentId);
    try {
      const result = await this.#runner.run(scoped.command, scoped.args ?? [], {
        cwd: scoped.cwd,
        environment: { ...process.env, ...scoped.environment },
        timeoutMs: scoped.timeoutMs,
      });
      return { exitCode: 0, ...result };
    } catch (error) {
      const failure = error as { code?: unknown; stdout?: unknown; stderr?: unknown };
      return {
        exitCode: typeof failure.code === "number" ? failure.code : 1,
        stdout: typeof failure.stdout === "string" ? failure.stdout : "",
        stderr:
          typeof failure.stderr === "string"
            ? failure.stderr
            : error instanceof Error
              ? error.message
              : String(error),
      };
    }
  }

  async readFile(id: string, path: string, context: ComputerCallContext): Promise<Uint8Array> {
    await this.get(id, context);
    return new Uint8Array(await readFile(computerWorkspacePath(path, context.agentId)));
  }

  async writeFile(
    id: string,
    path: string,
    content: Uint8Array,
    context: ComputerCallContext,
  ): Promise<void> {
    await this.get(id, context);
    const destination = computerWorkspacePath(path, context.agentId);
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    await writeFile(destination, content);
  }

  async vnc(id: string, context: ComputerCallContext) {
    await this.get(id, context);
    const url = new URL("http://127.0.0.1:6080/openbot.html");
    url.searchParams.set(
      "path",
      `websockify?token=${scopedCapability("vnc", id, context.agentId)}`,
    );
    url.searchParams.set("scale", "true");
    return { url, expiresAt: new Date(Date.now() + 86_400_000) };
  }

  override async deployDevelopmentSandbox(
    request: DeployDevelopmentSandboxRequest,
    context: DeploymentContext,
  ) {
    const sourceLink = "/workspace/openbot";
    await mkdir("/workspace", { recursive: true, mode: 0o755 });
    const metadata = await lstat(sourceLink).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (!metadata) await symlink(context.repositoryRoot, sourceLink, "dir");
    else if (!metadata.isSymbolicLink() || (await readlink(sourceLink)) !== context.repositoryRoot)
      throw new ComputerProviderError(
        "invalid_configuration",
        `${sourceLink} must be a symlink to the live host checkout ${context.repositoryRoot}`,
      );
    return super.deployDevelopmentSandbox(request, context);
  }

  protected async computerServiceUrl(_computerId: string): Promise<string> {
    return "http://127.0.0.1:4101/rpc";
  }

  protected override async reviveComputerServices(
    _id: string,
    context: ComputerCallContext,
  ): Promise<void> {
    await this.#restart(context);
  }

  async #installService(
    id: string,
    spec: ComputerSpec,
    context: ComputerCallContext,
  ): Promise<void> {
    const environmentFile = this.#environmentFile();
    const unitFile = resolve(this.#homeDirectory, ".config/systemd/user/openbot-computer.service");
    await mkdir(dirname(environmentFile), { recursive: true, mode: 0o700 });
    await mkdir(dirname(unitFile), { recursive: true, mode: 0o700 });
    await writeFile(
      environmentFile,
      hostEnvironmentFile({
        DISPLAY: ":1",
        COMPUTER_SERVICE_API_KEY: computerServiceApiKey(
          context.environment?.COMPUTER_SERVICE_API_KEY,
        ),
        COMPUTER_ID: id,
        COMPUTER_SERVICE_PORT: "4101",
        COMPUTER_WORKSPACE: "/workspace",
        OPENBOT_HOST_COMPUTER: "1",
        ...spec.environment,
      }),
      { mode: 0o600 },
    );
    await writeFile(
      unitFile,
      await renderFileTemplatePath(serviceTemplate, {
        ENVIRONMENT_FILE: systemdPath(environmentFile),
      }),
      { mode: 0o644 },
    );
    await this.#runner.run("systemctl", ["--user", "daemon-reload"]);
    await this.#runner.run("systemctl", ["--user", "enable", "openbot-computer.service"]);
    await this.#restart(context);
  }

  async #restart(context: ComputerCallContext): Promise<void> {
    await this.#runner.run("systemctl", ["--user", "restart", "openbot-computer.service"], {
      environment: context.environment,
    });
  }

  #environmentFile(): string {
    return resolve(this.#homeDirectory, ".openbot/computer/environment");
  }

  #handle(id: string, state: "running" | "sleeping"): ComputerHandle {
    return { id, providerId: this.providerId, state, createdAt: new Date() };
  }
}

export const processHostComputerCommandRunner: HostComputerCommandRunner = {
  async run(command, args, options = {}) {
    const result = await execute(command, [...args], {
      cwd: options.cwd,
      env: options.environment,
      encoding: "utf8",
      timeout: options.timeoutMs,
    });
    return { stdout: result.stdout, stderr: result.stderr };
  },
};

function hostEnvironmentFile(environment: Readonly<Record<string, string>>): string {
  return `${Object.entries(environment)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
    .join("\n")}\n`;
}

function shell(value: string): string {
  if (/\0/.test(value)) throw new Error("Shell values must not contain NUL bytes");
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function systemdPath(value: string): string {
  if (!value.startsWith("/") || /[\r\n\0]/.test(value))
    throw new Error("Systemd paths must be absolute and contain no control characters");
  return value.replace(/%/g, "%%").replace(/ /g, "\\x20");
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
