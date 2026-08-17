import type { Preview } from "@storybook/react-vite";
// @ts-expect-error Storybook's Vite renderer loads package CSS as a side effect.
import "../src/beautiful-ui/upstream/globals.css";
// @ts-expect-error Storybook's Vite renderer loads package CSS as a side effect.
import "../src/openbot-ui.css";

const preview: Preview = {
  parameters: {
    backgrounds: {
      default: "OpenBot",
      values: [
        { name: "OpenBot", value: "#f5f5f3" },
        { name: "Surface", value: "#fbfbfa" },
        { name: "Dark", value: "#171717" },
      ],
    },
    controls: { expanded: true },
    layout: "centered",
  },
  decorators: [
    (Story) => (
      <div className="openbot-storybook-root">
        <Story />
      </div>
    ),
  ],
};

export default preview;
