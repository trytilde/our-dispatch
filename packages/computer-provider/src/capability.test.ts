import { describe, expect, it } from "vite-plus/test";
import { computerServiceApiKey, scopedCapability } from "./capability.js";

describe("scopedCapability", () => {
  it("derives a VNC capability without exposing the service API key", () => {
    const secret = "a".repeat(32);
    expect(scopedCapability("vnc", "one", "agent-one", secret)).not.toBe(
      scopedCapability("vnc", "two", "agent-one", secret),
    );
    expect(scopedCapability("vnc", "one", "agent-one", secret)).not.toBe(
      scopedCapability("vnc", "one", "agent-two", secret),
    );
    expect(scopedCapability("vnc", "one", "agent-one", secret)).not.toContain(secret);
    expect(computerServiceApiKey(secret)).toBe(secret);
  });
});
