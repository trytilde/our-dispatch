import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type ChatAgent,
  type ChatMessage,
  connectorAccountCreatedMessage,
  connectorAccountSelectionMessage,
  connectorAuthorizedReturnUrl,
  type ConnectorProvider,
  type CreateConnectorAccountResult,
  errorMessage,
  waitForConnectorAccountActive,
  latestMessagePreview,
  messageText,
  type QueuedTurn,
} from "@tryopenbot/client-runtime";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useStore } from "zustand";
import {
  ActivityQueue,
  AddAgentDialog,
  AgentSetupDialog,
  AgentWorkspacePanel,
  ChatComposer,
  ChatHeader,
  ChatPane,
  type ConnectorCredentialSourceView,
  type ConnectorPartActions,
  type ConnectorSelectionView,
  ConnectorSetupDialog,
  type ConnectorSetupSubmit,
  ConversationSkeleton,
  ConversationSurface,
  ConversationMessage,
  MarkdownText,
  MessageContent,
  type MessagePart,
  splitMessageSegments,
  ToolsBlock,
  ScrollToLatestButton,
  ThinkingIndicator,
  ThreadOverlay,
  WorkspaceSidebar,
  WorkspaceShell,
  useWorkspaceLayout,
} from "@tryopenbot/ui";
import type { WorkspaceSearch } from "../router.js";
import { AgentDetailsContainer } from "./agent-details.js";
import { openBotRuntime } from "../runtime.js";
import { optimisticParts, type PendingFile, uploadAttachment } from "../web-attachments.js";
import { useClientWorkspace } from "../workspaces.js";
import { shouldExpandComposer } from "./composer-layout.js";

