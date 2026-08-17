import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  ActivityEmpty,
  ActivityQueue,
  ActivityTimeline,
  AgentActivity,
  AsyncTasksPanel,
  ConversationOutlinePanel,
} from "../src/index.js";

const meta = { title: "OpenBot/Activity" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
const noop = () => undefined;
const queue = [
  { id: "one", text: "Summarize the latest findings" },
  { id: "two", text: "Draft the final response" },
];
const events = [
  { id: "one", name: "Browser opened", summary: "Research workspace", timestamp: "12:42" },
  { id: "two", name: "File saved", summary: "report.md", timestamp: "12:44" },
];

export const Empty: Story = {
  render: () => (
    <div style={{ height: 360, width: 440 }}>
      <ActivityEmpty />
    </div>
  ),
};
export const Queue: Story = {
  render: () => (
    <div style={{ width: 520 }}>
      <ActivityQueue
        items={queue}
        onEdit={noop}
        onMoveEarlier={noop}
        onMoveLater={noop}
        onRemove={noop}
        onRunNow={noop}
      />
    </div>
  ),
};
export const Timeline: Story = {
  render: () => (
    <div style={{ width: 520 }}>
      <ActivityTimeline items={events} />
    </div>
  ),
};
export const CombinedActivity: Story = {
  render: () => (
    <div style={{ width: 520 }}>
      <AgentActivity
        events={events}
        queue={queue}
        onEdit={noop}
        onMoveEarlier={noop}
        onMoveLater={noop}
        onRemove={noop}
        onRunNow={noop}
      />
    </div>
  ),
};

export const AsyncTasks: Story = {
  render: () => (
    <div style={{ height: 520, position: "relative", width: 720 }}>
      <AsyncTasksPanel
        agentName="Hello World"
        nowMs={Date.parse("2026-08-15T12:05:00Z")}
        onClose={noop}
        tasks={[
          {
            detail: "Checking sources",
            id: "research",
            kind: "subagent",
            label: "Researching launch options",
            startedAtMs: Date.parse("2026-08-15T12:00:00Z"),
          },
          {
            detail: "pnpm check",
            id: "shell",
            kind: "shell",
            label: "Running validation",
            startedAtMs: Date.parse("2026-08-15T12:03:00Z"),
          },
        ]}
      />
    </div>
  ),
};

export const ConversationOutline: Story = {
  render: () => (
    <div style={{ height: 560, position: "relative", width: 760 }}>
      <ConversationOutlinePanel
        agentName="Hello World"
        onClose={noop}
        tabs={[
          {
            id: "main",
            label: "Main",
            status: "running",
            items: [
              { id: "user", kind: "user", text: "Research and summarize this topic" },
              { id: "thinking", kind: "thinking", text: "Reviewing sources" },
              {
                id: "tool",
                kind: "tool-call",
                name: "Browser",
                status: "completed",
                summary: "Opened three sources",
              },
              { id: "answer", kind: "assistant-text", text: "The result is ready." },
            ],
          },
          {
            id: "research",
            label: "Research",
            status: "done",
            items: [
              { id: "send", kind: "send-message", message: "Found the supporting evidence." },
            ],
          },
        ]}
      />
    </div>
  ),
};
