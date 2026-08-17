import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import {
  InputGroup,
  KeyboardKey,
  ModelPicker,
  ScrollArea,
  SelectField,
  StatusBadge,
  TextRoll,
  VoiceWaveform,
} from "../src/index.js";

const meta = { title: "OpenBot/Controls" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Statuses: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 8 }}>
      <StatusBadge>Idle</StatusBadge>
      <StatusBadge tone="success">Connected</StatusBadge>
      <StatusBadge tone="warning">Action needed</StatusBadge>
      <StatusBadge tone="danger">Failed</StatusBadge>
      <StatusBadge tone="accent">Working</StatusBadge>
    </div>
  ),
};

export const KeyboardShortcut: Story = {
  render: () => (
    <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
      Find in chat <KeyboardKey>⌘</KeyboardKey>
      <KeyboardKey>F</KeyboardKey>
    </span>
  ),
};

function InputsExample() {
  const [value, setValue] = useState("");
  return (
    <div style={{ display: "grid", gap: 10, width: 420 }}>
      <InputGroup
        addon="⌕"
        ariaLabel="Search"
        onChange={(event) => setValue(event.target.value)}
        placeholder="Search"
        value={value}
      />
      <InputGroup ariaLabel="Instructions" multiline placeholder="Add instructions…" />
      <SelectField
        ariaLabel="Environment"
        label="Environment"
        onChange={() => undefined}
        options={[
          { label: "Development", value: "dev" },
          { label: "Production", value: "prod" },
        ]}
        value="dev"
      />
    </div>
  );
}

export const Inputs: Story = { render: () => <InputsExample /> };

export const Scrolling: Story = {
  render: () => (
    <ScrollArea maxHeight={190}>
      <div style={{ display: "grid", gap: 8, width: 320 }}>
        {Array.from({ length: 14 }, (_, index) => (
          <div key={index} style={{ borderBottom: "1px solid #0000000d", padding: 8 }}>
            Activity item {index + 1}
          </div>
        ))}
      </div>
    </ScrollArea>
  ),
};

function TextRollExample() {
  const [count, setCount] = useState(1);
  return (
    <button onClick={() => setCount((value) => value + 1)} type="button">
      Processing <TextRoll value={`${count} task${count === 1 ? "" : "s"}`} />
    </button>
  );
}

export const RollingText: Story = { render: () => <TextRollExample /> };

export const Voice: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 24 }}>
      <VoiceWaveform />
      <VoiceWaveform active />
    </div>
  ),
};

function ModelPickerExample() {
  const [model, setModel] = useState("auto");
  return (
    <ModelPicker
      onChange={setModel}
      options={[
        {
          description: "Balanced quality and speed",
          id: "auto",
          label: "Auto",
          suffix: "Recommended",
        },
        { description: "Fast responses", id: "fast", label: "Fast" },
        { description: "Highest reasoning effort", id: "max", label: "Max", suffix: "2x" },
      ]}
      value={model}
    />
  );
}

export const Models: Story = { render: () => <ModelPickerExample /> };
