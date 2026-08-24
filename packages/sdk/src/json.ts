export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[] | undefined;
export type JsonObject = { [key: string]: JsonValue };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isJsonObject(value: unknown): value is JsonObject {
  return isRecord(value);
}

export function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key];
  return typeof field === "string" && field.length > 0 ? field : undefined;
}

export function trimmedStringField(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  return stringField(value, key)?.trim() || undefined;
}

export function parseJsonValue(input: string): JsonValue {
  try {
    return JSON.parse(input) as JsonValue;
  } catch {
    return undefined;
  }
}
