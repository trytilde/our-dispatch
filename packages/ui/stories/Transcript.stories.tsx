import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import {
  ChatFindBar,
  FailedSendActions,
  NewMessagesPill,
  QueuedSendNotice,
  SentWhileOfflineNotice,
  SystemEvent,
  SystemEventChip,
  SystemEventLabel,
  TranscriptError,
  TranscriptLoading,
  TranscriptNotice,
  TranscriptTimeSeparator,
  UnknownMessageCard,
  UnreadDivider,
} from "../src/index.js";

const meta = { title: "OpenBot/Transcript" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
const noop = () => undefined;

function FindExample() {
  const [query, setQuery] = useState("agent");
  return (
    <ChatFindBar
      currentOrdinal={query ? 2 : 0}
      matchCount={query ? 5 : 0}
      onClose={noop}
      onQueryChange={setQuery}
      onStepNext={noop}
      onStepPrevious={noop}
      query={query}
    />
  );
}

export const FindInChat: Story = { render: () => <FindExample /> };
export const Loading: Story = {
  render: () => (
    <div style={{ width: 520 }}>
      <TranscriptLoading />
    </div>
  ),
};
export const LoadError: Story = {
  render: () => (
    <div style={{ width: 520 }}>
      <TranscriptError onRetry={noop} />
    </div>
  ),
};

export const NewMessages: Story = {
  render: () => (
    <div style={{ height: 320, position: "relative", width: 620 }}>
      <NewMessagesPill count={3} direction="down" onDismiss={noop} onJump={noop} />
    </div>
  ),
};

export const Unread: Story = {
  render: () => (
    <div style={{ width: 620 }}>
      <UnreadDivider />
    </div>
  ),
};
export const QueuedSend: Story = {
  render: () => <QueuedSendNotice cancellable onCancel={noop} transportDown />,
};
export const SentOffline: Story = {
  render: () => <SentWhileOfflineNotice composedAt="2026-08-15T12:00:00Z" />,
};
export const FailedSend: Story = {
  render: () => <FailedSendActions onDelete={noop} onResend={noop} />,
};
export const Notice: Story = {
  render: () => (
    <TranscriptNotice actionLabel="Reconnect" onAction={noop} tone="warning">
      Connection interrupted. New messages will be queued.
    </TranscriptNotice>
  ),
};
export const TimeSeparator: Story = {
  render: () => (
    <div style={{ width: 620 }}>
      <TranscriptTimeSeparator dateTime="2026-08-15" label="Today" />
    </div>
  ),
};

export const SystemEventRow: Story = {
  render: () => (
    <div style={{ width: 620 }}>
      <SystemEvent>
        <SystemEventLabel>Computer connected</SystemEventLabel>
        <SystemEventChip leading="⌁" onClick={noop}>
          View activity
        </SystemEventChip>
      </SystemEvent>
    </div>
  ),
};

export const UnknownMessage: Story = {
  render: () => <UnknownMessageCard messageType="future-message" />,
};
