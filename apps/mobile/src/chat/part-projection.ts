import { connectorSelectionFromPart, type ChatPart } from "@tryopenbot/client-runtime";

/** Project pre-tool narration as activity while preserving terminal assistant text. */
export function projectActivityParts(parts: readonly ChatPart[]): ChatPart[] {
  return parts.map((part, index) => {
    if (part.type !== "text" || !part.text?.trim()) return part;
    const followedByTool = parts
      .slice(index + 1)
      .some(
        (candidate) => isToolPart(candidate) && connectorSelectionFromPart(candidate) === undefined,
      );
    return followedByTool ? { ...part, type: "reasoning" } : part;
  });
}

function isToolPart(part: ChatPart): boolean {
  return part.type === "tool" || part.type === "dynamic-tool" || part.type.startsWith("tool-");
}
