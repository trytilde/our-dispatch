import { describe, expect, it, vi } from "vite-plus/test";
import { createClient } from "../src";

const synthesisEvidenceId = "11111111-1111-4111-8111-111111111111";

describe("MemoryClient", () => {
  it("binds bank identity in the path and exposes synchronous mutations", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ result: { stored: true } }))
      .mockResolvedValueOnce(Response.json({ result: { items: [] } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const memory = createClient({
      apiKey: "agent-key",
      baseUrl: "https://api.example.test",
      teamId: "team-one",
      fetch: fetchMock,
    }).memory.bank("bank-one");

    await memory.supersede("old-memory", {
      documentId: "preference:coffee",
      content: "Prefers pour-over coffee.",
      memoryType: "preferences",
      evidenceIds: ["event-one"],
    });
    await memory.recall("coffee");
    await memory.forget("preference:coffee");

    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(calls.every(([url]) => url.includes("/memory/banks/bank-one/"))).toBe(true);
    const mutationBody = JSON.parse(calls[0]?.[1].body as string);
    expect(mutationBody.document.metadata).toMatchObject({
      memory_type: "preferences",
      supersedes_memory_id: "old-memory",
      evidence_ids: ["event-one"],
    });
    expect(JSON.stringify(mutationBody)).not.toContain("bank_id");
  });

  it("maps nullable synthesis metadata from visible banks", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        items: [
          {
            id: "bank-one",
            org_id: "org-one",
            team_id: "team-one",
            agent_id: "factory",
            name: "Factory memory",
            provider: "helix",
            provider_bank_id: "bank-one",
            status: "active",
            synthesizer_agent_id: null,
            synthesis_session_id: null,
            created_at: "2026-09-02T00:00:00Z",
            updated_at: "2026-09-02T00:00:00Z",
          },
        ],
        next_page_token: null,
      }),
    );
    const memory = createClient({
      apiKey: "agent-key",
      baseUrl: "https://api.example.test",
      teamId: "team-one",
      fetch: fetchMock,
    }).memory;

    await expect(memory.visibleBanks()).resolves.toMatchObject({
      items: [
        {
          id: "bank-one",
          agentId: "factory",
          provider: "helix",
          synthesizerAgentId: null,
          synthesisSessionId: null,
        },
      ],
    });
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(String(calls[0]?.[0])).toContain("/memory/banks/visible");
  });

  it("binds synthesis mutations only to the ChatKit session path", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ result: { ok: true } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const memory = createClient({
      apiKey: "agent-key",
      baseUrl: "https://api.example.test",
      teamId: "team-one",
      fetch: fetchMock,
    }).memory.synthesisSession("session-one");
    expect(() =>
      memory.finish({
        batchId: "batch-one",
        evidenceIds: [synthesisEvidenceId],
        leaseOwner: "",
        outcome: "noop",
        reason: "duplicate evidence",
      }),
    ).toThrow("leaseOwner is required");
    await expect(
      memory.forget({
        documentId: "obsolete-memory",
        batchId: "batch-one",
        evidenceIds: [synthesisEvidenceId],
        leaseOwner: "",
      }),
    ).rejects.toThrow("leaseOwner is required");
    await memory.finish({
      batchId: "batch-one",
      evidenceIds: [synthesisEvidenceId],
      leaseOwner: "lease-one",
      outcome: "noop",
      reason: "duplicate evidence",
    });
    await memory.forget({
      documentId: "obsolete-memory",
      batchId: "batch-one",
      evidenceIds: [synthesisEvidenceId],
      leaseOwner: "lease-one",
    });
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0]?.[0]).toContain("/memory/synthesis-sessions/session-one/retain");
    const finishBody = JSON.parse(calls[0]?.[1].body as string);
    expect(finishBody.document).toMatchObject({
      document_id: "synthesis-receipt:batch-one",
      metadata: {
        evidence_ids: [synthesisEvidenceId],
        synthesis_batch_id: "batch-one",
        synthesis_lease_owner: "lease-one",
      },
    });
    expect(JSON.parse(finishBody.document.content)).toMatchObject({
      batch_id: "batch-one",
      evidence_ids: [synthesisEvidenceId],
      lease_owner: "lease-one",
      outcome: "noop",
    });
    expect(JSON.stringify(finishBody)).not.toContain("bank_id");
    expect(calls[1]?.[0]).toContain("/memory/synthesis-sessions/session-one/documents");
    expect(JSON.parse(calls[1]?.[1].body as string)).toEqual({
      document_id: "obsolete-memory",
      batch_id: "batch-one",
      evidence_ids: [synthesisEvidenceId],
      lease_owner: "lease-one",
    });
  });

  it("lets an owner inspect, edit, and delete an attributed explicit fact", async () => {
    const explicit = {
      memory_id: "manual:fact-one",
      content: "Prefers tea.",
      metadata_json: JSON.stringify({
        origin: "owner_explicit",
        author_principal_id: "owner-one",
        automatic_overwrite_protected: true,
      }),
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(explicit))
      .mockResolvedValueOnce(Response.json({ result: explicit }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const memory = createClient({
      apiKey: "owner-key",
      baseUrl: "https://api.example.test",
      teamId: "team-one",
      fetch: fetchMock,
    }).memory.personalBank("owner-one", "bank-one");

    expect(await memory.document("manual:fact-one")).toEqual(explicit);
    await memory.upsert({
      documentId: "manual:fact-one",
      content: "Prefers green tea.",
      memoryType: "preferences",
    });
    await memory.forget("manual:fact-one");

    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0]?.[0]).toContain(
      "/api/v1/user/owner-one/memory/banks/bank-one/documents/manual%3Afact-one",
    );
    expect(calls[1]?.[1].body as string).toContain("manual:fact-one");
    expect(calls[2]?.[1].body as string).toContain("manual:fact-one");
  });

  it("lists personal banks and controls their optional background synthesizer", async () => {
    const bank = {
      id: "bank-one",
      org_id: "org-one",
      team_id: null,
      created_by_user_id: "owner-one",
      name: "Personal memory",
      provider: "helix",
      provider_bank_id: "bank-one",
      status: "active",
      synthesizer_agent_id: "memory-catcher",
      synthesizer_team_id: "team-one",
      synthesis_session_id: "session-one",
      created_at: "2026-09-02T00:00:00Z",
      updated_at: "2026-09-02T00:00:00Z",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ items: [bank], next_page_token: null }))
      .mockResolvedValueOnce(Response.json(bank))
      .mockResolvedValueOnce(
        Response.json({
          ...bank,
          synthesizer_agent_id: null,
          synthesizer_team_id: null,
          synthesis_session_id: null,
        }),
      );
    const memory = createClient({
      bearerToken: "owner-token",
      baseUrl: "https://api.example.test",
      teamId: "team-one",
      fetch: fetchMock,
    }).memory;

    await expect(memory.personalBanks("owner-one")).resolves.toMatchObject({
      items: [{ id: "bank-one", createdByUserId: "owner-one", teamId: null }],
    });
    await memory.assignPersonalSynthesizer({
      ownerUserId: "owner-one",
      bankId: "bank-one",
      synthesizerAgentId: "memory-catcher",
      synthesizerTeamId: "team-one",
    });
    await memory.clearPersonalSynthesizer({ ownerUserId: "owner-one", bankId: "bank-one" });

    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map(([url]) => url)).toEqual([
      "https://api.example.test/api/v1/user/owner-one/memory/banks",
      "https://api.example.test/api/v1/user/owner-one/memory/banks/bank-one/synthesizer",
      "https://api.example.test/api/v1/user/owner-one/memory/banks/bank-one/synthesizer",
    ]);
    expect(calls[1]?.[1].method).toBe("PUT");
    expect(calls[2]?.[1].method).toBe("DELETE");
  });

  it("replaces and retries personal source bindings without a team path", async () => {
    const fetchMock = vi.fn(async () => Response.json({ items: [] }));
    const memory = createClient({
      bearerToken: "owner-token",
      baseUrl: "https://api.example.test",
      teamId: "team-one",
      fetch: fetchMock,
    }).memory;

    await memory.bindPersonalSource("owner-one", {
      sourceKind: "wiki",
      sourceId: "wiki-one",
      memoryBankIds: ["bank-one"],
    });
    await memory.retryPersonalSource("owner-one", "wiki", "wiki-one");

    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map(([url]) => url)).toEqual([
      "https://api.example.test/api/v1/user/owner-one/memory/source-bindings",
      "https://api.example.test/api/v1/user/owner-one/memory/source-bindings/retry",
    ]);
    expect(JSON.parse(calls[0]?.[1].body as string)).toEqual({
      source_kind: "wiki",
      source_id: "wiki-one",
      memory_bank_ids: ["bank-one"],
    });
  });
});
