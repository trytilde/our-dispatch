// The Expo owner client. All remote data, reconciliation, and shared state come from
// @tryopenbot/client-runtime; this file owns presentation only.
//
// UI is built on BNA UI (https://ui.ahmedbna.com) — a copy-in component library whose
// source lives under src/components/ui and whose tokens live in src/theme/colors.ts.
// Read colors through useColor so every surface resolves in light and dark; never
// hardcode a hex value here.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { PanResponder, Pressable, StyleSheet } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import { Inter_400Regular } from "@expo-google-fonts/inter/400Regular";
import { Inter_500Medium } from "@expo-google-fonts/inter/500Medium";
import { Inter_600SemiBold } from "@expo-google-fonts/inter/600SemiBold";
import { Inter_700Bold } from "@expo-google-fonts/inter/700Bold";
import * as SecureStore from "expo-secure-store";
import { fetch as expoFetch } from "expo/fetch";
import { useStore } from "zustand";
import {
  agentConversationSessions,
  completeOnboarding,
  errorMessage,
  loadOnboarding,
  messageText,
  queuedTurnText,
  type AttachmentCompletion,
  type ChatAgent,
  type ClientInstallation,
  type ChatMessage,
  type ChatKitSearchHit,
  type ChatSession,
  type OnboardingStorage,
  type QueuedTurn,
} from "@tryopenbot/client-runtime";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { AvoidKeyboard } from "@/components/ui/avoid-keyboard";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollView } from "@/components/ui/scroll-view";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Text } from "@/components/ui/text";
import { View } from "@/components/ui/view";
import { ModeProvider, useModeContext } from "@/providers/mode-provider";
import { useColor } from "@/hooks/useColor";
import { SPACING } from "@/theme/globals";
import { AssistantMessageList, MobileAssistantProvider } from "./chat/assistant-runtime";
import {
  optimisticNativeParts,
  pickNativeAttachments,
  type PendingNativeAttachment,
  uploadNativeAttachments,
} from "./chat/native-attachments";
import { MobilePromptBar } from "./chat/prompt-bar";
import { MobileQueuePanel } from "./chat/queue-panel";
import { ComputerScreen } from "./computer/computer-screen";
import { discoverControlService } from "./installation/discovery";
import { clearControlOrigin, loadControlOrigin, saveControlOrigin } from "./installation/storage";
import { MobileOnboarding } from "./onboarding/mobile-onboarding";
import { shouldClaimChatBackSwipe, shouldFinishChatBackSwipe } from "./navigation/chat-gesture";
import { createMobileRuntime, type MobileOpenBotRuntime } from "./runtime/openbot-runtime";

type Screen = "sidebar" | "chat" | "computer";
type BootstrapState =
  | { status: "loading" }
  | { status: "onboarding" }
  | { status: "selecting"; initialOrigin: string; error: string }
  | { status: "connected"; installation: ClientInstallation };

const RuntimeContext = createContext<MobileOpenBotRuntime | null>(null);
const mobileOnboardingStorage: OnboardingStorage = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  removeItem: (key) => SecureStore.deleteItemAsync(key),
};

export function App() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  if (!fontsLoaded) return null;
  return (
    <SafeAreaProvider>
      {/* SecureStore satisfies ModeProvider's structural storage contract directly. */}
      <ModeProvider storage={SecureStore} storageKey="openbot.appearance">
        <AppRoot />
      </ModeProvider>
    </SafeAreaProvider>
  );
}

