import type { ThreadMessageLike } from "@assistant-ui/react-native";
import { messageText, type ChatMessage } from "@tryopenbot/client-runtime";

export function toAssistantMessage(message: ChatMessage): ThreadMessageLike {
  const text = messageText(message).trim() || richPartLabel(message);
  const role = message.role === "user" || message.role === "system" ? message.role : "assistant";
  return {
    id: message.id,
    role,
    content: text ? [{ type: "text", text }] : [],
    createdAt: new Date(message.created_at),
    ...(role === "assistant"
      ? {
          status: message.parts?.some((part) => part.state === "streaming")
            ? ({ type: "running" } as const)
            : ({ type: "complete", reason: "unknown" } as const),
        }
      : {}),
  };
}

function richPartLabel(message: ChatMessage): string {
  return (message.parts ?? [])
    .map((part) => {
      if (part.type === "file" || part.type === "image") return part.filename || "Attachment";
      if (part.type === "tool" || part.type.startsWith("tool-"))
        return `Used ${part.tool_name || part.toolName || "a tool"}`;
      return part.text || "";
    })
    .filter(Boolean)
    .join("\n");
}
