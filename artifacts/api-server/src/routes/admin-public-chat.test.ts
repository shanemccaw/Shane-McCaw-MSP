/**
 * admin-public-chat.test.ts
 *
 * Covers the #361 storage-migration seam this route sits on: the review queue's
 * OWN row (public_chat_conversations) no longer carries the transcript — it's
 * merged in from bot_conversations (shanebot-engine.ts) by sessionId, but the
 * response shape ChatQueue.tsx already reads (`messages` on both the list preview
 * and the detail view) must stay unchanged.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

/** Rows the mocked select chain resolves, in call order. */
let selectQueue: unknown[][] = [];

vi.mock("@workspace/db", () => {
  const makeChain = (): Record<string, unknown> => {
    const chain: Record<string, unknown> = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      orderBy: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      offset: vi.fn(() => chain),
      set: vi.fn(() => chain),
      returning: vi.fn(() => Promise.resolve(selectQueue.shift() ?? [])),
      then: (resolve: (v: unknown) => unknown) => resolve(selectQueue.shift() ?? []),
    };
    return chain;
  };

  return {
    db: { select: vi.fn(() => makeChain()), update: vi.fn(() => makeChain()) },
    publicChatConversationsTable: {
      id: "id", sessionId: "session_id", needsReview: "needs_review",
      reviewStatus: "review_status", updatedAt: "updated_at",
    },
  };
});

const { mockGetTranscript, mockGetTranscripts } = vi.hoisted(() => ({
  mockGetTranscript: vi.fn(),
  mockGetTranscripts: vi.fn(),
}));
vi.mock("../lib/shanebot-engine.ts", () => ({
  getBotConversationTranscript: mockGetTranscript,
  getBotConversationTranscripts: mockGetTranscripts,
}));

vi.mock("../middlewares/requireAuth.ts", () => ({
  requireAdmin: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

vi.mock("../lib/logger.ts", () => ({
  logger: {
    error: vi.fn(), warn: vi.fn(), info: vi.fn(),
    child: vi.fn(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() })),
  },
}));

import router from "./admin-public-chat.ts";

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  return app;
}

describe("GET /api/admin/public-chat/conversations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectQueue = [];
    mockGetTranscripts.mockResolvedValue(new Map());
  });

  it("builds lastMessage from bot_conversations, not a stale row.messages field", async () => {
    selectQueue = [
      [{ id: 1, sessionId: "sess-1", messageCount: 2, needsReview: true, reviewReason: "purchase_intent",
         reviewStatus: "new", declinedPersonalTopic: false, contactName: null, contactEmail: "a@b.com",
         contactCompany: null, serviceInterest: null, createdAt: new Date(), updatedAt: new Date() }],
      [{ n: 1 }],
    ];
    mockGetTranscripts.mockResolvedValueOnce(
      new Map([["sess-1", [
        { role: "user", content: [{ type: "text", text: "I want to buy the assessment" }], at: "2026-08-17T00:00:00.000Z" },
      ]]]),
    );

    const res = await request(makeApp()).get("/api/admin/public-chat/conversations");

    expect(res.status).toBe(200);
    expect(res.body.conversations).toHaveLength(1);
    expect(res.body.conversations[0].lastMessage).toBe("I want to buy the assessment");
    expect(mockGetTranscripts).toHaveBeenCalledWith(["sess-1"]);
  });

  it("shows no preview for a session bot_conversations has no transcript for", async () => {
    selectQueue = [
      [{ id: 2, sessionId: "sess-2", messageCount: 0, needsReview: false, reviewReason: null,
         reviewStatus: "new", declinedPersonalTopic: false, contactName: null, contactEmail: null,
         contactCompany: null, serviceInterest: null, createdAt: new Date(), updatedAt: new Date() }],
      [{ n: 1 }],
    ];
    // getBotConversationTranscripts default mock resolves an empty Map (beforeEach).

    const res = await request(makeApp()).get("/api/admin/public-chat/conversations");

    expect(res.status).toBe(200);
    expect(res.body.conversations[0].lastMessage).toBeNull();
  });
});

describe("GET /api/admin/public-chat/conversations/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectQueue = [];
  });

  it("merges the bot_conversations transcript into the response's messages field", async () => {
    selectQueue = [
      [{ id: 5, sessionId: "sess-5", messages: [], needsReview: true, reviewStatus: "new" }],
    ];
    const transcript = [
      { role: "user", content: [{ type: "text", text: "Tell me about monitoring" }], at: "2026-08-17T00:00:00.000Z" },
      { role: "assistant", content: [{ type: "text", text: "Monitoring runs continuously." }], at: "2026-08-17T00:00:01.000Z" },
    ];
    mockGetTranscript.mockResolvedValueOnce(transcript);

    const res = await request(makeApp()).get("/api/admin/public-chat/conversations/5");

    expect(res.status).toBe(200);
    expect(res.body.messages).toEqual(transcript);
    expect(mockGetTranscript).toHaveBeenCalledWith("sess-5");
  });

  it("returns an empty messages array (not a crash) when bot_conversations has no row yet", async () => {
    selectQueue = [
      [{ id: 6, sessionId: "sess-6", messages: [], needsReview: false, reviewStatus: "new" }],
    ];
    mockGetTranscript.mockResolvedValueOnce(null);

    const res = await request(makeApp()).get("/api/admin/public-chat/conversations/6");

    expect(res.status).toBe(200);
    expect(res.body.messages).toEqual([]);
  });

  it("404s when the conversation row itself doesn't exist", async () => {
    selectQueue = [[]];
    const res = await request(makeApp()).get("/api/admin/public-chat/conversations/999");
    expect(res.status).toBe(404);
    expect(mockGetTranscript).not.toHaveBeenCalled();
  });
});
