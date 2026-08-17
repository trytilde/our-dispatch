import {
  type Dispatch,
  type FormEvent,
  type SetStateAction,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type AgentSortOrder,
  type ChatAgent,
  type ChatEvent,
  type ChatMessage,
  type ChatPart,
  type ChatSession,
  createSession,
  deleteAttachment,
  deleteQueuedTurn,
  getAttachmentDownloadUrl,
  getMessages,
  getQueuedTurns,
  getSidebar,
  interruptSession,
  observeSession,
  type QueuedTurn,
  reorderQueuedTurn,
  rewriteTildeUrl,
  sendMessage,
  type SessionSortOrder,
  steerQueuedTurn,
  uploadAttachment,
} from "../chat-api.js";
import {
  type AsyncTask,
  AsyncTasksPanel,
  AgentWorkspacePanel,
  AgentActivity,
  ChatComposer,
  ChatHeader,
  ChatPane,
  ConversationSurface,
  ConversationMessage,
  type ConversationOutlineItem,
  ConversationOutlinePanel,
  EmptyConversation,
  MessageContent,
  ScrollToLatestButton,
  ThinkingIndicator,
  ThreadOverlay,
  WorkspaceSidebar,
  WorkspaceShell,
  useWorkspaceLayout,
} from "@tryopenbot/ui";

interface PendingFile {
  id: string;
  file: File;
  progress: number;
  status: "ready" | "uploading" | "uploaded" | "error";
  attachmentId?: string;
  error?: string;
}

interface ActivityEvent extends ChatEvent {
  receivedAt: Date;
}

const suggestions = [
  "Inspect this workspace and tell me what to improve first",
  "Build a small feature and verify it end to end",
  "Research a topic, cite sources, and save a concise brief",
];

