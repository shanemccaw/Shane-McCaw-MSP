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
  // support-chat wraps its Anthropic call in withAiAttribution() so the metered
  // client bills the turn to the right MSP. Pass-through here — the attribution
  // values themselves are asserted in ai-usage-metering.test.ts.
  withAiAttribution: <T,>(_attribution: unknown, fn: () => T): T => fn(),
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
    innerJoin: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    groupBy: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([{ id: 99, createdAt: new Date() }]),
  },
  mspsTable: { id: "id", name: "name", status: "status", slug: "slug" },
  tenantsTable: { id: "id", mspId: "msp_id", customerName: "customer_name", domain: "domain", status: "status", tenantId: "tenant_id" },
  mspEventStoreTable: { id: "id", mspId: "msp_id", customerId: "customer_id", eventType: "event_type", occurredAt: "occurred_at", payload: "payload" },
  // #362 — customer_entitlements grounding: purchases (SOWs), subscription/
  // billing status (sales-bundle assignments), and scan/monitoring state
  // (diagnostic runs + findings), each scoped by customerId (+mspId).
  mspSowsTable: {
    customerId: "customer_id", mspId: "msp_id", title: "title", status: "status",
    amountCents: "amount_cents", signedAt: "signed_at", chargeConfirmedAt: "charge_confirmed_at",
    createdAt: "created_at",
  },
  mspSalesBundlesTable: { bundleId: "bundle_id", name: "name" },
  mspSalesBundleAssignmentsTable: {
    customerId: "customer_id", mspId: "msp_id", bundleId: "bundle_id", status: "status",
    activatedAt: "activated_at", trialExpiresAt: "trial_expires_at", assignedAt: "assigned_at",
  },
  mspDiagnosticRunsTable: {
    customerId: "customer_id", mspId: "msp_id", runId: "run_id", packageKey: "package_key",
    status: "status", startedAt: "started_at", completedAt: "completed_at",
    checksTotal: "checks_total", checksOk: "checks_ok", checksError: "checks_error", createdAt: "created_at",
  },
  mspDiagnosticFindingsTable: { runId: "run_id", severity: "severity", title: "title", createdAt: "created_at" },
  notificationsTable: { id: "id", userId: "user_id", title: "title", body: "body", type: "type", read: "read", linkPath: "link_path" },
  messagesTable: { id: "id", clientUserId: "client_user_id", senderUserId: "sender_user_id", body: "body", readByAdmin: "read_by_admin", readByClient: "read_by_client" },
  usersTable: { id: "id", role: "role", email: "email", mspId: "msp_id", tenantId: "tenant_id", mspRole: "msp_role", isActive: "is_active", canApprovePurchases: "can_approve_purchases" },
  // #363 — action layer (regenerate document / rerun scan) eligibility lookups.
  insightsGeneratedDocumentsTable: {
    id: "id", mspCustomerId: "msp_customer_id", status: "status", docType: "doc_type",
    projectId: "project_id", title: "title", createdAt: "created_at",
  },
  documentTypesTable: { key: "key", pipelineCategory: "pipeline_category", isActive: "is_active" },
  clientServicesTable: { clientUserId: "client_user_id", serviceId: "service_id", status: "status", id: "id" },
  servicesTable: { id: "id", typeAttributes: "type_attributes", fulfillmentTypeKey: "fulfillment_type_key" },
  // #366 — Active Cards: invoice/score card data, both keyed by the login (users.id).
  invoicesTable: {
    clientUserId: "client_user_id", invoiceNumber: "invoice_number", description: "description",
    amount: "amount", currency: "currency", status: "status", dueDate: "due_date", paidAt: "paid_at",
    createdAt: "created_at",
  },
  clientScoresTable: {
    clientId: "client_id", identity: "identity", security: "security", collaboration: "collaboration",
    compliance: "compliance", copilotReadiness: "copilot_readiness", updatedAt: "updated_at",
  },
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

