import { describe, expect, it } from "vite-plus/test";
import { renderAgentAvatarPng } from "./avatar.js";

describe("renderAgentAvatarPng", () => {
  it("renders stable valid PNG bytes per agent", () => {
    const first = renderAgentAvatarPng("factory");
    const repeated = renderAgentAvatarPng("factory");
    const other = renderAgentAvatarPng("pirate-poet");

    expect(Array.from(first.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(first).toEqual(repeated);
    expect(first).not.toEqual(other);
    expect(first.length).toBeGreaterThan(100);
  });
});
