import type { NormalizedConfig } from "./config";
import { requestJson } from "./internal/fetch-client";
import { pathWithParams, teamPath } from "./internal/paths";
import type { JsonObject, JsonValue } from "./tools";

const BANKS = "/api/v1/team/{team_id}/memory/banks";
const BANK = `${BANKS}/{bank_id}`;
const PERSONAL_BANKS = "/api/v1/user/{user_id}/memory/banks";
const PERSONAL_BANK = `${PERSONAL_BANKS}/{bank_id}`;

export type MemoryType =
  | "profile"
  | "preferences"
  | "entities"
  | "events"
  | "identity"
  | "soul"
  | "cases"
  | "trajectories"
  | "experiences"
  | "tools"
  | "skills";

export interface MemoryBankSummary {
  id: string;
  orgId: string;
  teamId?: string | null;
  agentId?: string | null;
  createdByUserId?: string | null;
  name: string;
  description?: string | null;
  provider: string;
  providerBankId: string;
  status: "provisioning" | "active" | "error" | "deleting";
  statusMessage?: string | null;
  synthesizerAgentId?: string | null;
  synthesizerTeamId?: string | null;
  synthesisSessionId?: string | null;
  toolGroupInstanceId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type MemoryDocumentRecord = JsonObject & {
  memory_id?: string;
  document_id?: string;
  content?: string;
  metadata?: JsonValue;
  metadata_json?: string;
};

export interface MemoryDocumentInput {
  documentId: string;
  content: string;
  memoryType: MemoryType;
  title?: string;
  importance?: number;
  metadata?: JsonObject;
  tags?: string[];
  supersedesMemoryId?: string;
  evidenceIds?: string[];
  subjects?: string[];
}

export interface MemorySynthesisMutationBindingInput {
  batchId: string;
  evidenceIds: string[];
  leaseOwner: string;
}

export interface MemorySynthesisUpsertInput extends MemorySynthesisMutationBindingInput {
  document: MemoryDocumentInput;
}

export interface MemorySourceBindingInput {
  sourceKind: string;
  sourceId: string;
  memoryBankIds: string[];
}

export class MemoryBankClient {
  readonly #config: NormalizedConfig;
  readonly id: string;
  readonly #root: string;

  constructor(config: NormalizedConfig, bankId: string, ownerUserId?: string) {
    if (!bankId.trim()) throw new TypeError("bankId is required");
    if (ownerUserId !== undefined && !ownerUserId.trim())
      throw new TypeError("ownerUserId must not be empty");
    this.#config = config;
    this.id = bankId;
    this.#root = ownerUserId
      ? pathWithParams(PERSONAL_BANK, { user_id: ownerUserId, bank_id: bankId })
      : pathWithParams(teamPath(config, BANK), { bank_id: bankId });
  }

  recall(query: string, maxTokens?: number): Promise<JsonValue> {
    if (!query.trim()) throw new TypeError("query is required");
    return this.#operation("recall", {
      query,
      ...(maxTokens === undefined ? {} : { max_tokens: maxTokens }),
    });
  }

  upsert(document: MemoryDocumentInput): Promise<JsonValue> {
    return this.#operation("retain", { document: encodeDocument(document) });
  }

  listDocuments(options: { limit?: number; offset?: number; query?: string } = {}): Promise<{
    items: MemoryDocumentRecord[];
    total: number;
    limit: number;
    offset: number;
  }> {
    return requestJson(this.#config, {
      path: `${this.#root}/documents`,
      query: {
        limit: options.limit ?? 100,
        offset: options.offset ?? 0,
        q: options.query,
      },
    });
  }

  document(documentId: string): Promise<MemoryDocumentRecord> {
    requireDocumentId(documentId);
    return requestJson(this.#config, {
      path: `${this.#root}/documents/${encodeURIComponent(documentId)}`,
    });
  }

  supersede(previousMemoryId: string, document: MemoryDocumentInput): Promise<JsonValue> {
    requireDocumentId(previousMemoryId);
    return this.upsert({ ...document, supersedesMemoryId: previousMemoryId });
  }

  async forget(documentId: string): Promise<void> {
    requireDocumentId(documentId);
    await requestJson<void>(this.#config, {
      method: "DELETE",
      path: `${this.#root}/documents`,
      body: { document_id: documentId },
    });
  }

  sources(): Promise<JsonValue> {
    return requestJson(this.#config, { path: `${this.#root}/source-bindings` });
  }

  async #operation(operation: string, body: JsonObject): Promise<JsonValue> {
    const response = await requestJson<{ result: JsonValue }>(this.#config, {
      method: "POST",
      path: `${this.#root}/${operation}`,
      body,
    });
    return response.result;
  }
}

