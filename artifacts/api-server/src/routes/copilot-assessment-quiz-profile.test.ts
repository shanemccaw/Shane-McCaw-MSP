/**
 * copilot-assessment-quiz-profile.test.ts — #237 (Copilot Assessment epic #183).
 *
 * The behaviour under test is the one Shane described: consent -> pay -> login
 * -> complete quiz -> [session gap] -> log back in. Before #237 the completed
 * QuizProfile lived only in copilot-assessment.tsx's React state, so the second
 * login meant redoing all 13 steps.
 *
 * The @workspace/db mock here is a REAL in-memory tenant store keyed by tenant
 * id, not a canned-response chain: the "fresh login" assertion is only worth
 * anything if the second request actually reads back what the first request
 * wrote, through the same storage, under a genuinely different JWT.
 *
 * Run: pnpm --filter @workspace/api-server vitest run copilot-assessment-quiz-profile
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

// ── In-memory tenants table ───────────────────────────────────────────────────
// Prefixed `mock` so vi.mock's hoisting check allows the factory to close over it.
const mockTenantStore = new Map<number, { copilotAssessment: Record<string, unknown>; updatedAt: Date }>();

// The route's only drizzle helper is eq(); requireAuth.ts (pulled in via
// requireRole) additionally imports and(). Both are reduced to plain descriptors
// so the fake db can read the tenant id straight off the predicate.
vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, value: unknown) => ({ __op: "eq", col, value }),
  and: (...conds: unknown[]) => ({ __op: "and", conds }),
  ne: (col: unknown, value: unknown) => ({ __op: "ne", col, value }),
  desc: (col: unknown) => ({ __op: "desc", col }),
  sql: (strings: TemplateStringsArray) => ({ __op: "sql", strings }),
}));

vi.mock("@workspace/db", () => {
  const tenantIdOf = (cond: { value?: unknown } | undefined): number | undefined =>
    typeof cond?.value === "number" ? cond.value : undefined;

  const makeSelectChain = () => {
    let tenantId: number | undefined;
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: (cond: { value?: unknown }) => {
        tenantId = tenantIdOf(cond);
        return chain;
      },
      limit: () => {
        const row = tenantId === undefined ? undefined : mockTenantStore.get(tenantId);
        return Promise.resolve(row ? [{ copilotAssessment: row.copilotAssessment }] : []);
      },
    };
    return chain;
  };

  const makeUpdateChain = () => {
    let patch: Record<string, unknown> = {};
    const chain: Record<string, unknown> = {
      set: (values: Record<string, unknown>) => {
        patch = values;
        return chain;
      },
      where: (cond: { value?: unknown }) => {
        const tenantId = tenantIdOf(cond);
        const row = tenantId === undefined ? undefined : mockTenantStore.get(tenantId);
        if (row) Object.assign(row, patch);
        return Promise.resolve({});
      },
    };
    return chain;
  };

  return {
    db: {
      select: vi.fn(() => makeSelectChain()),
      update: vi.fn(() => makeUpdateChain()),
      insert: vi.fn(() => ({ values: () => Promise.resolve({}) })),
      delete: vi.fn(() => ({ where: () => Promise.resolve({}) })),
    },
    tenantsTable: { id: "id", copilotAssessment: "copilot_assessment", updatedAt: "updated_at", mspId: "msp_id" },
    mspStaffCustomerScopesTable: { id: "id" },
  };
});

vi.mock("../lib/logger.ts", () => {
  const child: () => Record<string, unknown> = vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child,
  }));
  return { logger: { child, info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } };
});

import router from "./copilot-assessment-quiz-profile.ts";

const JWT_SECRET = "test-secret";
process.env.JWT_SECRET = JWT_SECRET;

const app = express();
app.use(express.json());
app.use("/api", router);

const TENANT_ID = 77;
const OTHER_TENANT_ID = 88;

/**
 * A token for one login session. Every call produces a genuinely different
 * token (distinct `sid`/`iat` claims) — "the same customer logging in again"
 * must not quietly mean "the same request object with the same state".
 */
