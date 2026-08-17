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
      const desktop = await ensureAgentDesktop(request.agentId, undefined, context.signal);
      const scoped = agentCommand(request.agentId, "import", [
        "-display",
        desktop.display,
        "-window",
        "root",
        "png:-",
      ]);
      return { png: await executeBytes(scoped, context.signal, 24 * 1024 * 1024) };
    },
    async input(request, context) {
      authorized(context);
      const desktop = await ensureAgentDesktop(request.agentId, undefined, context.signal);
      const scoped = agentCommand(
        request.agentId,
        "xdotool",
        parseInput(request.action, request.payloadJson),
        {
          environment: { DISPLAY: desktop.display },
        },
      );
      await execute(scoped.command, scoped.arguments, {
        cwd: scoped.cwd,
        env: scoped.environment,
        signal: context.signal,
      });
      return { accepted: true };
    },
    async ensureDesktop(request, context) {
      authorized(context);
      const desktop = await ensureAgentDesktop(
        request.agentId,
        request.capability || undefined,
        context.signal,
      );
      return { display: desktop.display, vncPort: desktop.vncPort };
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

function parseInput(action: string, raw: string): string[] {
  let payload: Record<string, unknown> = {};
  try {
    payload = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    throw new ConnectError("Input payload must be JSON", Code.InvalidArgument);
  }
  if (action === "mouse_move")
    return ["mousemove", "--sync", integer(payload.x), integer(payload.y)];
  if (action === "click") return ["click", integer(payload.button ?? 1, "Input button")];
  if (action === "type")
    return [
      "type",
      "--delay",
      integer(payload.delayMs ?? 10, "Input delay"),
      text(payload.text ?? "", "Input text"),
    ];
  if (action === "key") return ["key", text(payload.key ?? "", "Input key")];
  throw new ConnectError(`Unsupported input action: ${action}`, Code.InvalidArgument);
}

function integer(value: unknown, label = "Input coordinates"): string {
  if (typeof value !== "number" || !Number.isSafeInteger(value))
    throw new ConnectError(`${label} must be an integer`, Code.InvalidArgument);
  return String(value);
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string")
    throw new ConnectError(`${label} must be a string`, Code.InvalidArgument);
  return value;
}
