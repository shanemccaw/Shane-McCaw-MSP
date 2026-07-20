/**
 * msp-customer-timeline.test.ts
 *
 * Unit tests for the MSP Cross-Tenant Timeline endpoint (GET /msp/timeline).
 *
 * Covers:
 *   - 401 without auth, 403 below MSPOperator
 *   - merges scan/finding/score-change/document/offer events across the
 *     caller's mspId (resolveMspIdStrict — no query-param override)
 *   - the same significance filters as portal-customer-timeline.ts (only
 *     warning/critical findings, |delta| >= 5 score changes) carry over
 *   - customerId filter narrows the merged result
 *   - a scoped MSP staff member only sees their assigned customers' events
 *
 * Run: pnpm --filter @workspace/api-server run test -- msp-customer-timeline
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

const JWT_SECRET = "msp-customer-timeline-test-secret";
process.env["JWT_SECRET"] = JWT_SECRET;

function mspToken(mspId: number, mspRole: "MSPOperator" | "MSPAdmin" | "CustomerUser" = "MSPOperator"): string {
  return jwt.sign(
    { id: 1, email: "staff@test.com", role: "client", mspRole, mspId },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

vi.mock("@workspace/db", () => ({
  db: { select: vi.fn() },
  mspCustomersTable: { id: "id", name: "name", mspId: "mspId" },
  mspUsersTable: { userId: "userId", customerId: "customerId", mspId: "mspId" },
  mspDiagnosticRunsTable: {
    runId: "runId", customerId: "customerId", status: "status", checksTotal: "checksTotal",
    checksOk: "checksOk", completedAt: "completedAt", createdAt: "createdAt", mspId: "mspId",
  },
  mspDiagnosticFindingsTable: {
    findingId: "findingId", customerId: "customerId", severity: "severity", title: "title",
    description: "description", createdAt: "createdAt", mspId: "mspId",
  },
  tenantEngineSnapshotsTable: {
    id: "id", customerId: "customerId", engineKey: "engineKey", score: "score",
    previousScore: "previousScore", delta: "delta", capturedAt: "capturedAt", mspId: "mspId",
  },
  insightsGeneratedDocumentsTable: {
    id: "id", customerId: "customerId", title: "title", docType: "docType", status: "status",
    approvedAt: "approvedAt", deliveredAt: "deliveredAt", createdAt: "createdAt",
  },
  salesOffersTable: {
    id: "id", customerId: "customerId", title: "title", state: "state", sentAt: "sentAt",
    acceptedAt: "acceptedAt", closedAt: "closedAt", createdAt: "createdAt", mspId: "mspId",
  },
  // Per-staff customer-access scoping table (read by resolveStaffScopedCustomerIds).
  mspStaffCustomerScopesTable: { customerId: "customerId", staffUserId: "staffUserId", mspId: "mspId" },
}));

vi.mock("drizzle-orm", () => ({
  eq: (c: unknown, v: unknown) => ({ eq: [c, v] }),
  and: (...args: unknown[]) => ({ and: args }),
  desc: (c: unknown) => ({ desc: c }),
  lt: (c: unknown, v: unknown) => ({ lt: [c, v] }),
  inArray: (c: unknown, v: unknown) => ({ inArray: [c, v] }),
  // engine-registry.ts (pulled in transitively via ENGINE_DEFS) tags a raw
  // SQL fragment at module load — stub it so import doesn't throw.
  sql: Object.assign((strings: TemplateStringsArray, ...values: unknown[]) => ({ sql: strings, values }), {
    raw: (s: string) => ({ sql: s }),
  }),
}));

vi.mock("../lib/logger", () => {
  const stub = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };
  return { logger: { ...stub, child: vi.fn(() => stub) } };
});

import { db } from "@workspace/db";
import router from "./msp-customer-timeline";

const mockSelect = (db as unknown as { select: ReturnType<typeof vi.fn> }).select;

/** Drizzle-style fluent chain, thenable at any point, resolving to `rows`. */
function buildChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "limit", "leftJoin"]) {
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
});

const MSP_ID = 900;

const customers = [
  { id: 1, name: "Acme Corp" },
  { id: 2, name: "Beta LLC" },
];

const bridgeRows = [
  { userId: 101, customerId: 1, customerName: "Acme Corp" },
  { userId: 102, customerId: 2, customerName: "Beta LLC" },
];

const completedRun = {
  runId: "run-1",
  customerId: 1,
  status: "completed",
  checksTotal: 10,
  checksOk: 9,
  completedAt: new Date("2026-07-19T10:00:00Z"),
  createdAt: new Date("2026-07-19T09:00:00Z"),
};

const criticalFinding = {
  findingId: "f-1",
  customerId: 2,
  severity: "critical",
  title: "MFA disabled for admin",
  description: "desc",
  createdAt: new Date("2026-07-18T10:00:00Z"),
};

const significantScoreChange = {
  id: 1,
  customerId: 1,
  engineKey: "securityScore",
  score: 80,
  previousScore: 70,
  delta: 10,
  capturedAt: new Date("2026-07-17T10:00:00Z"),
};
const insignificantScoreChange = {
  id: 2,
  customerId: 1,
  engineKey: "securityScore",
  score: 82,
  previousScore: 80,
  delta: 2,
  capturedAt: new Date("2026-07-17T11:00:00Z"),
};

const deliveredDocument = {
  id: 1,
  customerId: 101, // users.id, bridged to msp_customers.id=1
  title: "Q3 Security Report",
  docType: "report",
  status: "delivered",
  approvedAt: null,
  deliveredAt: new Date("2026-07-16T10:00:00Z"),
  createdAt: new Date("2026-07-16T09:00:00Z"),
};

