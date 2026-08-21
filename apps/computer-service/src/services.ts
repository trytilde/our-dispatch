import { execFile, spawn } from "node:child_process";
import { createConnection } from "node:net";
import { posix } from "node:path";
import { promisify } from "node:util";
import { Code, ConnectError, type ConnectRouter, type HandlerContext } from "@connectrpc/connect";
import { ComputerService } from "@tryopenbot/computer-service-proto";
import { agentCommand, agentVisiblePath } from "./agent.js";
import { BackgroundExecRegistry } from "./background-exec.js";
import { validComputerServiceApiKey } from "./capability.js";
import { applyLifecycleBundle, lifecycleDigest, runLifecycle } from "./lifecycle.js";
import { ensureAgentDesktop } from "./desktop.js";
import { callCuaTool as invokeCuaTool, listCuaTools as readCuaTools } from "./cua.js";

const execute = promisify(execFile);
const backgroundExec = new BackgroundExecRegistry();

function authorized(context: HandlerContext): void {
  const token = process.env.COMPUTER_SERVICE_API_KEY;
  if (!token || token.length < 32)
    throw new ConnectError("Computer service API key is not configured", Code.Unavailable);
  if (!validComputerServiceApiKey(context.requestHeader.get("authorization"), token))
    throw new ConnectError("Computer service API key required", Code.PermissionDenied);
}

async function vncReady(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({
      host: "127.0.0.1",
      port: Number(process.env.COMPUTER_NOVNC_PORT ?? 6080),
    });
    const finish = (ready: boolean) => {
      socket.destroy();
      resolve(ready);
    };
    socket.setTimeout(250);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}

export function registerComputerService(router: ConnectRouter): void {
  router.service(ComputerService, {
    async health(_request, context) {
      authorized(context);
      return {
        healthy: true,
        version: "0.1.0",
        lifecycleDigest: await lifecycleDigest(),
        vncReady: await vncReady(),
      };
    },
    async applyLifecycleBundle(request, context) {
      authorized(context);
      return { digest: request.digest, changed: await applyLifecycleBundle(request) };
    },
    async runLifecycle(request, context) {
      authorized(context);
      return {
        digest: await lifecycleDigest(),
        results: await runLifecycle(request.phase, request.expectedDigest, context.signal),
      };
    },
    async exec(request, context) {
      authorized(context);
      const scoped = agentCommand(request.agentId, request.command, request.arguments, {
        ...(request.cwd ? { cwd: request.cwd } : {}),
        environment: request.environment,
      });
      if (request.background)
        return await backgroundExec.start(request.agentId, scoped, request.timeoutMilliseconds);
      try {
        const result = await execute(scoped.command, scoped.arguments, {
          cwd: scoped.cwd,
          env: scoped.environment,
          signal: context.signal,
          timeout: request.timeoutMilliseconds || 120_000,
          maxBuffer: 16 * 1024 * 1024,
        });
        return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
      } catch (error) {
        const failure = error as Error & {
          code?: number | string;
          stdout?: string;
          stderr?: string;
        };
        return {
          exitCode: typeof failure.code === "number" ? failure.code : 1,
          stdout: failure.stdout ?? "",
          stderr: failure.stderr ?? failure.message,
        };
      }
    },
    async awaitExec(request, context) {
      authorized(context);
      return backgroundExec.wait(
        request.agentId,
        request.jobId,
        request.timeoutMilliseconds,
        context.signal,
      );
    },
    async readFile(request, context) {
      authorized(context);
      const scoped = agentCommand(request.agentId, "cat", [
        agentVisiblePath(request.agentId, request.path),
      ]);
      return { content: await executeBytes(scoped, context.signal) };
    },
    async writeFile(request, context) {
      authorized(context);
      const path = agentVisiblePath(request.agentId, request.path);
      const directory = posix.dirname(path);
      const prepare = agentCommand(request.agentId, "mkdir", ["-p", directory]);
      await execute(prepare.command, prepare.arguments, {
        cwd: prepare.cwd,
        env: prepare.environment,
        signal: context.signal,
      });
      const scoped = agentCommand(request.agentId, "tee", [path]);
      await executeWithInput(scoped, request.content, context.signal);
      if (request.mode) {
        const chmod = agentCommand(request.agentId, "chmod", [request.mode.toString(8), path]);
        await execute(chmod.command, chmod.arguments, {
          cwd: chmod.cwd,
          env: chmod.environment,
          signal: context.signal,
        });
      }
      return { bytesWritten: BigInt(request.content.byteLength) };
    },
    async screenshot(request, context) {
      authorized(context);
      const result = await invokeCuaTool(
        request.agentId,
        "get_desktop_state",
        "{}",
        context.signal,
      );
      const image = result.content.find((item) => item.content.case === "image");
      if (!image || image.content.case !== "image")
        throw new ConnectError("Cua Driver did not return a screenshot", Code.DataLoss);
      return { png: image.content.value.data };
    },
    async input(request, context) {
      authorized(context);
      const input = await cuaCompatibilityInput(
        request.agentId,
        request.action,
        request.payloadJson,
        context.signal,
      );
      const result = await invokeCuaTool(
        request.agentId,
        input.name,
        JSON.stringify(input.arguments),
        context.signal,
      );
      return { accepted: !result.isError };
    },
    async listCuaTools(request, context) {
      authorized(context);
      const tools = await readCuaTools(request.agentId, context.signal);
      return {
        tools: tools.map((entry) => ({
          name: entry.name,
          description: entry.description,
          inputSchemaJson: JSON.stringify(entry.inputSchema),
        })),
      };
    },
    async callCuaTool(request, context) {
      authorized(context);
      return await invokeCuaTool(
        request.agentId,
        request.name,
        request.argumentsJson,
        context.signal,
      );
    },
    async ensureDesktop(request, context) {
      authorized(context);
      const requestId = context.requestHeader.get("x-openbot-request-id")?.trim() || undefined;
      const startedAt = Date.now();
      console.info("[openbot-vnc] computer desktop requested", {
        agentId: request.agentId,
        hasCapability: Boolean(request.capability),
        requestId,
      });
      try {
        const desktop = await ensureAgentDesktop(
          request.agentId,
          request.capability || undefined,
          context.signal,
          requestId,
        );
        console.info("[openbot-vnc] computer desktop ready", {
          agentId: request.agentId,
          display: desktop.display,
          elapsedMs: Date.now() - startedAt,
          requestId,
          vncPort: desktop.vncPort,
        });
        return { display: desktop.display, vncPort: desktop.vncPort };
      } catch (error) {
        console.error(
          "[openbot-vnc] computer desktop failed",
          { agentId: request.agentId, elapsedMs: Date.now() - startedAt, requestId },
          error instanceof Error ? error : new Error(String(error)),
        );
        throw error;
      }
    },
    async listPorts(_request, context) {
      authorized(context);
      const ports = (process.env.COMPUTER_EXPOSED_PORTS ?? "6080,4101")
        .split(",")
        .map(Number)
        .filter((port) => Number.isSafeInteger(port) && port > 0 && port <= 65_535);
      return { ports: ports.map((port) => ({ port, protocol: "tcp" })) };
    },
    async *tunnelVnc(request, context) {
      authorized(context);
      const iterator = request[Symbol.asyncIterator]();
      const first = await iterator.next();
      if (first.done) return;
      const agentId = first.value.agentId;
      const desktop = await ensureAgentDesktop(agentId, undefined, context.signal);
      const socket = createConnection({
        host: "127.0.0.1",
        port: desktop.vncPort,
      });
      const writer = (async () => {
        if (first.value.data.length > 0) socket.write(first.value.data);
        for await (const frame of { [Symbol.asyncIterator]: () => iterator }) {
          if (frame.agentId !== agentId)
            throw new ConnectError("A VNC tunnel cannot change agent_id", Code.InvalidArgument);
          if (!socket.write(frame.data))
            await new Promise<void>((resolve) => socket.once("drain", resolve));
        }
        socket.end();
      })();
      const abort = () => socket.destroy(new Error("VNC tunnel aborted"));
      context.signal.addEventListener("abort", abort, { once: true });
      try {
        for await (const data of socket) yield { data: new Uint8Array(data) };
        await writer;
      } finally {
        context.signal.removeEventListener("abort", abort);
        socket.destroy();
      }
    },
  });
}

