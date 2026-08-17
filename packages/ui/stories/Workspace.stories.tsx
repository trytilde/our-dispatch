import type { Meta, StoryObj } from "@storybook/react-vite";
import { createRef, useRef, useState } from "react";
import {
  AgentAvatar,
  AgentListItem,
  AgentSearchDialog,
  ChatComposer,
  ChatHeader,
  ChatPane,
  ComputerIcon,
  ConversationMessage,
  ConversationSurface,
  EmptyConversation,
  ListIcon,
  MoreIcon,
  PlusIcon,
  ReplyIcon,
  ScrollToLatestButton,
  SearchIcon,
  SendIcon,
  ThinkingIndicator,
  useWorkspaceLayout,
  WorkspaceAccount,
  WorkspaceShell,
  WorkspaceSidebar,
  ClockIcon,
} from "../src/index.js";

const meta = {
  title: "OpenBot/Workspace",
  parameters: { layout: "centered" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;
const noop = () => undefined;
const agents = [
  { id: "hello-world", name: "Hello World", lastMessage: "Ready when you are.", unread: true },
  { id: "research", name: "Research", lastMessage: "I found three useful sources." },
  { id: "writer", name: "Writer", lastMessage: "The draft is ready to review." },
] as const;

export const AgentAvatars: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 12 }}>
      {agents.map((agent) => (
        <AgentAvatar id={agent.id} key={agent.id} />
      ))}
    </div>
  ),
};

export const AgentListItemState: Story = {
  render: () => (
    <div style={{ width: 280 }}>
      <AgentListItem agent={agents[0]} onSelect={noop} selected />
      <AgentListItem agent={agents[1]} onSelect={noop} selected={false} />
    </div>
  ),
};

export const AgentSearch: Story = {
  render: () => (
    <AgentSearchDialog
      agents={agents}
      loading={false}
      onChange={noop}
      onClose={noop}
      onSelect={noop}
      open
      value=""
    />
  ),
  parameters: { layout: "fullscreen" },
};

export const Account: Story = {
  render: () => (
    <div
      className="rich-chat"
      style={{ background: "#f7f7f7", display: "flex", flexDirection: "column", width: 280 }}
    >
      <WorkspaceAccount />
    </div>
  ),
};

export const AccountMenu: Story = {
  render: () => (
    <div
      className="rich-chat"
      style={{
        background: "#f7f7f7",
        display: "flex",
        flexDirection: "column",
        height: 340,
        position: "relative",
        width: 280,
      }}
    >
      <WorkspaceAccount />
    </div>
  ),
};

export const Sidebar: Story = {
  render: () => (
    <div style={{ height: 640, position: "relative", width: 280 }}>
      <WorkspaceSidebar
        agents={agents}
        onResize={noop}
        onSearchChange={noop}
        onSearchClose={noop}
        onSearchOpen={noop}
        onSelectAgent={noop}
        searchOpen={false}
        searchValue=""
        selectedAgentId="hello-world"
      />
    </div>
  ),
};

export const Header: Story = {
  render: () => (
    <div style={{ width: 720 }}>
      <ChatHeader
        agentId="hello-world"
        agentName="Hello World"
        asyncTasksOpen={false}
        computerOpen
        conversationOutlineOpen={false}
        onToggleAsyncTasks={noop}
        onToggleComputer={noop}
        onToggleConversationOutline={noop}
        status="Online"
      />
    </div>
  ),
};

export const EmptyChat: Story = {
  render: () => (
    <div style={{ height: 480, width: 720 }}>
      <EmptyConversation
        onSelectSuggestion={noop}
        suggestions={["Plan my day", "Research a topic", "Work with a file"]}
      />
    </div>
  ),
};

export const Message: Story = {
  render: () => (
    <div style={{ width: 620 }}>
      <ConversationMessage
        createdAt="2026-08-15T12:00:00Z"
        onCopy={noop}
        onReply={noop}
        onStartThread={noop}
        onToggleMenu={noop}
        role="agent"
      >
        <p>I found the answer and organized the result.</p>
      </ConversationMessage>
    </div>
  ),
};