// #363 — action layer. LIVE_RENDERED_DOC_TYPES is the only thing support-chat
// imports from portal-documents.ts; mock the module so its heavy transitive
// imports (insight-pdf.ts's PDF rendering) never load here. generateDocument/
// generateSowDocument/runDiagnostics are the real regenerate/rescan functions
// support-chat's action handlers call — their own modules pull in
// workflow-executor.ts (and beyond), so they're mocked the same way.
vi.mock("./portal-documents.ts", () => ({
  LIVE_RENDERED_DOC_TYPES: new Set(["copilot_readiness"]),
}));
vi.mock("../lib/document-engine.ts", () => ({
  generateDocument: vi.fn(),
}));
vi.mock("../lib/document-engine-sow.ts", () => ({
  generateSowDocument: vi.fn(),
}));
vi.mock("../lib/diagnostics-runner.ts", () => ({
  runDiagnostics: vi.fn(),
}));

// ── Import router after mocks ──────────────────────────────────────────────────

import supportChatRouter from "./support-chat.ts";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { db } from "@workspace/db";
import { broadcastNotification } from "../lib/sse-channels.ts";
import { listRemediableOffers } from "./portal-mission-control.ts";
import { generateDocument } from "../lib/document-engine.ts";
import { runDiagnostics } from "../lib/diagnostics-runner.ts";

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