export function OpenBotApp() {
  const [agents, setAgents] = useState<ChatAgent[]>([]);
  const [nextAgentToken, setNextAgentToken] = useState<string | null>();
  const [agentId, setAgentId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [nextMessageToken, setNextMessageToken] = useState<string | null>();
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [agentBusy, setAgentBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [queuedTurns, setQueuedTurns] = useState<QueuedTurn[]>([]);
  const [streamStatus, setStreamStatus] = useState("Disconnected");
  const [turnStatus, setTurnStatus] = useState("");
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [composerFocused, setComposerFocused] = useState(false);
  const [agentSort] = useState<AgentSortOrder>("updated_at");
  const [sessionSort] = useState<SessionSortOrder>("updated_at");
  const [messageMenuId, setMessageMenuId] = useState("");
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [threadRootId, setThreadRootId] = useState("");
  const [conversationOutlineOpen, setConversationOutlineOpen] = useState(false);
  const [asyncTasksOpen, setAsyncTasksOpen] = useState(false);
  const observerRef = useRef<AbortController | undefined>(undefined);
  const refreshTimerRef = useRef<number | undefined>(undefined);
  const conversationRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerInputRef = useRef<HTMLTextAreaElement>(null);
  const scrollSnapshotsRef = useRef<Record<string, number>>(readScrollSnapshots());
  const restoredSessionRef = useRef("");
  const stickToBottomRef = useRef(true);
  const previousMessageIdRef = useRef("");
  const loadedAgentRef = useRef("");
  const [showScrollLatest, setShowScrollLatest] = useState(false);
  const layout = useWorkspaceLayout();

  const selectedAgent = agents.find((agent) => agent.id === agentId);
  const conversationOutlineItems = useMemo(() => outlineItems(messages), [messages]);
  const asyncTasks = useMemo(() => activeAsyncTasks(activity), [activity]);
  const hasContent = Boolean(draft.trim() || files.length);
  const composerExpanded =
    composerFocused || draft.includes("\n") || draft.length > 80 || files.length > 0;

  useLayoutEffect(() => {
    const input = composerInputRef.current;
    if (!input) return;
    input.style.height = "0px";
    input.style.height = `${Math.min(200, Math.max(44, input.scrollHeight))}px`;
  }, [draft]);

  const refreshSidebar = useCallback(async () => {
    const response = await getSidebar("", agentSort, sessionSort);
    const hydratedAgents = await Promise.all(
      response.items.map(async (agent) => {
        const latestSession = agent.sessions.items[0];
        if (!latestSession) return agent;
        try {
          const page = await getMessages(latestSession.id);
          return { ...agent, last_message_preview: latestMessagePreview(page.items) };
        } catch {
          return agent;
        }
      }),
    );
    setAgents(hydratedAgents);
    setNextAgentToken(response.next_page_token);
    setAgentId((current) =>
      hydratedAgents.some((agent) => agent.id === current)
        ? current
        : (hydratedAgents[0]?.id ?? ""),
    );
  }, [agentSort, sessionSort]);

  const refreshMessages = useCallback(async (id: string, preserveLiveMessages = false) => {
    const response = await getMessages(id);
    setMessages((current) =>
      uniqueMessages(preserveLiveMessages ? [...response.items, ...current] : response.items),
    );
    setNextMessageToken(response.next_page_token);
  }, []);

  const refreshQueue = useCallback(async (id: string) => {
    const response = await getQueuedTurns(id);
    setQueuedTurns(
      response.items.sort((left, right) => left.queue_position - right.queue_position),
    );
  }, []);

  const beginObservation = useCallback(
    (id: string) => {
      observerRef.current?.abort();
      const controller = new AbortController();
      const seenEventIds = new Set<string>();
      observerRef.current = controller;
      setStreamStatus("Connecting");

      void (async () => {
        while (!controller.signal.aborted) {
          try {
            setStreamStatus("Live");
            await observeSession(id, controller.signal, (event) => {
              if (event.id && seenEventIds.has(event.id)) return;
              if (event.id) {
                seenEventIds.add(event.id);
                if (seenEventIds.size > 1_000) {
                  const oldest = seenEventIds.values().next().value;
                  if (oldest) seenEventIds.delete(oldest);
                }
              }
              setActivity((current) =>
                [{ ...event, receivedAt: new Date() }, ...current].slice(0, 60),
              );
              const status = eventStatus(event);
              if (status) setTurnStatus(status);
              const busy = eventBusyState(event);
              if (busy !== undefined) setAgentBusy(busy);
              if (eventName(event).includes("queue")) {
                void refreshQueue(id).catch(() => undefined);
              }
              const streaming = applyLiveChatEvent(event, id, setMessages);
              if (streaming) {
                window.clearTimeout(refreshTimerRef.current);
                return;
              }
              window.clearTimeout(refreshTimerRef.current);
              refreshTimerRef.current = window.setTimeout(() => {
                void refreshMessages(id, true).catch((reason: unknown) =>
                  setError(errorMessage(reason)),
                );
              }, 80);
            });
          } catch (reason) {
            if (controller.signal.aborted) break;
            setStreamStatus("Reconnecting");
            setError(errorMessage(reason));
          }
          await abortableDelay(900, controller.signal);
        }
      })();
    },
    [refreshMessages, refreshQueue],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshSidebar()
        .catch((reason: unknown) => setError(errorMessage(reason)))
        .finally(() => setLoading(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshSidebar]);

  useEffect(() => {
    if (loading || !agentId || loadedAgentRef.current === agentId) return;
    const agent = agents.find((candidate) => candidate.id === agentId);
    const latestSession = agent?.sessions.items[0];
    loadedAgentRef.current = agentId;
    if (latestSession) void selectSession(agentId, latestSession);
  }, [agentId, agents, loading]);

  useEffect(
    () => () => {
      observerRef.current?.abort();
      window.clearTimeout(refreshTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    const element = conversationRef.current;
    if (!element || loadingMessages || !sessionId) return;
    const latestMessageId = messages.at(-1)?.id ?? "";
    if (restoredSessionRef.current !== sessionId) {
      const restore = () => {
        const distance = scrollSnapshotsRef.current[sessionId] ?? 0;
        element.scrollTop = Math.max(0, element.scrollHeight - element.clientHeight - distance);
        stickToBottomRef.current = distance <= 120;
        setShowScrollLatest(distance > 120);
      };
      restore();
      const frame = window.requestAnimationFrame(restore);
      restoredSessionRef.current = sessionId;
      previousMessageIdRef.current = latestMessageId;
      return () => window.cancelAnimationFrame(frame);
    }
    if (
      stickToBottomRef.current &&
      (latestMessageId !== previousMessageIdRef.current || agentBusy || submitting)
    ) {
      element.scrollTo({ top: element.scrollHeight, behavior: agentBusy ? "auto" : "smooth" });
      saveScrollSnapshot(sessionId, 0, scrollSnapshotsRef);
      setShowScrollLatest(false);
    }
    previousMessageIdRef.current = latestMessageId;
  }, [agentBusy, loadingMessages, messages, sessionId, submitting]);

  const queuedMessageIds = useMemo(
    () => new Set(queuedTurns.flatMap((turn) => turn.trigger_message_ids ?? [])),
    [queuedTurns],
  );
  const visibleMessages = useMemo(
    () => messages.filter((message) => !queuedMessageIds.has(message.id)),
    [messages, queuedMessageIds],
  );
  const threadRoot = visibleMessages.find((message) => message.id === threadRootId);

  const filteredAgents = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query
      ? agents.filter((agent) => agent.display_name.toLowerCase().includes(query))
      : agents;
  }, [agents, search]);

  async function selectSession(nextAgentId: string, nextSession: ChatSession): Promise<void> {
    loadedAgentRef.current = nextAgentId;
    setAgentId(nextAgentId);
    setSessionId(nextSession.id);
    setMessages([]);
    setFiles([]);
    setReplyingTo(null);
    setThreadRootId("");
    setError("");
    setActivity([]);
    setQueuedTurns([]);
    setTurnStatus("");
    setAgentBusy(false);
    restoredSessionRef.current = "";
    setLoadingMessages(true);
    beginObservation(nextSession.id);
    try {
      await refreshMessages(nextSession.id, true);
      await refreshQueue(nextSession.id);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoadingMessages(false);
    }
  }

  function selectAgent(agent: ChatAgent): void {
    const latestSession = agent.sessions.items[0];
    if (latestSession) {
      void selectSession(agent.id, latestSession);
      return;
    }
    observerRef.current?.abort();
    loadedAgentRef.current = agent.id;
    setAgentId(agent.id);
    setSessionId("");
    setMessages([]);
    setFiles([]);
    setReplyingTo(null);
    setThreadRootId("");
    setActivity([]);
    setQueuedTurns([]);
    setTurnStatus("");
    setAgentBusy(false);
    restoredSessionRef.current = "";
    setStreamStatus("Disconnected");
    setError("");
  }

  async function send(event: FormEvent): Promise<void> {
    event.preventDefault();
    const authoredText = draft.trim();
    if (!hasContent || !agentId || submitting) return;
    const text = replyingTo
      ? `> ${messageText(replyingTo).replaceAll("\n", "\n> ")}\n\n${authoredText}`.trim()
      : authoredText;
    const queueing = agentBusy;
    const outgoingFiles = files;
    setSubmitting(true);
    setError("");
    setTurnStatus(queueing ? "Adding to queue" : "Starting turn");
    let activeSessionId = sessionId;
    try {
      if (!activeSessionId) {
        const created = await createSession(agentId, titleFrom(text, outgoingFiles));
        activeSessionId = created.id;
        setSessionId(created.id);
        setAgents((current) => addSession(current, agentId, created));
        beginObservation(created.id);
      }

      if (!queueing) {
        const optimistic = optimisticMessage(activeSessionId, text, outgoingFiles);
        setMessages((current) => [...current, optimistic]);
      }
      setDraft("");
      setReplyingTo(null);
      setThreadRootId("");
      setFiles([]);

      const attachmentIds: string[] = [];
      for (const pending of outgoingFiles) {
        setFiles((current) => [...current, { ...pending, status: "uploading", progress: 0 }]);
        try {
          const attachment = await uploadAttachment(activeSessionId, pending.file, (progress) =>
            setFileState(pending.id, { progress }),
          );
          attachmentIds.push(attachment.id);
          setFileState(pending.id, {
            status: "uploaded",
            progress: 1,
            attachmentId: attachment.id,
          });
        } catch (reason) {
          setFileState(pending.id, { status: "error", error: errorMessage(reason) });
          throw reason;
        }
      }

      const response = await sendMessage(agentId, activeSessionId, text, attachmentIds);
      if (!queueing) {
        setMessages(uniqueMessages(response.items));
        setNextMessageToken(response.next_page_token);
        setAgentBusy(true);
      }
      setFiles([]);
      setTurnStatus(queueing ? "Queued" : "Agent working");
      await refreshSidebar();
      await refreshQueue(activeSessionId);
    } catch (reason) {
      setError(errorMessage(reason));
      setTurnStatus("Turn failed");
      if (activeSessionId) await refreshMessages(activeSessionId).catch(() => undefined);
    } finally {
      setSubmitting(false);
    }
  }

  async function stop(): Promise<void> {
    if (!sessionId) return;
    try {
      await interruptSession(sessionId);
      setTurnStatus("Interrupted");
      setAgentBusy(false);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  function addFiles(incoming: FileList | File[]): void {
    const additions = [...incoming].map((file) => ({
      id: crypto.randomUUID(),
      file,
      progress: 0,
      status: "ready" as const,
    }));
    setFiles((current) => [...current, ...additions].slice(0, 10));
  }

  function setFileState(id: string, patch: Partial<PendingFile>): void {
    setFiles((current) => current.map((file) => (file.id === id ? { ...file, ...patch } : file)));
  }

  async function removeFile(pending: PendingFile): Promise<void> {
    if (pending.attachmentId && sessionId) {
      await deleteAttachment(sessionId, pending.attachmentId).catch(() => undefined);
    }
    setFiles((current) => current.filter((file) => file.id !== pending.id));
  }

  async function loadOlderMessages(): Promise<void> {
    if (!sessionId || !nextMessageToken) return;
    const response = await getMessages(sessionId, nextMessageToken);
    setMessages((current) => uniqueMessages([...response.items, ...current]));
    setNextMessageToken(response.next_page_token);
  }

  async function loadMoreAgents(): Promise<void> {
    if (!nextAgentToken) return;
    try {
      const response = await getSidebar("", agentSort, sessionSort, nextAgentToken);
      setAgents((current) => uniqueAgents([...current, ...response.items]));
      setNextAgentToken(response.next_page_token);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  async function mutateQueue(operation: () => Promise<void>): Promise<void> {
    if (!sessionId) return;
    try {
      await operation();
      await refreshQueue(sessionId);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  async function editQueuedTurn(turn: QueuedTurn): Promise<void> {
    const text = queuedTurnText(turn);
    await mutateQueue(() => deleteQueuedTurn(turn.id));
    setDraft(text === "Queued agent turn" ? "" : text);
  }

  function handleConversationScroll(): void {
    const element = conversationRef.current;
    if (!element || !sessionId) return;
    const distance = Math.max(0, element.scrollHeight - element.clientHeight - element.scrollTop);
    stickToBottomRef.current = distance <= 120;
    setShowScrollLatest(distance > 120);
    saveScrollSnapshot(sessionId, distance, scrollSnapshotsRef);
  }

  function scrollToLatest(): void {
    const element = conversationRef.current;
    if (!element || !sessionId) return;
    element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
    stickToBottomRef.current = true;
    setShowScrollLatest(false);
    saveScrollSnapshot(sessionId, 0, scrollSnapshotsRef);
  }

  function openSearch(): void {
    setSearch("");
    setSearchOpen(true);
  }

  function closeSearch(): void {
    setSearchOpen(false);
    setSearch("");
  }

  const composer = (
    <ChatComposer
      agentAvailable={Boolean(agentId)}
      busy={agentBusy}
      submitting={submitting}
      dragging={dragging}
      expanded={composerExpanded}
      draft={draft}
      error={error}
      reply={
        replyingTo
          ? {
              label: `Replying to ${replyingTo.role === "user" ? "yourself" : selectedAgent?.display_name || "agent"}`,
              text: messageText(replyingTo) || "Message",
            }
          : undefined
      }
      attachments={files.map((pending) => ({
        id: pending.id,
        name: pending.file.name,
        size: pending.file.size,
        progress: pending.progress,
        status: pending.status,
        error: pending.error,
      }))}
      inputRef={composerInputRef}
      fileInputRef={fileInputRef}
      onSubmit={(event) => void send(event)}
      onDraftChange={setDraft}
      onFocus={() => setComposerFocused(true)}
      onBlur={() => setComposerFocused(false)}
      onDragStateChange={setDragging}
      onFilesAdded={addFiles}
      onRemoveAttachment={(id) => {
        const pending = files.find((candidate) => candidate.id === id);
        if (pending) void removeFile(pending);
      }}
      onCancelReply={() => {
        setReplyingTo(null);
        setThreadRootId("");
      }}
      onStop={() => void stop()}
    />
  );

  return (
    <WorkspaceShell
      sidebarCollapsed={layout.sidebarCollapsed}
      computerOpen={layout.workspaceOpen}
      style={layout.style}
    >
      <WorkspaceSidebar
        agents={filteredAgents.map((agent) => ({
          id: agent.id,
          name: agent.display_name,
          lastMessage:
            agent.id === agentId
              ? latestMessagePreview(messages)
              : agent.last_message_preview || "",
          updatedAt: agent.last_user_message_at || agent.sessions.items[0]?.updated_at,
          unread: agent.sessions.items.some((item) => item.unread),
        }))}
        selectedAgentId={agentId}
        loading={loading}
        hasMore={Boolean(nextAgentToken)}
        searchOpen={searchOpen}
        searchValue={search}
        onSearchChange={setSearch}
        onSearchOpen={openSearch}
        onSearchClose={closeSearch}
        onSelectAgent={(id) => {
          const agent = agents.find((candidate) => candidate.id === id);
          if (agent) selectAgent(agent);
        }}
        onLoadMore={() => void loadMoreAgents()}
        onResize={layout.beginSidebarResize}
      />

      <ChatPane>
        <ChatHeader
          agentId={selectedAgent?.id}
          agentName={selectedAgent?.display_name || "OpenBot"}
          status={turnStatus || (streamStatus === "Live" ? "Online" : selectedAgent?.status)}
          computerOpen={layout.workspaceOpen}
          onToggleComputer={layout.toggleWorkspace}
          conversationOutlineOpen={conversationOutlineOpen}
          asyncTasksOpen={asyncTasksOpen}
          onToggleConversationOutline={() => setConversationOutlineOpen((value) => !value)}
          onToggleAsyncTasks={() => setAsyncTasksOpen((value) => !value)}
        />

        <ConversationSurface scrollRef={conversationRef} onScroll={handleConversationScroll}>
          {loadingMessages ? (
            <div className="conversation-loading">Loading conversation…</div>
          ) : null}
          {!loadingMessages && messages.length === 0 ? (
            <EmptyConversation suggestions={suggestions} onSelectSuggestion={setDraft} />
          ) : (
            <div className="message-list">
              {nextMessageToken ? (
                <button className="older-messages" onClick={() => void loadOlderMessages()}>
                  Load earlier messages
                </button>
              ) : null}
              {visibleMessages.map((message, index) => {
                const previous = visibleMessages[index - 1];
                const next = visibleMessages[index + 1];
                const continuedPrevious = previous?.role === message.role;
                const continuedNext = next?.role === message.role;
                return (
                  <ConversationMessage
                    key={message.id}
                    role={message.role}
                    createdAt={message.created_at}
                    continuedPrevious={continuedPrevious}
                    continuedNext={continuedNext}
                    menuOpen={messageMenuId === message.id}
                    onReply={() => {
                      setReplyingTo(message);
                      composerInputRef.current?.focus();
                    }}
                    onToggleMenu={() => {
                      setMessageMenuId((current) => (current === message.id ? "" : message.id));
                    }}
                    onStartThread={() => {
                      setThreadRootId(message.id);
                      setReplyingTo(message);
                      setMessageMenuId("");
                      composerInputRef.current?.focus();
                    }}
                    onCopy={() => {
                      void navigator.clipboard.writeText(messageText(message));
                      setMessageMenuId("");
                    }}
                  >
                    <MessageContent
                      message={message}
                      resolveAttachmentUrl={getAttachmentDownloadUrl}
                      rewriteUrl={rewriteTildeUrl}
                    />
                  </ConversationMessage>
                );
              })}
              {agentBusy ? (
                <ThinkingIndicator>
                  {turnStatus || `${selectedAgent?.display_name || "Agent"} is working…`}
                </ThinkingIndicator>
              ) : null}
            </div>
          )}
        </ConversationSurface>
        {showScrollLatest ? <ScrollToLatestButton onClick={scrollToLatest} /> : null}
        {threadRoot ? null : composer}
        <ThreadOverlay
          footer={composer}
          onClose={() => {
            setThreadRootId("");
            setReplyingTo(null);
          }}
          open={Boolean(threadRoot)}
        >
          {threadRoot ? (
            <div className="thread-root-group">
              <ConversationMessage role={threadRoot.role} createdAt={threadRoot.created_at}>
                <MessageContent
                  message={threadRoot}
                  resolveAttachmentUrl={getAttachmentDownloadUrl}
                  rewriteUrl={rewriteTildeUrl}
                />
              </ConversationMessage>
            </div>
          ) : null}
        </ThreadOverlay>
      </ChatPane>

      <AgentWorkspacePanel
        agentId={agentId}
        agentName={selectedAgent?.display_name || "Agent"}
        activityCount={activity.length}
        open={layout.workspaceOpen}
        onClose={layout.toggleWorkspace}
        onResize={layout.beginWorkspaceResize}
        monitors={agents.map((agent) => ({
          id: agent.id,
          title: agent.display_name,
          previewUrl: `/api/computer/${encodeURIComponent(agent.id)}/preview`,
        }))}
        activity={
          <AgentActivity
            queue={queuedTurns.map((turn) => ({ id: turn.id, text: queuedTurnText(turn) }))}
            events={activity.map((event, index) => ({
              id: `${event.id || event.receivedAt.valueOf()}-${index}`,
              name: humanEventName(event.type),
              timestamp: event.receivedAt.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              }),
              summary: eventSummary(event.data),
            }))}
            onMoveEarlier={(id) => {
              const turn = queuedTurns.find((candidate) => candidate.id === id);
              if (turn) void mutateQueue(() => reorderQueuedTurn(id, turn.queue_position - 1));
            }}
            onMoveLater={(id) => {
              const turn = queuedTurns.find((candidate) => candidate.id === id);
              if (turn) void mutateQueue(() => reorderQueuedTurn(id, turn.queue_position + 1));
            }}
            onRunNow={(id) => void mutateQueue(() => steerQueuedTurn(id))}
            onEdit={(id) => {
              const turn = queuedTurns.find((candidate) => candidate.id === id);
              if (turn) void editQueuedTurn(turn);
            }}
            onRemove={(id) => void mutateQueue(() => deleteQueuedTurn(id))}
          />
        }
      />
      {conversationOutlineOpen ? (
        <ConversationOutlinePanel
          agentName={selectedAgent?.display_name || "Conversation"}
          onClose={() => setConversationOutlineOpen(false)}
          tabs={[
            {
              id: agentId || "conversation",
              label: selectedAgent?.display_name || "Conversation",
              status: agentBusy ? "running" : "done",
              items: conversationOutlineItems,
            },
          ]}
        />
      ) : null}
      {asyncTasksOpen ? (
        <AsyncTasksPanel
          agentName={selectedAgent?.display_name || "Agent"}
          onClose={() => setAsyncTasksOpen(false)}
          tasks={asyncTasks}
        />
      ) : null}
    </WorkspaceShell>
  );
}

function addSession(agents: ChatAgent[], agentId: string, session: ChatSession): ChatAgent[] {
  return agents.map((agent) =>
    agent.id === agentId
      ? { ...agent, sessions: { ...agent.sessions, items: [session, ...agent.sessions.items] } }
      : agent,
  );
}

function outlineItems(messages: readonly ChatMessage[]): ConversationOutlineItem[] {
  const items: ConversationOutlineItem[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      const text = messageText(message).trim();
      if (text) items.push({ id: `${message.id}:user`, kind: "user", text });
      continue;
    }
    const parts = message.parts ?? [];
    if (parts.length === 0) {
      const text = messageText(message).trim();
      if (text) items.push({ id: `${message.id}:assistant`, kind: "assistant-text", text });
      continue;
    }
    for (const [index, part] of parts.entries()) {
      const id = `${message.id}:${index}`;
      if (part.type === "reasoning") {
        const text = part.text?.trim();
        if (text) items.push({ id, kind: "thinking", text });
        continue;
      }
      if (part.type === "tool" || part.type.startsWith("tool-")) {
        const state = part.state?.toLowerCase() ?? "";
        const status = state.includes("error")
          ? "failed"
          : state.includes("output") || state.includes("complete")
            ? "completed"
            : "pending";
        items.push({
          id,
          kind: "tool-call",
          name: part.tool_name || part.toolName || part.type.replace(/^tool-/, "") || "Tool",
          status,
          summary: compactOutlineSummary(part),
        });
        continue;
      }
      if (part.type === "text" && part.text?.trim()) {
        items.push({ id, kind: "assistant-text", text: part.text.trim() });
      }
    }
  }
  return items;
}

function compactOutlineSummary(part: ChatPart): string {
  if (part.error_text || part.errorText) return part.error_text || part.errorText || "";
  const value = part.output ?? part.input;
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "Unserializable tool value";
  }
}

function activeAsyncTasks(events: readonly ActivityEvent[]): AsyncTask[] {
  const tasks = new Map<string, AsyncTask>();
  for (const event of [...events].reverse()) {
    const name = eventName(event);
    const kind = name.includes("subagent")
      ? "subagent"
      : name.includes("shell")
        ? "shell"
        : name.includes("cloud.agent") || name.includes("cloud-agent")
          ? "cloud-agent"
          : undefined;
    if (!kind) continue;
    const data = record(event.data);
    const id =
      firstString(data, "id", "task_id", "taskId", "subagent_id", "subagentId") || event.id;
    if (!id) continue;
    const status = firstString(data, "status", "state").toLowerCase();
    if (/^(done|complete|completed|failed|error|aborted|cancelled|canceled)$/.test(status)) {
      tasks.delete(id);
      continue;
    }
    tasks.set(id, {
      id,
      kind,
      label: firstString(data, "label", "title", "name", "agent_name") || humanEventName(name),
      detail: eventSummary(data),
      startedAtMs: event.receivedAt.valueOf(),
    });
  }
  return [...tasks.values()];
}

function uniqueMessages(messages: ChatMessage[]): ChatMessage[] {
  return [...new Map(messages.map((message) => [message.id, message])).values()].sort(
    (left, right) => Date.parse(left.created_at) - Date.parse(right.created_at),
  );
}

function latestMessagePreview(messages: readonly ChatMessage[]): string {
  const latest = [...messages]
    .filter((message) => message.type !== "signal")
    .sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at))
    .at(-1);
  if (!latest) return "";
  const message =
    latest.parts
      ?.filter((part) => part.type === "text")
      .map((part) => part.text || "")
      .join(" ") ||
    latest.text ||
    latest.summary ||
    "";
  const text = message
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_~`>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text) return text;
  const attachment = latest.parts?.find((part) => part.type === "file" || part.type === "image");
  return attachment?.filename ? `Sent ${attachment.filename}` : "";
}

function uniqueAgents(agents: ChatAgent[]): ChatAgent[] {
  return [...new Map(agents.map((agent) => [agent.id, agent])).values()];
}

const SCROLL_STORAGE_KEY = "openbot:chat-scroll";

function readScrollSnapshots(): Record<string, number> {
  try {
    const parsed = JSON.parse(localStorage.getItem(SCROLL_STORAGE_KEY) ?? "{}");
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function saveScrollSnapshot(
  sessionId: string,
  distanceFromBottom: number,
  snapshotsRef: { current: Record<string, number> },
): void {
  snapshotsRef.current = { ...snapshotsRef.current, [sessionId]: distanceFromBottom };
  const recent = Object.fromEntries(Object.entries(snapshotsRef.current).slice(-50));
  localStorage.setItem(SCROLL_STORAGE_KEY, JSON.stringify(recent));
}

function optimisticMessage(sessionId: string, text: string, files: PendingFile[]): ChatMessage {
  const parts = [
    ...(text ? [{ type: "text", text }] : []),
    ...files.map(({ file }) => ({
      type: "file",
      filename: file.name,
      media_type: file.type || "application/octet-stream",
      url: URL.createObjectURL(file),
    })),
  ];
  return {
    id: `optimistic-${crypto.randomUUID()}`,
    type: "ui",
    role: "user",
    session_id: sessionId,
    user_display_name: "You",
    parts,
    created_at: new Date().toISOString(),
  };
}

function titleFrom(text: string, files: PendingFile[]): string {
  const value = text || files[0]?.file.name || "New chat";
  return value.length > 80 ? `${value.slice(0, 77)}...` : value;
}

function eventStatus(event: ChatEvent): string {
  const kind = eventName(event);
  const data = record(event.data);
  if (kind.includes("turn") || kind.includes("status")) {
    const status = stringValue(data.status) || stringValue(record(data.payload).status);
    return status ? humanEventName(status) : humanEventName(event.type);
  }
  if (kind.includes("streaming")) return "Streaming response";
  if (kind.includes("queued")) return "Queued";
  if (kind.includes("message_created")) return "Message received";
  return "";
}

function eventBusyState(event: ChatEvent): boolean | undefined {
  const kind = eventName(event);
  const data = record(event.data);
  const deltaType = findField(data, "type").toLowerCase();
  if (["finish", "abort", "error"].includes(deltaType)) return false;

  const status = (
    firstString(data, "status") ||
    firstString(record(data.payload), "status") ||
    firstString(record(data.kind), "status")
  ).toLowerCase();
  if (
    /^(idle|complete|completed|finished|failed|error|aborted|cancelled|canceled|interrupted)$/.test(
      status,
    )
  ) {
    return false;
  }
  if (/^(busy|working|running|streaming|queued|pending|starting|in_progress)$/.test(status)) {
    return true;
  }
  if (kind.includes("message.streaming") || kind.includes("turn.started")) return true;
  if (kind.includes("turn.completed") || kind.includes("turn.failed")) return false;
  return undefined;
}

function eventName(event: ChatEvent): string {
  const nestedKind = record(record(event.data).kind);
  const named = firstString(nestedKind, "kind") || Object.keys(nestedKind)[0] || event.type;
  return named.toLowerCase().replaceAll("_", ".");
}

function applyLiveChatEvent(
  event: ChatEvent,
  activeSessionId: string,
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>,
): boolean {
  const kind = event.type.toLowerCase();
  const payload =
    eventKindPayload(event.data, "message_streaming") ??
    eventKindPayload(event.data, "MessageStreaming") ??
    (kind.includes("message_streaming") || kind.includes("message.streaming")
      ? record(event.data)
      : undefined);
  if (payload) {
    const sessionId = firstString(payload, "session_id", "sessionId") || activeSessionId;
    const messageId = firstString(payload, "message_id", "messageId");
    if (sessionId !== activeSessionId || !messageId) return true;
    const deltaKind = findField(payload.delta ?? payload, "type");
    if (deltaKind === "finish" || deltaKind === "abort") return false;
    if (deltaKind === "error") {
      const text =
        findField(payload.delta ?? payload, "errorText", "error_text", "error", "message") ||
        "The agent failed to respond.";
      setMessages((current) =>
        upsertMessage(current, {
          id: `agent-stream-error:${messageId}`,
          type: "text",
          role: "assistant",
          session_id: sessionId,
          user_display_name: "Agent",
          text,
          created_at: new Date().toISOString(),
        }),
      );
      return false;
    }
    const textDelta = findTextDelta(payload);
    const toolPart = findToolPart(payload);
    if (!textDelta && !toolPart) return true;
    setMessages((current) => {
      const index = current.findIndex((message) => message.id === messageId);
      if (index < 0) {
        return [
          ...current,
          {
            id: messageId,
            type: "ui",
            role: "assistant",
            session_id: sessionId,
            user_display_name: "Agent",
            parts: [
              ...(textDelta ? [{ type: "text", text: textDelta }] : []),
              ...(toolPart ? [toolPart] : []),
            ],
            created_at: new Date().toISOString(),
          },
        ];
      }
      return current.map((message, messageIndex) =>
        messageIndex === index
          ? {
              ...message,
              type: "ui",
              parts: mergeStreamingParts(message.parts ?? [], textDelta, toolPart),
              updated_at: new Date().toISOString(),
            }
          : message,
      );
    });
    return true;
  }

  const createdPayload =
    eventKindPayload(event.data, "message_created") ??
    eventKindPayload(event.data, "MessageCreated") ??
    (kind.includes("message_created") || kind.includes("message.created")
      ? record(event.data)
      : undefined);
  const created = record(createdPayload?.message ?? createdPayload);
  if (created.id && created.session_id === activeSessionId) {
    setMessages((current) => upsertMessage(current, created as unknown as ChatMessage));
  }
  return false;
}

function mergeStreamingParts(
  parts: ChatPart[],
  textDelta: string,
  toolPart: ChatPart | undefined,
): ChatPart[] {
  let next = parts;
  if (textDelta) {
    const lastTextIndex = next.findLastIndex((part) => part.type === "text");
    next =
      lastTextIndex < 0
        ? [...next, { type: "text", text: textDelta }]
        : next.map((part, index) =>
            index === lastTextIndex ? { ...part, text: `${part.text ?? ""}${textDelta}` } : part,
          );
  }
  if (toolPart) {
    const toolIndex = next.findIndex(
      (part) => part.type === "tool" && part.tool_invocation_id === toolPart.tool_invocation_id,
    );
    next =
      toolIndex < 0
        ? [...next, toolPart]
        : next.map((part, index) => (index === toolIndex ? { ...part, ...toolPart } : part));
  }
  return next;
}

function upsertMessage(current: ChatMessage[], message: ChatMessage): ChatMessage[] {
  const withoutOptimistic = current.filter(
    (candidate) =>
      !(
        candidate.id.startsWith("optimistic-") &&
        candidate.role === message.role &&
        messageText(candidate) === messageText(message)
      ),
  );
  const index = withoutOptimistic.findIndex((candidate) => candidate.id === message.id);
  if (index < 0) return uniqueMessages([...withoutOptimistic, message]);
  return withoutOptimistic.map((candidate, candidateIndex) =>
    candidateIndex === index ? message : candidate,
  );
}

function eventKindPayload(value: unknown, key: string): Record<string, unknown> | undefined {
  const event = record(value);
  const kind = record(event.kind);
  if (kind.kind === key) return kind;
  const payload = kind[key];
  return typeof payload === "object" && payload !== null
    ? (payload as Record<string, unknown>)
    : undefined;
}

function findTextDelta(value: unknown, depth = 0): string {
  if (depth > 6) return "";
  const item = record(value);
  const type = firstString(item, "type", "delta_type", "deltaType");
  if (
    (type === "text-delta" || type === "text_delta" || type === "text") &&
    typeof item.delta === "string"
  ) {
    return item.delta;
  }
  if ((type === "text-delta" || type === "text_delta") && typeof item.text === "string") {
    return item.text;
  }
  for (const key of ["delta", "ui", "Ui", "text", "Text", "value", "payload"]) {
    if (typeof item[key] === "object" && item[key] !== null) {
      const found = findTextDelta(item[key], depth + 1);
      if (found) return found;
    }
  }
  return "";
}

function findToolPart(value: unknown, depth = 0): ChatPart | undefined {
  if (depth > 6) return undefined;
  const item = record(value);
  const type = firstString(item, "type");
  if (type === "dynamic-tool" || type.startsWith("tool-")) {
    const toolName =
      firstString(item, "toolName", "tool_name") ||
      (type.startsWith("tool-") ? type.slice("tool-".length) : "tool");
    const toolInvocationId = firstString(item, "toolCallId", "tool_call_id", "id") || toolName;
    return {
      type: "tool",
      tool_name: toolName,
      tool_invocation_id: toolInvocationId,
      state: toolState(type, firstString(item, "state")),
      input: item.input,
      output: item.output,
      error_text: firstString(item, "errorText", "error_text", "error", "message") || undefined,
    };
  }
  for (const key of ["delta", "ui", "Ui", "value", "payload", "part"]) {
    if (typeof item[key] === "object" && item[key] !== null) {
      const found = findToolPart(item[key], depth + 1);
      if (found) return found;
    }
  }
  return undefined;
}

function toolState(type: string, explicit: string): string {
  if (explicit) return explicit;
  switch (type) {
    case "tool-input-start":
    case "tool-input-delta":
      return "input-streaming";
    case "tool-input-available":
      return "input-available";
    case "tool-output-available":
      return "output-available";
    case "tool-output-error":
      return "output-error";
    default:
      return "input-available";
  }
}

function findField(value: unknown, ...keys: string[]): string {
  const item = record(value);
  const direct = firstString(item, ...keys);
  if (direct) return direct;
  for (const key of ["delta", "ui", "Ui", "value", "payload"]) {
    if (typeof item[key] === "object" && item[key] !== null) {
      const found = findField(item[key], ...keys);
      if (found) return found;
    }
  }
  return "";
}

function firstString(value: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    if (typeof value[key] === "string") return value[key];
  }
  return "";
}

function eventSummary(value: unknown): string {
  if (typeof value === "string") return value.slice(0, 180);
  const data = record(value);
  for (const key of ["summary", "message", "text", "status", "tool_name", "agent_name"]) {
    const found = stringValue(data[key]);
    if (found) return found.slice(0, 180);
  }
  return "";
}

function queuedTurnText(turn: QueuedTurn): string {
  const messages = turn.chat_request.messages;
  if (!Array.isArray(messages)) return "Queued agent turn";
  const latest = messages.filter((message) => record(message).role === "user").at(-1);
  return unknownText(record(latest).content ?? record(latest).parts) || "Queued agent turn";
}

function unknownText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(unknownText).filter(Boolean).join("\n");
  if (typeof value !== "object" || value === null) return "";
  const item = record(value);
  if (typeof item.text === "string") return item.text;
  const nested = item.content ?? item.parts;
  return nested === undefined ? "" : unknownText(nested);
}

function messageText(message: ChatMessage): string {
  if (message.text) return message.text;
  return (message.parts ?? []).map((part) => part.text || "").join("");
}

function humanEventName(value: string): string {
  return value
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : "OpenBot request failed";
}

async function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const timer = window.setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
