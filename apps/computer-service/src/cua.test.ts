import {
  ActionCompletion,
  ActionEffect,
  DriverError,
  VerificationStatus,
  type CuaDriverLike,
} from "@trycua/cua-driver";
import { CuaActionCompletion } from "@tryopenbot/computer-service-proto";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { callCuaTool, cuaTesting, listCuaTools, shutdownCuaWorkers } from "./cua.js";

afterEach(async () => {
  await shutdownCuaWorkers();
  cuaTesting.reset();
});

function fakeDriver(overrides: Partial<CuaDriverLike> = {}): CuaDriverLike {
  return {
    isAvailable: () => true,
    listToolsJson: vi.fn(async () =>
      JSON.stringify({
        capability_version: "1",
        tools: [
          { name: "click", description: "Click", inputSchema: { type: "object" } },
          { name: "get_desktop_state", description: "Observe", inputSchema: { type: "object" } },
        ],
      }),
    ),
    callTool: vi.fn(async () => ({
      text: "done",
      images: [{ mimeType: "image/png", dataBase64: Buffer.from("image").toString("base64") }],
      structuredJson: '{"ok":true}',
      isError: false,
      degraded: true,
      rawJson: '{"raw":true}',
      action: { effect: 0, route: 1 },
      verification: {
        status: VerificationStatus.Satisfied,
        stable: true,
        elapsedMs: 1n,
        samples: 2n,
        predicates: [],
      },
    })),
    shutdown: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as CuaDriverLike;
}

describe("Cua worker routing", () => {
  it("keeps exact catalog names and separate workers per agent", async () => {
    const created: string[] = [];
    cuaTesting.reset(async (agentId) => {
      created.push(agentId);
      return fakeDriver();
    });

    await expect(listCuaTools("first-agent")).resolves.toEqual([
      { name: "click", description: "Click", inputSchema: { type: "object" } },
      { name: "get_desktop_state", description: "Observe", inputSchema: { type: "object" } },
    ]);
    await listCuaTools("first-agent");
    await listCuaTools("second-agent");

    expect(created).toEqual(["first-agent", "second-agent"]);
  });

  it("evicts an initialization failure so the next request retries", async () => {
    let attempts = 0;
    cuaTesting.reset(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("not ready");
      return fakeDriver();
    });

    await expect(listCuaTools("agent")).rejects.toThrow("not ready");
    await expect(listCuaTools("agent")).resolves.toHaveLength(2);
    expect(attempts).toBe(2);
  });

  it("preserves text, images, JSON, verification, degradation, and completion", async () => {
    cuaTesting.reset(async () => fakeDriver());
    const result = await callCuaTool("agent", "get_desktop_state", "{}");

    expect(result.content.map((item) => item.content.case)).toEqual(["text", "image"]);
    expect(
      result.content[1]?.content.case === "image" && result.content[1].content.value.data,
    ).toEqual(new TextEncoder().encode("image"));
    expect(result).toMatchObject({
      structuredJson: '{"ok":true}',
      rawJson: '{"raw":true}',
      verified: true,
      degraded: true,
      actionCompletion: CuaActionCompletion.COMPLETED,
    });
    expect(result.verificationJson).toContain('"elapsedMs":"1"');
  });

  it("replaces an idle-expired worker and retries only the not-started call", async () => {
    const expiredCall = vi.fn(async () => ({
      text: "The implicit session ended",
      images: [],
      isError: true,
      errorCode: "session_ended",
      degraded: false,
      rawJson: "",
    }));
    const expiredShutdown = vi.fn(async () => undefined);
    const expired = fakeDriver({ callTool: expiredCall, shutdown: expiredShutdown });
    const freshCall = vi.fn(async () => ({
      text: "captured",
      images: [{ mimeType: "image/png", dataBase64: Buffer.from("desktop").toString("base64") }],
      isError: false,
      degraded: false,
      rawJson: "",
    }));
    const fresh = fakeDriver({ callTool: freshCall });
    let workers = 0;
    cuaTesting.reset(async () => (workers++ === 0 ? expired : fresh));

    await expect(callCuaTool("agent", "get_desktop_state", "{}")).resolves.toMatchObject({
      isError: false,
      actionCompletion: CuaActionCompletion.COMPLETED,
    });
    expect(expiredCall).toHaveBeenCalledTimes(1);
    expect(expiredShutdown).toHaveBeenCalledTimes(1);
    expect(freshCall).toHaveBeenCalledTimes(1);
    expect(workers).toBe(2);
  });

  it("does not retry ordinary tool refusals and reports that no action started", async () => {
    const callTool = vi.fn(async () => ({
      text: "target was refused",
      images: [],
      isError: true,
      errorCode: "target_refused",
      degraded: false,
      rawJson: "",
      action: { effect: ActionEffect.Refused, route: 1 },
    }));
    cuaTesting.reset(async () => fakeDriver({ callTool }));

    await expect(callCuaTool("agent", "click", "{}")).resolves.toMatchObject({
      isError: true,
      errorCode: "target_refused",
      actionCompletion: CuaActionCompletion.NOT_STARTED,
    });
    expect(callTool).toHaveBeenCalledTimes(1);
  });

  it("returns typed driver tool failures as actionable tool results", async () => {
    const callTool = vi.fn(async () => {
      throw new DriverError.Tool({
        tool: "launch_app",
        message: "Application failed to become ready",
        errorCode: "app_not_ready",
      });
    });
    const shutdown = vi.fn(async () => undefined);
    const driver = fakeDriver({ callTool, shutdown });
    cuaTesting.reset(async () => driver);

    await expect(callCuaTool("agent", "launch_app", "{}")).resolves.toMatchObject({
      content: [{ content: { case: "text", value: "Application failed to become ready" } }],
      isError: true,
      errorCode: "app_not_ready",
      actionCompletion: CuaActionCompletion.NOT_STARTED,
    });
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(shutdown).not.toHaveBeenCalled();
  });

  it("forwards cancellation and reports an interrupted action without a blind retry", async () => {
    const callTool = vi.fn(
      async (_name: string, _arguments: string, options?: { signal: AbortSignal }) => {
        expect(options?.signal.aborted).toBe(false);
        throw new DriverError.ActionInterrupted({
          completion: ActionCompletion.Unknown,
          reason: "worker response was lost",
        });
      },
    );
    const driver = fakeDriver({ callTool });
    cuaTesting.reset(async () => driver);
    const controller = new AbortController();

    await expect(callCuaTool("agent", "click", "{}", controller.signal)).resolves.toMatchObject({
      isError: true,
      errorCode: "action_interrupted",
      actionCompletion: CuaActionCompletion.UNKNOWN,
    });
    expect(callTool).toHaveBeenCalledTimes(1);
  });

  it("rejects duplicate catalog names", async () => {
    cuaTesting.reset(async () =>
      fakeDriver({
        listToolsJson: vi.fn(async () =>
          JSON.stringify({
            tools: [
              { name: "click", inputSchema: { type: "object" } },
              { name: "click", inputSchema: { type: "object" } },
            ],
          }),
        ),
      }),
    );
    await expect(listCuaTools("agent")).rejects.toThrow("duplicate tool click");
  });
});
