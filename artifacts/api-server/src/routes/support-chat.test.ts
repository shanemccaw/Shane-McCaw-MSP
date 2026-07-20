/**
 * support-chat.test.ts
 *
 * Tests for the AI Support Chat routes:
 *   POST /api/msp/support/chat     — grounded answer + escalation detection
 *   POST /api/msp/support/escalate — explicit human-escalation handoff
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

// ── Module mocks ──────────────────────────────────────────────────────────────
// All factory functions must be self-contained (vi.mock is hoisted — no external vars)

vi.mock("@workspace/integrations-anthropic-ai", () => ({
  anthropic: {
    messages: {
      create: vi.fn(),
    },
  },
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    groupBy: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([{ id: 99, createdAt: new Date() }]),
  },
  mspsTable: { id: "id", name: "name", status: "status", slug: "slug" },
  mspCustomersTable: { id: "id", mspId: "msp_id", name: "name", domain: "domain", status: "status", tenantId: "tenant_id" },
  mspEventStoreTable: { id: "id", mspId: "msp_id", customerId: "customer_id", eventType: "event_type", occurredAt: "occurred_at", payload: "payload" },
  notificationsTable: { id: "id", userId: "user_id", title: "title", body: "body", type: "type", read: "read", linkPath: "link_path" },
  messagesTable: { id: "id", clientUserId: "client_user_id", senderUserId: "sender_user_id", body: "body", readByAdmin: "read_by_admin", readByClient: "read_by_client" },
  usersTable: { id: "id", role: "role" },
}));

vi.mock("../lib/sse-channels.ts", () => ({
  broadcastNotification: vi.fn(),
  broadcastUnreadCount: vi.fn(),
}));

vi.mock("../lib/audit.ts", () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/logger.ts", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), child: vi.fn(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() })) },
}));

// listRemediableOffers is the only thing support-chat imports from the
// mission-control route; mock the module so its heavy transitive imports
// (engine registry, config-pack orchestrator) never load in this unit test.
vi.mock("./portal-mission-control.ts", () => ({
  listRemediableOffers: vi.fn().mockResolvedValue([]),
}));

// ── Import router after mocks ──────────────────────────────────────────────────

import supportChatRouter from "./support-chat.ts";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { db } from "@workspace/db";
import { broadcastNotification } from "../lib/sse-channels.ts";
import { listRemediableOffers } from "./portal-mission-control.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

const JWT_SECRET = "test-secret";
process.env.JWT_SECRET = JWT_SECRET;

function makeToken(overrides: Record<string, unknown> = {}): string {
  return jwt.sign(
    { id: 5, email: "op@msp.com", role: "client", mspRole: "MSPOperator", mspId: 1, ...overrides },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", supportChatRouter);
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/msp/support/chat", () => {
  const mockCreate = anthropic.messages.create as ReturnType<typeof vi.fn>;
  const mockRemediable = listRemediableOffers as ReturnType<typeof vi.fn>;
  const mockDbAny = db as unknown as Record<string, ReturnType<typeof vi.fn>>;

  const customerToken = () =>
    makeToken({ id: 10, email: "customer@co.com", role: "client", mspRole: "CustomerUser", mspId: 1, customerId: 42 });

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbAny["select"].mockReturnThis();
    mockDbAny["from"].mockReturnThis();
    mockDbAny["where"].mockReturnThis();
    mockDbAny["groupBy"].mockReturnThis();
    mockDbAny["orderBy"].mockReturnThis();
    mockDbAny["limit"].mockResolvedValue([]);
    mockDbAny["insert"].mockReturnThis();
    mockDbAny["values"].mockReturnThis();
    mockDbAny["returning"].mockResolvedValue([{ id: 99, createdAt: new Date() }]);
    mockRemediable.mockResolvedValue([]);
  });

  it("returns 400 when messages array is missing", async () => {
    const app = makeApp();
    const res = await request(app)
      .post("/api/msp/support/chat")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/messages array/i);
  });

  it("returns 400 when messages is empty array", async () => {
    const app = makeApp();
    const res = await request(app)
      .post("/api/msp/support/chat")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ messages: [] });
    expect(res.status).toBe(400);
  });

  it("returns 401 without auth token", async () => {
    const app = makeApp();
    const res = await request(app)
      .post("/api/msp/support/chat")
      .send({ messages: [{ role: "user", content: "hello" }] });
    expect(res.status).toBe(401);
  });

  it("returns AI reply when answer is confident (no escalation)", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "Your MSP status is active with 3 customers." }],
    });

    const app = makeApp();
    const res = await request(app)
      .post("/api/msp/support/chat")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ messages: [{ role: "user", content: "What is my MSP status?" }] });

    expect(res.status).toBe(200);
    expect(res.body.reply).toContain("active");
    expect(res.body.escalated).toBe(false);
    expect(broadcastNotification).not.toHaveBeenCalled();
  });

  it("detects [ESCALATE_TO_HUMAN] and strips it from visible reply", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "I don't have that information.\n[ESCALATE_TO_HUMAN]" }],
    });
    // Simulate admin user found
    mockDbAny["limit"].mockResolvedValue([{ id: 1 }]);

    const app = makeApp();
    const res = await request(app)
      .post("/api/msp/support/chat")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ messages: [{ role: "user", content: "How do I cancel my plan?" }] });

    expect(res.status).toBe(200);
    expect(res.body.escalated).toBe(true);
    expect(res.body.reply).not.toMatch(/\[ESCALATE_TO_HUMAN\]/i);
    expect(res.body.reply).toBeTruthy();
  });

  it("returns 503 when Anthropic API fails", async () => {
    mockCreate.mockRejectedValueOnce(new Error("API overloaded"));

    const app = makeApp();
    const res = await request(app)
      .post("/api/msp/support/chat")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ messages: [{ role: "user", content: "Hello?" }] });

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/temporarily unavailable/i);
  });

  it("CustomerUser gets escalation triggered", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "I cannot help with that.\n[ESCALATE_TO_HUMAN]" }],
    });
    mockDbAny["limit"].mockResolvedValue([{ id: 1 }]);

    const app = makeApp();
    const token = makeToken({
      id: 10, email: "customer@co.com", role: "client",
      mspRole: "CustomerUser", mspId: 1, customerId: 42,
    });

    const res = await request(app)
      .post("/api/msp/support/chat")
      .set("Authorization", `Bearer ${token}`)
      .send({ messages: [{ role: "user", content: "I want a refund." }] });

    expect(res.status).toBe(200);
    expect(res.body.escalated).toBe(true);
    expect(res.body.reply).not.toMatch(/\[ESCALATE_TO_HUMAN\]/i);
  });

  it("surfaces proposedRemediation when the AI emits a valid, eligible marker", async () => {
    mockRemediable.mockResolvedValue([
      { offerId: 7, offerTitle: "Entra ID Quick-Start", offerRationale: null, packKey: "quickstart-v1", relatedFindingTitles: ["MFA not enforced"] },
    ]);
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "I can run the Entra ID Quick-Start to fix that. Confirm below.\n[PROPOSE_REMEDIATION:7]" }],
    });

    const app = makeApp();
    const res = await request(app)
      .post("/api/msp/support/chat")
      .set("Authorization", `Bearer ${customerToken()}`)
      .send({ messages: [{ role: "user", content: "Can you fix the MFA finding?" }] });

    expect(res.status).toBe(200);
    expect(res.body.proposedRemediation).toEqual({ offerId: 7, offerTitle: "Entra ID Quick-Start", packKey: "quickstart-v1" });
    // Marker must be stripped from what the user sees.
    expect(res.body.reply).not.toMatch(/PROPOSE_REMEDIATION/i);
    expect(res.body.reply).toContain("Confirm");
  });

  it("drops the proposal when the AI emits an offerId that is not eligible", async () => {
    mockRemediable.mockResolvedValue([
      { offerId: 7, offerTitle: "Entra ID Quick-Start", offerRationale: null, packKey: "quickstart-v1", relatedFindingTitles: [] },
    ]);
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "Sure.\n[PROPOSE_REMEDIATION:999]" }],
    });

    const app = makeApp();
    const res = await request(app)
      .post("/api/msp/support/chat")
      .set("Authorization", `Bearer ${customerToken()}`)
      .send({ messages: [{ role: "user", content: "fix something" }] });

    expect(res.status).toBe(200);
    expect(res.body.proposedRemediation).toBeNull();
    expect(res.body.reply).not.toMatch(/PROPOSE_REMEDIATION/i);
  });

  it("never surfaces a proposal for an ineligible tenant, even if the AI emits a marker", async () => {
    // listRemediableOffers returns [] for a non-testbed / ineligible tenant.
    mockRemediable.mockResolvedValue([]);
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "Running it now.\n[PROPOSE_REMEDIATION:7]" }],
    });

    const app = makeApp();
    const res = await request(app)
      .post("/api/msp/support/chat")
      .set("Authorization", `Bearer ${customerToken()}`)
      .send({ messages: [{ role: "user", content: "fix the MFA finding" }] });

    expect(res.status).toBe(200);
    expect(res.body.proposedRemediation).toBeNull();
    expect(res.body.reply).not.toMatch(/PROPOSE_REMEDIATION/i);
  });

  it("trims conversation to last 20 messages before sending to AI", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "Understood." }],
    });

    const app = makeApp();
    const longHistory = Array.from({ length: 25 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `message ${i}`,
    }));

    const res = await request(app)
      .post("/api/msp/support/chat")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ messages: longHistory });

    expect(res.status).toBe(200);
    const calledWith = mockCreate.mock.calls[0]?.[0] as { messages: unknown[] } | undefined;
    expect(calledWith?.messages.length).toBeLessThanOrEqual(20);
  });
});

describe("POST /api/msp/support/escalate", () => {
  const mockDbAny = db as unknown as Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbAny["select"].mockReturnThis();
    mockDbAny["from"].mockReturnThis();
    mockDbAny["where"].mockReturnThis();
    mockDbAny["limit"].mockResolvedValue([{ id: 1 }]);
    mockDbAny["insert"].mockReturnThis();
    mockDbAny["values"].mockReturnThis();
    mockDbAny["returning"].mockResolvedValue([{ id: 99, createdAt: new Date() }]);
  });

  it("returns 401 without auth", async () => {
    const app = makeApp();
    const res = await request(app)
      .post("/api/msp/support/escalate")
      .send({ question: "help me" });
    expect(res.status).toBe(401);
  });

  it("creates escalation notification and returns ok", async () => {
    const app = makeApp();
    const res = await request(app)
      .post("/api/msp/support/escalate")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ question: "How do I upgrade my subscription?" });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.message).toMatch(/human/i);
  });

  it("handles missing question body gracefully", async () => {
    const app = makeApp();
    const res = await request(app)
      .post("/api/msp/support/escalate")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
