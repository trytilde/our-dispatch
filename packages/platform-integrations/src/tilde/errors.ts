/** Extract the HTTP status exposed by Tilde SDK and generated-client failures. */
export function tildeErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  if ("status" in error && typeof error.status === "number") return error.status;
  switch ("response" in error) {
    case true:
      const response = (error as { response?: unknown }).response;
      if (response instanceof Response) return response.status;
      return undefined;
    case false:
      return undefined;
  }
}

/** Normalize the different error shapes returned by Tilde clients. */
export function tildeErrorMessage(error: unknown, fallback = "Tilde request failed"): string {
  return knownErrorMessage(error) ?? fallback;
}

/** Add safe HTTP context without dumping arbitrary response bodies or credentials. */
export function tildeHttpErrorMessage(
  error: unknown,
  response: Response | undefined,
  fallback = "Tilde request failed",
): string {
  const message = tildeErrorMessage(error, fallback);
  const status = response?.status ?? tildeErrorStatus(error);
  if (!status) return message;
  const statusText = response?.statusText.trim();
  return `${message} (HTTP ${status}${statusText ? ` ${statusText}` : ""})`;
}

function knownErrorMessage(value: unknown): string | undefined {
  if (value instanceof Error) return value.message || undefined;
  if (typeof value === "string") return value || undefined;
  if (Array.isArray(value)) {
    const messages = value.flatMap((item) => knownErrorMessage(item) ?? []);
    return messages.length ? messages.join("; ") : undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  for (const key of ["message", "msg", "detail", "error"] as const) {
    if (!(key in value)) continue;
    const nested: unknown = (value as Record<string, unknown>)[key];
    if (nested === value) continue;
    const message = knownErrorMessage(nested);
    if (message) return message;
  }
  return undefined;
}