export class MemoryClient {
  readonly #config: NormalizedConfig;

  constructor(config: NormalizedConfig) {
    this.#config = config;
  }

  bank(bankId: string): MemoryBankClient {
    return new MemoryBankClient(this.#config, bankId);
  }

  /** Personal bank management requires an authenticated owner credential. */
  personalBank(ownerUserId: string, bankId: string): MemoryBankClient {
    return new MemoryBankClient(this.#config, bankId, ownerUserId);
  }

  synthesisSession(sessionId: string): MemorySynthesisSessionClient {
    return new MemorySynthesisSessionClient(this.#config, sessionId);
  }

  async teamBanks(options: { pageSize?: number; nextPageToken?: string } = {}): Promise<{
    items: MemoryBankSummary[];
    nextPageToken?: string | null;
  }> {
    return this.#listBanks(BANKS, options);
  }

  async visibleBanks(options: { pageSize?: number; nextPageToken?: string } = {}): Promise<{
    items: MemoryBankSummary[];
    nextPageToken?: string | null;
  }> {
    return this.#listBanks(`${BANKS}/visible`, options);
  }

  async personalBanks(
    ownerUserId: string,
    options: { pageSize?: number; nextPageToken?: string } = {},
  ): Promise<{ items: MemoryBankSummary[]; nextPageToken?: string | null }> {
    requireOwnerUserId(ownerUserId);
    return this.#listBanks(
      pathWithParams(PERSONAL_BANKS, { user_id: ownerUserId }),
      options,
      false,
    );
  }

  async createTeamBank(input: {
    name: string;
    description?: string;
    synthesizerAgentId?: string;
  }): Promise<MemoryBankSummary> {
    const bank = await requestJson<RawMemoryBank>(this.#config, {
      method: "POST",
      path: teamPath(this.#config, BANKS),
      body: {
        name: input.name,
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.synthesizerAgentId === undefined
          ? {}
          : { synthesizer_agent_id: input.synthesizerAgentId }),
      },
    });
    return decodeBank(bank);
  }

  async createPersonalBank(input: {
    ownerUserId: string;
    name: string;
    description?: string;
    synthesizerAgentId?: string;
    synthesizerTeamId?: string;
  }): Promise<MemoryBankSummary> {
    requireOwnerUserId(input.ownerUserId);
    if ((input.synthesizerAgentId === undefined) !== (input.synthesizerTeamId === undefined))
      throw new TypeError("synthesizerAgentId and synthesizerTeamId must be supplied together");
    const bank = await requestJson<RawMemoryBank>(this.#config, {
      method: "POST",
      path: pathWithParams(PERSONAL_BANKS, { user_id: input.ownerUserId }),
      body: {
        name: input.name,
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.synthesizerAgentId === undefined
          ? {}
          : {
              synthesizer_agent_id: input.synthesizerAgentId,
              synthesizer_team_id: input.synthesizerTeamId,
            }),
      },
    });
    return decodeBank(bank);
  }

  async assignPersonalSynthesizer(input: {
    ownerUserId: string;
    bankId: string;
    synthesizerAgentId: string;
    synthesizerTeamId: string;
  }): Promise<MemoryBankSummary> {
    const root = personalBankRoot(input.ownerUserId, input.bankId);
    const bank = await requestJson<RawMemoryBank>(this.#config, {
      method: "PUT",
      path: `${root}/synthesizer`,
      body: {
        synthesizer_agent_id: input.synthesizerAgentId,
        synthesizer_team_id: input.synthesizerTeamId,
      },
    });
    return decodeBank(bank);
  }

  async clearPersonalSynthesizer(input: {
    ownerUserId: string;
    bankId: string;
  }): Promise<MemoryBankSummary> {
    const bank = await requestJson<RawMemoryBank>(this.#config, {
      method: "DELETE",
      path: `${personalBankRoot(input.ownerUserId, input.bankId)}/synthesizer`,
    });
    return decodeBank(bank);
  }

  bindSource(input: MemorySourceBindingInput): Promise<JsonValue> {
    return requestJson(this.#config, {
      method: "PUT",
      path: teamPath(this.#config, "/api/v1/team/{team_id}/memory/source-bindings"),
      body: {
        source_kind: input.sourceKind,
        source_id: input.sourceId,
        memory_bank_ids: input.memoryBankIds,
      },
    });
  }

  bindPersonalSource(ownerUserId: string, input: MemorySourceBindingInput): Promise<JsonValue> {
    requireOwnerUserId(ownerUserId);
    return requestJson(this.#config, {
      method: "PUT",
      path: pathWithParams("/api/v1/user/{user_id}/memory/source-bindings", {
        user_id: ownerUserId,
      }),
      body: {
        source_kind: input.sourceKind,
        source_id: input.sourceId,
        memory_bank_ids: input.memoryBankIds,
      },
    });
  }

  retrySource(sourceKind: string, sourceId: string): Promise<JsonValue> {
    return requestJson(this.#config, {
      method: "POST",
      path: teamPath(this.#config, "/api/v1/team/{team_id}/memory/source-bindings/retry"),
      body: { source_kind: sourceKind, source_id: sourceId },
    });
  }

  retryPersonalSource(
    ownerUserId: string,
    sourceKind: string,
    sourceId: string,
  ): Promise<JsonValue> {
    requireOwnerUserId(ownerUserId);
    return requestJson(this.#config, {
      method: "POST",
      path: pathWithParams("/api/v1/user/{user_id}/memory/source-bindings/retry", {
        user_id: ownerUserId,
      }),
      body: { source_kind: sourceKind, source_id: sourceId },
    });
  }

  async #listBanks(
    path: string,
    options: { pageSize?: number; nextPageToken?: string },
    teamScoped = true,
  ): Promise<{ items: MemoryBankSummary[]; nextPageToken?: string | null }> {
    const page = await requestJson<{ items: RawMemoryBank[]; next_page_token?: string | null }>(
      this.#config,
      {
        path: teamScoped ? teamPath(this.#config, path) : path,
        query: { page_size: options.pageSize, next_page_token: options.nextPageToken },
      },
    );
    return { items: page.items.map(decodeBank), nextPageToken: page.next_page_token };
  }
}

