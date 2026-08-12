import { defineConfig } from "@openbot/config";

export default defineConfig({
  providers: {
    directory: "configuration/providers",
    ai: "openai",
    agents: "tilde-agents",
    chat: "tilde-chatkit",
    skills: "tilde-skills",
    sandbox: "auto",
    environment: "auto",
    sourceControl: "github",
    deployment: "vercel",
  },
  skills: {
    directory: "configuration/skills",
    registryName: "OpenBot",
    registryDescription: "Skills committed with this OpenBot fork.",
  },
  agents: {
    directory: "configuration/agents",
    routePrefix: "/api/agents",
  },
  sandbox: {
    assetsDirectory: "configuration/sandbox/assets",
    bootstrap: "configuration/sandbox/bootstrap.sh",
    secretsManifest: "configuration/sandbox/secrets.example.yaml",
  },
  publishing: {
    mode: "pull-request",
    deploymentBranch: "main",
  },
});
