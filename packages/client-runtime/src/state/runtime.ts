import { createStore, type StoreApi } from "zustand/vanilla";
import type { OpenBotClient } from "../chat/client.js";
import type { CreatedAgent } from "../contracts/agents.js";
import {
  eventBusyState,
  eventName,
  eventStatus,
  latestMessagePreview,
  messageText,
  reduceLiveChatEvent,
  uniqueMessages,
} from "../chat/reducer.js";
import type {
  ClientAuthAdapter,
  AuthenticatedSession,
  AuthenticationStatus,
} from "../contracts/auth.js";
import type { ActivityEvent } from "../contracts/events.js";
import type { ChatMessage, ChatPart } from "../contracts/messages.js";
import { QueuedTurnSchema, type QueuedTurn } from "../contracts/queue.js";
import type { CreateRoutineInput, Routine, UpdateRoutineInput } from "../contracts/routines.js";
import type {
  CreateSignalInstanceInput,
  SignalDelivery,
  SignalInstance,
  SignalProvider,
  TestSignalInstanceInput,
  TestSignalInstanceResult,
  UpdateSignalInstanceInput,
} from "../contracts/signals.js";
import type {
  AgentSortOrder,
  ChatAgent,
  ChatSession,
  SessionSortOrder,
} from "../contracts/sidebar.js";
import { errorMessage } from "../errors.js";

export interface AuthState {
  status: AuthenticationStatus;
  session: AuthenticatedSession | null;
  error: string;
}

export interface SidebarState {
  agents: ChatAgent[];
  nextAgentToken?: string | null;
  selectedAgentId: string;
  busyAgentIds: string[];
  loading: boolean;
  error: string;
}

export interface ConversationState {
  selectedSessionId: string;
  messages: ChatMessage[];
  nextMessageToken?: string | null;
  queuedTurns: QueuedTurn[];
  activity: ActivityEvent[];
  loading: boolean;
  submitting: boolean;
  agentBusy: boolean;
  streamStatus: "Disconnected" | "Connecting" | "Live" | "Reconnecting";
  turnStatus: string;
  error: string;
}

export interface AgentSetupState {
  status: "idle" | "starting" | "setting_up" | "failed";
  jobId: string;
  agent: CreatedAgent | null;
  avatarId: string;
  error: string;
}

export interface AgentSetupPersistence {
  load(): AgentSetupState | null;
  save(state: AgentSetupState | null): void;
}

export interface RoutinesState {
  byAgentId: Record<string, Routine[]>;
  status: "idle" | "loading" | "ready" | "error";
  error: string;
}

export interface SignalsState {
  providers: SignalProvider[];
  instances: SignalInstance[];
  deliveriesByInstanceId: Record<string, SignalDelivery[]>;
  status: "idle" | "loading" | "ready" | "error";
  error: string;
}

export interface OpenBotState {
  auth: AuthState;
  sidebar: SidebarState;
  conversation: ConversationState;
  agentSetup: AgentSetupState;
  routines: RoutinesState;
  signals: SignalsState;
}

export interface SendMessageInput {
  text: string;
  attachmentIds?: string[];
  optimisticParts?: ChatPart[];
  title?: string;
}

export interface OpenBotActions {
  initialize(): Promise<void>;
  checkAuthentication(): Promise<void>;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  refreshSidebar(): Promise<void>;
  loadMoreAgents(): Promise<void>;
  selectAgent(agentId: string): Promise<void>;
  startNewConversation(agentId: string): void;
  selectSession(agentId: string, session: ChatSession): Promise<void>;
  ensureSession(title?: string): Promise<string>;
  refreshMessages(sessionId?: string, preserveLiveMessages?: boolean): Promise<void>;
  loadOlderMessages(): Promise<void>;
  sendMessage(input: SendMessageInput): Promise<void>;
  interrupt(): Promise<void>;
  refreshQueue(sessionId?: string): Promise<void>;
  removeQueuedTurn(id: string): Promise<void>;
  reorderQueuedTurn(id: string, queuePosition: number): Promise<void>;
  steerQueuedTurn(id: string): Promise<void>;
  startAgentSetup(name: string, avatarId?: string): Promise<void>;
  dismissAgentSetup(): void;
  refreshRoutines(agentId: string): Promise<void>;
  createRoutine(input: CreateRoutineInput): Promise<void>;
  updateRoutine(groupId: string, agentId: string, input: UpdateRoutineInput): Promise<void>;
  deleteRoutine(groupId: string, agentId: string): Promise<void>;
  runRoutine(groupId: string, agentId: string): Promise<string>;
  startRoutinePolling(agentId: string): void;
  stopRoutinePolling(): void;
  refreshSignalProviders(): Promise<void>;
  refreshSignalInstances(): Promise<void>;
  createSignalInstance(input: CreateSignalInstanceInput): Promise<SignalInstance>;
  updateSignalInstance(id: string, input: UpdateSignalInstanceInput): Promise<SignalInstance>;
  deleteSignalInstance(id: string): Promise<void>;
  testSignalInstance(
    id: string,
    input?: TestSignalInstanceInput,
  ): Promise<TestSignalInstanceResult>;
  refreshSignalDeliveries(instanceId: string): Promise<void>;
  setError(message: string): void;
}

export interface OpenBotRuntime {
  client: OpenBotClient;
  store: StoreApi<OpenBotState>;
  actions: OpenBotActions;
  dispose(): void;
}

