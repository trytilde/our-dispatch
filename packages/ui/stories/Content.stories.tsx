import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  AudioPlayer,
  ComputerHandoffCard,
  DiagramCard,
  LinkHoverPreview,
  LinkPreviewCard,
} from "../src/index.js";

const meta = { title: "OpenBot/Rich Content" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
const noop = () => undefined;
const image =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='420'%3E%3Crect width='100%25' height='100%25' fill='%23e7e9e7'/%3E%3Crect x='72' y='56' width='656' height='308' rx='16' fill='%23fbfbfa' stroke='%23d8dad8'/%3E%3Ccircle cx='400' cy='178' r='58' fill='%2371a77b'/%3E%3Ctext x='400' y='286' text-anchor='middle' font-family='sans-serif' font-size='26' fill='%23242624'%3EOpenBot Computer%3C/text%3E%3C/svg%3E";
const audio = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

export const InlineAudio: Story = {
  render: () => (
    <div style={{ width: 520 }}>
      <AudioPlayer name="Voice note" src={audio} />
    </div>
  ),
};

export const FullscreenAudio: Story = {
  render: () => <AudioPlayer name="Interview recording" src={audio} surface="fullscreen" />,
};

const metadata = {
  description: "A concise guide to building and operating an agent workspace.",
  hostname: "docs.example.com",
  imageUrl: image,
  title: "Build an agent workspace",
};

export const LinkCard: Story = {
  render: () => <LinkPreviewCard metadata={metadata} url="https://docs.example.com/openbot" />,
};

export const LinkHover: Story = {
  render: () => (
    <p style={{ margin: 80 }}>
      Read the{" "}
      <LinkHoverPreview metadata={metadata} url="https://docs.example.com/openbot">
        <a href="https://docs.example.com/openbot">workspace guide</a>
      </LinkHoverPreview>
      .
    </p>
  ),
};

const diagram = (
  <svg aria-label="Agent workflow" height="220" role="img" viewBox="0 0 620 220" width="620">
    <defs>
      <marker id="arrow" markerHeight="8" markerWidth="8" orient="auto" refX="7" refY="4">
        <path d="M0 0L8 4L0 8Z" fill="currentColor" />
      </marker>
    </defs>
    <g fill="#fbfbfa" stroke="#aeb2ae" strokeWidth="1.2">
      <rect height="64" rx="12" width="150" x="22" y="78" />
      <rect height="64" rx="12" width="150" x="235" y="78" />
      <rect height="64" rx="12" width="150" x="448" y="78" />
    </g>
    <g fill="#242624" fontFamily="sans-serif" fontSize="14" textAnchor="middle">
      <text x="97" y="116">
        Request
      </text>
      <text x="310" y="116">
        Agent
      </text>
      <text x="523" y="116">
        Computer
      </text>
    </g>
    <g fill="none" markerEnd="url(#arrow)" stroke="#616661" strokeWidth="1.5">
      <path d="M172 110H225" />
      <path d="M385 110H438" />
    </g>
  </svg>
);

export const Diagram: Story = {
  render: () => (
    <div style={{ width: 720 }}>
      <DiagramCard onCopy={noop} source="flowchart LR\nRequest --> Agent --> Computer">
        {diagram}
      </DiagramCard>
    </div>
  ),
};

export const DiagramLoading: Story = {
  render: () => (
    <div style={{ width: 720 }}>
      <DiagramCard source="flowchart LR" state="loading" />
    </div>
  ),
};

export const DiagramError: Story = {
  render: () => (
    <div style={{ width: 720 }}>
      <DiagramCard error="Unexpected diagram token" source="flowchart LR\nA --" state="error" />
    </div>
  ),
};

export const ComputerHandoffWaiting: Story = {
  render: () => (
    <ComputerHandoffCard
      instruction="Sign in to the service, then return here so the agent can continue."
      onDismiss={noop}
      onHandBack={noop}
      onOpen={noop}
      snapshotUrl={image}
      status="waiting"
    />
  ),
};

export const ComputerHandoffCompleted: Story = {
  render: () => (
    <ComputerHandoffCard
      instruction="Sign in to the service, then return here so the agent can continue."
      onDismiss={noop}
      onHandBack={noop}
      onOpen={noop}
      status="handed-back"
    />
  ),
};

export const ComputerHandoffSkipped: Story = {
  render: () => (
    <ComputerHandoffCard
      instruction="Sign in to the service, then return here so the agent can continue."
      onDismiss={noop}
      onHandBack={noop}
      onOpen={noop}
      status="skipped"
    />
  ),
};
