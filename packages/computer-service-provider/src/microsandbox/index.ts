import { createServer } from "node:net";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import {
  ComputerProviderError,
  type ComputerCallContext,
  type ComputerExecRequest,
  type ComputerHandle,
  type ComputerInput,
  type ComputerImageSpec,
  type ComputerSpec,
  type PublishedComputerImage,
} from "../core/index.js";
import {
  BaseComputerProvider,
  computerWorkspacePath,
  deterministicComputerId,
  scopeComputerExecRequest,
  type ComputerImageDeploymentConfig,
} from "../base/index.js";
import { computerServiceApiKey, scopedCapability } from "../capability.js";

type MicroSandbox = Awaited<
  ReturnType<(typeof import("microsandbox"))["Sandbox"]["startDetached"]>
>;

export class MicrosandboxComputerProvider extends BaseComputerProvider {
  protected readonly providerId = "microsandbox";
  protected readonly deployedImageEnvironmentVariable = "MICROSANDBOX_COMPUTER_IMAGE";

  readonly #instances = new Map<string, MicroSandbox>();
  readonly #handles = new Map<string, ComputerHandle>();
  readonly #specs = new Map<string, ComputerSpec>();
  readonly #desktopPorts = new Map<string, number>();
  readonly #servicePorts = new Map<string, number>();

  constructor(imageDeployment: ComputerImageDeploymentConfig = {}) {
    super(imageDeployment, { publish: false });
  }

  protected override async prepareDeployedImage(
    image: PublishedComputerImage,
    spec: ComputerImageSpec,
    context: ComputerCallContext,
  ): Promise<PublishedComputerImage> {
    const archive = resolve(
      spec.contextDirectory,
      `.openbot-microsandbox-${image.sourceDigest.slice("sha256:".length, "sha256:".length + 12)}.tar`,
    );
    try {
      await this.runDocker(["save", "--output", archive, image.localReference], context);
      await this.loadImageArchive(archive, image.reference);
      return image;
    } finally {
      await rm(archive, { force: true });
    }
  }

  protected async loadImageArchive(path: string, reference: string): Promise<void> {
    const { Image } = await import("microsandbox");
    await Image.load(path, { tag: reference });
  }

