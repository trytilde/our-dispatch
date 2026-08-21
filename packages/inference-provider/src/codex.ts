import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { chmod, copyFile, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  DeploymentContext,
  ProviderInitialization,
  ProviderInitializationContext,
} from "@tryopenbot/runtime-provider";
import { persistEnvironment, persistSecret } from "@tryopenbot/runtime-provider";
import type { InferenceProvider } from "./core.js";

export const CODEX_AUTH_JSON = "CODEX_AUTH_JSON";
export const CODEX_INFERENCE_PROVIDER = "codex-subscription";
export const DEFAULT_CODEX_MODEL = "gpt-5.6-sol";

const INFERENCE_PROVIDER = "INFERENCE_PROVIDER";
const AI_MODEL = "AI_MODEL";
const VERCEL_SUPPORT_LARGE_FUNCTIONS = "VERCEL_SUPPORT_LARGE_FUNCTIONS";
const AUTH_DESCRIPTION = "Codex ChatGPT subscription credential cache.";

export const codexInferenceProviderInitialization: ProviderInitialization = {
  id: "codex-subscription-inference",
  label: "ChatGPT subscription through Codex",
  description:
    "Authenticate with ChatGPT using Codex device-code login and encrypt the resulting credential cache with SOPS.",
  questions: [],
};

export interface CodexAccount {
  type: "chatgpt";
  email?: string | null;
  planType?: string | null;
}

export interface CodexAuthenticationClient {
  loginWithDeviceCode(codexHome: string): Promise<void>;
  readAccount(codexHome: string, refreshToken: boolean): Promise<CodexAccount>;
}

export interface CodexInferenceProviderOptions {
  authentication?: CodexAuthenticationClient;
  /** Linux executable override used by focused deployment tests. */
  linuxExecutablePath?: string;
}

export class CodexInferenceProvider implements InferenceProvider {
  readonly initialization = codexInferenceProviderInitialization;
  readonly agentTemplate = {
    files: [
      {
        path: "inference.ts.hbs",
        source: fileURLToPath(new URL("./codex/assets/inference.ts.hbs", import.meta.url)),
      },
    ],
  } as const;
  readonly buildable = {
    check: (context: DeploymentContext) => this.check(context),
    build: (context: DeploymentContext) => this.build(context),
  };

  private readonly authentication: CodexAuthenticationClient;
  private readonly linuxExecutablePath?: string;

  constructor(options: CodexInferenceProviderOptions = {}) {
    this.authentication = options.authentication ?? new CodexCliAuthenticationClient();
    this.linuxExecutablePath = options.linuxExecutablePath;
  }

  async initialize(context: ProviderInitializationContext): Promise<void> {
    await context.setEnvironment(
      INFERENCE_PROVIDER,
      CODEX_INFERENCE_PROVIDER,
      "Inference implementation used by authored agents.",
    );
    if (!context.environment[AI_MODEL]?.trim())
      await context.setEnvironment(
        AI_MODEL,
        DEFAULT_CODEX_MODEL,
        "Default Codex model used by authored agents.",
      );
    await context.setEnvironment(
      VERCEL_SUPPORT_LARGE_FUNCTIONS,
      "1",
      "Allow the Vercel agent service to bundle the Codex native executable.",
    );

    const existing = context.environment[CODEX_AUTH_JSON]?.trim();
    if (existing) {
      try {
        const refreshed = await this.validateStoredAuthentication(existing, true);
        if (refreshed !== existing)
          await context.setSecret(CODEX_AUTH_JSON, refreshed, AUTH_DESCRIPTION);
        return;
      } catch (error) {
        if (!context.interactive) throw reauthenticationRequired(error);
      }
    } else if (!context.interactive) {
      throw reauthenticationRequired();
    }

    const authenticated = await this.authenticateInteractively(context.report);
    await context.setSecret(CODEX_AUTH_JSON, authenticated, AUTH_DESCRIPTION);
  }

