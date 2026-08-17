import { describe, expect, it } from "vite-plus/test";
import { agentCommand, agentVisiblePath, agentWorkspaceRoot } from "./agent.js";

describe("agent computer execution", () => {
  it("maps an agent id to its directory on the shared workspace", () => {
    expect(agentWorkspaceRoot("hello-world")).toBe("/workspace/hello-world");
  });

  it("runs commands directly from the agent directory with an allowlisted environment", () => {
    const command = agentCommand("hello-world", "pwd", [], { cwd: "project" });
    expect(command).toMatchObject({
      command: "pwd",
      arguments: [],
      cwd: "/workspace/hello-world/project",
      environment: {
        HOME: "/workspace/hello-world",
        AGENT_ID: "hello-world",
        COMPUTER_WORKSPACE: "/workspace/hello-world",
      },
    });
    expect(command.environment).not.toHaveProperty("COMPUTER_SERVICE_API_KEY");
  });

  it("rejects invalid agent ids while allowing the visible computer filesystem", () => {
    expect(() => agentCommand("../owner", "pwd")).toThrow("valid agent_id");
    expect(agentVisiblePath("hello-world", "notes/today.md")).toBe(
      "/workspace/hello-world/notes/today.md",
    );
    expect(agentVisiblePath("hello-world", "/etc/systemd/system")).toBe("/etc/systemd/system");
    expect(() => agentVisiblePath("hello-world", "bad\0path")).toThrow("valid computer path");
  });
});
