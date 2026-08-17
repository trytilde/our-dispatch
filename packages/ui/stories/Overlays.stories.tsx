import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  DialogSurface,
  LocalToolPermissionCard,
  LocalToolPermissionDock,
  PermissionRequestCard,
  ThreadOverlay,
} from "../src/index.js";

const meta = { title: "OpenBot/Overlays" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
const noop = () => undefined;

export const Dialog: Story = {
  render: () => (
    <DialogSurface
      actions={
        <>
          <button>Cancel</button>
          <button className="primary">Continue</button>
        </>
      }
      description="Review the details before continuing."
      onClose={noop}
      open
      title="Confirm action"
    >
      <p>This surface can contain any focused workflow.</p>
    </DialogSurface>
  ),
};

export const PermissionPending: Story = {
  render: () => (
    <div style={{ width: 620 }}>
      <PermissionRequestCard
        actions={[
          { label: "Deny", onClick: noop },
          { label: "Allow", onClick: noop, primary: true },
        ]}
        description="The agent needs this capability to finish the task."
        disclosure={{ kind: "command", text: "pnpm check" }}
        leading="⌁"
        location="/workspace/hello-world"
        onDismiss={noop}
        summary="Run the package validation command"
        title="Allow command?"
      />
    </div>
  ),
};

export const PermissionSettled: Story = {
  render: () => (
    <div style={{ width: 620 }}>
      <PermissionRequestCard
        settledNote="The command can run once for this task."
        status={{ kind: "success", label: "Allowed once" }}
        summary="Run the package validation command"
        title="Command permission"
      />
    </div>
  ),
};

export const LocalToolPermission: Story = {
  render: () => (
    <div style={{ width: 680 }}>
      <LocalToolPermissionDock>
        <LocalToolPermissionCard canAlwaysAllow onResolve={noop} status="pending" />
      </LocalToolPermissionDock>
    </div>
  ),
};

export const LocalToolPermissionOutcome: Story = {
  render: () => <LocalToolPermissionCard onResolve={noop} status="allow-once" />,
};

export const AgentExchange: Story = {
  render: () => (
    <ThreadOverlay
      footer={<input aria-label="Reply" placeholder="Reply to the agent" />}
      label="Research exchange"
      onClose={noop}
      open
    >
      <div className="message-list">
        <p>
          <strong>Research agent</strong>
        </p>
        <p>I found three useful sources and summarized them.</p>
      </div>
    </ThreadOverlay>
  ),
  parameters: { layout: "fullscreen" },
};

export const AgentExchangeLoadError: Story = {
  render: () => (
    <ThreadOverlay loadFailed onClose={noop} onRetry={noop} open>
      {null}
    </ThreadOverlay>
  ),
  parameters: { layout: "fullscreen" },
};