export interface OpenBotRuntimeOptions {
  client: OpenBotClient;
  auth: ClientAuthAdapter;
  agentSort?: AgentSortOrder;
  sessionSort?: SessionSortOrder;
  now?: () => Date;
  createId?: () => string;
  schedule?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  cancelScheduled?: (handle: ReturnType<typeof setTimeout>) => void;
  agentSetupPersistence?: AgentSetupPersistence;
}

const optimisticQueuePrefix = "optimistic-queue-";
const optimisticQueueGraceMs = 5_000;
const agentSetupPollMs = 500;
const routinePollMs = 30_000;

const idleAgentSetup: AgentSetupState = {
  status: "idle",
  jobId: "",
  agent: null,
  avatarId: "",
  error: "",
};

const initialState: OpenBotState = {
  auth: { status: "checking", session: null, error: "" },
  sidebar: { agents: [], selectedAgentId: "", busyAgentIds: [], loading: true, error: "" },
  conversation: {
    selectedSessionId: "",
    messages: [],
    queuedTurns: [],
    activity: [],
    loading: false,
    submitting: false,
    agentBusy: false,
    streamStatus: "Disconnected",
    turnStatus: "",
    error: "",
  },
  agentSetup: idleAgentSetup,
  routines: { byAgentId: {}, status: "idle", error: "" },
  signals: {
    providers: [],
    instances: [],
    deliveriesByInstanceId: {},
    status: "idle",
    error: "",
  },
};

