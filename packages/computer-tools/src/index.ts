import { Buffer } from "node:buffer";
import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import { ComputerService } from "@tryopenbot/computer-service-proto";
import { tool } from "ai";
import { z } from "zod";

type ResolvableValue = string | (() => string | Promise<string>);

/** Binds a reusable computer tool to one agent without exposing its identity to the model. */
export interface ComputerToolOptions {
  agentId: string;
  baseUrl?: ResolvableValue;
  apiKey?: ResolvableValue;
}

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

export function createBashTool(options: ComputerToolOptions) {
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

export function createAwaitShellTool(options: ComputerToolOptions) {
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

export function createReadFileTool(options: ComputerToolOptions) {
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

export function createWriteFileTool(options: ComputerToolOptions) {
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

export function createCopyToComputerTool(options: ComputerToolOptions) {
  return tool({
    description: "Copy binary data into a file on the shared computer using base64 transfer.",
    inputSchema: z.object({ path: z.string().min(1), content_base64: z.string().min(1) }),
    execute: async ({ path, content_base64 }, execution) => {
      const content = Buffer.from(content_base64, "base64");
      if (content.toString("base64").replace(/=+$/, "") !== content_base64.replace(/=+$/, ""))
        throw new Error("content_base64 must be valid base64");
      const response = await (
        await service(options)
      ).writeFile(
        { agentId: options.agentId, path, content, mode: 0 },
        await callOptions(options, execution.abortSignal),
      );
      return { bytes_written: Number(response.bytesWritten) };
    },
  });
}

export function createCopyFromComputerTool(options: ComputerToolOptions) {
  return tool({
    description: "Copy a binary file from the shared computer as base64 data.",
    inputSchema: z.object({ path: z.string().min(1) }),
    execute: async ({ path }, execution) => {
      const response = await (
        await service(options)
      ).readFile(
        { agentId: options.agentId, path },
        await callOptions(options, execution.abortSignal),
      );
      return {
        content_base64: Buffer.from(response.content).toString("base64"),
        bytes_read: response.content.byteLength,
      };
    },
  });
}

export function createGlobTool(options: ComputerToolOptions) {
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

export function createGrepTool(options: ComputerToolOptions) {
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

export function createScreenshotTool(options: ComputerToolOptions) {
  return tool({
    description: "Capture the current shared computer desktop as a PNG image.",
    inputSchema: z.object({}),
    execute: async (_input, execution) => {
      const response = await (
        await service(options)
      ).screenshot({ agentId: options.agentId }, await callOptions(options, execution.abortSignal));
      return { media_type: "image/png", data: Buffer.from(response.png).toString("base64") };
    },
  });
}
