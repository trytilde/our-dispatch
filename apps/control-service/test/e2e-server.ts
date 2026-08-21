import { serve } from "@hono/node-server";
import type { AuthProvider } from "@tryopenbot/auth-provider";
import { createApp } from "../src/app.js";

const controlPort = Number(process.env.OPENBOT_E2E_CONTROL_PORT || "4100");
const computerApiKey = "e2e-computer-service-api-key-000000";
const agentSetupJobId = "33333333-3333-4333-8333-333333333333";
let agentSetupChecks = 0;

const authProvider: AuthProvider = {
  nativeClientConfiguration: () => ({
    authorizationEndpoint: "https://identity.test/authorize",
    tokenEndpoint: "https://identity.test/token",
    clientId: "e2e-client",
    scope: "openid openbot:control",
  }),
  authorizationUrl: ({ redirectUri }) => {
    const url = new URL("https://identity.test/authorize");
    url.searchParams.set("redirect_uri", redirectUri);
    return url;
  },
  exchangeCode: async () => {
    throw new Error("OAuth exchange is not used by the browser E2E harness");
  },
  refresh: async () => {
    throw new Error("Token refresh is not used by the browser E2E harness");
  },
  verify: async (token) => {
    if (token !== "e2e-owner") throw new Error("Invalid E2E token");
    return {
      subject: "e2e-owner",
      email: "owner@example.com",
      groups: ["e2e-team-member"],
      scope: ["openbot:control"],
    };
  },
};

const app = createApp({
  authProvider,
  devMode: true,
  environment: {
    ...process.env,
    COMPUTER_SERVICE_API_KEY: computerApiKey,
    DEVELOPMENT_SANDBOX_SERVICE_URL: "http://computer-service.test/rpc",
  },
  agentCreation: {
    execute: async (request, options) => {
      if (options.authorization !== `Bearer ${computerApiKey}`)
        return { exitCode: 1, stdout: "", stderr: "Computer service API key required" };
      const script = request.arguments.at(-1) ?? "";
      if (!script.includes("source /workspace/.openbot/development/profile.sh"))
        return {
          exitCode: 1,
          stdout: "",
          stderr: "Trusted development profile was not loaded",
        };
      agentSetupChecks = 0;
      return { exitCode: 0, stderr: "", stdout: "", jobId: agentSetupJobId, running: true };
    },
    awaitExecution: async (_request, options) => {
      if (options.authorization !== `Bearer ${computerApiKey}`)
        return { exitCode: 1, stdout: "", stderr: "Computer service API key required" };
      agentSetupChecks += 1;
      if (agentSetupChecks < 7)
        return {
          exitCode: 0,
          stderr: "",
          stdout: "",
          jobId: agentSetupJobId,
          running: true,
        };
      return {
        exitCode: 0,
        stderr: "",
        stdout: '{"ok":true,"command":"new-agent","agent":{"id":"reviewer","name":"Reviewer"}}\n',
        jobId: agentSetupJobId,
        running: false,
      };
    },
  },
});
serve({
  fetch: app.fetch,
  hostname: "127.0.0.1",
  port: controlPort,
});
