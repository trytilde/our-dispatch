import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  ApprovalCard,
  BeautifulChatComposer,
  BeautifulCodeBlock,
  BeautifulSidebarNav,
  ContextCards,
  DiffTable,
  FilterTable,
  FineTuneCard,
  Flowchart,
  LoadingState,
  PromptBar,
  RecommendationCard,
  RecordsTable,
  SearchList,
  StreamingText,
  TaskRows,
  ThinkingState,
  ToolChips,
} from "../src/index.js";

const meta = { title: "Beautiful UI/Primitives" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Approval: Story = { render: () => <ApprovalCard /> };
export const ChatComposerDemo: Story = { render: () => <BeautifulChatComposer /> };
export const Code: Story = { render: () => <BeautifulCodeBlock /> };
export const Context: Story = { render: () => <ContextCards /> };
export const Diff: Story = { render: () => <DiffTable /> };
export const Filter: Story = { render: () => <FilterTable /> };
export const FineTune: Story = { render: () => <FineTuneCard /> };
export const FlowchartDemo: Story = { render: () => <Flowchart /> };
export const Loading: Story = { render: () => <LoadingState /> };
export const Prompt: Story = { render: () => <PromptBar /> };
export const Recommendation: Story = { render: () => <RecommendationCard /> };
export const Records: Story = { render: () => <RecordsTable /> };
export const Search: Story = { render: () => <SearchList /> };
export const SidebarNavigation: Story = { render: () => <BeautifulSidebarNav /> };
export const Streaming: Story = { render: () => <StreamingText /> };
export const TasksCapsules: Story = { render: () => <TaskRows variant="Capsules" /> };
export const TasksRows: Story = { render: () => <TaskRows variant="Rows" /> };
export const ThinkingSteps: Story = { render: () => <ThinkingState variant="Steps" /> };
export const ThinkingCompact: Story = { render: () => <ThinkingState variant="Compact" /> };
export const Tools: Story = { render: () => <ToolChips /> };
