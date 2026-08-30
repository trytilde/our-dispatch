import { describe, expect, it } from "vite-plus/test";
import { optionalEnvironment } from "./environment-overrides.js";

describe("optionalEnvironment", () => {
  it("returns a set value", () => {
    expect(optionalEnvironment("NAME", { NAME: "value" })).toBe("value");
  });

  // GitHub Actions substitutes "" for an unset `vars.*`, and `??` would accept it.
  // The desktop bucket would resolve to "" and bypass its intended default.
  it("treats an unset, empty, or whitespace variable as absent", () => {
    expect(optionalEnvironment("NAME", {})).toBeUndefined();
    expect(optionalEnvironment("NAME", { NAME: "" })).toBeUndefined();
    expect(optionalEnvironment("NAME", { NAME: "   " })).toBeUndefined();
  });

  it("trims a padded value rather than passing the padding through", () => {
    expect(optionalEnvironment("NAME", { NAME: " value " })).toBe("value");
  });
});
