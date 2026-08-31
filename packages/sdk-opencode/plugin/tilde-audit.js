import { spawn } from "node:child_process";

function emit(payload) {
  return new Promise((resolve) => {
    const child = spawn("openbot", ["plugin", "audit", "--cli", "opencode"], {
      stdio: ["pipe", "ignore", "inherit"],
    });
    child.once("error", (error) => {
      console.error(`Tilde ChatKit audit hook failed open: ${error.message}`);
      resolve();
    });
    child.once("exit", resolve);
    child.stdin.end(`${JSON.stringify(payload)}\n`);
  });
}

function textParts(parts) {
  return parts
    .filter((part) => part && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

export const TildeChatKitAudit = async ({ directory }) => ({
  "chat.message": async (input, output) => {
    await emit({
      session_id: input.sessionID,
      hook_event_name: "chat.message",
      event_id: input.messageID,
      cwd: directory,
      model: input.model?.modelID,
      text: textParts(output.parts),
    });
  },
  "tool.execute.before": async (input, output) => {
    await emit({
      session_id: input.sessionID,
      hook_event_name: "tool.execute.before",
      cwd: directory,
      call_id: input.callID,
      tool_name: input.tool,
      tool_input: output.args,
    });
  },
  "tool.execute.after": async (input, output) => {
    await emit({
      session_id: input.sessionID,
      hook_event_name: "tool.execute.after",
      cwd: directory,
      call_id: input.callID,
      tool_name: input.tool,
      tool_input: input.args,
      tool_response: output,
    });
  },
  "experimental.text.complete": async (input, output) => {
    await emit({
      session_id: input.sessionID,
      hook_event_name: "experimental.text.complete",
      event_id: `${input.messageID}:${input.partID}`,
      cwd: directory,
      text: output.text,
    });
  },
});
