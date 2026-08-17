/**
 * chat-content-blocks.test.ts
 *
 * Covers the two guarantees #361 rests on:
 *   1. LEGACY TOLERANCE — a message stored before #361 is a bare string, and no
 *      backfill was run. toContentBlocks()/contentToText() must read both shapes,
 *      because that tolerance is the entire justification for skipping a
 *      migration.
 *   2. THE SUGGESTED_REPLIES TOKEN — parsed into options and stripped from the
 *      visible text, including when it's malformed (strip must still happen, so
 *      a fumbled emission can never leak a raw marker to a user).
 */

import { describe, it, expect } from "vitest";
import {
  MAX_SUGGESTED_REPLIES,
  MAX_SUGGESTED_REPLY_LENGTH,
  SUGGESTED_REPLIES_INSTRUCTION,
  buildAssistantContent,
  buildUserContent,
  cardsFrom,
  contentToText,
  hasSuggestedRepliesToken,
  parseSuggestedReplies,
  stripSuggestedReplies,
  suggestedRepliesFrom,
  toContentBlocks,
} from "./chat-content-blocks.ts";

describe("parseSuggestedReplies", () => {
  it("parses the documented quoted form", () => {
    expect(
      parseSuggestedReplies('Here you go.\n[SUGGESTED_REPLIES: "What does it cost?" | "How long does it take?"]'),
    ).toEqual(["What does it cost?", "How long does it take?"]);
  });

  it("tolerates unquoted options and sloppy spacing", () => {
    expect(parseSuggestedReplies("[SUGGESTED_REPLIES:one|  two |three ]")).toEqual(["one", "two", "three"]);
  });

  it("tolerates curly quotes", () => {
    expect(parseSuggestedReplies("[SUGGESTED_REPLIES: “Show findings” | ‘Rerun the scan’]")).toEqual([
      "Show findings",
      "Rerun the scan",
    ]);
  });

  it("returns [] when the token is absent, empty, or has only separators", () => {
    expect(parseSuggestedReplies("no token here")).toEqual([]);
    expect(parseSuggestedReplies("[SUGGESTED_REPLIES:]")).toEqual([]);
    expect(parseSuggestedReplies("[SUGGESTED_REPLIES: | | ]")).toEqual([]);
    expect(parseSuggestedReplies("")).toEqual([]);
  });

  it("caps the option count", () => {
    const many = Array.from({ length: 9 }, (_, i) => `"option ${i}"`).join(" | ");
    expect(parseSuggestedReplies(`[SUGGESTED_REPLIES: ${many}]`)).toHaveLength(MAX_SUGGESTED_REPLIES);
  });

  it("drops (rather than truncates) an over-long option, keeping the usable ones", () => {
    const tooLong = "x".repeat(MAX_SUGGESTED_REPLY_LENGTH + 1);
    expect(parseSuggestedReplies(`[SUGGESTED_REPLIES: "${tooLong}" | "short one"]`)).toEqual(["short one"]);
  });

  it("de-duplicates case-insensitively", () => {
    expect(parseSuggestedReplies('[SUGGESTED_REPLIES: "Show me" | "show me" | "Something else"]')).toEqual([
      "Show me",
      "Something else",
    ]);
  });
});

describe("stripSuggestedReplies", () => {
  it("removes the token from the visible reply", () => {
    const stripped = stripSuggestedReplies('The assessment covers your tenant.\n[SUGGESTED_REPLIES: "a" | "b"]');
    expect(stripped).toBe("The assessment covers your tenant.");
    expect(stripped).not.toMatch(/SUGGESTED_REPLIES/);
  });

  it("still strips a malformed token that yields zero options", () => {
    const raw = "Sure thing.\n[SUGGESTED_REPLIES: ]";
    expect(parseSuggestedReplies(raw)).toEqual([]);
    expect(stripSuggestedReplies(raw)).toBe("Sure thing.");
  });

  it("strips every occurrence when the model emits more than one", () => {
    const stripped = stripSuggestedReplies('[SUGGESTED_REPLIES: "a"] middle [SUGGESTED_REPLIES: "b"]');
    expect(stripped).not.toMatch(/SUGGESTED_REPLIES/);
    expect(stripped).toContain("middle");
  });
});

describe("hasSuggestedRepliesToken", () => {
  it("separates 'no chips offered' from 'chips offered but unusable'", () => {
    expect(hasSuggestedRepliesToken("plain reply")).toBe(false);
    expect(hasSuggestedRepliesToken('reply [SUGGESTED_REPLIES: "a"]')).toBe(true);
    // Emitted but empty — the case the routes log about.
    expect(hasSuggestedRepliesToken("reply [SUGGESTED_REPLIES: ]")).toBe(true);
    expect(parseSuggestedReplies("reply [SUGGESTED_REPLIES: ]")).toEqual([]);
  });
});