export function createOpenBotRuntime(options: OpenBotRuntimeOptions): OpenBotRuntime {
  const restoredAgentSetup = options.agentSetupPersistence?.load();
  const store = createStore<OpenBotState>(() => ({
    ...initialState,
    agentSetup: restoredAgentSetup?.status === "setting_up" ? restoredAgentSetup : idleAgentSetup,
  }));
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? (() => globalThis.crypto.randomUUID());
  const schedule = options.schedule ?? ((callback, delay) => setTimeout(callback, delay));
  const cancelScheduled = options.cancelScheduled ?? clearTimeout;
  const agentSort = options.agentSort ?? "updated_at";
  const sessionSort = options.sessionSort ?? "updated_at";
  const busySessionIds = new Set<string>();
  const liveMessagesBySession = new Map<string, ChatMessage[]>();
  let missionControlObserver: AbortController | undefined;
  let agentSetupObserver: AbortController | undefined;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let sidebarRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  const queueRefreshes = new Map<string, Promise<void>>();
  let initializePromise: Promise<void> | undefined;

  const updateAuth = (patch: Partial<AuthState>) =>
    store.setState((state) => ({ auth: { ...state.auth, ...patch } }));
  const updateSidebar = (patch: Partial<SidebarState>) =>
    store.setState((state) => ({ sidebar: { ...state.sidebar, ...patch } }));
  const updateConversation = (patch: Partial<ConversationState>) =>
    store.setState((state) => ({ conversation: { ...state.conversation, ...patch } }));
  const syncBusyAgents = (): void => {
    const state = store.getState();
    const busyAgentIds = state.sidebar.agents
      .filter((agent) => agent.sessions.items.some((session) => busySessionIds.has(session.id)))
      .map((agent) => agent.id);
    updateSidebar({ busyAgentIds });
    updateConversation({ agentBusy: busyAgentIds.includes(state.sidebar.selectedAgentId) });
  };
  const setSessionBusy = (sessionId: string, busy: boolean): void => {
    if (!sessionId) return;
    if (busy) busySessionIds.add(sessionId);
    else busySessionIds.delete(sessionId);
    syncBusyAgents();
  };
  const updateAgentSetup = (state: AgentSetupState) => {
    store.setState({ agentSetup: state });
    options.agentSetupPersistence?.save(state.status === "setting_up" ? state : null);
  };
  const updateRoutines = (patch: Partial<RoutinesState>) =>
    store.setState((state) => ({ routines: { ...state.routines, ...patch } }));
  const updateSignals = (patch: Partial<SignalsState>) =>
    store.setState((state) => ({ signals: { ...state.signals, ...patch } }));
  const replaceAgentRoutines = (agentId: string, items: Routine[]) =>
    updateRoutines({
      byAgentId: { ...store.getState().routines.byAgentId, [agentId]: items },
      status: "ready",
      error: "",
    });
  // Providers and instances are fetched concurrently behind one status/error
  // pair, so each keeps its own error and neither erases the other's.
  const signalErrors: Record<"providers" | "instances", string> = { providers: "", instances: "" };
  const clearSignalErrors = (): void => {
    signalErrors.providers = "";
    signalErrors.instances = "";
  };
  const settleSignals = (
    source: "providers" | "instances",
    patch: Partial<SignalsState>,
    error: string,
  ): void => {
    signalErrors[source] = error;
    const pending = signalErrors.providers || signalErrors.instances;
    updateSignals({ ...patch, status: pending ? "error" : "ready", error: pending });
  };
  let routinePollTimer: ReturnType<typeof setTimeout> | undefined;
  let routinePollGeneration = 0;

  async function checkAuthentication(): Promise<void> {
    updateAuth({ status: "checking", error: "" });
    try {
      const session = await options.auth.getSession();
      updateAuth({
        status: session ? "authenticated" : "unauthenticated",
        session,
        error: "",
      });
    } catch (error) {
      updateAuth({ status: "unauthenticated", session: null, error: errorMessage(error) });
    }
  }

  async function refreshSidebar(silent = false): Promise<void> {
    if (!silent) updateSidebar({ loading: true, error: "" });
    try {
      const response = await options.client.getSidebar("", agentSort, sessionSort);
      const agents = await Promise.all(
        response.items.map(async (agent) => {
          const latestSession = agent.sessions.items[0];
          if (!latestSession) return agent;
          try {
            const page = await options.client.getMessages(latestSession.id);
            return { ...agent, last_message_preview: latestMessagePreview(page.items) };
          } catch {
            return agent;
          }
        }),
      );
      const currentAgentId = store.getState().sidebar.selectedAgentId;
      const selectedAgentId = agents.some((agent) => agent.id === currentAgentId)
        ? currentAgentId
        : (agents[0]?.id ?? "");
      updateSidebar({
        agents,
        nextAgentToken: response.next_page_token,
        selectedAgentId,
        ...(!silent ? { loading: false } : {}),
      });
      syncBusyAgents();
      if (selectedAgentId && !store.getState().conversation.selectedSessionId) {
        const session = agents.find((agent) => agent.id === selectedAgentId)?.sessions.items[0];
        if (session) await selectSession(selectedAgentId, session);
      }
    } catch (error) {
      updateSidebar({ ...(!silent ? { loading: false } : {}), error: errorMessage(error) });
      throw error;
    }
  }

  async function initialize(): Promise<void> {
    initializePromise ??= (async () => {
      await checkAuthentication();
      if (store.getState().auth.status === "authenticated")
        await refreshSidebar().catch(() => undefined);
      else updateSidebar({ loading: false });
      if (store.getState().auth.status === "authenticated") beginMissionControlObservation();
      if (
        store.getState().auth.status === "authenticated" &&
        store.getState().agentSetup.status === "setting_up"
      )
        monitorAgentSetup(store.getState().agentSetup);
    })().finally(() => {
      initializePromise = undefined;
    });
    return await initializePromise;
  }

  async function refreshMessages(
    sessionId = store.getState().conversation.selectedSessionId,
    preserveLiveMessages = false,
  ): Promise<void> {
    if (!sessionId) return;
    const response = await options.client.getMessages(sessionId);
    if (store.getState().conversation.selectedSessionId !== sessionId) return;
    const current = store.getState().conversation.messages;
    const messages = uniqueMessages(
      preserveLiveMessages ? [...response.items, ...current] : response.items,
    );
    liveMessagesBySession.set(sessionId, messages);
    updateConversation({
      messages,
      nextMessageToken: response.next_page_token,
    });
  }

  async function refreshQueue(
    sessionId = store.getState().conversation.selectedSessionId,
  ): Promise<void> {
    if (!sessionId) return;
    const activeRefresh = queueRefreshes.get(sessionId);
    if (activeRefresh) return await activeRefresh;
    const refresh = (async () => {
      const response = await options.client.getQueuedTurns(sessionId);
      if (store.getState().conversation.selectedSessionId !== sessionId) return;
      updateConversation({
        queuedTurns: reconcileQueuedTurns(
          response.items,
          store.getState().conversation.queuedTurns,
          now(),
        ),
      });
    })().finally(() => {
      queueRefreshes.delete(sessionId);
    });
    queueRefreshes.set(sessionId, refresh);
    return await refresh;
  }

  async function removeQueuedTurn(id: string): Promise<void> {
    const sessionId = store.getState().conversation.selectedSessionId;
    if (!sessionId) return;
    const previous = store.getState().conversation.queuedTurns;
    updateConversation({ queuedTurns: previous.filter((turn) => turn.id !== id) });
    try {
      await options.client.deleteQueuedTurn(id);
      await refreshQueue(sessionId);
    } catch (error) {
      updateConversation({ queuedTurns: previous, error: errorMessage(error) });
      throw error;
    }
  }

  async function reorderQueuedTurn(id: string, queuePosition: number): Promise<void> {
    const sessionId = store.getState().conversation.selectedSessionId;
    if (!sessionId) return;
    const previous = store.getState().conversation.queuedTurns;
    const target = previous.find((turn) => turn.id === id);
    if (!target) return;
    updateConversation({
      queuedTurns: previous
        .map((turn) => (turn.id === id ? { ...turn, queue_position: queuePosition } : turn))
        .sort((left, right) => left.queue_position - right.queue_position),
    });
    try {
      await options.client.reorderQueuedTurn(id, queuePosition);
      await refreshQueue(sessionId);
    } catch (error) {
      updateConversation({ queuedTurns: previous, error: errorMessage(error) });
      throw error;
    }
  }

  async function steerQueuedTurn(id: string): Promise<void> {
    const sessionId = store.getState().conversation.selectedSessionId;
    if (!sessionId) return;
    const previous = store.getState().conversation.queuedTurns;
    updateConversation({
      queuedTurns: previous.filter((turn) => turn.id !== id),
      turnStatus: "Steering queued message",
    });
    setSessionBusy(sessionId, true);
    try {
      await options.client.steerQueuedTurn(id);
      await refreshQueue(sessionId);
    } catch (error) {
      updateConversation({ queuedTurns: previous, error: errorMessage(error) });
      throw error;
    }
  }

  function scheduleSidebarRefresh(): void {
    if (sidebarRefreshTimer) cancelScheduled(sidebarRefreshTimer);
    sidebarRefreshTimer = schedule(() => {
      sidebarRefreshTimer = undefined;
      void refreshSidebar(true).catch(() => undefined);
    }, 120);
  }

  function beginMissionControlObservation(): void {
    if (missionControlObserver && !missionControlObserver.signal.aborted) return;
    const controller = new AbortController();
    const seenEventIds = new Set<string>();
    missionControlObserver = controller;
    updateConversation({ streamStatus: "Connecting" });
    void (async () => {
      while (!controller.signal.aborted) {
        try {
          updateConversation({ streamStatus: "Live" });
          await options.client.observeMissionControl(controller.signal, (event) => {
            if (event.id && seenEventIds.has(event.id)) return;
            if (event.id) {
              seenEventIds.add(event.id);
              if (seenEventIds.size > 1_000) {
                const oldest = seenEventIds.values().next().value;
                if (oldest) seenEventIds.delete(oldest);
              }
            }
            const sessionId = eventSessionId(event.data);
            if (!sessionId) {
              scheduleSidebarRefresh();
              return;
            }
            const state = store.getState();
            const currentMessages =
              state.conversation.selectedSessionId === sessionId
                ? state.conversation.messages
                : (liveMessagesBySession.get(sessionId) ?? []);
            const reduction = reduceLiveChatEvent(currentMessages, event, sessionId, now());
            liveMessagesBySession.set(sessionId, reduction.messages);
            const name = eventName(event);
            const busy =
              eventBusyState(event) ??
              (name.includes("error") ||
              (name.includes("message.created") && nestedString(event.data, "role") === "assistant")
                ? false
                : undefined);
            if (busy !== undefined) setSessionBusy(sessionId, busy);
            if (name.includes("message"))
              updateSidebarForSessionEvent(
                store,
                sessionId,
                reduction.messages,
                state.conversation.selectedSessionId !== sessionId,
                now(),
              );

            if (state.conversation.selectedSessionId === sessionId) {
              let queuedTurns = attachPersistedQueuedMessageIds(
                state.conversation.queuedTurns,
                state.conversation.messages,
                reduction.messages,
              );
              const dequeued = name.includes("dequeued");
              const queueItem = name.includes("queue") ? queueEventQueuedTurn(event.data) : null;
              if (name.includes("queued") && !dequeued && queueItem) {
                queuedTurns = reconcileQueuedEvent(queuedTurns, queueItem);
              }
              if (dequeued) {
                const dequeuedTriggerIds = new Set(queueEventTriggerMessageIds(event.data));
                queuedTurns = queuedTurns.filter(
                  (turn) =>
                    turn.id !== queueItem?.id &&
                    !turn.trigger_message_ids?.some((id) => dequeuedTriggerIds.has(id)),
                );
              }
              updateConversation({
                messages: reduction.messages,
                queuedTurns,
                activity: [{ ...event, receivedAt: now() }, ...state.conversation.activity].slice(
                  0,
                  60,
                ),
                turnStatus: eventStatus(event) || state.conversation.turnStatus,
                ...(busy === undefined ? {} : { agentBusy: busy }),
              });
              if (name.includes("queue") && !queueItem)
                void refreshQueue(sessionId).catch(() => undefined);
              if (refreshTimer) cancelScheduled(refreshTimer);
              if (!reduction.streaming) {
                refreshTimer = schedule(() => {
                  void refreshMessages(sessionId, true).catch((error) =>
                    updateConversation({ error: errorMessage(error) }),
                  );
                }, 80);
              }
            }
            if (
              name.includes("session") ||
              name.includes("message.created") ||
              name.includes("message.updated") ||
              name.includes("queue")
            )
              scheduleSidebarRefresh();
          });
        } catch (error) {
          if (controller.signal.aborted) break;
          updateConversation({ streamStatus: "Reconnecting", error: errorMessage(error) });
        }
        await abortableDelay(900, controller.signal, schedule, cancelScheduled);
      }
    })();
  }

  async function selectSession(agentId: string, session: ChatSession): Promise<void> {
    updateSidebar({ selectedAgentId: agentId });
    updateConversation({
      selectedSessionId: session.id,
      messages: liveMessagesBySession.get(session.id) ?? [],
      nextMessageToken: undefined,
      queuedTurns: [],
      activity: [],
      loading: true,
      agentBusy: store.getState().sidebar.busyAgentIds.includes(agentId),
      streamStatus: missionControlObserver?.signal.aborted === false ? "Live" : "Connecting",
      turnStatus: "",
      error: "",
    });
    try {
      await Promise.all([refreshMessages(session.id, true), refreshQueue(session.id)]);
    } catch (error) {
      updateConversation({ error: errorMessage(error) });
    } finally {
      if (store.getState().conversation.selectedSessionId === session.id)
        updateConversation({ loading: false });
    }
  }

  async function selectAgent(agentId: string): Promise<void> {
    const agent = store.getState().sidebar.agents.find((candidate) => candidate.id === agentId);
    if (!agent) return;
    const latestSession = agent.sessions.items[0];
    if (latestSession) return await selectSession(agentId, latestSession);
    updateSidebar({ selectedAgentId: agentId });
    updateConversation({
      selectedSessionId: "",
      messages: [],
      queuedTurns: [],
      activity: [],
      agentBusy: store.getState().sidebar.busyAgentIds.includes(agentId),
      streamStatus: missionControlObserver?.signal.aborted === false ? "Live" : "Connecting",
      turnStatus: "",
      error: "",
    });
  }

  function startNewConversation(agentId: string): void {
    if (!store.getState().sidebar.agents.some((agent) => agent.id === agentId)) return;
    updateSidebar({ selectedAgentId: agentId });
    updateConversation({
      selectedSessionId: "",
      messages: [],
      nextMessageToken: undefined,
      queuedTurns: [],
      activity: [],
      loading: false,
      agentBusy: store.getState().sidebar.busyAgentIds.includes(agentId),
      streamStatus: missionControlObserver?.signal.aborted === false ? "Live" : "Connecting",
      turnStatus: "",
      error: "",
    });
  }

  async function loadMoreAgents(): Promise<void> {
    const state = store.getState().sidebar;
    if (!state.nextAgentToken) return;
    const response = await options.client.getSidebar(
      "",
      agentSort,
      sessionSort,
      state.nextAgentToken,
    );
    updateSidebar({
      agents: uniqueAgents([...state.agents, ...response.items]),
      nextAgentToken: response.next_page_token,
    });
  }

  async function loadOlderMessages(): Promise<void> {
    const state = store.getState().conversation;
    if (!state.selectedSessionId || !state.nextMessageToken) return;
    const response = await options.client.getMessages(
      state.selectedSessionId,
      state.nextMessageToken,
    );
    if (store.getState().conversation.selectedSessionId !== state.selectedSessionId) return;
    updateConversation({
      messages: uniqueMessages([...response.items, ...store.getState().conversation.messages]),
      nextMessageToken: response.next_page_token,
    });
  }

  async function ensureSession(title?: string): Promise<string> {
    const state = store.getState();
    if (state.conversation.selectedSessionId) return state.conversation.selectedSessionId;
    const agentId = state.sidebar.selectedAgentId;
    if (!agentId) throw new Error("Select an agent before starting a conversation");
    const created = await options.client.createSession(agentId, title || "New chat");
    updateSidebar({ agents: addSession(store.getState().sidebar.agents, agentId, created) });
    updateConversation({ selectedSessionId: created.id });
    return created.id;
  }

  async function sendMessage(input: SendMessageInput): Promise<void> {
    const text = input.text.trim();
    const state = store.getState();
    const agentId = state.sidebar.selectedAgentId;
    const activeAtDispatch =
      state.conversation.agentBusy || state.conversation.queuedTurns.length > 0;
    if (
      (!text && !input.attachmentIds?.length) ||
      !agentId ||
      (state.conversation.submitting && !activeAtDispatch)
    )
      return;
    const optimisticQueueId = activeAtDispatch ? `${optimisticQueuePrefix}${createId()}` : "";
    updateConversation({
      submitting: true,
      error: "",
      turnStatus: "Adding to queue",
      ...(optimisticQueueId
        ? {
            queuedTurns: [
              ...state.conversation.queuedTurns,
              optimisticQueuedTurn(
                optimisticQueueId,
                state.conversation.selectedSessionId,
                text,
                input.optimisticParts,
                Math.max(-1, ...state.conversation.queuedTurns.map((turn) => turn.queue_position)) +
                  1,
                now(),
              ),
            ],
          }
        : {}),
    });
    let sessionId = state.conversation.selectedSessionId;
    try {
      if (!sessionId) sessionId = await ensureSession(input.title || titleFrom(text));
      if (!activeAtDispatch) {
        const optimistic: ChatMessage = {
          id: `optimistic-${createId()}`,
          type: "ui",
          role: "user",
          session_id: sessionId,
          user_display_name: "You",
          parts: input.optimisticParts ?? (text ? [{ type: "text", text }] : []),
          created_at: now().toISOString(),
        };
        updateConversation({
          messages: [...store.getState().conversation.messages, optimistic],
        });
        setSessionBusy(sessionId, true);
      }
      const responsePromise = options.client.sendMessage(
        agentId,
        sessionId,
        text,
        input.attachmentIds,
      );
      // Mission Control's send endpoint is the sole durable queue producer. Keep the local queued
      // turn visible while that request is pending; queue SSE events own durable reconciliation.
      updateConversation({ submitting: false });
      const response = await responsePromise;
      const persistedMessages = store
        .getState()
        .conversation.messages.filter((message) => !message.id.startsWith("optimistic-"));
      const nextMessages = uniqueMessages([...persistedMessages, ...response.items]);
      liveMessagesBySession.set(sessionId, nextMessages);
      updateConversation({
        messages: nextMessages,
        queuedTurns: attachPersistedQueuedMessageIds(
          store.getState().conversation.queuedTurns,
          persistedMessages,
          nextMessages,
        ),
        nextMessageToken: response.next_page_token,
        turnStatus: activeAtDispatch ? "Queued" : "Completed",
      });
      await Promise.all([refreshSidebar(true), refreshQueue(sessionId)]);
    } catch (error) {
      updateConversation({
        error: errorMessage(error),
        turnStatus: "Turn failed",
        ...(optimisticQueueId
          ? {
              queuedTurns: store
                .getState()
                .conversation.queuedTurns.filter((turn) => turn.id !== optimisticQueueId),
            }
          : {}),
      });
      if (!activeAtDispatch && sessionId) setSessionBusy(sessionId, false);
      if (sessionId) await refreshMessages(sessionId).catch(() => undefined);
      throw error;
    } finally {
      updateConversation({ submitting: false });
    }
  }

  async function interrupt(): Promise<void> {
    const sessionId = store.getState().conversation.selectedSessionId;
    if (!sessionId) return;
    try {
      await options.client.interruptSession(sessionId);
      setSessionBusy(sessionId, false);
      updateConversation({ turnStatus: "Interrupted" });
    } catch (error) {
      updateConversation({ error: errorMessage(error) });
    }
  }

  function monitorAgentSetup(setup: AgentSetupState): void {
    agentSetupObserver?.abort();
    const controller = new AbortController();
    agentSetupObserver = controller;
    void (async () => {
      try {
        while (!controller.signal.aborted) {
          const status = await options.client.getAgentSetup(setup.jobId);
          if (status.status === "failed") {
            updateAgentSetup({ ...setup, status: "failed", error: status.error });
            return;
          }
          if (status.status === "ready") {
            for (let attempt = 0; attempt < 10; attempt += 1) {
              await refreshSidebar();
              const ready = store
                .getState()
                .sidebar.agents.find((candidate) => candidate.id === status.agent.id);
              if (ready) {
                await selectAgent(ready.id);
                startNewConversation(ready.id);
                updateAgentSetup(idleAgentSetup);
                return;
              }
              await abortableDelay(agentSetupPollMs, controller.signal, schedule, cancelScheduled);
            }
            updateAgentSetup({
              ...setup,
              status: "failed",
              error: `${status.agent.name} is ready but has not appeared yet. Refresh and try again.`,
            });
            return;
          }
          await abortableDelay(agentSetupPollMs, controller.signal, schedule, cancelScheduled);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        updateAgentSetup({ ...setup, status: "failed", error: errorMessage(error) });
      }
    })();
  }

  async function startAgentSetup(name: string, avatarId = ""): Promise<void> {
    if (store.getState().agentSetup.status === "starting") return;
    agentSetupObserver?.abort();
    const starting: AgentSetupState = {
      status: "starting",
      jobId: "",
      agent: { id: name, name },
      avatarId,
      error: "",
    };
    updateAgentSetup(starting);
    try {
      const started = await options.client.startAgentSetup(name);
      const setup: AgentSetupState = {
        status: "setting_up",
        jobId: started.job_id,
        agent: started.agent,
        avatarId,
        error: "",
      };
      updateAgentSetup(setup);
      monitorAgentSetup(setup);
    } catch (error) {
      updateAgentSetup({ ...starting, status: "failed", error: errorMessage(error) });
    }
  }

  async function refreshRoutines(agentId: string): Promise<void> {
    // Stale-while-revalidate: keep byAgentId intact while the refresh is in flight.
    updateRoutines({ status: "loading", error: "" });
    try {
      const items = await options.client.listRoutines(agentId);
      replaceAgentRoutines(agentId, items);
    } catch (error) {
      updateRoutines({ status: "error", error: errorMessage(error) });
      throw error;
    }
  }

  async function createRoutine(input: CreateRoutineInput): Promise<void> {
    try {
      replaceAgentRoutines(input.agentId, await options.client.createRoutine(input));
    } catch (error) {
      updateRoutines({ status: "error", error: errorMessage(error) });
      throw error;
    }
  }

  async function updateRoutine(
    groupId: string,
    agentId: string,
    input: UpdateRoutineInput,
  ): Promise<void> {
    try {
      replaceAgentRoutines(agentId, await options.client.updateRoutine(groupId, agentId, input));
    } catch (error) {
      updateRoutines({ status: "error", error: errorMessage(error) });
      throw error;
    }
  }

  async function deleteRoutine(groupId: string, agentId: string): Promise<void> {
    try {
      replaceAgentRoutines(agentId, await options.client.deleteRoutine(groupId, agentId));
    } catch (error) {
      updateRoutines({ status: "error", error: errorMessage(error) });
      throw error;
    }
  }

  async function runRoutine(groupId: string, agentId: string): Promise<string> {
    try {
      const sessionId = await options.client.runRoutine(groupId, agentId);
      await refreshRoutines(agentId).catch(() => undefined);
      return sessionId;
    } catch (error) {
      updateRoutines({ status: "error", error: errorMessage(error) });
      throw error;
    }
  }

  function stopRoutinePolling(): void {
    routinePollGeneration += 1;
    if (routinePollTimer !== undefined) {
      cancelScheduled(routinePollTimer);
      routinePollTimer = undefined;
    }
  }

  function startRoutinePolling(agentId: string): void {
    stopRoutinePolling();
    const generation = routinePollGeneration;
    // The timer handle stays in closure scope: publishing it every cycle would
    // wake every routines subscriber for a value no surface reads.
    const scheduleNext = (): void => {
      routinePollTimer = schedule(() => {
        void refreshRoutines(agentId)
          .catch(() => undefined)
          .finally(() => {
            if (generation === routinePollGeneration) scheduleNext();
          });
      }, routinePollMs);
    };
    void refreshRoutines(agentId).catch(() => undefined);
    scheduleNext();
  }

  async function refreshSignalProviders(): Promise<void> {
    updateSignals({ status: "loading" });
    try {
      const providers = await options.client.listSignalProviders();
      settleSignals("providers", { providers }, "");
    } catch (error) {
      settleSignals("providers", {}, errorMessage(error));
      throw error;
    }
  }

  async function refreshSignalInstances(): Promise<void> {
    updateSignals({ status: "loading" });
    try {
      const instances = await options.client.listSignalInstances();
      settleSignals("instances", { instances }, "");
    } catch (error) {
      settleSignals("instances", {}, errorMessage(error));
      throw error;
    }
  }

  async function refreshSignalDeliveries(instanceId: string): Promise<void> {
    try {
      const deliveries = await options.client.listSignalDeliveries(instanceId);
      updateSignals({
        deliveriesByInstanceId: {
          ...store.getState().signals.deliveriesByInstanceId,
          [instanceId]: deliveries,
        },
      });
    } catch (error) {
      updateSignals({ error: errorMessage(error) });
      throw error;
    }
  }

  async function createSignalInstance(input: CreateSignalInstanceInput): Promise<SignalInstance> {
    try {
      const instance = await options.client.createSignalInstance(input);
      await refreshSignalInstances().catch(() => undefined);
      return instance;
    } catch (error) {
      updateSignals({ status: "error", error: errorMessage(error) });
      throw error;
    }
  }

  async function updateSignalInstance(
    id: string,
    input: UpdateSignalInstanceInput,
  ): Promise<SignalInstance> {
    try {
      const instance = await options.client.updateSignalInstance(id, input);
      await refreshSignalInstances().catch(() => undefined);
      return instance;
    } catch (error) {
      updateSignals({ status: "error", error: errorMessage(error) });
      throw error;
    }
  }

  async function deleteSignalInstance(id: string): Promise<void> {
    try {
      await options.client.deleteSignalInstance(id);
      await refreshSignalInstances().catch(() => undefined);
    } catch (error) {
      updateSignals({ status: "error", error: errorMessage(error) });
      throw error;
    }
  }

  const actions: OpenBotActions = {
    initialize,
    checkAuthentication,
    async signIn() {
      updateAuth({ error: "" });
      try {
        await options.auth.signIn();
        await checkAuthentication();
        if (store.getState().auth.status === "authenticated") {
          await refreshSidebar();
          beginMissionControlObservation();
        }
      } catch (error) {
        updateAuth({ status: "unauthenticated", error: errorMessage(error) });
        throw error;
      }
    },
    async signOut() {
      await options.auth.signOut();
      missionControlObserver?.abort();
      agentSetupObserver?.abort();
      stopRoutinePolling();
      clearSignalErrors();
      busySessionIds.clear();
      liveMessagesBySession.clear();
      options.agentSetupPersistence?.save(null);
      store.setState({
        ...initialState,
        auth: { status: "unauthenticated", session: null, error: "" },
        sidebar: { ...initialState.sidebar, loading: false },
      });
    },
    refreshSidebar,
    loadMoreAgents,
    selectAgent,
    startNewConversation,
    selectSession,
    ensureSession,
    refreshMessages,
    loadOlderMessages,
    sendMessage,
    interrupt,
    refreshQueue,
    removeQueuedTurn,
    reorderQueuedTurn,
    steerQueuedTurn,
    startAgentSetup,
    dismissAgentSetup() {
      agentSetupObserver?.abort();
      updateAgentSetup(idleAgentSetup);
    },
    refreshRoutines,
    createRoutine,
    updateRoutine,
    deleteRoutine,
    runRoutine,
    startRoutinePolling,
    stopRoutinePolling,
    refreshSignalProviders,
    refreshSignalInstances,
    createSignalInstance,
    updateSignalInstance,
    deleteSignalInstance,
    testSignalInstance: (id, input) => options.client.testSignalInstance(id, input),
    refreshSignalDeliveries,
    setError(message) {
      updateConversation({ error: message });
    },
  };

  return {
    client: options.client,
    store,
    actions,
    dispose() {
      missionControlObserver?.abort();
      agentSetupObserver?.abort();
      stopRoutinePolling();
      if (refreshTimer) cancelScheduled(refreshTimer);
      if (sidebarRefreshTimer) cancelScheduled(sidebarRefreshTimer);
      queueRefreshes.clear();
    },
  };
}

function eventSessionId(value: unknown, depth = 0): string {
  if (depth > 6) return "";
  const event = record(value);
  const direct = event.session_id ?? event.sessionId;
  if (typeof direct === "string") return direct;
  for (const payload of Object.values(event)) {
    if (payload && typeof payload === "object") {
      const sessionId = eventSessionId(payload, depth + 1);
      if (sessionId) return sessionId;
    }
  }
  return "";
}

function nestedString(value: unknown, key: string, depth = 0): string {
  if (depth > 6) return "";
  const item = record(value);
  if (typeof item[key] === "string") return item[key];
  for (const nested of Object.values(item)) {
    if (nested && typeof nested === "object") {
      const found = nestedString(nested, key, depth + 1);
      if (found) return found;
    }
  }
  return "";
}

function updateSidebarForSessionEvent(
  store: StoreApi<OpenBotState>,
  sessionId: string,
  messages: ChatMessage[],
  unread: boolean,
  receivedAt: Date,
): void {
  const preview = latestMessagePreview(messages);
  if (!preview) return;
  const updatedAt = receivedAt.toISOString();
  store.setState((state) => ({
    sidebar: {
      ...state.sidebar,
      agents: state.sidebar.agents.map((agent) => {
        const session = agent.sessions.items.find((candidate) => candidate.id === sessionId);
        if (!session) return agent;
        const updatedSession = {
          ...session,
          updated_at: updatedAt,
          unread: unread || session.unread,
        };
        return {
          ...agent,
          last_message_preview: preview,
          sessions: {
            ...agent.sessions,
            items: [
              updatedSession,
              ...agent.sessions.items.filter((candidate) => candidate.id !== sessionId),
            ],
          },
        };
      }),
    },
  }));
}

function optimisticQueuedTurn(
  id: string,
  sessionId: string,
  text: string,
  parts: ChatPart[] | undefined,
  queuePosition: number,
  createdAt: Date,
): QueuedTurn {
  return {
    id,
    session_id: sessionId,
    queue_position: queuePosition,
    status: "pending",
    chat_request: {
      messages: [{ role: "user", content: parts ?? (text ? [{ type: "text", text }] : []) }],
    },
    trigger_message_ids: [],
    created_at: createdAt.toISOString(),
  };
}

function attachPersistedQueuedMessageIds(
  queuedTurns: QueuedTurn[],
  previousMessages: ChatMessage[],
  messages: ChatMessage[],
): QueuedTurn[] {
  const previousIds = new Set(previousMessages.map((message) => message.id));
  const createdUserMessages = messages.filter(
    (message) => message.role === "user" && !previousIds.has(message.id),
  );
  if (createdUserMessages.length === 0) return queuedTurns;
  const next = [...queuedTurns];
  for (const message of createdUserMessages) {
    const index = next.findIndex(
      (turn) =>
        turn.id.startsWith(optimisticQueuePrefix) &&
        !turn.trigger_message_ids?.length &&
        queuedTurnText(turn) === messageText(message).trim(),
    );
    if (index === -1) continue;
    next[index] = { ...next[index]!, trigger_message_ids: [message.id] };
  }
  return next;
}

function reconcileQueuedTurns(
  durableTurns: QueuedTurn[],
  currentTurns: QueuedTurn[],
  currentTime: Date,
): QueuedTurn[] {
  const durableTriggerIds = new Set(durableTurns.flatMap((turn) => turn.trigger_message_ids ?? []));
  const optimistic = currentTurns.filter((turn) => {
    if (!turn.id.startsWith(optimisticQueuePrefix)) return false;
    if (turn.trigger_message_ids?.some((id) => durableTriggerIds.has(id))) return false;
    if (!turn.trigger_message_ids?.length) return true;
    return currentTime.getTime() - Date.parse(turn.created_at) < optimisticQueueGraceMs;
  });
  return [...durableTurns, ...optimistic].sort(
    (left, right) => left.queue_position - right.queue_position,
  );
}

function reconcileQueuedEvent(currentTurns: QueuedTurn[], durableTurn: QueuedTurn): QueuedTurn[] {
  const durableTriggerIds = new Set(durableTurn.trigger_message_ids ?? []);
  const optimisticIndex = currentTurns.findIndex(
    (turn) =>
      turn.id.startsWith(optimisticQueuePrefix) &&
      (turn.trigger_message_ids?.some((id) => durableTriggerIds.has(id)) ||
        (turn.session_id === durableTurn.session_id &&
          queuedTurnText(turn) === queuedTurnText(durableTurn))),
  );
  return [
    ...currentTurns.filter(
      (turn, index) => turn.id !== durableTurn.id && index !== optimisticIndex,
    ),
    durableTurn,
  ].sort((left, right) => left.queue_position - right.queue_position);
}

function queuedTurnText(turn: QueuedTurn): string {
  const messages = turn.chat_request.messages;
  if (!Array.isArray(messages)) return "";
  const latest = messages.filter((message) => record(message).role === "user").at(-1);
  return unknownText(record(latest).content ?? record(latest).parts).trim();
}

function unknownText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(unknownText).filter(Boolean).join("\n");
  const item = record(value);
  if (typeof item.text === "string") return item.text;
  const nested = item.content ?? item.parts;
  return nested === undefined ? "" : unknownText(nested);
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function queueEventQueuedTurn(value: unknown): QueuedTurn | null {
  const parsed = QueuedTurnSchema.safeParse(queueEventItem(value));
  return parsed.success ? parsed.data : null;
}

function queueEventItem(value: unknown): unknown {
  const data = record(value);
  const kind = record(data.kind);
  const namedKind = typeof kind.kind === "string" ? kind.kind.toLowerCase() : "";
  return (
    record(kind.agent_turn_queued).queue_item ??
    record(kind.AgentTurnQueued).queue_item ??
    record(kind.agent_turn_dequeued).queue_item ??
    record(kind.AgentTurnDequeued).queue_item ??
    (namedKind === "agent_turn_queued" || namedKind === "agent_turn_dequeued"
      ? kind.queue_item
      : undefined) ??
    data.queue_item
  );
}

function queueEventTriggerMessageIds(value: unknown): string[] {
  const ids = record(queueEventItem(value)).trigger_message_ids;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

function uniqueAgents(agents: ChatAgent[]): ChatAgent[] {
  return [...new Map(agents.map((agent) => [agent.id, agent])).values()];
}

function addSession(agents: ChatAgent[], agentId: string, session: ChatSession): ChatAgent[] {
  return agents.map((agent) =>
    agent.id === agentId
      ? { ...agent, sessions: { ...agent.sessions, items: [session, ...agent.sessions.items] } }
      : agent,
  );
}

function titleFrom(text: string): string {
  const value = text || "New chat";
  return value.length > 80 ? `${value.slice(0, 77)}...` : value;
}

async function abortableDelay(
  milliseconds: number,
  signal: AbortSignal,
  schedule: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>,
  cancelScheduled: (handle: ReturnType<typeof setTimeout>) => void,
): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const timer = schedule(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        cancelScheduled(timer);
        resolve();
      },
      { once: true },
    );
  });
}