export const Thinking: Story = {
  render: () => <ThinkingIndicator>Working through the request</ThinkingIndicator>,
};

function ComposerExample() {
  const [draft, setDraft] = useState("Draft a concise launch plan");
  return (
    <div style={{ width: 680 }}>
      <ChatComposer
        agentAvailable
        attachments={[]}
        busy={false}
        draft={draft}
        dragging={false}
        expanded
        error=""
        fileInputRef={createRef<HTMLInputElement>()}
        inputRef={createRef<HTMLTextAreaElement>()}
        onCancelReply={noop}
        onDraftChange={setDraft}
        onDragStateChange={noop}
        onFilesAdded={noop}
        onRemoveAttachment={noop}
        onStop={noop}
        onSubmit={(event) => event.preventDefault()}
        submitting={false}
      />
    </div>
  );
}

export const Composer: Story = { render: () => <ComposerExample /> };

function SurfaceExample() {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div style={{ height: 300, width: 620 }}>
      <ConversationSurface onScroll={noop} scrollRef={ref}>
        <div className="message-list">
          <ConversationMessage createdAt="2026-08-15T12:00:00Z" role="agent">
            A reusable conversation surface.
          </ConversationMessage>
        </div>
      </ConversationSurface>
    </div>
  );
}

export const Conversation: Story = { render: () => <SurfaceExample /> };
export const ScrollToLatest: Story = { render: () => <ScrollToLatestButton onClick={noop} /> };
export const ChatPaneSurface: Story = {
  render: () => (
    <div style={{ height: 300, width: 620 }}>
      <ChatPane>
        <ChatHeader
          agentId="hello-world"
          agentName="Hello World"
          computerOpen={false}
          onToggleComputer={noop}
          status="Online"
        />
      </ChatPane>
    </div>
  ),
};

function LayoutExample() {
  const layout = useWorkspaceLayout();
  return (
    <WorkspaceShell
      computerOpen={layout.workspaceOpen}
      sidebarCollapsed={layout.sidebarCollapsed}
      style={{ ...layout.style, height: 520, width: "min(1100px, 95vw)" }}
    >
      <WorkspaceSidebar
        agents={agents}
        onResize={layout.beginSidebarResize}
        onSearchChange={noop}
        onSearchClose={noop}
        onSearchOpen={noop}
        onSelectAgent={noop}
        searchOpen={false}
        searchValue=""
        selectedAgentId="hello-world"
      />
      <ChatPane>
        <ChatHeader
          agentId="hello-world"
          agentName="Hello World"
          computerOpen={layout.workspaceOpen}
          onToggleComputer={layout.toggleWorkspace}
          status="Online"
        />
        <EmptyConversation onSelectSuggestion={noop} suggestions={["Start a task"]} />
      </ChatPane>
    </WorkspaceShell>
  );
}

export const WorkspaceAndLayoutHook: Story = {
  render: () => <LayoutExample />,
  parameters: { layout: "fullscreen" },
};

const iconEntries = [
  ["SearchIcon", SearchIcon],
  ["PlusIcon", PlusIcon],
  ["SendIcon", SendIcon],
  ["ReplyIcon", ReplyIcon],
  ["MoreIcon", MoreIcon],
  ["ComputerIcon", ComputerIcon],
  ["ListIcon", ListIcon],
  ["ClockIcon", ClockIcon],
] as const;

export const Icons: Story = {
  render: () => (
    <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(4, 100px)" }}>
      {iconEntries.map(([name, Icon]) => (
        <div
          key={name}
          style={{ alignItems: "center", display: "flex", flexDirection: "column", gap: 6 }}
        >
          <Icon />
          <small>{name}</small>
        </div>
      ))}
    </div>
  ),
};
