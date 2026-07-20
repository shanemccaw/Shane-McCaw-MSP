/**
 * msp-alerts.test.ts
 *
 * Unit tests for the Cross-Tenant Alerts endpoint (GET /msp/alerts).
 *
 * Covers:
 *   - 401 without auth, 403 below MSPOperator
 *   - merges open policy incidents + latest-run warning/critical findings,
 *     scoped strictly to the caller's own mspId (resolveMspIdStrict — no
 *     query-param override, so no cross-MSP leakage is even reachable)
 *   - severity / category / customerId filters narrow the merged result
 *   - only each customer's LATEST completed run's findings are included,
 *     not older runs
 *
 * Run: pnpm --filter @workspace/api-server run test -- msp-alerts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

const JWT_SECRET = "msp-alerts-test-secret";
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
  mspDiagnosticRunsTable: { runId: "runId", customerId: "customerId", completedAt: "completedAt", mspId: "mspId", status: "status" },
  mspDiagnosticFindingsTable: {
    id: "id", findingId: "findingId", runId: "runId", customerId: "customerId", severity: "severity",
    title: "title", description: "description", recommendation: "recommendation", checkKey: "checkKey",
    createdAt: "createdAt", mspId: "mspId",
  },
  policyRuleIncidentsTable: {
    id: "id", ruleId: "ruleId", customerId: "customerId", mspId: "mspId", status: "status",
    currentLevel: "currentLevel", openedAt: "openedAt", lastEscalatedAt: "lastEscalatedAt",
  },
  policyRulesTable: { id: "id", name: "name", severity: "severity", conditionType: "conditionType" },
}));

vi.mock("drizzle-orm", () => ({
  eq: (c: unknown, v: unknown) => ({ eq: [c, v] }),
  and: (...args: unknown[]) => ({ and: args }),
  desc: (c: unknown) => ({ desc: c }),
  inArray: (c: unknown, v: unknown) => ({ inArray: [c, v] }),
}));

vi.mock("../lib/logger", () => {
  const stub = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };
  return { logger: { ...stub, child: vi.fn(() => stub) } };
});

import { db } from "@workspace/db";
import router from "./msp-alerts";

const mockSelect = (db as unknown as { select: ReturnType<typeof vi.fn> }).select;

/** Drizzle-style fluent chain, thenable at any point, resolving to `rows`. */
function buildChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "limit", "innerJoin"]) {
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

const openIncident = {
  id: 501,
  customerId: 1,
  currentLevel: 2,
  openedAt: new Date("2026-07-15T10:00:00Z"),
  lastEscalatedAt: new Date("2026-07-16T10:00:00Z"),
  ruleName: "Repeated Failed Sign-Ins",
  ruleSeverity: "critical",
  conditionType: "signal",
};

const latestRun = {
  runId: "run-latest",
  customerId: 2,
  completedAt: new Date("2026-07-19T10:00:00Z"),
};
const olderRun = {
  runId: "run-older",
  customerId: 2,
  completedAt: new Date("2026-07-10T10:00:00Z"),
};

const latestFinding = {
  id: 1,
  findingId: "f-latest",
  runId: "run-latest",
  customerId: 2,
  severity: "warning",
  title: "Guest invitations unrestricted",
  description: "desc",
  recommendation: { category: "governance" },
  checkKey: "guest-check",
  createdAt: new Date("2026-07-19T10:01:00Z"),
};

/** Queue the 4 sequential db.select() calls the handler makes: customers, incidents, runs, findings. */
function queueHandlerSelects(opts: {
  customers?: unknown[];
  incidents?: unknown[];
  runs?: unknown[];
  findings?: unknown[];
}) {
  mockSelect.mockReturnValueOnce(buildChain(opts.customers ?? customers));
  mockSelect.mockReturnValueOnce(buildChain(opts.incidents ?? [openIncident]));
  mockSelect.mockReturnValueOnce(buildChain(opts.runs ?? [latestRun, olderRun]));
  if ((opts.runs ?? [latestRun, olderRun]).length > 0) {
    mockSelect.mockReturnValueOnce(buildChain(opts.findings ?? [latestFinding]));
  }
}

describe("GET /msp/alerts", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(makeApp()).get("/msp/alerts");
    expect(res.status).toBe(401);
  });

  it("rejects roles below MSPOperator", async () => {
    const res = await request(makeApp())
      .get("/msp/alerts")
      .set("Authorization", `Bearer ${mspToken(MSP_ID, "CustomerUser")}`);
    expect(res.status).toBe(403);
  });

  it("merges open incidents and latest-run findings, scoped to caller's mspId", async () => {
    queueHandlerSelects({});
    const res = await request(makeApp())
      .get("/msp/alerts")
      .set("Authorization", `Bearer ${mspToken(MSP_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    const sources = res.body.alerts.map((a: { source: string }) => a.source).sort();
    expect(sources).toEqual(["diagnostic_finding", "policy_incident"]);

    const incidentAlert = res.body.alerts.find((a: { source: string }) => a.source === "policy_incident");
    expect(incidentAlert.customerName).toBe("Acme Corp");
    expect(incidentAlert.severity).toBe("critical");
    expect(incidentAlert.deepLink).toBe("/customers/1");

    const findingAlert = res.body.alerts.find((a: { source: string }) => a.source === "diagnostic_finding");
    expect(findingAlert.customerName).toBe("Beta LLC");
    // Only the LATEST run's finding surfaces — the older run is excluded.
    expect(findingAlert.id).toBe("finding-f-latest");
  });

  it("filters by severity", async () => {
    queueHandlerSelects({});
    const res = await request(makeApp())
      .get("/msp/alerts?severity=critical")
      .set("Authorization", `Bearer ${mspToken(MSP_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.alerts[0].source).toBe("policy_incident");
  });

  it("filters by customerId", async () => {
    queueHandlerSelects({});
    const res = await request(makeApp())
      .get(`/msp/alerts?customerId=2`)
      .set("Authorization", `Bearer ${mspToken(MSP_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.alerts[0].customerId).toBe(2);
  });

  it("filters by category", async () => {
    queueHandlerSelects({});
    const res = await request(makeApp())
      .get(`/msp/alerts?category=governance`)
      .set("Authorization", `Bearer ${mspToken(MSP_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.alerts[0].source).toBe("diagnostic_finding");
  });

  it("returns an empty list when the MSP has no incidents or runs", async () => {
    queueHandlerSelects({ customers: [], incidents: [], runs: [] });
    const res = await request(makeApp())
      .get("/msp/alerts")
      .set("Authorization", `Bearer ${mspToken(MSP_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.alerts).toEqual([]);
  });
});
