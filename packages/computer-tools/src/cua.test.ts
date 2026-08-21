import { describe, expect, it, vi } from "vite-plus/test";
import { cuaToolsTesting } from "./index.js";

const definitions = [
  {
    name: "get_desktop_state",
    description: "Observe the desktop.",
    inputSchemaJson: JSON.stringify({
      type: "object",
      properties: { include_screenshot: { type: "boolean" } },
      additionalProperties: false,
    }),
  },
  {
    name: "click",
    description: "Click a target.",
    inputSchemaJson: JSON.stringify({
      type: "object",
      properties: { target: { type: "string" } },
      required: ["target"],
    }),
  },
] as const;

function result() {
  return {
    content: [
      { content: { case: "text" as const, value: "done" } },
      {
        content: {
          case: "image" as const,
          value: { data: Uint8Array.from([1, 2, 3]), mediaType: "image/png" },
        },
      },
    ],
    structuredJson: '{"target":"button"}',
    rawJson: '{"native":true}',
    isError: true,
    errorCode: "action_interrupted",
    verified: false,
    degraded: true,
    actionCompletion: 3,
    actionJson: '{"kind":"click"}',
    verificationJson: '{"status":"unknown"}',
  };
}

describe("Cua runtime tools", () => {
  it("preserves the exact catalog names and runtime JSON Schemas", async () => {
    const tools = await cuaToolsTesting.buildCuaTools({
      definitions,
      uploadMedia: vi.fn(),
      call: vi.fn(),
    });

    expect(Object.keys(tools)).toEqual(["get_desktop_state", "click"]);
    const click = tools["click"];
    if (!click) throw new Error("click tool was not generated");
    expect(click.inputSchema).toMatchObject({
      jsonSchema: expect.objectContaining({ required: ["target"] }),
    });
  });

  it("rejects collisions and malformed runtime schemas", async () => {
    await expect(
      cuaToolsTesting.buildCuaTools({
        definitions,
        existingToolNames: ["click"],
        uploadMedia: vi.fn(),
        call: vi.fn(),
      }),
    ).rejects.toThrow("collides with an existing local tool: click");
    await expect(
      cuaToolsTesting.buildCuaTools({
        definitions: [{ ...definitions[0], inputSchemaJson: "[]" }],
        uploadMedia: vi.fn(),
        call: vi.fn(),
      }),
    ).rejects.toThrow("invalid schema for get_desktop_state");
  });

  it("forwards cancellation and preserves ordered media and structured failure state", async () => {
    const uploadMedia = vi.fn(async () => ({
      attachment_id: "attachment-one",
      media_type: "image/png",
      filename: "uploaded.png",
    }));
    const call = vi.fn(async () => result());
    const tools = await cuaToolsTesting.buildCuaTools({ definitions, uploadMedia, call });
    const abortController = new AbortController();
    const execute = tools["click"]?.execute as
      | ((
          input: Record<string, unknown>,
          execution: {
            toolCallId: string;
            messages: never[];
            abortSignal: AbortSignal;
          },
        ) => Promise<unknown>)
      | undefined;
    if (!execute) throw new Error("click tool has no execute function");

    const output = await execute(
      { target: "button" },
      {
        toolCallId: "call-one",
        messages: [],
        abortSignal: abortController.signal,
      },
    );

    expect(call).toHaveBeenCalledWith("click", '{"target":"button"}', abortController.signal);
    expect(uploadMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        bytes: Uint8Array.from([1, 2, 3]),
        mediaType: "image/png",
        filename: "cua-click-1.png",
      }),
    );
    expect(output).toEqual(
      expect.objectContaining({
        content: [
          { type: "text", text: "done" },
          expect.objectContaining({ type: "image", attachment_id: "attachment-one" }),
        ],
        structured: { target: "button" },
        raw: { native: true },
        is_error: true,
        error_code: "action_interrupted",
        degraded: true,
        action_completion: 3,
        verification: { status: "unknown" },
      }),
    );
  });
});
