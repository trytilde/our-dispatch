import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  AgentWorkspacePanel,
  ComputerFailureDialog,
  ComputerLifecycleDialog,
  ComputerMonitorStrip,
  ComputerRebuildBanner,
  ComputerRebuildDialog,
  ComputerReconnectBanner,
  ComputerRecoveryConfirmDialog,
  ComputerStagePlaceholder,
  ComputerTakingLongerDialog,
  ComputerUnreachableDialog,
} from "../src/index.js";

const meta = { title: "OpenBot/Computer" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
const noop = () => undefined;
const preview =
  "data:text/html,%3Cbody style='margin:0;background:%23e7ebe5;display:grid;place-items:center;font-family:sans-serif;color:%23333'%3EComputer%20preview%3C/body%3E";

export const StageConnecting: Story = {
  render: () => (
    <div style={{ height: 320, position: "relative", width: 560 }}>
      <ComputerStagePlaceholder busy message="Booting up the computer" />
    </div>
  ),
};
export const StageProgress: Story = {
  render: () => (
    <div style={{ height: 320, position: "relative", width: 560 }}>
      <ComputerStagePlaceholder busy message="Preparing workspace" progressPercent={64} />
    </div>
  ),
};
export const StageFailed: Story = {
  render: () => (
    <div style={{ height: 320, position: "relative", width: 560 }}>
      <ComputerStagePlaceholder message="Can't reach the screen" onRetry={noop} />
    </div>
  ),
};

export const Reconnecting: Story = {
  render: () => (
    <div style={{ height: 180, position: "relative", width: 560 }}>
      <ComputerReconnectBanner variant="checking" />
    </div>
  ),
};
export const NetworkInterrupted: Story = {
  render: () => (
    <div style={{ height: 180, position: "relative", width: 560 }}>
      <ComputerReconnectBanner variant="network" />
    </div>
  ),
};

export const MonitorStrip: Story = {
  render: () => (
    <div style={{ height: 220, position: "relative", width: 720 }}>
      <ComputerMonitorStrip
        activeMonitorId="primary"
        monitors={[
          { id: "primary", previewUrl: preview, title: "Hello World" },
          { id: "research", previewUrl: preview, title: "Research", needsAttention: true },
          { id: "writer", previewUrl: preview, title: "Writer" },
        ]}
        onSelect={noop}
      />
    </div>
  ),
};

export const LifecycleDialog: Story = {
  render: () => (
    <ComputerLifecycleDialog
      actions={<button className="primary">Continue</button>}
      description="A general Computer lifecycle prompt."
      open
      title="Computer status"
    />
  ),
};
export const UnreachableDialog: Story = {
  render: () => <ComputerUnreachableDialog canRecover onRecover={noop} onRetry={noop} open />,
};
export const RecoveryConfirmation: Story = {
  render: () => <ComputerRecoveryConfirmDialog canRecover onCancel={noop} onConfirm={noop} open />,
};
export const FailureDialog: Story = {
  render: () => (
    <ComputerFailureDialog canRetry kind="update" onDismiss={noop} onRetry={noop} open />
  ),
};

export const RebuildDialog: Story = {
  render: () => (
    <ComputerRebuildDialog
      kind="update"
      migrationPhases={["backing-up", "creating"]}
      migrationStatus="moving"
      onContinueInBackground={noop}
      open
      operationId="storybook"
      pullPercent={62}
      stage="starting"
    />
  ),
};

export const RebuildBanner: Story = {
  render: () => (
    <div style={{ height: 180, position: "relative", width: 560 }}>
      <ComputerRebuildBanner
        activeStep="Starting the computer"
        kind="recover"
        onOpen={noop}
        progress={0.72}
      />
    </div>
  ),
};
export const TakingLonger: Story = {
  render: () => (
    <ComputerTakingLongerDialog
      kind="reset"
      onContinueInBackground={noop}
      onKeepWaiting={noop}
      open
    />
  ),
};

export const WorkspacePanel: Story = {
  render: () => (
    <div style={{ height: 620, position: "relative", width: 640 }}>
      <AgentWorkspacePanel
        activity={<p>Agent activity appears here.</p>}
        activityCount={2}
        agentId="hello-world"
        agentName="Hello World"
        monitors={[
          { id: "hello-world", previewUrl: preview, title: "Hello World" },
          { id: "research", previewUrl: preview, title: "Research" },
        ]}
        onClose={noop}
        onResize={noop}
        onSelectMonitor={noop}
        open
      />
    </div>
  ),
  parameters: { layout: "fullscreen" },
};
