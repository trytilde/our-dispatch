import {
  ActionCompletion,
  ActionEffect,
  CuaDriver,
  DriverError,
  SessionPermissionMode,
  VerificationStatus,
  type CuaDriverLike,
  type ToolResult,
} from "@trycua/cua-driver";
import { spawn } from "node:child_process";
import { Code, ConnectError } from "@connectrpc/connect";
import { CuaActionCompletion } from "@tryopenbot/computer-service-proto";
import { isRecord } from "@tryopenbot/utilities/json";
import { agentDesktopEnvironment, ensureAgentDesktop } from "./desktop.js";

export interface CuaToolCatalogEntry {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface CuaCallResult {
  content: Array<
    | { content: { case: "text"; value: string } }
    | { content: { case: "image"; value: { mediaType: string; data: Uint8Array } } }
  >;
  structuredJson: string;
  isError: boolean;
  errorCode: string;
  verified: boolean;
  degraded: boolean;
  rawJson: string;
  actionCompletion: CuaActionCompletion;
  actionJson: string;
  verificationJson: string;
}

type DriverFactory = (agentId: string, signal?: AbortSignal) => Promise<CuaDriverLike>;

const drivers = new Map<string, Promise<CuaDriverLike>>();

async function defaultDriverFactory(agentId: string, signal?: AbortSignal): Promise<CuaDriverLike> {
  signal?.throwIfAborted();
  const desktop = await ensureAgentDesktop(agentId, undefined, signal);
  const environment = agentDesktopEnvironment(agentId, desktop);
  const binaryPath = process.env.CUA_DRIVER_BINARY ?? "/usr/local/bin/cua-driver";
  await disableTelemetry(binaryPath, environment, signal);
  const workerEnvironment = {
    DISPLAY: environment.DISPLAY,
    HOME: environment.HOME,
    XDG_RUNTIME_DIR: environment.XDG_RUNTIME_DIR,
    DBUS_SESSION_BUS_ADDRESS: environment.DBUS_SESSION_BUS_ADDRESS,
  };
  const worker = CuaDriver.createPrivateWorker({
    binaryPath,
    hostBundleId: "ai.tryopenbot.computer-service",
    startupTimeoutMs: 30_000n,
    shutdownTimeoutMs: 10_000n,
    configuredDriver: {
      claudeCodeCompatibility: false,
      authorization: {
        allowedModes: [SessionPermissionMode.Unrestricted],
        compatibilityMode: SessionPermissionMode.Unrestricted,
        unrestrictedAcknowledged: true,
        maxSessionTtlSeconds: 86_400n,
        maxIdleTtlSeconds: 3_600n,
      },
    },
    environment: Object.entries(workerEnvironment).map(([name, value]) => ({ name, value })),
    inheritStderr: false,
  });
  if (signal?.aborted) {
    await worker.shutdown().catch(() => undefined);
    destroyDriver(worker);
    signal.throwIfAborted();
  }
  if (!worker.isAvailable()) {
    await worker.shutdown().catch(() => undefined);
    destroyDriver(worker);
    throw new ConnectError("Cua Driver worker is unavailable", Code.Unavailable);
  }
  return worker;
}

async function disableTelemetry(
  binaryPath: string,
  environment: Record<string, string>,
  signal?: AbortSignal,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(binaryPath, ["telemetry", "disable"], {
      env: { ...process.env, ...environment },
      signal,
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("exit", (code, childSignal) => {
      if (code === 0) resolve();
      else
        reject(
          new ConnectError(
            `Cua Driver telemetry configuration failed (${childSignal ?? code ?? "unknown"})`,
            Code.Unavailable,
          ),
        );
    });
  });
}

let createDriver: DriverFactory = defaultDriverFactory;

async function driverFor(agentId: string, signal?: AbortSignal): Promise<CuaDriverLike> {
  const existing = drivers.get(agentId);
  if (existing) return await existing;
  const pending = createDriver(agentId, signal).catch((error) => {
    drivers.delete(agentId);
    throw error;
  });
  drivers.set(agentId, pending);
  return await pending;
}

export async function listCuaTools(
  agentId: string,
  signal?: AbortSignal,
): Promise<CuaToolCatalogEntry[]> {
  const driver = await driverFor(agentId, signal);
  try {
    return parseCatalog(await driver.listToolsJson(signal ? { signal } : undefined));
  } catch (error) {
    await discardDriver(agentId, driver);
    throw asConnectError(error, "Cua Driver catalog is unavailable");
  }
}

export async function callCuaTool(
  agentId: string,
  name: string,
  argumentsJson: string,
  signal?: AbortSignal,
): Promise<CuaCallResult> {
  if (!name.trim()) throw new ConnectError("Cua tool name is required", Code.InvalidArgument);
  try {
    JSON.parse(argumentsJson);
  } catch {
    throw new ConnectError("Cua tool arguments must be JSON", Code.InvalidArgument);
  }
  let driver = await driverFor(agentId, signal);
  try {
    let result = await driver.callTool(name, argumentsJson, signal ? { signal } : undefined);
    if (sessionHasEnded(result)) {
      await discardDriver(agentId, driver);
      signal?.throwIfAborted();
      driver = await driverFor(agentId, signal);
      result = await driver.callTool(name, argumentsJson, signal ? { signal } : undefined);
    }
    return mapToolResult(result);
  } catch (error) {
    if (DriverError.ActionInterrupted.instanceOf(error)) {
      const completion = error.inner.completion;
      return {
        content: [{ content: { case: "text", value: error.inner.reason } }],
        structuredJson: "",
        isError: true,
        errorCode: "action_interrupted",
        verified: false,
        degraded: false,
        rawJson: "",
        actionCompletion: mapCompletion(completion),
        actionJson: "",
        verificationJson: "",
      };
    }
    await discardDriver(agentId, driver);
    throw asConnectError(error, `Cua tool ${name} failed`);
  }
}

export async function shutdownCuaWorkers(): Promise<void> {
  const active = [...drivers.values()];
  drivers.clear();
  await Promise.allSettled(
    active.map(async (pending) => {
      const driver = await pending;
      await driver.shutdown();
      destroyDriver(driver);
    }),
  );
}

function parseCatalog(raw: string): CuaToolCatalogEntry[] {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new ConnectError("Cua Driver returned an invalid tool catalog", Code.DataLoss);
  }
  if (!isRecord(value) || !Array.isArray(value.tools))
    throw new ConnectError("Cua Driver returned an invalid tool catalog", Code.DataLoss);
  const tools = value.tools;
  const names = new Set<string>();
  return tools.map((entry) => {
    if (!isRecord(entry) || typeof entry.name !== "string" || !entry.name.trim())
      throw new ConnectError("Cua Driver returned an invalid tool definition", Code.DataLoss);
    if (names.has(entry.name))
      throw new ConnectError(`Cua Driver returned duplicate tool ${entry.name}`, Code.DataLoss);
    names.add(entry.name);
    if (!isRecord(entry.inputSchema))
      throw new ConnectError(
        `Cua Driver returned an invalid schema for ${entry.name}`,
        Code.DataLoss,
      );
    return {
      name: entry.name,
      description: typeof entry.description === "string" ? entry.description : "",
      inputSchema: entry.inputSchema,
    };
  });
}

