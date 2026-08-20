// The Expo owner client. All remote data, reconciliation, and shared state come from
// @tryopenbot/client-runtime; this file owns presentation only.
//
// UI is built on BNA UI (https://ui.ahmedbna.com) — a copy-in component library whose
// source lives under src/components/ui and whose tokens live in src/theme/colors.ts.
// Read colors through useColor so every surface resolves in light and dark; never
// hardcode a hex value here.
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as SecureStore from "expo-secure-store";
import { fetch as expoFetch } from "expo/fetch";
import { useStore } from "zustand";
import {
  connectorAccountSelectionMessage,
  connectorSelectionFromPart,
  errorMessage,
  messageText,
  type ChatAgent,
  type ClientInstallation,
  type ChatMessage,
  type ChatPart,
  type ChatSession,
  type ConnectorSelection,
  type OpenBotRuntime,
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
import { BORDER_RADIUS, SPACING } from "@/theme/globals";
import { ConnectorSetupSheet } from "./connector-setup";
import { discoverControlService } from "./installation/discovery";
import { clearControlOrigin, loadControlOrigin, saveControlOrigin } from "./installation/storage";
import { createMobileRuntime } from "./runtime/openbot-runtime";

type Screen = "sidebar" | "chat";
type BootstrapState =
  | { status: "loading" }
  | { status: "selecting"; initialOrigin: string; error: string }
  | { status: "connected"; installation: ClientInstallation };

const RuntimeContext = createContext<OpenBotRuntime | null>(null);

export function App() {
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
        origin = (await loadControlOrigin()) ?? "";
        if (!active) return;
        if (!origin) {
          setBootstrap({ status: "selecting", initialOrigin: "", error: "" });
          return;
        }
        const installation = await discoverControlService(origin, expoFetch);
        if (active) setBootstrap({ status: "connected", installation });
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
  if (bootstrap.status === "selecting")
    return (
      <ControlServiceScreen
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
      ) : (
        <ChatScreen
          agent={sidebar.agents.find((agent) => agent.id === sidebar.selectedAgentId)}
          messages={conversation.messages}
          loading={conversation.loading}
          submitting={conversation.submitting}
          busy={conversation.agentBusy}
          status={conversation.turnStatus || conversation.streamStatus}
          error={conversation.error}
          onBack={() => setScreen("sidebar")}
        />
      )}
    </SafeAreaView>
  );
}

