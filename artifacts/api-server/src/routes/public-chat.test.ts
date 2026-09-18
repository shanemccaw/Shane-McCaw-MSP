/**
 * public-chat.test.ts
 *
 * Covers the deterministic public contact-form endpoint (#4625, part of #4624:
 * Decommission ShaneBot Public's AI chat):
 *   1. A valid submission writes a publicChatConversationsTable row with the
 *      submitted fields, needsReview always true, and queues a real Zoho Desk
 *      escalation ticket with the preserved never-email/push-only shape
 *      (notifyEmails: [], pushNotify: true).
 *   2. Validation rejects a submission missing name/email/message.
 *   3. The route makes NO AI call and imports NO guardrail/persona/content-block
 *      module — proved by omission: the route loads with only db + zoho-desk
 *      mocked, and no anthropic mock is registered at all.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("express-rate-limit", () => ({
  default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("@workspace/db", () => ({
  db: {
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue(undefined),
  },
  publicChatConversationsTable: { id: "id", sessionId: "session_id" },
}));

vi.mock("../lib/logger.ts", () => ({
  logger: {
    error: vi.fn(), warn: vi.fn(), info: vi.fn(),
    child: vi.fn(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() })),
  },
}));

const mockEnqueueEscalationTicket = vi.fn().mockResolvedValue({ queued: true, jobId: "job-1", jobType: "zoho_desk_create_ticket" });
vi.mock("../lib/zoho-desk.ts", () => ({
  enqueueEscalationTicket: (...args: unknown[]) => mockEnqueueEscalationTicket(...args),
}));

import express from "express";
import request from "supertest";
import publicChatRouter from "./public-chat.ts";
import { db } from "@workspace/db";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", publicChatRouter);
  return app;
}

const mockDb = db as unknown as Record<string, ReturnType<typeof vi.fn>>;

/** The single insert payload captured this test. */
function insertPayload(): Record<string, unknown> | undefined {
  return mockDb["values"].mock.calls[0]?.[0] as Record<string, unknown> | undefined;
}

const validSubmission = {
  name: "Jane Doe",
  email: "jane@co.com",
  company: "Acme",
  serviceInterest: "Assessment",
  message: "I'd like to talk about the security assessment for my company.",
};

describe("POST /api/public-chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb["insert"].mockReturnThis();
    mockDb["values"].mockResolvedValue(undefined);
    mockEnqueueEscalationTicket.mockResolvedValue({ queued: true, jobId: "job-1", jobType: "zoho_desk_create_ticket" });
  });

  it("valid submission: stores the row with needsReview always true, and queues a Zoho Desk ticket (never email)", async () => {
    const res = await request(makeApp()).post("/api/public-chat").send(validSubmission);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });

    const payload = insertPayload();
    expect(payload).toBeTruthy();
    expect(payload?.contactName).toBe("Jane Doe");
    expect(payload?.contactEmail).toBe("jane@co.com");
    expect(payload?.contactCompany).toBe("Acme");
    expect(payload?.serviceInterest).toBe("Assessment");
    expect(payload?.requestSummary).toBe(validSubmission.message);
    expect(payload?.needsReview).toBe(true);
    expect(payload?.declinedPersonalTopic).toBe(false);
    expect(payload?.sessionId).toBeTruthy();

    expect(mockEnqueueEscalationTicket).toHaveBeenCalledTimes(1);
    const ticketArgs = mockEnqueueEscalationTicket.mock.calls[0]?.[0];
    expect(ticketArgs.contactEmail).toBe("jane@co.com");
    expect(ticketArgs.contactName).toBe("Jane Doe");
    expect(ticketArgs.notifyEmails).toEqual([]);
    expect(ticketArgs.pushNotify).toBe(true);
  });

  it("optional fields omitted: still succeeds, company/serviceInterest land as null", async () => {
    const res = await request(makeApp())
      .post("/api/public-chat")
      .send({ name: "Bob Smith", email: "bob@example.com", message: "Do you support hybrid Exchange?" });

    expect(res.status).toBe(200);
    const payload = insertPayload();
    expect(payload?.contactCompany).toBeNull();
    expect(payload?.serviceInterest).toBeNull();
    expect(mockEnqueueEscalationTicket).toHaveBeenCalledTimes(1);
  });

  it("rejects a submission missing name", async () => {
    const res = await request(makeApp())
      .post("/api/public-chat")
      .send({ email: "jane@co.com", message: "hello" });
    expect(res.status).toBe(400);
    expect(mockDb["insert"]).not.toHaveBeenCalled();
    expect(mockEnqueueEscalationTicket).not.toHaveBeenCalled();
  });

  it("rejects a submission missing/invalid email", async () => {
    const res = await request(makeApp())
      .post("/api/public-chat")
      .send({ name: "Jane Doe", email: "not-an-email", message: "hello" });
    expect(res.status).toBe(400);
    expect(mockDb["insert"]).not.toHaveBeenCalled();
  });

  it("rejects a submission missing message", async () => {
    const res = await request(makeApp())
      .post("/api/public-chat")
      .send({ name: "Jane Doe", email: "jane@co.com" });
    expect(res.status).toBe(400);
    expect(mockDb["insert"]).not.toHaveBeenCalled();
  });

  it("storage failure returns 503 and skips the escalation ticket", async () => {
    mockDb["values"].mockRejectedValueOnce(new Error("db down"));
    const res = await request(makeApp()).post("/api/public-chat").send(validSubmission);
    expect(res.status).toBe(503);
    expect(mockEnqueueEscalationTicket).not.toHaveBeenCalled();
  });

  it("escalation ticket failure is logged but does not fail the visitor's submission", async () => {
    mockEnqueueEscalationTicket.mockRejectedValueOnce(new Error("zoho down"));
    const res = await request(makeApp()).post("/api/public-chat").send(validSubmission);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });
});
