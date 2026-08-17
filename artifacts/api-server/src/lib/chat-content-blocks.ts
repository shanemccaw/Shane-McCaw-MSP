/**
 * ShaneBot structured content blocks + suggested-reply chips (#361, epic #360).
 *
 * Server-side helpers over the block shape declared in @workspace/db
 * (ChatContentBlock / ChatMessageContent). Shared by BOTH ShaneBot surfaces —
 * support-chat.ts (Paid) and public-chat.ts (Public) — so the two never drift
 * on how a reply is parsed, stripped, stored, or read back.
 *
 * Two things live here:
 *
 * 1. LEGACY-TOLERANT READS. Every message written before #361 holds a bare
 *    string. The column is already jsonb, so the interior shape change needs no
 *    DDL and no backfill — but that only holds because every read path goes
 *    through toContentBlocks() / contentToText() instead of assuming an array.
 *    If you add a read site, use these.
 *
 * 2. THE SUGGESTED_REPLIES CONTROL TOKEN. Same pattern as the markers already
 *    in these routes ([ESCALATE_TO_HUMAN], [PROPOSE_REMEDIATION:<id>],
 *    [FLAG_FOR_REVIEW:<reason>]): the model emits it at the end of its reply,
 *    the server parses it out and strips it from the visible text, and the
 *    options travel to the client as a suggested_replies block. The user never
 *    sees the raw token.
 */

import type { ChatContentBlock, ChatMessageContent } from "@workspace/db";

// ── Suggested-reply chips ─────────────────────────────────────────────────────

/** Chips past this many are dropped — a chip row is a shortcut, not a menu. */
export const MAX_SUGGESTED_REPLIES = 4;
/** Chips must fit on a tappable pill; longer options are dropped, not truncated. */
export const MAX_SUGGESTED_REPLY_LENGTH = 80;

/**
 * `[SUGGESTED_REPLIES: "option one" | "option two"]`
 *
 * Deliberately tolerant: any quoting style (or none), any spacing, and a
 * trailing separator all parse. A malformed token still gets stripped from the
 * visible text by stripSuggestedReplies() even when it yields zero options, so
 * a fumbled emission degrades to "no chips" rather than leaking a raw marker.
 */
const SUGGESTED_REPLIES_RE = /\[SUGGESTED_REPLIES:\s*([^\]]*)\]/i;
const SUGGESTED_REPLIES_RE_GLOBAL = /\[SUGGESTED_REPLIES:\s*[^\]]*\]/gi;

