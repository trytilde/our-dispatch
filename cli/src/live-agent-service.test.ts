import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  clearLiveAgentServiceOrigin,
  readLiveAgentServiceOrigin,
  writeLiveAgentServiceOrigin,
} from "./live-agent-service.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("live agent service state", () => {
  it("round-trips the live lifecycle origin and clears only its own state", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-live-agent-"));
    roots.push(root);

    await writeLiveAgentServiceOrigin(root, "https://local.trytilde-sb.com/");
    await expect(readLiveAgentServiceOrigin(root)).resolves.toBe("https://local.trytilde-sb.com");
    await clearLiveAgentServiceOrigin(root);
    await expect(readLiveAgentServiceOrigin(root)).resolves.toBeUndefined();
  });

  it("rejects stale state owned by a process that is no longer running", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-live-agent-"));
    roots.push(root);
    await writeLiveAgentServiceOrigin(root, "https://local.trytilde-sb.com");
    await writeFile(
      join(root, ".cache/live-agent-service.json"),
      `${JSON.stringify({ origin: "https://stale.example.com", pid: 2_147_483_647 })}\n`,
    );

    await expect(readLiveAgentServiceOrigin(root)).resolves.toBeUndefined();
  });
});
