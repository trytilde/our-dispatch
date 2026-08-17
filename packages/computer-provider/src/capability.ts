import { createHmac } from "node:crypto";

export function computerServiceApiKey(value = process.env.COMPUTER_SERVICE_API_KEY): string {
  if (!value || value.length < 32)
    throw new Error("COMPUTER_SERVICE_API_KEY must contain at least 32 characters");
  return value;
}

export function scopedCapability(
  scope: "vnc",
  computerId: string,
  agentId?: string,
  secret = computerServiceApiKey(),
): string {
  return createHmac("sha256", secret)
    .update(`openbot:${scope}:${computerId}:${agentId ?? "shared"}`)
    .digest("base64url");
}
