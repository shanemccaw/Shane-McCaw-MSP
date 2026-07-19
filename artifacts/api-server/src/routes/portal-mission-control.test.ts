/**
 * portal-mission-control.test.ts
 *
 * Unit tests for the customer-facing Mission Control endpoints.
 *
 * Covers:
 *   - GET /portal/mission-control/engines — 401 without auth; only the
 *     customer-relevant engine subset is returned; pillar breakdown strips
 *     contributions (no internal signal keys anywhere in the payload)
 *   - GET /portal/mission-control/overview — finding→offer linking happens
 *     server-side on signal keys without exposing them; findings with no
 *     matching offer get offer: null; instant flag requires isTestbed
 *   - POST /portal/mission-control/remediate — HARD testbed guard (403 and
 *     the config pack orchestrator is never called for non-testbed
 *     customers), ownership 404, state 409, non-instant service 400,
 *     happy path fires the quickstart pack
 *
 * Run: pnpm --filter @workspace/api-server run test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

// ── JWT / env setup ───────────────────────────────────────────────────────────

const JWT_SECRET = "mission-control-test-secret";
process.env["JWT_SECRET"] = JWT_SECRET;

function customerToken(customerId: number, userId = 1): string {
  return jwt.sign(
    { id: userId, email: `c${customerId}@test.com`, role: "client", mspRole: "CustomerUser", customerId },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  db: { select: vi.fn() },
  mspCustomersTable: { id: "id", isTestbed: "is_testbed" },
  mspDiagnosticRunsTable: { customerId: "customer_id", createdAt: "created_at", status: "status", runId: "run_id" },
  mspDiagnosticFindingsTable: { runId: "run_id", severity: "severity", createdAt: "created_at" },
  salesOffersTable: { id: "id", customerId: "customer_id", state: "state", score: "score" },
  servicesTable: { id: "id", slug: "slug" },
}));

vi.mock("drizzle-orm", () => ({
  eq: (_c: unknown, _v: unknown) => ({ eq: [_c, _v] }),
  and: (...args: unknown[]) => ({ and: args }),
  desc: (_c: unknown) => "desc",
  inArray: (_c: unknown, _v: unknown) => ({ inArray: [_c, _v] }),
}));

vi.mock("../lib/engine-registry", () => ({
  runEngineManifestForTenant: vi.fn(),
}));

vi.mock("../lib/config-pack-orchestrator", () => {
  class ConfigPackError extends Error {
    code: string;
    details?: Record<string, unknown>;
    constructor(code: string, message: string, details?: Record<string, unknown>) {
      super(message);
      this.code = code;
      this.details = details;
    }
  }
  return { ConfigPackError, runConfigPackForCustomer: vi.fn() };
});

vi.mock("../lib/audit", () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/logger", () => {
  const stub = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };
  return { logger: { ...stub, child: vi.fn(() => stub) } };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

import { db } from "@workspace/db";
import { runEngineManifestForTenant } from "../lib/engine-registry";
import { runConfigPackForCustomer } from "../lib/config-pack-orchestrator";
import router from "./portal-mission-control";

const mockSelect = (db as unknown as { select: ReturnType<typeof vi.fn> }).select;
const mockManifest = runEngineManifestForTenant as unknown as ReturnType<typeof vi.fn>;
const mockRunPack = runConfigPackForCustomer as unknown as ReturnType<typeof vi.fn>;

/** Drizzle-style fluent chain, thenable at any point, resolving to `rows`. */
function buildChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "limit"]) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain["then"] = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(rows).then(resolve, reject);
  return chain;
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  return app;
}