export function OpenBotApp() {
  const auth = useStore(openBotRuntime.store, (state) => state.auth);
  const sidebar = useStore(openBotRuntime.store, (state) => state.sidebar);
  const conversation = useStore(openBotRuntime.store, (state) => state.conversation);
  const agentSetup = useStore(openBotRuntime.store, (state) => state.agentSetup);
  const { agents, nextAgentToken, selectedAgentId: agentId, loading } = sidebar;
  const {
    selectedSessionId: sessionId,
    messages,
    nextMessageToken,
    queuedTurns,
    loading: loadingMessages,
    submitting,
    agentBusy,
    turnStatus,
    error,
  } = conversation;
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [messageMenuId, setMessageMenuId] = useState("");
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [threadRootId, setThreadRootId] = useState("");
  // Modal open-state lives in the URL so redirects and deep links can target
  // it directly; see WorkspaceSearch in router.tsx.
  const workspaceSearch = useSearch({ strict: false }) as WorkspaceSearch;
  const createAgentOpen = workspaceSearch.dialog === "new-agent";
  const [connectorSetup, setConnectorSetup] = useState<ConnectorSetupState | null>(null);
  const connectorWatchRef = useRef<AbortController | null>(null);
  const pendingConnectorSelectionRef = useRef<ConnectorSelectionView | null>(null);
  const conversationRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerInputRef = useRef<HTMLTextAreaElement>(null);
  const scrollSnapshotsRef = useRef<Record<string, number>>(readScrollSnapshots());
  const restoredSessionRef = useRef("");
  const stickToBottomRef = useRef(true);
  const previousMessageIdRef = useRef("");
  const [showScrollLatest, setShowScrollLatest] = useState(false);
  const electron = navigator.userAgent.includes("Electron");
  const layout = useWorkspaceLayout({ floatingWorkspace: electron });
  const navigate = useNavigate();
  const setCreateAgentOpen = (open: boolean): void => {
    void navigate({
      to: "/",
      search: (current: WorkspaceSearch) => ({
        ...current,
        dialog: open ? ("new-agent" as const) : undefined,
      }),
      replace: !open,
    });
  };
  const setConnectorRoute = (providerTypeId: string | undefined): void => {
    void navigate({
      to: "/",
      search: (current: WorkspaceSearch) => ({ ...current, connector: providerTypeId }),
      replace: !providerTypeId,
    });
  };
  // The details pane and its drill-in routine live in the URL too, so deep
  // links can open a routine directly (`?details=routines&routine=<id|new>`).
  const detailsOpen = workspaceSearch.details === "routines";
  const routineParam = workspaceSearch.routine;
  const setDetailsRoute = (open: boolean, routine?: string): void => {
    void navigate({
      to: "/",
      search: (current: WorkspaceSearch) => ({
        ...current,
        details: open ? ("routines" as const) : undefined,
        routine: open ? routine : undefined,
      }),
      replace: !open,
    });
  };
  const clientWorkspace = useClientWorkspace();

  const selectedAgent = agents.find((agent) => agent.id === agentId);
  const hasContent = Boolean(draft.trim() || files.length);
  const composerExpanded = shouldExpandComposer(draft, files.length > 0, Boolean(replyingTo));

  useLayoutEffect(() => {
    const input = composerInputRef.current;
    if (!input) return;
    input.style.height = "0px";
    input.style.height = `${Math.min(100, Math.max(28, input.scrollHeight))}px`;
  }, [draft]);

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

  function selectAgent(agent: ChatAgent): void {
    clearFiles();
    setReplyingTo(null);
    setThreadRootId("");
    restoredSessionRef.current = "";
    void openBotRuntime.actions.selectAgent(agent.id);
  }

  async function send(event: FormEvent): Promise<void> {
    event.preventDefault();
    const authoredText = draft.trim();
    if (!hasContent || !agentId || (submitting && !agentBusy)) return;
    const text = replyingTo
      ? `> ${messageText(replyingTo).replaceAll("\n", "\n> ")}\n\n${authoredText}`.trim()
      : authoredText;
    const outgoingFiles = files;
    let activeSessionId = sessionId;
    try {
      activeSessionId = await openBotRuntime.actions.ensureSession(titleFrom(text, outgoingFiles));
      setDraft("");
      setReplyingTo(null);
      setThreadRootId("");
      clearFiles();

      const attachmentIds: string[] = [];
      for (const pending of outgoingFiles) {
        setFiles((current) => [...current, { ...pending, status: "uploading", progress: 0 }]);
        try {
          const attachment = await uploadAttachment(
            openBotRuntime.client,
            activeSessionId,
            pending.file,
            (progress) => setFileState(pending.id, { progress }),
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

      await openBotRuntime.actions.sendMessage({
        text,
        attachmentIds,
        optimisticParts: optimisticParts(text, outgoingFiles),
        title: titleFrom(text, outgoingFiles),
      });
      clearFiles();
    } catch (reason) {
      openBotRuntime.actions.setError(errorMessage(reason));
    }
  }

  async function stop(): Promise<void> {
    if (!sessionId) return;
    try {
      await openBotRuntime.actions.interrupt();
    } catch (reason) {
      openBotRuntime.actions.setError(errorMessage(reason));
    }
  }

  // Cmd/Ctrl+I and Cmd/Ctrl+L focus the prompt.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && (key === "i" || key === "l") && !event.altKey) {
        event.preventDefault();
        composerInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Mod+Alt+D toggles the details pane (Mod+Alt+B already owns the Computer pane).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || !event.altKey || event.key.toLowerCase() !== "d")
        return;
      event.preventDefault();
      setDetailsRoute(!detailsOpen);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  function addFiles(incoming: FileList | File[]): void {
    const additions = [...incoming].map((file) => ({
      id: crypto.randomUUID(),
      file,
      progress: 0,
      status: "ready" as const,
      ...(file.type.startsWith("image/") ? { previewUrl: URL.createObjectURL(file) } : {}),
    }));
    setFiles((current) => [...current, ...additions].slice(0, 10));
  }

  function clearFiles(): void {
    setFiles((current) => {
      for (const pending of current) {
        if (pending.previewUrl) URL.revokeObjectURL(pending.previewUrl);
      }
      return [];
    });
  }

  function setFileState(id: string, patch: Partial<PendingFile>): void {
    setFiles((current) => current.map((file) => (file.id === id ? { ...file, ...patch } : file)));
  }

  async function removeFile(pending: PendingFile): Promise<void> {
    if (pending.attachmentId && sessionId) {
      await openBotRuntime.client
        .deleteAttachment(sessionId, pending.attachmentId)
        .catch(() => undefined);
    }
    setFiles((current) => current.filter((file) => file.id !== pending.id));
  }

  async function loadOlderMessages(): Promise<void> {
    if (!sessionId || !nextMessageToken) return;
    await openBotRuntime.actions.loadOlderMessages();
  }

  async function loadMoreAgents(): Promise<void> {
    if (!nextAgentToken) return;
    try {
      await openBotRuntime.actions.loadMoreAgents();
    } catch (reason) {
      openBotRuntime.actions.setError(errorMessage(reason));
    }
  }

  async function mutateQueue(operation: () => Promise<void>): Promise<void> {
    if (!sessionId) return;
    try {
      await operation();
      await openBotRuntime.actions.refreshQueue(sessionId);
    } catch (reason) {
      openBotRuntime.actions.setError(errorMessage(reason));
    }
  }

  async function editQueuedTurn(turn: QueuedTurn): Promise<void> {
    const text = queuedTurnText(turn);
    await mutateQueue(() => openBotRuntime.actions.removeQueuedTurn(turn.id));
    setDraft(text === "Queued agent turn" ? "" : text);
  }

  function handleConversationScroll(): void {
    const element = conversationRef.current;
    if (!element || !sessionId) return;
    // Chromium can dispatch a layout-driven scroll while an Electron window is inactive.
    // Preserve the owner's visible jump control until an in-focus scroll or explicit jump.
    if (!document.hasFocus()) return;
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
        previewUrl: pending.previewUrl,
      }))}
      inputRef={composerInputRef}
      fileInputRef={fileInputRef}
      onSubmit={(event) => void send(event)}
      onDraftChange={setDraft}
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

  /** Start durable agent setup; the runtime owns readiness polling and selection. */
  async function submitCreateAgent(candidateName: string, avatarId: string): Promise<void> {
    const name = candidateName.trim();
    if (!name || agentSetup.status === "starting" || agentSetup.status === "setting_up") return;
    openBotRuntime.actions.setError("");
    setCreateAgentOpen(false);
    await openBotRuntime.actions.startAgentSetup(name, avatarId);
  }

  const connectorActions: ConnectorPartActions = {
    busy: Boolean(connectorSetup?.submitting),
    onSelectAccount: (selection, account) => {
      void openBotRuntime.actions.sendMessage({
        text: connectorAccountSelectionMessage(
          { provider_type_id: selection.providerTypeId, provider_name: selection.providerName },
          { id: account.id, display_name: account.displayName },
        ),
      });
    },
    onAddAccount: (selection) => {
      // Route the modal open through the URL so back/close and redirects work.
      pendingConnectorSelectionRef.current = selection;
      setConnectorRoute(selection.providerTypeId);
    },
  };

  function openConnectorSetup(selection: ConnectorSelectionView): void {
    setConnectorSetup({ selection, loading: selection.credentialSources.length === 0 });
    if (selection.credentialSources.length > 0) return;
    // Payloads opened by URL (or older tool outputs) carry no credential
    // sources; recover them from the catalog.
    void openBotRuntime.client
      .listConnectorProviders()
      .then((providers) => {
        const provider = providers.find(
          (candidate) => candidate.type_id === selection.providerTypeId,
        );
        setConnectorSetup((current) =>
          current && current.selection === selection
            ? {
                ...current,
                loading: false,
                ...(provider
                  ? {
                      selection: {
                        ...selection,
                        providerName: provider.name,
                        ...(provider.icon_url ? { iconUrl: provider.icon_url } : {}),
                        credentialSources: credentialSourceViews(provider),
                      },
                    }
                  : { error: `No connector catalog entry for ${selection.providerName}` }),
              }
            : current,
        );
      })
      .catch((reason) => {
        setConnectorSetup((current) =>
          current && current.selection === selection
            ? { ...current, loading: false, error: errorMessage(reason) }
            : current,
        );
      });
  }

  function closeConnectorSetup(): void {
    connectorWatchRef.current?.abort();
    connectorWatchRef.current = null;
    setConnectorSetup(null);
  }

  // The `?connector=<provider>` search param is the source of truth for the
  // setup modal, so OAuth returns and deep links can open it directly and the
  // back button closes it.
  useEffect(() => {
    const providerTypeId = workspaceSearch.connector;
    if (!providerTypeId) {
      if (connectorSetup) closeConnectorSetup();
      return;
    }
    if (connectorSetup?.selection.providerTypeId === providerTypeId) return;
    const pending = pendingConnectorSelectionRef.current;
    pendingConnectorSelectionRef.current = null;
    openConnectorSetup(
      pending?.providerTypeId === providerTypeId
        ? pending
        : {
            providerTypeId,
            providerName: providerTypeId,
            accounts: [],
            credentialSources: [],
          },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the URL param drives this modal
  }, [workspaceSearch.connector]);

  async function submitConnectorSetup(input: ConnectorSetupSubmit): Promise<void> {
    if (!connectorSetup) return;
    const selection = connectorSetup.selection;
    setConnectorSetup({ ...connectorSetup, submitting: true, error: undefined });
    try {
      const result = await openBotRuntime.client.createConnectorAccount({
        providerTypeId: selection.providerTypeId,
        credentialSourceTypeId: input.credentialSourceTypeId,
        displayName: input.displayName,
        ...(input.resourceServerValues ? { resourceServerValues: input.resourceServerValues } : {}),
        ...(input.userCredentialValues ? { userCredentialValues: input.userCredentialValues } : {}),
        returnUrl: connectorAuthorizedReturnUrl(
          window.location.origin,
          electron ? "electron" : "web",
        ),
      });
      if (result.status === "authorize" && result.authorization_url) {
        window.open(result.authorization_url, "_blank", "noopener");
        setConnectorSetup({
          selection,
          submitting: false,
          result,
          authorizationUrl: result.authorization_url,
        });
        // Close the loop without a manual "Done": once Tilde flips the account
        // to active after the OAuth return, hand back to the agent directly.
        const watcher = new AbortController();
        connectorWatchRef.current?.abort();
        connectorWatchRef.current = watcher;
        void waitForConnectorAccountActive(openBotRuntime.client, {
          providerTypeId: selection.providerTypeId,
          accountId: result.account.id,
          signal: watcher.signal,
        }).then((account) => {
          if (!account || watcher.signal.aborted) return;
          finishConnectorSetup(selection, { ...result, status: "created", account });
        });
        return;
      }
      finishConnectorSetup(selection, result);
    } catch (reason) {
      setConnectorSetup((current) =>
        current ? { ...current, submitting: false, error: errorMessage(reason) } : current,
      );
    }
  }

  function finishConnectorSetup(
    selection: ConnectorSelectionView,
    result: CreateConnectorAccountResult,
  ): void {
    closeConnectorSetup();
    setConnectorRoute(undefined);
    void openBotRuntime.actions.sendMessage({
      text: connectorAccountCreatedMessage(
        { provider_type_id: selection.providerTypeId, provider_name: selection.providerName },
        result,
      ),
    });
  }

  return (
    <WorkspaceShell
      sidebarCollapsed={layout.sidebarCollapsed}
      computerOpen={layout.workspaceOpen && Boolean(selectedAgent)}
      computerFloating={electron}
      style={layout.style}
    >
      <WorkspaceSidebar
        account={
          auth.session
            ? {
                name: auth.session.user.name,
                ...(auth.session.user.email ? { email: auth.session.user.email } : {}),
                ...(auth.session.user.avatar_url
                  ? { avatarUrl: auth.session.user.avatar_url }
                  : {}),
                ...(auth.session.user.organization
                  ? { organizationName: auth.session.user.organization.name }
                  : {}),
                ...(auth.session.user.workspace
                  ? { workspaceName: auth.session.user.workspace.name }
                  : {}),
              }
            : undefined
        }
        collapsed={layout.sidebarCollapsed}
        agents={filteredAgents.map((agent) => ({
          id: agent.id,
          name: agent.display_name,
          lastMessage:
            agent.id === agentId
              ? latestMessagePreview(messages) || agent.last_message_preview || ""
              : agent.last_message_preview || "",
          updatedAt: agent.last_user_message_at || agent.sessions.items[0]?.updated_at,
          unread: agent.sessions.items.some((item) => item.unread),
          busy: sidebar.busyAgentIds.includes(agent.id),
          status: agent.status,
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
          if (agent) {
            selectAgent(agent);
          }
        }}
        onLoadMore={() => void loadMoreAgents()}
        onCreateAgent={() => setCreateAgentOpen(true)}
        onOpenPlugins={() => void navigate({ to: "/settings/plugins" })}
        onOpenSettings={() => void navigate({ to: "/settings" })}
        onSwitchWorkspace={() => clientWorkspace.openWorkspaceSelector()}
        onSignOut={() => void openBotRuntime.actions.signOut()}
        onResize={layout.beginSidebarResize}
      />

      <ChatPane>
        {selectedAgent ? (
          <ChatHeader
            agentId={selectedAgent.id}
            agentName={selectedAgent.display_name}
            busy={agentBusy}
            computerOpen={layout.workspaceOpen}
            onToggleComputer={layout.toggleWorkspace}
            detailsOpen={detailsOpen}
            onToggleDetails={() => setDetailsRoute(!detailsOpen)}
          />
        ) : null}

        {loading && !selectedAgent ? (
          <ConversationSurface scrollRef={conversationRef} onScroll={handleConversationScroll}>
            <ConversationSkeleton />
          </ConversationSurface>
        ) : null}

        {selectedAgent ? (
          <ConversationSurface scrollRef={conversationRef} onScroll={handleConversationScroll}>
            {loadingMessages ? <ConversationSkeleton /> : null}
            {!loadingMessages ? (
              <div className="message-list">
                {nextMessageToken ? (
                  <button className="older-messages" onClick={() => void loadOlderMessages()}>
                    Load earlier messages
                  </button>
                ) : null}
                {(() => {
                  const rendered: ReactNode[] = [];
                  // An agent run (reasoning + tool calls) that spans adjacent
                  // messages merges into one grouped tool-chips block.
                  let pendingRun: { key: string; parts: MessagePart[] } | null = null;
                  const flushRun = () => {
                    if (!pendingRun) return;
                    rendered.push(
                      <div className="message-block" key={pendingRun.key}>
                        <ToolsBlock parts={pendingRun.parts} />
                      </div>,
                    );
                    pendingRun = null;
                  };
                  const resolveAttachmentUrl = (sessionKey: string, attachmentId: string) =>
                    openBotRuntime.client.getAttachmentDownloadUrl(sessionKey, attachmentId);
                  const rewriteUrl = (value: string) =>
                    openBotRuntime.client.rewriteTildeUrl(value);

                  visibleMessages.forEach((message, index) => {
                    const previous = visibleMessages[index - 1];
                    const next = visibleMessages[index + 1];
                    const continuedPrevious = previous?.role === message.role;
                    const continuedNext = next?.role === message.role;
                    const parts = message.parts ?? [];
                    const messageActions = {
                      menuOpen: messageMenuId === message.id,
                      onReply: () => {
                        setReplyingTo(message);
                        composerInputRef.current?.focus();
                      },
                      onToggleMenu: () => {
                        setMessageMenuId((current) => (current === message.id ? "" : message.id));
                      },
                      onStartThread: () => {
                        setThreadRootId(message.id);
                        setReplyingTo(message);
                        setMessageMenuId("");
                        composerInputRef.current?.focus();
                      },
                      onCopy: () => {
                        void navigator.clipboard.writeText(messageText(message));
                        setMessageMenuId("");
                      },
                    };

                    // Messages split into standalone blocks: text in bubbles;
                    // agent runs and attachments as their own rows.
                    const segments = parts.length > 0 ? splitMessageSegments(parts) : [];
                    if (segments.length === 0) {
                      flushRun();
                      rendered.push(
                        <ConversationMessage
                          key={message.id}
                          role={message.role}
                          createdAt={message.created_at}
                          continuedPrevious={continuedPrevious}
                          continuedNext={continuedNext}
                          {...messageActions}
                        >
                          <MessageContent
                            message={message}
                            resolveAttachmentUrl={resolveAttachmentUrl}
                            rewriteUrl={rewriteUrl}
                          />
                        </ConversationMessage>,
                      );
                      return;
                    }

                    const lastText = segments.reduce(
                      (last, segment, at) => (segment.kind === "text" ? at : last),
                      -1,
                    );
                    segments.forEach((segment, at) => {
                      const key = `${message.id}:${at}`;
                      if (segment.kind === "run") {
                        if (pendingRun && message.role !== "user") {
                          pendingRun.parts.push(...segment.parts);
                        } else {
                          flushRun();
                          pendingRun = { key, parts: [...segment.parts] };
                        }
                        return;
                      }
                      flushRun();
                      if (segment.kind === "text") {
                        rendered.push(
                          <ConversationMessage
                            key={key}
                            role={message.role}
                            createdAt={message.created_at}
                            continuedPrevious={
                              at > 0 ? segments[at - 1]?.kind === "text" : continuedPrevious
                            }
                            continuedNext={
                              at < segments.length - 1
                                ? segments[at + 1]?.kind === "text"
                                : continuedNext
                            }
                            {...(at === lastText ? messageActions : {})}
                          >
                            <MarkdownText text={segment.text} />
                          </ConversationMessage>,
                        );
                        return;
                      }
                      if (segment.kind === "files") {
                        rendered.push(
                          <ConversationMessage
                            key={key}
                            role={message.role}
                            createdAt={message.created_at}
                            mediaOnly
                          >
                            <MessageContent
                              message={{ ...message, type: "ui", parts: segment.parts }}
                              resolveAttachmentUrl={resolveAttachmentUrl}
                              rewriteUrl={rewriteUrl}
                            />
                          </ConversationMessage>,
                        );
                        return;
                      }
                      rendered.push(
                        <div className="message-block" key={key}>
                          <MessageContent
                            connectorActions={connectorActions}
                            message={{ ...message, type: "ui", parts: [segment.part] }}
                            resolveAttachmentUrl={resolveAttachmentUrl}
                            rewriteUrl={rewriteUrl}
                          />
                        </div>,
                      );
                    });
                  });
                  flushRun();
                  return rendered;
                })()}
                {agentBusy ? (
                  <ThinkingIndicator>
                    {turnStatus || `${selectedAgent?.display_name || "Agent"} is working…`}
                  </ThinkingIndicator>
                ) : null}
              </div>
            ) : null}
          </ConversationSurface>
        ) : null}
        {selectedAgent && showScrollLatest ? (
          <ScrollToLatestButton onClick={scrollToLatest} />
        ) : null}
        {selectedAgent && !threadRoot ? (
          <>
            <ActivityQueue
              items={queuedTurns.map((turn) => ({
                id: turn.id,
                text: queuedTurnText(turn),
                queuePosition: turn.queue_position,
                pending: turn.id.startsWith("optimistic-queue-"),
              }))}
              onEdit={(id) => {
                const turn = queuedTurns.find((candidate) => candidate.id === id);
                if (turn) void editQueuedTurn(turn);
              }}
              onReorder={(id, queuePosition) =>
                void mutateQueue(() => openBotRuntime.actions.reorderQueuedTurn(id, queuePosition))
              }
              onRemove={(id) => void mutateQueue(() => openBotRuntime.actions.removeQueuedTurn(id))}
              onRunNow={(id) => void mutateQueue(() => openBotRuntime.actions.steerQueuedTurn(id))}
            />
            {composer}
          </>
        ) : null}
        {selectedAgent ? (
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
                    resolveAttachmentUrl={(selectedSessionId, attachmentId) =>
                      openBotRuntime.client.getAttachmentDownloadUrl(
                        selectedSessionId,
                        attachmentId,
                      )
                    }
                    rewriteUrl={(value) => openBotRuntime.client.rewriteTildeUrl(value)}
                  />
                </ConversationMessage>
              </div>
            ) : null}
          </ThreadOverlay>
        ) : null}
      </ChatPane>

      <AgentDetailsContainer
        agentId={agentId}
        onClose={() => setDetailsRoute(false)}
        onOpenRoutine={(routineId) => setDetailsRoute(true, routineId)}
        open={detailsOpen && Boolean(selectedAgent)}
        routineParam={routineParam}
      />

      <AgentWorkspacePanel
        agentId={agentId}
        agentName={selectedAgent?.display_name || "Agent"}
        floating={electron}
        open={layout.workspaceOpen && Boolean(selectedAgent)}
        onClose={layout.toggleWorkspace}
        onResize={layout.beginWorkspaceResize}
      />
      {connectorSetup && !connectorSetup.loading ? (
        <ConnectorSetupDialog
          providerName={connectorSetup.selection.providerName}
          {...(connectorSetup.selection.iconUrl
            ? { providerIconUrl: connectorSetup.selection.iconUrl }
            : {})}
          credentialSources={connectorSetup.selection.credentialSources}
          submitting={connectorSetup.submitting ?? false}
          {...(connectorSetup.error ? { error: connectorSetup.error } : {})}
          {...(connectorSetup.authorizationUrl
            ? { authorizationUrl: connectorSetup.authorizationUrl }
            : {})}
          onSubmit={(input) => void submitConnectorSetup(input)}
          onReopenAuthorization={() => {
            if (connectorSetup.authorizationUrl)
              window.open(connectorSetup.authorizationUrl, "_blank", "noopener");
          }}
          onClose={() => {
            if (connectorSetup.result && connectorSetup.authorizationUrl) {
              finishConnectorSetup(connectorSetup.selection, connectorSetup.result);
              return;
            }
            setConnectorRoute(undefined);
          }}
        />
      ) : null}
      <AddAgentDialog
        agents={agents.map((agent) => ({
          id: agent.id,
          name: agent.display_name,
          lastMessage: agent.last_message_preview || undefined,
        }))}
        creating={agentSetup.status === "starting"}
        loading={loading}
        onClose={() => setCreateAgentOpen(false)}
        onCreate={(name, avatarId) => void submitCreateAgent(name, avatarId)}
        onSelect={(id) => {
          const agent = agents.find((candidate) => candidate.id === id);
          if (agent) selectAgent(agent);
        }}
        open={createAgentOpen}
      />
      <AgentSetupDialog
        agentId={agentSetup.agent?.id ?? ""}
        avatarId={agentSetup.avatarId}
        error={agentSetup.error}
        name={agentSetup.agent?.name ?? "New bot"}
        onClose={() => openBotRuntime.actions.dismissAgentSetup()}
        open={agentSetup.status !== "idle"}
        status={agentSetup.status === "idle" ? "starting" : agentSetup.status}
      />
    </WorkspaceShell>
  );
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

function titleFrom(text: string, files: PendingFile[]): string {
  const value = text || files[0]?.file.name || "New chat";
  return value.length > 80 ? `${value.slice(0, 77)}...` : value;
}

interface ConnectorSetupState {
  selection: ConnectorSelectionView;
  loading?: boolean;
  submitting?: boolean;
  error?: string | undefined;
  authorizationUrl?: string;
  result?: CreateConnectorAccountResult;
}

/** Map the runtime's wire-shaped provider onto the UI's credential-source view. */
function credentialSourceViews(provider: ConnectorProvider): ConnectorCredentialSourceView[] {
  return provider.credential_sources.map((source) => ({
    typeId: source.type_id,
    name: source.name,
    ...(source.documentation ? { documentation: source.documentation } : {}),
    requiresBrokering: source.requires_brokering,
    supportsAutoDisplayName: source.supports_auto_display_name ?? false,
    ...(source.display_name_description
      ? { displayNameDescription: source.display_name_description }
      : {}),
    resourceServerSchema: source.resource_server_schema,
    userCredentialSchema: source.user_credential_schema,
  }));
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

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
