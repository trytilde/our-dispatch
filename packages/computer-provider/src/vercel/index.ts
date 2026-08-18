import type { Sandbox as VercelSandbox } from "@vercel/sandbox";
import { VercelPlatform, vercelPlatform } from "@tryopenbot/platform-integrations";
import {
  resolveVercelProjectCredentials,
  resolveVercelRegistryIdentity,
  VercelPlatformError,
  type VercelProjectCredentials,
  type VercelRegistryIdentity,
} from "@tryopenbot/platform-integrations/vercel/registry";
import {
  ComputerProviderError,
  type ComputerCallContext,
  type ComputerProvider,
  type ComputerExecRequest,
  type ComputerHandle,
  type ComputerImageSpec,
  type ComputerInput,
  type ComputerSpec,
} from "../core/index.js";
import type { DeploymentContext } from "@tryopenbot/runtime-provider";
import {
  BaseComputerProvider,
  computerWorkspacePath,
  deterministicComputerId,
  scopeComputerExecRequest,
  type ComputerImageDeploymentConfig,
} from "../base/index.js";
import { computerServiceApiKey, scopedCapability } from "../capability.js";
import { MicrosandboxComputerProvider } from "../microsandbox/index.js";

export interface VercelSandboxComputerProviderOptions extends ComputerImageDeploymentConfig {
  platform?: VercelPlatform;
  request?: typeof fetch;
  /** Local implementation used whenever the lifecycle runs in development mode. */
  developmentProvider?: ComputerProvider;
}

export class VercelSandboxComputerProvider extends BaseComputerProvider {
  readonly platform: VercelPlatform;
  readonly platforms: readonly VercelPlatform[];
  protected readonly providerId = "vercel-sandbox";
  protected readonly deployedImageEnvironmentVariable = "VERCEL_COMPUTER_IMAGE";

  readonly #instances = new Map<string, VercelSandbox>();
  readonly #handles = new Map<string, ComputerHandle>();
  readonly #specs = new Map<string, ComputerSpec>();
  readonly #configuredRepository: string | undefined;
  readonly #request: typeof fetch;
  readonly #developmentProvider: ComputerProvider;
  #registryIdentity: Promise<VercelRegistryIdentity> | undefined;
  #sandboxCredentials: Promise<VercelProjectCredentials> | undefined;

  constructor(options: VercelSandboxComputerProviderOptions = {}) {
    const { platform, request, developmentProvider, ...imageDeployment } = options;
    super(imageDeployment, {
      publish: true,
      buildxPlatform: "linux/amd64",
      managedRepository: true,
    });
    this.platform = platform ?? vercelPlatform;
    this.platforms = [this.platform];
    this.#configuredRepository = imageDeployment.repository;
    this.#request = request ?? fetch;
    this.#developmentProvider = developmentProvider ?? new MicrosandboxComputerProvider();
  }

  protected override lifecycleDelegate(context: DeploymentContext): ComputerProvider | undefined {
    return context.devMode ? this.#developmentProvider : undefined;
  }

  override async previewAgentDesktop(agentId: string, context: ComputerCallContext) {
    if (context.devMode)
      return await this.#developmentProvider.previewAgentDesktop(agentId, context);
    return await super.previewAgentDesktop(agentId, context);
  }

  protected async imageRepository(
    context: DeploymentContext,
    phase: "build" | "plan" | "deploy",
  ): Promise<string> {
    if (this.#configuredRepository) return super.imageRepository(context, phase);
    if (phase === "plan") return "the agent Vercel project's Container Registry";
    if (phase === "build") return "openbot/vercel-sandbox-computer";
    return (await this.#vercelRegistryIdentity(context)).repository;
  }

  protected async authenticateImageRepository(
    context: DeploymentContext,
    _spec: ComputerImageSpec,
    callContext: ComputerCallContext,
  ): Promise<void> {
    if (this.#configuredRepository) return;
    const token = context.environment.VERCEL_TOKEN;
    if (!token)
      throw new ComputerProviderError(
        "invalid_configuration",
        "VERCEL_TOKEN is required to publish the Vercel Sandbox computer image",
      );
    const identity = await this.#vercelRegistryIdentity(context);
    await this.runDockerWithInput(
      ["login", "vcr.vercel.com", "--username", identity.username, "--password-stdin"],
      token,
      callContext,
    );
  }

  #vercelRegistryIdentity(context: DeploymentContext): Promise<VercelRegistryIdentity> {
    return (this.#registryIdentity ??= resolveVercelRegistryIdentity({
      token: context.environment.VERCEL_TOKEN,
      project: context.environment.VERCEL_AGENT_PROJECT,
      teamId: context.environment.VERCEL_TEAM_ID,
      request: this.#request,
    }).catch((error: unknown) => {
      if (error instanceof VercelPlatformError)
        throw new ComputerProviderError(error.code, error.message);
      throw error;
    }));
  }