  private async check(context: DeploymentContext): Promise<void> {
    if (context.dryRun !== true)
      await persistEnvironment(
        context,
        VERCEL_SUPPORT_LARGE_FUNCTIONS,
        "1",
        "Allow the Vercel agent service to bundle the Codex native executable.",
      );
    const stored = context.environment[CODEX_AUTH_JSON]?.trim();
    if (!stored) {
      if (context.devMode && context.interactive) {
        await this.reauthenticateForLifecycle(context);
        return;
      }
      throw reauthenticationRequired();
    }

    try {
      const refreshed = await this.validateStoredAuthentication(stored, context.dryRun !== true);
      if (refreshed !== stored && context.dryRun !== true)
        await persistSecret(context, CODEX_AUTH_JSON, refreshed, AUTH_DESCRIPTION);
    } catch (error) {
      if (context.devMode && context.interactive) {
        await this.reauthenticateForLifecycle(context);
        return;
      }
      throw reauthenticationRequired(error);
    }
  }

  private async build(context: DeploymentContext): Promise<void> {
    if (context.inputs.get("agent-service.target") !== "vercel") return;
    const artifact = context.inputs.get("agent-service.artifact");
    if (!artifact) throw new Error("Vercel agent-service artifact is unavailable");
    const functions = join(artifact, ".vercel/output/functions/api/agents");
    const entries = await readdir(functions, { withFileTypes: true });
    const executable = this.linuxExecutablePath ?? resolveLinuxCodexExecutable();
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && entry.name.endsWith(".func"))
        .map(async (entry) => {
          const destination = join(functions, entry.name, "codex");
          await copyFile(executable, destination);
          await chmod(destination, 0o755);
        }),
    );
  }

  private async reauthenticateForLifecycle(context: DeploymentContext): Promise<void> {
    const authenticated = await this.authenticateInteractively(context.report);
    await persistSecret(context, CODEX_AUTH_JSON, authenticated, AUTH_DESCRIPTION);
    await persistEnvironment(
      context,
      INFERENCE_PROVIDER,
      CODEX_INFERENCE_PROVIDER,
      "Inference implementation used by authored agents.",
    );
    if (!context.environment[AI_MODEL]?.trim())
      await persistEnvironment(
        context,
        AI_MODEL,
        DEFAULT_CODEX_MODEL,
        "Default Codex model used by authored agents.",
      );
  }

  private async authenticateInteractively(
    report: ProviderInitializationContext["report"] | DeploymentContext["report"],
  ): Promise<string> {
    return withCodexHome(undefined, async (codexHome) => {
      report?.({ event: "inference.codex.device-login.started" });
      await this.authentication.loginWithDeviceCode(codexHome);
      await this.authentication.readAccount(codexHome, true);
      const auth = await readAuthFile(codexHome);
      report?.({ event: "inference.codex.device-login.complete" });
      return auth;
    });
  }

  private async validateStoredAuthentication(auth: string, refreshToken: boolean): Promise<string> {
    validateAuthJson(auth);
    return withCodexHome(auth, async (codexHome) => {
      await this.authentication.readAccount(codexHome, refreshToken);
      return readAuthFile(codexHome);
    });
  }
}

export class CodexCliAuthenticationClient implements CodexAuthenticationClient {
  async loginWithDeviceCode(codexHome: string): Promise<void> {
    const invocation = resolveCodexInvocation();
    await runProcess(invocation.command, [...invocation.arguments, "login", "--device-auth"], {
      codexHome,
      inheritStdio: true,
    });
  }

  async readAccount(codexHome: string, refreshToken: boolean): Promise<CodexAccount> {
    const invocation = resolveCodexInvocation();
    const child = spawn(
      invocation.command,
      [...invocation.arguments, "app-server", "--listen", "stdio://"],
      {
        env: { ...process.env, CODEX_HOME: codexHome, RUST_LOG: "error" },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-2_000);
    });