/** Bank identity is resolved exclusively from the server-created ChatKit session. */
export class MemorySynthesisSessionClient {
  readonly #config: NormalizedConfig;
  readonly #root: string;

  constructor(config: NormalizedConfig, sessionId: string) {
    if (!sessionId.trim()) throw new TypeError("sessionId is required");
    this.#config = config;
    this.#root = teamPath(
      config,
      `/api/v1/team/{team_id}/memory/synthesis-sessions/${encodeURIComponent(sessionId)}`,
    );
  }

  async upsert(input: MemorySynthesisUpsertInput): Promise<JsonValue> {
    const binding = encodeSynthesisBinding(input);
    const response = await requestJson<{ result: JsonValue }>(this.#config, {
      method: "POST",
      path: `${this.#root}/retain`,
      body: {
        operation: "retain",
        document: encodeDocument({ ...input.document, evidenceIds: input.evidenceIds }),
        binding,
      },
    });
    return response.result;
  }

  async recall(query: string, maxTokens?: number): Promise<JsonValue> {
    if (!query.trim()) throw new TypeError("query is required");
    const response = await requestJson<{ result: JsonValue }>(this.#config, {
      method: "POST",
      path: `${this.#root}/recall`,
      body: { query, ...(maxTokens === undefined ? {} : { max_tokens: maxTokens }) },
    });
    return response.result;
  }

  /** Prove this exact batch is the complete current lease before external inference begins. */
  async validateBatch(input: {
    batchId: string;
    evidenceIds: string[];
    leaseOwner: string;
  }): Promise<void> {
    const binding = encodeSynthesisBinding(input);
    await requestJson<void>(this.#config, {
      method: "POST",
      path: `${this.#root}/validate-batch`,
      body: {
        batch_id: binding.batch_id,
        evidence_ids: binding.evidence_ids,
        lease_owner: binding.lease_owner,
      },
    });
  }

  async forget(input: {
    documentId: string;
    batchId: string;
    evidenceIds: string[];
    leaseOwner: string;
  }): Promise<void> {
    requireDocumentId(input.documentId);
    const binding = encodeSynthesisBinding(input);
    await requestJson<void>(this.#config, {
      method: "DELETE",
      path: `${this.#root}/documents`,
      body: {
        document_id: input.documentId,
        binding,
      },
    });
  }

  finish(input: {
    batchId: string;
    evidenceIds: string[];
    leaseOwner: string;
    outcome: "mutated" | "noop";
    reason: string;
  }): Promise<JsonValue> {
    const binding = encodeSynthesisBinding(input);
    if (input.outcome === "noop" && !input.reason.trim())
      throw new TypeError("noop synthesis requires a reason");
    return requestJson<{ result: JsonValue }>(this.#config, {
      method: "POST",
      path: `${this.#root}/retain`,
      body: {
        operation: "complete",
        binding,
        outcome: input.outcome,
        reason: input.reason,
      },
    }).then((response) => response.result);
  }
}

