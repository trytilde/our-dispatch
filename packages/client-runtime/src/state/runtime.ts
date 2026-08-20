import { createStore, type StoreApi } from "zustand/vanilla";
import type { OpenBotClient } from "../chat/client.js";
import {
  eventBusyState,
  eventName,
  eventStatus,
  latestMessagePreview,
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
import type { QueuedTurn } from "../contracts/queue.js";
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

export interface OpenBotState {
  auth: AuthState;
  sidebar: SidebarState;
  conversation: ConversationState;
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
  runQueuedTurnNow(id: string): Promise<void>;
  reorderQueuedTurn(id: string, queuePosition: number): Promise<void>;
  removeQueuedTurn(id: string): Promise<void>;
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
}

const initialState: OpenBotState = {
  auth: { status: "checking", session: null, error: "" },
  sidebar: { agents: [], selectedAgentId: "", loading: true, error: "" },
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
};

export function createOpenBotRuntime(options: OpenBotRuntimeOptions): OpenBotRuntime {
  const store = createStore<OpenBotState>(() => initialState);
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? (() => globalThis.crypto.randomUUID());
  const schedule = options.schedule ?? ((callback, delay) => setTimeout(callback, delay));
  const cancelScheduled = options.cancelScheduled ?? clearTimeout;
  const agentSort = options.agentSort ?? "updated_at";
  const sessionSort = options.sessionSort ?? "updated_at";
  let observer: AbortController | undefined;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let initializePromise: Promise<void> | undefined;

  const updateAuth = (patch: Partial<AuthState>) =>
    store.setState((state) => ({ auth: { ...state.auth, ...patch } }));
  const updateSidebar = (patch: Partial<SidebarState>) =>
    store.setState((state) => ({ sidebar: { ...state.sidebar, ...patch } }));
  const updateConversation = (patch: Partial<ConversationState>) =>
    store.setState((state) => ({ conversation: { ...state.conversation, ...patch } }));

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

  async function refreshSidebar(): Promise<void> {
    updateSidebar({ loading: true, error: "" });
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
        loading: false,
      });
      if (selectedAgentId && !store.getState().conversation.selectedSessionId) {
        const session = agents.find((agent) => agent.id === selectedAgentId)?.sessions.items[0];
        if (session) await selectSession(selectedAgentId, session);
      }
    } catch (error) {
      updateSidebar({ loading: false, error: errorMessage(error) });
      throw error;
    }
  }

  async function initialize(): Promise<void> {
    initializePromise ??= (async () => {
      await checkAuthentication();
      if (store.getState().auth.status === "authenticated")
        await refreshSidebar().catch(() => undefined);
      else updateSidebar({ loading: false });
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
    updateConversation({
      messages: uniqueMessages(
        preserveLiveMessages ? [...response.items, ...current] : response.items,
      ),
      nextMessageToken: response.next_page_token,
    });
  }

  async function refreshQueue(
    sessionId = store.getState().conversation.selectedSessionId,
  ): Promise<void> {
    if (!sessionId) return;
    const response = await options.client.getQueuedTurns(sessionId);
    if (store.getState().conversation.selectedSessionId !== sessionId) return;
    updateConversation({
      queuedTurns: [...response.items].sort(
        (left, right) => left.queue_position - right.queue_position,
      ),
    });
  }

  async function mutateQueue(id: string, operation: () => Promise<void>): Promise<void> {
    const conversation = store.getState().conversation;
    const sessionId =
      conversation.queuedTurns.find((turn) => turn.id === id)?.session_id ||
      conversation.selectedSessionId;
    if (!sessionId) return;
    try {
      await operation();
      await refreshQueue(sessionId);
    } catch (error) {
      updateConversation({ error: errorMessage(error) });
      throw error;
    }
  }

  const runQueuedTurnNow = (id: string) =>
    mutateQueue(id, () => options.client.steerQueuedTurn(id));
  const reorderQueuedTurn = (id: string, queuePosition: number) =>
    mutateQueue(id, () => options.client.reorderQueuedTurn(id, queuePosition));
  const removeQueuedTurn = (id: string) =>
    mutateQueue(id, () => options.client.deleteQueuedTurn(id));

  function beginObservation(sessionId: string): void {
    observer?.abort();
    const controller = new AbortController();
    const seenEventIds = new Set<string>();
    observer = controller;
    updateConversation({ streamStatus: "Connecting" });
    void (async () => {
      while (!controller.signal.aborted) {
        try {
          updateConversation({ streamStatus: "Live" });
          await options.client.observeSession(sessionId, controller.signal, (event) => {
            if (event.id && seenEventIds.has(event.id)) return;
            if (event.id) {
              seenEventIds.add(event.id);
              if (seenEventIds.size > 1_000) {
                const oldest = seenEventIds.values().next().value;
                if (oldest) seenEventIds.delete(oldest);
              }
            }
            const state = store.getState();
            if (state.conversation.selectedSessionId !== sessionId) return;
            const reduction = reduceLiveChatEvent(
              state.conversation.messages,
              event,
              sessionId,
              now(),
            );
            const busy = eventBusyState(event);
            updateConversation({
              messages: reduction.messages,
              activity: [{ ...event, receivedAt: now() }, ...state.conversation.activity].slice(
                0,
                60,
              ),
              turnStatus: eventStatus(event) || state.conversation.turnStatus,
              ...(busy === undefined ? {} : { agentBusy: busy }),
            });
            if (eventName(event).includes("queue"))
              void refreshQueue(sessionId).catch(() => undefined);
            if (refreshTimer) cancelScheduled(refreshTimer);
            if (!reduction.streaming) {
              refreshTimer = schedule(() => {
                void refreshMessages(sessionId, true).catch((error) =>
                  updateConversation({ error: errorMessage(error) }),
                );
              }, 80);
            }
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
      messages: [],
      nextMessageToken: undefined,
      queuedTurns: [],
      activity: [],
      loading: true,
      agentBusy: false,
      streamStatus: "Connecting",
      turnStatus: "",
      error: "",
    });
    beginObservation(session.id);
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
    observer?.abort();
    updateSidebar({ selectedAgentId: agentId });
    updateConversation({
      selectedSessionId: "",
      messages: [],
      queuedTurns: [],
      activity: [],
      agentBusy: false,
      streamStatus: "Disconnected",
      turnStatus: "",
      error: "",
    });
  }

  function startNewConversation(agentId: string): void {
    if (!store.getState().sidebar.agents.some((agent) => agent.id === agentId)) return;
    observer?.abort();
    updateSidebar({ selectedAgentId: agentId });
    updateConversation({
      selectedSessionId: "",
      messages: [],
      nextMessageToken: undefined,
      queuedTurns: [],
      activity: [],
      loading: false,
      agentBusy: false,
      streamStatus: "Disconnected",
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
    beginObservation(created.id);
    return created.id;
  }

  async function sendMessage(input: SendMessageInput): Promise<void> {
    const text = input.text.trim();
    const state = store.getState();
    const agentId = state.sidebar.selectedAgentId;
    if ((!text && !input.attachmentIds?.length) || !agentId || state.conversation.submitting)
      return;
    const queueing = state.conversation.agentBusy;
    updateConversation({
      submitting: true,
      error: "",
      turnStatus: queueing ? "Adding to queue" : "Starting turn",
    });
    let sessionId = state.conversation.selectedSessionId;
    try {
      if (!sessionId) sessionId = await ensureSession(input.title || titleFrom(text));
      if (!queueing) {
        const optimistic: ChatMessage = {
          id: `optimistic-${createId()}`,
          type: "ui",
          role: "user",
          session_id: sessionId,
          user_display_name: "You",
          parts: input.optimisticParts ?? (text ? [{ type: "text", text }] : []),
          created_at: now().toISOString(),
        };
        updateConversation({ messages: [...store.getState().conversation.messages, optimistic] });
      }
      const response = await options.client.sendMessage(
        agentId,
        sessionId,
        text,
        input.attachmentIds,
      );
      if (!queueing)
        updateConversation({
          messages: uniqueMessages(response.items),
          nextMessageToken: response.next_page_token,
          agentBusy: true,
        });
      updateConversation({ turnStatus: queueing ? "Queued" : "Agent working" });
      await Promise.all([refreshSidebar(), refreshQueue(sessionId)]);
    } catch (error) {
      updateConversation({ error: errorMessage(error), turnStatus: "Turn failed" });
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
      updateConversation({ turnStatus: "Interrupted", agentBusy: false });
    } catch (error) {
      updateConversation({ error: errorMessage(error) });
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
        if (store.getState().auth.status === "authenticated") await refreshSidebar();
      } catch (error) {
        updateAuth({ status: "unauthenticated", error: errorMessage(error) });
        throw error;
      }
    },
    async signOut() {
      await options.auth.signOut();
      observer?.abort();
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
    runQueuedTurnNow,
    reorderQueuedTurn,
    removeQueuedTurn,
    setError(message) {
      updateConversation({ error: message });
    },
  };

  return {
    client: options.client,
    store,
    actions,
    dispose() {
      observer?.abort();
      if (refreshTimer) cancelScheduled(refreshTimer);
    },
  };
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
