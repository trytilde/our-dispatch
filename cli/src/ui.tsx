import React, { useEffect, useRef, useState, type ReactNode } from "react";
import { Box, Text, render, useApp, useInput } from "ink";

export interface RepositoryCounts {
  digest: string;
  agents: number;
  skills: number;
  providers: number;
}

export interface ProviderStatus {
  id: string;
  kind: string;
  healthy: boolean;
  configured: boolean;
  displayName: string;
  message?: string;
}

export interface SyncReportView {
  digest: string;
  skipped?: string;
  registryId?: string;
  skills: readonly { name: string; status: string }[];
  agents: readonly { id: string; status: string }[];
  errors: readonly string[];
}

const commands = [
  ["init", "Initialize OpenBot interactively"],
  ["init --non-interactive --json", "Initialize from JSON answers on stdin"],
  ["new-agent NAME --json", "Scaffold an agent non-interactively"],
  ["secrets set NAME --description TEXT --stdin", "Set a described secret from stdin"],
  ["secrets unset NAME", "Remove an encrypted configuration secret"],
  ["env set NAME VALUE --description TEXT", "Set a described environment value"],
  ["env unset NAME", "Remove a configuration environment value"],
  ["dev", "Start the local OpenBot development environment"],
  ["check", "Run repository validation"],
  ["build", "Build the deployable application shell"],
  ["test", "Run repository tests"],
  ["deploy --yes", "Deploy the current fork to production"],
  ["deploy --skip-deploy", "Check and build deployable artifacts without deploying"],
  ["deploy --service agents --yes", "Build and deploy agent functions without control"],
] as const;

const menuItems = [
  { command: "init", description: "Initialize configuration" },
  { command: "dev", description: "Start local development" },
  { command: "new-agent", description: "Scaffold an agent" },
  { command: "check", description: "Validate the repository" },
  { command: "build", description: "Build the application" },
  { command: "help", description: "Show every command" },
] as const;

export function Brand({ subtitle }: { subtitle?: string }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color="cyan">
        OPENBOT
      </Text>
      <Text dimColor>{subtitle ?? "Fork it. Configure it. Run it."}</Text>
    </Box>
  );
}

export function Help() {
  return (
    <Box flexDirection="column">
      <Brand />
      <Text bold>Usage</Text>
      <Text>
        {" "}
        openbot <Text color="cyan">&lt;command&gt;</Text> <Text dimColor>[options]</Text>
      </Text>
      <Box flexDirection="column" marginTop={1}>
        <Text bold>Commands</Text>
        {commands.map(([command, description]) => (
          <Box key={command}>
            <Box width={24}>
              <Text color="cyan">{command}</Text>
            </Box>
            <Text>{description}</Text>
          </Box>
        ))}
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>Run without a command for the interactive launcher.</Text>
        <Text dimColor>Use deploy --dry-run --json to inspect production deployment.</Text>
      </Box>
    </Box>
  );
}

export function CommandMenu({ onSelect }: { onSelect: (command: string) => void }) {
  const [selected, setSelected] = useState(0);
  const selectedRef = useRef(0);
  const { exit } = useApp();
  useInput((input, key) => {
    if (key.upArrow || input === "k") {
      selectedRef.current = (selectedRef.current - 1 + menuItems.length) % menuItems.length;
      setSelected(selectedRef.current);
    }
    if (key.downArrow || input === "j") {
      selectedRef.current = (selectedRef.current + 1) % menuItems.length;
      setSelected(selectedRef.current);
    }
    if (key.return) {
      onSelect(menuItems[selectedRef.current]!.command);
      exit();
    }
    if (key.escape || input === "q") exit();
  });
  return (
    <Box flexDirection="column">
      <Brand subtitle="What would you like to do?" />
      {menuItems.map((item, index) => (
        <Box key={item.command}>
          <Box width={3}>
            <Text color={selected === index ? "cyan" : undefined}>
              {selected === index ? "❯" : " "}
            </Text>
          </Box>
          <Box width={13}>
            <Text bold={selected === index} color={selected === index ? "cyan" : undefined}>
              {item.command}
            </Text>
          </Box>
          <Text dimColor={selected !== index}>{item.description}</Text>
        </Box>
      ))}
      <Box marginTop={1}>
        <Text dimColor>↑/↓ move enter select q quit</Text>
      </Box>
    </Box>
  );
}