let sessionCounter = 0;
function makeLoginToken(overrides: Record<string, unknown> = {}): string {
  sessionCounter += 1;
  return jwt.sign(
    {
      id: 501,
      email: "buyer@contoso.com",
      role: "client",
      mspRole: "Assessment",
      mspId: 42,
      customerId: TENANT_ID,
      sid: `session-${sessionCounter}`,
      ...overrides,
    },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

const COMPLETED_PROFILE = {
  role: "Operations Director",
  department: "Operations",
  company: "Contoso Ltd",
  phone: "+61 400 000 000",
  industry: "Healthcare",
  collaboration: ["internal", "external"],
  sensitivity: ["PHI", "PII"],
  workflowStyle: "structured",
  outcomePriorities: ["reduce-admin-time", "improve-compliance"],
  draftingLoad: 0.8,
  researchLoad: 0.4,
  communicationLoad: 0.6,
  repetitiveLoad: 0.9,
  toolUsage: ["Teams", "SharePoint / OneDrive", "Outlook"],
  aiComfort: "medium",
  // The five answers #270 stopped dropping on the wizard side.
  personaClusters: ["Clinical Care", "Administration"],
  targetPersonas: ["Clinician", "Care Coordinator"],
  useCaseClusters: ["Chart Summarization", "Care Plan Drafting"],
  adoptionSpeed: "fast_follower",
  changeManagement: "moderate",
};

/**
 * A profile as it was stored BEFORE #270 — no clusters, no personas, no
 * use-case clusters, no adoption speed, no change-management answer. Real rows
 * in this shape exist, and the wizard re-saves a restored profile, so the route
 * has to keep accepting it.
 */
const LEGACY_PROFILE = (() => {
  const {
    personaClusters: _pc,
    targetPersonas: _tp,
    useCaseClusters: _uc,
    adoptionSpeed: _as,
    changeManagement: _cm,
    ...rest
  } = COMPLETED_PROFILE;
  return rest;
})();

beforeEach(() => {
  mockTenantStore.clear();
  mockTenantStore.set(TENANT_ID, { copilotAssessment: {}, updatedAt: new Date("2026-01-01") });
  mockTenantStore.set(OTHER_TENANT_ID, { copilotAssessment: {}, updatedAt: new Date("2026-01-01") });
});

describe("completed quiz profile survives a session gap (#237)", () => {
  it("a profile saved in one login session is returned to a brand-new login session", async () => {
    // ── Session 1: the customer finishes the 13-step quiz.
    const firstLogin = makeLoginToken();
    const save = await request(app)
      .put("/api/portal/copilot-assessment/quiz-profile")
      .set("Authorization", `Bearer ${firstLogin}`)
      .send({ quizProfile: COMPLETED_PROFILE });
    expect(save.status).toBe(200);
    expect(save.body.saved).toBe(true);
    expect(typeof save.body.completedAt).toBe("string");

    // ── [gap] ── Session 2: a different token entirely, same customer.
    const secondLogin = makeLoginToken();
    expect(secondLogin).not.toBe(firstLogin);

    const restore = await request(app)
      .get("/api/portal/copilot-assessment/quiz-profile")
      .set("Authorization", `Bearer ${secondLogin}`);

    expect(restore.status).toBe(200);
    // The whole frozen QuizProfile comes back, not just a "has completed" flag —
    // the wizard restores it into state.quizProfile and the persona/report
    // phases downstream consume that same object.
    expect(restore.body.quizProfile).toEqual(COMPLETED_PROFILE);
    expect(restore.body.completedAt).toBe(save.body.completedAt);
  });

  it("a customer who has never completed the quiz gets an explicit null, not an error", async () => {
    const res = await request(app)
      .get("/api/portal/copilot-assessment/quiz-profile")
      .set("Authorization", `Bearer ${makeLoginToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.quizProfile).toBeNull();
    expect(res.body.completedAt).toBeNull();
  });

  it("a retake overwrites the stored profile rather than stacking a second one", async () => {
    await request(app)
      .put("/api/portal/copilot-assessment/quiz-profile")
      .set("Authorization", `Bearer ${makeLoginToken()}`)
      .send({ quizProfile: COMPLETED_PROFILE });

    const retaken = { ...COMPLETED_PROFILE, role: "Clinical Lead", draftingLoad: 0.1 };
    await request(app)
      .put("/api/portal/copilot-assessment/quiz-profile")
      .set("Authorization", `Bearer ${makeLoginToken()}`)
      .send({ quizProfile: retaken });

    const res = await request(app)
      .get("/api/portal/copilot-assessment/quiz-profile")
      .set("Authorization", `Bearer ${makeLoginToken()}`);

    expect(res.body.quizProfile).toEqual(retaken);
  });
});

describe("tenant scoping and validation (#237)", () => {
  it("reads and writes only the caller's own tenant row", async () => {
    await request(app)
      .put("/api/portal/copilot-assessment/quiz-profile")
      .set("Authorization", `Bearer ${makeLoginToken()}`)
      .send({ quizProfile: COMPLETED_PROFILE });

    // A different customer must not see it, even though it is stored.
    const other = await request(app)
      .get("/api/portal/copilot-assessment/quiz-profile")
      .set("Authorization", `Bearer ${makeLoginToken({ id: 999, customerId: OTHER_TENANT_ID })}`);

    expect(other.status).toBe(200);
    expect(other.body.quizProfile).toBeNull();
    expect(mockTenantStore.get(OTHER_TENANT_ID)!.copilotAssessment).toEqual({});
  });

  it("ignores any tenant id in the request body — scoping comes from the JWT only", async () => {
    await request(app)
      .put("/api/portal/copilot-assessment/quiz-profile")
      .set("Authorization", `Bearer ${makeLoginToken()}`)
      .send({ quizProfile: COMPLETED_PROFILE, customerId: OTHER_TENANT_ID, tenantId: OTHER_TENANT_ID });

    expect(mockTenantStore.get(OTHER_TENANT_ID)!.copilotAssessment).toEqual({});
    expect(mockTenantStore.get(TENANT_ID)!.copilotAssessment).toHaveProperty("quiz");
  });

  it("rejects a token with no customer identity", async () => {
    const noCustomer = jwt.sign(
      { id: 1, email: "staff@msp.test", role: "client", mspRole: "MSPAdmin", mspId: 42 },
      JWT_SECRET,
      { expiresIn: "1h" },
    );
    const res = await request(app)
      .get("/api/portal/copilot-assessment/quiz-profile")
      .set("Authorization", `Bearer ${noCustomer}`);
    expect(res.status).toBe(403);
  });

  it("rejects a malformed profile instead of storing it for every later read to hand back", async () => {
    const res = await request(app)
      .put("/api/portal/copilot-assessment/quiz-profile")
      .set("Authorization", `Bearer ${makeLoginToken()}`)
      .send({ quizProfile: { role: "Ops", department: "Operations" } });

    expect(res.status).toBe(400);
    expect(mockTenantStore.get(TENANT_ID)!.copilotAssessment).toEqual({});
  });

  it("strips unknown fields rather than persisting whatever the client sent", async () => {
    await request(app)
      .put("/api/portal/copilot-assessment/quiz-profile")
      .set("Authorization", `Bearer ${makeLoginToken()}`)
      .send({ quizProfile: { ...COMPLETED_PROFILE, injected: "nope" } });

    const res = await request(app)
      .get("/api/portal/copilot-assessment/quiz-profile")
      .set("Authorization", `Bearer ${makeLoginToken()}`);

    expect(res.body.quizProfile).not.toHaveProperty("injected");
    expect(res.body.quizProfile).toEqual(COMPLETED_PROFILE);
  });

  it("merges into copilot_assessment, leaving other sections' keys intact", async () => {
    // A later phase of the epic writing its own key under the same column must
    // not be wiped by a quiz retake — that is the whole point of the keyed-map
    // shape borrowed from tenants.consent.
    mockTenantStore.get(TENANT_ID)!.copilotAssessment = { somethingElse: { keep: true } };

    await request(app)
      .put("/api/portal/copilot-assessment/quiz-profile")
      .set("Authorization", `Bearer ${makeLoginToken()}`)
      .send({ quizProfile: COMPLETED_PROFILE });

    const stored = mockTenantStore.get(TENANT_ID)!.copilotAssessment;
    expect(stored.somethingElse).toEqual({ keep: true });
    expect(stored).toHaveProperty("quiz");
  });

  it("persists the five answers the wizard used to drop (#270)", async () => {
    // The bug this replaced: the quiz asked for clusters/personas/use cases/
    // adoption speed/change management, the customer answered, and none of it
    // reached the stored profile — so nothing downstream could ever use it.
    await request(app)
      .put("/api/portal/copilot-assessment/quiz-profile")
      .set("Authorization", `Bearer ${makeLoginToken()}`)
      .send({ quizProfile: COMPLETED_PROFILE });

    const res = await request(app)
      .get("/api/portal/copilot-assessment/quiz-profile")
      .set("Authorization", `Bearer ${makeLoginToken()}`);

    expect(res.body.quizProfile.personaClusters).toEqual(["Clinical Care", "Administration"]);
    expect(res.body.quizProfile.targetPersonas).toEqual(["Clinician", "Care Coordinator"]);
    expect(res.body.quizProfile.useCaseClusters).toEqual(["Chart Summarization", "Care Plan Drafting"]);
    expect(res.body.quizProfile.adoptionSpeed).toBe("fast_follower");
    expect(res.body.quizProfile.changeManagement).toBe("moderate");
    // And the real Tool Usage answers, which used to be an always-empty array.
    expect(res.body.quizProfile.toolUsage).toEqual(["Teams", "SharePoint / OneDrive", "Outlook"]);
  });

  it("still accepts a profile saved before #270, without inventing answers for it", async () => {
    const save = await request(app)
      .put("/api/portal/copilot-assessment/quiz-profile")
      .set("Authorization", `Bearer ${makeLoginToken()}`)
      .send({ quizProfile: LEGACY_PROFILE });
    expect(save.status).toBe(200);

    const res = await request(app)
      .get("/api/portal/copilot-assessment/quiz-profile")
      .set("Authorization", `Bearer ${makeLoginToken()}`);

    // Empty/null, never a plausible-looking default — "never asked" must stay
    // distinguishable from "answered with nothing".
    expect(res.body.quizProfile.personaClusters).toEqual([]);
    expect(res.body.quizProfile.targetPersonas).toEqual([]);
    expect(res.body.quizProfile.useCaseClusters).toEqual([]);
    expect(res.body.quizProfile.adoptionSpeed).toBeNull();
    expect(res.body.quizProfile.changeManagement).toBeNull();
  });

  it("rejects a wrong-typed new field rather than storing it", async () => {
    const res = await request(app)
      .put("/api/portal/copilot-assessment/quiz-profile")
      .set("Authorization", `Bearer ${makeLoginToken()}`)
      .send({ quizProfile: { ...COMPLETED_PROFILE, targetPersonas: "Clinician" } });

    expect(res.status).toBe(400);
    expect(mockTenantStore.get(TENANT_ID)!.copilotAssessment).toEqual({});
  });

  // ── Real captured wizard output ─────────────────────────────────────────────
  // Not hand-written: these two are the exact `quizProfile` bodies the real
  // QuizScreen PUT after a real browser walked all 14 quiz steps twice (#270),
  // one legal answer set and one manufacturing answer set. They are here so the
  // server's gate is tested against what the client genuinely sends, not
  // against a fixture that drifts away from it.
  const CAPTURED_LEGAL = {
    role: "Senior Litigation Counsel",
    department: "Litigation",
    company: "Harbor & Vance LLP",
    phone: "555-0100",
    industry: "legal",
    collaboration: ["internal", "external"],
    sensitivity: ["Privileged / Work Product"],
    workflowStyle: "unstructured",
    outcomePriorities: ["Productivity & Time Saved", "Quality & Error Reduction"],
    draftingLoad: 0.71,
    researchLoad: 0.85,
    communicationLoad: 0.27,
    repetitiveLoad: 0.4,
    toolUsage: ["Word", "Outlook", "Teams"],
    aiComfort: "high",
    personaClusters: ["Litigation", "Compliance & Regulatory"],
    targetPersonas: ["Litigator", "Litigation Paralegal"],
    useCaseClusters: ["Brief Drafting", "Discovery Review Summaries"],
    adoptionSpeed: "fast_follower",
    changeManagement: "moderate",
  };

  const CAPTURED_MANUFACTURING = {
    role: "Shift Supervisor",
    department: "Production Operations",
    company: "Northgate Fabrication",
    phone: "555-0200",
    industry: "manufacturing",
    collaboration: ["internal"],
    sensitivity: ["SCADA / OT Telemetry"],
    workflowStyle: "structured",
    outcomePriorities: ["Productivity & Time Saved"],
    draftingLoad: 0.48,
    researchLoad: 0.23,
    communicationLoad: 0.38,
    repetitiveLoad: 0.93,
    toolUsage: ["Excel", "Teams", "SharePoint / OneDrive"],
    aiComfort: "low",
    personaClusters: ["Production", "Maintenance"],
    targetPersonas: ["Shift Supervisor", "Maintenance Technician"],
    useCaseClusters: ["Shift Handover Briefs", "Work Order Drafting"],
    adoptionSpeed: "slow_adopter",
    changeManagement: "significant",
  };

  it("round-trips what the real wizard actually sends, unchanged (#270)", async () => {
    for (const captured of [CAPTURED_LEGAL, CAPTURED_MANUFACTURING]) {
      mockTenantStore.set(TENANT_ID, { copilotAssessment: {}, updatedAt: new Date() });

      const save = await request(app)
        .put("/api/portal/copilot-assessment/quiz-profile")
        .set("Authorization", `Bearer ${makeLoginToken()}`)
        .send({ quizProfile: captured });
      expect(save.status).toBe(200);

      const res = await request(app)
        .get("/api/portal/copilot-assessment/quiz-profile")
        .set("Authorization", `Bearer ${makeLoginToken()}`);
      expect(res.body.quizProfile).toEqual(captured);
    }
  });

  it("the two real captures are genuinely different profiles, not one shape twice", () => {
    // The regression #270 fixed: every customer used to save draftingLoad 0.5,
    // researchLoad 0.5, communicationLoad 0.5, repetitiveLoad 0.5 and an empty
    // toolUsage — so any two saved profiles were interchangeable downstream.
    const loads = (p: typeof CAPTURED_LEGAL) => [p.draftingLoad, p.researchLoad, p.communicationLoad, p.repetitiveLoad];
    expect(loads(CAPTURED_LEGAL)).not.toEqual(loads(CAPTURED_MANUFACTURING));
    expect(loads(CAPTURED_LEGAL)).not.toEqual([0.5, 0.5, 0.5, 0.5]);
    expect(loads(CAPTURED_MANUFACTURING)).not.toEqual([0.5, 0.5, 0.5, 0.5]);
    expect(CAPTURED_LEGAL.toolUsage.length).toBeGreaterThan(0);
    expect(CAPTURED_MANUFACTURING.toolUsage).not.toEqual(CAPTURED_LEGAL.toolUsage);
  });

  it("records who completed it", async () => {
    await request(app)
      .put("/api/portal/copilot-assessment/quiz-profile")
      .set("Authorization", `Bearer ${makeLoginToken({ id: 4242 })}`)
      .send({ quizProfile: COMPLETED_PROFILE });

    const quiz = (mockTenantStore.get(TENANT_ID)!.copilotAssessment as {
      quiz: { completedByUserId: number };
    }).quiz;
    expect(quiz.completedByUserId).toBe(4242);
  });
});
