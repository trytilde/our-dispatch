import type { JsonObject } from "@trytilde/sdk";
import { jsonSchema, type ToolSet, tool } from "ai";
import type { Client } from "./client";

export type ChatKitToolSession = {
  id: string;
  providerId: string;
  agentInboxInstanceId: string;
  targetInboxInstanceId: string;
  triggerMessageId: string;
};

/** Build provider-aware tools whose routing fields are bound by ChatKit. */
export function createChatKitSessionTools(client: Client, session: ChatKitToolSession): ToolSet {
  const providerTool = (
    name: string,
    description: string,
    properties: Record<string, JsonObject>,
    required: string[] = [],
  ) =>
    tool({
      description,
      inputSchema: jsonSchema<Record<string, unknown>>({
        type: "object",
        properties,
        required,
        additionalProperties: false,
      }),
      execute: (parameters, execution) =>
        client.chatkit.invokeSessionProviderTool({
          sessionId: session.id,
          toolName: name,
          agentInboxInstanceId: session.agentInboxInstanceId,
          targetInboxInstanceId: session.targetInboxInstanceId,
          triggerMessageId: session.triggerMessageId,
          toolCallId: execution.toolCallId,
          parameters: parameters as JsonObject,
        }),
    });

  const sendMessage = tool({
    description:
      "Send the visible reply through the provider bound to this ChatKit turn. Routing is already supplied by ChatKit.",
    inputSchema: jsonSchema<{
      content: string;
      to?: string[];
      cc?: string[];
      bcc?: string[];
      subject?: string;
      html?: string;
      replyAll?: boolean;
    }>({
      type: "object",
      properties: {
        ...(session.providerId === "chatkit.channel.agentmail"
          ? {
              to: { type: "array", items: { type: "string" } },
              cc: { type: "array", items: { type: "string" } },
              bcc: { type: "array", items: { type: "string" } },
              subject: { type: "string" },
              html: { type: "string" },
              replyAll: { type: "boolean" },
            }
          : {}),
        content: { type: "string", minLength: 1 },
      },
      required: ["content"],
      additionalProperties: false,
    }),
    execute: (input, execution) =>
      client.chatkit.sendSessionMessage({
        sessionId: session.id,
        agentInboxInstanceId: session.agentInboxInstanceId,
        targetInboxInstanceId: session.targetInboxInstanceId,
        triggerMessageId: session.triggerMessageId,
        toolCallId: execution.toolCallId,
        ...input,
      }),
  });

  const addReaction = providerTool(
    "addReaction",
    "React to the message that triggered this turn.",
    { emoji: { type: "string" } },
    ["emoji"],
  );
  const providerTools: ToolSet =
    session.providerId === "chatkit.channel.slack"
      ? {
          addReaction,
          removeReaction: providerTool(
            "removeReaction",
            "Remove this agent's Slack reaction.",
            { emoji: { type: "string" } },
            ["emoji"],
          ),
          getThread: providerTool("getThread", "Read the bound Slack thread.", {
            limit: { type: "integer", minimum: 1, maximum: 100 },
          }),
        }
      : session.providerId === "chatkit.channel.github"
        ? {
            addReaction,
            removeReaction: providerTool(
              "removeReaction",
              "Remove a GitHub reaction returned by getReactions.",
              { reactionId: { type: "string" } },
              ["reactionId"],
            ),
            getReactions: providerTool(
              "getReactions",
              "List reactions on the bound GitHub comment.",
              {},
            ),
            getThread: providerTool(
              "getThread",
              "Read the bound GitHub issue or pull-request thread.",
              {},
            ),
          }
        : session.providerId === "chatkit.channel.linq"
          ? {
              addReaction,
              removeReaction: providerTool(
                "removeReaction",
                "Remove this agent's Linq reaction.",
                { emoji: { type: "string" } },
                ["emoji"],
              ),
              getThread: providerTool("getThread", "Read the bound Linq thread.", {
                limit: { type: "integer", minimum: 1, maximum: 100 },
                order: { type: "string", enum: ["asc", "desc"] },
              }),
              createPoll: providerTool(
                "createPoll",
                "Create an iMessage poll in the bound Linq chat.",
                { options: { type: "array", items: { type: "string" }, minItems: 2 } },
                ["options"],
              ),
              addPollOptions: providerTool(
                "addPollOptions",
                "Add options to the bound Linq poll.",
                { options: { type: "array", items: { type: "string" }, minItems: 1 } },
                ["options"],
              ),
              votePoll: providerTool(
                "votePoll",
                "Add or remove a Linq poll vote.",
                {
                  option_id: { type: "string" },
                  operation: { type: "string", enum: ["add", "remove"] },
                },
                ["option_id", "operation"],
              ),
            }
          : session.providerId === "chatkit.channel.agentmail"
            ? {
                getThread: providerTool("getThread", "Read the bound AgentMail email thread.", {}),
              }
            : {};

  return { sendMessage, ...providerTools };
}
