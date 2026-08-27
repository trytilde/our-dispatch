// # DO NOT UPSTREAM
// #reason: Fork-only regression coverage for the private trytilde/api development integration.
import { describe, expect, it } from "vite-plus/test";
import {
  defaultLocalTildeApiOrigin,
  localTildeApiEnvironment,
  localTildeApiMakeArguments,
  localTildeApiSubmoduleArguments,
  normalizeLocalTildeApiOrigin,
  parseLocalTildeApiOptions,
} from "./local-tilde-api.js";

describe("local Tilde API development", () => {
  it("uses the platform's make dev origin for the bare flag", () => {
    expect(defaultLocalTildeApiOrigin("darwin")).toBe("https://api.tilde.test:8443");
    expect(defaultLocalTildeApiOrigin("linux")).toBe("https://api.tilde.test");
    expect(parseLocalTildeApiOptions(["--local-tilde-api"])).toEqual({
      tildeBaseUrl: defaultLocalTildeApiOrigin(),
    });
  });

  it("normalizes HTTP spelling to the TLS listener started by make dev", () => {
    expect(normalizeLocalTildeApiOrigin("http://127.0.0.1:8443")).toBe("https://127.0.0.1:8443");
    expect(parseLocalTildeApiOptions(["--local-tilde-api=http://127.0.0.1:8443"])).toEqual({
      tildeBaseUrl: "https://127.0.0.1:8443",
    });
  });

  it("passes the selected HTTPS port and origin to make dev", () => {
    expect(localTildeApiMakeArguments("https://127.0.0.1:9443")).toEqual([
      "dev",
      "DEV_API_PORT=9443",
      "DEV_API_ORIGIN=https://127.0.0.1:9443",
    ]);
  });

  it("initializes only the fork-owned private submodule", () => {
    expect(localTildeApiSubmoduleArguments()).toEqual([
      "submodule",
      "update",
      "--init",
      "--depth",
      "1",
      "--",
      "third-party/tilde-api",
    ]);
  });

  it("overrides only the selected process environment", () => {
    const environment = { TILDE_BASE_URL: "https://api.trytilde.ai" };
    expect(localTildeApiEnvironment(environment, {})).toBe(environment);
    expect(
      localTildeApiEnvironment(environment, { tildeBaseUrl: "https://api.tilde.test:8443" }),
    ).toMatchObject({ TILDE_BASE_URL: "https://api.tilde.test:8443" });
  });

  it("rejects paths, credentials, and unknown flags", () => {
    expect(() => normalizeLocalTildeApiOrigin("https://api.tilde.test/api/v1")).toThrow(
      "Local Tilde API must be an HTTP(S) origin",
    );
    expect(() => parseLocalTildeApiOptions(["--local-api"])).toThrow(
      "Unknown dev option: --local-api",
    );
  });
});
// #END DO NOT UPSTREAM
