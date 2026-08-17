import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  ApprovalCard,
  BeautifulChat,
  BeautifulSidebarNav,
  StreamingText,
  TaskRows,
  Thinking,
  ToolChips,
} from "../src/index.js";

const meta = { title: "Beautiful UI/Primitives" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Approval: Story = { render: () => <ApprovalCard /> };
export const Chat: Story = { render: () => <BeautifulChat /> };
export const SidebarNavigation: Story = { render: () => <BeautifulSidebarNav /> };
export const Streaming: Story = { render: () => <StreamingText /> };
export const TasksCapsules: Story = { render: () => <TaskRows variant="Capsules" /> };
export const TasksRows: Story = { render: () => <TaskRows variant="Rows" /> };
export const ThinkingSteps: Story = { render: () => <Thinking variant="Steps" /> };
export const ThinkingCompact: Story = { render: () => <Thinking variant="Compact" /> };
export const Tools: Story = { render: () => <ToolChips /> };