describe("toContentBlocks — legacy tolerance (why no backfill is needed)", () => {
  it("wraps a legacy bare string as a single text block", () => {
    expect(toContentBlocks("hello there")).toEqual([{ type: "text", text: "hello there" }]);
  });

  it("passes the new block shape through", () => {
    const blocks = [
      { type: "text" as const, text: "hi" },
      { type: "suggested_replies" as const, options: ["a", "b"] },
    ];
    expect(toContentBlocks(blocks)).toEqual(blocks);
  });

  it("returns [] for null, undefined, and an empty legacy string", () => {
    expect(toContentBlocks(null)).toEqual([]);
    expect(toContentBlocks(undefined)).toEqual([]);
    expect(toContentBlocks("")).toEqual([]);
  });

  it("drops malformed entries rather than throwing", () => {
    const mixed = [
      { type: "text", text: "kept" },
      { type: "text" },
      { type: "unknown_future_block" },
      null,
      "not an object",
    ] as unknown as Parameters<typeof toContentBlocks>[0];
    expect(toContentBlocks(mixed)).toEqual([{ type: "text", text: "kept" }]);
  });

  it("preserves a card block verbatim on read (#366 Active Cards)", () => {
    const card = [{ type: "card" as const, cardType: "invoice", data: { invoices: [] } }];
    expect(toContentBlocks(card)).toEqual(card);
  });
});

describe("contentToText / suggestedRepliesFrom", () => {
  it("reads a legacy string and a block array identically", () => {
    expect(contentToText("plain")).toBe("plain");
    expect(contentToText([{ type: "text", text: "plain" }])).toBe("plain");
  });

  it("joins multiple text blocks and ignores non-text ones", () => {
    expect(
      contentToText([
        { type: "text", text: "one" },
        { type: "suggested_replies", options: ["ignored"] },
        { type: "text", text: "two" },
      ]),
    ).toBe("one\n\ntwo");
  });

  it("pulls the chip options out of content, and finds none on a legacy string", () => {
    expect(suggestedRepliesFrom([{ type: "suggested_replies", options: ["a", "b"] }])).toEqual(["a", "b"]);
    expect(suggestedRepliesFrom("legacy row")).toEqual([]);
  });

  it("cardsFrom pulls every card block out of content, and finds none on a legacy string (#366)", () => {
    expect(
      cardsFrom([
        { type: "text", text: "here" },
        { type: "card", cardType: "invoice", data: { invoices: [] } },
      ]),
    ).toEqual([{ cardType: "invoice", data: { invoices: [] } }]);
    expect(cardsFrom("legacy row")).toEqual([]);
  });
});

describe("buildAssistantContent / buildUserContent", () => {
  it("emits text alone when no chips were offered", () => {
    expect(buildAssistantContent("just text")).toEqual([{ type: "text", text: "just text" }]);
  });

  it("appends a suggested_replies block after the text", () => {
    expect(buildAssistantContent("answer", ["a", "b"])).toEqual([
      { type: "text", text: "answer" },
      { type: "suggested_replies", options: ["a", "b"] },
    ]);
  });

  it("inserts card blocks between text and chips (#366)", () => {
    expect(buildAssistantContent("your invoices:", ["anything else?"], [{ cardType: "invoice", data: { invoices: [] } }])).toEqual([
      { type: "text", text: "your invoices:" },
      { type: "card", cardType: "invoice", data: { invoices: [] } },
      { type: "suggested_replies", options: ["anything else?"] },
    ]);
  });

  it("emits nothing for empty text with no chips", () => {
    expect(buildAssistantContent("")).toEqual([]);
    expect(buildUserContent("")).toEqual([]);
  });

  it("round-trips through the read helpers", () => {
    const content = buildAssistantContent("hello", ["next?"], [{ cardType: "score", data: { copilotReadiness: 44 } }]);
    expect(contentToText(content)).toBe("hello");
    expect(suggestedRepliesFrom(content)).toEqual(["next?"]);
    expect(cardsFrom(content)).toEqual([{ cardType: "score", data: { copilotReadiness: 44 } }]);
  });
});

describe("SUGGESTED_REPLIES_INSTRUCTION", () => {
  it("documents the exact token the parser accepts", () => {
    // The prompt and the parser must never drift — a reply written to the letter
    // of the instruction has to parse.
    const example = '[SUGGESTED_REPLIES: "first option" | "second option" | "third option"]';
    expect(SUGGESTED_REPLIES_INSTRUCTION).toContain(example);
    expect(parseSuggestedReplies(example)).toEqual(["first option", "second option", "third option"]);
  });
});
