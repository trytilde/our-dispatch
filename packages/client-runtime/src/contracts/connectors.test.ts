import { describe, expect, it } from "vite-plus/test";
import {
  connectorAccountCreatedMessage,
  connectorAccountSelectionMessage,
  connectorAuthorizedReturnUrl,
  connectorSelectionFromPart,
  connectorSetupFields,
  CreateConnectorAccountResultSchema,
  waitForConnectorAccountActive,
  type ConnectorAccount,
} from "./connectors.js";

const selectionOutput = {
  status: "selection_required",
  instructions: "Card shown.",
  connector_selection: {
    provider_type_id: "google_mail",
    provider_name: "Google Mail",
    accounts: [{ id: "tgi-1", display_name: "Work Gmail", status: "active" }],
    credential_sources: [
      {
        type_id: "google_mail_managed_oauth",
        name: "Sign in with your browser",
        requires_brokering: true,
        supports_auto_display_name: true,
      },
    ],
  },
};

describe("connectorSelectionFromPart", () => {
  it("extracts the payload from a completed configure_connector tool part", () => {
    const selection = connectorSelectionFromPart({
      type: "tool",
      tool_name: "configure_connector",
      output: selectionOutput,
    });
    expect(selection?.provider_type_id).toBe("google_mail");
    expect(selection?.accounts[0]?.display_name).toBe("Work Gmail");
    expect(selection?.credential_sources?.[0]?.requires_brokering).toBe(true);
  });

  it("unwraps AI SDK json-envelope tool outputs", () => {
    const selection = connectorSelectionFromPart({
      type: "tool-configure_connector",
      output: { type: "json", value: selectionOutput },
    });
    expect(selection?.provider_name).toBe("Google Mail");
  });

  it("ignores other tools, non-tool parts, and malformed payloads", () => {
    expect(
      connectorSelectionFromPart({ type: "tool", tool_name: "bash", output: selectionOutput }),
    ).toBeUndefined();
    expect(connectorSelectionFromPart({ type: "text", output: selectionOutput })).toBeUndefined();
    expect(
      connectorSelectionFromPart({
        type: "tool",
        tool_name: "configure_connector",
        output: { connector_selection: { provider_name: "broken" } },
      }),
    ).toBeUndefined();
  });
});

describe("connectorSetupFields", () => {
  it("flattens a credential JSON Schema into labeled fields", () => {
    const fields = connectorSetupFields({
      type: "object",
      required: ["api_key"],
      properties: {
        api_key: { type: "string", format: "password", description: "Your API key" },
        base_url: { type: "string", title: "Base URL" },
        extra_config: { type: "object" },
      },
    });
    expect(fields).toEqual([
      {
        key: "api_key",
        label: "Api key",
        required: true,
        secret: true,
        multiline: false,
        description: "Your API key",
      },
      { key: "base_url", label: "Base URL", required: false, secret: false, multiline: false },
      {
        key: "extra_config",
        label: "Extra config",
        required: false,
        secret: false,
        multiline: true,
      },
    ]);
  });

  it("returns no fields for managed or empty schemas", () => {
    expect(connectorSetupFields(undefined)).toEqual([]);
    expect(connectorSetupFields({ type: "object" })).toEqual([]);
  });
});

describe("connector hand-back messages", () => {
  const provider = { provider_type_id: "google_mail", provider_name: "Google Mail" };

  it("names the selected account and its instance id", () => {
    const text = connectorAccountSelectionMessage(provider, {
      id: "tgi-1",
      display_name: "Work Gmail",
    });
    expect(text).toContain('"Work Gmail"');
    expect(text).toContain("tool_group_instance_id=tgi-1");
    expect(text).toContain("tool_group_source_type_id=google_mail");
  });

  it("distinguishes created accounts from pending authorizations", () => {
    const created = CreateConnectorAccountResultSchema.parse({
      status: "created",
      account: { id: "tgi-2", display_name: "Support", status: "active" },
    });
    expect(connectorAccountCreatedMessage(provider, created)).toContain("Enable its tools");
    const authorize = CreateConnectorAccountResultSchema.parse({
      status: "authorize",
      account: { id: "tgi-3", display_name: "Ops", status: "brokering_initiated" },
      authorization_url: "https://accounts.google.com/o/oauth2/auth",
    });
    expect(connectorAccountCreatedMessage(provider, authorize)).toContain("started authorizing");
  });
});

describe("connectorAuthorizedReturnUrl", () => {
  it("builds the universal return target per client", () => {
    expect(connectorAuthorizedReturnUrl("https://openbot.test/", "electron")).toBe(
      "https://openbot.test/connectors/authorized?client=electron",
    );
  });
});

describe("waitForConnectorAccountActive", () => {
  it("resolves once the brokered account turns active", async () => {
    const states = ["brokering_initiated", "brokering_initiated", "active"];
    const client = {
      listConnectorAccounts: async (): Promise<ConnectorAccount[]> => [
        { id: "tgi-1", display_name: "Work", status: states.shift() ?? "active" },
      ],
    };
    const account = await waitForConnectorAccountActive(client, {
      providerTypeId: "github",
      accountId: "tgi-1",
      intervalMs: 1,
      sleep: async () => undefined,
    });
    expect(account?.status).toBe("active");
  });

  it("returns undefined when aborted or timed out", async () => {
    const controller = new AbortController();
    controller.abort();
    const client = {
      listConnectorAccounts: async (): Promise<ConnectorAccount[]> => [
        { id: "tgi-1", display_name: "Work", status: "brokering_initiated" },
      ],
    };
    await expect(
      waitForConnectorAccountActive(client, {
        providerTypeId: "github",
        accountId: "tgi-1",
        signal: controller.signal,
        intervalMs: 1,
        sleep: async () => undefined,
      }),
    ).resolves.toBeUndefined();
  });
});
