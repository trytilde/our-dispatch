import type { MemorySynthesisSessionClient } from "@trytilde/sdk";
import { tool, type ToolSet } from "ai";
import { z } from "zod";

const SKILL_DISCOVERY_TOOLS = new Set([
  "list_skills",
  "search_skills",
  "read_skill_description",
  "read_skill",
]);
const evidenceIdsSchema = z
  .array(z.uuid())
  .min(1)
  .refine((ids) => new Set(ids).size === ids.length, "evidence_ids must be unique");

/**
 * Keep a synthesis turn restricted to its session-bound memory mutations and
 * the four read-only tools needed to load its managed skills.
 */
export function restrictMemorySynthesisTools(discovered: ToolSet, bound: ToolSet): ToolSet {
  return Object.fromEntries(
    Object.entries(discovered).filter(
      ([name]) => Object.hasOwn(bound, name) || SKILL_DISCOVERY_TOOLS.has(name),
    ),
  );
}

/** Tools bound to one authenticated synthesis session; bank IDs never enter schemas. */
export function createMemorySynthesisTools(memory: MemorySynthesisSessionClient): ToolSet {
  const memoryTypes = [
    "profile",
    "preferences",
    "entities",
    "events",
    "identity",
    "soul",
    "cases",
    "trajectories",
    "experiences",
    "tools",
    "skills",
  ] as const;
  return {
    memory_recall: tool({
      description: "Recall this synthesis session's bank.",
      inputSchema: z.object({
        query: z.string().min(1),
        max_tokens: z.number().int().positive().optional(),
      }),
      execute: ({ query, max_tokens }) => memory.recall(query, max_tokens),
    }),
    memory_upsert: tool({
      description: "Upsert an OKF memory in this synthesis session's bank.",
      inputSchema: z.object({
        batch_id: z.string().min(1),
        document_id: z.string().min(1),
        content: z.string().min(1),
        memory_type: z.enum(memoryTypes),
        title: z.string().optional(),
        tags: z.array(z.string()).optional(),
        evidence_ids: evidenceIdsSchema,
        lease_owner: z.string().min(1),
      }),
      execute: (input) =>
        memory.upsert({
          document: {
            documentId: input.document_id,
            content: input.content,
            memoryType: input.memory_type,
            ...(input.title === undefined ? {} : { title: input.title }),
            ...(input.tags === undefined ? {} : { tags: input.tags }),
          },
          batchId: input.batch_id,
          evidenceIds: input.evidence_ids,
          leaseOwner: input.lease_owner,
        }),
    }),
    memory_supersede: tool({
      description: "Supersede an older memory in this synthesis session's bank.",
      inputSchema: z.object({
        batch_id: z.string().min(1),
        previous_memory_id: z.string().min(1),
        document_id: z.string().min(1),
        content: z.string().min(1),
        memory_type: z.enum(memoryTypes),
        evidence_ids: evidenceIdsSchema,
        lease_owner: z.string().min(1),
      }),
      execute: (input) =>
        memory.upsert({
          document: {
            documentId: input.document_id,
            content: input.content,
            memoryType: input.memory_type,
            supersedesMemoryId: input.previous_memory_id,
          },
          batchId: input.batch_id,
          evidenceIds: input.evidence_ids,
          leaseOwner: input.lease_owner,
        }),
    }),
    memory_forget: tool({
      description: "Forget a superseded memory under this synthesis batch's exact worker lease.",
      inputSchema: z.object({
        batch_id: z.string().min(1),
        document_id: z.string().min(1),
        evidence_ids: evidenceIdsSchema,
        lease_owner: z.string().min(1),
      }),
      execute: (input) =>
        memory.forget({
          batchId: input.batch_id,
          documentId: input.document_id,
          evidenceIds: input.evidence_ids,
          leaseOwner: input.lease_owner,
        }),
    }),
    finish_synthesis: tool({
      description: "Durably finish a synthesis batch after mutations or a cited no-op.",
      inputSchema: z.object({
        batch_id: z.string().min(1),
        evidence_ids: evidenceIdsSchema,
        lease_owner: z.string().min(1),
        outcome: z.enum(["mutated", "noop"]),
        reason: z.string().min(1),
      }),
      execute: (input) =>
        memory.finish({
          batchId: input.batch_id,
          evidenceIds: input.evidence_ids,
          leaseOwner: input.lease_owner,
          outcome: input.outcome,
          reason: input.reason,
        }),
    }),
  } satisfies ToolSet;
}
