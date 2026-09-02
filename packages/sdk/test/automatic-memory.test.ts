import { describe, expect, it, vi } from "vite-plus/test";
import { createClient } from "../src";

describe("ChatKit automatic memory", () => {
  it("sends only the durable triggering message identity", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ items: [], rendered: "", estimated_tokens: 0, truncated: false }),
    );
    const chatkit = createClient({
      apiKey: "recipient-agent-key",
      baseUrl: "https://api.example.test",
      teamId: "team-one",
      fetch: fetchMock,
    }).chatkit;

    await chatkit.recallAutomaticMemory({
      agentId: "agent-one",
      sessionId: "session-one",
      messageId: "message-one",
      maxTokens: 512,
    });

    const [[url, init]] = fetchMock.mock.calls as unknown as [[string, RequestInit]];
    expect(url).toContain("/chatkit/agents/agent-one/sessions/session-one/automatic-memory/recall");
    expect(JSON.parse(init.body as string)).toEqual({
      message_id: "message-one",
      max_tokens: 512,
    });
    expect(init.body as string).not.toContain("user");
    expect(init.body as string).not.toContain("identity");
  });

  it("reads and updates the owner-selected mode and complete bank selection", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          automatic_memory_mode: "personal_plus_agent",
          memory_bank_ids: ["bank-one"],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ automatic_memory_mode: "team", memory_bank_ids: ["bank-two"] }),
      );
    const chatkit = createClient({
      apiKey: "owner-key",
      baseUrl: "https://api.example.test",
      teamId: "team-one",
      fetch: fetchMock,
    }).chatkit;

    await expect(chatkit.getAgentMemorySettings("agent-one")).resolves.toEqual({
      mode: "personal_plus_agent",
      bankIds: ["bank-one"],
    });
    await expect(
      chatkit.updateAgentMemorySettings("agent-one", { mode: "team", bankIds: ["bank-two"] }),
    ).resolves.toEqual({ mode: "team", bankIds: ["bank-two"] });

    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(calls[1]?.[1].method).toBe("PATCH");
    expect(JSON.parse(calls[1]?.[1].body as string)).toEqual({
      automatic_memory_mode: "team",
      memory_bank_ids: ["bank-two"],
    });
  });
});