const sentOffer = {
  id: 1,
  customerId: 102, // users.id, bridged to msp_customers.id=2
  title: "MFA Rollout",
  state: "sent",
  sentAt: new Date("2026-07-15T10:00:00Z"),
  acceptedAt: null,
  closedAt: null,
  createdAt: new Date("2026-07-15T09:00:00Z"),
};

/** Queue the sequential db.select() calls the handler makes:
 *  scope rows, customers, bridge, runs, findings, snapshots, [documents], offers. */
function queueHandlerSelects(opts: {
  scopeRows?: unknown[];
  customers?: unknown[];
  bridge?: unknown[];
  runs?: unknown[];
  findings?: unknown[];
  snapshots?: unknown[];
  documents?: unknown[];
  offers?: unknown[];
  skipDocuments?: boolean;
}) {
  mockSelect.mockReturnValueOnce(buildChain(opts.scopeRows ?? []));
  mockSelect.mockReturnValueOnce(buildChain(opts.customers ?? customers));
  mockSelect.mockReturnValueOnce(buildChain(opts.bridge ?? bridgeRows));
  mockSelect.mockReturnValueOnce(buildChain(opts.runs ?? [completedRun]));
  mockSelect.mockReturnValueOnce(buildChain(opts.findings ?? [criticalFinding]));
  mockSelect.mockReturnValueOnce(buildChain(opts.snapshots ?? [significantScoreChange, insignificantScoreChange]));
  if (!opts.skipDocuments) {
    mockSelect.mockReturnValueOnce(buildChain(opts.documents ?? [deliveredDocument]));
  }
  mockSelect.mockReturnValueOnce(buildChain(opts.offers ?? [sentOffer]));
}

describe("GET /msp/timeline", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(makeApp()).get("/msp/timeline");
    expect(res.status).toBe(401);
  });

  it("rejects roles below MSPOperator", async () => {
    const res = await request(makeApp())
      .get("/msp/timeline")
      .set("Authorization", `Bearer ${mspToken(MSP_ID, "CustomerUser")}`);
    expect(res.status).toBe(403);
  });

  it("merges events across the MSP's book, each tagged with its customer", async () => {
    queueHandlerSelects({});
    const res = await request(makeApp())
      .get("/msp/timeline")
      .set("Authorization", `Bearer ${mspToken(MSP_ID)}`);

    expect(res.status).toBe(200);
    // significant score change survives, the sub-threshold one does not:
    // 5 sources -> 5 events (run, finding, 1 of 2 snapshots, document, offer)
    expect(res.body.events).toHaveLength(5);

    const types = res.body.events.map((e: { type: string }) => e.type).sort();
    expect(types).toEqual(["document", "finding", "offer", "scan_completed", "score_change"]);

    const findingEvent = res.body.events.find((e: { type: string }) => e.type === "finding");
    expect(findingEvent.customerId).toBe(2);
    expect(findingEvent.customerName).toBe("Beta LLC");
    expect(findingEvent.deepLink).toBe("/customers/2");
    expect(findingEvent.status).toBe("error");

    const scoreEvent = res.body.events.find((e: { type: string }) => e.type === "score_change");
    expect(scoreEvent.description).toContain("70 → 80");

    const docEvent = res.body.events.find((e: { type: string }) => e.type === "document");
    expect(docEvent.customerId).toBe(1);
    expect(docEvent.customerName).toBe("Acme Corp");

    const offerEvent = res.body.events.find((e: { type: string }) => e.type === "offer");
    expect(offerEvent.customerId).toBe(2);
  });

  it("filters by customerId", async () => {
    queueHandlerSelects({
      customers: [{ id: 1, name: "Acme Corp" }],
      runs: [completedRun],
      findings: [],
      snapshots: [significantScoreChange],
      documents: [deliveredDocument],
      offers: [],
    });
    const res = await request(makeApp())
      .get("/msp/timeline?customerId=1")
      .set("Authorization", `Bearer ${mspToken(MSP_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.events.length).toBeGreaterThan(0);
    for (const e of res.body.events) {
      expect(e.customerId).toBe(1);
    }
  });

  it("returns an empty timeline when the MSP has no activity", async () => {
    queueHandlerSelects({
      customers: [],
      bridge: [],
      runs: [],
      findings: [],
      snapshots: [],
      skipDocuments: true,
      offers: [],
    });
    const res = await request(makeApp())
      .get("/msp/timeline")
      .set("Authorization", `Bearer ${mspToken(MSP_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.events).toEqual([]);
    expect(res.body.nextCursor).toBeNull();
  });

  it("restricts a scoped operator to their assigned customers", async () => {
    // Staff member scoped to customer 1 only. eligibleUserIds narrows to
    // just userId 101 (Acme), so customer 2's document/offer events never
    // even get queried for by this operator's requests.
    queueHandlerSelects({
      scopeRows: [{ customerId: 1 }],
      customers: [{ id: 1, name: "Acme Corp" }],
      bridge: [{ userId: 101, customerId: 1, customerName: "Acme Corp" }],
      runs: [completedRun],
      findings: [],
      snapshots: [],
      documents: [deliveredDocument],
      offers: [],
    });
    const res = await request(makeApp())
      .get("/msp/timeline")
      .set("Authorization", `Bearer ${mspToken(MSP_ID)}`);

    expect(res.status).toBe(200);
    for (const e of res.body.events) {
      expect(e.customerId).toBe(1);
    }
  });
});
