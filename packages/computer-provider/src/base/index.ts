import { createHash, randomBytes } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { basename, posix } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import { ComputerService } from "@tryopenbot/computer-service-proto";
import {
  ComputerProviderError,
  type BuiltComputerImage,
  type ComputerCallContext,
  type ComputerAgentWorkspace,
  type ComputerExecRequest,
  type ComputerExecResult,
  type ComputerHandle,
  type ComputerInput,
  type ComputerSeedFile,
  type ComputerImageSpec,
  type ComputerProvider,
  type ComputerSpec,
  type ComputerVncEndpoint,
  type PublishedComputerImage,
  type DeployAgentWorkspacesRequest,
  type DeployDevelopmentSandboxRequest,
} from "../core/index.js";
import type {
  Buildable,
  Deployable,
  DeploymentContext,
  DeploymentResult,
  ProviderInitialization,
} from "@tryopenbot/runtime-provider";
import { persistEnvironment } from "@tryopenbot/runtime-provider";
import { renderFileTemplatePath } from "@tryopenbot/utilities";
import {
  computerImageAssets,
  computerImageWatchPaths,
  materializeComputerImageContext,
} from "./assets.js";
import {
  developmentSandboxConfigurationFiles,
  developmentSandboxSourceFiles,
} from "./development.js";
import { computerServiceApiKey, scopedCapability } from "../capability.js";

const execute = promisify(execFile);

export interface ComputerImageDeploymentConfig {
  /** OCI repository, for example ghcr.io/example/openbot-computer. */
  repository?: string;
  tagPrefix?: string;
  buildArguments?: Readonly<Record<string, string>>;
}

interface ComputerImageLifecycleOptions {
  publish: boolean;
  buildxPlatform?: string;
  managedRepository?: boolean;
  repositoryDescription?: string;
}

export abstract class BaseComputerProvider implements ComputerProvider {
  protected abstract readonly providerId: string;
  protected abstract readonly deployedImageEnvironmentVariable: string;
  protected abstract computerServiceUrl(computerId: string): Promise<string>;
  readonly initialization: ProviderInitialization | undefined;
  readonly buildable: Buildable;
  readonly deployable: Deployable;
  readonly #imageDeployment: ComputerImageDeploymentConfig;
  readonly #imageLifecycle: ComputerImageLifecycleOptions;

