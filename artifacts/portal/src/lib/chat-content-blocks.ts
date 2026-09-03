/**
 * ShaneBot structured content blocks — client mirror (#361, Active Cards #366).
 *
 * The canonical shape lives server-side (`@workspace/db`'s ChatContentBlock, with
 * helpers in api-server's `lib/chat-content-blocks.ts`). This app is an
 * independent Vite app with no workspace-package dependency, so the shape is
 * restated here rather than imported — same pattern as
 * `shane-mccaw-consulting/src/lib/chat-content-blocks.ts`. Keep the three in
 * step — the type union and the legacy-tolerant normalizer are the parts that
 * must not drift.
 */

export type ChatTextBlock = { type: "text"; text: string };
export type ChatSuggestedRepliesBlock = { type: "suggested_replies"; options: string[] };
/**
 * Active Cards (#366). Never persisted (contract pack §6) — a `card` block
 * only ever arrives in a live response's `content`, never read back from
 * transcript history. `cardType` is a plain string at this layer (the
 * contract pack §3 note: authorization narrows it server-side, the wire shape
 * stays open) — ActiveCard.tsx is what decides whether a given cardType has a
 * real renderer.
 */
export type ChatCardBlock = { type: "card"; cardType: string; data: Record<string, unknown> };

export type ChatContentBlock = ChatTextBlock | ChatSuggestedRepliesBlock | ChatCardBlock;

/** A message's content: blocks from #361 onward, a bare string for anything older. */
export type ChatMessageContent = string | ChatContentBlock[];

/**
 * Normalize any content to blocks. Transcripts stored before #361 hold bare
 * strings, so every render path must go through this rather than assuming an
 * array — that tolerance is what makes a backfill unnecessary.
 */
export function toContentBlocks(content: ChatMessageContent | null | undefined): ChatContentBlock[] {
  if (content == null) return [];
  if (typeof content === "string") {
    return content.length > 0 ? [{ type: "text", text: content }] : [];
  }
  if (!Array.isArray(content)) return [];

  const blocks: ChatContentBlock[] = [];
  for (const raw of content) {
    if (!raw || typeof raw !== "object") continue;
    const block = raw as { type?: unknown; text?: unknown; options?: unknown; cardType?: unknown; data?: unknown };
    if (block.type === "text" && typeof block.text === "string") {
      blocks.push({ type: "text", text: block.text });
    } else if (block.type === "suggested_replies" && Array.isArray(block.options)) {
      blocks.push({
        type: "suggested_replies",
        options: block.options.filter((o): o is string => typeof o === "string"),
      });
    } else if (block.type === "card" && typeof block.cardType === "string") {
      blocks.push({
        type: "card",
        cardType: block.cardType,
        data: (block.data ?? {}) as Record<string, unknown>,
      });
    }
  }
  return blocks;
}

/** Flatten content to plain text — what the bubble renders. */
export function contentToText(content: ChatMessageContent | null | undefined): string {
  if (typeof content === "string") return content;
  return toContentBlocks(content)
    .filter((b): b is ChatTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n\n");
}

/** The suggested-reply chips carried by a message, if any. */
export function suggestedRepliesFrom(content: ChatMessageContent | null | undefined): string[] {
  for (const block of toContentBlocks(content)) {
    if (block.type === "suggested_replies") return block.options;
  }
  return [];
}

/** The card block carried by a message, if any (#366 — at most one per turn). */
export function cardFrom(content: ChatMessageContent | null | undefined): ChatCardBlock | null {
  for (const block of toContentBlocks(content)) {
    if (block.type === "card") return block;
  }
  return null;
}

/** Build a user message's content. Users only ever produce text today. */
export function buildContent(text: string, suggestedReplies: string[] = []): ChatContentBlock[] {
  const blocks: ChatContentBlock[] = [];
  if (text) blocks.push({ type: "text", text });
  if (suggestedReplies.length > 0) blocks.push({ type: "suggested_replies", options: suggestedReplies });
  return blocks;
}