function makeCustomerToken(overrides: Record<string, unknown> = {}): string {
  return makeToken({
    id: 10, email: "customer@co.com", role: "client",
    mspRole: "CustomerUser", mspId: 1, customerId: 42, ...overrides,
  });
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

  // ── #363: action layer (regenerate document / rerun scan) ──────────────────

  it("surfaces proposedAction:regenerate_document when the AI emits the marker and a document is eligible", async () => {
    // Blanket `.limit()` resolution — same pattern the CustomerUser-escalation
    // test above uses. Satisfies buildCustomerContext's own grounding queries
    // (loosely — it just needs a truthy customerRow[0]) AND
    // findRegenerableDocument's query, whose real fields this row also carries.
    mockDbAny["limit"].mockResolvedValue([
      { id: 501, docType: "security_posture_report", projectId: 5, title: "Security Posture Report", status: "delivered" },
    ]);
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "I can regenerate your report now. Confirm below.\n[ACTION:regenerate_document]" }],
    });

    const app = makeApp();
    const res = await request(app)
      .post("/api/msp/support/chat")
      .set("Authorization", `Bearer ${customerToken()}`)
      .send({ messages: [{ role: "user", content: "Can you regenerate my report?" }] });

    expect(res.status).toBe(200);
    expect(res.body.proposedAction).toEqual({ action: "regenerate_document", label: 'Regenerate "Security Posture Report"' });
    expect(res.body.reply).not.toMatch(/\[ACTION:/i);
    expect(res.body.reply).toContain("Confirm");
  });

  it("surfaces proposedAction:rerun_scan when the AI emits the marker and scan history exists", async () => {
    mockDbAny["limit"].mockResolvedValue([{ runId: "run-abc" }]);
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "I can re-run your scan now. Confirm below.\n[ACTION:rerun_scan]" }],
    });

    const app = makeApp();
    const res = await request(app)
      .post("/api/msp/support/chat")
      .set("Authorization", `Bearer ${customerToken()}`)
      .send({ messages: [{ role: "user", content: "Can you rerun my scan?" }] });

    expect(res.status).toBe(200);
    expect(res.body.proposedAction).toEqual({ action: "rerun_scan", label: "Re-run your latest scan" });
    expect(res.body.reply).not.toMatch(/\[ACTION:/i);
  });

  it("drops the action proposal when nothing is eligible, even if the AI emits a marker", async () => {
    // Default beforeEach mock: every `.limit()` resolves to [] — no document,
    // no scan history.
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "Regenerating now.\n[ACTION:regenerate_document]" }],
    });

    const app = makeApp();
    const res = await request(app)
      .post("/api/msp/support/chat")
      .set("Authorization", `Bearer ${customerToken()}`)
      .send({ messages: [{ role: "user", content: "regenerate my report" }] });

    expect(res.status).toBe(200);
    expect(res.body.proposedAction).toBeNull();
    expect(res.body.reply).not.toMatch(/\[ACTION:/i);
  });

  it("never surfaces an action proposal for MSP staff, even if the AI emits a marker", async () => {
    mockDbAny["limit"].mockResolvedValue([
      { id: 501, docType: "security_posture_report", projectId: 5, title: "Security Posture Report", status: "delivered" },
    ]);
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "Regenerating now.\n[ACTION:regenerate_document]" }],
    });

    const app = makeApp();
    const res = await request(app)
      .post("/api/msp/support/chat")
      .set("Authorization", `Bearer ${makeToken()}`) // default: mspRole "MSPOperator", no customerId
      .send({ messages: [{ role: "user", content: "regenerate the customer's report" }] });

    expect(res.status).toBe(200);
    expect(res.body.proposedAction).toBeNull();
    expect(res.body.reply).not.toMatch(/\[ACTION:/i);
  });

  // ── #366: Active Cards (invoice / subscription / score / data-answer) ──────

  it("surfaces a data card when the AI emits a valid [SHOW_CARD:x] marker and real data exists", async () => {
    mockDbAny["limit"]
      .mockResolvedValueOnce([{ name: "Acme Corp", domain: "acme.com", status: "active", tenantId: "tid-1" }]) // customer
      .mockResolvedValueOnce([]) // signals
      .mockResolvedValueOnce([]) // SOWs
      .mockResolvedValueOnce([]) // bundle assignments
      .mockResolvedValueOnce([]) // latest run
      .mockResolvedValueOnce([]) // last completed run
      .mockResolvedValueOnce([{
        // amount is integer cents (Git #1610, aa2bb3768) — 34900 = $349.00.
        invoiceNumber: "INV-2002", description: "Monthly monitoring", amount: 34900, currency: "usd",
        status: "paid", dueDate: new Date("2026-08-01T00:00:00Z"), paidAt: new Date("2026-08-01T00:00:00Z"),
      }]) // invoices
      .mockResolvedValueOnce([]); // score
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "Here are your invoices.\n[SHOW_CARD:invoice]" }],
    });

    const app = makeApp();
    const res = await request(app)
      .post("/api/msp/support/chat")
      .set("Authorization", `Bearer ${customerToken()}`)
      .send({ messages: [{ role: "user", content: "Can I see my invoices?" }] });

    expect(res.status).toBe(200);
    expect(res.body.reply).not.toMatch(/\[SHOW_CARD:/i);
    const cardBlock = (res.body.content as Array<Record<string, unknown>>).find((b) => b.type === "card");
    expect(cardBlock).toEqual({
      type: "card",
      cardType: "invoice",
      data: {
        invoices: [{
          invoiceNumber: "INV-2002", description: "Monthly monitoring", amount: "$349.00", currency: "usd",
          status: "paid", dueDate: "2026-08-01T00:00:00.000Z", paidAt: "2026-08-01T00:00:00.000Z",
        }],
      },
    });
  });

  it("drops the card when the AI requests one with no real data available", async () => {
    // Default beforeEach mock: every `.limit()` resolves to [] — no invoices on file.
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "Let me check.\n[SHOW_CARD:invoice]" }],
    });

    const app = makeApp();
    const res = await request(app)
      .post("/api/msp/support/chat")
      .set("Authorization", `Bearer ${customerToken()}`)
      .send({ messages: [{ role: "user", content: "Can I see my invoices?" }] });

    expect(res.status).toBe(200);
    expect(res.body.reply).not.toMatch(/\[SHOW_CARD:/i);
    const cardBlock = (res.body.content as Array<Record<string, unknown>>).find((b) => b.type === "card");
    expect(cardBlock).toBeUndefined();
  });

  it("never surfaces a card for MSP staff, even if the AI emits a marker", async () => {
    mockDbAny["limit"].mockResolvedValue([
      { invoiceNumber: "INV-1", description: null, amount: "10.00", currency: "usd", status: "paid", dueDate: null, paidAt: null },
    ]);
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "Here you go.\n[SHOW_CARD:invoice]" }],
    });

    const app = makeApp();
    const res = await request(app)
      .post("/api/msp/support/chat")
      .set("Authorization", `Bearer ${makeToken()}`) // default: mspRole "MSPOperator", no customerId
      .send({ messages: [{ role: "user", content: "show me the customer's invoices" }] });

    expect(res.status).toBe(200);
    const cardBlock = (res.body.content as Array<Record<string, unknown>>).find((b) => b.type === "card");
    expect(cardBlock).toBeUndefined();
  });

  // ── #361: suggested-reply chips + content-block shape ──────────────────────

  it("parses [SUGGESTED_REPLIES], strips it from the visible reply, and returns a suggested_replies block", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{
        type: "text",
        text: 'Your last scan finished yesterday.\n[SUGGESTED_REPLIES: "Show me the findings" | "When is the next run?"]',
      }],
    });

    const res = await request(makeApp())
      .post("/api/msp/support/chat")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ messages: [{ role: "user", content: "How did my last scan go?" }] });

    expect(res.status).toBe(200);
    expect(res.body.reply).not.toMatch(/SUGGESTED_REPLIES/);
    expect(res.body.reply).toContain("finished yesterday");
    expect(res.body.suggestedReplies).toEqual(["Show me the findings", "When is the next run?"]);
    expect(res.body.content).toEqual([
      { type: "text", text: "Your last scan finished yesterday." },
      { type: "suggested_replies", options: ["Show me the findings", "When is the next run?"] },
    ]);
  });

  it("returns a text-only content block when the model offers no chips", async () => {
    mockCreate.mockResolvedValueOnce({ content: [{ type: "text", text: "Active, 3 customers." }] });

    const res = await request(makeApp())
      .post("/api/msp/support/chat")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ messages: [{ role: "user", content: "status?" }] });

    expect(res.status).toBe(200);
    expect(res.body.suggestedReplies).toEqual([]);
    expect(res.body.content).toEqual([{ type: "text", text: "Active, 3 customers." }]);
  });

  it("accepts BOTH content shapes on the way in — legacy string and content blocks", async () => {
    mockCreate.mockResolvedValueOnce({ content: [{ type: "text", text: "Understood." }] });

    const res = await request(makeApp())
      .post("/api/msp/support/chat")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({
        messages: [
          { role: "user", content: "legacy string turn" },
          { role: "assistant", content: [{ type: "text", text: "block-shaped turn" }] },
          { role: "user", content: [{ type: "text", text: "another block turn" }] },
        ],
      });

    expect(res.status).toBe(200);
    // Both shapes must reach the model as plain text, in order.
    const calledWith = mockCreate.mock.calls[0]?.[0] as { messages: { role: string; content: string }[] };
    expect(calledWith.messages).toEqual([
      { role: "user", content: "legacy string turn" },
      { role: "assistant", content: "block-shaped turn" },
      { role: "user", content: "another block turn" },
    ]);
  });

  it("still escalates on a block-shaped user turn (the question text is flattened, not lost)", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "I don't have that.\n[ESCALATE_TO_HUMAN]" }],
    });
    mockDbAny["limit"].mockResolvedValue([{ id: 1 }]);

    const res = await request(makeApp())
      .post("/api/msp/support/chat")
      .set("Authorization", `Bearer ${makeToken()}`)
      .send({ messages: [{ role: "user", content: [{ type: "text", text: "Who owns this invoice?" }] }] });

    expect(res.status).toBe(200);
    expect(res.body.escalated).toBe(true);
    expect(res.body.reply).not.toMatch(/ESCALATE_TO_HUMAN/i);
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

  it("queues escalation ticket and returns ok", async () => {
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

// #363 — action layer confirm/execute endpoints. Both are CustomerUser-only,
// self-service on the caller's OWN tenant — customerId always comes from the
// authenticated JWT, never the request body, so there is nothing for a client
// to spoof.

describe("POST /api/msp/support/actions/regenerate-document", () => {
  const mockDbAny = db as unknown as Record<string, ReturnType<typeof vi.fn>>;
  const mockGenerate = generateDocument as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbAny["select"].mockReturnThis();
    mockDbAny["from"].mockReturnThis();
    mockDbAny["where"].mockReturnThis();
    mockDbAny["orderBy"].mockReturnThis();
    mockDbAny["limit"].mockResolvedValue([]);
  });

  it("returns 403 for a non-CustomerUser", async () => {
    const app = makeApp();
    const res = await request(app)
      .post("/api/msp/support/actions/regenerate-document")
      .set("Authorization", `Bearer ${makeToken()}`);
    expect(res.status).toBe(403);
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("returns 404 when there is no eligible document", async () => {
    const app = makeApp();
    const res = await request(app)
      .post("/api/msp/support/actions/regenerate-document")
      .set("Authorization", `Bearer ${makeCustomerToken()}`);
    expect(res.status).toBe(404);
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("regenerates the caller's own current document and streams a done frame", async () => {
    mockDbAny["limit"].mockResolvedValue([
      {
        id: 501, docType: "security_posture_report", projectId: 5, title: "Security Posture Report",
        status: "delivered", pipelineCategory: "standalone", isActive: true,
      },
    ]);
    mockGenerate.mockResolvedValue({ documentId: 501, htmlContent: "<p>ok</p>", costCents: 12, costStatus: "billed", reused: false });

    const app = makeApp();
    const res = await request(app)
      .post("/api/msp/support/actions/regenerate-document")
      .set("Authorization", `Bearer ${makeCustomerToken()}`);

    expect(res.status).toBe(200);
    expect(res.text).toContain('"type":"done"');
    expect(res.text).toContain('"documentId":501');
    expect(mockGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ mspCustomerId: 42, projectId: 5, docTypeKey: "security_posture_report", forceRegenerate: true }),
    );
  });
});

describe("POST /api/msp/support/actions/rerun-scan", () => {
  const mockDbAny = db as unknown as Record<string, ReturnType<typeof vi.fn>>;
  const mockRunDiagnostics = runDiagnostics as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbAny["select"].mockReturnThis();
    mockDbAny["from"].mockReturnThis();
    mockDbAny["where"].mockReturnThis();
    mockDbAny["innerJoin"].mockReturnThis();
    mockDbAny["orderBy"].mockReturnThis();
    mockDbAny["limit"].mockResolvedValue([]);
    mockDbAny["insert"].mockReturnThis();
    mockDbAny["values"].mockReturnThis();
    mockRunDiagnostics.mockResolvedValue(undefined);
  });

  it("returns 403 for a non-CustomerUser", async () => {
    const app = makeApp();
    const res = await request(app)
      .post("/api/msp/support/actions/rerun-scan")
      .set("Authorization", `Bearer ${makeToken()}`);
    expect(res.status).toBe(403);
    expect(mockRunDiagnostics).not.toHaveBeenCalled();
  });

  it("returns 404 when the caller's tenant cannot be resolved", async () => {
    const app = makeApp();
    const res = await request(app)
      .post("/api/msp/support/actions/rerun-scan")
      .set("Authorization", `Bearer ${makeCustomerToken()}`);
    expect(res.status).toBe(404);
    expect(mockRunDiagnostics).not.toHaveBeenCalled();
  });

  it("creates a pending run scoped to the caller's own tenant and fires runDiagnostics", async () => {
    mockDbAny["limit"].mockResolvedValue([{ id: 42, mspId: 1, tenantId: "tenant-abc" }]);

    const app = makeApp();
    const res = await request(app)
      .post("/api/msp/support/actions/rerun-scan")
      .set("Authorization", `Bearer ${makeCustomerToken()}`);

    expect(res.status).toBe(202);
    expect(res.body.status).toBe("pending");
    expect(res.body.runId).toBeTruthy();
    expect(mockRunDiagnostics).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 42, existingRunId: res.body.runId, isAssessmentTriggered: false }),
    );
  });
});