function AppRoot() {
  const [bootstrap, setBootstrap] = useState<BootstrapState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    void (async () => {
      let origin = "";
      try {
        const onboarding = await loadOnboarding(mobileOnboardingStorage);
        if (!active) return;
        if (!onboarding.completed) {
          setBootstrap({ status: "onboarding" });
          return;
        }
        origin = (await loadControlOrigin()) ?? "";
        if (!active) return;
        setBootstrap({ status: "selecting", initialOrigin: origin, error: "" });
      } catch (error) {
        if (active)
          setBootstrap({ status: "selecting", initialOrigin: origin, error: errorMessage(error) });
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (bootstrap.status === "loading") return <LoadingScreen label="Loading OpenBot…" />;
  if (bootstrap.status === "onboarding")
    return (
      <MobileOnboarding
        onFinished={(result) => {
          void completeOnboarding(mobileOnboardingStorage, result).then(async () =>
            setBootstrap({
              status: "selecting",
              initialOrigin: (await loadControlOrigin()) ?? "",
              error: "",
            }),
          );
        }}
      />
    );
  if (bootstrap.status === "selecting")
    return (
      <WorkspaceSelectorScreen
        initialOrigin={bootstrap.initialOrigin}
        initialError={bootstrap.error}
        onConnected={(installation) => setBootstrap({ status: "connected", installation })}
      />
    );
  return (
    <ConnectedApp
      installation={bootstrap.installation}
      onChangeInstallation={() =>
        setBootstrap({
          status: "selecting",
          initialOrigin: bootstrap.installation.control_origin,
          error: "",
        })
      }
    />
  );
}

function ConnectedApp({
  installation,
  onChangeInstallation,
}: {
  installation: ClientInstallation;
  onChangeInstallation: () => void;
}) {
  const runtime = useMemo(() => createMobileRuntime(installation), [installation]);

  useEffect(() => {
    void runtime.actions.initialize();
    return () => runtime.dispose();
  }, [runtime]);

  const changeInstallation = async () => {
    await runtime.actions.signOut().catch(() => undefined);
    await clearControlOrigin();
    onChangeInstallation();
  };

  return (
    <RuntimeContext.Provider value={runtime}>
      <ConnectedSurface
        controlOrigin={installation.control_origin}
        onChangeInstallation={() => void changeInstallation()}
      />
    </RuntimeContext.Provider>
  );
}

function ConnectedSurface({
  controlOrigin,
  onChangeInstallation,
}: {
  controlOrigin: string;
  onChangeInstallation: () => void;
}) {
  const runtime = useRuntime();
  const auth = useStore(runtime.store, (state) => state.auth);
  const sidebar = useStore(runtime.store, (state) => state.sidebar);
  const conversation = useStore(runtime.store, (state) => state.conversation);
  const [screen, setScreen] = useState<Screen>("sidebar");
  const background = useColor("background");

  if (auth.status === "checking") return <LoadingScreen label="Checking access…" />;
  if (auth.status === "unauthenticated")
    return (
      <SignInScreen
        controlOrigin={controlOrigin}
        error={auth.error}
        onChangeInstallation={onChangeInstallation}
      />
    );

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: background }]}>
      <AppStatusBar />
      {screen === "sidebar" ? (
        <SidebarScreen
          agents={sidebar.agents}
          loading={sidebar.loading}
          error={sidebar.error}
          hasMore={Boolean(sidebar.nextAgentToken)}
          controlOrigin={controlOrigin}
          onChangeInstallation={onChangeInstallation}
          onOpenChat={() => setScreen("chat")}
        />
      ) : screen === "chat" ? (
        <ChatScreen
          agent={sidebar.agents.find((agent) => agent.id === sidebar.selectedAgentId)}
          messages={conversation.messages}
          queuedTurns={conversation.queuedTurns}
          sessionId={conversation.selectedSessionId}
          loading={conversation.loading}
          submitting={conversation.submitting}
          busy={conversation.agentBusy}
          status={conversation.turnStatus || conversation.streamStatus}
          error={conversation.error}
          onBack={() => setScreen("sidebar")}
          onOpenComputer={() => setScreen("computer")}
        />
      ) : (
        <ComputerScreen
          agent={sidebar.agents.find((agent) => agent.id === sidebar.selectedAgentId)}
          runtime={runtime}
          onBack={() => setScreen("chat")}
        />
      )}
    </SafeAreaView>
  );
}

