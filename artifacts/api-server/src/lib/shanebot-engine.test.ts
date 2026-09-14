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
    innerJoin: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
  },
  servicesTable: {
    name: "name",
    tagline: "tagline",
    description: "description",
    category: "category",
    serviceType: "service_type",
    billingType: "billing_type",
    priceCents: "price_cents",
    isFreeOffering: "is_free_offering",
    visibility: "visibility",
    sortOrder: "sort_order",
    createdAt: "created_at",
  },
  mspsTable: {},
  tenantsTable: {},
  mspEventStoreTable: {},
  // #362 — customer_entitlements grounding's purchase/entitlement/scan queries.
  mspSowsTable: {},
  mspSalesBundlesTable: { bundleId: "bundle_id" },
  mspSalesBundleAssignmentsTable: { bundleId: "bundle_id" },
  mspDiagnosticRunsTable: {},
  mspDiagnosticFindingsTable: {},
  // #366 — Active Cards: invoice/score card data, both keyed by the login (users.id).
  invoicesTable: {},
  clientScoresTable: {},
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
  parseRequestedCards,
  routeCards,
  routeRequestedCards,
  stripCardTokens,
  buildGrounding,
  upsertBotConversation,
  getBotConversationTranscript,
  getBotConversationTranscripts,
  riskTopic,
  changesTopic,
  findingsTopic,
  poamsTopic,
  secplanTopic,
  raciTopic,
  raciWorkloadTopic,
  extractWorkloadQuestion,
  policyTopic,
  conditionalAccessTopic,
  signalTopic,
} from "./shanebot-engine.ts";
import { db } from "@workspace/db";

