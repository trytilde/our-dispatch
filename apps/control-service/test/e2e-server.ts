import { serve } from "@hono/node-server";
import type { AuthProvider } from "@tryopenbot/auth-provider";
import { createApp } from "../src/app.js";

const authProvider: AuthProvider = {
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

const app = createApp({ authProvider, devMode: true });
serve({
  fetch: app.fetch,
  hostname: "127.0.0.1",
  port: Number(process.env.OPENBOT_E2E_CONTROL_PORT || "4100"),
});