function useRuntime(): MobileOpenBotRuntime {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error("OpenBot mobile runtime is unavailable");
  return runtime;
}

// The build runs edge-to-edge (`edgeToEdgeEnabled=true`), so Android's `adjustResize`
// does not shrink the window and the keyboard overlays content on both platforms.
// Every screen with an input therefore ends in this spacer.
function KeyboardSpacer() {
  return <AvoidKeyboard />;
}

// Native chrome follows the resolved appearance rather than a fixed style.
function AppStatusBar() {
  const scheme = useModeContext()?.scheme ?? "light";
  return <StatusBar style={scheme === "dark" ? "light" : "dark"} />;
}

function WorkspaceSelectorScreen({
  initialOrigin,
  initialError,
  onConnected,
}: {
  initialOrigin: string;
  initialError: string;
  onConnected: (installation: ClientInstallation) => void;
}) {
  const [origin, setOrigin] = useState(initialOrigin);
  const [error, setError] = useState(initialError);
  const [working, setWorking] = useState(false);
  const background = useColor("background");
  const muted = useColor("textMuted");

  const connect = async () => {
    if (working) return;
    setWorking(true);
    setError("");
    try {
      const installation = await discoverControlService(origin, expoFetch);
      await saveControlOrigin(installation.control_origin);
      onConnected(installation);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setWorking(false);
    }
  };

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: background }]}>
      <AppStatusBar />
      {/* Scrolls rather than clips once the keyboard shrinks the window. */}
      <ScrollView
        contentContainerStyle={styles.entryScroll}
        keyboardShouldPersistTaps="handled"
        style={styles.fill}
      >
        <Card style={styles.entryCard}>
          <BrandMark />
          <Text variant="title" style={styles.centerText}>
            Choose a workspace
          </Text>
          <Text variant="body" style={[styles.centerText, { color: muted }]}>
            Enter the address of the OpenBot workspace you want to use on this device.
          </Text>
          <Input
            accessibilityLabel="Workspace address"
            autoCapitalize="none"
            autoCorrect={false}
            error={error}
            keyboardType="url"
            placeholder="https://workspace.example"
            value={origin}
            variant="outline"
            onChangeText={setOrigin}
            onSubmitEditing={() => void connect()}
          />
          <Button
            disabled={working || !origin.trim()}
            label="Connect"
            loading={working}
            style={styles.blockButton}
            onPress={() => void connect()}
          >
            Connect
          </Button>
          <Text variant="caption" style={[styles.centerText, { color: muted }]}>
            OpenBot verifies the workspace before sign-in. Hosted workspaces must use HTTPS.
          </Text>
        </Card>
        <KeyboardSpacer />
      </ScrollView>
    </SafeAreaView>
  );
}

function SignInScreen({
  controlOrigin,
  error,
  onChangeInstallation,
}: {
  controlOrigin: string;
  error: string;
  onChangeInstallation: () => void;
}) {
  const runtime = useRuntime();
  const [working, setWorking] = useState(false);
  const background = useColor("background");
  const muted = useColor("textMuted");
  const secondary = useColor("secondary");
  const destructive = useColor("destructive");

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: background }]}>
      <AppStatusBar />
      <ScrollView contentContainerStyle={styles.entryScroll} style={styles.fill}>
        <Card style={styles.entryCard}>
          <BrandMark />
          <Text variant="title" style={styles.centerText}>
            OpenBot
          </Text>
          <Text variant="body" style={[styles.centerText, { color: muted }]}>
            Sign in with a Tilde account that belongs to this OpenBot installation.
          </Text>
          <Text
            numberOfLines={1}
            variant="caption"
            style={[styles.originChip, { backgroundColor: secondary, color: muted }]}
          >
            {controlOrigin}
          </Text>
          {error ? (
            <Text variant="caption" style={[styles.centerText, { color: destructive }]}>
              {error}
            </Text>
          ) : null}
          <Button
            disabled={working}
            label="Continue with Tilde"
            loading={working}
            style={styles.blockButton}
            onPress={() => {
              setWorking(true);
              void runtime.actions
                .signIn()
                .catch(() => undefined)
                .finally(() => setWorking(false));
            }}
          >
            Continue with Tilde
          </Button>
          <Button
            label="Change control service"
            size="sm"
            variant="ghost"
            onPress={onChangeInstallation}
          >
            Change control service
          </Button>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

