import { useEffect, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { OnboardingResult } from "@tryopenbot/client-runtime";
import { AvoidKeyboard } from "@/components/ui/avoid-keyboard";
import { NativeAgentAvatar, type NativeAvatarShape } from "@/components/native-agent-avatar";
import { ScrollView } from "@/components/ui/scroll-view";
import { Spinner } from "@/components/ui/spinner";
import { Text } from "@/components/ui/text";
import { View } from "@/components/ui/view";
import { useColor } from "@/hooks/useColor";
import { MOBILE_AVATAR_PALETTE, MOBILE_ONBOARDING_CAST } from "@/theme/avatar";
import { FONT_FAMILY, FONT_FAMILY_MEDIUM, SPACING } from "@/theme/globals";

type IntroStep = "meet" | "computer" | "jobs" | "tools" | "create" | "handoff";

const STEPS: readonly IntroStep[] = ["meet", "computer", "jobs", "tools", "create"];
const TITLES: Record<Exclude<IntroStep, "handoff">, string> = {
  meet: "Meet OpenBot",
  computer: "Every bot gets its own computer",
  jobs: "One bot, one job",
  tools: "Which tools should your bots reach?",
  create: "Set up your bot",
};
const TOOL_NAMES = [
  "Airtable",
  "Figma",
  "GitHub",
  "Google Drive",
  "Linear",
  "Notion",
  "Postgres",
  "Sentry",
  "Slack",
  "Stripe",
  "Vercel",
  "Zoom",
] as const;
const SHAPES: readonly NativeAvatarShape[] = ["blob", "pebble", "squircle", "hex", "cloud"];
const DEMO_PROMPT = "Send a bot after the thing you keep deferring";

export function MobileOnboarding({
  onFinished,
}: {
  onFinished: (result: OnboardingResult) => void;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [tools, setTools] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(MOBILE_AVATAR_PALETTE[6]);
  const [shape, setShape] = useState<NativeAvatarShape>("blob");
  const [handingOff, setHandingOff] = useState(false);
  const background = useColor("background");
  const muted = useColor("textMuted");
  const border = useColor("border");
  const primary = useColor("primary");
  const step = handingOff ? "handoff" : (STEPS[stepIndex] ?? "meet");

  const next = () => setStepIndex((current) => Math.min(current + 1, STEPS.length - 1));
  const back = () => setStepIndex((current) => Math.max(0, current - 1));
  const finish = () => {
    if (!name.trim()) return;
    setHandingOff(true);
    const result: OnboardingResult = { name: name.trim(), color, shape, tools };
    setTimeout(() => onFinished(result), 1200);
  };

  return (
    <SafeAreaView style={[styles.page, { backgroundColor: background }]}>
      <View style={styles.progress} accessibilityLabel={`Page ${stepIndex + 1} of ${STEPS.length}`}>
        {STEPS.map((entry, index) => (
          <View
            key={entry}
            style={[
              styles.progressDot,
              { backgroundColor: index === stepIndex ? primary : border },
            ]}
          />
        ))}
      </View>
      <ScrollView
        contentContainerStyle={styles.viewport}
        keyboardShouldPersistTaps="handled"
        style={styles.fill}
      >
        {step === "handoff" ? (
          <View style={styles.handoff}>
            <NativeAgentAvatar id="openbot-handoff" size={72} state="working" />
            <Text variant="title" style={styles.title}>
              OpenBot
            </Text>
            <View style={styles.handoffStatus}>
              <Spinner />
              <Text variant="body" style={{ color: muted }}>
                Warming up your workspace…
              </Text>
            </View>
          </View>
        ) : (
          <StepFrame
            nextDisabled={step === "create" && !name.trim()}
            nextLabel={step === "create" ? "Create bot" : "Next"}
            showBack={stepIndex > 0}
            title={TITLES[step]}
            onBack={back}
            onNext={step === "create" ? finish : next}
          >
            {step === "meet" ? <MeetScene onSend={next} /> : null}
            {step === "computer" ? <ComputerScene /> : null}
            {step === "jobs" ? <JobsScene /> : null}
            {step === "tools" ? (
              <ToolsScene
                selected={tools}
                onToggle={(tool) =>
                  setTools((current) =>
                    current.includes(tool)
                      ? current.filter((candidate) => candidate !== tool)
                      : [...current, tool],
                  )
                }
              />
            ) : null}
            {step === "create" ? (
              <CreateScene
                color={color}
                name={name}
                shape={shape}
                onColor={setColor}
                onName={setName}
                onShape={setShape}
              />
            ) : null}
          </StepFrame>
        )}
        <AvoidKeyboard />
      </ScrollView>
    </SafeAreaView>
  );
}

function StepFrame({
  title,
  children,
  showBack,
  nextLabel,
  nextDisabled,
  onBack,
  onNext,
}: {
  title: string;
  children: ReactNode;
  showBack: boolean;
  nextLabel: string;
  nextDisabled: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <View style={styles.step}>
      <Text variant="title" style={styles.title}>
        {title}
      </Text>
      <View style={styles.scene}>{children}</View>
      <View style={styles.actions}>
        {showBack ? <PillAction label="Back" tone="secondary" onPress={onBack} /> : null}
        <PillAction disabled={nextDisabled} label={nextLabel} onPress={onNext} />
      </View>
    </View>
  );
}

function PillAction({
  label,
  disabled = false,
  tone = "primary",
  onPress,
}: {
  label: string;
  disabled?: boolean;
  tone?: "primary" | "secondary";
  onPress: () => void;
}) {
  const primary = useColor("primary");
  const foreground = useColor("primaryForeground");
  const secondary = useColor("secondary");
  const secondaryForeground = useColor("secondaryForeground");
  const fill = tone === "primary" ? primary : secondary;
  const text = tone === "primary" ? foreground : secondaryForeground;
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      disabled={disabled}
      style={({ pressed }) => [
        styles.pill,
        { backgroundColor: fill, opacity: disabled ? 0.35 : pressed ? 0.72 : 1 },
      ]}
      onPress={onPress}
    >
      <Text variant="body" style={[styles.pillText, { color: text }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function MeetScene({ onSend }: { onSend: () => void }) {
  const [typed, setTyped] = useState(0);
  const surface = useColor("card");
  const muted = useColor("textMuted");
  const primary = useColor("primary");
  const foreground = useColor("primaryForeground");

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(() => {
      timer = setInterval(() => {
        setTyped((current) => {
          if (current >= DEMO_PROMPT.length) {
            clearInterval(timer);
            return current;
          }
          return current + 1;
        });
      }, 35);
    }, 650);
    return () => {
      clearTimeout(start);
      if (timer) clearInterval(timer);
    };
  }, []);

  return (
    <View style={styles.meetScene}>
      <NativeAgentAvatar
        color={MOBILE_AVATAR_PALETTE[7]}
        id="openbot-hero"
        shape="blob"
        size={94}
        state="listening"
      />
      <View style={[styles.demoComposer, { backgroundColor: surface }]}>
        <Text variant="body" style={[styles.demoPrompt, { color: typed ? undefined : muted }]}>
          {typed ? DEMO_PROMPT.slice(0, typed) : "Ready when you are"}
        </Text>
        <View style={styles.demoToolbar}>
          <View style={[styles.demoIcon, { backgroundColor: surface }]}>
            <Text variant="body" style={{ color: muted }}>
              +
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Send demo prompt"
            style={[styles.demoIcon, { backgroundColor: primary }]}
            onPress={onSend}
          >
            <Text variant="body" style={{ color: foreground }}>
              ↑
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function ComputerScene() {
  const surface = useColor("card");
  const canvas = useColor("muted");
  const border = useColor("border");
  const foreground = useColor("foreground");
  const red = useColor("red");
  const yellow = useColor("yellow");
  const green = useColor("green");
  return (
    <View style={styles.computerScene}>
      <NativeAgentAvatar id="computer-guide" size={62} state="working" />
      <View style={[styles.computerWindow, { backgroundColor: surface, borderColor: border }]}>
        <View style={[styles.computerBar, { borderBottomColor: border }]}>
          {[red, yellow, green].map((color) => (
            <View key={color} style={[styles.windowDot, { backgroundColor: color }]} />
          ))}
          <View style={styles.windowTitle}>
            <Text variant="caption">Computer</Text>
          </View>
        </View>
        <View style={[styles.computerGrid, { backgroundColor: canvas }]}>
          {Array.from({ length: 6 }, (_, index) => (
            <View
              key={index}
              style={[styles.computerCell, { backgroundColor: index === 1 ? foreground : surface }]}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

function JobsScene() {
  const surface = useColor("card");
  return (
    <View style={styles.jobsScene}>
      {MOBILE_ONBOARDING_CAST.map((member, index) => (
        <View
          key={member.id}
          style={[
            styles.castMember,
            index === 0 ? styles.castTop : index === 1 ? styles.castLeft : styles.castRight,
          ]}
        >
          <NativeAgentAvatar
            color={member.color}
            id={member.id}
            shape={member.shape}
            size={82}
            state="happy"
          />
          <View style={[styles.jobLabel, { backgroundColor: surface }]}>
            <Text variant="caption" style={styles.jobLabelText}>
              {member.label}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function ToolsScene({
  selected,
  onToggle,
}: {
  selected: string[];
  onToggle: (tool: string) => void;
}) {
  const surface = useColor("card");
  const field = useColor("muted");
  const border = useColor("border");
  const accent = useColor("blue");
  const text = useColor("text");
  return (
    <View style={styles.toolsGrid}>
      {TOOL_NAMES.map((tool) => {
        const active = selected.includes(tool);
        return (
          <Pressable
            key={tool}
            accessibilityLabel={`${active ? "Remove" : "Add"} ${tool}`}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.toolRow,
              {
                backgroundColor: active ? `${accent}18` : surface,
                borderColor: active ? accent : border,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
            onPress={() => onToggle(tool)}
          >
            <View style={[styles.toolInitial, { backgroundColor: field }]}>
              <Text variant="caption">{tool.charAt(0)}</Text>
            </View>
            <Text numberOfLines={1} variant="caption" style={[styles.toolName, { color: text }]}>
              {tool}
            </Text>
            {active ? (
              <Text variant="caption" style={{ color: accent }}>
                ✓
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function CreateScene({
  name,
  color,
  shape,
  onName,
  onColor,
  onShape,
}: {
  name: string;
  color: string;
  shape: NativeAvatarShape;
  onName: (value: string) => void;
  onColor: (value: string) => void;
  onShape: (value: NativeAvatarShape) => void;
}) {
  const border = useColor("border");
  const text = useColor("text");
  const muted = useColor("textMuted");
  const surface = useColor("card");
  return (
    <View style={styles.createScene}>
      <NativeAgentAvatar color={color} id="new-bot" shape={shape} size={82} />
      <View accessibilityLabel="Bot colour" accessibilityRole="radiogroup" style={styles.swatches}>
        {MOBILE_AVATAR_PALETTE.map((entry, index) => (
          <Pressable
            key={entry}
            accessibilityLabel={`Colour ${index + 1}`}
            accessibilityRole="radio"
            accessibilityState={{ checked: color === entry }}
            style={[
              styles.swatch,
              { backgroundColor: entry, borderColor: color === entry ? text : entry },
            ]}
            onPress={() => onColor(entry)}
          />
        ))}
      </View>
      <View accessibilityLabel="Bot shape" accessibilityRole="radiogroup" style={styles.shapes}>
        {SHAPES.map((entry) => (
          <Pressable
            key={entry}
            accessibilityLabel={`${entry} shape`}
            accessibilityRole="radio"
            accessibilityState={{ checked: shape === entry }}
            style={[
              styles.shapeChoice,
              { borderColor: border },
              shape === entry ? { backgroundColor: surface } : null,
            ]}
            onPress={() => onShape(entry)}
          >
            <NativeAgentAvatar color={color} id={`shape-${entry}`} shape={entry} size={28} />
          </Pressable>
        ))}
      </View>
      <View style={styles.nameField}>
        <Text variant="caption" style={{ color: muted }}>
          Name
        </Text>
        <TextInput
          accessibilityLabel="Bot name"
          autoCapitalize="words"
          autoCorrect={false}
          placeholder="Name your bot"
          placeholderTextColor={muted}
          style={[styles.nameInput, { borderColor: border, color: text, backgroundColor: surface }]}
          value={name}
          onChangeText={onName}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  page: { flex: 1 },
  progress: {
    height: 34,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  progressDot: { width: 18, height: 3, borderRadius: 2 },
  viewport: { flexGrow: 1, justifyContent: "center", padding: SPACING.lg },
  step: { width: "100%", alignItems: "center", gap: SPACING.lg },
  title: {
    maxWidth: 480,
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: -0.4,
    textAlign: "center",
    fontFamily: FONT_FAMILY_MEDIUM,
  },
  scene: { width: "100%", minHeight: 390, alignItems: "center", justifyContent: "center" },
  actions: { flexDirection: "row", alignItems: "center", gap: 12 },
  pill: {
    minHeight: 46,
    minWidth: 92,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 22,
  },
  pillText: { fontFamily: FONT_FAMILY_MEDIUM, fontSize: 15 },
  handoff: {
    alignItems: "center",
    justifyContent: "center",
    gap: SPACING.md,
    paddingVertical: 120,
  },
  handoffStatus: { flexDirection: "row", alignItems: "center", gap: SPACING.sm },
  meetScene: { alignItems: "center", gap: SPACING.xl },
  demoComposer: { width: "100%", maxWidth: 350, minHeight: 112, borderRadius: 18, padding: 12 },
  demoPrompt: { minHeight: 50, fontSize: 14, lineHeight: 20 },
  demoToolbar: { flexDirection: "row", justifyContent: "space-between" },
  demoIcon: {
    width: 31,
    height: 31,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  computerScene: { width: "100%", maxWidth: 390, alignItems: "center" },
  computerWindow: {
    width: "100%",
    marginTop: -8,
    borderWidth: 1,
    borderRadius: 18,
    overflow: "hidden",
  },
  computerBar: {
    height: 40,
    borderBottomWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 12,
  },
  windowDot: { width: 10, height: 10, borderRadius: 5 },
  windowTitle: { flex: 1, alignItems: "center", paddingRight: 44 },
  computerGrid: { height: 210, flexDirection: "row", flexWrap: "wrap", gap: 8, padding: 16 },
  computerCell: { width: "31%", height: 82, borderRadius: 8 },
  jobsScene: { width: "100%", height: 380, position: "relative" },
  castMember: { position: "absolute", alignItems: "center" },
  castTop: { top: 10, alignSelf: "center", left: "38%" },
  castLeft: { left: "5%", top: 185 },
  castRight: { right: "3%", top: 160 },
  jobLabel: { marginTop: 7, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  jobLabelText: { fontFamily: FONT_FAMILY_MEDIUM, fontSize: 12 },
  toolsGrid: { width: "100%", flexDirection: "row", flexWrap: "wrap", gap: 8 },
  toolRow: {
    width: "48.5%",
    height: 46,
    borderWidth: 1,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 10,
  },
  toolInitial: {
    width: 25,
    height: 25,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  toolName: { flex: 1, fontFamily: FONT_FAMILY_MEDIUM, fontSize: 13 },
  createScene: { width: "100%", maxWidth: 420, alignItems: "center", gap: SPACING.md },
  swatches: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 9 },
  swatch: { width: 24, height: 24, borderRadius: 12, borderWidth: 3 },
  shapes: { flexDirection: "row", gap: 7 },
  shapeChoice: {
    width: 48,
    height: 48,
    borderWidth: 1,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  nameField: { width: "100%", gap: 7 },
  nameInput: {
    height: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontFamily: FONT_FAMILY,
    fontSize: 15,
  },
});
