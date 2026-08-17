/**
 * shanebot-engine.test.ts
 *
 * Unit tests for the ShaneBot Engine Core (#1097): the code-canonical instance
 * config, persona/prompt assembly, and — most importantly — the action_router that
 * gates every model-emitted action against the emitting instance's allowedActions
 * BEFORE anything can fire. A public instance ([]) must authorize nothing.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// The engine needs @workspace/db at runtime for its grounding builders AND (#361)
// the bot_conversations storage helpers. A single generic chainable mock, same
// pattern as public-chat.test.ts/support-chat.test.ts — table identity doesn't
// matter to these tests, only call sequencing and payload shape.
vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
  },
  servicesTable: {},
  mspsTable: {},
  tenantsTable: {},
  mspEventStoreTable: {},
  botInstancesTable: { id: "id", slug: "slug" },
  botConversationsTable: { sessionId: "session_id", transcript: "transcript" },
}));

vi.mock("./logger.ts", () => ({
  logger: {
    error: vi.fn(), warn: vi.fn(), info: vi.fn(),
    child: vi.fn(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() })),
  },
}));

import {
  BOT_INSTANCES,
  resolveInstance,
  resolvePersonaPrompt,
  assembleSystemPrompt,
  parseRequestedActions,
  routeActions,
  routeRequestedActions,
  stripActionTokens,
  upsertBotConversation,
  getBotConversationTranscript,
  getBotConversationTranscripts,
} from "./shanebot-engine.ts";
import { db } from "@workspace/db";

describe("BOT_INSTANCES — the two permanent instances", () => {
  it("ShaneBot Public: unauthenticated, live_catalog, NO allowed actions, platform cost", () => {
    const pub = resolveInstance("shanebot_public");
    expect(pub.authMode).toBe("public");
    expect(pub.groundingSource).toBe("live_catalog");
    expect(pub.allowedActions).toEqual([]);
    expect(pub.costOwner).toBe("platform");
    expect(pub.personaSurface).toBe("public");
  });

  it("ShaneBot Paid: portal-authenticated, customer_entitlements, both actions, msp cost", () => {
    const paid = resolveInstance("shanebot_paid");
    expect(paid.authMode).toBe("portal_authenticated");
    expect(paid.groundingSource).toBe("customer_entitlements");
    expect(paid.allowedActions).toEqual(["regenerate_document", "rerun_scan"]);
    expect(paid.costOwner).toBe("msp");
    expect(paid.personaSurface).toBe("portal");
  });

  it("has exactly the two permanent instances, no more", () => {
    expect(Object.keys(BOT_INSTANCES).sort()).toEqual(["shanebot_paid", "shanebot_public"]);
  });
});

describe("action_router: parseRequestedActions", () => {
  it("parses a single [ACTION:x] token", () => {
    expect(parseRequestedActions("Done.\n[ACTION:rerun_scan]")).toEqual(["rerun_scan"]);
  });

  it("parses multiple, lowercases, and de-dupes in first-seen order", () => {
    const text = "[ACTION:Regenerate_Document] then [ACTION:rerun_scan] and again [ACTION:regenerate_document]";
    expect(parseRequestedActions(text)).toEqual(["regenerate_document", "rerun_scan"]);
  });

  it("returns [] when there is no token, and never throws on empty/undefined", () => {
    expect(parseRequestedActions("just a normal reply")).toEqual([]);
    expect(parseRequestedActions("")).toEqual([]);
    // @ts-expect-error — defensively tolerant of a non-string at runtime.
    expect(parseRequestedActions(undefined)).toEqual([]);
  });
});

describe("action_router: routeActions — allowedActions gate", () => {
  const paid = resolveInstance("shanebot_paid");
  const pub = resolveInstance("shanebot_public");

  it("authorizes actions in the paid instance's allowedActions", () => {
    expect(routeActions(paid, ["regenerate_document", "rerun_scan"])).toEqual([
      { action: "regenerate_document", authorized: true },
      { action: "rerun_scan", authorized: true },
    ]);
  });

  it("denies an unknown/hallucinated action even on the paid instance", () => {
    expect(routeActions(paid, ["delete_tenant"])).toEqual([
      { action: "delete_tenant", authorized: false },
    ]);
  });

  it("PUBLIC instance ([] allowedActions) authorizes NOTHING", () => {
    expect(routeActions(pub, ["regenerate_document", "rerun_scan"])).toEqual([
      { action: "regenerate_document", authorized: false },
      { action: "rerun_scan", authorized: false },
    ]);
  });
});

describe("action_router: routeRequestedActions (parse + gate) and stripActionTokens", () => {
  it("parses tokens from model text and gates them for the instance", () => {
    const paid = resolveInstance("shanebot_paid");
    const text = "I'll rerun it.\n[ACTION:rerun_scan] [ACTION:delete_everything]";
    expect(routeRequestedActions(paid, text)).toEqual([
      { action: "rerun_scan", authorized: true },
      { action: "delete_everything", authorized: false },
    ]);
  });

  it("strips every [ACTION:x] token from the visible reply", () => {
    const stripped = stripActionTokens("Regenerating now. [ACTION:regenerate_document]");
    expect(stripped).toBe("Regenerating now.");
    expect(stripped).not.toMatch(/ACTION/);
  });
});

describe("prompt assembly", () => {
  it("resolvePersonaPrompt renders the instance's persona voice", () => {
    const prompt = resolvePersonaPrompt(resolveInstance("shanebot_public"));
    expect(prompt).toContain("ShaneBot");
    expect(prompt).toContain("WHO YOU ARE");
  });

  it("assembleSystemPrompt stitches persona + identity + body + the suggested-replies instruction", () => {
    const prompt = assembleSystemPrompt({
      instance: resolveInstance("shanebot_paid"),
      identity: "customer user for Acme",
      body: "=== PLATFORM DATA ===\nnone\n=== END ===",
    });
    expect(prompt).toContain("ShaneBot"); // persona voice
    expect(prompt).toContain("You are talking to a customer user for Acme.");
    expect(prompt).toContain("=== PLATFORM DATA ===");
    expect(prompt).toContain("SUGGESTED REPLIES"); // shared control-token instruction
  });
});

// ── Conversation storage (#361) ─────────────────────────────────────────────────
// upsertBotConversation resolves the instance's real bot_instances.id (cached
// in-process) then upserts bot_conversations by sessionId. Tests below run in
// file order deliberately: the cache is real module state, so "shanebot_paid"'s
// id is resolved once and reused by the very next test.

describe("conversation storage (#361): upsertBotConversation", () => {
  const mockDb = db as unknown as Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb["select"].mockReturnThis();
    mockDb["from"].mockReturnThis();
    mockDb["where"].mockReturnThis();
    mockDb["limit"].mockResolvedValue([]);
    mockDb["insert"].mockReturnThis();
    mockDb["values"].mockReturnThis();
    mockDb["onConflictDoUpdate"].mockResolvedValue(undefined);
  });

  it("resolves the instance id from bot_instances, then upserts the transcript", async () => {
    mockDb["limit"].mockResolvedValueOnce([{ id: 99 }]); // shanebot_paid, not yet cached
    const transcript = [
      { role: "user" as const, content: [{ type: "text" as const, text: "hi" }], at: "2026-08-17T00:00:00.000Z" },
    ];

    await upsertBotConversation({ slug: "shanebot_paid", sessionId: "sess-1", transcript });

    expect(mockDb["values"]).toHaveBeenCalledWith({
      instanceId: 99,
      sessionId: "sess-1",
      transcript,
      messageCount: 1,
    });
    expect(mockDb["onConflictDoUpdate"]).toHaveBeenCalledWith(
      expect.objectContaining({ target: expect.anything() }),
    );
  });

  it("caches the resolved id — a second upsert for the same slug skips the bot_instances lookup", async () => {
    const transcript = [
      { role: "assistant" as const, content: [{ type: "text" as const, text: "again" }], at: "2026-08-17T00:00:01.000Z" },
    ];

    await upsertBotConversation({ slug: "shanebot_paid", sessionId: "sess-2", transcript });

    expect(mockDb["select"]).not.toHaveBeenCalled(); // no fresh bot_instances query
    expect(mockDb["values"]).toHaveBeenCalledWith({
      instanceId: 99, // same cached id as the previous test
      sessionId: "sess-2",
      transcript,
      messageCount: 1,
    });
  });

  it("throws — not silently no-ops — when the instance row isn't seeded yet", async () => {
    mockDb["limit"].mockResolvedValueOnce([]); // shanebot_public, not yet cached, and not found
    await expect(
      upsertBotConversation({ slug: "shanebot_public", sessionId: "sess-3", transcript: [] }),
    ).rejects.toThrow(/no bot_instances row/);
    expect(mockDb["insert"]).not.toHaveBeenCalled();
  });
});

describe("conversation storage (#361): read helpers degrade to empty rather than throw", () => {
  const mockDb = db as unknown as Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb["select"].mockReturnThis();
    mockDb["from"].mockReturnThis();
    mockDb["where"].mockReturnThis();
    mockDb["limit"].mockResolvedValue([]);
  });

  it("getBotConversationTranscript returns the stored transcript", async () => {
    const transcript = [
      { role: "assistant" as const, content: [{ type: "text" as const, text: "hey" }], at: "2026-08-17T00:00:00.000Z" },
    ];
    mockDb["limit"].mockResolvedValueOnce([{ transcript }]);
    await expect(getBotConversationTranscript("sess-x")).resolves.toEqual(transcript);
  });

  it("getBotConversationTranscript returns null when there is no matching row", async () => {
    await expect(getBotConversationTranscript("sess-missing")).resolves.toBeNull();
  });

  it("getBotConversationTranscript swallows a query failure and returns null (never throws)", async () => {
    mockDb["limit"].mockRejectedValueOnce(new Error('relation "bot_conversations" does not exist'));
    await expect(getBotConversationTranscript("sess-y")).resolves.toBeNull();
  });

  it("getBotConversationTranscripts batches multiple sessions into a Map", async () => {
    const t1 = [{ role: "user" as const, content: [{ type: "text" as const, text: "a" }], at: "2026-08-17T00:00:00.000Z" }];
    mockDb["limit"].mockResolvedValueOnce([{ sessionId: "s1", transcript: t1 }]);

    const map = await getBotConversationTranscripts(["s1", "s2"]);
    expect(map.get("s1")).toEqual(t1);
    expect(map.has("s2")).toBe(false);
  });

  it("getBotConversationTranscripts returns an empty Map for an empty input, with no query at all", async () => {
    const map = await getBotConversationTranscripts([]);
    expect(map.size).toBe(0);
    expect(mockDb["select"]).not.toHaveBeenCalled();
  });

  it("getBotConversationTranscripts swallows a query failure and returns an empty Map (never throws)", async () => {
    mockDb["limit"].mockRejectedValueOnce(new Error("connection refused"));
    const map = await getBotConversationTranscripts(["s1"]);
    expect(map.size).toBe(0);
  });
});
