import { execFile, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  ExeDevPlatform,
  exeDevPlatform,
  type ExeDevConnection,
} from "@tryopenbot/platform-integrations";
import type {
  DeploymentContext,
  DeploymentPlan,
  DeploymentResult,
} from "@tryopenbot/runtime-provider";
import { isDevelopmentLifecycle, persistEnvironment } from "@tryopenbot/runtime-provider";
import { renderFileTemplatePath } from "@tryopenbot/utilities";

const execFileAsync = promisify(execFile);
const serviceTemplate = fileURLToPath(
  new URL("./exe-dev/assets/openbot-dev.service.hbs", import.meta.url),
);
const reconcileTemplate = fileURLToPath(
  new URL("./exe-dev/assets/reconcile.sh.hbs", import.meta.url),
);

export interface ExeDevCommandOptions {
  cwd?: string;
  environment?: NodeJS.ProcessEnv;
  input?: string;
  signal?: AbortSignal;
}

export interface ExeDevCommandRunner {
  run(command: string, args: readonly string[], options?: ExeDevCommandOptions): Promise<string>;
}

export interface ExeDevRuntimeServiceProviderOptions {
  platform?: ExeDevPlatform;
  runner?: ExeDevCommandRunner;
  request?: typeof fetch;
  currentBranch?: (repositoryRoot: string) => Promise<string>;
}

/** One persistent exe.dev VM running the complete watched OpenBot development process. */
export class ExeDevRuntimeServiceProvider {
  readonly platform: ExeDevPlatform;
  readonly platforms: readonly ExeDevPlatform[];
  readonly buildable = {
    check: (context: DeploymentContext) => this.#check(context),
    build: (_context: DeploymentContext): Promise<void> => Promise.resolve(),
  };
  readonly deployable = {
    plan: (context: DeploymentContext) => this.#plan(context),
    configure: (context: DeploymentContext) => this.#configure(context),
    deploy: (context: DeploymentContext) => this.#deploy(context),
  };
  readonly #runner: ExeDevCommandRunner;
  readonly #request: typeof fetch;
  readonly #currentBranch: (repositoryRoot: string) => Promise<string>;

  constructor(options: ExeDevRuntimeServiceProviderOptions = {}) {
    this.platform = options.platform ?? exeDevPlatform;
    this.platforms = [this.platform];
    this.#runner = options.runner ?? processExeDevCommandRunner;
    this.#request = options.request ?? fetch;
    this.#currentBranch = options.currentBranch ?? currentBranch;
  }

  check(context: DeploymentContext): Promise<void> {
    return this.#check(context);
  }

  build(_context: DeploymentContext): Promise<void> {
    return Promise.resolve();
  }

  plan(context: DeploymentContext): Promise<DeploymentPlan> {
    return this.#plan(context);
  }

  configure(context: DeploymentContext): Promise<DeploymentResult> {
    return this.#configure(context);
  }

  deploy(context: DeploymentContext): Promise<DeploymentResult> {
    return this.#deploy(context);
  }

  baseUrl(context: Pick<DeploymentContext, "environment">): URL {
    return new URL(this.platform.connection(context.environment).publicOrigin);
  }

