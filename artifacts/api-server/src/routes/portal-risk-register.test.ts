/**
 * portal-risk-register.test.ts — the customer-scoped Risk Register and, mostly,
 * the acceptance write path.
 *
 * The read is plumbing; the WRITE is a liability transfer, and these are the
 * four properties of it that are worth failing a build over:
 *
 *   1. AN ACCEPTANCE IS PERMANENT. A risk that already carries `accepted_at` is
 *      refused with 409 and NO update is issued. This is the whole promise of
 *      the flow ("timestamped, permanent, never editable after the fact"), and
 *      Postgres has no write-once column to enforce it — the guard lives in the
 *      route, so it has to be guarded by a test.
 *   2. THE AUDIT TRAIL IS SERVER-DERIVED. `accepted_at`, `ipAddress` and
 *      `signatureHash` are computed here, never read off the request body. The
 *      MSP-side sibling (`msp-rbd.ts`) does take `ipAddress`/`signatureHash`
 *      from the caller, which lets a signer author their own audit trail; a
 *      customer-facing signature must not, so this test sends poisoned values
 *      in the body and asserts they are ignored.
 *   3. THE CHECKBOX IS MANDATORY. `confirmed` is `z.literal(true)`, so consent
 *      cannot be omitted or falsified into a "no".
 *   4. ANOTHER TENANT'S RISK IS A 404, NOT A 403. Same-shaped answer as a risk
 *      that does not exist, so the endpoint cannot be used to enumerate which
 *      RBD ids are real.
 *
 * And one read property: NULLS ARE SERVED AS NULLS. Every register column is
 * nullable with no backfill, and a row `msp-rbd.ts` wrote has all of them empty.
 * A fabricated default would put a risk on the heat map at coordinates nobody
 * chose, so the route must pass the absence through.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

let mockSelectResultsQueue: any[][] = [];
let mockUpdateSets: any[] = [];
let mockUpdateReturns: any[][] = [];

vi.mock("@workspace/db", () => {
  const makeSelectChain = () => {
    const chain: any = {
      from: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      then: (onfulfilled: any, onrejected?: any) =>
        Promise.resolve(mockSelectResultsQueue.shift() ?? []).then(onfulfilled, onrejected),
    };
    return chain;
  };

  const makeUpdateChain = () => {
    const chain: any = {
      set: (v: any) => {
        mockUpdateSets.push(v);
        return chain;
      },
      where: () => chain,
      returning: () => Promise.resolve(mockUpdateReturns.shift() ?? [{ id: 1 }]),
    };
    return chain;
  };

  const col = (name: string) => name;
  return {
    db: {
      select: vi.fn(() => makeSelectChain()),
      update: vi.fn(() => makeUpdateChain()),
    },
    mspRiskDecisionsTable: {
      id: col("id"),
      mspId: col("msp_id"),
      rbdId: col("rbd_id"),
      tenantId: col("tenant_id"),
      acceptedAt: col("accepted_at"),
      status: col("status"),
    },
    // #1525 — loadObligationTypes()'s cited-authority join. This mock predates
    // that addition and was never extended.
    complianceObligationsTable: {
      id: col("id"),
      frameworkId: col("framework_id"),
    },
    complianceFrameworksTable: {
      id: col("id"),
      authorityType: col("authority_type"),
    },
    // risk-authority.ts (imported for currentAHolderPersonIds/
    // resolveRiskAuthoritiesBatch) — this mock predates that dependency too.
    portalOwnershipAssignmentsTable: {
      id: col("id"),
      customerId: col("customer_id"),
      objectId: col("object_id"),
      roleKey: col("role_key"),
      ownerPersonId: col("owner_person_id"),
      orderRank: col("order_rank"),
    },
    portalOwnershipEventsTable: {
      id: col("id"),
      customerId: col("customer_id"),
      objectId: col("object_id"),
      roleKey: col("role_key"),
      ownerPersonId: col("owner_person_id"),
      occurredAt: col("occurred_at"),
    },
    usersTable: {
      id: col("id"),
      email: col("email"),
      name: col("name"),
      tenantId: col("tenant_id"),
      mspId: col("msp_id"),
    },
  };
});

vi.mock("../middlewares/requireAuth", () => ({
  requireRole: () => (_req: any, _res: any, next: () => void) => next(),
  requireAuth: (_req: any, _res: any, next: () => void) => next(),
}));

// #1168's tier-feature gate is exercised by its own lib test — these tests are
// about the route's scoping/business logic and assume an entitled tier. Keys
// mirror the real PORTAL_TIER_MODULE_KEYS string literals in
// lib/portal-tier-features.ts (kept as literals, not importOriginal, so this
// mock never has to resolve that module's own real @workspace/db imports).
vi.mock("../lib/portal-tier-features", () => ({
  requireTierFeature: () => (_req: any, _res: any, next: () => void) => next(),
  PORTAL_TIER_MODULE_KEYS: {
    policyDecisions: "policy_decisions",
    riskRegister: "risk_register",
    runbooks: "runbooks",
    remediationTracking: "remediation_tracking",
    sopsRunbooks: "sops_runbooks",
    messageCenter: "message_center",
    changeControl: "change_control",
    ownership: "ownership",
    securityPlan: "security_plan",
    piiGovernance: "pii_governance",
  },
}));

vi.mock("../lib/logger", () => {
  const child = vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child }));
  return { logger: { child, info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } };
});

let mockScope: any = null;
vi.mock("../lib/portal-customer-scope", () => ({
  resolveCustomerId: (req: any) => req.user?.customerId ?? null,
  resolveTenantScope: async () => mockScope,
}));

vi.mock("drizzle-orm", () => ({
  and: (...a: unknown[]) => ({ and: a }),
  eq: (l: unknown, r: unknown) => ({ eq: [l, r] }),
  desc: (c: unknown) => ({ desc: c }),
  isNull: (c: unknown) => ({ isNull: c }),
  // #1525 added loadObligationTypes()'s inArray() lookup — this mock predates
  // that addition and was never extended.
  inArray: (c: unknown, v: unknown) => ({ inArray: [c, v] }),
  asc: (c: unknown) => ({ asc: c }),
  lte: (l: unknown, r: unknown) => ({ lte: [l, r] }),
}));

import router from "./portal-risk-register";

function makeApp(user: Record<string, unknown> | null) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (user) (req as any).user = user;
    next();
  });
  app.use("/api", router);
  return app;
}

const CUSTOMER = { id: 7, customerId: 42 };
const SCOPE = {
  customerId: 42,
  mspId: 1,
  tenantId: "0a361ab2-9e85-4bbf-8b75-c1ebf042dfba",
  tenantName: "Test Me",
  primaryDomain: "shanemccaw.onmicrosoft.com",
};

/** A row exactly as `msp-rbd.ts` writes one: none of the register columns set. */
function bareRow(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    mspId: 1,
    rbdId: "RBD-2026-575",
    tenantId: SCOPE.tenantId,
    tenantName: "Test Me",
    primaryDomain: "shanemccaw.onmicrosoft.com",
    title: "Conditional Risk Acceptance Request",
    controlViolated: "CIS 1.1.1 - Enforce MFA for All Users",
    framework: "CIS M365 Baseline",
    rawRiskLevel: "high",
    residualRiskLevel: "medium",
    rawRiskScore: 17,
    residualRiskScore: 8,
    liabilityValueUsd: 35000,
    hazardDescription: "MFA is not enforced for all users.",
    graphEndpoint: "/policies",
    compensatingControls: [
      { type: "technical", description: "Conditional Access restricts sign-in locations." },
    ],
    mspAssessor: { name: "Shane McCaw", upn: "shane@shanemccaw.com", timestamp: "2026-08-19 03:40:40 UTC" },
    clientApprover: { name: "Client Risk Officer", title: "CIO", email: "exec@clientdomain.com", signedAt: null, ipAddress: null, signatureHash: null },
    expirationDate: "2027-08-19",
    status: "pending_signature",
    pillar: null,
    owner: null,
    ownerId: null,
    riskStatus: null,
    reviewDate: null,
    weight: null,
    likelihood: null,
    impact: null,
    outcome: null,
    evidence: null,
    plan: null,
    registerRef: null,
    rationale: null,
    obligation: null,
    verificationNote: null,
    decisionState: null,
    acceptedAt: null,
    acceptedStatement: null,
    createdAt: new Date("2026-08-19T03:40:40Z"),
    updatedAt: new Date("2026-08-19T03:40:40Z"),
    ...over,
  };
}

