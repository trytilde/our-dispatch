import { describe, expect, it, vi } from "vite-plus/test";
import { createClient } from "../src";

const rawProposal = {
  id: "proposal-one",
  org_id: "org-one",
  team_id: "team-one",
  requesting_agent_id: "factory",
  calling_subject_id: "factory-principal",
  category: "mcp_server",
  status: "pending",
  title: "Add incident tools",
  rationale: "Incident inspection is unavailable",
  desired_state: { url: "https://mcp.example.test", credential_ref: "credential-one" },
  preview: {
    resource_diff: { operation: "create_or_reuse" },
    permissions: [],
    credentials: [
      {
        credential_type: "mcp_server_auth",
        purpose: "Authenticate",
        brokered_by: "tilde_managed_credential",
        required_fields: [],
      },
    ],
    cost_summary: "Upstream charges may apply.",
    affected_agents: ["factory"],
    affected_users: [],
    egress_destinations: ["previewed MCP server origin"],
    security_summary: "No implicit grants.",
    rollback_plan: "Delete only proposal-created resources.",
  },
  approval: {
    approval_id: "approval-one",
    proposal_id: "proposal-one",
    proposal_hash: "proposal-hash",
    proposal_generation: 1,
    status: "pending",
    title: "Add incident tools",
    instructions: "Incident inspection is unavailable",
  },
  generation: 1,
  resources: [],
  outputs_available: false,
  expires_at: "2026-09-02T12:00:00Z",
  created_at: "2026-09-01T12:00:00Z",
  updated_at: "2026-09-01T12:00:00Z",
} as const;

describe("SelfExtensionClient", () => {
  it("submits intent without accepting a client-authored preview or credential value", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(rawProposal));
    const client = createClient({
      apiKey: "agent-key",
      baseUrl: "https://api.example.test",
      teamId: "team-one",
      fetch: fetchMock,
    });
    const proposal = await client.selfExtension.propose({
      requestingAgentId: "factory",
      idempotencyKey: "incident-tools-v1",
      category: "mcp_server",
      title: "Add incident tools",
      rationale: "Incident inspection is unavailable",
      desiredState: { url: "https://mcp.example.test", credential_ref: "credential-one" },
    });
    expect(proposal.preview.credentials[0]?.credentialType).toBe("mcp_server_auth");
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(expectStringBody(call[1].body));
    expect(body.preview).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("credential_value");
  });

  it("exposes human review and waits for durable execution", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ...rawProposal, status: "approved" }))
      .mockResolvedValueOnce(Response.json({ ...rawProposal, status: "approved" }))
      .mockResolvedValueOnce(Response.json({ ...rawProposal, status: "executed" }));
    const client = createClient({
      bearerToken: "human-token",
      baseUrl: "https://api.example.test",
      teamId: "team-one",
      fetch: fetchMock,
    });
    await client.selfExtension.approve(rawProposal.id);
    const executed = await client.selfExtension.execute(rawProposal.id, {
      pollIntervalMs: 0,
      timeoutMs: 1_000,
    });
    expect(executed.status).toBe("executed");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/approve");
  });

  it("continues only a server-authored provider setup item", async () => {
    const continuation = {
      kind: "provider_setup",
      setup_item_id: "setup-one",
      resource_id: "connector-one",
      next_action: { type: "redirect" },
      instructions: "Continue setup",
    } as const;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ...rawProposal, continuation }))
      .mockResolvedValueOnce(Response.json({ next_action: { type: "complete" } }));
    const client = createClient({
      bearerToken: "human-token",
      baseUrl: "https://api.example.test",
      teamId: "team-one",
      fetch: fetchMock,
    });
    await client.selfExtension.continueProviderSetup(rawProposal.id);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      "/credential/setup-items/setup-one/resume",
    );
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("client_secret");
  });
});

function expectStringBody(body: unknown): string {
  expect(typeof body).toBe("string");
  return body as string;
}