  async #check(context: DeploymentContext): Promise<void> {
    if (isDevelopmentLifecycle(context)) return;
    const connection = this.platform.connection(context.environment);
    await this.#runner.run("ssh", ["-o", "BatchMode=yes", connection.sshHost, "true"], {
      cwd: context.repositoryRoot,
    });
    await this.#runner.run("ssh", ["exe.dev", "billing", "plan", "--json"], {
      cwd: context.repositoryRoot,
    });
  }

  async #plan(context: DeploymentContext): Promise<DeploymentPlan> {
    if (isDevelopmentLifecycle(context))
      return {
        summary: "Use the watched OpenBot process already running inside exe.dev",
        steps: ["Skip recursive remote deployment"],
      };
    const connection = this.platform.connection(context.environment);
    return {
      summary: `Run the trusted OpenBot development stack on ${connection.vm}`,
      steps: [
        `Resize the VM to ${connection.cpu} vCPU and ${connection.memory}`,
        "Publish the Vite owner surface through the exe.dev HTTPS proxy",
        "Clone or fast-forward the Code Storage repository",
        "Install dependencies and supervise pnpm dev with systemd user linger",
        "Install every decrypted OpenBot configuration value in a mode-0600 environment file",
      ],
    };
  }

  async #configure(context: DeploymentContext): Promise<DeploymentResult> {
    const origin = this.baseUrl(context).toString().replace(/\/$/, "");
    await persistEnvironment(context, "PUBLIC_ORIGIN", origin, "OpenBot public origin.");
    return {
      outputs: {
        "control-service.origin": origin,
        "agent-service.origin": origin,
        "runtime.origin": origin,
      },
    };
  }

  async #deploy(context: DeploymentContext): Promise<DeploymentResult> {
    if (isDevelopmentLifecycle(context)) return await this.#configure(context);
    const connection = this.platform.connection(context.environment);
    const branch = await this.#currentBranch(context.repositoryRoot);
    const sourceUrl = codeStorageSourceUrl(context.environment);
    await this.#runner.run("ssh", [
      "exe.dev",
      "resize",
      connection.vm,
      `--cpu=${connection.cpu}`,
      `--memory=${connection.memory}`,
    ]);
    await this.#runner.run("ssh", ["exe.dev", "share", "port", connection.vm, "4173"]);
    await this.#runner.run("ssh", ["exe.dev", "share", "set-public", connection.vm]);

    const stateDirectory = `/home/exedev/.openbot/exe-dev/${connection.vm}`;
    const environmentFile = `${stateDirectory}/environment`;
    const unitFile = "/home/exedev/.config/systemd/user/openbot-dev.service";
    const environment = renderRemoteEnvironment(
      {
        ...(context.configuration ?? context.environment),
        ...(context.environment.SOPS_AGE_KEY
          ? { SOPS_AGE_KEY: context.environment.SOPS_AGE_KEY }
          : {}),
      },
      connection,
      branch,
      await readConfigurationEnvironment(context.repositoryRoot),
    );
    await this.#runner.run(
      "ssh",
      [
        connection.sshHost,
        "bash",
        "-c",
        `umask 077; mkdir -p ${shell(stateDirectory)}; cat > ${shell(environmentFile)}`,
      ],
      { input: environment },
    );
    const unit = await renderFileTemplatePath(serviceTemplate, {
      WORKING_DIRECTORY: systemdPath(connection.remoteDirectory),
      ENVIRONMENT_FILE: systemdPath(environmentFile),
    });
    await this.#runner.run(
      "ssh",
      [
        connection.sshHost,
        "bash",
        "-c",
        `umask 077; mkdir -p /home/exedev/.config/systemd/user; cat > ${shell(unitFile)}`,
      ],
      { input: unit },
    );
    const reconcile = await renderFileTemplatePath(reconcileTemplate, {
      REMOTE_DIRECTORY_SHELL: shell(connection.remoteDirectory),
      ENVIRONMENT_FILE_SHELL: shell(environmentFile),
      UNIT_FILE_SHELL: shell(unitFile),
      SOURCE_URL_SHELL: shell(sourceUrl),
      SOURCE_BRANCH_SHELL: shell(branch),
    });
    try {
      await this.#runner.run("ssh", [connection.sshHost, "bash", "-s"], {
        input: reconcile,
        signal: AbortSignal.timeout(20 * 60 * 1000),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        message
          .replaceAll(sourceUrl, "[REDACTED_CODE_STORAGE_URL]")
          .replaceAll(
            context.environment.CODE_STORAGE_REPOSITORY_TOKEN ?? "missing-code-storage-token",
            "[REDACTED]",
          ),
      );
    }
    await waitForHealth(this.#request, connection.publicOrigin);
    const origin = connection.publicOrigin.replace(/\/$/, "");
    await persistEnvironment(context, "AGENT_SERVICE_ORIGIN", origin, "Agent endpoint origin.");
    return {
      outputs: {
        "control-service.deployment-url": origin,
        "agent-service.deployment-url": origin,
        "runtime.deployment-url": origin,
      },
    };
  }
}