function useRuntime(): OpenBotRuntime {
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

function ControlServiceScreen({
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
            Connect OpenBot
          </Text>
          <Text variant="body" style={[styles.centerText, { color: muted }]}>
            Enter the address of the OpenBot control service you want to use.
          </Text>
          <Input
            accessibilityLabel="Control service URL"
            autoCapitalize="none"
            autoCorrect={false}
            error={error}
            keyboardType="url"
            placeholder="https://openbot.example"
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
            OpenBot verifies the service before opening sign-in. Use HTTPS for hosted services.
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
  const muted = useColor("textMuted");

  return (
    <View style={styles.fill}>
      <View style={styles.header}>
        <View style={styles.headerIdentity}>
          <Text variant="caption" style={[styles.eyebrow, { color: muted }]}>
            OPENBOT
          </Text>
          <Text variant="heading">Agents</Text>
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
      <Separator />
      <InlineError message={error} />
      {loading && agents.length === 0 ? (
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
  const muted = useColor("textMuted");
  const accent = useColor("accent");
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
          label="New chat"
          size="sm"
          variant="secondary"
          onPress={() => {
            runtime.actions.startNewConversation(agent.id);
            onOpenChat();
          }}
        >
          New chat
        </Button>
      </View>
      {agent.sessions.items.length ? (
        <View style={styles.sessions}>
          <Separator />
          {agent.sessions.items.slice(0, 5).map((session) => (
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
            No conversations yet.
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
  loading,
  submitting,
  busy,
  status,
  error,
  onBack,
}: {
  agent?: ChatAgent;
  messages: ChatMessage[];
  loading: boolean;
  submitting: boolean;
  busy: boolean;
  status: string;
  error: string;
  onBack: () => void;
}) {
  const runtime = useRuntime();
  const [draft, setDraft] = useState("");
  const muted = useColor("textMuted");
  const card = useColor("card");
  const destructive = useColor("destructive");

  const send = () => {
    const text = draft.trim();
    if (!text || submitting) return;
    setDraft("");
    void runtime.actions.sendMessage({ text }).catch(() => setDraft(text));
  };

  return (
    <View style={styles.fill}>
      <View style={styles.chatHeader}>
        <Button label="Back to agents" size="sm" variant="ghost" onPress={onBack}>
          ‹ Agents
        </Button>
        <View style={styles.chatIdentity}>
          <Text numberOfLines={1} variant="subtitle">
            {agent?.display_name || "Conversation"}
          </Text>
          <Text numberOfLines={1} variant="caption" style={{ color: muted }}>
            {status || "Ready"}
          </Text>
        </View>
        {busy ? (
          <Button
            label="Stop"
            size="sm"
            variant="ghost"
            textStyle={{ color: destructive }}
            onPress={() => void runtime.actions.interrupt()}
          >
            Stop
          </Button>
        ) : (
          <View style={styles.headerSpacer} />
        )}
      </View>
      <Separator />
      <InlineError message={error} />
      {loading ? (
        <LoadingScreen compact label="Loading conversation…" />
      ) : (
        <FlatList
          contentContainerStyle={styles.messages}
          data={messages}
          keyExtractor={(message) => message.id}
          ListEmptyComponent={
            <View style={styles.emptyConversation}>
              <Text variant="title">Start a conversation</Text>
              <Text variant="body" style={[styles.centerText, { color: muted }]}>
                Ask your agent to research, build, or inspect something.
              </Text>
            </View>
          }
          renderItem={({ item }) => <MessageBubble message={item} />}
        />
      )}
      <Separator />
      <View style={[styles.composer, { backgroundColor: card }]}>
        <View style={styles.composerInput}>
          <Input
            accessibilityLabel="Message"
            placeholder="Message your agent"
            rows={2}
            type="textarea"
            value={draft}
            onChangeText={setDraft}
          />
        </View>
        <Button
          disabled={!draft.trim() || submitting}
          label="Send message"
          loading={submitting}
          size="icon"
          onPress={send}
        >
          ↑
        </Button>
      </View>
      <KeyboardSpacer />
    </View>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const connectorSelections = (message.parts ?? [])
    .map((part) => connectorSelectionFromPart(part))
    .filter((selection): selection is ConnectorSelection => selection !== undefined);
  const text =
    messageText(message).trim() || message.parts?.map(partLabel).filter(Boolean).join("\n") || "";
  const owner = message.role === "user";
  const card = useColor("card");
  const primary = useColor("primary");
  const primaryForeground = useColor("primaryForeground");

  return (
    <View style={[styles.messageRow, owner && styles.ownerMessageRow]}>
      <View
        style={[
          styles.messageBubble,
          { backgroundColor: owner ? primary : card },
          owner ? styles.ownerBubble : styles.agentBubble,
        ]}
      >
        {text ? (
          <Text variant="body" style={owner ? { color: primaryForeground } : undefined}>
            {text}
          </Text>
        ) : null}
        {connectorSelections.map((selection) => (
          <ConnectorSelectionPicker key={selection.provider_type_id} selection={selection} />
        ))}
      </View>
    </View>
  );
}

/**
 * Native rendering of the agent's connector account picker. Selecting an
 * account round-trips exactly like the web grid; adding a new account opens
 * the native credential setup sheet (API keys, custom schemas, and brokered
 * OAuth through the system browser).
 */
function ConnectorSelectionPicker({ selection }: { selection: ConnectorSelection }) {
  const runtime = useRuntime();
  const [setupOpen, setSetupOpen] = useState(false);
  const muted = useColor("textMuted");
  const border = useColor("border");
  const background = useColor("background");
  const prompt =
    selection.prompt ??
    `Select which account to enable for this bot for ${selection.provider_name}`;

  const choose = (accountId: string, displayName: string) => {
    void runtime.actions.sendMessage({
      text: connectorAccountSelectionMessage(selection, {
        id: accountId,
        display_name: displayName,
      }),
    });
  };
  const addAccount = () => setSetupOpen(true);

  if (setupOpen) {
    return (
      <ConnectorSetupSheet
        client={runtime.client}
        selection={selection}
        onClose={() => setSetupOpen(false)}
        onComplete={(text) => {
          setSetupOpen(false);
          void runtime.actions.sendMessage({ text });
        }}
      />
    );
  }

  return (
    <View style={styles.connectorPicker}>
      <Text variant="caption" style={{ color: muted }}>
        {prompt}
      </Text>
      <View style={styles.connectorGrid}>
        {selection.accounts.map((account) => (
          <Pressable
            accessibilityRole="button"
            key={account.id}
            onPress={() => choose(account.id, account.display_name)}
            style={({ pressed }) => [
              styles.connectorCard,
              { borderColor: border, backgroundColor: background },
              pressed && styles.connectorCardPressed,
            ]}
          >
            <View style={[styles.connectorGlyph, { borderColor: border }]}>
              <Text variant="caption">{selection.provider_name.slice(0, 2).toUpperCase()}</Text>
            </View>
            <View style={styles.connectorCopy}>
              <Text numberOfLines={1} variant="caption">
                {selection.provider_name}
              </Text>
              <Text numberOfLines={1} variant="caption" style={{ color: muted }}>
                {account.display_name}
              </Text>
            </View>
          </Pressable>
        ))}
        <Pressable
          accessibilityRole="button"
          onPress={addAccount}
          style={({ pressed }) => [
            styles.connectorCard,
            { borderColor: border, backgroundColor: background },
            pressed && styles.connectorCardPressed,
          ]}
        >
          <View style={[styles.connectorGlyph, { borderColor: border }]}>
            <Text variant="caption">+</Text>
          </View>
          <View style={styles.connectorCopy}>
            <Text numberOfLines={2} variant="caption">
              Add new {selection.provider_name} account
            </Text>
          </View>
        </Pressable>
      </View>
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

function partLabel(part: ChatPart): string {
  if (part.type === "reasoning") return part.text || "Thinking…";
  if (part.type === "tool" || part.type.startsWith("tool-"))
    return `Used ${part.tool_name || part.toolName || "a tool"}`;
  if (part.type === "file" || part.type === "image") return part.filename || "Attachment";
  return part.text || "";
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? ""
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Layout only. Every color comes from useColor at the point of use so both
// appearances resolve without a second stylesheet.
const styles = StyleSheet.create({
  fill: { flex: 1 },
  connectorPicker: { gap: SPACING.sm, marginTop: SPACING.sm },
  connectorGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: SPACING.sm,
  },
  connectorCard: {
    flexBasis: "47%",
    flexGrow: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    padding: SPACING.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
  },
  connectorCardPressed: { opacity: 0.7 },
  connectorGlyph: {
    width: 30,
    height: 30,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  connectorCopy: { flex: 1, minWidth: 0 },
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
  headerSpacer: { width: 82 },
  messages: { flexGrow: 1, gap: SPACING.sm, padding: SPACING.md },
  emptyConversation: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: SPACING.sm,
    padding: SPACING.xl,
  },
  messageRow: { flexDirection: "row", justifyContent: "flex-start" },
  ownerMessageRow: { justifyContent: "flex-end" },
  messageBubble: {
    maxWidth: "86%",
    borderRadius: BORDER_RADIUS,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  agentBubble: { borderBottomLeftRadius: SPACING.xs },
  ownerBubble: { borderBottomRightRadius: SPACING.xs },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: SPACING.sm,
    padding: SPACING.sm,
  },
  composerInput: { flex: 1 },
});
