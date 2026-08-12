import { afterEach, describe, expect, it, vi } from "vitest";
import { GitHubSourceControlProvider } from "./github.js";

afterEach(() => vi.unstubAllGlobals());

describe("GitHubSourceControlProvider", () => {
  it("creates a review branch, commits files, and opens a pull request", async () => {
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET", ...(typeof init?.body === "string" ? { body: init.body } : {}) });
      if (url.includes("/git/ref/heads/main")) return Response.json({ object: { sha: "base-sha" } });
      if (url.endsWith("/pulls")) return Response.json({ number: 42, html_url: "https://github.test/acme/openbot/pull/42", state: "open", merged: false });
      return Response.json({ ok: true });
    }));
    const provider = new GitHubSourceControlProvider({ repository: "acme/openbot", token: "secret-token" });
    const result = await provider.publishPullRequest({ branch: "openbot/agent-scout", baseBranch: "main", title: "Add scout", body: "Generated", files: [{ path: "configuration/agents/scout.ts", content: "export const POST = () => Response.json({});" }] }, { requestId: "test" });
    expect(result).toMatchObject({ id: "42", branch: "openbot/agent-scout", status: "open" });
    expect(calls.map(({ method }) => method)).toEqual(["GET", "POST", "PUT", "POST"]);
    expect(calls[2]?.body).toContain(Buffer.from("export const POST = () => Response.json({});").toString("base64"));
  });
});
