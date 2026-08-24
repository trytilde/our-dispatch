import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { WorkspaceAccount, type WorkspaceAccountProps } from "./sidebar-components.js";

describe("WorkspaceAccount", () => {
  it("falls back to the authenticated email when a stale session has no name", () => {
    const account = { email: "owner@example.com" } as WorkspaceAccountProps["account"];

    expect(() => renderToStaticMarkup(createElement(WorkspaceAccount, { account }))).not.toThrow();
    expect(renderToStaticMarkup(createElement(WorkspaceAccount, { account }))).toContain(
      "Open account menu for owner@example.com",
    );
  });
});