export const processExeDevCommandRunner: ExeDevCommandRunner = {
  run(command, args, options = {}) {
    return new Promise((resolvePromise, reject) => {
      const child = spawn(command, [...args], {
        cwd: options.cwd,
        env: options.environment,
        signal: options.signal,
        stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => (stdout += chunk));
      child.stderr?.on("data", (chunk: string) => (stderr += chunk));
      child.once("error", reject);
      child.once("close", (code) => {
        if (code === 0) resolvePromise(stdout);
        else reject(new Error(`${command} exited with code ${code}: ${stderr.trim()}`));
      });
      if (options.input !== undefined) child.stdin?.end(options.input);
    });
  },
};

async function currentBranch(repositoryRoot: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["branch", "--show-current"], {
    cwd: repositoryRoot,
  });
  const branch = stdout.trim();
  if (!branch) throw new Error("exe.dev deployment requires a named current Git branch");
  return branch;
}

function codeStorageSourceUrl(environment: NodeJS.ProcessEnv): string {
  const organization = environment.CODE_STORAGE_ORGANIZATION?.trim();
  const repository = environment.CODE_STORAGE_REPOSITORY?.trim();
  const token = environment.CODE_STORAGE_REPOSITORY_TOKEN?.trim();
  if (!organization || !repository || !token)
    throw new Error(
      "exe.dev deployment requires CodeStorageGitProvider to reconcile CODE_STORAGE_ORGANIZATION, CODE_STORAGE_REPOSITORY, and CODE_STORAGE_REPOSITORY_TOKEN",
    );
  const url = new URL(`https://${organization}.code.storage/${repository}.git`);
  url.username = "t";
  url.password = token;
  return url.toString();
}

function renderRemoteEnvironment(
  environment: NodeJS.ProcessEnv,
  connection: ExeDevConnection,
  sourceBranch: string,
  configurationEnvironment: string,
): string {
  const values = {
    ...environment,
    COMPUTER_ID: environment.COMPUTER_ID?.trim() || "openbot-computer",
    DEVELOPMENT_SANDBOX_ID: environment.COMPUTER_ID?.trim() || "openbot-computer",
    EXE_DEV_INSIDE_VM: "1",
    EXE_DEV_PUBLIC_ORIGIN: connection.publicOrigin,
    EXE_DEV_COMPUTER_VNC_TARGET: "http://127.0.0.1:6080",
    EXE_DEV_CONFIGURATION_ENV_BASE64: Buffer.from(configurationEnvironment).toString("base64"),
    NO_DESKTOP: "1",
    OPENBOT_SOURCE_BRANCH: sourceBranch,
    WEB_HOST: "0.0.0.0",
  };
  return `${Object.entries(values)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .filter(([name]) => /^[A-Z][A-Z0-9_]*$/.test(name))
    .filter(([name]) => !name.startsWith("CODE_STORAGE_"))
    .filter(([name]) => name !== "TILDE_BEARER_TOKEN")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
    .join("\n")}\n`;
}

async function readConfigurationEnvironment(repositoryRoot: string): Promise<string> {
  try {
    return await readFile(resolve(repositoryRoot, "configuration/.env"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

async function waitForHealth(request: typeof fetch, origin: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await request(`${origin.replace(/\/$/, "")}/healthz`, {
        signal: AbortSignal.timeout(3_000),
      });
      if (response.ok) return;
      lastError = new Error(`Health check returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
  }
  throw lastError;
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