export function Progress({ label }: { label: string }) {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setFrame((value) => (value + 1) % frames.length), 80);
    return () => clearInterval(timer);
  }, [frames.length]);
  return (
    <Box>
      <Text color="cyan">{frames[frame]}</Text>
      <Text> {label}</Text>
    </Box>
  );
}

export interface StreamingProgressController {
  setLabel(label: string): void;
  write(output: string): void;
  succeed(label?: string): void;
  fail(label?: string): void;
}

/** Imperative bridge from provider lifecycle events into one stable Ink region. */
export function createStreamingProgress(
  initialLabel: string,
  { enabled = process.stdout.isTTY, maxLines = 8 }: { enabled?: boolean; maxLines?: number } = {},
): StreamingProgressController {
  let label = initialLabel;
  let lines: string[] = [];
  let status: "running" | "succeeded" | "failed" = "running";
  const view = () => <StreamingProgress label={label} lines={lines} status={status} />;
  const app = enabled ? render(view()) : null;
  if (!enabled) process.stdout.write(`${label}\n`);

  const refresh = () => app?.rerender(view());
  const finish = (nextStatus: "succeeded" | "failed", nextLabel?: string) => {
    status = nextStatus;
    if (nextLabel) label = nextLabel;
    if (app) {
      refresh();
      app.unmount();
    } else process.stdout.write(`${nextStatus === "succeeded" ? "✓" : "✗"} ${label}\n`);
  };

  return {
    setLabel(nextLabel) {
      label = nextLabel;
      refresh();
    },
    write(output) {
      const next = terminalLines(output);
      if (!next.length) return;
      if (!enabled) {
        process.stdout.write(`${next.join("\n")}\n`);
        return;
      }
      lines = [...lines, ...next].slice(-maxLines);
      refresh();
    },
    succeed(nextLabel) {
      finish("succeeded", nextLabel);
    },
    fail(nextLabel) {
      finish("failed", nextLabel);
    },
  };
}

function StreamingProgress({
  label,
  lines,
  status,
}: {
  label: string;
  lines: readonly string[];
  status: "running" | "succeeded" | "failed";
}) {
  return (
    <Box flexDirection="column">
      {status === "running" ? (
        <Progress label={label} />
      ) : (
        <Text>
          <Text color={status === "succeeded" ? "green" : "red"}>
            {status === "succeeded" ? "✓" : "✗"}
          </Text>{" "}
          <Text bold>{label}</Text>
        </Text>
      )}
      {lines.map((line, index) => (
        <Text key={`${index}:${line}`} dimColor wrap="truncate-end">
          {line}
        </Text>
      ))}
    </Box>
  );
}

function terminalLines(output: string): string[] {
  return stripTerminalControlSequences(output)
    .replaceAll("\r", "\n")
    .split("\n")
    .map((line) =>
      line
        .split("")
        .filter((character) => {
          const code = character.charCodeAt(0);
          return code === 9 || (code >= 32 && code !== 127);
        })
        .join("")
        .trimEnd(),
    )
    .filter(Boolean);
}

function stripTerminalControlSequences(output: string): string {
  let result = "";
  let escape = false;
  let controlSequence = false;
  for (const character of output) {
    const code = character.charCodeAt(0);
    if (code === 27) {
      escape = true;
      controlSequence = false;
      continue;
    }
    if (escape) {
      escape = false;
      controlSequence = character === "[";
      continue;
    }
    if (controlSequence) {
      if (code >= 64 && code <= 126) controlSequence = false;
      continue;
    }
    result += character;
  }
  return result;
}

export function Success({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <Box flexDirection="column">
      <Text>
        <Text color="green">✓</Text> <Text bold>{title}</Text>
      </Text>
      {children ? (
        <Box marginLeft={2} flexDirection="column">
          {children}
        </Box>
      ) : null}
    </Box>
  );
}

export function Failure({
  message,
  stack,
  logPath,
}: {
  message: string;
  stack?: string;
  logPath?: string;
}) {
  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor="red" paddingX={1}>
        <Text color="red">Error: </Text>
        <Text>{message}</Text>
      </Box>
      {stack ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Stack trace</Text>
          <Text>{stack}</Text>
        </Box>
      ) : null}
      {logPath ? <Text dimColor>Full details: {logPath}</Text> : null}
    </Box>
  );
}