beforeEach(() => {
  mockSelect.mockReset();
  mockManifest.mockReset();
  mockRunPack.mockReset();
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

const completedRun = {
  id: 1,
  runId: "11111111-1111-1111-1111-111111111111",
  customerId: 0, // set per test
  status: "completed",
  startedAt: new Date("2026-07-18T10:00:00Z"),
  completedAt: new Date("2026-07-18T10:05:00Z"),
  createdAt: new Date("2026-07-18T10:00:00Z"),
  checksTotal: 20,
  checksOk: 18,
  checksError: 2,
};

const criticalFinding = {
  id: 101,
  runId: completedRun.runId,
  checkKey: "mfa-check",
  checkLabel: "MFA Enforcement",
  severity: "critical",
  title: "MFA not enforced for all users",
  description: "12 accounts can sign in without multi-factor authentication.",
  recommendation: { signalKey: "sec:mfa-gap", estimatedEffort: "2 hours", category: "identity" },
  createdAt: new Date("2026-07-18T10:04:00Z"),
};

const unlinkedFinding = {
  id: 102,
  runId: completedRun.runId,
  checkKey: "guest-check",
  checkLabel: "Guest Access",
  severity: "warning",
  title: "Guest invitations unrestricted",
  description: "Anyone in the organization can invite guests.",
  recommendation: { estimatedEffort: "1 hour", category: "governance" },
  createdAt: new Date("2026-07-18T10:04:30Z"),
};

const sentOffer = {
  id: 7,
  customerId: 0, // set per test
  serviceId: 5,
  title: "Entra ID Quick-Start Pack",
  rationale: "Closes the MFA gap with a managed baseline.",
  firedSignalKeys: ["sec:mfa-gap"],
  adjustedPriceCents: 45_000,
  score: 80,
  state: "sent",
};

const quickstartService = { id: 5, slug: "entra-id-quickstart-v1" };

// ── Engines endpoint ──────────────────────────────────────────────────────────

describe("GET /portal/mission-control/engines", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(makeApp()).get("/portal/mission-control/engines");
    expect(res.status).toBe(401);
  });

  it("returns only the customer engine subset and strips pillar contributions", async () => {
    mockManifest.mockResolvedValue({
      health: {
        score: 90,
        breakdown: [
          { pillar: "governance", score: 10, contributions: [{ signalKey: "gov:leak-test", value: 10 }] },
          { pillar: "security", score: 25, contributions: [{ signalKey: "sec:leak-test", value: 25 }] },
        ],
      },
      security: { score: 10 },
      drift: { score: 45, trendDirection: "rising" },
      monitoring: { breakdown: { total: 5, ok: 5, error: 0 } },
      sla: { activeBreaches: 0, warningTimers: 1, runningTimers: 3 },
      scope_creep: { score: { openViolations: 0, openDetections: 0 } },
      // an MSP-internal engine sneaking into the result map must not surface
      pricing: { score: { totalPricingImpact: 9999 } },
    });

    const res = await request(makeApp())
      .get("/portal/mission-control/engines")
      .set("Authorization", `Bearer ${customerToken(4201)}`);

    expect(res.status).toBe(200);
    expect(mockManifest).toHaveBeenCalledWith(4201, undefined, [
      "health",
      "security",
      "drift",
      "monitoring",
      "sla",
      "scope_creep",
    ]);

    const keys = (res.body.engines as Array<{ key: string }>).map((e) => e.key);
    expect(keys).toEqual(["health", "security", "drift", "monitoring", "sla", "scope_creep"]);

    expect(res.body.health.score).toBe(90);
    expect(res.body.health.pillars).toEqual([
      { pillar: "governance", score: 10 },
      { pillar: "security", score: 25 },
    ]);

    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain("pricing");
    expect(raw).not.toContain("contributions");
    expect(raw).not.toContain("signalKey");
    expect(raw).not.toContain("leak-test");
  });

  it("derives severities from real engine output fields", async () => {
    mockManifest.mockResolvedValue({
      health: { score: 50, breakdown: [] },
      security: { score: 80 },
      drift: { score: 0, trendDirection: "flat" },
      monitoring: { breakdown: { total: 4, ok: 2, error: 2 } },
      sla: { activeBreaches: 2, warningTimers: 0, runningTimers: 5 },
      scope_creep: { score: { openViolations: 0, openDetections: 3 } },
    });

    const res = await request(makeApp())
      .get("/portal/mission-control/engines")
      .set("Authorization", `Bearer ${customerToken(4202)}`);

    expect(res.status).toBe(200);
    const bySeverity = Object.fromEntries(
      (res.body.engines as Array<{ key: string; severity: string }>).map((e) => [e.key, e.severity]),
    );
    expect(bySeverity).toEqual({
      health: "high", // 50 < 60
      security: "high", // 80 > 75
      drift: "good", // 0 <= 30
      monitoring: "watch", // failures with some passing
      sla: "high", // active breaches
      scope_creep: "watch", // open detections, no violations
    });
  });
});

// ── Overview endpoint ─────────────────────────────────────────────────────────