/** Strip matching wrapping quotes (straight or curly) from one option. */
function unquote(raw: string): string {
  return raw.trim().replace(/^["'‘“]+/, "").replace(/["'’”]+$/, "").trim();
}

/**
 * Parse the suggested-reply control token, if the model emitted one.
 * Returns [] when absent, empty, or malformed — never throws.
 */
export function parseSuggestedReplies(text: string): string[] {
  const match = SUGGESTED_REPLIES_RE.exec(text ?? "");
  if (!match) return [];

  const seen = new Set<string>();
  const options: string[] = [];

  for (const part of (match[1] ?? "").split("|")) {
    const option = unquote(part);
    if (!option || option.length > MAX_SUGGESTED_REPLY_LENGTH) continue;
    const key = option.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    options.push(option);
    if (options.length >= MAX_SUGGESTED_REPLIES) break;
  }

  return options;
}

/**
 * True when the model emitted the token at all — regardless of whether it parsed
 * into usable options. Lets a route distinguish "no chips offered" (normal) from
 * "chips offered but unusable" (a prompt-adherence problem worth logging).
 */
export function hasSuggestedRepliesToken(text: string): boolean {
  return SUGGESTED_REPLIES_RE.test(text ?? "");
}

/** Remove every suggested-reply token from a reply before the user sees it. */
export function stripSuggestedReplies(text: string): string {
  return (text ?? "").replace(SUGGESTED_REPLIES_RE_GLOBAL, "").trim();
}

/**
 * The instruction appended to BOTH surfaces' system prompts. Voice-adjacent but
 * not voice — it lives here, next to the parser that consumes it, so the token
 * format can never drift from what the server actually accepts.
 */
export const SUGGESTED_REPLIES_INSTRUCTION = `SUGGESTED REPLIES
When there are obvious next things this person would want to ask, end your reply with a control token on its very last line, alone:
[SUGGESTED_REPLIES: "first option" | "second option" | "third option"]
- Offer 2 to ${MAX_SUGGESTED_REPLIES} options, each written as something the USER would say to you next (not as something you would say).
- Keep each one short — a few words, under ${MAX_SUGGESTED_REPLY_LENGTH} characters — and make each a genuinely different direction, not a rewording.
- Only offer follow-ups you could actually answer from the information available to you.
- The token is stripped out before the user sees your reply and rendered as tappable buttons. Never mention it, never refer to "chips", "buttons", or "options below", and never repeat the options in your prose.
- Omit the token entirely when there is no sensible next question, or when you have just asked the user a direct question of your own.`;

// ── Content blocks ────────────────────────────────────────────────────────────

/**
 * Normalize any stored/received content to blocks.
 *
 * Handles the legacy bare-string shape (wrapped as a single text block), the
 * new block-array shape (passed through, with unknown/malformed entries
 * dropped), and null/undefined (empty array). This is the ONLY thing standing
 * between old rows and a read-path crash — do not bypass it.
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
    const block = raw as Partial<ChatContentBlock> & { type?: unknown };
    if (block.type === "text" && typeof (block as { text?: unknown }).text === "string") {
      blocks.push({ type: "text", text: (block as { text: string }).text });
    } else if (block.type === "suggested_replies" && Array.isArray((block as { options?: unknown }).options)) {
      const options = (block as { options: unknown[] }).options.filter(
        (o): o is string => typeof o === "string",
      );
      blocks.push({ type: "suggested_replies", options });
    } else if (block.type === "card") {
      // RESERVED block type (deferred Active Cards issue). Preserved verbatim on
      // read so a future renderer sees whatever was stored; nothing writes it today.
      const card = block as { cardType?: unknown; data?: unknown };
      if (typeof card.cardType === "string") {
        blocks.push({
          type: "card",
          cardType: card.cardType,
          data: (card.data ?? {}) as Record<string, unknown>,
        });
      }
    }
  }
  return blocks;
}

/** Flatten content back to plain text — for prompts, previews, and audit bodies. */
export function contentToText(content: ChatMessageContent | null | undefined): string {
  if (typeof content === "string") return content;
  return toContentBlocks(content)
    .filter((b): b is Extract<ChatContentBlock, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("\n\n");
}

/** The suggested-reply options carried by a content array, if any. */
export function suggestedRepliesFrom(content: ChatMessageContent | null | undefined): string[] {
  for (const block of toContentBlocks(content)) {
    if (block.type === "suggested_replies") return block.options;
  }
  return [];
}

/** The card blocks carried by a content array, if any (#366). */
export function cardsFrom(
  content: ChatMessageContent | null | undefined,
): Array<{ cardType: string; data: Record<string, unknown> }> {
  return toContentBlocks(content)
    .filter((b): b is Extract<ChatContentBlock, { type: "card" }> => b.type === "card")
    .map((b) => ({ cardType: b.cardType, data: b.data }));
}

/**
 * Build an assistant message's content: its visible text, any data cards
 * (#366 — always server-resolved, real data), then chips if offered. Cards
 * sit between text and chips so a reply reads as prose -> supporting data ->
 * next-step suggestions.
 */
export function buildAssistantContent(
  text: string,
  suggestedReplies: string[] = [],
  cards: Array<{ cardType: string; data: Record<string, unknown> }> = [],
): ChatContentBlock[] {
  const blocks: ChatContentBlock[] = [];
  if (text) blocks.push({ type: "text", text });
  for (const card of cards) {
    blocks.push({ type: "card", cardType: card.cardType, data: card.data });
  }
  if (suggestedReplies.length > 0) {
    blocks.push({ type: "suggested_replies", options: suggestedReplies });
  }
  return blocks;
}

/** Build a user message's content. Users only ever produce text today. */
export function buildUserContent(text: string): ChatContentBlock[] {
  return text ? [{ type: "text", text }] : [];
}