export function RepositorySummary({
  repository,
  title = "Configuration is valid",
}: {
  repository: RepositoryCounts;
  title?: string;
}) {
  return (
    <Success title={title}>
      <Text>
        <Text dimColor>Digest</Text> {repository.digest.slice(0, 12)}
      </Text>
      <Text>
        <Text color="cyan">{repository.agents}</Text> agent(s) ·{" "}
        <Text color="cyan">{repository.skills}</Text> skill(s) ·{" "}
        <Text color="cyan">{repository.providers}</Text> custom provider plugin(s)
      </Text>
    </Success>
  );
}

export function ProviderTable({
  providers,
  heading = "Providers",
}: {
  providers: readonly ProviderStatus[];
  heading?: string;
}) {
  return (
    <Box flexDirection="column">
      <Text bold>{heading}</Text>
      {providers.map((provider) => (
        <Box
          key={`${provider.kind}:${provider.id}`}
          flexDirection="column"
          marginBottom={provider.message ? 1 : 0}
        >
          <Box>
            <Box width={3}>
              <Text color={provider.healthy ? "green" : "yellow"}>
                {provider.healthy ? "✓" : "!"}
              </Text>
            </Box>
            <Box width={18}>
              <Text>{provider.kind}</Text>
            </Box>
            <Box width={26}>
              <Text bold>{provider.displayName}</Text>
            </Box>
            <Text color={provider.healthy ? "green" : "yellow"}>
              {provider.healthy ? "ready" : provider.configured ? "unhealthy" : "needs setup"}
            </Text>
          </Box>
          {provider.message ? (
            <Box marginLeft={3}>
              <Text dimColor>{provider.message}</Text>
            </Box>
          ) : null}
        </Box>
      ))}
    </Box>
  );
}

export function DoctorResult({
  repository,
  providers,
}: {
  repository: RepositoryCounts;
  providers: readonly ProviderStatus[];
}) {
  return (
    <Box flexDirection="column">
      <RepositorySummary repository={repository} />
      <Box marginTop={1}>
        <ProviderTable providers={providers} />
      </Box>
    </Box>
  );
}

export function StatusResult({
  agents,
  skills,
}: {
  agents: readonly { sourceId: string; status: string }[];
  skills: readonly { name: string; status: string }[];
}) {
  return (
    <Box flexDirection="column">
      <Brand subtitle="Repository registrations" />
      <Text>
        <Text color="cyan">{agents.length}</Text> agents · <Text color="cyan">{skills.length}</Text>{" "}
        skills
      </Text>
      {agents.map((agent) => (
        <Text key={agent.sourceId}>
          <Text color={agent.status === "ready" ? "green" : "yellow"}>●</Text> agent{" "}
          {agent.sourceId} <Text dimColor>({agent.status})</Text>
        </Text>
      ))}
      {skills.map((skill) => (
        <Text key={skill.name}>
          <Text color={skill.status === "ready" ? "green" : "yellow"}>●</Text> skill {skill.name}{" "}
          <Text dimColor>({skill.status})</Text>
        </Text>
      ))}
    </Box>
  );
}

export function SyncResult({ report }: { report: SyncReportView }) {
  const successful = report.errors.length === 0;
  return (
    <Box flexDirection="column">
      <Success
        title={
          report.skipped
            ? "Sync skipped"
            : successful
              ? "Repository synchronized"
              : "Sync completed with errors"
        }
      >
        <Text>
          <Text dimColor>Digest</Text> {report.digest.slice(0, 12)}
        </Text>
        {report.skipped ? (
          <Text color="yellow">{report.skipped}</Text>
        ) : (
          <Text>
            {report.agents.length} agent(s) · {report.skills.length} skill(s)
          </Text>
        )}
        {report.agents.map((agent) => (
          <Text key={agent.id}>
            <Text color={agent.status === "ready" ? "green" : "yellow"}>●</Text> {agent.id}{" "}
            <Text dimColor>{agent.status}</Text>
          </Text>
        ))}
        {report.errors.map((error) => (
          <Text key={error} color="red">
            {error}
          </Text>
        ))}
      </Success>
    </Box>
  );
}
