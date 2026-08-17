import { describe, expect, it } from "vite-plus/test";
import { resolve } from "node:path";
import { repositoryRoot } from "../paths.js";
import {
  developmentServerCommand,
  developmentServerEnvironment,
  developmentTunnelOptions,
} from "./dev.js";

describe("development server command", () => {
  it("uses an absolute entrypoint when the tunnel changes the child cwd", () => {
    expect(developmentServerCommand()).toEqual([
      "pnpm",
      ["exec", "tsx", "watch", resolve(repositoryRoot, "cli/src/index.tsx"), "_serve"],
    ]);
  });
});

describe("development server environment", () => {
  it("resolves workspace packages through their source exports", () => {
    expect(developmentServerEnvironment({ PORT: "4100" })).toEqual({
      PORT: "4100",
      NODE_OPTIONS: "--conditions=development",
    });
  });

  it("preserves existing Node options", () => {
    expect(developmentServerEnvironment({ NODE_OPTIONS: "--trace-warnings" }).NODE_OPTIONS).toBe(
      "--trace-warnings --conditions=development",
    );
  });

  it("wraps the development server in a Tilde tunnel when configured", () => {
    expect(
      developmentTunnelOptions("pnpm", ["exec", "tsx", "watch"], {
        PORT: "4100",
        TILDE_API_KEY: "secret",
        TILDE_BASE_URL: "https://tilde.test",
        TILDE_ORG_ID: "org-one",
        TILDE_TEAM_ID: "team-one",
      }),
    ).toEqual({
      baseUrl: "https://tilde.test",
      apiKey: "secret",
      orgId: "org-one",
      teamId: "team-one",
      command: ["pnpm", "exec", "tsx", "watch"],
      port: 4100,
    });
  });

  it("starts directly when Tilde is not configured", () => {
    expect(developmentTunnelOptions("pnpm", [], { PORT: "4100" })).toBeUndefined();
  });
});
