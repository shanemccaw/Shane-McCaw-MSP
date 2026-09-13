/**
 * public-free-scan-results.test.ts — Git #1358 (Phase 6 of Epic #1352, Free Scan).
 *
 * Drives the REAL express handler against the REAL local Postgres — real
 * tenants/checkout_sessions/msp_diagnostic_runs/msp_diagnostic_findings rows
 * created under this run's own tag and deleted in afterAll, same pattern as
 * public-purchase-packs.test.ts. `runDiagnostics` is mocked so the "no run
 * yet" path (which fires the #3946 backstop's fire-and-forget trigger) never
 * makes a real Graph call — only the ROUTE's ordering/shape is under test
 * here, not the scan engine underneath.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { randomUUID, randomBytes } from "crypto";
import {
  db,
  tenantsTable,
  mspsTable,
  checkoutSessionsTable,
  mspDiagnosticRunsTable,
  mspDiagnosticFindingsTable,
} from "@workspace/db";
import { inArray } from "drizzle-orm";

const mockRunDiagnostics = vi.fn().mockResolvedValue(undefined);
vi.mock("../lib/diagnostics-runner.ts", () => ({
  runDiagnostics: (...args: unknown[]) => mockRunDiagnostics(...args),
}));

const RUN_TAG = randomBytes(4).toString("hex");
const createdTenantIds: number[] = [];
const createdSessionIds: string[] = [];
const createdRunIds: string[] = [];

async function anyMspId(): Promise<number> {
  const [msp] = await db.select({ id: mspsTable.id }).from(mspsTable).limit(1);
  if (!msp) throw new Error("no MSP row exists in the local DB to anchor test rows to");
  return msp.id;
}

const GRANTED_READ = { graph: { status: "granted" } };

async function makeTenant(mspId: number, consent: Record<string, unknown> = {}): Promise<{ id: number; tenantId: string }> {
  const tenantId = randomUUID();
  const [row] = await db
    .insert(tenantsTable)
    .values({
      mspId,
      customerName: `Free Scan Results Test 1358 ${RUN_TAG}`,
      tenantId,
      domain: `free-scan-results-1358-${RUN_TAG}.onmicrosoft.com`,
      consent,
    })
    .returning({ id: tenantsTable.id, tenantId: tenantsTable.tenantId });
  createdTenantIds.push(row.id);
  return row;
}

async function makeSession(tenantId: string): Promise<string> {
  const [row] = await db
    .insert(checkoutSessionsTable)
    .values({
      productSlug: "license-waste-audit-free",
      fullName: "Free Scan Prospect 1358",
      email: `test-1358-${RUN_TAG}@free-scan-results-test.invalid`,
      company: "Free Scan Results Test Co",
      seats: 1,
      status: "consented",
      tenantId,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    })
    .returning({ id: checkoutSessionsTable.id });
  createdSessionIds.push(row.id);
  return row.id;
}

async function makeRun(mspId: number, customerId: number, status: "pending" | "running" | "completed"): Promise<string> {
  const [row] = await db
    .insert(mspDiagnosticRunsTable)
    .values({ mspId, customerId, status })
    .returning({ runId: mspDiagnosticRunsTable.runId });
  createdRunIds.push(row.runId);
  return row.runId;
}

async function makeFinding(
  runId: string,
  mspId: number,
  customerId: number,
  overrides: Partial<typeof mspDiagnosticFindingsTable.$inferInsert> = {},
) {
  await db.insert(mspDiagnosticFindingsTable).values({
    runId,
    mspId,
    customerId,
    checkKey: "security:test-mfa-1358",
    checkLabel: "Test MFA check (Git #1358)",
    severity: "critical",
    title: "3 admin accounts can sign in without MFA",
    ...overrides,
  });
}

afterAll(async () => {
  if (createdRunIds.length) {
    await db.delete(mspDiagnosticFindingsTable).where(inArray(mspDiagnosticFindingsTable.runId, createdRunIds));
    await db.delete(mspDiagnosticRunsTable).where(inArray(mspDiagnosticRunsTable.runId, createdRunIds));
  }
  if (createdSessionIds.length)
    await db.delete(checkoutSessionsTable).where(inArray(checkoutSessionsTable.id, createdSessionIds));
  if (createdTenantIds.length) await db.delete(tenantsTable).where(inArray(tenantsTable.id, createdTenantIds));
});

// Built ONCE (60s budget): the route's import chain (consent.ts → graph.ts,
// pillar-summary-stats.ts → health-engine.ts) is heavy on first transform —
// same reasoning public-purchase-packs.test.ts documents at its own buildApp.
let cachedApp: express.Express | null = null;
async function buildApp() {
  if (cachedApp) return cachedApp;
  const { default: router } = await import("./public-free-scan-results.ts");
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  cachedApp = app;
  return app;
}

beforeAll(async () => {
  await buildApp();
}, 60_000);

describe("GET /api/public/free-scan/results — ordering gates", () => {
  it("400s an invalid session id", async () => {
    const app = await buildApp();
    const res = await request(app).get("/api/public/free-scan/results?sessionId=nope");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("session_invalid");
  });

  it("404s a session id with no matching / expired session", async () => {
    const app = await buildApp();
    const res = await request(app).get(`/api/public/free-scan/results?sessionId=${randomUUID()}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("session_expired");
  });

  it("409s read_consent_required when the tenant has not granted read consent", async () => {
    const mspId = await anyMspId();
    const tenant = await makeTenant(mspId, {});
    const sessionId = await makeSession(tenant.tenantId);
    const app = await buildApp();
    const res = await request(app).get(`/api/public/free-scan/results?sessionId=${sessionId}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("read_consent_required");
  });
});

describe("GET /api/public/free-scan/results — real scan state", () => {
  it("reports status:scanning and fires the #3946 backstop when NO run exists yet for this customer", async () => {
    const mspId = await anyMspId();
    const tenant = await makeTenant(mspId, GRANTED_READ);
    const sessionId = await makeSession(tenant.tenantId);
    mockRunDiagnostics.mockClear();

    const app = await buildApp();
    const res = await request(app).get(`/api/public/free-scan/results?sessionId=${sessionId}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("scanning");
    expect(res.body.activeRunId).toBeNull();
    expect(res.body.findingsRunId).toBeNull();
    // Let the fire-and-forget backstop trigger run before asserting on it.
    await new Promise((resolve) => setImmediate(resolve));
    expect(mockRunDiagnostics).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: tenant.id, packageKey: "core:free-scan-full" }),
    );

    if (createdRunIds.length) {
      // The backstop's own trigger is mocked, but it still inserts no row
      // itself (that's runDiagnostics' job, which is mocked away) — nothing
      // to sweep here beyond the tenant/session created above.
    }
  });

  it("reports status:scanning (no backstop fire) while a run is genuinely still pending/running", async () => {
    const mspId = await anyMspId();
    const tenant = await makeTenant(mspId, GRANTED_READ);
    const sessionId = await makeSession(tenant.tenantId);
    await makeRun(mspId, tenant.id, "running");
    mockRunDiagnostics.mockClear();

    const app = await buildApp();
    const res = await request(app).get(`/api/public/free-scan/results?sessionId=${sessionId}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("scanning");
    expect(res.body.activeRunId).not.toBeNull();
    expect(mockRunDiagnostics).not.toHaveBeenCalled();
  });

  it("serves real locked results — scores, finding counts and findings, but never `recommendation` — once a run has settled", async () => {
    const mspId = await anyMspId();
    const tenant = await makeTenant(mspId, GRANTED_READ);
    const sessionId = await makeSession(tenant.tenantId);
    const runId = await makeRun(mspId, tenant.id, "completed");
    await makeFinding(runId, mspId, tenant.id, {
      checkKey: "security:test-mfa-1358",
      severity: "critical",
      title: "3 admin accounts can sign in without MFA",
      description: "Three admin accounts have no MFA method registered.",
      recommendation: { action: "Register MFA on all three accounts", estimatedEffort: "20 minutes" },
    });
    mockRunDiagnostics.mockClear();

    const app = await buildApp();
    const res = await request(app).get(`/api/public/free-scan/results?sessionId=${sessionId}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ready");
    expect(mockRunDiagnostics).not.toHaveBeenCalled();
    expect(res.body.totalFindings).toBeGreaterThanOrEqual(1);
    expect(res.body.criticalFindings).toBeGreaterThanOrEqual(1);

    const securityCard = (res.body.pillars as Array<{ pillar: string; findings: unknown[] }>).find(
      (p) => p.pillar === "security",
    );
    expect(securityCard).toBeDefined();
    const finding = (securityCard!.findings as Array<Record<string, unknown>>).find(
      (f) => f.checkKey === "security:test-mfa-1358",
    );
    expect(finding).toBeDefined();
    expect(finding!.title).toBe("3 admin accounts can sign in without MFA");
    expect(finding!.description).toBe("Three admin accounts have no MFA method registered.");
    // The one field this route must never put on the wire (see file header).
    expect(finding).not.toHaveProperty("recommendation");
  });
});
