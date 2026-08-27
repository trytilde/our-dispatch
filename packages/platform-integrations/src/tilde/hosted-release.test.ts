import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { DeploymentOutputs, type DeploymentContext } from "@tryopenbot/runtime-provider";
import { describe, expect, it, vi } from "vite-plus/test";
import { deployHostedOpenBotRelease } from "./hosted-release.js";
import { TildePlatform } from "./index.js";

const execute = promisify(execFile);

describe("deployHostedOpenBotRelease", () => {
  it("uploads content-addressed prebuilt files and finalizes the bound release", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-hosted-release-"));
    const output = join(root, "artifact/.vercel/output");
    await mkdir(output, { recursive: true });
    await writeFile(join(output, "config.json"), '{"version":3}');
    await execute("git", ["init", "-b", "main"], { cwd: root });
    await execute("git", ["config", "user.name", "OpenBot Test"], { cwd: root });
    await execute("git", ["config", "user.email", "openbot@example.test"], { cwd: root });
    await writeFile(join(root, "README.md"), "test\n");
    await execute("git", ["add", "README.md"], { cwd: root });
    await execute("git", ["commit", "-m", "initial"], { cwd: root });
    const requests: Request[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        requests.push(request);
        const path = new URL(request.url).pathname;
        if (path.endsWith("/configuration")) return Response.json({ id: "instance-one" });
        if (path.endsWith("/releases") && request.method === "POST")
          return Response.json({ id: "release-one", status: "uploading" });
        if (path.includes("/files/"))
          return Response.json({ id: "release-one", status: "uploading" });
        if (path.endsWith("/finalize"))
          return Response.json({
            id: "release-one",
            status: "ready",
            deployment_url: "https://ready.test",
          });
        throw new Error(`Unexpected request ${request.method} ${path}`);
      }),
    );
    const platform = new TildePlatform({
      apiKey: "instance-key",
      orgId: "org-one",
      teamId: "team-one",
      baseUrl: "https://tilde.test",
    });
    const context: DeploymentContext = {
      devMode: false,
      repositoryRoot: root,
      environment: { OPENBOT_HOSTED_INSTANCE_ID: "instance-one" },
      configuration: { TILDE_API_KEY: "instance-key", VERCEL_TOKEN: "must-not-forward" },
      inputs: new DeploymentOutputs(),
      report: () => undefined,
    };
    const result = await deployHostedOpenBotRelease(
      platform,
      context,
      "control",
      join(root, "artifact"),
    );
    expect(result.outputs?.["control-service.deployment-url"]).toBe("https://ready.test");
    const configured = (await requests[0]!.clone().json()) as {
      environment: Record<string, string>;
    };
    expect(configured.environment.TILDE_API_KEY).toBe("instance-key");
    expect(configured.environment.VERCEL_TOKEN).toBeUndefined();
    const created = (await requests[1]!.clone().json()) as { files: Array<{ sha1: string }> };
    expect(created.files[0]?.sha1).toMatch(/^[a-f0-9]{40}$/);
    expect(requests.every((request) => request.headers.get("x-api-key") === "instance-key")).toBe(
      true,
    );
  });
});
