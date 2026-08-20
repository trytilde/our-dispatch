import { describe, expect, it } from "vite-plus/test";
import { connectorSelectionViewFromPart } from "./connector-components.js";
import { splitMessageSegments } from "./message-blocks.js";

const connectorPart = {
  type: "tool",
  tool_name: "configure_connector",
  tool_invocation_id: "call-1",
  state: "output-available",
  output: {
    status: "selection_required",
    connector_selection: {
      provider_type_id: "google_mail",
      provider_name: "Google Mail",
      prompt: "Select which account to enable for this bot for Google Mail",
      accounts: [
        { id: "tgi-1", display_name: "Work Gmail", status: "active" },
        { id: "tgi-2", display_name: "Personal Gmail", status: "active" },
      ],
      credential_sources: [
        {
          type_id: "google_mail_managed_oauth",
          name: "Sign in with your browser",
          requires_brokering: true,
          supports_auto_display_name: true,
        },
      ],
    },
  },
};

describe("connectorSelectionViewFromPart", () => {
  it("maps a completed configure_connector tool part to the picker view", () => {
    const view = connectorSelectionViewFromPart(connectorPart);
    expect(view).toMatchObject({
      providerTypeId: "google_mail",
      providerName: "Google Mail",
      prompt: "Select which account to enable for this bot for Google Mail",
    });
    expect(view?.accounts.map((account) => account.displayName)).toEqual([
      "Work Gmail",
      "Personal Gmail",
    ]);
    expect(view?.credentialSources[0]).toMatchObject({
      typeId: "google_mail_managed_oauth",
      requiresBrokering: true,
      supportsAutoDisplayName: true,
    });
  });

  it("returns undefined for other tools and incomplete calls", () => {
    expect(connectorSelectionViewFromPart({ ...connectorPart, tool_name: "bash" })).toBeUndefined();
    expect(
      connectorSelectionViewFromPart({
        type: "tool",
        tool_name: "configure_connector",
        state: "input-streaming",
      }),
    ).toBeUndefined();
  });
});

describe("splitMessageSegments with connector parts", () => {
  it("keeps the connector card out of the collapsed tool-chip run", () => {
    const segments = splitMessageSegments([
      { type: "reasoning", text: "Checking connectors" },
      { type: "tool", tool_name: "bash", state: "output-available", output: "ok" },
      connectorPart,
      { type: "text", text: "Pick an account above." },
    ]);
    expect(segments.map((segment) => segment.kind)).toEqual(["run", "other", "text"]);
    const other = segments[1];
    expect(other?.kind === "other" && other.part.tool_name).toBe("configure_connector");
  });

  it("keeps a still-running configure_connector call in the tool run", () => {
    const segments = splitMessageSegments([
      { type: "tool", tool_name: "configure_connector", state: "input-streaming" },
    ]);
    expect(segments.map((segment) => segment.kind)).toEqual(["run"]);
  });
});