function executeBytes(
  command: ReturnType<typeof agentCommand>,
  signal: AbortSignal,
  maxBuffer = 16 * 1024 * 1024,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    execFile(
      command.command,
      command.arguments,
      { cwd: command.cwd, encoding: "buffer", env: command.environment, maxBuffer, signal },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(new Uint8Array(stdout));
      },
    );
  });
}

function executeWithInput(
  command: ReturnType<typeof agentCommand>,
  input: Uint8Array,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command.command, command.arguments, {
      cwd: command.cwd,
      env: command.environment,
      signal,
      stdio: ["pipe", "ignore", "pipe"],
    });
    const errors: Buffer[] = [];
    child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              Buffer.concat(errors).toString("utf8") ||
                `Computer file write exited with code ${code}`,
            ),
          ),
    );
    child.stdin.end(input);
  });
}

async function cuaCompatibilityInput(
  agentId: string,
  action: string,
  raw: string,
  signal: AbortSignal,
): Promise<{ name: string; arguments: Record<string, unknown> }> {
  let payload: Record<string, unknown> = {};
  try {
    payload = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    throw new ConnectError("Input payload must be JSON", Code.InvalidArgument);
  }
  if (action === "mouse_move")
    return {
      name: "move_cursor",
      arguments: { x: number(payload.x), y: number(payload.y), scope: "desktop" },
    };
  if (action === "click") {
    const position = await cursorPosition(agentId, signal);
    const button = payload.button ?? 1;
    if (button !== 1 && button !== 2 && button !== 3)
      throw new ConnectError("Input button must be 1, 2, or 3", Code.InvalidArgument);
    return {
      name: "click",
      arguments: {
        ...position,
        button: button === 1 ? "left" : button === 2 ? "middle" : "right",
        scope: "desktop",
      },
    };
  }
  if (action === "type")
    return {
      name: "type_text",
      arguments: { text: text(payload.text ?? "", "Input text"), scope: "desktop" },
    };
  if (action === "key")
    return {
      name: "press_key",
      arguments: { key: text(payload.key ?? "", "Input key"), scope: "desktop" },
    };
  throw new ConnectError(`Unsupported input action: ${action}`, Code.InvalidArgument);
}

async function cursorPosition(
  agentId: string,
  signal: AbortSignal,
): Promise<{ x: number; y: number }> {
  const result = await invokeCuaTool(agentId, "get_cursor_position", "{}", signal);
  for (const candidate of [result.structuredJson, result.rawJson]) {
    try {
      const value = JSON.parse(candidate) as { x?: unknown; y?: unknown };
      if (typeof value.x === "number" && typeof value.y === "number")
        return { x: value.x, y: value.y };
    } catch {
      // Try the next Cua result representation.
    }
  }
  throw new ConnectError("Cua Driver did not return the cursor position", Code.DataLoss);
}

function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new ConnectError("Input coordinates must be numbers", Code.InvalidArgument);
  return value;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string")
    throw new ConnectError(`${label} must be a string`, Code.InvalidArgument);
  return value;
}
