import type { MediaDownloader, MediaUploader } from "./attachments.js";
import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import type { Tool } from "@ai-sdk/provider-utils";
import { ComputerService } from "@tryopenbot/computer-service-proto";
import { jsonSchema, tool, type ToolSet } from "ai";
import { z } from "zod";

type ResolvableValue = string | (() => string | Promise<string>);

/** Binds a reusable computer tool to one agent without exposing its identity to the model. */
export interface ComputerToolOptions {
  agentId: string;
  baseUrl?: ResolvableValue;
  apiKey?: ResolvableValue;
}

export type UploadingComputerToolOptions = ComputerToolOptions & { uploadMedia: MediaUploader };
type DownloadingComputerToolOptions = ComputerToolOptions & { downloadMedia: MediaDownloader };

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for computer tools`);
  return value;
}

async function resolveValue(
  value: ResolvableValue | undefined,
  environmentName: string,
): Promise<string> {
  return value === undefined
    ? requiredEnvironment(environmentName)
    : typeof value === "function"
      ? value()
      : value;
}

async function service(options: ComputerToolOptions) {
  return createClient(
    ComputerService,
    createConnectTransport({
      baseUrl: await resolveValue(options.baseUrl, "COMPUTER_SERVICE_URL"),
      httpVersion: "1.1",
    }),
  );
}

async function callOptions(options: ComputerToolOptions, signal?: AbortSignal) {
  return {
    headers: {
      authorization: `Bearer ${await resolveValue(options.apiKey, "COMPUTER_SERVICE_API_KEY")}`,
    },
    ...(signal ? { signal } : {}),
  };
}

export function createBashTool(options: ComputerToolOptions): Tool {
  return tool({
    description:
      "Run a Bash login shell on the shared computer. It starts in this agent's directory by default, but may inspect and administer the wider system.",
    inputSchema: z.object({
      command: z.string().min(1),
      cwd: z.string().optional(),
      timeout_ms: z.number().int().positive().max(1_200_000).optional(),
      background: z.boolean().optional(),
    }),
    execute: async (input, execution) =>
      (await service(options)).exec(
        {
          agentId: options.agentId,
          command: "bash",
          arguments: ["-lc", input.command],
          cwd: input.cwd ?? "",
          timeoutMilliseconds: input.timeout_ms ?? 0,
          background: input.background ?? false,
        },
        await callOptions(options, execution.abortSignal),
      ),
  });
}

export function createAwaitShellTool(options: ComputerToolOptions): Tool {
  return tool({
    description: "Wait for a background Bash job and return its current output and status.",
    inputSchema: z.object({
      job_id: z.string().uuid(),
      timeout_ms: z.number().int().min(0).max(120_000).optional(),
    }),
    execute: async (input, execution) =>
      (await service(options)).awaitExec(
        {
          agentId: options.agentId,
          jobId: input.job_id,
          timeoutMilliseconds: input.timeout_ms ?? 30_000,
        },
        await callOptions(options, execution.abortSignal),
      ),
  });
}

export function createReadFileTool(options: ComputerToolOptions): Tool {
  return tool({
    description: "Read a UTF-8 file visible to this agent on the computer.",
    inputSchema: z.object({ path: z.string().min(1) }),
    execute: async ({ path }, execution) => {
      const response = await (
        await service(options)
      ).readFile(
        { agentId: options.agentId, path },
        await callOptions(options, execution.abortSignal),
      );
      return { content: new TextDecoder().decode(response.content) };
    },
  });
}

export function createWriteFileTool(options: ComputerToolOptions): Tool {
  return tool({
    description: "Write UTF-8 text to a file writable by this agent on the computer.",
    inputSchema: z.object({ path: z.string().min(1), content: z.string() }),
    execute: async ({ path, content }, execution) => {
      const response = await (
        await service(options)
      ).writeFile(
        {
          agentId: options.agentId,
          path,
          content: new TextEncoder().encode(content),
          mode: 0,
        },
        await callOptions(options, execution.abortSignal),
      );
      return { bytes_written: Number(response.bytesWritten) };
    },
  });
}

export function createCopyToComputerTool(options: DownloadingComputerToolOptions): Tool {
  return tool({
    description: "Copy a Tilde session attachment into a file on the shared computer.",
    inputSchema: z.object({ path: z.string().min(1), attachment_id: z.string().uuid() }),
    execute: async ({ path, attachment_id }, execution) => {
      const media = await options.downloadMedia(attachment_id);
      const response = await (
        await service(options)
      ).writeFile(
        { agentId: options.agentId, path, content: media.bytes, mode: 0 },
        await callOptions(options, execution.abortSignal),
      );
      return { bytes_written: Number(response.bytesWritten) };
    },
  });
}

export function createCopyFromComputerTool(options: UploadingComputerToolOptions): Tool {
  return tool({
    description: "Copy a binary file from the shared computer into a Tilde session attachment.",
    inputSchema: z.object({ path: z.string().min(1) }),
    execute: async ({ path }, execution) => {
      const response = await (
        await service(options)
      ).readFile(
        { agentId: options.agentId, path },
        await callOptions(options, execution.abortSignal),
      );
      const uploaded = await options.uploadMedia({
        bytes: response.content,
        filename: path.split(/[\\/]/).pop() || "attachment.bin",
        mediaType: "application/octet-stream",
      });
      return { ...uploaded, bytes_read: response.content.byteLength };
    },
  });
}

export function createGlobTool(options: ComputerToolOptions): Tool {
  return tool({
    description:
      "List files matching a glob from any directory visible to this agent on the computer.",
    inputSchema: z.object({ pattern: z.string().min(1), path: z.string().optional() }),
    execute: async ({ pattern, path }, execution) =>
      (await service(options)).exec(
        {
          agentId: options.agentId,
          command: "rg",
          arguments: ["--files", "--hidden", "--glob", "!.git", "--glob", pattern, path ?? "."],
          cwd: "",
          timeoutMilliseconds: 120_000,
        },
        await callOptions(options, execution.abortSignal),
      ),
  });
}

export function createGrepTool(options: ComputerToolOptions): Tool {
  return tool({
    description: "Search file contents under any directory visible to this agent on the computer.",
    inputSchema: z.object({
      pattern: z.string().min(1),
      path: z.string().optional(),
      glob: z.string().optional(),
    }),
    execute: async ({ pattern, path, glob }, execution) =>
      (await service(options)).exec(
        {
          agentId: options.agentId,
          command: "rg",
          arguments: [
            "--line-number",
            "--no-heading",
            "--color",
            "never",
            "--hidden",
            "--glob",
            "!.git",
            ...(glob ? ["--glob", glob] : []),
            pattern,
            path ?? ".",
          ],
          cwd: "",
          timeoutMilliseconds: 120_000,
        },
        await callOptions(options, execution.abortSignal),
      ),
  });
}

export function createScreenshotTool(options: UploadingComputerToolOptions): Tool {
  return tool({
    description: "Capture the current shared computer desktop as a PNG image.",
    inputSchema: z.object({}),
    execute: async (_input, execution) => {
      const response = await (
        await service(options)
      ).screenshot({ agentId: options.agentId }, await callOptions(options, execution.abortSignal));
      return await mediaResult(options, {
        bytes: response.png,
        mediaType: "image/png",
        filename: `screenshot-${options.agentId}.png`,
      });
    },
  });
}

/**
 * Loads the runtime Cua catalog and exposes every entry as an identically named local tool.
 * Catalog loading is deliberately eager so an agent never starts with a partial GUI surface.
 */
export async function createCuaTools(
  options: UploadingComputerToolOptions & { existingToolNames?: Iterable<string> },
): Promise<ToolSet> {
  const client = await service(options);
  let response: Awaited<ReturnType<typeof client.listCuaTools>>;
  try {
    response = await client.listCuaTools({ agentId: options.agentId }, await callOptions(options));
  } catch (error) {
    throw new Error(
      `Cua tool catalog is unavailable: ${error instanceof Error ? error.message : "unknown error"}`,
      { cause: error },
    );
  }

  return buildCuaTools({
    definitions: response.tools,
    existingToolNames: options.existingToolNames,
    uploadMedia: options.uploadMedia,
    call: async (name, argumentsJson, signal) =>
      client.callCuaTool(
        { agentId: options.agentId, name, argumentsJson },
        await callOptions(options, signal),
      ),
  });
}

interface CuaToolDefinition {
  name: string;
  description: string;
  inputSchemaJson: string;
}

interface CuaToolCallResult {
  content: Array<{
    content:
      | { case: "text"; value: string }
      | { case: "image"; value: { data: Uint8Array; mediaType: string } }
      | { case: undefined; value?: undefined };
  }>;
  structuredJson: string;
  rawJson: string;
  isError: boolean;
  errorCode: string;
  verified: boolean;
  degraded: boolean;
  actionCompletion: number;
  actionJson: string;
  verificationJson: string;
}

async function buildCuaTools(options: {
  definitions: readonly CuaToolDefinition[];
  existingToolNames?: Iterable<string>;
  uploadMedia: MediaUploader;
  call: (name: string, argumentsJson: string, signal?: AbortSignal) => Promise<CuaToolCallResult>;
}): Promise<ToolSet> {
  const names = new Set(options.existingToolNames ?? []);
  const tools: ToolSet = {};
  for (const definition of options.definitions) {
    if (!definition.name) throw new Error("Cua tool catalog contains an empty tool name");
    if (names.has(definition.name))
      throw new Error(`Cua tool name collides with an existing local tool: ${definition.name}`);
    names.add(definition.name);
    const schema = parseJsonObject(definition.inputSchemaJson, `schema for ${definition.name}`);
    tools[definition.name] = tool({
      description: definition.description,
      inputSchema: jsonSchema<Record<string, unknown>>(schema),
      execute: async (input, execution) => {
        const normalizedInput = omitOptionalEmptyStrings(input, schema);
        const result = await options.call(
          definition.name,
          JSON.stringify(normalizedInput),
          execution.abortSignal,
        );
        const content = [];
        let imageIndex = 0;
        for (const item of result.content) {
          if (item.content.case === "text") {
            content.push({ type: "text", text: item.content.value });
          } else if (item.content.case === "image") {
            imageIndex += 1;
            const uploaded = await options.uploadMedia({
              bytes: item.content.value.data,
              mediaType: item.content.value.mediaType,
              filename: `cua-${definition.name}-${imageIndex}.${imageExtension(item.content.value.mediaType)}`,
            });
            content.push({ type: "image", ...uploaded });
          }
        }
        return {
          content,
          structured: parseOptionalJson(result.structuredJson),
          raw: parseOptionalJson(result.rawJson),
          is_error: result.isError,
          error_code: result.errorCode || undefined,
          verified: result.verified,
          degraded: result.degraded,
          action_completion: result.actionCompletion,
          action: parseOptionalJson(result.actionJson),
          verification: parseOptionalJson(result.verificationJson),
        };
      },
    });
  }
  return tools;
}

function omitOptionalEmptyStrings(
  input: Record<string, unknown>,
  schema: Record<string, unknown>,
): Record<string, unknown> {
  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((value): value is string => typeof value === "string")
      : [],
  );
  return Object.fromEntries(
    Object.entries(input).filter(
      ([name, value]) => value !== undefined && (value !== "" || required.has(name)),
    ),
  );
}

/** @internal Test seam for runtime catalog conversion without a network service. */
export const cuaToolsTesting = { buildCuaTools };

function parseJsonObject(raw: string, label: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw) as unknown;
    if (typeof value === "object" && value !== null && !Array.isArray(value))
      return value as Record<string, unknown>;
  } catch {
    // Use the shared catalog error below.
  }
  throw new Error(`Cua tool catalog contains invalid ${label}`);
}

function parseOptionalJson(raw: string): unknown {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function imageExtension(mediaType: string): string {
  if (mediaType === "image/jpeg") return "jpg";
  if (mediaType === "image/webp") return "webp";
  return "png";
}

async function mediaResult(
  options: UploadingComputerToolOptions,
  media: { bytes: Uint8Array; mediaType: string; filename: string },
) {
  const uploaded = await options.uploadMedia(media);
  return {
    attachment_id: uploaded.attachment_id,
    media_type: uploaded.media_type,
    filename: uploaded.filename,
  };
}

export {
  createTildeMediaUploader,
  createTildeMediaDownloader,
  createTildeAttachmentMessageHandlers,
  type MediaUpload,
  type MediaDownloader,
  type MediaUploader,
  type TildeAttachmentTarget,
  type UploadedMedia,
} from "./attachments.js";
