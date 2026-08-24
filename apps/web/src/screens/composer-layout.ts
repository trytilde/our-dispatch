export function shouldExpandComposer(
  draft: string,
  hasAttachments: boolean,
  hasReply: boolean,
): boolean {
  return draft.includes("\n") || hasAttachments || hasReply;
}
