/**
 * public-purchase-packs.test.ts — Git #1316 (Phase 7 of Epic #1309).
 *
 * Drives the REAL express handlers in public-purchase-packs.ts against the
 * REAL local Postgres — real checkout_sessions/tenants/audit_logs/wf_runs rows
 * created under this run's own ids and deleted in afterAll, and the REAL
 * services catalog rows (entra-id-quickstart-v1 etc.) so the paid-pack
 * resolution under test is the same category/packKey resolution production
 * uses. The dry-run builder and the orchestrator's run function are mocked —
 * this suite proves the ROUTE's ordering gates (paid → read consent → write
 * consent → allowlist → idempotency), not the engine underneath (covered by
 * config-pack-dry-run.test.ts).
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import {
  db,
  auditLogsTable,
  checkoutSessionsTable,
  tenantsTable,
  wfDefinitionsTable,
  wfRunsTable,
  wfVersionsTable,
  type WfGraph,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const mockCreateAuditLog = vi.fn().mockResolvedValue(undefined);
vi.mock("../lib/audit", () => ({ createAuditLog: (...args: unknown[]) => mockCreateAuditLog(...args) }));

const mockBuildDryRun = vi.fn();
vi.mock("../lib/config-pack-dry-run", () => ({
  buildConfigPackDryRun: (...args: unknown[]) => mockBuildDryRun(...args),
}));

const mockRunPack = vi.fn();
vi.mock("../lib/config-pack-orchestrator", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  runConfigPackForCustomer: (...args: unknown[]) => mockRunPack(...args),
}));

const RUN_TAG = randomUUID().slice(0, 8);
const PACK_SLUG = "entra-id-quickstart-v1"; // → quickstart-v1 (allowlisted)
const NON_ALLOWLISTED_PACK_SLUG = "identity-hygiene-pack-v1"; // → identity-hygiene-v1
const MONITORING_SLUG = "monitoring-growth-smb";

const createdSessionIds: string[] = [];
const createdTenantRowIds: number[] = [];
const createdAuditIds: number[] = [];
const createdRunIds: number[] = [];
const createdVersionIds: number[] = [];
const createdDefinitionIds: number[] = [];

async function createTenant(consent: Record<string, unknown>) {
  const [row] = await db
    .insert(tenantsTable)
    .values({
      mspId: 1,
      customerName: `Packs Route Test 1316 ${RUN_TAG}`,
      tenantId: randomUUID(),
      domain: `packs-route-1316-${RUN_TAG}.onmicrosoft.com`,
      consent,
    })
    .returning({ id: tenantsTable.id, tenantId: tenantsTable.tenantId });
  createdTenantRowIds.push(row.id);
  return row;
}

async function createSession(overrides: Partial<typeof checkoutSessionsTable.$inferInsert> = {}) {
  const [row] = await db
    .insert(checkoutSessionsTable)
    .values({
      productSlug: PACK_SLUG,
      fullName: "Pack Buyer 1316",
      email: `test-1316-${RUN_TAG}@purchase-packs-test.invalid`,
      company: "Contoso Test",
      seats: 1,
      status: "paid",
      tenantId: randomUUID(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      ...overrides,
    })
    .returning({ id: checkoutSessionsTable.id });
  createdSessionIds.push(row.id);
  return row.id;
}

afterAll(async () => {
  if (createdRunIds.length) await db.delete(wfRunsTable).where(inArray(wfRunsTable.id, createdRunIds));
  if (createdVersionIds.length)
    await db.delete(wfVersionsTable).where(inArray(wfVersionsTable.id, createdVersionIds));
  if (createdDefinitionIds.length)
    await db.delete(wfDefinitionsTable).where(inArray(wfDefinitionsTable.id, createdDefinitionIds));
  if (createdAuditIds.length) await db.delete(auditLogsTable).where(inArray(auditLogsTable.id, createdAuditIds));
  if (createdSessionIds.length)
    await db.delete(checkoutSessionsTable).where(inArray(checkoutSessionsTable.id, createdSessionIds));
  if (createdTenantRowIds.length)
    await db.delete(tenantsTable).where(inArray(tenantsTable.id, createdTenantRowIds));
});

// Built ONCE in beforeAll (60s budget): the route module's import chain
// (consent.ts → graph.ts, orchestrator → workflow-executor) takes far longer
// than the 5s per-test budget on first transform, so importing lazily inside
// the first test times it out spuriously.
let cachedApp: express.Express | null = null;
async function buildApp() {
  if (cachedApp) return cachedApp;
  const { default: router } = await import("./public-purchase-packs.ts");
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  cachedApp = app;
  return app;
}

beforeAll(async () => {
  await buildApp();
}, 60_000);

const GRANTED_BOTH = { graph: { status: "granted" }, writeBack: { status: "granted" } };
const GRANTED_READ_ONLY = { graph: { status: "granted" } };

const dryRunStub = (packKey: string) => ({
  packKey,
  label: `Stub ${packKey}`,
  gated: true,
  executable: packKey === "quickstart-v1",
  missingOperatorVariables: [],
  actions: [],
  readAt: new Date().toISOString(),
});

beforeEach(() => {
  mockCreateAuditLog.mockClear();
  mockBuildDryRun.mockReset().mockImplementation(async (packKey: string) => dryRunStub(packKey));
  mockRunPack.mockReset().mockResolvedValue({
    runId: 424242,
    definitionId: 1,
    versionId: 1,
    reusedVersion: true,
    gated: true,
    templateOrder: [],
  });
});

describe("GET /api/public/purchase/pack-dry-run — ordering gates", () => {
  it("400s an invalid session id", async () => {
    const app = await buildApp();
    const res = await request(app).get("/api/public/purchase/pack-dry-run?sessionId=nope");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("session_invalid");
  });

  it("409s payment_required for a consented-but-unpaid session", async () => {
    const tenant = await createTenant(GRANTED_BOTH);
    const sessionId = await createSession({ status: "consented", tenantId: tenant.tenantId });
    const app = await buildApp();
    const res = await request(app).get(`/api/public/purchase/pack-dry-run?sessionId=${sessionId}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("payment_required");
    expect(mockBuildDryRun).not.toHaveBeenCalled();
  });

  it("409s write_consent_required when only read consent is granted", async () => {
    const tenant = await createTenant(GRANTED_READ_ONLY);
    const sessionId = await createSession({ tenantId: tenant.tenantId });
    const app = await buildApp();
    const res = await request(app).get(`/api/public/purchase/pack-dry-run?sessionId=${sessionId}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("write_consent_required");
    expect(mockBuildDryRun).not.toHaveBeenCalled();
  });

  it("409s packs_not_applicable for a non-pack (monitoring) session", async () => {
    const tenant = await createTenant(GRANTED_BOTH);
    const sessionId = await createSession({ productSlug: MONITORING_SLUG, tenantId: tenant.tenantId });
    const app = await buildApp();
    const res = await request(app).get(`/api/public/purchase/pack-dry-run?sessionId=${sessionId}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("packs_not_applicable");
  });

  it("serves the real dry-run for the session's paid pack", async () => {
    const tenant = await createTenant(GRANTED_BOTH);
    const sessionId = await createSession({ tenantId: tenant.tenantId });
    const app = await buildApp();
    const res = await request(app).get(`/api/public/purchase/pack-dry-run?sessionId=${sessionId}`);
    expect(res.status).toBe(200);
    expect(mockBuildDryRun).toHaveBeenCalledWith("quickstart-v1", tenant.id);
    expect(res.body.packs).toHaveLength(1);
    expect(res.body.packs[0]).toMatchObject({
      serviceSlug: PACK_SLUG,
      packKey: "quickstart-v1",
      executable: true,
    });
  });

  it("includes the extra packs recorded at payment confirmation (audit row), never caller input", async () => {
    const tenant = await createTenant(GRANTED_BOTH);
    const sessionId = await createSession({ tenantId: tenant.tenantId });
    const [audit] = await db
      .insert(auditLogsTable)
      .values({
        actorName: "public:purchase-flow",
        actorRole: "client",
        actionType: "purchase_flow_payment_succeeded",
        entityType: "checkout_session",
        entityId: sessionId,
        metadata: { packSlugs: [PACK_SLUG, NON_ALLOWLISTED_PACK_SLUG] },
      })
      .returning({ id: auditLogsTable.id });
    createdAuditIds.push(audit.id);

    const app = await buildApp();
    const res = await request(app).get(`/api/public/purchase/pack-dry-run?sessionId=${sessionId}`);
    expect(res.status).toBe(200);
    const keys = (res.body.packs as Array<{ packKey: string }>).map((p) => p.packKey).sort();
    expect(keys).toEqual(["identity-hygiene-v1", "quickstart-v1"]);
  });
});

describe("POST /api/public/purchase/pack-execute", () => {
  it("fires the real orchestrator with purchase authorization for an allowlisted pack", async () => {
    const tenant = await createTenant(GRANTED_BOTH);
    const sessionId = await createSession({ tenantId: tenant.tenantId });
    const app = await buildApp();
    const res = await request(app).post("/api/public/purchase/pack-execute").send({ sessionId });

    expect(res.status).toBe(202);
    expect(res.body.results).toEqual([
      expect.objectContaining({ packKey: "quickstart-v1", runId: 424242, gated: true }),
    ]);
    expect(mockRunPack).toHaveBeenCalledTimes(1);
    expect(mockRunPack).toHaveBeenCalledWith(
      expect.objectContaining({
        packKey: "quickstart-v1",
        customerId: tenant.id,
        triggeredBy: `purchase:${sessionId}:pack:quickstart-v1`,
        purchaseAuthorization: { checkoutSessionId: sessionId },
      }),
    );
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: "purchase_flow_pack_execute_fired" }),
    );
  });

  it("refuses a pack outside the self-executable allowlist without touching the orchestrator", async () => {
    const tenant = await createTenant(GRANTED_BOTH);
    const sessionId = await createSession({
      productSlug: NON_ALLOWLISTED_PACK_SLUG,
      tenantId: tenant.tenantId,
    });
    const app = await buildApp();
    const res = await request(app).post("/api/public/purchase/pack-execute").send({ sessionId });

    expect(res.status).toBe(409);
    expect(res.body.results[0].refused.code).toBe("pack_not_self_executable");
    expect(mockRunPack).not.toHaveBeenCalled();
  });

  it("is idempotent per (session, pack): a live run is returned, never re-fired", async () => {
    const tenant = await createTenant(GRANTED_BOTH);
    const sessionId = await createSession({ tenantId: tenant.tenantId });

    const [def] = await db
      .insert(wfDefinitionsTable)
      .values({ name: `Test 1316 idempotency ${RUN_TAG}` })
      .returning({ id: wfDefinitionsTable.id });
    createdDefinitionIds.push(def.id);
    const graph: WfGraph = {
      nodes: [
        { id: "start", type: "start", position: { x: 0, y: 0 }, data: { nodeType: "start" } },
        {
          id: "tpl-x",
          type: "execute_baseline_template",
          position: { x: 0, y: 1 },
          data: { nodeType: "execute_baseline_template", templateId: "x", customerId: "{{customerId}}" },
        },
        {
          id: "gate-x",
          type: "break_glass_verification_gate",
          position: { x: 0, y: 2 },
          data: { nodeType: "break_glass_verification_gate" },
        },
        { id: "end", type: "end", position: { x: 0, y: 3 }, data: { nodeType: "end" } },
      ],
      edges: [],
    };
    const [version] = await db
      .insert(wfVersionsTable)
      .values({ definitionId: def.id, versionNumber: 1, status: "published", graph })
      .returning({ id: wfVersionsTable.id });
    createdVersionIds.push(version.id);
    const [run] = await db
      .insert(wfRunsTable)
      .values({
        versionId: version.id,
        definitionId: def.id,
        triggerType: "manual",
        triggerRef: `purchase:${sessionId}:pack:quickstart-v1`,
        status: "running",
      })
      .returning({ id: wfRunsTable.id });
    createdRunIds.push(run.id);

    const app = await buildApp();
    const res = await request(app).post("/api/public/purchase/pack-execute").send({ sessionId });
    expect(res.status).toBe(202);
    expect(res.body.results[0]).toMatchObject({ runId: run.id, alreadyStarted: true });
    expect(mockRunPack).not.toHaveBeenCalled();

    // And the status endpoint reads that same run with its real graph shape.
    const status = await request(app).get(`/api/public/purchase/pack-run-status?sessionId=${sessionId}`);
    expect(status.status).toBe(200);
    expect(status.body.packs[0]).toMatchObject({
      packKey: "quickstart-v1",
      runId: run.id,
      status: "running",
      gated: true,
      totalWrites: 1,
      completedWrites: 0,
    });
    expect(status.body.packs[0].steps).toEqual([
      expect.objectContaining({ nodeId: "tpl-x", status: "pending" }),
    ]);
  });
});