beforeEach(() => {
  mockSelectResultsQueue = [];
  mockUpdateSets = [];
  mockUpdateReturns = [];
  mockScope = SCOPE;
});

describe("GET /portal/risk-register", () => {
  it("serves a row msp-rbd.ts wrote with its register fields still null, not defaulted", async () => {
    mockSelectResultsQueue = [[bareRow()]];
    const res = await request(makeApp(CUSTOMER)).get("/api/portal/risk-register");

    expect(res.status).toBe(200);
    const risk = res.body.risks[0];
    // The absence is the point: nothing here got a plausible-looking stand-in.
    expect(risk.pillar).toBeNull();
    expect(risk.owner).toBeNull();
    expect(risk.likelihood).toBeNull();
    expect(risk.impact).toBeNull();
    expect(risk.weight).toBeNull();
    expect(risk.plan).toBeNull();
    // What the table DOES hold still comes through.
    expect(risk.id).toBe("RBD-2026-575");
    expect(risk.what).toBe("MFA is not enforced for all users.");
    expect(risk.controls).toEqual(["Conditional Access restricts sign-in locations."]);
  });

  it("title-cases the severity so it matches the register's own colour map keys", async () => {
    mockSelectResultsQueue = [[bareRow()]];
    const res = await request(makeApp(CUSTOMER)).get("/api/portal/risk-register");
    expect(res.body.risks[0].inherent).toBe("High");
    expect(res.body.risks[0].residual).toBe("Medium");
  });

  it("does NOT report an acceptance for a row flipped active MSP-side with nobody having signed", async () => {
    // msp-rbd.ts can set status active without the customer ever typing a name.
    // Rendering an acceptance there would be a false record of consent.
    mockSelectResultsQueue = [[bareRow({ status: "active", acceptedAt: null })]];
    const res = await request(makeApp(CUSTOMER)).get("/api/portal/risk-register");
    expect(res.body.risks[0].isAccepted).toBe(false);
    expect(res.body.risks[0].accepted).toBeUndefined();
  });

  it("carries the review clock (#1507) — reviewState + machine reviewDueAt — split out of the acceptance status", async () => {
    // The review is a separate clock from the acceptance. A row can be a
    // still-active acceptance while its review is overdue.
    mockSelectResultsQueue = [[bareRow({
      status: "active",
      reviewState: "overdue",
      reviewDueAt: new Date("2026-05-09T00:00:00Z"),
      reviewDate: "9 May 2026",
    })]];
    const res = await request(makeApp(CUSTOMER)).get("/api/portal/risk-register");
    expect(res.status).toBe(200);
    const risk = res.body.risks[0];
    expect(risk.reviewState).toBe("overdue");
    expect(risk.reviewDueAt).toBe("2026-05-09T00:00:00.000Z");
    // The display copy is preserved alongside the machine date.
    expect(risk.review).toBe("9 May 2026");
  });

  it("serves the review clock as null (never defaulted) when no review is scheduled", async () => {
    mockSelectResultsQueue = [[bareRow()]];
    const res = await request(makeApp(CUSTOMER)).get("/api/portal/risk-register");
    const risk = res.body.risks[0];
    expect(risk.reviewState).toBeNull();
    expect(risk.reviewDueAt).toBeNull();
  });

  it("emits an acceptance block with NO `until` — an acceptance does not expire (#1507)", async () => {
    // clientApprover.name is set in bareRow, so an acceptedAt makes this a real
    // acceptance. The acceptance carries the signer/date/statement, never a
    // lifetime — the 'look again' date belongs to the review clock instead.
    mockSelectResultsQueue = [[bareRow({ acceptedAt: new Date("2026-08-20T10:00:00Z") })]];
    const res = await request(makeApp(CUSTOMER)).get("/api/portal/risk-register");
    const risk = res.body.risks[0];
    expect(risk.isAccepted).toBe(true);
    expect(risk.accepted).toBeDefined();
    expect(risk.accepted.by).toBe("Client Risk Officer");
    expect("until" in risk.accepted).toBe(false);
  });

  it("serves an empty register rather than 403 when the tenant scope will not resolve", async () => {
    mockScope = null;
    const res = await request(makeApp(CUSTOMER)).get("/api/portal/risk-register");
    expect(res.status).toBe(200);
    expect(res.body.risks).toEqual([]);
  });
});

