import { describe, expect, it } from "vite-plus/test";
import { isJsonObject, isRecord, parseJsonValue, stringField, trimmedStringField } from "./json.js";

describe("JSON utilities", () => {
  it("recognizes records but rejects arrays and null", () => {
    expect(isRecord({ ok: true })).toBe(true);
    expect(isJsonObject({ ok: true })).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
  });

  it("reads string fields with explicit whitespace behavior", () => {
    expect(stringField({ name: " value " }, "name")).toBe(" value ");
    expect(trimmedStringField({ name: " value " }, "name")).toBe("value");
    expect(trimmedStringField({ name: "   " }, "name")).toBeUndefined();
  });

  it("parses JSON without throwing on malformed input", () => {
    expect(parseJsonValue('{"ok":true}')).toEqual({ ok: true });
    expect(parseJsonValue("not json")).toBeUndefined();
  });
});
