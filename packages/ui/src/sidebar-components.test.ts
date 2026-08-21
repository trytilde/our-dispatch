import { describe, expect, it } from "vite-plus/test";
import { sidebarAvatarState } from "./sidebar-components.js";

describe("sidebar avatar activity", () => {
  it("uses the loading state while the selected agent is busy", () => {
    expect(sidebarAvatarState({ id: "agent", name: "Agent", busy: true }, true)).toBe("loading");
  });

  it("uses the loading state for a remotely working agent", () => {
    expect(sidebarAvatarState({ id: "agent", name: "Agent", status: "working" }, false)).toBe(
      "loading",
    );
  });

  it("returns the selected agent to listening when work stops", () => {
    expect(sidebarAvatarState({ id: "agent", name: "Agent", busy: false }, true)).toBe("listening");
  });
});