function mapToolResult(result: ToolResult): CuaCallResult {
  return {
    content: [
      ...(result.text ? [{ content: { case: "text" as const, value: result.text } }] : []),
      ...result.images.map((image) => ({
        content: {
          case: "image" as const,
          value: {
            mediaType: image.mimeType,
            data: Uint8Array.from(Buffer.from(image.dataBase64, "base64")),
          },
        },
      })),
    ],
    structuredJson: result.structuredJson ?? "",
    isError: result.isError,
    errorCode: result.errorCode ?? "",
    verified: result.verification?.status === VerificationStatus.Satisfied,
    degraded: result.degraded,
    rawJson: result.rawJson,
    actionCompletion: result.isError
      ? result.action && result.action.effect !== ActionEffect.Refused
        ? CuaActionCompletion.COMPLETED
        : CuaActionCompletion.NOT_STARTED
      : CuaActionCompletion.COMPLETED,
    actionJson: stringify(result.action),
    verificationJson: stringify(result.verification),
  };
}

function sessionHasEnded(result: ToolResult): boolean {
  return result.isError && result.errorCode === "session_ended" && result.action === undefined;
}

function mapCompletion(completion: ActionCompletion): CuaActionCompletion {
  if (completion === ActionCompletion.NotStarted) return CuaActionCompletion.NOT_STARTED;
  if (completion === ActionCompletion.Completed) return CuaActionCompletion.COMPLETED;
  return CuaActionCompletion.UNKNOWN;
}

function stringify(value: unknown): string {
  return value === undefined
    ? ""
    : JSON.stringify(value, (_key, nested) =>
        typeof nested === "bigint" ? nested.toString() : nested,
      );
}

async function discardDriver(agentId: string, driver: CuaDriverLike): Promise<void> {
  const pending = drivers.get(agentId);
  if (pending && (await pending.catch(() => undefined)) === driver) drivers.delete(agentId);
  await driver.shutdown().catch(() => undefined);
  destroyDriver(driver);
}

function destroyDriver(driver: CuaDriverLike): void {
  const destroyable = driver as CuaDriverLike & { uniffiDestroy?: () => void };
  destroyable.uniffiDestroy?.();
}

function asConnectError(error: unknown, fallback: string): ConnectError {
  if (error instanceof ConnectError) return error;
  return new ConnectError(
    error instanceof Error ? `${fallback}: ${error.message}` : fallback,
    Code.Unavailable,
  );
}

export const cuaTesting = {
  reset(factory: DriverFactory = defaultDriverFactory) {
    drivers.clear();
    createDriver = factory;
  },
};