  async create(spec: ComputerSpec, context: ComputerCallContext): Promise<ComputerHandle> {
    const id = deterministicComputerId("openbot", spec.id);
    if (this.#handles.has(id))
      throw new ComputerProviderError("invalid_configuration", `Computer ${id} already exists`);
    this.#specs.set(id, spec);
    return this.#start(id, spec, "create", context);
  }

  async get(id: string, _context: ComputerCallContext): Promise<ComputerHandle> {
    const handle = this.#handles.get(id);
    if (handle) return handle;
    try {
      const { Sandbox } = await import("microsandbox");
      const stored = await Sandbox.get(id);
      if (stored.status === "running") this.#instances.set(id, await stored.connect());
      const config = stored.config();
      const desktopPort = publishedHostPort(config, 6080);
      const servicePort = publishedHostPort(config, 4101);
      const image = configuredImageReference(config);
      if (desktopPort) this.#desktopPorts.set(id, desktopPort);
      if (servicePort) this.#servicePorts.set(id, servicePort);
      const discovered: ComputerHandle = {
        id,
        providerId: this.providerId,
        state:
          stored.status === "running"
            ? "running"
            : stored.status === "crashed"
              ? "failed"
              : "sleeping",
        createdAt: stored.createdAt ?? new Date(),
        ...(image ? { image } : {}),
      };
      this.#handles.set(id, discovered);
      return discovered;
    } catch (error) {
      throw new ComputerProviderError(
        "not_found",
        `Computer ${id} was not found: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  async wake(id: string, context: ComputerCallContext): Promise<ComputerHandle> {
    const current = await this.get(id, context);
    if (current.state === "running") return current;
    const { Sandbox } = await import("microsandbox");
    const stored = await Sandbox.get(id);
    const resumed = await stored.startDetached();
    this.#instances.set(id, resumed);
    const spec = this.#specs.get(id);
    await runSpecLifecycle(resumed, spec ?? {}, "wake");
    const start = await resumed.exec("bash", [
      "-lc",
      "nohup /usr/local/bin/start-openbot-computer >/var/log/openbot-computer.log 2>&1 </dev/null &",
    ]);
    if (!start.success)
      throw new ComputerProviderError(
        "provider_unavailable",
        `Computer start failed: ${start.stderr() || start.stdout()}`,
      );
    const running = { ...current, state: "running" as const };
    this.#handles.set(id, running);
    return running;
  }

  async sleep(id: string, context: ComputerCallContext): Promise<ComputerHandle> {
    const current = await this.get(id, context);
    await this.#instances.get(id)?.stop();
    this.#instances.delete(id);
    const sleeping = { ...current, state: "sleeping" as const };
    this.#handles.set(id, sleeping);
    return sleeping;
  }

  async delete(id: string, context: ComputerCallContext): Promise<void> {
    await this.get(id, context);
    await this.#instances
      .get(id)
      ?.stop()
      .catch(() => undefined);
    const { Sandbox } = await import("microsandbox");
    const stored = await Sandbox.get(id);
    if (stored.status === "running") await stored.stop();
    await stored.remove();
    this.#instances.delete(id);
    this.#handles.delete(id);
    this.#specs.delete(id);
    this.#desktopPorts.delete(id);
    this.#servicePorts.delete(id);
  }

  async exec(id: string, request: ComputerExecRequest, _context: ComputerCallContext) {
    const sandbox = this.#requiredInstance(id);
    const scoped = scopeComputerExecRequest(request, _context.agentId);
    const environment = Object.entries(scoped.environment ?? {}).map(
      ([name, value]) => `${name}=${value}`,
    );
    const output = await sandbox.exec("env", [
      ...(scoped.cwd ? ["--chdir", scoped.cwd] : []),
      ...environment,
      scoped.command,
      ...(scoped.args ?? []),
    ]);
    return { exitCode: output.code, stdout: output.stdout(), stderr: output.stderr() };
  }

  async readFile(id: string, path: string, _context: ComputerCallContext): Promise<Uint8Array> {
    return new Uint8Array(
      await this.#requiredInstance(id).fs().read(computerWorkspacePath(path, _context.agentId)),
    );
  }

  async writeFile(
    id: string,
    path: string,
    content: Uint8Array,
    _context: ComputerCallContext,
  ): Promise<void> {
    await this.#requiredInstance(id)
      .fs()
      .write(computerWorkspacePath(path, _context.agentId), Buffer.from(content));
  }

  async screenshot(id: string, context: ComputerCallContext): Promise<Uint8Array> {
    if (!context.agentId)
      throw new ComputerProviderError(
        "invalid_configuration",
        "agentId is required for screenshots",
      );
    const desktop = await this.ensureAgentDesktop(id, context.agentId, context);
    const screenshotPath = "/tmp/openbot-tool-screenshot.png";
    const result = await this.exec(
      id,
      {
        command: "import",
        args: ["-display", desktop.display, "-window", "root", screenshotPath],
      },
      { ...context, agentId: undefined },
    );
    if (result.exitCode !== 0)
      throw new ComputerProviderError(
        "provider_unavailable",
        `Screenshot failed: ${result.stderr}`,
      );
    return new Uint8Array(await this.#requiredInstance(id).fs().read(screenshotPath));
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
    await this.get(id, context);
    const port = this.#desktopPorts.get(id);
    if (!port) throw new ComputerProviderError("not_found", `Computer ${id} has no VNC port`);
    // Stock noVNC transport, without its settings drawer and toolbar: the OpenBot shell owns the
    // take-control, fullscreen, reconnect, and close controls around this canvas.
    const url = new URL(`http://127.0.0.1:${port}/openbot.html`);
    const capability = scopedCapability("vnc", id, context.agentId);
    // The chrome-free viewer reads its WebSocket path; carry the TokenFile capability there.
    url.searchParams.set("path", `websockify?token=${capability}`);
    url.searchParams.set("scale", "true");
    return { url, expiresAt: new Date(Date.now() + 86_400_000) };
  }

  protected async computerServiceUrl(id: string): Promise<string> {
    await this.get(id, { requestId: "computer-service-url" });
    const configured = process.env.MICROSANDBOX_COMPUTER_SERVICE_URL?.trim();
    if (configured) return configured;
    const port = this.#servicePorts.get(id);
    if (!port)
      throw new ComputerProviderError(
        "invalid_configuration",
        "The Microsandbox computer-service port is unknown; set MICROSANDBOX_COMPUTER_SERVICE_URL when attaching to an existing computer",
      );
    return `http://127.0.0.1:${port}/rpc`;
  }

  async #start(
    id: string,
    spec: ComputerSpec,
    phase: "create" | "wake",
    _context: ComputerCallContext,
  ): Promise<ComputerHandle> {
    const { Sandbox } = await import("microsandbox");
    const desktopPort = this.#desktopPorts.get(id) ?? (await availablePort(6080));
    const servicePort = await availablePort(4101);
    const image = spec.image ?? process.env.MICROSANDBOX_COMPUTER_IMAGE;
    if (!image)
      throw new ComputerProviderError(
        "invalid_configuration",
        "Deploy the Microsandbox computer provider or set MICROSANDBOX_COMPUTER_IMAGE before creating a computer",
      );

    const sandbox = await Sandbox.builder(id)
      .image(image)
      .pullPolicy("never")
      .cpus(2)
      .memory(4096)
      .rootDisk(12_288)
      .portBind("127.0.0.1", desktopPort, 6080)
      .portBind("127.0.0.1", servicePort, 4101)
      .volume("/workspace", (mount) =>
        mount.namedWith("openbot-computer", "ensure-exists", "dir", undefined, 8192),
      )
      .envs({
        DISPLAY: ":1",
        COMPUTER_SERVICE_API_KEY: computerServiceApiKey(),
        COMPUTER_ID: id,
        COMPUTER_EXPOSED_PORTS: "6080,4101",
        COMPUTER_SERVICE_PORT: "4101",
        COMPUTER_WORKSPACE: "/workspace",
        ...spec.environment,
      })
      .detached(true)
      .create();

    try {
      const bootstrap = await sandbox.exec("bash", ["/opt/openbot/bootstrap.sh"]);
      if (!bootstrap.success)
        throw new ComputerProviderError(
          "provider_unavailable",
          `Computer bootstrap failed: ${bootstrap.stderr() || bootstrap.stdout()}`,
        );
      await seedComputer(sandbox, spec);
      await runSpecLifecycle(sandbox, spec, phase);
      const start = await sandbox.exec("bash", [
        "-lc",
        "nohup /usr/local/bin/start-openbot-computer >/var/log/openbot-computer.log 2>&1 </dev/null &",
      ]);
      if (!start.success)
        throw new ComputerProviderError(
          "provider_unavailable",
          `Computer start failed: ${start.stderr() || start.stdout()}`,
        );
    } catch (error) {
      await sandbox.stop().catch(() => undefined);
      throw error;
    }

    const existing = this.#handles.get(id);
    const handle: ComputerHandle = {
      id,
      providerId: this.providerId,
      state: "running",
      createdAt: existing?.createdAt ?? new Date(),
      image,
    };
    this.#instances.set(id, sandbox);
    this.#handles.set(id, handle);
    this.#desktopPorts.set(id, desktopPort);
    this.#servicePorts.set(id, servicePort);
    return handle;
  }

  #requiredInstance(id: string): MicroSandbox {
    const sandbox = this.#instances.get(id);
    if (!sandbox)
      throw new ComputerProviderError("not_found", `Computer ${id} is sleeping or not attached`);
    return sandbox;
  }
}

export function publishedHostPort(config: Record<string, unknown>, guestPort: number): number {
  const network = config.network;
  if (!network || typeof network !== "object") return 0;
  const ports = (network as { ports?: unknown }).ports;
  if (!Array.isArray(ports)) return 0;
  for (const candidate of ports) {
    if (!candidate || typeof candidate !== "object") continue;
    const port = candidate as { guestPort?: unknown; hostPort?: unknown };
    if (
      port.guestPort === guestPort &&
      typeof port.hostPort === "number" &&
      Number.isSafeInteger(port.hostPort) &&
      port.hostPort > 0 &&
      port.hostPort <= 65_535
    )
      return port.hostPort;
  }
  return 0;
}

export function configuredImageReference(config: Record<string, unknown>): string {
  if (typeof config.image === "string") return config.image;
  if (!config.image || typeof config.image !== "object") return "";
  const image = config.image as { Oci?: unknown; oci?: unknown; reference?: unknown };
  if (typeof image.reference === "string") return image.reference;
  const oci = image.Oci ?? image.oci;
  if (!oci || typeof oci !== "object") return "";
  const reference = (oci as { reference?: unknown }).reference;
  return typeof reference === "string" ? reference : "";
}

async function seedComputer(sandbox: MicroSandbox, spec: ComputerSpec): Promise<void> {
  const fs = sandbox.fs();
  for (const file of spec.files ?? []) {
    const destination = computerWorkspacePath(file.path);
    await sandbox.exec("mkdir", [
      "-p",
      destination.slice(0, destination.lastIndexOf("/")) || "/workspace",
    ]);
    await fs.write(destination, Buffer.from(file.content));
    await sandbox.exec("chmod", [file.executable ? "0755" : "0644", destination]);
  }
}

async function runSpecLifecycle(
  sandbox: MicroSandbox,
  spec: ComputerSpec,
  phase: "create" | "wake",
): Promise<void> {
  for (const script of spec.lifecycle?.filter((candidate) => candidate.phases.includes(phase)) ??
    []) {
    const path = computerWorkspacePath(script.path);
    const result = await sandbox.exec("bash", [path]);
    if (!result.success)
      throw new ComputerProviderError(
        "provider_unavailable",
        `Computer lifecycle ${script.id} failed: ${result.stderr() || result.stdout()}`,
      );
  }
}

async function availablePort(start: number): Promise<number> {
  for (let port = start; port < start + 100; port += 1) {
    const available = await new Promise<boolean>((resolve) => {
      const server = createServer();
      server.once("error", () => resolve(false));
      server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
    });
    if (available) return port;
  }
  throw new ComputerProviderError("provider_unavailable", "No local computer port is available");
}

function inputArguments(input: ComputerInput): string[] {
  if (input.action === "mouse_move")
    return ["mousemove", "--sync", String(input.x), String(input.y)];
  if (input.action === "click") return ["click", String(input.button ?? 1)];
  if (input.action === "type") return ["type", "--delay", String(input.delayMs ?? 10), input.text];
  return ["key", input.key];
}
