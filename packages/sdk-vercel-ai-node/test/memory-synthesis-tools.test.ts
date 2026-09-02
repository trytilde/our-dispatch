import type { MemorySynthesisSessionClient } from "@trytilde/sdk";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  createMemorySynthesisTools,
  restrictMemorySynthesisTools,
} from "../src/memory-synthesis-tools";

const evidenceId = "11111111-1111-4111-8111-111111111111";

describe("createMemorySynthesisTools", () => {
  it("keeps only bound mutations and read-only skill discovery", () => {
    const executable = { execute: vi.fn() } as never;
    const bound = { memory_upsert: executable, finish_synthesis: executable };
    expect(
      Object.keys(
        restrictMemorySynthesisTools(
          {
            ...bound,
            search_skills: executable,
            read_skill: executable,
            sendMessage: executable,
            MULTI_EXECUTE_TOOL: executable,
            memory_unbound_query: executable,
            tilde_modify_resource: executable,
          },
          bound,
        ),
      ).toSorted(),
    ).toEqual(["finish_synthesis", "memory_upsert", "read_skill", "search_skills"]);
  });

  it("exposes bank-free tools backed by one synthesis session client", async () => {
    const finish = vi.fn(async () => ({ ok: true }));
    const upsertMemory = vi.fn(async () => ({ ok: true }));
    const forgetMemory = vi.fn(async () => undefined);
    const memory = {
      recall: vi.fn(),
      upsert: upsertMemory,
      forget: forgetMemory,
      finish,
    } as unknown as MemorySynthesisSessionClient;
    const tools = createMemorySynthesisTools(memory);

    expect(Object.keys(tools)).toEqual([
      "memory_recall",
      "memory_upsert",
      "memory_supersede",
      "memory_forget",
      "finish_synthesis",
    ]);
    expect(JSON.stringify(tools)).not.toContain("bank_id");
    const forgetSchema = tools.memory_forget?.inputSchema as unknown as {
      safeParse(input: unknown): { success: boolean };
    };
    expect(
      forgetSchema.safeParse({
        batch_id: "batch-one",
        document_id: "obsolete-memory",
        evidence_ids: [evidenceId],
        lease_owner: "lease-one",
      }).success,
    ).toBe(true);
    expect(
      forgetSchema.safeParse({
        batch_id: "batch-one",
        document_id: "obsolete-memory",
        evidence_ids: [evidenceId, evidenceId],
        lease_owner: "lease-one",
      }).success,
    ).toBe(false);
    expect(
      forgetSchema.safeParse({
        batch_id: "batch-one",
        document_id: "obsolete-memory",
        evidence_ids: ["not-a-uuid"],
        lease_owner: "lease-one",
      }).success,
    ).toBe(false);

    const upsert = tools.memory_upsert?.execute as
      | ((input: Record<string, unknown>, options: never) => Promise<unknown>)
      | undefined;
    await upsert?.(
      {
        batch_id: "batch-one",
        document_id: "preference-one",
        content: "Prefers tea",
        memory_type: "preferences",
        evidence_ids: [evidenceId],
        lease_owner: "lease-one",
      },
      { toolCallId: "call-upsert", messages: [], context: undefined } as never,
    );
    const supersede = tools.memory_supersede?.execute as
      | ((input: Record<string, unknown>, options: never) => Promise<unknown>)
      | undefined;
    await supersede?.(
      {
        batch_id: "batch-one",
        previous_memory_id: "preference-old",
        document_id: "preference-new",
        content: "Prefers green tea",
        memory_type: "preferences",
        evidence_ids: [evidenceId],
        lease_owner: "lease-one",
      },
      { toolCallId: "call-supersede", messages: [], context: undefined } as never,
    );
    expect(upsertMemory).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        metadata: expect.objectContaining({
          synthesis_batch_id: "batch-one",
          synthesis_lease_owner: "lease-one",
        }),
        evidenceIds: [evidenceId],
      }),
    );
    expect(upsertMemory).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        supersedesMemoryId: "preference-old",
        metadata: {
          synthesis_batch_id: "batch-one",
          synthesis_lease_owner: "lease-one",
        },
        evidenceIds: [evidenceId],
      }),
    );

    const execute = tools.finish_synthesis?.execute as
      | ((input: Record<string, unknown>, options: never) => Promise<unknown>)
      | undefined;
    await execute?.(
      {
        batch_id: "batch-one",
        evidence_ids: [evidenceId],
        lease_owner: "lease-one",
        outcome: "noop",
        reason: "duplicate evidence",
      },
      { toolCallId: "call-one", messages: [], context: undefined } as never,
    );
    expect(finish).toHaveBeenCalledWith({
      batchId: "batch-one",
      evidenceIds: [evidenceId],
      leaseOwner: "lease-one",
      outcome: "noop",
      reason: "duplicate evidence",
    });

    const forget = tools.memory_forget?.execute as
      | ((input: Record<string, unknown>, options: never) => Promise<unknown>)
      | undefined;
    await forget?.(
      {
        batch_id: "batch-one",
        document_id: "obsolete-memory",
        evidence_ids: [evidenceId],
        lease_owner: "lease-one",
      },
      { toolCallId: "call-two", messages: [], context: undefined } as never,
    );
    expect(forgetMemory).toHaveBeenCalledWith({
      batchId: "batch-one",
      documentId: "obsolete-memory",
      evidenceIds: [evidenceId],
      leaseOwner: "lease-one",
    });
  });
});
