import { messageText, type ChatKitSearchHit } from "@tryopenbot/client-runtime";

export function searchHitId(hit: ChatKitSearchHit): string {
  if (hit.kind === "agent") return `agent:${hit.agent?.id ?? hit.session.id}`;
  if (hit.kind === "message") return `message:${hit.message?.id ?? hit.session.id}`;
  return `session_title:${hit.session.id}`;
}

export function rankWorkspaceSearchHits(
  hits: readonly ChatKitSearchHit[],
  rawQuery: string,
): ChatKitSearchHit[] {
  const query = rawQuery.trim().toLowerCase();
  const unique = new Map<string, { hit: ChatKitSearchHit; index: number }>();
  for (const [index, hit] of hits.entries()) {
    const id = searchHitId(hit);
    if (!unique.has(id)) unique.set(id, { hit, index });
  }
  return [...unique.values()]
    .sort((left, right) => {
      const score = (hit: ChatKitSearchHit): number => {
        const title =
          hit.kind === "agent"
            ? hit.agent?.display_name || hit.agent?.id || ""
            : hit.kind === "session_title"
              ? hit.session.title || ""
              : hit.message
                ? messageText(hit.message)
                : "";
        const normalized = title.trim().toLowerCase();
        if (hit.kind === "agent" && normalized === query) return 0;
        if (hit.kind === "agent" && normalized.startsWith(query)) return 1;
        if (normalized === query) return 2;
        if (normalized.startsWith(query)) return 3;
        if (hit.kind === "agent") return 4;
        if (hit.kind === "session_title") return 5;
        return 6;
      };
      const kindOrder = (hit: ChatKitSearchHit) =>
        hit.kind === "agent" ? 0 : hit.kind === "session_title" ? 1 : 2;
      return (
        score(left.hit) - score(right.hit) ||
        kindOrder(left.hit) - kindOrder(right.hit) ||
        left.index - right.index
      );
    })
    .map(({ hit }) => hit);
}
