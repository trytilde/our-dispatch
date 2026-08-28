import { ExeDevPlatform, exeDevPlatform } from "@tryopenbot/platform-integrations";
import type { DeploymentContext } from "@tryopenbot/runtime-provider";
import type {
  ComputerCallContext,
  ComputerExecRequest,
  ComputerProvider,
  ComputerSpec,
  DeployAgentWorkspacesRequest,
  DeployDevelopmentSandboxRequest,
} from "../core/index.js";
import { HostComputerProvider } from "../host/index.js";

export interface ExeDevComputerProviderOptions {
  platform?: ExeDevPlatform;
  computer?: ComputerProvider;
}

/**
 * Runs the Computer inside the same exe.dev VM as the watched runtime. The outer production
 * lifecycle is owned by ExeDevRuntimeServiceProvider; inside the VM the host itself is the Computer
 * and noVNC is published through the Vite origin.
 */
export class ExeDevComputerProvider implements ComputerProvider {
  readonly platform: ExeDevPlatform;
  readonly platforms: readonly ExeDevPlatform[];
  readonly buildable;
  readonly deployable;
  readonly #computer: ComputerProvider;

  constructor(options: ExeDevComputerProviderOptions = {}) {
    this.platform = options.platform ?? exeDevPlatform;
    this.platforms = [this.platform];
    this.#computer = options.computer ?? new HostComputerProvider();
    this.buildable = this.#computer.buildable!;
    this.deployable = this.#computer.deployable!;
  }

  /** The outer deploy installs one VM; its inner dev lifecycle owns the Computer image. */
  get externallyManagedLifecycle(): boolean {
    return process.env.EXE_DEV_INSIDE_VM !== "1";
  }

  async previewAgentDesktop(agentId: string, context: ComputerCallContext) {
    const endpoint = await this.#computer.previewAgentDesktop(agentId, context);
    const publicUrl = new URL(
      "/computer-vnc/openbot.html",
      this.platform.connection(context.environment ?? process.env).publicOrigin,
    );
    for (const [name, value] of endpoint.url.searchParams) publicUrl.searchParams.set(name, value);
    const websocketPath = publicUrl.searchParams.get("path") ?? "websockify";
    publicUrl.searchParams.set("path", `computer-vnc/${websocketPath}`);
    return { ...endpoint, url: publicUrl };
  }

  deployAgentWorkspaces(request: DeployAgentWorkspacesRequest, context: DeploymentContext) {
    return this.#computer.deployAgentWorkspaces(request, context);
  }

  deployDevelopmentSandbox(request: DeployDevelopmentSandboxRequest, context: DeploymentContext) {
    return this.#computer.deployDevelopmentSandbox(request, context);
  }

  create(spec: ComputerSpec, context: ComputerCallContext) {
    return requiredLifecycle(this.#computer).create(spec, context);
  }
  get(id: string, context: ComputerCallContext) {
    return requiredLifecycle(this.#computer).get(id, context);
  }
  wake(id: string, context: ComputerCallContext) {
    return requiredLifecycle(this.#computer).wake(id, context);
  }
  sleep(id: string, context: ComputerCallContext) {
    return requiredLifecycle(this.#computer).sleep(id, context);
  }
  delete(id: string, context: ComputerCallContext) {
    return requiredLifecycle(this.#computer).delete(id, context);
  }
  exec(id: string, request: ComputerExecRequest, context: ComputerCallContext) {
    return requiredLifecycle(this.#computer).exec(id, request, context);
  }
  readFile(id: string, path: string, context: ComputerCallContext) {
    return requiredLifecycle(this.#computer).readFile(id, path, context);
  }
  writeFile(id: string, path: string, content: Uint8Array, context: ComputerCallContext) {
    return requiredLifecycle(this.#computer).writeFile(id, path, content, context);
  }
  vnc(id: string, context: ComputerCallContext) {
    return requiredLifecycle(this.#computer).vnc(id, context);
  }
}

type ComputerLifecycle = Pick<
  HostComputerProvider,
  "create" | "get" | "wake" | "sleep" | "delete" | "exec" | "readFile" | "writeFile" | "vnc"
>;

function requiredLifecycle(provider: ComputerProvider): ComputerLifecycle {
  return provider as ComputerProvider & ComputerLifecycle;
}
