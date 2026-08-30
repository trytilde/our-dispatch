import { describe, expect, it } from "vite-plus/test";
import { connectionHints, tunnelArguments } from "./tunnel.js";

describe("desktop tunnel", () => {
  it("forwards the Electron desktop by default", () => {
    expect(tunnelArguments({ ssh: "root@h", platform: "linux" })).toEqual([
      "-N",
      "-L",
      "5901:127.0.0.1:5901",
      "root@h",
    ]);
    expect(connectionHints({ ssh: "root@h", platform: "linux" })).toEqual([
      "desktop: open vnc://localhost:5901 for the Electron shell",
    ]);
  });

  it("honors a per-host desktop port and can be disabled", () => {
    expect(tunnelArguments({ ssh: "root@h", platform: "linux", desktopVncPort: 5911 })).toContain(
      "5911:127.0.0.1:5911",
    );
    expect(tunnelArguments({ ssh: "root@h", platform: "linux" }, { desktop: false })).toEqual([
      "-N",
      "root@h",
    ]);
  });
});
