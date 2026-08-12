import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  findMarketplaceResources,
  mergeDecryptedEnvironment,
  parseJsonOutput,
  parseOptions,
  parseTildeImportSummary,
  redact,
  renderTildeState,
  sopsEnvironment,
} from "./deploy-prod.js";

describe("deploy-prod", () => {
  it("parses only supported unattended options", () => {
    expect(parseOptions(["--", "--yes", "--resume", "--json"])).toEqual({ yes: true, dryRun: false, resume: true, json: true });
    expect(() => parseOptions(["--force"])).toThrow("Unknown deploy option");
  });

  it("redacts exact secrets and dotenv-shaped credentials", () => {
    const value = redact("token=secret-value OPENAI_API_KEY=sk-example", ["secret-value"]);
    expect(value).not.toContain("secret-value");
    expect(value).not.toContain("sk-example");
    expect(value).toContain("[REDACTED]");
  });

  it("finds Turso resources in evolving Marketplace response envelopes", () => {
    const resources = findMarketplaceResources({ resources: [{ id: "ir_1", name: "openbot-db", integration: { slug: "tursocloud" } }] });
    expect(resources.some((resource) => resource.id === "ir_1")).toBe(true);
  });

  it("merges SOPS dotenv values without overriding explicit environment", () => {
    const target = { VERCEL_TOKEN: "explicit" };
    mergeDecryptedEnvironment("VERCEL_TOKEN=encrypted\nTILDE_TEAM_ID=team-1\n", target);
    expect(target).toEqual({ VERCEL_TOKEN: "explicit", TILDE_TEAM_ID: "team-1" });
  });

  it("parses CLI JSON after package-manager warnings containing JSON fragments", () => {
    const output = 'WARN Unsupported engine: wanted: {"node":"24.x"}\n{\n  "resources": []\n}\n';
    expect(parseJsonOutput(output)).toEqual({ resources: [] });
  });

  it("fully renders the Tilde endpoint for the non-interactive CLI", () => {
    const source = [
      "variables:",
      "  OPENBOT_CHATKIT_ENDPOINT_URL:",
      "    type: string",
      "resources:",
      "  chatkit/agent/openbot-gateway:",
      "    endpointUrl: ${OPENBOT_CHATKIT_ENDPOINT_URL}",
    ].join("\n");
    const rendered = renderTildeState(source, "https://openbot.example/api/tilde/chatkit");
    expect(rendered).not.toContain("variables:");
    expect(rendered).not.toContain("OPENBOT_CHATKIT_ENDPOINT_URL");
    expect(rendered).toContain("https://openbot.example/api/tilde/chatkit");
  });

  it("uses an explicit SOPS profile instead of stale ambient AWS keys", () => {
    const env = sopsEnvironment({
      OPENBOT_SOPS_AWS_PROFILE: "openbot-kms",
      AWS_ACCESS_KEY_ID: "stale",
      AWS_SECRET_ACCESS_KEY: "stale",
      AWS_SESSION_TOKEN: "stale",
    });
    expect(env.AWS_PROFILE).toBe("openbot-kms");
    expect(env.AWS_ACCESS_KEY_ID).toBeUndefined();
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(env.AWS_SESSION_TOKEN).toBeUndefined();
  });

  it("preserves one-time Tilde deployment credentials from an applied import", () => {
    const result = parseTildeImportSummary({
      import_id: "import-1",
      status: "applied",
      outputs: {
        resources: {
          "chatkit/agent/openbot-gateway": { id: "agent-1", action: "created" },
          "chatkit/provider/openbot-web": { id: "provider-1", action: "created" },
        },
        environment_file: {
          filename: "tilde-deployment.env",
          content_type: "text/plain;charset=utf-8",
          contents: "TILDE_API_KEY=application-key\nTILDE_WEBHOOK_SIGNING_KEY=signing-key\n",
        },
      },
      errors: [],
    });
    expect(result.resources["chatkit/agent/openbot-gateway"]?.id).toBe("agent-1");
    expect(result.resources["chatkit/agent/openbot-gateway"]?.action).toBe(
      "created",
    );
    expect(result.environment).toEqual({
      TILDE_API_KEY: "application-key",
      TILDE_WEBHOOK_SIGNING_KEY: "signing-key",
    });
  });

  it("keeps deployment and generated Tilde credentials in separate namespaces", () => {
    const source = readFileSync(new URL("./deploy-prod.ts", import.meta.url), "utf8");
    expect(source).not.toContain(
      "imported.environment?.TILDE_API_KEY ?? process.env.TILDE_API_KEY",
    );
    expect(source).toContain("process.env.OPENBOT_TILDE_API_KEY");
  });

  it("reconciles agent credentials before the final deployment", () => {
    const source = readFileSync(new URL("./deploy-prod.ts", import.meta.url), "utf8");
    const reconcile = source.indexOf('step("reconcile"');
    const finalDeployment = source.indexOf('step("deploy_final"');
    expect(reconcile).toBeGreaterThan(-1);
    expect(reconcile).toBeLessThan(finalDeployment);
  });

  it("rejects failed and incomplete Tilde imports without echoing response payloads", () => {
    expect(() => parseTildeImportSummary({
      import_id: "import-2",
      status: "failed",
      errors: ["agent validation failed"],
      outputs: {},
    })).toThrow("agent validation failed");
    expect(() => parseTildeImportSummary({
      import_id: "import-3",
      status: "applying",
      outputs: { environment_file: { contents: "TILDE_API_KEY=never-echo-this" } },
    })).toThrow("unexpected status: applying");
  });
});