describe("GET /portal/policy-decisions", () => {
  it("omits rows that carry no policy position, and keeps the ones that do", async () => {
    mockSelectResultsQueue = [[bareRow(), bareRow({ id: 2, rbdId: "RBD-2026-576", decisionState: "live" })]];
    const res = await request(makeApp(CUSTOMER)).get("/api/portal/policy-decisions");
    expect(res.status).toBe(200);
    expect(res.body.decisions).toHaveLength(1);
    expect(res.body.decisions[0].id).toBe("RBD-2026-576");
  });

  it("carries the review clock on a policy decision, with `expired` no longer a state (#1527)", async () => {
    mockSelectResultsQueue = [[bareRow({
      decisionState: "live",
      reviewState: "overdue",
      reviewDueAt: new Date("2026-05-09T00:00:00Z"),
    })]];
    const res = await request(makeApp(CUSTOMER)).get("/api/portal/policy-decisions");
    const decision = res.body.decisions[0];
    expect(decision.state).toBe("live");
    expect(decision.reviewState).toBe("overdue");
    expect(decision.reviewDueAt).toBe("2026-05-09T00:00:00.000Z");
  });
});

describe("POST /portal/risk-register/:rbdId/accept", () => {
  const body = {
    fullName: "Jordan Diaz",
    confirmed: true,
    statement: "I understand and accept this risk.",
  };

  it("records the TYPED name and derives the timestamp, ip and signature server-side", async () => {
    mockSelectResultsQueue = [[bareRow()]];
    const res = await request(makeApp(CUSTOMER))
      .post("/api/portal/risk-register/RBD-2026-575/accept")
      .send({
        ...body,
        // Poisoned. A customer must not be able to author their own audit trail.
        ipAddress: "1.2.3.4",
        signatureHash: "deadbeef",
        acceptedAt: "1999-01-01T00:00:00Z",
      });

    expect(res.status).toBe(201);
    expect(mockUpdateSets).toHaveLength(1);
    const set = mockUpdateSets[0];

    expect(set.clientApprover.name).toBe("Jordan Diaz");
    expect(set.acceptedStatement).toBe("I understand and accept this risk.");
    expect(set.riskStatus).toBe("Accepted");
    expect(set.status).toBe("active");

    // None of the client's values survived.
    expect(set.clientApprover.signatureHash).not.toBe("deadbeef");
    expect(set.clientApprover.signatureHash).toMatch(/^[0-9a-f]{64}$/);
    expect(set.acceptedAt).toBeInstanceOf(Date);
    expect(set.acceptedAt.getUTCFullYear()).toBeGreaterThan(2000);

    // The title/email the MSP recorded are preserved; the customer typed a name,
    // not a new contact record.
    expect(set.clientApprover.title).toBe("CIO");
    expect(set.clientApprover.email).toBe("exec@clientdomain.com");

    // The 201 acceptance record carries no `until` — the acceptance does not
    // expire (#1507); any 'look again' date lives on the review clock.
    expect("until" in res.body.accepted).toBe(false);
    expect(res.body.accepted.by).toBe("Jordan Diaz");
  });

  it("REFUSES a second acceptance and issues no update at all", async () => {
    mockSelectResultsQueue = [[bareRow({ acceptedAt: new Date("2026-08-20T10:00:00Z") })]];
    const res = await request(makeApp(CUSTOMER))
      .post("/api/portal/risk-register/RBD-2026-575/accept")
      .send({ ...body, fullName: "Someone Else" });

    expect(res.status).toBe(409);
    // The guarantee is not just "the response said no" — nothing was written.
    expect(mockUpdateSets).toHaveLength(0);
  });

  it("refuses when the guarded UPDATE matches nothing, so a race cannot overwrite a signature", async () => {
    mockSelectResultsQueue = [[bareRow()]];
    mockUpdateReturns = [[]]; // the accepted_at IS NULL predicate lost the race
    const res = await request(makeApp(CUSTOMER))
      .post("/api/portal/risk-register/RBD-2026-575/accept")
      .send(body);
    expect(res.status).toBe(409);
  });

  it("refuses a revoked decision", async () => {
    mockSelectResultsQueue = [[bareRow({ status: "revoked" })]];
    const res = await request(makeApp(CUSTOMER))
      .post("/api/portal/risk-register/RBD-2026-575/accept")
      .send(body);
    expect(res.status).toBe(409);
    expect(mockUpdateSets).toHaveLength(0);
  });

  it("rejects an acceptance with the checkbox missing or false", async () => {
    mockSelectResultsQueue = [[bareRow()], [bareRow()]];
    const app = makeApp(CUSTOMER);

    const missing = await request(app)
      .post("/api/portal/risk-register/RBD-2026-575/accept")
      .send({ fullName: "Jordan Diaz", statement: "x" });
    expect(missing.status).toBe(400);

    const refused = await request(app)
      .post("/api/portal/risk-register/RBD-2026-575/accept")
      .send({ fullName: "Jordan Diaz", confirmed: false, statement: "x" });
    expect(refused.status).toBe(400);

    expect(mockUpdateSets).toHaveLength(0);
  });

  it("rejects an empty or one-character typed name", async () => {
    const res = await request(makeApp(CUSTOMER))
      .post("/api/portal/risk-register/RBD-2026-575/accept")
      .send({ ...body, fullName: " J " });
    expect(res.status).toBe(400);
    expect(mockUpdateSets).toHaveLength(0);
  });

  it("answers 404 — not 403 — for a risk outside the caller's own tenant", async () => {
    mockSelectResultsQueue = [[]]; // the scoped read simply finds nothing
    const res = await request(makeApp(CUSTOMER))
      .post("/api/portal/risk-register/RBD-SOMEONE-ELSE/accept")
      .send(body);
    expect(res.status).toBe(404);
    expect(mockUpdateSets).toHaveLength(0);
  });
});
