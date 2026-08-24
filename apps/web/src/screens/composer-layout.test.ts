import { describe, expect, it } from "vite-plus/test";
import { shouldExpandComposer } from "./composer-layout.js";

describe("composer layout", () => {
  it("does not jump to the expanded layout at a character-count threshold", () => {
    expect(shouldExpandComposer("a".repeat(80), false, false)).toBe(false);
    expect(shouldExpandComposer("a".repeat(81), false, false)).toBe(false);
    expect(shouldExpandComposer("a".repeat(200), false, false)).toBe(false);
  });

  it("expands for explicitly multiline or supplemental content", () => {
    expect(shouldExpandComposer("first line\nsecond line", false, false)).toBe(true);
    expect(shouldExpandComposer("message", true, false)).toBe(true);
    expect(shouldExpandComposer("message", false, true)).toBe(true);
  });
});
