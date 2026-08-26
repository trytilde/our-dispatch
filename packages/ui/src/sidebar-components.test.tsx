import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import {
  AgentListItem,
  WorkspaceAccount,
  type WorkspaceAccountProps,
} from "./sidebar-components.js";

describe("WorkspaceAccount", () => {
  it("does not expose the authenticated email when a session has no name", () => {
    const account = { email: "owner@example.com" } as WorkspaceAccountProps["account"];
    const markup = renderToStaticMarkup(createElement(WorkspaceAccount, { account }));

    expect(markup).toContain("Open account menu for Your account");
    expect(markup).not.toContain("owner@example.com");
  });
});

describe("AgentListItem chat rows", () => {
  it("labels the continuous agent conversation as bot", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentListItem, {
        agent: { id: "session-default", avatarId: "agent-one", badge: "bot", name: "Factory" },
        selected: true,
        onSelect: () => undefined,
      }),
    );

    expect(markup).toContain(">bot<");
    expect(markup).not.toContain(">user<");
  });

  it("renders the session kind before its title while retaining the bot avatar identity", () => {
    const markup = renderToStaticMarkup(
      createElement(AgentListItem, {
        agent: {
          id: "session-thread-one",
          avatarId: "agent-one",
          badge: "thread",
          name: "Quarterly planning",
        },
        selected: false,
        onSelect: () => undefined,
      }),
    );

    expect(markup).toContain(">thread<");
    expect(markup).toContain("Quarterly planning");
    expect(markup.indexOf(">thread<")).toBeLessThan(markup.lastIndexOf("Quarterly planning"));
  });
});