type RawMemoryBank = {
  id: string;
  org_id: string;
  team_id?: string | null;
  agent_id?: string | null;
  created_by_user_id?: string | null;
  name: string;
  description?: string | null;
  provider: string;
  provider_bank_id: string;
  status: MemoryBankSummary["status"];
  status_message?: string | null;
  synthesizer_agent_id?: string | null;
  synthesizer_team_id?: string | null;
  synthesis_session_id?: string | null;
  tool_group_instance_id?: string | null;
  created_at: string;
  updated_at: string;
};

function decodeBank(bank: RawMemoryBank): MemoryBankSummary {
  return {
    id: bank.id,
    orgId: bank.org_id,
    teamId: bank.team_id,
    agentId: bank.agent_id,
    createdByUserId: bank.created_by_user_id,
    name: bank.name,
    description: bank.description,
    provider: bank.provider,
    providerBankId: bank.provider_bank_id,
    status: bank.status,
    statusMessage: bank.status_message,
    synthesizerAgentId: bank.synthesizer_agent_id,
    synthesizerTeamId: bank.synthesizer_team_id,
    synthesisSessionId: bank.synthesis_session_id,
    toolGroupInstanceId: bank.tool_group_instance_id,
    createdAt: bank.created_at,
    updatedAt: bank.updated_at,
  };
}

function encodeDocument(document: MemoryDocumentInput): JsonObject {
  requireDocumentId(document.documentId);
  if (!document.content.trim()) throw new TypeError("content is required");
  if (
    document.importance !== undefined &&
    (!Number.isFinite(document.importance) || document.importance < 0 || document.importance > 1)
  ) {
    throw new TypeError("importance must be between 0 and 1");
  }
  return {
    document_id: document.documentId,
    content: document.content,
    ...(document.title === undefined ? {} : { title: document.title }),
    memory_type: document.memoryType,
    ...(document.importance === undefined ? {} : { importance: document.importance }),
    relations: {
      ...(document.supersedesMemoryId ? { supersedes_memory_id: document.supersedesMemoryId } : {}),
      evidence_ids: document.evidenceIds ?? [],
      subjects: document.subjects ?? [],
    },
    metadata: document.metadata ?? {},
    tags: document.tags ?? [],
  };
}

function encodeSynthesisBinding(input: MemorySynthesisMutationBindingInput): JsonObject {
  if (!input.batchId.trim()) throw new TypeError("batchId is required");
  if (!input.evidenceIds.length) throw new TypeError("evidenceIds are required");
  if (!input.leaseOwner.trim()) throw new TypeError("leaseOwner is required");
  return {
    batch_id: input.batchId,
    evidence_ids: input.evidenceIds,
    lease_owner: input.leaseOwner,
  };
}

function requireDocumentId(documentId: string): void {
  if (!documentId.trim()) throw new TypeError("documentId is required");
}

function requireOwnerUserId(ownerUserId: string): void {
  if (!ownerUserId.trim()) throw new TypeError("ownerUserId is required");
}

function personalBankRoot(ownerUserId: string, bankId: string): string {
  requireOwnerUserId(ownerUserId);
  if (!bankId.trim()) throw new TypeError("bankId is required");
  return pathWithParams(PERSONAL_BANK, { user_id: ownerUserId, bank_id: bankId });
}
