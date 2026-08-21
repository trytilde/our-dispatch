import type { Meta, StoryObj } from "@storybook/react-vite";
import { ActivityEmpty, ActivityQueue, ActivityTimeline, AgentActivity } from "../src/index.js";

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
      <ActivityQueue items={queue} onEdit={noop} onReorder={noop} onRemove={noop} onRunNow={noop} />
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
        onReorder={noop}
        onRemove={noop}
        onRunNow={noop}
      />
    </div>
  ),
};
