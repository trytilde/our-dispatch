import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { describe, expect, it, vi } from "vite-plus/test";
import { superviseProcesses } from "./processes.js";

class FakeChild extends EventEmitter {
  killed = false;
  kill = vi.fn((signal: NodeJS.Signals) => {
    this.killed = true;
    queueMicrotask(() => this.emit("exit", null, signal));
    return true;
  });
}

describe("process supervision", () => {
  it("treats an interrupt as a healthy shutdown and runs cleanup", async () => {
    const child = new FakeChild();
    const onStop = vi.fn();
    const result = superviseProcesses([child as unknown as ChildProcess], { onStop });

    process.emit("SIGINT");

    await expect(result).resolves.toBe(0);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(onStop).toHaveBeenCalledOnce();
  });

  it("preserves an unexpected child failure while stopping its siblings", async () => {
    const failed = new FakeChild();
    const sibling = new FakeChild();
    const result = superviseProcesses([
      failed as unknown as ChildProcess,
      sibling as unknown as ChildProcess,
    ]);

    failed.emit("exit", 7, null);

    await expect(result).resolves.toBe(7);
    expect(sibling.kill).toHaveBeenCalledWith("SIGTERM");
  });
});