  #vercelSandboxCredentials(context?: ComputerCallContext): Promise<VercelProjectCredentials> {
    const environment = context?.environment ?? process.env;
    return (this.#sandboxCredentials ??= resolveVercelProjectCredentials({
      token: environment.VERCEL_TOKEN,
      project: environment.VERCEL_AGENT_PROJECT,
      teamId: environment.VERCEL_TEAM_ID,
      request: this.#request,
    }).catch((error: unknown) => {
      if (error instanceof VercelPlatformError)
        throw new ComputerProviderError(error.code, error.message);
      throw error;
    }));
  }

  async create(spec: ComputerSpec, context: ComputerCallContext): Promise<ComputerHandle> {
    const id = deterministicComputerId("openbot", spec.id);
    if (this.#handles.has(id))
      throw new ComputerProviderError("invalid_configuration", `Computer ${id} already exists`);
    const { Sandbox } = await import("@vercel/sandbox");
    const image = spec.image ?? process.env.VERCEL_COMPUTER_IMAGE;
    if (!image)
      throw new ComputerProviderError(
        "invalid_configuration",
        "Deploy the Vercel computer provider or set VERCEL_COMPUTER_IMAGE before creating a computer",
      );
    const sandbox = await Sandbox.create({
      ...(await this.#vercelSandboxCredentials(context)),
      name: id,
      image,
      ports: [6080, 4101],
      timeout: 45 * 60 * 1000,
      persistent: true,
      keepLastSnapshots: { count: 1 },
      tags: {
        application: "openbot",
        component: "computer",
        "image-tag": imageTagOf(image),
        ...spec.labels,
      },
      env: computerEnvironment(id, spec),
    });
    try {
      await seedComputer(sandbox, spec);
      await runSpecLifecycle(sandbox, spec, "create", context);
      await startComputer(sandbox, id, spec, context);
    } catch (error) {
      await sandbox.delete().catch(() => undefined);
      throw error;
    }
    const handle: ComputerHandle = {
      id,
      providerId: this.providerId,
      state: "running",
      createdAt: sandbox.createdAt,
      image,
    };
    this.#instances.set(id, sandbox);
    this.#handles.set(id, handle);
    this.#specs.set(id, spec);
    this.#imageTags.set(id, imageTagOf(image));
    return handle;
  }

  async get(id: string, context: ComputerCallContext): Promise<ComputerHandle> {
    const handle = this.#handles.get(id);
    if (handle) return handle;
    const sandbox = await this.#attach(id, context);
    const state =
      sandbox.status === "running" || sandbox.status === "pending"
        ? "running"
        : sandbox.status === "failed" || sandbox.status === "aborted"
          ? "failed"
          : "sleeping";
    const discovered: ComputerHandle = {
      id,
      providerId: this.providerId,
      state,
      createdAt: sandbox.createdAt,
      image: sandbox.image,
    };
    const imageTag = (sandbox.tags as Record<string, string> | undefined)?.["image-tag"];
    if (imageTag) this.#imageTags.set(id, imageTag);
    this.#handles.set(id, discovered);
    return discovered;
  }

  /** Sandboxes report images by digest; compare through the image tag stamped at creation. */
  protected override computerImageMatches(
    id: string,
    currentImage: string | undefined,
    desiredImage: string,
  ): boolean {
    const tag = this.#imageTags.get(id);
    if (tag) return desiredImage.endsWith(`:${tag}`);
    return currentImage === desiredImage;
  }

  async wake(id: string, context: ComputerCallContext): Promise<ComputerHandle> {
    const current = await this.get(id, context);
    if (current.state === "running") return current;
    const sandbox = await this.#attach(id, context);
    const spec = this.#specs.get(id) ?? {};
    await runSpecLifecycle(sandbox, spec, "wake", context);
    await startComputer(sandbox, id, spec, context);
    const running = { ...current, state: "running" as const };
    this.#handles.set(id, running);
    return running;
  }

  async sleep(id: string, context: ComputerCallContext): Promise<ComputerHandle> {
    const current = await this.get(id, context);
    const sandbox = await this.#attach(id, context);
    await sandbox.stop();
    this.#instances.delete(id);
    const sleeping = { ...current, state: "sleeping" as const };
    this.#handles.set(id, sleeping);
    return sleeping;
  }

  async delete(id: string, context: ComputerCallContext): Promise<void> {
    await this.get(id, context);
    const sandbox = await this.#attach(id, context);
    await sandbox.delete();
    this.#instances.delete(id);
    this.#handles.delete(id);
    this.#specs.delete(id);
  }

  async exec(id: string, request: ComputerExecRequest, context: ComputerCallContext) {
    const scoped = scopeComputerExecRequest(request, context.agentId);
    const output = await (
      await this.#attach(id, context)
    ).runCommand({
      cmd: scoped.command,
      args: [...(scoped.args ?? [])],
      ...(scoped.cwd ? { cwd: scoped.cwd } : {}),
      ...(scoped.environment ? { env: { ...scoped.environment } } : {}),
      ...(scoped.timeoutMs ? { timeoutMs: scoped.timeoutMs } : {}),
      signal: context.signal,
    });
    return {
      exitCode: output.exitCode,
      stdout: await output.stdout(),
      stderr: await output.stderr(),
    };
  }

  async readFile(id: string, path: string, _context: ComputerCallContext): Promise<Uint8Array> {
    const content = await (
      await this.#attach(id, _context)
    ).readFileToBuffer({ path: computerWorkspacePath(path, _context.agentId) });
    if (!content)
      throw new ComputerProviderError("not_found", `Computer file ${path} was not found`);
    return content;
  }

  async writeFile(
    id: string,
    path: string,
    content: Uint8Array,
    _context: ComputerCallContext,
  ): Promise<void> {
    await (
      await this.#attach(id, _context)
    ).writeFiles([
      { path: computerWorkspacePath(path, _context.agentId), content: Buffer.from(content) },
    ]);
  }

  async screenshot(id: string, context: ComputerCallContext): Promise<Uint8Array> {
    if (!context.agentId)
      throw new ComputerProviderError(
        "invalid_configuration",
        "agentId is required for screenshots",
      );
    const desktop = await this.ensureAgentDesktop(id, context.agentId, context);
    const result = await this.exec(
      id,
      {
        command: "import",
        args: ["-display", desktop.display, "-window", "root", "/tmp/openbot-screenshot.png"],
      },
      context,
    );
    if (result.exitCode !== 0)
      throw new ComputerProviderError(
        "provider_unavailable",
        `Screenshot failed: ${result.stderr}`,
      );
    const content = await (
      await this.#attach(id, context)
    ).readFileToBuffer({ path: "/tmp/openbot-screenshot.png" });
    if (!content)
      throw new ComputerProviderError("provider_unavailable", "Screenshot output was not created");
    return content;
  }

  async input(id: string, input: ComputerInput, context: ComputerCallContext): Promise<void> {
    if (!context.agentId)
      throw new ComputerProviderError("invalid_configuration", "agentId is required for input");
    const desktop = await this.ensureAgentDesktop(id, context.agentId, context);
    const result = await this.exec(
      id,
      {
        command: "xdotool",
        args: inputArguments(input),
        environment: { DISPLAY: desktop.display },
      },
      context,
    );
    if (result.exitCode !== 0)
      throw new ComputerProviderError(
        "provider_unavailable",
        `Computer input failed: ${result.stderr}`,
      );
  }

  async vnc(id: string, context: ComputerCallContext) {
    const sandbox = await this.#attach(id, context);
    await this.get(id, context);
    const url = new URL("/vnc.html", sandbox.domain(6080));
    url.searchParams.set("autoconnect", "1");
    url.searchParams.set("resize", "remote");
    url.searchParams.set("token", scopedCapability("vnc", id, context.agentId));
    return { url, expiresAt: sandbox.expiresAt ?? new Date(Date.now() + 45 * 60 * 1000) };
  }

  protected async computerServiceUrl(id: string): Promise<string> {
    const sandbox = await this.#attach(id);
    return new URL("/rpc", sandbox.domain(4101)).toString().replace(/\/$/, "");
  }

  readonly #imageTags = new Map<string, string>();

  /** Re-run the start script: resumed Vercel Sandboxes restore the filesystem, not processes. */
  protected override async reviveComputerServices(
    id: string,
    context: ComputerCallContext,
  ): Promise<void> {
    const sandbox = await this.#attach(id, context);
    await startComputer(sandbox, id, this.#specs.get(id) ?? { id }, context);
  }

  async #attach(id: string, context?: ComputerCallContext): Promise<VercelSandbox> {
    const current = this.#instances.get(id);
    if (current) return current;
    try {
      const { Sandbox } = await import("@vercel/sandbox");
      const sandbox = await Sandbox.get({
        ...(await this.#vercelSandboxCredentials(context)),
        name: id,
      });
      this.#instances.set(id, sandbox);
      return sandbox;
    } catch (error) {
      throw new ComputerProviderError(
        "not_found",
        `Computer ${id} was not found: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }
}

function imageTagOf(reference: string): string {
  const tail = reference.split("/").at(-1) ?? reference;
  const colon = tail.lastIndexOf(":");
  return colon > 0 ? tail.slice(colon + 1) : tail;
}

function computerEnvironment(id: string, spec: ComputerSpec): Record<string, string> {
  return {
    DISPLAY: ":1",
    COMPUTER_SERVICE_API_KEY: computerServiceApiKey(),
    COMPUTER_ID: id,
    COMPUTER_EXPOSED_PORTS: "6080,4101",
    COMPUTER_SERVICE_PORT: "4101",
    COMPUTER_WORKSPACE: "/workspace",
    ...spec.environment,
  };
}

async function seedComputer(sandbox: VercelSandbox, spec: ComputerSpec): Promise<void> {
  if (!spec.files?.length) return;
  await sandbox.writeFiles(
    spec.files.map((file) => ({
      path: computerWorkspacePath(file.path),
      content: Buffer.from(file.content),
      mode: file.executable ? 0o755 : 0o644,
    })),
  );
}

async function runSpecLifecycle(
  sandbox: VercelSandbox,
  spec: ComputerSpec,
  phase: "create" | "wake",
  context: ComputerCallContext,
): Promise<void> {
  for (const script of spec.lifecycle?.filter((candidate) => candidate.phases.includes(phase)) ??
    []) {
    const result = await sandbox.runCommand({
      cmd: "bash",
      args: [computerWorkspacePath(script.path)],
      signal: context.signal,
    });
    if (result.exitCode !== 0)
      throw new ComputerProviderError(
        "provider_unavailable",
        `Computer lifecycle ${script.id} failed: ${(await result.stderr()).trim() || (await result.stdout()).trim()}`,
      );
  }
}

async function startComputer(
  sandbox: VercelSandbox,
  id: string,
  spec: ComputerSpec,
  context: ComputerCallContext,
): Promise<void> {
  try {
    await sandbox.runCommand({
      cmd: "bash",
      args: ["/usr/local/bin/start-openbot-computer"],
      detached: true,
      env: computerEnvironment(id, spec),
      signal: context.signal,
    });
  } catch (error) {
    throw new ComputerProviderError(
      "provider_unavailable",
      `Could not start /usr/local/bin/start-openbot-computer in Vercel Sandbox: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
}

function inputArguments(input: ComputerInput): string[] {
  if (input.action === "mouse_move")
    return ["mousemove", "--sync", String(input.x), String(input.y)];
  if (input.action === "click") return ["click", String(input.button ?? 1)];
  if (input.action === "type") return ["type", "--delay", String(input.delayMs ?? 10), input.text];
  return ["key", input.key];
}
