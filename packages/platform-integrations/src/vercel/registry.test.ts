import { describe, expect, it, vi } from "vite-plus/test";
import {
  resolveVercelProjectCredentials,
  resolveVercelRegistryIdentity,
  VercelPlatformError,
} from "./registry.js";

describe("Vercel registry helpers", () => {
  it("resolves a team registry namespace", async () => {
    const request = vi.fn(async () => Response.json({ id: "team-id", slug: "tryopenbot" }));

    await expect(
      resolveVercelRegistryIdentity({
        token: "secret",
        project: "agents",
        teamId: "team-id",
        request,
      }),
    ).resolves.toEqual({
      repository: "vcr.vercel.com/tryopenbot/agents/openbot-computer",
      username: "team-id",
    });
    expect(request).toHaveBeenCalledWith("https://api.vercel.com/v2/teams/team-id", {
      headers: { Authorization: "Bearer secret" },
    });
  });

  it("reports missing platform configuration with a typed error", async () => {
    await expect(resolveVercelRegistryIdentity({ project: "agents" })).rejects.toMatchObject({
      code: "invalid_configuration",
      message: "VERCEL_TOKEN is required to resolve the Vercel Container Registry",
    } satisfies Partial<VercelPlatformError>);
  });

  it("resolves explicit SDK credentials from the configured agent project", async () => {
    const request = vi.fn(async () => Response.json({ id: "project-id", accountId: "team-id" }));

    await expect(
      resolveVercelProjectCredentials({
        token: "secret",
        project: "agents",
        teamId: "team-id",
        request,
      }),
    ).resolves.toEqual({ token: "secret", projectId: "project-id", teamId: "team-id" });
    expect(request).toHaveBeenCalledWith(
      new URL("https://api.vercel.com/v9/projects/agents?teamId=team-id"),
      { headers: { Authorization: "Bearer secret" } },
    );
  });
});
