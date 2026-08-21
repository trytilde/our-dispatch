import { serve } from "@hono/node-server";
import { createApp } from "@tryopenbot/control-service";
import { createAgentServiceApp } from "@tryopenbot/agent-service-provider";
import { Hono } from "hono";
import { loadLocalEnvironment } from "../environment.js";
import { loadDevelopmentConfiguration } from "./dev.js";
import { repositoryRoot } from "../paths.js";

export function parsePort(value: string | undefined): number {
  const port = Number.parseInt(value ?? "4100", 10);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be a valid TCP port");
  }
  return port;
}

export async function runDevelopmentServer(): Promise<void> {
  const environment = await loadLocalEnvironment({ reload: true });
  const port = parsePort(environment.PORT);
  const configuration = await loadDevelopmentConfiguration(environment);
  const combined = new Hono();
  combined.route(
    "/",
    await createAgentServiceApp(repositoryRoot, {
      health: false,
      refreshEnvironment: async () => {
        await loadLocalEnvironment({ reload: true });
      },
    }),
  );
  combined.route(
    "/",
    createApp({
      authProvider: configuration.providers.auth,
      computerProvider: configuration.providers.computer,
      devMode: true,
      environment,
    }),
  );
  await new Promise<void>((resolvePromise, reject) => {
    const server = serve({ fetch: combined.fetch, port, hostname: "127.0.0.1" }, () => {
      console.log(`OpenBot listening at http://127.0.0.1:${port}`);
    });
    const shutdown = (): void => {
      server.close((error) => (error ? reject(error) : resolvePromise()));
    };
    server.once("error", reject);
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}