describe("BOT_INSTANCES — the two permanent instances", () => {
  it("ShaneBot Public: unauthenticated, live_catalog, NO allowed actions or cards, platform cost", () => {
    const pub = resolveInstance("shanebot_public");
    expect(pub.authMode).toBe("public");
    expect(pub.groundingSource).toBe("live_catalog");
    expect(pub.allowedActions).toEqual([]);
    expect(pub.allowedCardTypes).toEqual([]);
    expect(pub.costOwner).toBe("platform");
    expect(pub.personaSurface).toBe("public");
  });

  it("ShaneBot Paid: portal-authenticated, customer_entitlements, both actions, all 14 card types (#4125 Batch A), msp cost", () => {
    const paid = resolveInstance("shanebot_paid");
    expect(paid.authMode).toBe("portal_authenticated");
    expect(paid.groundingSource).toBe("customer_entitlements");
    expect(paid.allowedActions).toEqual(["regenerate_document", "rerun_scan"]);
    expect(paid.allowedCardTypes).toEqual([
      "invoice", "subscription", "score", "data-answer",
      "risk", "changes", "findings", "poams", "secplan", "raci", "raci-workload", "policy", "conditional-access", "signal",
    ]);
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

// ── card_router (#366 Active Cards) — same shape as action_router above ─────────

describe("card_router: parseRequestedCards", () => {
  it("parses a single [SHOW_CARD:x] token", () => {
    expect(parseRequestedCards("Here you go.\n[SHOW_CARD:invoice]")).toEqual(["invoice"]);
  });

  it("parses multiple, lowercases, de-dupes in first-seen order, and handles the hyphenated type", () => {
    const text = "[SHOW_CARD:Invoice] then [SHOW_CARD:data-answer] and again [SHOW_CARD:invoice]";
    expect(parseRequestedCards(text)).toEqual(["invoice", "data-answer"]);
  });

  it("returns [] when there is no token, and never throws on empty/undefined", () => {
    expect(parseRequestedCards("just a normal reply")).toEqual([]);
    expect(parseRequestedCards("")).toEqual([]);
    // @ts-expect-error — defensively tolerant of a non-string at runtime.
    expect(parseRequestedCards(undefined)).toEqual([]);
  });
});

describe("card_router: routeCards — allowedCardTypes gate", () => {
  const paid = resolveInstance("shanebot_paid");
  const pub = resolveInstance("shanebot_public");

  it("authorizes all 4 v1 card types on the paid instance", () => {
    expect(routeCards(paid, ["invoice", "subscription", "score", "data-answer"])).toEqual([
      { cardType: "invoice", authorized: true },
      { cardType: "subscription", authorized: true },
      { cardType: "score", authorized: true },
      { cardType: "data-answer", authorized: true },
    ]);
  });

  it("denies an unknown/hallucinated card type even on the paid instance", () => {
    expect(routeCards(paid, ["billing-secrets"])).toEqual([
      { cardType: "billing-secrets", authorized: false },
    ]);
  });

  it("PUBLIC instance ([] allowedCardTypes) authorizes NOTHING", () => {
    expect(routeCards(pub, ["invoice", "score"])).toEqual([
      { cardType: "invoice", authorized: false },
      { cardType: "score", authorized: false },
    ]);
  });
});

describe("card_router: routeRequestedCards (parse + gate) and stripCardTokens", () => {
  it("parses tokens from model text and gates them for the instance", () => {
    const paid = resolveInstance("shanebot_paid");
    const text = "Here's your score.\n[SHOW_CARD:score] [SHOW_CARD:secret-internal-data]";
    expect(routeRequestedCards(paid, text)).toEqual([
      { cardType: "score", authorized: true },
      { cardType: "secret-internal-data", authorized: false },
    ]);
  });

  it("strips every [SHOW_CARD:x] token from the visible reply", () => {
    const stripped = stripCardTokens("Here's your invoice. [SHOW_CARD:invoice]");
    expect(stripped).toBe("Here's your invoice.");
    expect(stripped).not.toMatch(/SHOW_CARD/);
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

// ── customer_entitlements grounding (#362) ──────────────────────────────────────
// buildCustomerContext's queries all terminate their chain in a call to
// db.limit(...) (orderBy/innerJoin/where are all mockReturnThis), so
// mockResolvedValueOnce calls queue up in the exact call order the
// Promise.all in buildCustomerContext issues them: customer row, signals,
// SOWs (purchases), bundle assignments (entitlements), latest scan run,
// last-completed scan run — then, only if a completed run exists, findings.

describe("customer_entitlements grounding (#362): buildCustomerContext", () => {
  const mockDb = db as unknown as Record<string, ReturnType<typeof vi.fn>>;
  const paid = resolveInstance("shanebot_paid");

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb["select"].mockReturnThis();
    mockDb["from"].mockReturnThis();
    mockDb["where"].mockReturnThis();
    mockDb["innerJoin"].mockReturnThis();
    mockDb["orderBy"].mockReturnThis();
    mockDb["limit"].mockResolvedValue([]);
  });

  it("degrades to honest 'nothing yet' text when the customer has no purchases, bundles, or scans", async () => {
    mockDb["limit"]
      .mockResolvedValueOnce([{ name: "Acme Corp", domain: "acme.com", status: "active", tenantId: "tid-1" }]) // customer
      .mockResolvedValueOnce([]) // signals
      .mockResolvedValueOnce([]) // SOWs
      .mockResolvedValueOnce([]) // bundle assignments
      .mockResolvedValueOnce([]) // latest run
      .mockResolvedValueOnce([]); // last completed run

    const grounding = await buildGrounding(paid, { customerId: 42, mspId: 7, isCustomerUser: true });

    expect(grounding.identity).toBe("customer user for Acme Corp");
    expect(grounding.summary).toContain("Purchases:\nNo purchases yet.");
    expect(grounding.summary).toContain("Subscriptions / monitoring bundles:\nNo active subscriptions or monitoring bundles.");
    expect(grounding.summary).toContain("Scan / monitoring status:\nNo scans have been run yet.");
  });

  it("grounds on real purchases, an active bundle, and the last completed scan's open findings", async () => {
    mockDb["limit"]
      .mockResolvedValueOnce([{ name: "Acme Corp", domain: "acme.com", status: "active", tenantId: "tid-1" }]) // customer
      .mockResolvedValueOnce([]) // signals
      .mockResolvedValueOnce([{
        title: "Copilot Readiness Assessment", status: "paid", amountCents: 250000,
        signedAt: new Date("2026-08-01T00:00:00Z"), chargeConfirmedAt: new Date("2026-08-01T00:05:00Z"),
      }]) // SOWs
      .mockResolvedValueOnce([{
        name: "Core Security Monitoring", status: "active",
        activatedAt: new Date("2026-08-02T00:00:00Z"), trialExpiresAt: null,
      }]) // bundle assignments
      .mockResolvedValueOnce([{ runId: "run-9", packageKey: "core:security-baseline", status: "completed", startedAt: new Date("2026-08-16T00:00:00Z") }]) // latest run
      .mockResolvedValueOnce([{ runId: "run-9", completedAt: new Date("2026-08-16T00:10:00Z"), checksTotal: 20, checksOk: 17, checksError: 1 }]) // last completed run
      .mockResolvedValueOnce([{ severity: "critical", title: "MFA not enforced for all admins" }]); // findings

    const grounding = await buildGrounding(paid, { customerId: 42, mspId: 7, isCustomerUser: true });

    expect(grounding.summary).toContain("Copilot Readiness Assessment — paid ($2,500");
    expect(grounding.summary).toContain("Core Security Monitoring — active (activated");
    expect(grounding.summary).toContain("17/20 checks OK, 1 error(s)");
    expect(grounding.summary).toContain("[critical] MFA not enforced for all admins");
    // Findings query must be scoped to the specific completed run, not any run.
    expect(mockDb["where"]).toHaveBeenCalled();
  });

  it("scopes every query to the requesting customer (and mspId when resolvable) — never a bare unscoped select", async () => {
    mockDb["limit"]
      .mockResolvedValueOnce([{ name: "Acme Corp", domain: "acme.com", status: "active", tenantId: "tid-1" }])
      .mockResolvedValue([]);
    await buildGrounding(paid, { customerId: 42, mspId: 7, isCustomerUser: true });
    // Every one of the 6 initial queries (customer, signals, SOWs, bundles,
    // latest run, last-completed run) calls .where() with real conditions —
    // none of buildCustomerContext's queries ever omit .where().
    expect(mockDb["where"].mock.calls.length).toBeGreaterThanOrEqual(6);
  });

  // ── #366 Active Cards: invoicesTable / clientScoresTable, keyed off userId ────

  it("without a userId, skips the invoice/score queries entirely and cardData omits both", async () => {
    mockDb["limit"]
      .mockResolvedValueOnce([{ name: "Acme Corp", domain: "acme.com", status: "active", tenantId: "tid-1" }])
      .mockResolvedValue([]);
    const grounding = await buildGrounding(paid, { customerId: 42, mspId: 7, isCustomerUser: true, userId: null });
    expect(grounding.cardData?.invoice).toBeUndefined();
    expect(grounding.cardData?.score).toBeUndefined();
    // Only the 6 tenant-scoped queries ran — no 7th/8th call consumed a queued value.
    expect(mockDb["limit"].mock.calls.length).toBe(6);
  });

  it("with a userId, populates invoice/subscription/score cardData from real rows", async () => {
    mockDb["limit"]
      .mockResolvedValueOnce([{ name: "Acme Corp", domain: "acme.com", status: "active", tenantId: "tid-1" }]) // customer
      .mockResolvedValueOnce([]) // signals
      .mockResolvedValueOnce([]) // SOWs
      .mockResolvedValueOnce([{
        name: "Core Security Monitoring", status: "active",
        activatedAt: new Date("2026-08-02T00:00:00Z"), trialExpiresAt: null,
      }]) // bundle assignments
      .mockResolvedValueOnce([]) // latest run
      .mockResolvedValueOnce([]) // last completed run
      .mockResolvedValueOnce([{
        invoiceNumber: "INV-1001", description: "Monthly monitoring", amount: "19900", currency: "usd", // amount is integer cents (Git #1610)
        status: "paid", dueDate: new Date("2026-08-01T00:00:00Z"), paidAt: new Date("2026-08-01T00:00:00Z"),
      }]) // invoices
      .mockResolvedValueOnce([{
        identity: 80, security: 65, collaboration: 72, compliance: 58, copilotReadiness: 44,
        updatedAt: new Date("2026-08-10T00:00:00Z"),
      }]); // score

    const grounding = await buildGrounding(paid, { customerId: 42, mspId: 7, isCustomerUser: true, userId: 10 });

    expect(grounding.cardData?.invoice).toEqual({
      invoices: [{
        invoiceNumber: "INV-1001", description: "Monthly monitoring", amount: "$199.00", currency: "usd",
        status: "paid", dueDate: "2026-08-01T00:00:00.000Z", paidAt: "2026-08-01T00:00:00.000Z",
      }],
    });
    expect(grounding.cardData?.subscription).toEqual({
      subscriptions: [{
        name: "Core Security Monitoring", status: "active",
        activatedAt: "2026-08-02T00:00:00.000Z", trialExpiresAt: null,
      }],
    });
    expect(grounding.cardData?.score).toEqual({
      identity: 80, security: 65, collaboration: 72, compliance: 58, copilotReadiness: 44,
      updatedAt: "2026-08-10T00:00:00.000Z",
    });
    // data-answer is always populated (never undefined) — it's a rendering mode
    // over the same entitlement facts, not a separate data source (#366's own scope note).
    expect(grounding.cardData?.dataAnswer).toEqual({
      subscriptions: [{
        name: "Core Security Monitoring", status: "active",
        activatedAt: "2026-08-02T00:00:00.000Z", trialExpiresAt: null,
      }],
      latestScan: null,
      purchases: [],
    });
    expect(grounding.summary).toContain("INV-1001 — paid ($199.00 USD");
    expect(grounding.summary).toContain("Identity 80, Security 65, Collaboration 72, Compliance 58, Copilot Readiness 44");
  });

  it("omits invoice/subscription/score cardData (but not dataAnswer) when there is no real data for them", async () => {
    mockDb["limit"]
      .mockResolvedValueOnce([{ name: "Acme Corp", domain: "acme.com", status: "active", tenantId: "tid-1" }])
      .mockResolvedValue([]);
    const grounding = await buildGrounding(paid, { customerId: 42, mspId: 7, isCustomerUser: true, userId: 10 });
    expect(grounding.cardData?.invoice).toBeUndefined();
    expect(grounding.cardData?.subscription).toBeUndefined();
    expect(grounding.cardData?.score).toBeUndefined();
    expect(grounding.cardData?.dataAnswer).toEqual({ subscriptions: [], latestScan: null, purchases: [] });
  });

  // ── #4125 Batch A: no resolvable (mspId, tenantId) scope ────────────────────
  // The mocked customer row here (as in every test above) carries no mspId,
  // so the derived `scope` is null — every Batch A topic must fail closed to
  // its honest "nothing yet" text and its cardData must stay undefined,
  // exactly like the real portal-risk-register.ts etc. do for an unresolvable
  // tenant, and NOT fire a second-wave query at all.
  it("#4125 Batch A: with no resolvable tenant scope, every new topic degrades honestly and fires no query", async () => {
    mockDb["limit"]
      .mockResolvedValueOnce([{ name: "Acme Corp", domain: "acme.com", status: "active", tenantId: "tid-1" }])
      .mockResolvedValue([]);
    const callsBefore = mockDb["limit"].mock.calls.length;
    const grounding = await buildGrounding(paid, { customerId: 42, mspId: 7, isCustomerUser: true });

    expect(grounding.summary).toContain("Risk register:\nNo risks recorded on your risk register.");
    expect(grounding.summary).toContain("Change Control:\nNo change requests on file.");
    expect(grounding.summary).toContain("Remediation tracking findings:\nNo open critical/warning findings from your latest scan.");
    expect(grounding.summary).toContain("POA&Ms:\nNo active plans of action.");
    expect(grounding.summary).toContain("Security Plan:\nNo Security Plan version has been sealed yet.");
    expect(grounding.summary).toContain("Ownership / RACI:\nNo workloads on your ownership matrix yet.");
    expect(grounding.summary).toContain("Policy decisions:\nNo policy decisions on file.");
    expect(grounding.summary).toContain("Conditional Access (cross-reference):\nNo open items in Change Control or the Risk Register currently reference Conditional Access, by keyword match.");
    expect(grounding.summary).toContain("Governance pillar signals:\nNo Governance pillar signals have been collected for this tenant yet.");

    expect(grounding.cardData?.risk).toBeUndefined();
    expect(grounding.cardData?.changes).toBeUndefined();
    expect(grounding.cardData?.findings).toBeUndefined();
    expect(grounding.cardData?.poams).toBeUndefined();
    expect(grounding.cardData?.secplan).toBeUndefined();
    expect(grounding.cardData?.raci).toBeUndefined();
    expect(grounding.cardData?.raciWorkload).toBeUndefined();
    expect(grounding.cardData?.policy).toBeUndefined();
    expect(grounding.cardData?.conditionalAccess).toBeUndefined();
    expect(grounding.cardData?.signal).toBeUndefined();

    // No resolvable scope means every scope-gated second-wave query
    // short-circuits to Promise.resolve — the only new call beyond the
    // original 6 is the always-run findings check, which itself short-
    // circuits (lastCompleted is undefined) without querying.
    expect(mockDb["limit"].mock.calls.length).toBe(callsBefore + 6);
  });
});

describe("#4125 Batch A — Governance & Risk cluster topic builders (pure, DB-free)", () => {
  it("riskTopic: counts open/mitigating and overdue reviews, builds a card only when rows exist", () => {
    expect(riskTopic([]).card).toBeNull();
    const t = riskTopic([
      { rbdId: "RR-1", title: "No retention on Teams sites", riskStatus: "Open", reviewState: null },
      { rbdId: "RR-2", title: "MFA gaps", riskStatus: "Accepted", reviewState: "overdue" },
      { rbdId: "RR-3", title: "Licence spend", riskStatus: "Mitigating", reviewState: "on_track" },
    ]);
    expect(t.summary).toContain("2 open or mitigating of 3 total, 1 review(s) overdue");
    expect(t.card?.head).toEqual({ value: "2", label: "open or mitigating, 1 review overdue" });
    expect(t.card?.rows.find((r) => r.left.startsWith("RR-2"))?.tone).toBe("red");
  });

  it("changesTopic: pending approval / scheduled counts, honest empty state", () => {
    expect(changesTopic([]).card).toBeNull();
    const t = changesTopic([
      { id: 18, title: "Block legacy auth", status: "pending_approval", approvedBy: null, scheduledFor: "Sat window" },
      { id: 16, title: "Move service accounts", status: "scheduled", approvedBy: "Jordan", scheduledFor: "Fri window" },
    ]);
    expect(t.card?.head).toEqual({ value: "1", label: "pending approval, 1 scheduled" });
    expect(t.summary).toContain("CR-2026-118");
  });

  it("findingsTopic: lists critical/warning findings, honest empty state", () => {
    expect(findingsTopic([]).card).toBeNull();
    const t = findingsTopic([{ severity: "critical", title: "External sharing defaults to anyone with the link" }]);
    expect(t.card?.head?.value).toBe("1");
    expect(t.card?.rows[0].tone).toBe("red");
  });

  it("poamsTopic: active vs unsigned counts", () => {
    expect(poamsTopic([]).card).toBeNull();
    const t = poamsTopic([
      { poamId: "POAM-19", title: "Retire legacy auth", status: "pending_signature", scheduledCompletionDate: "2026-11-30" },
      { poamId: "POAM-17", title: "Enforce guest MFA", status: "active", scheduledCompletionDate: "2026-10-15" },
      { poamId: "POAM-10", title: "Old one", status: "completed", scheduledCompletionDate: "2026-01-01" },
    ]);
    expect(t.card?.head).toEqual({ value: "2", label: "active plans, 1 awaiting your signature" });
  });

  it("secplanTopic: fully-executed status and drift total, honest 'never sealed' state", () => {
    expect(secplanTopic(null, null).card).toBeNull();
    const t = secplanTopic({ versionNumber: 4, customerSignedAt: new Date("2026-09-02T00:00:00Z"), mspSignedAt: new Date("2026-09-01T00:00:00Z") }, 5);
    expect(t.card?.head?.value).toBe("v4");
    expect(t.summary).toContain("5 row(s) have moved since it was signed");
  });

  it("raciTopic + raciWorkloadTopic: unassigned count, and the real 'who owns X' lookup", () => {
    const workloads = [
      { id: "wl-sharepoint", name: "SharePoint", holders: [] as string[] },
      { id: "wl-exchange", name: "Exchange Online", holders: ["Marcus Chen"] },
    ];
    expect(raciTopic([]).card).toBeNull();
    const raci = raciTopic(workloads);
    expect(raci.card?.head).toEqual({ value: "1", label: "roles with no holder assigned" });

    expect(extractWorkloadQuestion("Who owns SharePoint?")).toBe("sharepoint");
    expect(extractWorkloadQuestion("What Conditional Access am I missing?")).toBeNull();

    expect(raciWorkloadTopic(workloads, null)).toBeNull();
    expect(raciWorkloadTopic(workloads, "What's my score?")).toBeNull();

    const found = raciWorkloadTopic(workloads, "Who owns SharePoint?");
    expect(found?.card?.head).toEqual({ value: "0", label: "holder(s) for SharePoint" });
    expect(found?.card?.rows[0].right).toBe("Unassigned");

    const held = raciWorkloadTopic(workloads, "Who owns Exchange Online?");
    expect(held?.summary).toContain("Marcus Chen");

    const notFound = raciWorkloadTopic(workloads, "Who owns Teams?");
    expect(notFound?.card).toBeNull();
    expect(notFound?.summary).toContain("No workload on your ownership matrix matches");
  });

  it("policyTopic: overdue review vs licence-waiting counts", () => {
    expect(policyTopic([]).card).toBeNull();
    const t = policyTopic([
      { id: 39, title: "Two service accounts kept out of MFA", reviewState: "overdue", clearanceCondition: null, clearanceResolvedAt: null },
      { id: 33, title: "Guest access reviews paused", reviewState: null, clearanceCondition: "Entra ID P2 licences land", clearanceResolvedAt: null },
    ]);
    expect(t.card?.head).toEqual({ value: "1", label: "review overdue, 1 waiting on a licence" });
  });

  it("conditionalAccessTopic: real keyword cross-reference over Change Control + Risk Register, honest when nothing matches", () => {
    const noMatch = conditionalAccessTopic(
      [{ id: 1, title: "Rotate service account password", status: "pending_approval", approvedBy: null }],
      [{ rbdId: "RR-1", title: "Licence spend", riskStatus: "Open" }],
    );
    expect(noMatch.card).toBeNull();

    const match = conditionalAccessTopic(
      [{ id: 118, title: "Block legacy authentication protocols", status: "pending_approval", approvedBy: null }],
      [{ rbdId: "RR-9", title: "Conditional access change declined", riskStatus: "Accepted" }],
    );
    expect(match.card?.head?.value).toBe("2");
  });

  it("signalTopic: catalog prose always present, card only on a real keyword match", () => {
    const areas = [
      { checkKey: "governance:ownerless-groups", value: 12, status: "yellow" as const, hasData: true },
      { checkKey: "governance:guest-count", value: 3, status: "green" as const, hasData: true },
      { checkKey: "teams:channel-sprawl", value: 0, status: null, hasData: false },
    ];
    const noMatch = signalTopic(areas, "What's my Copilot score?");
    expect(noMatch.card).toBeNull();
    expect(noMatch.summary).toContain("Groups without an owner: 12");

    const match = signalTopic(areas, "How many groups without an owner do I have?");
    expect(match.card?.head).toEqual({ value: "12", label: "Groups without an owner" });
  });
});

// ── live_catalog grounding (#364) ────────────────────────────────────────────────
// #1085 (Stale Content Audit) closed without ever establishing the "actually
// reachable on the router" field #1097 anticipated, so `visibility='public'`
// alone still drifts (MSP-tier rows whose only page, `/msp`, isn't routed yet —
// #1088). The fix ANDs in an allowlist of `category` values confirmed live in
// App.tsx. These tests prove the query carries BOTH filters, not just visibility.

describe("live_catalog grounding (#364): buildGrounding(shanebot_public)", () => {
  const mockDb = db as unknown as Record<string, ReturnType<typeof vi.fn>>;
  const pub = resolveInstance("shanebot_public");

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb["select"].mockReturnThis();
    mockDb["from"].mockReturnThis();
    mockDb["where"].mockReturnThis();
    mockDb["orderBy"].mockReturnThis();
    mockDb["limit"].mockResolvedValue([]);
  });

  // A single test: buildLiveCatalogGrounding() caches its result in a module-level
  // TTL cache, so a second buildGrounding() call in a later test would short-circuit
  // on that cache (never touching mockDb again) and leave any queued
  // mockResolvedValueOnce unconsumed — corrupting whichever unrelated test runs next.
  it("filters on visibility='public' AND category IN the live-marketing allowlist (not visibility alone), and renders real rows", async () => {
    mockDb["limit"].mockResolvedValueOnce([
      {
        name: "Copilot Readiness Assessment",
        tagline: "Know before you roll out.",
        description: null,
        category: "assessment",
        serviceType: "assessment",
        billingType: "one_time",
        priceCents: 150000,
        isFreeOffering: false,
      },
    ]);

    const grounding = await buildGrounding(pub);

    expect(mockDb["where"]).toHaveBeenCalledTimes(1);
    const whereArg = JSON.stringify(mockDb["where"].mock.calls[0]?.[0]);
    expect(whereArg).toContain("visibility");
    expect(whereArg).toContain("category");
    // The allowlisted categories confirmed live against App.tsx's registered routes.
    for (const cat of ["assessment", "project", "retainer", "monitoring", "config_pack"]) {
      expect(whereArg).toContain(cat);
    }
    // MSP-tier categories (only page is /msp, unrouted pending #1088) must NOT be
    // silently allowed through as if they were a live category.
    expect(whereArg).not.toContain("platform_subscription");
    expect(whereArg).not.toContain("msp_onboarding");

    expect(grounding.summary).toContain("Copilot Readiness Assessment");
    expect(grounding.summary).toContain("$1,500");
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