    try {
      const account = await new Promise<CodexAccount>((resolveAccount, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Codex authentication check timed out")),
          20_000,
        );
        let stdout = "";
        const fail = (error: unknown) => {
          clearTimeout(timeout);
          reject(error);
        };
        child.once("error", fail);
        child.once("exit", (code) => {
          fail(
            new Error(
              `Codex app-server exited before authentication completed (${code ?? "unknown"})${stderr ? `: ${stderr.trim()}` : ""}`,
            ),
          );
        });
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
          stdout += String(chunk);
          let newline = stdout.indexOf("\n");
          while (newline >= 0) {
            const line = stdout.slice(0, newline).trim();
            stdout = stdout.slice(newline + 1);
            newline = stdout.indexOf("\n");
            if (!line) continue;
            let message: { id?: number; result?: unknown; error?: { message?: string } };
            try {
              message = JSON.parse(line) as typeof message;
            } catch {
              continue;
            }
            if (message.id === 1 && message.error?.message) {
              fail(new Error(message.error.message));
              return;
            }
            if (message.id === 1 && message.result) {
              sendJson(child, { method: "initialized", params: {} });
              sendJson(child, {
                method: "account/read",
                id: 2,
                params: { refreshToken },
              });
            }
            if (message.id !== 2) continue;
            clearTimeout(timeout);
            if (message.error?.message) {
              reject(new Error(message.error.message));
              return;
            }
            const result = message.result as { account?: unknown } | undefined;
            const candidate = result?.account as Partial<CodexAccount> | null | undefined;
            if (candidate?.type !== "chatgpt") {
              reject(new Error("Codex is not authenticated with a ChatGPT subscription"));
              return;
            }
            resolveAccount({
              type: "chatgpt",
              email: typeof candidate.email === "string" ? candidate.email : null,
              planType: typeof candidate.planType === "string" ? candidate.planType : null,
            });
          }
        });
        sendJson(child, {
          method: "initialize",
          id: 1,
          params: {
            clientInfo: { name: "openbot", title: "OpenBot", version: "0.1.0" },
          },
        });
      });
      return account;
    } finally {
      child.kill("SIGTERM");
    }
  }
}

async function withCodexHome<T>(
  auth: string | undefined,
  run: (codexHome: string) => Promise<T>,
): Promise<T> {
  const codexHome = await mkdtemp(join(tmpdir(), "openbot-codex-auth-"));
  try {
    await writeFile(
      join(codexHome, "config.toml"),
      'cli_auth_credentials_store = "file"\nforced_login_method = "chatgpt"\n',
      { mode: 0o600 },
    );
    if (auth) await writeFile(join(codexHome, "auth.json"), auth, { mode: 0o600 });
    return await run(codexHome);
  } finally {
    await rm(codexHome, { recursive: true, force: true });
  }
}

async function readAuthFile(codexHome: string): Promise<string> {
  const auth = await readFile(join(codexHome, "auth.json"), "utf8");
  validateAuthJson(auth);
  return auth.trim();
}

function validateAuthJson(auth: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(auth);
  } catch {
    throw new Error("Stored Codex authentication is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Stored Codex authentication must be a JSON object");
}

function reauthenticationRequired(cause?: unknown): Error {
  return new Error(
    "Codex ChatGPT authentication is missing, expired, or revoked. Run openbot init in an interactive terminal to sign in again with a device code.",
    cause === undefined ? undefined : { cause },
  );
}

function resolveCodexInvocation(): { command: string; arguments: string[] } {
  const require = createRequire(import.meta.url);
  const packagePath = require.resolve("@openai/codex/package.json");
  return { command: process.execPath, arguments: [join(dirname(packagePath), "bin", "codex.js")] };
}

function resolveLinuxCodexExecutable(): string {
  const require = createRequire(import.meta.url);
  const packageRequire = createRequire(require.resolve("@openai/codex/package.json"));
  const linuxPackage = packageRequire.resolve("@openai/codex-linux-x64/package.json");
  return join(dirname(linuxPackage), "vendor", "x86_64-unknown-linux-musl", "bin", "codex");
}

function sendJson(child: ReturnType<typeof spawn>, message: unknown): void {
  child.stdin?.write(`${JSON.stringify(message)}\n`);
}

async function runProcess(
  command: string,
  arguments_: readonly string[],
  options: { codexHome: string; inheritStdio: boolean },
): Promise<void> {
  const child = spawn(command, arguments_, {
    env: { ...process.env, CODEX_HOME: options.codexHome },
    stdio: options.inheritStdio ? "inherit" : "pipe",
  });
  const code = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (value) => resolve(value ?? 1));
  });
  if (code !== 0) throw new Error(`Codex command exited with status ${code}`);
}
