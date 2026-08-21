/** Convert an owner-facing agent name into its stable authored-agent identifier. */
export function agentIdFromName(name: string): string {
  const id = name
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!id) throw new Error("Agent name must contain at least one letter or number");
  return id;
}
