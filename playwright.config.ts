import { defineConfig } from "@playwright/test";

const controlPort = Number.parseInt(process.env.PLAYWRIGHT_CONTROL_PORT ?? "14100", 10);
const webPort = Number.parseInt(process.env.PLAYWRIGHT_WEB_PORT ?? "14173", 10);
const webOrigin = `http://127.0.0.1:${webPort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL: webOrigin,
    extraHTTPHeaders: { authorization: "Bearer e2e-owner" },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command:
        "pnpm --filter @tryopenbot/control-service exec node --conditions=development --import tsx test/e2e-server.ts",
      env: {
        ...process.env,
        TILDE_ORG_ID: "e2e-org",
        TILDE_TEAM_ID: "e2e-team",
        PUBLIC_ORIGIN: "https://deployed.openbot.test",
        OPENBOT_E2E_CONTROL_PORT: String(controlPort),
        WEB_PORT: String(webPort),
      },
      url: `http://127.0.0.1:${controlPort}/healthz`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `pnpm --filter @tryopenbot/web exec vp dev --host 127.0.0.1 --port ${webPort}`,
      env: { ...process.env, OPENBOT_CONTROL_PORT: String(controlPort) },
      url: `${webOrigin}/`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
