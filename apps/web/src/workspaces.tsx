import {
  addClientWorkspace,
  createOpenBotClient,
  decodeClientWorkspaceTransfer,
  discoverControlService,
  encodeClientWorkspaceTransfer,
  errorMessage,
  loadClientWorkspaces,
  mergeClientWorkspaceRegistries,
  normalizeControlOrigin,
  removeClientWorkspace,
  saveClientWorkspaces,
  selectClientWorkspace,
  type ClientWorkspaceRegistry,
  type ClientWorkspaceStorage,
} from "@tryopenbot/client-runtime";
import { SelectWorkspaceScreen, WorkspaceSelectorDialog } from "@tryopenbot/ui";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";

const transferParameter = "openbot-workspaces";
const joinParameter = "openbot-join";
const joinNameParameter = "openbot-workspace-name";
const pendingJoinKey = "openbot.pending-workspace";

interface PendingWorkspaceJoin {
  controlOrigin: string;
  name: string;
}

const browserStorage: ClientWorkspaceStorage = {
  getItem: (key) => safeStorage(() => localStorage.getItem(key), null),
  setItem: (key, value) => safeStorage(() => localStorage.setItem(key, value), undefined),
  removeItem: (key) => safeStorage(() => localStorage.removeItem(key), undefined),
};

interface WorkspaceContextValue {
  workspaceName: string;
  openWorkspaceSelector(): void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(undefined);

export function useClientWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("The client workspace provider is unavailable");
  return value;
}

export function ClientWorkspaceGate({ children }: { children: ReactNode }) {
  const [registry, setRegistry] = useState<ClientWorkspaceRegistry>();
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");
  const shellControlOrigin = useMemo(resolveShellControlOrigin, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      let loaded = await loadClientWorkspaces(browserStorage);
      const parameters = new URLSearchParams(location.hash.slice(1));
      const transferred = parameters.get(transferParameter);
      if (transferred) {
        const incoming = decodeClientWorkspaceTransfer(transferred);
        if (incoming) loaded = mergeClientWorkspaceRegistries(loaded, incoming);
      }
      const incomingJoin = parameters.get(joinParameter);
      if (incomingJoin) {
        const pendingJoin: PendingWorkspaceJoin = {
          controlOrigin: incomingJoin,
          name: parameters.get(joinNameParameter)?.trim() || workspaceNameFromOrigin(incomingJoin),
        };
        safeStorage(
          () => sessionStorage.setItem(pendingJoinKey, JSON.stringify(pendingJoin)),
          undefined,
        );
      }
      if (transferred || incomingJoin)
        history.replaceState(null, "", `${location.pathname}${location.search}`);
      if (import.meta.env.DEV)
        loaded = addClientWorkspace(loaded, shellControlOrigin, new Date(), location.origin);
      loaded = await saveClientWorkspaces(browserStorage, loaded);
      if (!active) return;
      setRegistry(loaded);
      const pending = readPendingWorkspaceJoin(
        safeStorage(() => sessionStorage.getItem(pendingJoinKey), null),
      );
      if (pending) await connect(pending.name, pending.controlOrigin, loaded);
    })();
    return () => {
      active = false;
    };
    // Boot once. `connect` deliberately uses the registry snapshot loaded in this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!registry || window.openbotDesktop) return;
    const activeWorkspace = registry.workspaces.find(
      (item) => item.id === registry.active_workspace_id,
    );
    if (activeWorkspace && activeWorkspace.control_origin !== shellControlOrigin)
      navigateToWorkspace(
        activeWorkspace.client_origin ?? activeWorkspace.control_origin,
        registry,
      );
  }, [registry, shellControlOrigin]);

  async function connect(name: string, value: string, baseRegistry = registry): Promise<void> {
    if (!baseRegistry || joining) return;
    setJoining(true);
    setError("");
    try {
      const controlOrigin = normalizeControlOrigin(value);
      if (controlOrigin !== shellControlOrigin) {
        if (window.openbotDesktop)
          throw new Error("This desktop build can only use its configured control server");
        safeStorage(() => sessionStorage.removeItem(pendingJoinKey), undefined);
        navigateToWorkspace(controlOrigin, baseRegistry, { controlOrigin, name });
        return;
      }
      await discoverControlService(controlOrigin, workspaceFetch(shellControlOrigin));
      const session = window.openbotDesktop
        ? await window.openbotDesktop.authStatus()
        : await createOpenBotClient({ fetch: workspaceFetch(shellControlOrigin) }).getSession();
      if (!session) {
        safeStorage(
          () =>
            sessionStorage.setItem(
              pendingJoinKey,
              JSON.stringify({ controlOrigin, name } satisfies PendingWorkspaceJoin),
            ),
          undefined,
        );
        if (window.openbotDesktop) {
          await window.openbotDesktop.signIn();
          if (!(await window.openbotDesktop.authStatus()))
            throw new Error("Authentication did not complete");
        } else {
          location.assign("/auth/login");
          return;
        }
      }
      const next = await saveClientWorkspaces(
        browserStorage,
        addClientWorkspace(baseRegistry, controlOrigin, new Date(), location.origin, name),
      );
      safeStorage(() => sessionStorage.removeItem(pendingJoinKey), undefined);
      setRegistry(next);
      setSelectorOpen(false);
    } catch (caught) {
      safeStorage(() => sessionStorage.removeItem(pendingJoinKey), undefined);
      setError(errorMessage(caught));
    } finally {
      setJoining(false);
    }
  }

  async function remove(id: string): Promise<void> {
    if (!registry) return;
    const next = await saveClientWorkspaces(browserStorage, removeClientWorkspace(registry, id));
    setRegistry(next);
    if (!next.active_workspace_id) setSelectorOpen(false);
  }

  async function select(id: string): Promise<void> {
    if (!registry) return;
    const next = await saveClientWorkspaces(browserStorage, selectClientWorkspace(registry, id));
    const workspace = next.workspaces.find((item) => item.id === next.active_workspace_id);
    if (!workspace) return setRegistry(next);
    if (workspace.control_origin !== shellControlOrigin) {
      if (window.openbotDesktop) {
        setError("This desktop build can only use its configured control server");
        return;
      }
      navigateToWorkspace(workspace.client_origin ?? workspace.control_origin, next);
      return;
    }
    location.reload();
  }

  if (!registry)
    return (
      <main className="grid min-h-screen place-items-center bg-page text-[13px] text-ink-3">
        Loading workspaces…
      </main>
    );

  const activeWorkspace = registry.workspaces.find(
    (item) => item.id === registry.active_workspace_id,
  );
  const selectorProps = {
    workspaces: registry.workspaces,
    activeWorkspaceId: registry.active_workspace_id,
    joining,
    error,
    onJoin: (name: string, origin: string) => void connect(name, origin),
    onRemove: (id: string) => void remove(id),
    onSelect: (id: string) => void select(id),
  };

  if (!activeWorkspace) return <SelectWorkspaceScreen {...selectorProps} />;
  if (activeWorkspace.control_origin !== shellControlOrigin) {
    if (window.openbotDesktop)
      return (
        <SelectWorkspaceScreen
          {...selectorProps}
          error={error || "This desktop build can only use its configured control server"}
        />
      );
    return (
      <main className="grid min-h-screen place-items-center bg-page text-[13px] text-ink-3">
        Switching workspace…
      </main>
    );
  }

  return (
    <WorkspaceContext.Provider
      value={{
        workspaceName: activeWorkspace.name,
        openWorkspaceSelector: () => setSelectorOpen(true),
      }}
    >
      {children}
      <WorkspaceSelectorDialog
        {...selectorProps}
        open={selectorOpen}
        onOpenChange={(open) => {
          setError("");
          setSelectorOpen(open);
        }}
      />
    </WorkspaceContext.Provider>
  );
}