function BrandMark() {
  const primary = useColor("primary");
  const primaryForeground = useColor("primaryForeground");
  return (
    <View style={[styles.brandMark, { backgroundColor: primary }]}>
      <Text variant="title" style={{ color: primaryForeground }}>
        O
      </Text>
    </View>
  );
}

function SidebarScreen({
  agents,
  loading,
  error,
  hasMore,
  controlOrigin,
  onChangeInstallation,
  onOpenChat,
}: {
  agents: ChatAgent[];
  loading: boolean;
  error: string;
  hasMore: boolean;
  controlOrigin: string;
  onChangeInstallation: () => void;
  onOpenChat: () => void;
}) {
  const runtime = useRuntime();
  const search = useStore(runtime.store, (state) => state.search);
  const [query, setQuery] = useState("");
  const muted = useColor("textMuted");
  const accent = useColor("accent");

  useEffect(() => {
    if (!query.trim()) {
      runtime.actions.clearSearch();
      return;
    }
    const handle = setTimeout(() => void runtime.actions.searchChatKit(query), 250);
    return () => clearTimeout(handle);
  }, [query, runtime.actions]);

  return (
    <View style={styles.fill}>
      <View style={styles.header}>
        <View style={styles.headerIdentity}>
          <Text variant="caption" style={[styles.eyebrow, { color: muted }]}>
            OPENBOT
          </Text>
          <Text variant="heading">Chats</Text>
        </View>
        <View style={styles.headerActions}>
          <Button label="Change service" size="sm" variant="ghost" onPress={onChangeInstallation}>
            Change service
          </Button>
          <Button
            label="Sign out"
            size="sm"
            variant="ghost"
            onPress={() => void runtime.actions.signOut()}
          >
            Sign out
          </Button>
        </View>
      </View>
      <Separator />
      <Text numberOfLines={1} variant="caption" style={[styles.serviceLine, { color: muted }]}>
        {controlOrigin}
      </Text>
      <View style={styles.searchBox}>
        <Input
          accessibilityLabel="Search conversations and messages"
          autoCapitalize="none"
          onChangeText={setQuery}
          placeholder="Search conversations and messages"
          value={query}
        />
      </View>
      <Separator />
      <InlineError message={error} />
      {query.trim() ? (
        <ScrollView contentContainerStyle={styles.sidebarList}>
          {search.status === "loading" ? <LoadingScreen compact label="Searching…" /> : null}
          {search.status === "error" ? <InlineError message={search.error} /> : null}
          {search.status === "ready" && search.items.length === 0 ? (
            <Text variant="caption" style={{ color: muted }}>
              No matching chats or messages.
            </Text>
          ) : null}
          {search.items.map((hit) => (
            <Pressable
              accessibilityRole="button"
              key={searchHitKey(hit)}
              onPress={() => {
                void runtime.actions
                  .selectSearchHit(hit)
                  .then(() => {
                    setQuery("");
                    onOpenChat();
                  })
                  .catch((reason) => runtime.actions.setError(errorMessage(reason)));
              }}
              style={({ pressed }) => pressed && { backgroundColor: accent }}
            >
              <Card style={styles.searchResult}>
                <Text numberOfLines={1} variant="subtitle">
                  {searchHitTitle(hit)}
                </Text>
                <Text numberOfLines={2} variant="caption" style={{ color: muted }}>
                  {searchHitSubtitle(hit)}
                </Text>
              </Card>
            </Pressable>
          ))}
        </ScrollView>
      ) : loading && agents.length === 0 ? (
        <LoadingScreen compact label="Loading agents…" />
      ) : (
        <ScrollView contentContainerStyle={styles.sidebarList}>
          {agents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} onOpenChat={onOpenChat} />
          ))}
          {hasMore ? (
            <Button
              label="Load more agents"
              variant="outline"
              onPress={() => void runtime.actions.loadMoreAgents()}
            >
              Load more agents
            </Button>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

function AgentCard({ agent, onOpenChat }: { agent: ChatAgent; onOpenChat: () => void }) {
  const runtime = useRuntime();
  const userId = useStore(runtime.store, (state) => state.auth.session?.user.subject ?? "");
  const muted = useColor("textMuted");
  const accent = useColor("accent");
  const { threads } = agentConversationSessions(agent, userId);
  const openSession = (session: ChatSession) => {
    void runtime.actions.selectSession(agent.id, session).then(onOpenChat);
  };

  return (
    <Card style={styles.agentCard}>
      <View style={styles.agentRow}>
        <Avatar size={44}>
          <AvatarFallback>{agent.display_name.slice(0, 1).toUpperCase()}</AvatarFallback>
        </Avatar>
        <View style={styles.agentIdentity}>
          <Text variant="subtitle">{agent.display_name}</Text>
          <Text variant="caption" style={[styles.agentStatus, { color: muted }]}>
            {agent.status || "Available"}
          </Text>
        </View>
        <Button
          label={`Open ${agent.display_name}`}
          size="sm"
          variant="secondary"
          onPress={() => {
            void runtime.actions.selectAgent(agent.id).then(onOpenChat);
          }}
        >
          Open
        </Button>
      </View>
      {threads.length ? (
        <View style={styles.sessions}>
          <Separator />
          {threads.slice(0, 5).map((session) => (
            <Pressable
              key={session.id}
              accessibilityRole="button"
              style={({ pressed }) => [styles.sessionRow, pressed && { backgroundColor: accent }]}
              onPress={() => openSession(session)}
            >
              <UnreadDot unread={Boolean(session.unread)} />
              <Text numberOfLines={1} variant="body" style={styles.sessionTitle}>
                {session.title || "Conversation"}
              </Text>
              <Text variant="caption" style={{ color: muted }}>
                {formatDate(session.updated_at)}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <View style={styles.sessions}>
          <Separator />
          <Text variant="caption" style={[styles.emptySessions, { color: muted }]}>
            No named threads yet.
          </Text>
        </View>
      )}
    </Card>
  );
}

function UnreadDot({ unread }: { unread: boolean }) {
  const tint = useColor("primary");
  return <View style={[styles.unreadDot, { backgroundColor: tint, opacity: unread ? 1 : 0 }]} />;
}

function ChatScreen({
  agent,
  messages,
  queuedTurns,
  sessionId,
  loading,
  submitting,
  busy,
  status,
  error,
  onBack,
  onOpenComputer,
}: {
  agent?: ChatAgent;
  messages: ChatMessage[];
  queuedTurns: QueuedTurn[];
  sessionId: string;
  loading: boolean;
  submitting: boolean;
  busy: boolean;
  status: string;
  error: string;
  onBack: () => void;
  onOpenComputer: () => void;
}) {
  const runtime = useRuntime();
  const [files, setFiles] = useState<PendingNativeAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [composerSeed, setComposerSeed] = useState({ revision: 0, text: "" });
  const muted = useColor("textMuted");

  const send = useCallback(
    async (authoredText: string) => {
      const text = authoredText.trim();
      if ((!text && !files.length) || submitting || uploading) return;
      setUploading(true);
      try {
        const activeSessionId = files.length
          ? await runtime.actions.ensureSession(text || files[0]?.name || "New chat")
          : sessionId;
        const attachmentIds: string[] = [];
        const attachmentCompletions: AttachmentCompletion[] = [];
        const pendingUploads = files.filter((pending) => !pending.attachmentId);
        if (pendingUploads.length > 0 && activeSessionId) {
          for (const pending of pendingUploads)
            setFileState(pending.id, { status: "uploading", progress: 0, error: "" });
          const uploaded = await uploadNativeAttachments(
            runtime.client,
            activeSessionId,
            pendingUploads,
            (index, progress) => setFileState(pendingUploads[index]!.id, { progress }),
          );
          for (const [index, result] of uploaded.entries()) {
            const pending = pendingUploads[index]!;
            attachmentIds.push(result.attachment.id);
            attachmentCompletions.push(result.completion);
            setFileState(pending.id, {
              attachmentId: result.attachment.id,
              progress: 1,
              status: "uploaded",
            });
          }
        }
        for (const pending of files)
          if (pending.attachmentId) attachmentIds.push(pending.attachmentId);
        await runtime.actions.sendMessage({
          text,
          attachmentIds,
          attachmentCompletions,
          optimisticParts: optimisticNativeParts(text, files),
          title: text || files[0]?.name,
        });
        setFiles([]);
      } catch (reason) {
        runtime.actions.setError(errorMessage(reason));
      } finally {
        setUploading(false);
      }
    },
    [files, runtime, submitting, uploading],
  );

  function setFileState(id: string, patch: Partial<PendingNativeAttachment>): void {
    setFiles((current) => current.map((file) => (file.id === id ? { ...file, ...patch } : file)));
  }

  async function attachFiles(): Promise<void> {
    try {
      const picked = await pickNativeAttachments();
      setFiles((current) => [...current, ...picked].slice(0, 10));
    } catch (reason) {
      runtime.actions.setError(errorMessage(reason));
    }
  }

  async function removeFile(file: PendingNativeAttachment): Promise<void> {
    if (file.attachmentId && sessionId)
      await runtime.client.deleteAttachment(sessionId, file.attachmentId).catch(() => undefined);
    setFiles((current) => current.filter((candidate) => candidate.id !== file.id));
  }

  const backSwipe = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          shouldClaimChatBackSwipe(gesture.dx, gesture.dy),
        onPanResponderRelease: (_, gesture) => {
          if (shouldFinishChatBackSwipe(gesture.dx, gesture.vx)) onBack();
        },
      }),
    [onBack],
  );

  return (
    <View style={styles.fill} {...backSwipe.panHandlers}>
      <View style={styles.chatHeader}>
        <Button label="Back to chat list" size="sm" variant="ghost" onPress={onBack}>
          ‹ Chats
        </Button>
        <View style={styles.chatIdentity}>
          <Text numberOfLines={1} variant="subtitle">
            {agent?.display_name || "Conversation"}
          </Text>
          <Text numberOfLines={1} variant="caption" style={{ color: muted }}>
            {status || "Ready"}
          </Text>
        </View>
        <Button label="Open Computer" size="icon" variant="ghost" onPress={onOpenComputer}>
          ⌁
        </Button>
      </View>
      <Separator />
      <InlineError message={error} />
      <MobileAssistantProvider busy={busy} messages={messages} onSend={send}>
        <AssistantMessageList loading={loading} runtime={runtime} />
        <MobileQueuePanel
          turns={queuedTurns}
          onEdit={(turn) => {
            const text = queuedTurnText(turn);
            void runtime.actions
              .removeQueuedTurn(turn.id)
              .then(() =>
                setComposerSeed((current) => ({
                  revision: current.revision + 1,
                  text: text === "Queued agent turn" ? "" : text,
                })),
              )
              .catch(() => undefined);
          }}
          onMove={(turn, position) =>
            void runtime.actions.reorderQueuedTurn(turn.id, position).catch(() => undefined)
          }
          onRemove={(turn) => void runtime.actions.removeQueuedTurn(turn.id).catch(() => undefined)}
          onRunNow={(turn) => void runtime.actions.steerQueuedTurn(turn.id).catch(() => undefined)}
        />
        <MobilePromptBar
          busy={busy}
          composerSeed={composerSeed}
          error={error}
          files={files}
          submitting={submitting || uploading}
          onAttach={() => void attachFiles()}
          onFilesOnly={() => void send("")}
          onRemoveFile={(file) => void removeFile(file)}
          onStop={() => void runtime.actions.interrupt()}
        />
      </MobileAssistantProvider>
      <KeyboardSpacer />
    </View>
  );
}

function InlineError({ message }: { message: string }) {
  const destructive = useColor("destructive");
  const destructiveForeground = useColor("destructiveForeground");
  if (!message) return null;
  return (
    <View style={[styles.inlineError, { backgroundColor: destructive }]}>
      <Text variant="caption" style={{ color: destructiveForeground }}>
        {message}
      </Text>
    </View>
  );
}

function LoadingScreen({ label, compact = false }: { label: string; compact?: boolean }) {
  const background = useColor("background");
  const muted = useColor("textMuted");
  const body = (
    <>
      <Spinner />
      <Text variant="caption" style={{ color: muted }}>
        {label}
      </Text>
    </>
  );

  if (compact) return <View style={styles.compactLoading}>{body}</View>;
  return (
    <SafeAreaView style={[styles.centered, { backgroundColor: background }]}>
      <AppStatusBar />
      {body}
    </SafeAreaView>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? ""
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function searchHitKey(hit: ChatKitSearchHit): string {
  return `${hit.kind}:${hit.session.id}:${hit.message?.id ?? hit.agent?.id ?? hit.session.id}`;
}

function searchHitTitle(hit: ChatKitSearchHit): string {
  if (hit.kind === "agent") return hit.agent?.display_name || hit.agent?.id || "Bot";
  return hit.session.title || "Untitled conversation";
}

function searchHitSubtitle(hit: ChatKitSearchHit): string {
  if (hit.kind === "message")
    return (hit.message ? messageText(hit.message).trim() : "") || "Matching message";
  return hit.kind === "session_title" ? "Conversation title" : hit.agent?.id || "Bot";
}

// Layout only. Every color comes from useColor at the point of use so both
// appearances resolve without a second stylesheet.
const styles = StyleSheet.create({
  fill: { flex: 1 },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: SPACING.sm,
    padding: SPACING.lg,
  },
  // A ScrollView content container must grow rather than take a fixed flex basis,
  // or it cannot scroll when the keyboard shrinks the window.
  entryScroll: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: SPACING.sm,
    padding: SPACING.lg,
  },
  centerText: { textAlign: "center" },
  compactLoading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: SPACING.sm,
    padding: SPACING.xl,
  },
  entryCard: { maxWidth: 420, alignItems: "center", gap: SPACING.md, padding: SPACING.lg },
  brandMark: {
    width: 52,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: SPACING.md,
  },
  blockButton: { width: "100%" },
  originChip: {
    maxWidth: "100%",
    overflow: "hidden",
    borderRadius: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  headerIdentity: { flex: 1 },
  headerActions: { alignItems: "flex-end" },
  eyebrow: { fontWeight: "700", letterSpacing: 1.6 },
  serviceLine: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs },
  searchBox: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm },
  searchResult: { gap: SPACING.xs, padding: SPACING.md },
  sidebarList: { gap: SPACING.md, padding: SPACING.md, paddingBottom: SPACING.xl },
  agentCard: { padding: 0, overflow: "hidden" },
  agentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    padding: SPACING.md,
  },
  agentIdentity: { flex: 1 },
  agentStatus: { textTransform: "capitalize" },
  sessions: { paddingBottom: SPACING.xs },
  sessionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  sessionTitle: { flex: 1 },
  unreadDot: { width: 7, height: 7, borderRadius: 4 },
  emptySessions: { padding: SPACING.md },
  inlineError: {
    marginHorizontal: SPACING.md,
    marginTop: SPACING.sm,
    borderRadius: SPACING.sm,
    padding: SPACING.sm,
  },
  chatHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
  },
  chatIdentity: { flex: 1, alignItems: "center" },
});