  protected constructor(
    imageDeployment: ComputerImageDeploymentConfig = {},
    imageLifecycle: ComputerImageLifecycleOptions = { publish: true },
  ) {
    this.#imageDeployment = imageDeployment;
    this.#imageLifecycle = imageLifecycle;
    this.initialization =
      imageDeployment.repository || !imageLifecycle.publish || imageLifecycle.managedRepository
        ? undefined
        : {
            id: "computer-image",
            label: "Computer image",
            description: "Build and publish the shared OpenBot computer image.",
            questions: [
              {
                id: "computer-image-repository",
                prompt: "Which OCI repository should receive OpenBot computer images?",
                description:
                  imageLifecycle.repositoryDescription ??
                  "Use an untagged OCI repository that the deployment environment can push to.",
                input: "text",
                required: true,
                destination: { kind: "environment", key: "COMPUTER_IMAGE_REPOSITORY" },
              },
            ],
          };
    this.buildable = {
      check: async (context) => {
        const delegate = this.lifecycleDelegate(context);
        if (delegate?.buildable) return delegate.buildable.check(context);
        await this.imageRepository(context, "build");
        await runDocker(
          ["version", "--format", "{{.Server.Version}}"],
          deploymentCallContext("check", context),
        );
        if (this.#imageLifecycle.buildxPlatform)
          await runDocker(["buildx", "version"], deploymentCallContext("check", context));
      },
      build: async (context) => {
        const delegate = this.lifecycleDelegate(context);
        if (delegate?.buildable) return delegate.buildable.build(context);
        const materialized = await materializeComputerImageContext(
          context.repositoryRoot,
          this.providerId,
        );
        const spec = await this.#imageSpec(context, materialized, "build");
        const image = await this.buildImage(spec, deploymentCallContext("build", context));
        return {
          outputs: {
            [this.#outputName("CONTEXT")]: materialized.contextDirectory,
            [this.#outputName("DOCKERFILE")]: materialized.dockerfilePath,
            [this.#outputName("LOCAL_REFERENCE")]: image.localReference,
            [this.#outputName("SOURCE_DIGEST")]: image.sourceDigest,
          },
        };
      },
      watchPaths: async (context) => {
        const delegate = this.lifecycleDelegate(context);
        if (delegate?.buildable?.watchPaths) return delegate.buildable.watchPaths(context);
        return computerImageWatchPaths(context.repositoryRoot);
      },
    };
    this.deployable = {
      plan: async (context) => {
        const delegate = this.lifecycleDelegate(context);
        if (delegate?.deployable) return delegate.deployable.plan(context);
        const repository = await this.imageRepository(context, "plan");
        return this.#imageLifecycle.publish
          ? {
              summary: `Publish the ${this.providerId} computer image to ${repository}`,
              steps: [
                "Push the content-addressed OCI image",
                `Set ${this.deployedImageEnvironmentVariable} for future computers`,
              ],
            }
          : {
              summary: `Use the locally built ${repository} computer image`,
              steps: [`Set ${this.deployedImageEnvironmentVariable} for local computers`],
            };
      },
      deploy: async (context) => {
        const delegate = this.lifecycleDelegate(context);
        if (delegate?.deployable) return delegate.deployable.deploy(context);
        const spec = await this.#imageSpec(
          context,
          {
            contextDirectory: context.inputs.require(this.#outputName("CONTEXT")),
            dockerfilePath: context.inputs.require(this.#outputName("DOCKERFILE")),
            sourceDigest: context.inputs.require(this.#outputName("SOURCE_DIGEST")),
          },
          "deploy",
        );
        const built = {
          localReference: context.inputs.require(this.#outputName("LOCAL_REFERENCE")),
          sourceDigest: spec.sourceDigest,
        };
        if (this.#imageLifecycle.publish)
          await this.authenticateImageRepository(
            context,
            spec,
            deploymentCallContext("deploy", context),
          );
        const selectedImage = this.#imageLifecycle.publish
          ? await this.publishImage(built, spec, deploymentCallContext("deploy", context))
          : { ...built, reference: built.localReference, publishedAt: new Date() };
        const image = await this.prepareDeployedImage(
          selectedImage,
          spec,
          deploymentCallContext("deploy", context),
        );
        await persistEnvironment(
          context,
          this.deployedImageEnvironmentVariable,
          image.reference,
          `Deployed ${this.providerId} computer image.`,
        );
        return { outputs: { [this.#outputName("REFERENCE")]: image.reference } };
      },
    };
  }

  /** Provider-owned development substitution, such as Vercel Sandbox -> Microsandbox. */
  protected lifecycleDelegate(_context: DeploymentContext): ComputerProvider | undefined {
    return undefined;
  }

  abstract create(spec: ComputerSpec, context: ComputerCallContext): Promise<ComputerHandle>;
  abstract get(id: string, context: ComputerCallContext): Promise<ComputerHandle>;
  abstract wake(id: string, context: ComputerCallContext): Promise<ComputerHandle>;
  abstract sleep(id: string, context: ComputerCallContext): Promise<ComputerHandle>;
  abstract delete(id: string, context: ComputerCallContext): Promise<void>;
  abstract exec(
    id: string,
    request: ComputerExecRequest,
    context: ComputerCallContext,
  ): Promise<ComputerExecResult>;
  abstract readFile(id: string, path: string, context: ComputerCallContext): Promise<Uint8Array>;
  abstract writeFile(
    id: string,
    path: string,
    content: Uint8Array,
    context: ComputerCallContext,
  ): Promise<void>;
  abstract screenshot(id: string, context: ComputerCallContext): Promise<Uint8Array>;
  abstract input(id: string, input: ComputerInput, context: ComputerCallContext): Promise<void>;
  abstract vnc(id: string, context: ComputerCallContext): Promise<ComputerVncEndpoint>;

  async previewAgentDesktop(
    agentId: string,
    context: ComputerCallContext,
  ): Promise<ComputerVncEndpoint> {
    const computerId = context.environment?.COMPUTER_ID?.trim() || process.env.COMPUTER_ID?.trim();
    if (!computerId)
      throw new ComputerProviderError(
        "invalid_configuration",
        "COMPUTER_ID is required to open an agent desktop",
      );
    await this.ensureAgentDesktop(computerId, agentId, context);
    return await this.vnc(computerId, { ...context, agentId });
  }

  async deployAgentWorkspaces(
    request: DeployAgentWorkspacesRequest,
    context: DeploymentContext,
  ): Promise<DeploymentResult> {
    const delegate = this.lifecycleDelegate(context);
    if (delegate) return delegate.deployAgentWorkspaces(request, context);
    const call: ComputerCallContext = {
      requestId: "computer:deploy-agent-workspaces",
      environment: context.environment,
    };
    const serviceApiKey = computerServiceApiKey(context.environment.COMPUTER_SERVICE_API_KEY);
    const image = context.environment[this.deployedImageEnvironmentVariable];
    const spec: ComputerSpec = {
      id: request.computerId,
      ...(image ? { image } : {}),
      environment: { COMPUTER_SERVICE_API_KEY: serviceApiKey },
    };
    let computer;
    try {
      computer = await this.get(request.computerId, call);
    } catch (error) {
      if (!(error instanceof ComputerProviderError) || error.code !== "not_found") throw error;
      computer = await this.create(spec, call);
    }
    // A computer running an outdated image must be replaced in every mode; agent workspaces are
    // reseeded and are explicitly not durable storage.
    if (image && !this.computerImageMatches(computer.id, computer.image, image)) {
      await this.delete(computer.id, call);
      computer = await this.create(spec, call);
    }
    if (computer.state === "sleeping") await this.wake(computer.id, call);
    for (const workspace of request.workspaces)
      await this.#registerAgentWorkspace(computer.id, workspace, call);
    for (const workspace of request.workspaces)
      await this.ensureAgentDesktop(computer.id, workspace.agentId, call);
    await persistEnvironment(context, "COMPUTER_ID", computer.id, "OpenBot computer ID.");
    await persistEnvironment(
      context,
      "COMPUTER_SERVICE_URL",
      await this.computerServiceUrl(computer.id),
      "OpenBot computer service URL.",
    );
    return { outputs: { "computer.id": computer.id } };
  }

  async deployDevelopmentSandbox(
    request: DeployDevelopmentSandboxRequest,
    context: DeploymentContext,
  ) {
    const delegate = this.lifecycleDelegate(context);
    if (delegate) return delegate.deployDevelopmentSandbox(request, context);
    const call: ComputerCallContext = {
      requestId: "computer:deploy-development-sandbox",
      environment: context.environment,
    };
    const image = context.environment[this.deployedImageEnvironmentVariable];
    const sandboxSpec: ComputerSpec = {
      id: request.computerId,
      ...(image ? { image } : {}),
      labels: { role: "openbot-development-sandbox" },
    };
    let computer;
    try {
      computer = await this.get(request.computerId, call);
    } catch (error) {
      if (!(error instanceof ComputerProviderError) || error.code !== "not_found") throw error;
      computer = await this.create(sandboxSpec, call);
    }
    // The development sandbox must also follow image updates; its durable state is reseeded.
    if (image && !this.computerImageMatches(computer.id, computer.image, image)) {
      await this.delete(computer.id, call);
      computer = await this.create(sandboxSpec, call);
    }
    if (computer.state === "sleeping") await this.wake(computer.id, call);

    const stateRoot = "/workspace/.openbot/development";
    const sourceRoot = "/workspace/openbot";
    const ageKeyFile = `${stateRoot}/sops-age-key.txt`;
    const sourceMarker = `${stateRoot}/source-initialized`;
    let result = await this.exec(
      computer.id,
      { command: "mkdir", args: ["-p", stateRoot, sourceRoot] },
      call,
    );
    if (result.exitCode !== 0)
      throw new ComputerProviderError(
        "provider_unavailable",
        `Could not prepare the development sandbox: ${result.stderr}`,
      );
    result = await this.exec(computer.id, { command: "chmod", args: ["0700", stateRoot] }, call);
    if (result.exitCode !== 0)
      throw new ComputerProviderError(
        "provider_unavailable",
        `Could not protect the development sandbox state: ${result.stderr}`,
      );

    result = await this.exec(computer.id, { command: "test", args: ["-f", sourceMarker] }, call);
    if (result.exitCode !== 0) {
      await this.#writeComputerFiles(
        computer.id,
        await developmentSandboxSourceFiles(context.repositoryRoot),
        call,
      );
      await this.writeFile(
        computer.id,
        sourceMarker,
        new TextEncoder().encode(await renderMarker("seeded")),
        call,
      );
    }

    await this.#writeComputerFiles(
      computer.id,
      await developmentSandboxConfigurationFiles(context.repositoryRoot),
      call,
    );
    result = await this.exec(
      computer.id,
      {
        command: "chmod",
        args: [
          "0600",
          `${sourceRoot}/configuration/.env`,
          `${sourceRoot}/configuration/.sops.yaml`,
          `${sourceRoot}/configuration/secrets.enc.yaml`,
        ],
      },
      call,
    );
    if (result.exitCode !== 0)
      throw new ComputerProviderError(
        "provider_unavailable",
        `Could not protect the development sandbox configuration: ${result.stderr}`,
      );

    const ageIdentity = context.environment.SOPS_AGE_KEY;
    if (!ageIdentity)
      throw new ComputerProviderError(
        "invalid_configuration",
        "The trusted development sandbox requires the sandbox SOPS age identity",
      );
    await this.writeFile(
      computer.id,
      ageKeyFile,
      new TextEncoder().encode(`${ageIdentity.trim()}\n`),
      call,
    );
    result = await this.exec(computer.id, { command: "chmod", args: ["0400", ageKeyFile] }, call);
    if (result.exitCode !== 0)
      throw new ComputerProviderError(
        "provider_unavailable",
        `Could not protect the development sandbox environment: ${result.stderr}`,
      );

    for (const agentId of request.agentWorkspaceIds ?? []) {
      result = await this.exec(
        computer.id,
        { command: "mkdir", args: ["-p", agentWorkspaceRoot(agentId)] },
        call,
      );
      if (result.exitCode !== 0)
        throw new ComputerProviderError(
          "provider_unavailable",
          `Could not prepare the ${agentId} workspace in the development sandbox: ${result.stderr}`,
        );
    }
    result = await this.exec(
      computer.id,
      {
        command: "/usr/local/bin/setup-openbot-development",
        args: [sourceRoot, ageKeyFile],
        timeoutMs: 1_200_000,
      },
      call,
    );
    if (result.exitCode !== 0)
      throw new ComputerProviderError(
        "provider_unavailable",
        `Could not initialize the development sandbox: ${result.stderr}`,
      );
    const serviceUrl = await this.computerServiceUrl(computer.id);
    await persistEnvironment(
      context,
      "DEVELOPMENT_SANDBOX_ID",
      computer.id,
      "Trusted development sandbox ID.",
    );
    await persistEnvironment(
      context,
      "DEVELOPMENT_SANDBOX_SERVICE_URL",
      serviceUrl,
      "Trusted development sandbox computer service URL.",
    );
    return {
      outputs: {
        "development-sandbox.computer-id": computer.id,
        "development-sandbox.service-url": serviceUrl,
      },
    };
  }

  async #registerAgentWorkspace(
    computerId: string,
    workspace: ComputerAgentWorkspace,
    context: ComputerCallContext,
  ) {
    if (workspace.files.length === 0) return;
    const root = agentWorkspaceRoot(workspace.agentId);
    const marker = `${root}/.openbot-agent`;
    let result = await this.exec(computerId, { command: "test", args: ["-f", marker] }, context);
    if (result.exitCode === 0) return;
    result = await this.exec(computerId, { command: "mkdir", args: ["-p", root] }, context);
    if (result.exitCode !== 0)
      throw new ComputerProviderError(
        "provider_unavailable",
        `Could not create workspace for agent ${workspace.agentId}: ${result.stderr}`,
      );
    for (const file of workspace.files) {
      const destination = `${root}/${agentWorkspaceRelativePath(file.path)}`;
      result = await this.exec(
        computerId,
        { command: "mkdir", args: ["-p", posix.dirname(destination)] },
        context,
      );
      if (result.exitCode !== 0)
        throw new ComputerProviderError(
          "provider_unavailable",
          `Could not create workspace directory for agent ${workspace.agentId}: ${result.stderr}`,
        );
      await this.writeFile(computerId, destination, file.content, context);
      if (file.executable)
        await this.exec(computerId, { command: "chmod", args: ["0755", destination] }, context);
    }
    await this.writeFile(
      computerId,
      marker,
      new TextEncoder().encode(await renderMarker(workspace.agentId)),
      context,
    );
  }

  protected async ensureAgentDesktop(
    computerId: string,
    agentId: string,
    context: ComputerCallContext,
  ): Promise<{ display: string; vncPort: number }> {
    const service = createClient(
      ComputerService,
      createConnectTransport({
        baseUrl: await this.computerServiceUrl(computerId),
        httpVersion: "1.1",
      }),
    );
    const request = {
      agentId,
      capability: scopedCapability(
        "vnc",
        computerId,
        agentId,
        computerServiceApiKey(context.environment?.COMPUTER_SERVICE_API_KEY),
      ),
    };
    const options = {
      headers: {
        authorization: `Bearer ${computerServiceApiKey(context.environment?.COMPUTER_SERVICE_API_KEY)}`,
      },
      ...(context.signal ? { signal: context.signal } : {}),
    };
    const ensure = () =>
      retryComputerServiceStartup(
        async () =>
          (await service.ensureDesktop(request, options)) as unknown as {
            display: string;
            vncPort: number;
          },
        context.signal,
      );
    try {
      return await ensure();
    } catch (error) {
      // A resumed computer can report "running" while its services are down; restart them once.
      if (!this.reviveComputerServices || !isServiceUnavailable(error)) throw error;
      await this.reviveComputerServices(computerId, context);
      return await ensure();
    }
  }

  /** Restart in-computer services after a resume left the instance running but unreachable. */
  protected reviveComputerServices?(id: string, context: ComputerCallContext): Promise<void>;

  /** Whether the running computer already uses the desired image reference. */
  protected computerImageMatches(
    _id: string,
    currentImage: string | undefined,
    desiredImage: string,
  ): boolean {
    return currentImage === desiredImage;
  }

  async #writeComputerFiles(
    computerId: string,
    files: readonly ComputerSeedFile[],
    context: ComputerCallContext,
  ): Promise<void> {
    for (const file of files) {
      const destination = computerWorkspacePath(file.path);
      const result = await this.exec(
        computerId,
        { command: "mkdir", args: ["-p", posix.dirname(destination)] },
        context,
      );
      if (result.exitCode !== 0)
        throw new ComputerProviderError(
          "provider_unavailable",
          `Could not create development source directory: ${result.stderr}`,
        );
      await this.writeFile(computerId, destination, file.content, context);
      if (file.executable) {
        const chmod = await this.exec(
          computerId,
          { command: "chmod", args: ["0755", destination] },
          context,
        );
        if (chmod.exitCode !== 0)
          throw new ComputerProviderError(
            "provider_unavailable",
            `Could not preserve executable source mode: ${chmod.stderr}`,
          );
      }
    }
  }

  async buildImage(
    spec: ComputerImageSpec,
    context: ComputerCallContext,
  ): Promise<BuiltComputerImage> {
    ensureDigest(spec.sourceDigest);
    const tag = `${spec.tagPrefix ?? "openbot-computer"}-${spec.sourceDigest.slice("sha256:".length, "sha256:".length + 12)}`;
    const localReference = `${spec.repository}:${tag}`;
    await runDocker(this.buildImageArguments(spec, localReference), context);
    return { sourceDigest: spec.sourceDigest, localReference };
  }

  protected buildImageArguments(spec: ComputerImageSpec, localReference: string): string[] {
    const args = [
      ...(this.#imageLifecycle.buildxPlatform
        ? ["buildx", "build", "--platform", this.#imageLifecycle.buildxPlatform, "--load"]
        : ["build"]),
      "--file",
      spec.dockerfilePath,
      "--tag",
      localReference,
      "--label",
      `org.openbot.computer.source-digest=${spec.sourceDigest}`,
    ];
    for (const [name, value] of Object.entries(spec.buildArguments ?? {}).sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      args.push("--build-arg", `${name}=${value}`);
    }
    args.push(spec.contextDirectory);
    return args;
  }

  async publishImage(
    image: BuiltComputerImage,
    spec: ComputerImageSpec,
    context: ComputerCallContext,
  ): Promise<PublishedComputerImage> {
    ensureDigest(image.sourceDigest);
    const tag = `${spec.tagPrefix ?? "openbot-computer"}-${image.sourceDigest.slice("sha256:".length, "sha256:".length + 12)}`;
    const reference = `${spec.repository}:${tag}`;
    if (reference !== image.localReference)
      await runDocker(["tag", image.localReference, reference], context);
    await runDocker(["push", reference], context);
    return { ...image, reference, publishedAt: new Date() };
  }

  protected async imageRepository(
    context: DeploymentContext,
    _phase: "build" | "plan" | "deploy",
  ): Promise<string> {
    const repository =
      this.#imageDeployment.repository ?? context.environment.COMPUTER_IMAGE_REPOSITORY;
    const selected =
      repository?.trim() ||
      (!this.#imageLifecycle.publish
        ? await localComputerImageRepository(context.repositoryRoot)
        : undefined);
    if (!selected)
      throw new ComputerProviderError(
        "invalid_configuration",
        "COMPUTER_IMAGE_REPOSITORY is required to build and deploy computer images",
      );
    if (selected.includes("://") || /\s/.test(selected))
      throw new ComputerProviderError(
        "invalid_configuration",
        "Computer image repository must be an OCI repository without a URL scheme or whitespace",
      );
    const normalized = selected.replace(/\/$/, "");
    if (
      normalized.includes("@") ||
      normalized.slice(normalized.lastIndexOf("/") + 1).includes(":")
    ) {
      throw new ComputerProviderError(
        "invalid_configuration",
        "Computer image repository must not include an image tag or digest",
      );
    }
    return normalized;
  }

  protected async authenticateImageRepository(
    _context: DeploymentContext,
    _spec: ComputerImageSpec,
    _callContext: ComputerCallContext,
  ): Promise<void> {}

  protected runDockerWithInput(
    args: readonly string[],
    input: string,
    context: ComputerCallContext,
  ): Promise<void> {
    return runDockerWithInput(args, input, context);
  }

  protected runDocker(args: readonly string[], context: ComputerCallContext): Promise<void> {
    return runDocker([...args], context);
  }

  protected async prepareDeployedImage(
    image: PublishedComputerImage,
    _spec: ComputerImageSpec,
    _context: ComputerCallContext,
  ): Promise<PublishedComputerImage> {
    return image;
  }

  async #imageSpec(
    context: DeploymentContext,
    materialized: { contextDirectory: string; dockerfilePath: string; sourceDigest: string },
    phase: "build" | "deploy",
  ): Promise<ComputerImageSpec> {
    return {
      ...materialized,
      repository: await this.imageRepository(context, phase),
      ...(this.#imageDeployment.tagPrefix ? { tagPrefix: this.#imageDeployment.tagPrefix } : {}),
      ...(this.#imageDeployment.buildArguments
        ? { buildArguments: this.#imageDeployment.buildArguments }
        : {}),
    };
  }

  #outputName(suffix: string): string {
    return `${this.providerId.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase()}_IMAGE_${suffix}`;
  }
}

export function isServiceUnavailable(error: unknown): boolean {
  const failure = ConnectError.from(error);
  return [Code.Aborted, Code.Unavailable, Code.Unknown].includes(failure.code);
}

export async function retryComputerServiceStartup<T>(
  operation: () => Promise<T>,
  signal?: AbortSignal,
  options: { attempts?: number; delayMs?: number } = {},
): Promise<T> {
  const attempts = options.attempts ?? 60;
  const delayMs = options.delayMs ?? 250;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (signal?.aborted) throw error;
      const failure = ConnectError.from(error);
      const retryable = [Code.Aborted, Code.Unavailable, Code.Unknown].includes(failure.code);
      if (attempt >= attempts || !retryable) throw error;
      await delay(delayMs, undefined, signal ? { signal } : undefined);
    }
  }
}

async function localComputerImageRepository(repositoryRoot: string): Promise<string> {
  try {
    const { stdout } = await execute("git", ["config", "--get", "remote.origin.url"], {
      cwd: repositoryRoot,
    });
    const normalized = stdout
      .trim()
      .replace(/\.git$/, "")
      .replace(/\/$/, "");
    const match = normalized.match(/(?:^|[:/])([^/:]+)\/([^/]+)$/);
    if (match)
      return `${dockerRepositoryPart(match[1]!)}/${dockerRepositoryPart(match[2]!)}-computer`;
  } catch {
    // A source archive may not have Git metadata; use a stable local-only fallback.
  }
  return `openbot/${dockerRepositoryPart(basename(repositoryRoot))}-computer`;
}

function dockerRepositoryPart(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^[._-]+|[._-]+$/g, "") || "openbot"
  );
}

async function renderMarker(value: string): Promise<string> {
  return renderFileTemplatePath(computerImageAssets.marker, { VALUE: value });
}

export function randomCapability(): string {
  return randomBytes(32).toString("base64url");
}

export function deterministicComputerId(prefix: string, requested?: string): string {
  if (requested) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/.test(requested))
      throw new ComputerProviderError("invalid_configuration", "Computer id is invalid");
    return requested;
  }
  return `${prefix}-${randomBytes(12).toString("hex")}`;
}

export function imageSourceDigest(parts: readonly (string | Uint8Array)[]): string {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part).update("\0");
  return `sha256:${hash.digest("hex")}`;
}

export function computerWorkspacePath(path: string, agentId?: string): string {
  if (!path || path.includes("\0"))
    throw new ComputerProviderError("invalid_configuration", "A valid computer path is required");
  if (path.startsWith("/")) return posix.normalize(path);
  const root = agentId ? agentWorkspaceRoot(agentId) : "/workspace";
  return logicalComputerPath(path, root);
}

export function scopeComputerExecRequest(
  request: ComputerExecRequest,
  agentId?: string,
): ComputerExecRequest {
  if (!agentId) return request;
  const root = agentWorkspaceRoot(agentId);
  return {
    ...request,
    cwd: request.cwd ? logicalComputerPath(request.cwd, root) : root,
    environment: {
      HOME: root,
      AGENT_ID: agentId,
      COMPUTER_WORKSPACE: root,
      ...request.environment,
    },
    timeoutMs: request.timeoutMs,
  };
}

export function logicalComputerPath(path: string, root = "/workspace"): string {
  if (!path || path.includes("\0"))
    throw new ComputerProviderError("invalid_configuration", "A valid computer path is required");
  return path.startsWith("/") ? posix.normalize(path) : posix.resolve(root, path);
}

export function agentWorkspaceRoot(agentId: string): string {
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(agentId))
    throw new ComputerProviderError("invalid_configuration", `Invalid agent id: ${agentId}`);
  return `/workspace/${agentId}`;
}

function agentWorkspaceRelativePath(path: string): string {
  return workspaceRelativePath(path);
}

function workspaceRelativePath(path: string): string {
  const relative = path.startsWith("/workspace/")
    ? path.slice("/workspace/".length)
    : path === "/workspace"
      ? "."
      : path;
  if (!relative || relative.startsWith("/") || relative.includes("\0"))
    throw new ComputerProviderError("permission_denied", "Computer path must be inside /workspace");
  const normalized = posix.normalize(relative);
  if (normalized === ".." || normalized.startsWith("../"))
    throw new ComputerProviderError("permission_denied", "Computer path escapes /workspace");
  return normalized;
}

async function runDocker(args: string[], context: ComputerCallContext): Promise<void> {
  await runDockerProcess(args, undefined, context);
}

async function runDockerWithInput(
  args: readonly string[],
  input: string,
  context: ComputerCallContext,
): Promise<void> {
  await runDockerProcess(args, input, context);
}

async function runDockerProcess(
  args: readonly string[],
  input: string | undefined,
  context: ComputerCallContext,
): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const timeout = deadlineTimeout(context);
    const child = spawn("docker", [...args], { stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    let settled = false;
    let timedOut = false;
    const abort = () => child.kill("SIGTERM");
    const timer =
      timeout === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            abort();
          }, timeout);
    const settle = (result: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      context.signal?.removeEventListener("abort", abort);
      result();
    };
    const report = (stream: "stdout" | "stderr", chunk: Buffer | string) => {
      const output = chunk.toString();
      if (stream === "stderr") stderr = `${stderr}${output}`.slice(-16 * 1024 * 1024);
      context.report?.({
        event: "provider.command.output",
        details: { providerId: "computer", command: "docker", stream, output },
      });
    };
    child.stdout.on("data", (chunk: Buffer) => report("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => report("stderr", chunk));
    context.signal?.addEventListener("abort", abort, { once: true });
    child.once("error", (error) =>
      settle(() =>
        reject(
          new ComputerProviderError(
            "provider_unavailable",
            `Computer image command failed: ${error.message}`,
          ),
        ),
      ),
    );
    child.once("close", (code) => {
      if (context.signal?.aborted) {
        settle(() => reject(context.signal?.reason ?? new Error("Docker command was aborted")));
        return;
      }
      if (timedOut) {
        settle(() =>
          reject(
            new ComputerProviderError(
              "deadline_exceeded",
              `docker ${args.join(" ")} failed after reaching its deadline${stderr.trim() ? `: ${stderr.trim()}` : ""}`,
            ),
          ),
        );
        return;
      }
      if (code === 0) settle(resolvePromise);
      else
        settle(() =>
          reject(
            new ComputerProviderError(
              "provider_unavailable",
              `docker ${args.join(" ")} failed${stderr.trim() ? `: ${stderr.trim()}` : ""}`,
            ),
          ),
        );
    });
    child.stdin.end(input ?? undefined);
  });
}

function deploymentCallContext(
  phase: string,
  context: Pick<DeploymentContext, "report">,
): ComputerCallContext {
  return { requestId: `computer-image:${phase}`, report: context.report };
}

function deadlineTimeout(context: ComputerCallContext): number | undefined {
  if (!context.deadline) return undefined;
  const timeout = context.deadline.getTime() - Date.now();
  if (timeout <= 0)
    throw new ComputerProviderError("deadline_exceeded", "Computer provider deadline has passed");
  return timeout;
}

function ensureDigest(digest: string): void {
  if (!/^sha256:[a-f0-9]{64}$/.test(digest))
    throw new ComputerProviderError(
      "invalid_configuration",
      "Computer image source digest is invalid",
    );
}
