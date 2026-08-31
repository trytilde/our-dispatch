import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  codingAgentAuditConfigPath,
  installCodingAgentAuditHooks,
  runCodingAgentAuditHook,
  writeCodingAgentAuditInstallation,
} from "./coding-agent-audit";

describe("coding-agent audit integration", () => {
  it.each(["claude", "cursor", "gemini"] as const)(
    "installs and deduplicates %s hooks",
    async (cli) => {
      const homeDir = await mkdtemp(join(tmpdir(), `tilde-audit-${cli}-`));
      const first = await installCodingAgentAuditHooks({ cli, homeDir, mcpServers: [] });
      const second = await installCodingAgentAuditHooks({ cli, homeDir, mcpServers: [] });
      expect(second).toBe(first);
      const contents = await readFile(first!, "utf8");
      expect(contents.match(new RegExp(`openbot plugin audit --cli ${cli}`, "g"))?.length).toBe(
        cli === "gemini" ? 5 : 7,
      );
    },
  );

  it("installs the OpenCode audit plugin idempotently", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "tilde-audit-opencode-"));
    const first = await installCodingAgentAuditHooks({ cli: "opencode", homeDir, mcpServers: [] });
    const second = await installCodingAgentAuditHooks({ cli: "opencode", homeDir, mcpServers: [] });
    expect(second).toBe(first);
    expect(await readFile(first!, "utf8")).toContain("export const TildeChatKitAudit");
  });

  it.each([
    {
      cli: "claude" as const,
      payload: {
        session_id: "claude-session",
        hook_event_name: "UserPromptSubmit",
        prompt: "Audit this change",
      },
    },
    {
      cli: "opencode" as const,
      payload: {
        session_id: "opencode-session",
        hook_event_name: "chat.message",
        text: "Audit this change",
      },
    },
    {
      cli: "gemini" as const,
      payload: {
        session_id: "gemini-session",
        hook_event_name: "BeforeAgent",
        prompt: "Audit this change",
      },
    },
  ])("records a $cli prompt using stored non-secret routing config", async ({ cli, payload }) => {
    const homeDir = await mkdtemp(join(tmpdir(), "tilde-audit-record-"));
    await writeCodingAgentAuditInstallation(
      cli,
      { baseUrl: "https://api.test", teamId: "team-1", agentId: "agent-1" },
      homeDir,
    );
    expect(JSON.parse(await readFile(codingAgentAuditConfigPath(homeDir), "utf8"))).toMatchObject({
      installations: { [cli]: { teamId: "team-1", agentId: "agent-1" } },
    });

    const requests: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = input instanceof Request ? input.url : input.toString();
      requests.push(url);
      if (url.endsWith("/chatkit/sessions")) {
        return Response.json({
          session: { id: "session-1" },
          participants: [
            { participant_type: "human", inbox: { id: "channel" }, instance: { id: "human" } },
            { participant_type: "agent", inbox: { id: "agent-1" }, instance: { id: "agent" } },
          ],
        });
      }
      return Response.json({ id: "message-1" });
    }) as typeof fetch;
    try {
      await runCodingAgentAuditHook({
        cli,
        homeDir,
        apiKey: "test-key",
        payload,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(requests).toEqual([
      "https://api.test/api/v1/team/team-1/chatkit/sessions",
      "https://api.test/api/v1/team/team-1/chatkit/session/session-1/message",
    ]);
  });
});
