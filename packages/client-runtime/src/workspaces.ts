import {
  ClientWorkspaceRegistrySchema,
  type ClientWorkspace,
  type ClientWorkspaceRegistry,
  type ClientWorkspaceStorage,
} from "./contracts/workspaces.js";
import {
  ControlServiceHealthSchema,
  NativeAuthConfigurationSchema,
  type ClientInstallation,
} from "./contracts/installation.js";

export type WorkspaceFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export const clientWorkspaceStorageKey = "openbot.workspaces.v1";
const emptyRegistry: ClientWorkspaceRegistry = {
  version: 1,
  active_workspace_id: null,
  workspaces: [],
};
const workspaceColors = ["#8d6e62", "#607d8b", "#6d7f5f", "#7b6b8d", "#8a7357", "#596f86"] as const;

export async function loadClientWorkspaces(
  storage: ClientWorkspaceStorage,
): Promise<ClientWorkspaceRegistry> {
  try {
    const raw = await storage.getItem(clientWorkspaceStorageKey);
    if (!raw) return emptyRegistry;
    const parsed = ClientWorkspaceRegistrySchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : emptyRegistry;
  } catch {
    return emptyRegistry;
  }
}

export async function saveClientWorkspaces(
  storage: ClientWorkspaceStorage,
  registry: ClientWorkspaceRegistry,
): Promise<ClientWorkspaceRegistry> {
  const normalized = normalizeRegistry(registry);
  try {
    await storage.setItem(clientWorkspaceStorageKey, JSON.stringify(normalized));
  } catch {
    // A private or exhausted store still gets a usable in-memory registry.
  }
  return normalized;
}

export function addClientWorkspace(
  registry: ClientWorkspaceRegistry,
  controlOrigin: string,
  now = new Date(),
  clientOrigin?: string,
  name?: string,
): ClientWorkspaceRegistry {
  const explicitName = name?.trim();
  const existing = registry.workspaces.find((item) => item.control_origin === controlOrigin);
  if (existing)
    return normalizeRegistry({
      ...registry,
      active_workspace_id: existing.id,
      workspaces: registry.workspaces.map((item) =>
        item.id === existing.id
          ? {
              ...item,
              ...(clientOrigin ? { client_origin: new URL(clientOrigin).origin } : {}),
              ...(explicitName ? { name: explicitName } : {}),
            }
          : item,
      ),
    });
  const workspace: ClientWorkspace = {
    id: globalThis.crypto.randomUUID(),
    name: explicitName || workspaceName(controlOrigin),
    control_origin: controlOrigin,
    ...(clientOrigin ? { client_origin: new URL(clientOrigin).origin } : {}),
    color: nextWorkspaceColor(registry.workspaces),
    created_at: now.toISOString(),
  };
  return normalizeRegistry({
    ...registry,
    active_workspace_id: workspace.id,
    workspaces: [...registry.workspaces, workspace],
  });
}

export function selectClientWorkspace(
  registry: ClientWorkspaceRegistry,
  id: string,
): ClientWorkspaceRegistry {
  return normalizeRegistry({
    ...registry,
    active_workspace_id: registry.workspaces.some((item) => item.id === id) ? id : null,
  });
}

export function removeClientWorkspace(
  registry: ClientWorkspaceRegistry,
  id: string,
): ClientWorkspaceRegistry {
  return normalizeRegistry({
    ...registry,
    active_workspace_id: registry.active_workspace_id === id ? null : registry.active_workspace_id,
    workspaces: registry.workspaces.filter((item) => item.id !== id),
  });
}

export function encodeClientWorkspaceTransfer(registry: ClientWorkspaceRegistry): string {
  return encodeURIComponent(JSON.stringify(normalizeRegistry(registry)));
}

export function decodeClientWorkspaceTransfer(value: string): ClientWorkspaceRegistry | undefined {
  try {
    const parsed = ClientWorkspaceRegistrySchema.safeParse(JSON.parse(decodeURIComponent(value)));
    return parsed.success ? normalizeRegistry(parsed.data) : undefined;
  } catch {
    return undefined;
  }
}

export function normalizeControlOrigin(value: string): string {
  const input = value.trim();
  if (!input) throw new Error("Enter your OpenBot control server URL");
  const url = new URL(input.includes("://") ? input : `https://${input}`);
  if (url.username || url.password)
    throw new Error("The control server URL cannot contain credentials");
  if (url.pathname !== "/" || url.search || url.hash)
    throw new Error("Enter the control server origin without a path, query, or fragment");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback(url.hostname)))
    throw new Error("Control servers must use HTTPS outside loopback development");
  return url.origin;
}

export async function discoverControlService(
  value: string,
  request: WorkspaceFetch,
): Promise<ClientInstallation> {
  const controlOrigin = normalizeControlOrigin(value);
  ControlServiceHealthSchema.parse(await requestJson(request, `${controlOrigin}/healthz`));
  const configuration = NativeAuthConfigurationSchema.parse(
    await requestJson(request, `${controlOrigin}/auth/native-config`),
  );
  assertSecureEndpoint(configuration.authorization_endpoint, "authorization");
  assertSecureEndpoint(configuration.token_endpoint, "token");
  return { control_origin: controlOrigin, ...configuration };
}

export function mergeClientWorkspaceRegistries(
  local: ClientWorkspaceRegistry,
  incoming: ClientWorkspaceRegistry,
): ClientWorkspaceRegistry {
  const workspaces = new Map(local.workspaces.map((item) => [item.control_origin, item]));
  const incomingIds = new Map<string, string>();
  for (const workspace of incoming.workspaces) {
    const retained = workspaces.get(workspace.control_origin) ?? workspace;
    workspaces.set(workspace.control_origin, retained);
    incomingIds.set(workspace.id, retained.id);
  }
  return normalizeRegistry({
    version: 1,
    active_workspace_id:
      (incoming.active_workspace_id ? incomingIds.get(incoming.active_workspace_id) : undefined) ??
      local.active_workspace_id,
    workspaces: [...workspaces.values()],
  });
}

function normalizeRegistry(registry: ClientWorkspaceRegistry): ClientWorkspaceRegistry {
  const unique = [
    ...new Map(registry.workspaces.map((item) => [item.control_origin, item])).values(),
  ];
  return {
    version: 1,
    active_workspace_id: unique.some((item) => item.id === registry.active_workspace_id)
      ? registry.active_workspace_id
      : null,
    workspaces: unique,
  };
}

function workspaceName(controlOrigin: string): string {
  const url = new URL(controlOrigin);
  return url.port ? `${url.hostname}:${url.port}` : url.hostname;
}

function nextWorkspaceColor(workspaces: readonly ClientWorkspace[]): string {
  const used = new Set(workspaces.map((item) => item.color.toLowerCase()));
  return (
    workspaceColors.find((color) => !used.has(color)) ??
    workspaceColors[workspaces.length % workspaceColors.length]!
  );
}

async function requestJson(request: WorkspaceFetch, url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await request(url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`OpenBot discovery failed (${response.status})`);
    return await response.json();
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError")
      throw new Error("The control server did not respond in time");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function assertSecureEndpoint(value: string, label: string): void {
  const url = new URL(value);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback(url.hostname)))
    throw new Error(`The ${label} endpoint must use HTTPS`);
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}
