import { describe, expect, it } from "vite-plus/test";
import { defaultCommandForCli, parseTildePluginArgs, tildePluginHelpText } from "./plugin.js";

describe("OpenBot Tilde plugin command", () => {
  it("parses configure-only invocations", () => {
    expect(
      parseTildePluginArgs([
        "--cli",
        "codex",
        "--team-id",
        "team-a",
        "--base-url",
        "https://api.test",
        "--non-interactive",
        "--no-launch",
      ]),
    ).toMatchObject({
      cli: "codex",
      teamId: "team-a",
      baseUrl: "https://api.test",
      interactive: false,
      launch: false,
    });
  });

  it("parses launch passthrough arguments", () => {
    expect(
      parseTildePluginArgs(["--cli", "claude", "--launch", "--", "--dangerously-skip-permissions"]),
    ).toMatchObject({
      cli: "claude",
      launch: true,
      passthrough: ["--dangerously-skip-permissions"],
    });
    expect(defaultCommandForCli("claude")).toBe("claude");
    expect(tildePluginHelpText()).toContain("openbot plugin --cli");
  });
});
