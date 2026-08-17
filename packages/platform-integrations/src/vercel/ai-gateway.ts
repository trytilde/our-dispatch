export interface VercelAiGatewayApiKey {
  id: string;
  value: string;
}

export class VercelAiGatewayError extends Error {
  constructor(
    readonly code: "invalid_configuration" | "provider_unavailable",
    message: string,
  ) {
    super(message);
    this.name = "VercelAiGatewayError";
  }
}

/** Create a named Vercel AI Gateway key without exposing the Vercel token in process arguments. */
export async function createVercelAiGatewayApiKey(options: {
  token?: string;
  teamId?: string;
  name: string;
  request?: typeof fetch;
}): Promise<VercelAiGatewayApiKey> {
  const token = options.token?.trim();
  if (!token)
    throw new VercelAiGatewayError(
      "invalid_configuration",
      "VERCEL_TOKEN is required to create a Vercel AI Gateway API key",
    );
  const name = options.name.trim();
  if (!name)
    throw new VercelAiGatewayError(
      "invalid_configuration",
      "A name is required to create a Vercel AI Gateway API key",
    );

  const url = new URL("https://api.vercel.com/v1/api-keys");
  const teamId = options.teamId?.trim();
  if (teamId) url.searchParams.set("teamId", teamId);
  const response = await (options.request ?? fetch)(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ purpose: "ai-gateway", name }),
  });
  if (!response.ok)
    throw new VercelAiGatewayError(
      "provider_unavailable",
      `Vercel AI Gateway API key creation failed (${response.status})`,
    );
  const body = (await response.json()) as {
    apiKey?: { id?: unknown };
    apiKeyString?: unknown;
  };
  if (
    typeof body.apiKey?.id !== "string" ||
    !body.apiKey.id ||
    typeof body.apiKeyString !== "string" ||
    !body.apiKeyString
  )
    throw new VercelAiGatewayError(
      "provider_unavailable",
      "Vercel did not return the created AI Gateway API key",
    );
  return { id: body.apiKey.id, value: body.apiKeyString };
}
