import { describe, expect, it } from "vite-plus/test";
import { developmentChildEnvironment } from "./environment.js";

describe("developmentChildEnvironment", () => {
  it("passes the shell through with the named wiring applied", () => {
    expect(
      developmentChildEnvironment(
        { PATH: "/usr/bin", HOME: "/home/owner" },
        { CONTROL_ORIGIN: "http://127.0.0.1:4100" },
      ),
    ).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/owner",
      CONTROL_ORIGIN: "http://127.0.0.1:4100",
    });
  });

  it("cannot leak deployment configuration a caller did not name", () => {
    const child = developmentChildEnvironment(
      { PATH: "/usr/bin" },
      { CONTROL_ORIGIN: "http://127.0.0.1:4100" },
    );
    for (const name of [
      "TILDE_API_KEY",
      "SOPS_AGE_KEY",
      "OPENBOT_OIDC_TOKEN_ENDPOINT",
      "OPENBOT_OIDC_CLIENT_ID",
    ])
      expect(child).not.toHaveProperty(name);
  });
});