function resolveShellControlOrigin(): string {
  if (window.openbotDesktop?.controlOrigin)
    return new URL(window.openbotDesktop.controlOrigin).origin;
  const url = new URL(location.href);
  if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && url.port === "4173")
    return `${url.protocol}//${url.hostname}:4100`;
  return url.origin;
}

function workspaceFetch(controlOrigin: string): typeof fetch {
  return (input, init) => {
    const requested = new URL(
      input instanceof Request ? input.url : input.toString(),
      controlOrigin,
    );
    const target =
      requested.origin === controlOrigin
        ? `${requested.pathname}${requested.search}`
        : requested.toString();
    return fetch(target, { ...init, credentials: "include" });
  };
}

function navigateToWorkspace(
  origin: string,
  registry: ClientWorkspaceRegistry,
  pendingJoin?: PendingWorkspaceJoin,
): void {
  const parameters = new URLSearchParams({
    [transferParameter]: encodeClientWorkspaceTransfer(registry),
  });
  if (pendingJoin) {
    parameters.set(joinParameter, pendingJoin.controlOrigin);
    parameters.set(joinNameParameter, pendingJoin.name);
  }
  location.assign(`${origin}/#${parameters}`);
}

function readPendingWorkspaceJoin(value: string | null): PendingWorkspaceJoin | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as Partial<PendingWorkspaceJoin>;
    if (typeof parsed.controlOrigin === "string" && typeof parsed.name === "string")
      return { controlOrigin: parsed.controlOrigin, name: parsed.name };
  } catch {
    // Older clients stored only the control origin.
  }
  return { controlOrigin: value, name: workspaceNameFromOrigin(value) };
}

function workspaceNameFromOrigin(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
}

function safeStorage<Value>(operation: () => Value, fallback: Value): Value {
  try {
    return operation();
  } catch {
    return fallback;
  }
}
