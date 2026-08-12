import { describe, expect, it } from "vitest";
import { repositoryDigest, validateConfig, type OpenBotConfig } from "./index.js";

const config: OpenBotConfig = {
  providers: { directory: "configuration/providers", ai: "openai", agents: "tilde-agents", chat: "tilde-chatkit", skills: "tilde-skills", sandbox: "auto", environment: "auto", sourceControl: "github", deployment: "vercel" },
  skills: { directory: "configuration/skills", registryName: "OpenBot" },
  agents: { directory: "configuration/agents", routePrefix: "/api/agents" },
  sandbox: { assetsDirectory: "configuration/sandbox/assets", bootstrap: "configuration/sandbox/bootstrap.sh", secretsManifest: "configuration/sandbox/secrets.example.yaml" },
  publishing: { mode: "pull-request", deploymentBranch: "main" },
};

describe("repository configuration", () => {
  it("validates the default contract", () => expect(validateConfig(config)).toEqual([]));
  it("rejects paths outside the repository", () => expect(validateConfig({ ...config, skills: { ...config.skills, directory: "../skills" } })).toContain("Configuration path must stay inside the repository: ../skills"));
  it("hashes files deterministically", () => expect(repositoryDigest({ b: "2", a: "1" })).toBe(repositoryDigest({ a: "1", b: "2" })));
});
