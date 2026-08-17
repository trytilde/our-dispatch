import { describe, expect, it } from "vite-plus/test";
import { parseOptions, redact } from "./deploy.js";

describe("deploy-prod", () => {
  it("parses the minimal deployment options", () => {
    expect(parseOptions(["--", "--yes", "--json"])).toEqual({
      yes: true,
      dryRun: false,
      json: true,
      skipDeploy: false,
      service: "all",
    });
    expect(parseOptions(["--dry-run"])).toEqual({
      yes: false,
      dryRun: true,
      json: false,
      skipDeploy: false,
      service: "all",
    });
    expect(parseOptions(["--skip-deploy", "--service", "agents"])).toEqual({
      yes: false,
      dryRun: false,
      json: false,
      skipDeploy: true,
      service: "agents",
    });
    expect(() => parseOptions(["--service", "unknown"])).toThrow("Unsupported deploy service");
    expect(() => parseOptions(["--resume"])).toThrow("unknown or unexpected option: --resume");
  });

  it("redacts the Vercel token", () => {
    expect(redact("VERCEL_TOKEN=secret-value", ["secret-value"])).toBe("VERCEL_TOKEN=[REDACTED]");
  });
});