describe("GET /portal/mission-control/overview", () => {
  function queueOverviewQueries(opts: { isTestbed: boolean; customerId: number }) {
    const run = { ...completedRun, customerId: opts.customerId };
    const offer = { ...sentOffer, customerId: opts.customerId };
    mockSelect
      .mockReturnValueOnce(buildChain([run])) // latest run
      .mockReturnValueOnce(buildChain([run])) // last completed run
      .mockReturnValueOnce(buildChain([criticalFinding, unlinkedFinding])) // findings
      .mockReturnValueOnce(buildChain([offer])) // sent offers
      .mockReturnValueOnce(buildChain([quickstartService])) // service slugs
      .mockReturnValueOnce(buildChain([{ isTestbed: opts.isTestbed }])); // customer
  }

  it("links offers to findings server-side without exposing signal keys", async () => {
    queueOverviewQueries({ isTestbed: true, customerId: 4301 });

    const res = await request(makeApp())
      .get("/portal/mission-control/overview")
      .set("Authorization", `Bearer ${customerToken(4301)}`);

    expect(res.status).toBe(200);
    expect(res.body.scan.active).toBe(false);
    expect(res.body.scan.lastScanAt).toBeTruthy();
    expect(res.body.summary).toMatchObject({ critical: 1, warning: 1, checksOk: 18, checksTotal: 20 });

    const findings = res.body.findings as Array<{ id: number; offer: { id: number; instant: boolean } | null }>;
    expect(findings).toHaveLength(2);
    expect(findings[0]!.id).toBe(101); // critical first
    expect(findings[0]!.offer).toMatchObject({ id: 7, instant: true });
    expect(findings[1]!.offer).toBeNull(); // no fabricated offer

    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain("firedSignalKeys");
    expect(raw).not.toContain("signalKey");
    expect(raw).not.toContain("sec:mfa-gap");
  });

  it("marks linked offers non-instant for non-testbed customers", async () => {
    queueOverviewQueries({ isTestbed: false, customerId: 4302 });

    const res = await request(makeApp())
      .get("/portal/mission-control/overview")
      .set("Authorization", `Bearer ${customerToken(4302)}`);

    expect(res.status).toBe(200);
    const findings = res.body.findings as Array<{ offer: { instant: boolean } | null }>;
    expect(findings[0]!.offer).toMatchObject({ id: 7, instant: false });
  });
});

// ── Remediate endpoint ────────────────────────────────────────────────────────

describe("POST /portal/mission-control/remediate", () => {
  const CUSTOMER_ID = 4401;

  function post(body: object, customerId = CUSTOMER_ID) {
    return request(makeApp())
      .post("/portal/mission-control/remediate")
      .set("Authorization", `Bearer ${customerToken(customerId)}`)
      .send(body);
  }

  it("404s when the offer does not belong to the caller", async () => {
    mockSelect.mockReturnValueOnce(buildChain([])); // offer lookup scoped to caller
    const res = await post({ offerId: 7 });
    expect(res.status).toBe(404);
    expect(mockRunPack).not.toHaveBeenCalled();
  });

  it("409s when the offer is not in the sent state", async () => {
    mockSelect.mockReturnValueOnce(buildChain([{ ...sentOffer, customerId: CUSTOMER_ID, state: "accepted" }]));
    const res = await post({ offerId: 7 });
    expect(res.status).toBe(409);
    expect(mockRunPack).not.toHaveBeenCalled();
  });

  it("HARD GUARD: 403s for non-testbed customers and never calls the orchestrator", async () => {
    mockSelect
      .mockReturnValueOnce(buildChain([{ ...sentOffer, customerId: CUSTOMER_ID }])) // offer
      .mockReturnValueOnce(buildChain([{ isTestbed: false }])); // customer
    const res = await post({ offerId: 7 });
    expect(res.status).toBe(403);
    expect(mockRunPack).not.toHaveBeenCalled();
  });

  it("400s for offers whose service has no instant-remediation pack", async () => {
    mockSelect
      .mockReturnValueOnce(buildChain([{ ...sentOffer, customerId: CUSTOMER_ID }])) // offer
      .mockReturnValueOnce(buildChain([{ isTestbed: true }])) // customer
      .mockReturnValueOnce(buildChain([{ id: 5, slug: "unrelated-service" }])); // service
    const res = await post({ offerId: 7 });
    expect(res.status).toBe(400);
    expect(mockRunPack).not.toHaveBeenCalled();
  });

  it("fires the quickstart pack for a testbed customer with an eligible sent offer", async () => {
    mockSelect
      .mockReturnValueOnce(buildChain([{ ...sentOffer, customerId: CUSTOMER_ID }])) // offer
      .mockReturnValueOnce(buildChain([{ isTestbed: true }])) // customer
      .mockReturnValueOnce(buildChain([quickstartService])); // service
    mockRunPack.mockResolvedValue({
      runId: 123,
      definitionId: 1,
      versionId: 2,
      reusedVersion: false,
      gated: true,
      templateOrder: [],
    });

    const res = await post({ offerId: 7 });
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ runId: 123, packKey: "quickstart-v1", gated: true });
    expect(mockRunPack).toHaveBeenCalledTimes(1);
    expect(mockRunPack).toHaveBeenCalledWith(
      expect.objectContaining({ packKey: "quickstart-v1", customerId: CUSTOMER_ID }),
    );
  });

  it("maps the orchestrator's own testbed rejection to 403 (second enforcement layer)", async () => {
    mockSelect
      .mockReturnValueOnce(buildChain([{ ...sentOffer, customerId: CUSTOMER_ID }])) // offer
      .mockReturnValueOnce(buildChain([{ isTestbed: true }])) // customer (stale flag scenario)
      .mockReturnValueOnce(buildChain([quickstartService])); // service
    const { ConfigPackError } = await import("../lib/config-pack-orchestrator");
    mockRunPack.mockRejectedValue(new ConfigPackError("customer_not_testbed", "not a testbed customer"));

    const res = await post({ offerId: 7 });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("customer_not_testbed");
  });
});
