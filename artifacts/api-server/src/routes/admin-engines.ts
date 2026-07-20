
import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { db, pool, usersTable, engagementProjectsTable, mspCustomersTable, mspsTable, mspUsersTable, savedSqlScripts, tenantEngineOverridesTable, insertTenantEngineOverrideSchema, monitorChecksTable, tenantEngineSnapshotsTable, impersonationTokensTable, signalDerivationRulesTable, signalRuleGroupsTable, policyRulesTable, policyRuleFiringsTable } from "@workspace/db";
import { splitSqlStatements } from "../lib/sql-statement-splitter";
import { createNotification } from "../lib/notification-center";
import { eq, desc, sql, and, inArray } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { executeMonitorCheck } from "../lib/monitor-executor";
import { logger } from "../lib/logger";
const log = logger.child({ channel: "engine.signals" });
const policyLog = logger.child({ channel: "engine.policy" });
const systemLog = logger.child({ channel: "system.core" });
import { SIMULATOR_MANIFEST, simulatorStorage } from "../lib/simulator-events";
import {
  ENGINE_DEFS,
  getEngineDef,
  buildEngineTestInputForTenant,
  runEngineManifestForTenant,
} from "../lib/engine-registry";
import { getEngineHistoryMerged, getBaselineEvents, getSignalDeltasForRange } from "../lib/engine-history";
import { PLAN_FEATURE_DEFS } from "../lib/msp-entitlement";
import {
  computeTenantSignals,
  evaluateRule,
  projectMatchesSignals,
  TENANT_SIGNALS,
  ADJUSTMENT_SIGNALS,
  type SignalDerivationRule,
  type SignalRuleGroup,
} from "../lib/tenant-signals";
import { getAllRules, getAllGroups, parseIntelligenceFields, saveSnapshot } from "./admin-signal-rules";
import { pushEngineTestLog, listEngineTestLogs } from "../lib/engine-test-log-buffer";
import { calculatePlatformPortfolioRisk, calculateMspPortfolioRisk } from "../lib/msp-engine";

const router: IRouter = Router();

async function runEngine(
  engineKey: string,
  body: Record<string, unknown>,
): Promise<{ mode: "tenant"; customerId: number; output: unknown }> {
  const def = getEngineDef(engineKey);
  if (!def) throw new Error(`Unknown engine: ${engineKey}`);

  const customerId = body.customerId != null ? Number(body.customerId) : undefined;
  if (customerId == null || isNaN(customerId)) {
    // Fake-payload testing (runForPayload) is retired platform-wide. Every
    // engine test/preview call must exercise the real runForTenant() path
    // against a real (testbed-flagged) customer — no parallel/simulated
    // evaluation is permitted, even for ad hoc admin testing.
    throw new Error(
      "A real customerId is required. Select a testbed customer — free-text sample payload testing has been retired.",
    );
  }
  const output = await def.runForTenant(customerId);
  return { mode: "tenant", customerId, output };
}

// ── GET /api/admin/portfolio-risk ──────────────────────────────────────────

router.get("/admin/portfolio-risk", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const output = await calculatePlatformPortfolioRisk();
    res.json(output);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ── GET /api/admin/msps/:mspId/portfolio-risk ──────────────────────────────

router.get("/admin/msps/:mspId/portfolio-risk", requireAdmin, async (req: Request, res: Response) => {
  try {
    const mspId = parseInt(String(req.params.mspId), 10);
    if (isNaN(mspId)) {
      res.status(400).json({ error: "Invalid mspId" });
      return;
    }
    const output = await calculateMspPortfolioRisk(mspId);
    res.json(output);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ── GET /api/admin/engines ──────────────────────────────────────────────────
// Lists all seven engine definitions for the nav / picker.

router.get("/admin/engines", requireAdmin, (_req: Request, res: Response) => {
  res.json({
    engines: ENGINE_DEFS.map(e => ({ key: e.key, label: e.label, description: e.description, categoryPrefix: e.categoryPrefix, tenantScoped: e.tenantScoped })),
  });
});

// ── GET /api/admin/plan-features ─────────────────────────────────────────────
// Returns the canonical plan-feature registry so the Admin Panel can build
// the Monitoring Tier "Included Features" multiselect from live server data.

router.get("/admin/plan-features", requireAdmin, (_req: Request, res: Response) => {
  res.json({ features: PLAN_FEATURE_DEFS });
});

// ── GET /api/admin/testbeds ──────────────────────────────────────────────────
// Returns all customers where is_testbed is true.

router.get("/admin/testbeds", requireAdmin, async (req: Request, res: Response) => {
  try {
    const mspIdStr = typeof req.query.mspId === "string" ? req.query.mspId : undefined;
    const conditions = [eq(mspCustomersTable.isTestbed, true)];
    if (mspIdStr) {
      const mspId = parseInt(mspIdStr, 10);
      if (isNaN(mspId)) {
        res.status(400).json({ error: "Invalid mspId" });
        return;
      }
      conditions.push(eq(mspCustomersTable.mspId, mspId));
    }

    const testbeds = await db
      .select({
        id: mspCustomersTable.id,
        mspId: mspCustomersTable.mspId,
        name: mspCustomersTable.name,
        domain: mspCustomersTable.domain,
        isTestbed: mspCustomersTable.isTestbed,
        testbedMetadata: mspCustomersTable.testbedMetadata,
      })
      .from(mspCustomersTable)
      .where(and(...conditions));
    res.json({ testbeds });
  } catch (err) {
    log.error({ err }, "admin-engines: failed to list testbeds");
    res.status(500).json({ error: "Failed to list testbeds" });
  }
});

// ── Testbed Override Injection ──────────────────────────────────────────────

router.post("/admin/simulator/overrides", requireAdmin, async (req: Request, res: Response) => {
  try {
    const parsed = insertTenantEngineOverrideSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error });
    }

    const { testbedCustomerId } = parsed.data;
    const [testbedCustomer] = await db
      .select()
      .from(mspCustomersTable)
      .where(and(eq(mspCustomersTable.id, Number(testbedCustomerId)), eq(mspCustomersTable.isTestbed, true)))
      .limit(1);

    if (!testbedCustomer) {
      return res.status(400).json({ error: "Customer not found or is not a testbed customer" });
    }

    const [created] = await db
      .insert(tenantEngineOverridesTable)
      .values(parsed.data)
      .returning();

    return res.json(created);
  } catch (err) {
    log.error({ err }, "admin-engines: failed to create simulator override");
    return res.status(500).json({ error: "Failed to create simulator override" });
  }
});

router.get("/admin/simulator/overrides", requireAdmin, async (req: Request, res: Response) => {
  try {
    const testbedCustomerIdStr = typeof req.query.testbedCustomerId === "string" ? req.query.testbedCustomerId : undefined;
    if (!testbedCustomerIdStr) {
      return res.status(400).json({ error: "Missing testbedCustomerId" });
    }
    const testbedCustomerId = Number(testbedCustomerIdStr);
    if (isNaN(testbedCustomerId)) {
      return res.status(400).json({ error: "Invalid testbedCustomerId" });
    }

    const rows = await db
      .select()
      .from(tenantEngineOverridesTable)
      .where(eq(tenantEngineOverridesTable.testbedCustomerId, testbedCustomerId))
      .orderBy(desc(tenantEngineOverridesTable.createdAt));

    const now = new Date();
    const overrides = rows.map(row => {
      const isActive = row.expiresAt === null || new Date(row.expiresAt) > now;
      return {
        ...row,
        isActive,
      };
    });

    return res.json({ overrides });
  } catch (err) {
    log.error({ err }, "admin-engines: failed to list simulator overrides");
    return res.status(500).json({ error: "Failed to list simulator overrides" });
  }
});

router.delete("/admin/simulator/overrides/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(String(req.params.id));
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid id" });
    }

    const result = await db
      .delete(tenantEngineOverridesTable)
      .where(eq(tenantEngineOverridesTable.id, id));

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Override not found" });
    }

    return res.json({ success: true });
  } catch (err) {
    log.error({ err }, "admin-engines: failed to delete simulator override");
    return res.status(500).json({ error: "Failed to delete simulator override" });
  }
});

router.post("/admin/simulator/monitor-checks/:key/run-now", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { testbedCustomerId } = req.body ?? {};
    if (!testbedCustomerId) {
      return res.status(400).json({ error: "Missing testbedCustomerId" });
    }
    const [customer] = await db
      .select({
        id: mspCustomersTable.id,
        isTestbed: mspCustomersTable.isTestbed,
        tenantId: mspCustomersTable.tenantId,
      })
      .from(mspCustomersTable)
      .where(and(eq(mspCustomersTable.id, Number(testbedCustomerId)), eq(mspCustomersTable.isTestbed, true)))
      .limit(1);

    if (!customer) {
      return res.status(400).json({ error: "Customer not found or is not a testbed customer" });
    }
    if (!customer.tenantId) {
      return res.status(400).json({ error: "Customer has no tenantId set" });
    }

    const key = String(req.params.key);
    const [check] = await db
      .select()
      .from(monitorChecksTable)
      .where(eq(monitorChecksTable.key, key))
      .limit(1);

    if (!check) {
      return res.status(404).json({ error: "Monitor check not found" });
    }

    const checkResult = await executeMonitorCheck({
      check,
      tenantId: customer.tenantId,
      triggerId: randomUUID(),
      skipIdempotency: true,
    });

    return res.json(checkResult);
  } catch (err) {
    log.error({ err }, "admin-engines: failed to run monitor check now");
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── POST /api/admin/simulator/run ────────────────────────────────────────────
// Run a parameterized simulation over a date range for a testbed customer.

router.post("/admin/simulator/run", requireAdmin, async (req: Request, res: Response) => {
  const { testbedCustomerId, engineKey, startDate, endDate, stepDays } = req.body ?? {};
  if (!testbedCustomerId) {
    return res.status(400).json({ error: "Missing testbedCustomerId" });
  }
  if (!engineKey) {
    return res.status(400).json({ error: "Missing engineKey" });
  }

  const def = getEngineDef(String(engineKey));
  if (!def) {
    return res.status(400).json({ error: `Unknown engine: ${engineKey}` });
  }

  const start = new Date(startDate);
  const end = new Date(endDate);
  const step = Number(stepDays);

  if (isNaN(start.getTime()) || isNaN(end.getTime()) || isNaN(step) || step <= 0) {
    return res.status(400).json({ error: "Invalid date or stepDays parameters" });
  }

  try {
    // 2. Ensure we do not touch production customers
    const [testbedCustomer] = await db
      .select()
      .from(mspCustomersTable)
      .where(and(eq(mspCustomersTable.id, Number(testbedCustomerId)), eq(mspCustomersTable.isTestbed, true)))
      .limit(1);

    if (!testbedCustomer) {
      return res.status(400).json({ error: "Customer not found or is not a testbed customer" });
    }

    const traces = [];
    const current = new Date(start);
    while (current <= end) {
      const timestamp = new Date(current);
      const output = await def.runForTenant(testbedCustomer.id, { evaluationTimestamp: timestamp });
      traces.push({
        timestamp: timestamp.toISOString(),
        output,
      });
      current.setDate(current.getDate() + step);
    }
    return res.json({ traces });
  } catch (err) {
    log.error({ err, engineKey }, "admin-engines: simulator run failed");
    return res.status(500).json({ error: err instanceof Error ? err.message : "Simulator run failed" });
  }
});

// ── POST /api/admin/simulator/replay-all ────────────────────────────────────
// Compressed-clock replay across ALL registered engines (or a provided
// subset) for a single testbed customer. Same real runForTenant() path as
// /admin/simulator/run above — this just fans it out across every engine at
// each step instead of one engine at a time, which is what the Simulator
// Studio's score-ring matrix and derivation trace stream need. Capped at
// MAX_REPLAY_STEPS to prevent an accidental multi-thousand-call request.
const MAX_REPLAY_STEPS = 200;

router.post("/admin/simulator/replay-all", requireAdmin, async (req: Request, res: Response) => {
  const { testbedCustomerId, startDate, endDate, stepDays, engineKeys } = req.body ?? {};
  if (!testbedCustomerId) {
    return res.status(400).json({ error: "Missing testbedCustomerId" });
  }
  const start = new Date(startDate);
  const end = new Date(endDate);
  const step = Number(stepDays);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || isNaN(step) || step <= 0) {
    return res.status(400).json({ error: "Invalid date or stepDays parameters" });
  }

  const stepCount = Math.floor((end.getTime() - start.getTime()) / (step * 24 * 60 * 60 * 1000)) + 1;
  if (stepCount > MAX_REPLAY_STEPS) {
    return res.status(400).json({
      error: `Requested range produces ${stepCount} steps, which exceeds the ${MAX_REPLAY_STEPS}-step cap. Widen stepDays or narrow the date range.`,
    });
  }

  const targetDefs = Array.isArray(engineKeys) && engineKeys.length > 0
    ? ENGINE_DEFS.filter(d => engineKeys.includes(d.key))
    : ENGINE_DEFS;
  if (targetDefs.length === 0) {
    return res.status(400).json({ error: "No matching engines found for the given engineKeys" });
  }

  try {
    const [testbedCustomer] = await db
      .select()
      .from(mspCustomersTable)
      .where(and(eq(mspCustomersTable.id, Number(testbedCustomerId)), eq(mspCustomersTable.isTestbed, true)))
      .limit(1);
    if (!testbedCustomer) {
      return res.status(400).json({ error: "Customer not found or is not a testbed customer" });
    }

    const steps: Array<{ timestamp: string; engines: Record<string, unknown> }> = [];
    const current = new Date(start);
    while (current <= end) {
      const timestamp = new Date(current);
      const engineResults: Record<string, unknown> = {};
      for (const def of targetDefs) {
        try {
          engineResults[def.key] = await def.runForTenant(testbedCustomer.id, { evaluationTimestamp: timestamp });
        } catch (err) {
          log.warn({ err, engineKey: def.key, timestamp }, "admin-engines: replay-all step failed for one engine — continuing with remaining engines");
          engineResults[def.key] = { error: err instanceof Error ? err.message : "Engine run failed" };
        }
      }
      steps.push({ timestamp: timestamp.toISOString(), engines: engineResults });
      current.setDate(current.getDate() + step);
    }

    return res.json({ steps, engineKeys: targetDefs.map(d => d.key) });
  } catch (err) {
    log.error({ err }, "admin-engines: replay-all failed");
    return res.status(500).json({ error: err instanceof Error ? err.message : "Replay failed" });
  }
});

// ── POST /api/simulator/orchestrated-pipeline/run ───────────────────────────
// Runs the full engine manifest (or an engineKeys subset) in dependency order
// against a testbed customer via runEngineManifestForTenant — the Run Engines
// panel's standalone "Orchestrated Pipeline" action. Per-engine failures are
// tolerated by the manifest runner (result null) and surfaced as ok: false.

router.post("/simulator/orchestrated-pipeline/run", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { testbedCustomerId, engineKeys } = req.body ?? {};
    if (!testbedCustomerId) {
      return res.status(400).json({ error: "Missing testbedCustomerId" });
    }
    if (engineKeys !== undefined && (!Array.isArray(engineKeys) || engineKeys.some(k => typeof k !== "string"))) {
      return res.status(400).json({ error: "engineKeys must be an array of engine key strings" });
    }
    if (Array.isArray(engineKeys) && engineKeys.length > 0) {
      const knownKeys = new Set(ENGINE_DEFS.map(d => d.key));
      const unknownKeys = engineKeys.filter((k: string) => !knownKeys.has(k));
      if (unknownKeys.length > 0) {
        return res.status(400).json({ error: `Unknown engine keys: ${unknownKeys.join(", ")}` });
      }
    }

    const [testbedCustomer] = await db
      .select({ id: mspCustomersTable.id })
      .from(mspCustomersTable)
      .where(and(eq(mspCustomersTable.id, Number(testbedCustomerId)), eq(mspCustomersTable.isTestbed, true)))
      .limit(1);
    if (!testbedCustomer) {
      return res.status(400).json({ error: "Customer not found or is not a testbed customer" });
    }

    const startTime = Date.now();
    const results = await runEngineManifestForTenant(
      testbedCustomer.id,
      { evaluationTimestamp: new Date() },
      Array.isArray(engineKeys) && engineKeys.length > 0 ? engineKeys : undefined,
    );
    const executionMs = Date.now() - startTime;

    const engines: Record<string, { ok: boolean }> = {};
    for (const [key, value] of Object.entries(results)) {
      engines[key] = { ok: value !== null };
    }
    return res.json({ engines, executionMs });
  } catch (err) {
    log.error({ err }, "admin-engines: orchestrated pipeline run failed");
    return res.status(500).json({ error: err instanceof Error ? err.message : "Orchestrated pipeline run failed" });
  }
});

// ── POST /api/admin/simulator/testbeds/:customerId/portal-mirror-token ──────
// Issues a single-use impersonation token for the real client-portal user
// mapped to this testbed customer, so Simulator Studio's Customer Portal
// Mirror panel can embed the actual customer-facing portal (not a mock).
// Reuses the same impersonation_tokens table and consumption flow as the
// existing admin "view as customer" feature (POST /admin/impersonate/:userId,
// consumed by POST /auth/impersonate-exchange) — no new auth mechanism.

router.post("/admin/simulator/testbeds/:customerId/portal-mirror-token", requireAdmin, async (req: Request, res: Response) => {
  const customerId = Number(req.params.customerId);
  if (isNaN(customerId)) {
    return res.status(400).json({ error: "Invalid customer id" });
  }
  try {
    const [customer] = await db
      .select()
      .from(mspCustomersTable)
      .where(and(eq(mspCustomersTable.id, customerId), eq(mspCustomersTable.isTestbed, true)))
      .limit(1);
    if (!customer) {
      return res.status(400).json({ error: "Customer not found or is not a testbed customer" });
    }

    const [portalUser] = await db
      .select({ userId: mspUsersTable.userId })
      .from(mspUsersTable)
      .where(and(eq(mspUsersTable.customerId, customerId), eq(mspUsersTable.isActive, true)))
      .limit(1);
    if (!portalUser) {
      return res.status(400).json({ error: "This testbed customer has no active portal user to mirror. Create one first, the same way you would for a real customer." });
    }

    const { randomBytes } = await import("node:crypto");
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    await db.insert(impersonationTokensTable).values({
      token,
      clientUserId: portalUser.userId,
      adminUserId: req.user!.id,
      expiresAt,
    });

    return res.json({ token });
  } catch (err) {
    log.error({ err, customerId }, "admin-engines: portal-mirror-token failed");
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to issue portal mirror token" });
  }
});

// ── GET /api/admin/simulator/testbeds/:customerId/portal-snapshot ───────────
// Read-only mirror of what the customer portal dashboard renders for this
// testbed customer: latest tenant_engine_snapshots row per engineKey (the same
// source GET /portal/dashboard reduces), plus whether an active portal user
// exists to impersonate. Powers Simulator Studio's Portal Snapshot panel — the
// reliable replacement for the retired live-iframe portal mirror.

router.get("/admin/simulator/testbeds/:customerId/portal-snapshot", requireAdmin, async (req: Request, res: Response) => {
  const customerId = Number(req.params.customerId);
  if (isNaN(customerId)) {
    return res.status(400).json({ error: "Invalid customer id" });
  }
  try {
    const [customer] = await db
      .select({ id: mspCustomersTable.id, name: mspCustomersTable.name, domain: mspCustomersTable.domain, mspId: mspCustomersTable.mspId })
      .from(mspCustomersTable)
      .where(and(eq(mspCustomersTable.id, customerId), eq(mspCustomersTable.isTestbed, true)))
      .limit(1);
    if (!customer) {
      return res.status(400).json({ error: "Customer not found or is not a testbed customer" });
    }

    const [portalUser] = await db
      .select({ userId: mspUsersTable.userId })
      .from(mspUsersTable)
      .where(and(eq(mspUsersTable.customerId, customerId), eq(mspUsersTable.isActive, true)))
      .limit(1);

    // Owning MSP scopes the policy-firings query; it lives on the customer row.
    const mspId = customer.mspId ?? null;

    const snapshots = await db
      .select({
        engineKey: tenantEngineSnapshotsTable.engineKey,
        score: tenantEngineSnapshotsTable.score,
        breakdown: tenantEngineSnapshotsTable.breakdown,
        capturedAt: tenantEngineSnapshotsTable.capturedAt,
      })
      .from(tenantEngineSnapshotsTable)
      .where(eq(tenantEngineSnapshotsTable.customerId, customerId))
      .orderBy(desc(tenantEngineSnapshotsTable.capturedAt));

    // Latest snapshot per engine (rows already ordered captured-desc).
    const latestByEngine: Array<{ engineKey: string; score: number | null; capturedAt: string | null; breakdown: Record<string, unknown>[] }> = [];
    const seen = new Set<string>();
    for (const snap of snapshots) {
      if (seen.has(snap.engineKey)) continue;
      seen.add(snap.engineKey);
      latestByEngine.push({
        engineKey: snap.engineKey,
        score: snap.score,
        capturedAt: snap.capturedAt ? snap.capturedAt.toISOString() : null,
        breakdown: Array.isArray(snap.breakdown) ? snap.breakdown : [],
      });
    }

    // ── Label resolution ──────────────────────────────────────────────────
    // Breakdown entries carrying source/sourceId (drift, forecasting) resolve
    // against signal_derivation_rules.description ("rule") or
    // signal_rule_groups.label ("group"). Priority entries have no source —
    // best-effort label them by signalKey against the same two tables.
    const ruleIds = new Set<number>();
    const groupIds = new Set<number>();
    const signalKeys = new Set<string>();
    for (const eng of latestByEngine) {
      for (const item of eng.breakdown) {
        if (typeof item !== "object" || item === null) continue;
        const b = item as Record<string, unknown>;
        const sourceId = typeof b.sourceId === "number" ? b.sourceId : null;
        if (b.source === "rule" && sourceId != null) ruleIds.add(sourceId);
        else if (b.source === "group" && sourceId != null) groupIds.add(sourceId);
        if (typeof b.signalKey === "string" && b.signalKey) signalKeys.add(b.signalKey);
      }
    }

    const ruleDescById = new Map<number, string>();
    const groupLabelById = new Map<number, string>();
    const labelBySignalKey = new Map<string, string>();
    try {
      const ruleIdList = [...ruleIds];
      const groupIdList = [...groupIds];
      const signalKeyList = [...signalKeys];
      const [ruleRows, groupRows] = await Promise.all([
        ruleIdList.length > 0 || signalKeyList.length > 0
          ? db
              .select({ id: signalDerivationRulesTable.id, signalKey: signalDerivationRulesTable.signalKey, description: signalDerivationRulesTable.description })
              .from(signalDerivationRulesTable)
              .where(
                sql`${ruleIdList.length > 0 ? inArray(signalDerivationRulesTable.id, ruleIdList) : sql`false`} OR ${signalKeyList.length > 0 ? inArray(signalDerivationRulesTable.signalKey, signalKeyList) : sql`false`}`,
              )
          : Promise.resolve([] as { id: number; signalKey: string; description: string | null }[]),
        groupIdList.length > 0 || signalKeyList.length > 0
          ? db
              .select({ id: signalRuleGroupsTable.id, signalKey: signalRuleGroupsTable.signalKey, label: signalRuleGroupsTable.label })
              .from(signalRuleGroupsTable)
              .where(
                sql`${groupIdList.length > 0 ? inArray(signalRuleGroupsTable.id, groupIdList) : sql`false`} OR ${signalKeyList.length > 0 ? inArray(signalRuleGroupsTable.signalKey, signalKeyList) : sql`false`}`,
              )
          : Promise.resolve([] as { id: number; signalKey: string; label: string | null }[]),
      ]);
      for (const r of ruleRows) {
        if (r.description) ruleDescById.set(r.id, r.description);
        if (r.description && !labelBySignalKey.has(r.signalKey)) labelBySignalKey.set(r.signalKey, r.description);
      }
      for (const g of groupRows) {
        if (g.label) groupLabelById.set(g.id, g.label);
        if (g.label && !labelBySignalKey.has(g.signalKey)) labelBySignalKey.set(g.signalKey, g.label);
      }
      log.debug(
        { customerId, ruleIds: ruleIds.size, groupIds: groupIds.size, signalKeys: signalKeys.size, resolvedLabels: labelBySignalKey.size },
        "portal-snapshot: resolved breakdown labels",
      );
    } catch (labelErr) {
      log.warn({ err: labelErr, customerId }, "portal-snapshot: label resolution failed — returning breakdowns without labels");
    }

    const resolveEntryLabel = (b: Record<string, unknown>): string | null => {
      const sourceId = typeof b.sourceId === "number" ? b.sourceId : null;
      if (b.source === "rule" && sourceId != null && ruleDescById.has(sourceId)) return ruleDescById.get(sourceId)!;
      if (b.source === "group" && sourceId != null && groupLabelById.has(sourceId)) return groupLabelById.get(sourceId)!;
      if (typeof b.signalKey === "string" && labelBySignalKey.has(b.signalKey)) return labelBySignalKey.get(b.signalKey)!;
      return null;
    };

    // Assemble each engine: keep the legacy `findings` strings for the
    // non-expanded panel view, plus the raw breakdown with per-entry labels
    // for the explain dialog.
    const engines = latestByEngine.map(eng => {
      const findings: string[] = [];
      const breakdown = eng.breakdown.map(item => {
        if (typeof item !== "object" || item === null) return item;
        const b = item as Record<string, unknown>;
        if (b.finding) findings.push(String(b.finding));
        else if (b.message) findings.push(String(b.message));
        else if (b.label) findings.push(String(b.label));
        const label = resolveEntryLabel(b);
        return label != null ? { ...b, label: b.label ?? label } : item;
      });
      return {
        engineKey: eng.engineKey,
        score: eng.score,
        capturedAt: eng.capturedAt,
        findings: findings.slice(0, 3),
        breakdown,
      };
    });

    // ── Policy activity ───────────────────────────────────────────────────
    // score_threshold policy rules that have fired for this customer, most
    // recent first (cap 5 total), keyed by the engine they threshold on.
    const engineKeysPresent = engines.map(e => e.engineKey);
    let policyActivity: Array<{ engineKey: string | null; ruleName: string; severity: string; category: string; firedAt: string | null }> = [];
    if (mspId != null && engineKeysPresent.length > 0) {
      try {
        const firings = await db
          .select({
            ruleName: policyRulesTable.name,
            severity: policyRulesTable.severity,
            engineKey: policyRulesTable.engineKey,
            firedAt: policyRuleFiringsTable.firedAt,
          })
          .from(policyRuleFiringsTable)
          .innerJoin(policyRulesTable, eq(policyRuleFiringsTable.ruleId, policyRulesTable.id))
          .where(
            and(
              eq(policyRuleFiringsTable.customerId, customerId),
              eq(policyRulesTable.conditionType, "score_threshold"),
              inArray(policyRulesTable.engineKey, engineKeysPresent),
            ),
          )
          .orderBy(desc(policyRuleFiringsTable.firedAt))
          .limit(5);
        policyActivity = firings.map(f => ({
          engineKey: f.engineKey,
          ruleName: f.ruleName,
          severity: f.severity,
          // For score_threshold rules the category is the engine they threshold on.
          category: f.engineKey ?? "uncategorized",
          firedAt: f.firedAt ? f.firedAt.toISOString() : null,
        }));
        policyLog.debug({ customerId, mspId, count: policyActivity.length }, "portal-snapshot: loaded score_threshold policy firings");
      } catch (policyErr) {
        policyLog.warn({ err: policyErr, customerId, mspId }, "portal-snapshot: policy activity query failed");
      }
    }

    const scored = engines.filter(e => e.score !== null);
    const compositeScore = scored.length > 0
      ? Math.round(scored.reduce((s, e) => s + (e.score as number), 0) / scored.length)
      : null;

    return res.json({
      customer,
      hasPortalUser: !!portalUser,
      compositeScore,
      engines,
      policyActivity,
      capturedAt: engines[0]?.capturedAt ?? null,
    });
  } catch (err) {
    log.error({ err, customerId }, "admin-engines: portal-snapshot failed");
    return res.status(500).json({ error: "Failed to load portal snapshot" });
  }
});

// ── POST /api/admin/engines/:key/test ───────────────────────────────────────
// Test against a real tenant ({ tenantId }) or a sample payload
// ({ payload: { profileUpdates, parsedFindings } }). Every run is logged to
// the in-memory ring buffer so the Testing tab can show recent runs.

router.post("/admin/engines/:key/test", requireAdmin, async (req: Request, res: Response) => {
  const { key } = req.params;
  const debug = Boolean((req.body as Record<string, unknown> | undefined)?.debug);
  try {
    const { mode, customerId, output } = await runEngine(String(key), (req.body ?? {}) as Record<string, unknown>);
    pushEngineTestLog({ id: randomUUID(), engineKey: String(key), createdAt: new Date().toISOString(), mode, customerId, debug, output });
    res.json({ mode, customerId, output });
  } catch (err) {
    log.error({ err, engineKey: key }, "admin-engines: test run failed");
    const message = err instanceof Error ? err.message : "Engine test failed";
    pushEngineTestLog({ id: randomUUID(), engineKey: String(key), createdAt: new Date().toISOString(), mode: "payload", debug, output: null, error: message });
    res.status(400).json({ error: message });
  }
});

// ── POST /api/admin/engines/:key/preview ────────────────────────────────────
// Same inputs as /test, but additionally previews workflow output vars and
// SOW/MSP downstream impact for the fired signal set.

router.post("/admin/engines/:key/preview", requireAdmin, async (req: Request, res: Response) => {
  const { key } = req.params;
  try {
    const { mode, customerId, output } = await runEngine(String(key), (req.body ?? {}) as Record<string, unknown>);

    const rawSignals = Array.isArray((output as { rawSignals?: unknown })?.rawSignals)
      ? (output as { rawSignals: string[] }).rawSignals
      : [];

    const workflowOutputPreview = Object.fromEntries(
      rawSignals.map(s => [`steps.${key}.firedSignals.${s}`, true]),
    );

    const [rules, groups] = await Promise.all([getAllRules(), getAllGroups()]);
    const sowImpactPreview = rawSignals
      .map(signalKey => {
        const contributors = [...groups, ...rules].filter(c => c.signalKey === signalKey);
        if (contributors.length === 0) return null;
        return {
          signalKey,
          pricingImpact: Math.max(0, ...contributors.map(c => c.pricingImpact ?? 0)),
          pricingValueContribution: Math.max(0, ...contributors.map(c => c.pricingValueContribution ?? 0)),
        };
      })
      .filter((v): v is { signalKey: string; pricingImpact: number; pricingValueContribution: number } => v !== null);

    const mspImpactPreview =
      key === "health" || key === "drift" || key === "priority"
        ? { note: `This engine's score feeds into the MSP portfolio roll-up's combinedScore for this tenant.` }
        : null;

    res.json({ mode, customerId, output, workflowOutputPreview, sowImpactPreview, mspImpactPreview });
  } catch (err) {
    log.error({ err, engineKey: key }, "admin-engines: preview failed");
    res.status(400).json({ error: err instanceof Error ? err.message : "Engine preview failed" });
  }
});

// ── GET /api/admin/engines/:key/logs ────────────────────────────────────────

router.get("/admin/engines/:key/logs", requireAdmin, (req: Request, res: Response) => {
  res.json({ logs: listEngineTestLogs(String(req.params.key)) });
});

// ── GET /api/admin/engines/:key/dashboard ───────────────────────────────────
// Current score/summary. For tenant-scoped engines, runs across the most
// recently active clients and returns per-client scores plus a portfolio
// average. MSP is portfolio-wide already, so it runs once.

router.get("/admin/engines/:key/dashboard", requireAdmin, async (req: Request, res: Response) => {
  const { key } = req.params;
  const def = getEngineDef(String(key));
  if (!def) {
    res.status(404).json({ error: "Unknown engine" });
    return;
  }
  try {
    if (!def.tenantScoped) {
      const output = await def.runForTenant(0);
      res.json({ portfolio: true, output });
      return;
    }

    const clients = await db
      .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, company: usersTable.company })
      .from(usersTable)
      .where(eq(usersTable.role, "client"))
      .orderBy(desc(usersTable.createdAt))
      .limit(20);

    const results = await Promise.all(
      clients.map(async c => {
        try {
          const output = await def.runForTenant(c.id);
          return { client: c, output, error: null as string | null };
        } catch (err) {
          return { client: c, output: null, error: err instanceof Error ? err.message : "Failed" };
        }
      }),
    );

    res.json({ portfolio: false, results });
  } catch (err) {
    log.error({ err, engineKey: key }, "admin-engines: dashboard failed");
    res.status(500).json({ error: "Failed to load engine dashboard" });
  }
});

// ── Route 1: GET /api/admin/engines/:key/history ────────────────────────────
router.get("/admin/engines/:key/history", requireAdmin, async (req: Request, res: Response) => {
  const { key } = req.params;
  const def = getEngineDef(String(key));
  if (!def) {
    res.status(404).json({ error: "Unknown engine" });
    return;
  }
  const customerId = Number(req.query.customerId);
  if (!customerId || Number.isNaN(customerId)) {
    res.status(400).json({ error: "customerId query param is required" });
    return;
  }
  const start = req.query.start ? new Date(String(req.query.start)) : undefined;
  const end = req.query.end ? new Date(String(req.query.end)) : undefined;
  try {
    const [series, baselineEvents, signalDeltas] = await Promise.all([
      getEngineHistoryMerged(customerId, String(key), start, end),
      getBaselineEvents(customerId, String(key)),
      getSignalDeltasForRange(customerId, String(key), start, end),
    ]);
    res.json({ engineKey: key, customerId, series, baselineEvents, signalDeltas });
  } catch (err) {
    log.error({ err, engineKey: key, customerId }, "admin-engines: history failed");
    res.status(500).json({ error: "Failed to load engine history" });
  }
});

// ── Route 2: GET /api/admin/engines/:key/history-customers ──────────────────
// Lists only customers who actually have snapshot rows for this engine, so the
// picker dropdown isn't full of empty customers. Keyed on the REAL customerId
// (mspCustomersTable.id) — do NOT reuse the dashboard route's `usersTable`
// client list for this, they are different id spaces.
router.get("/admin/engines/:key/history-customers", requireAdmin, async (req: Request, res: Response) => {
  const { key } = req.params;
  try {
    const rows = await db
      .selectDistinct({ id: mspCustomersTable.id, name: mspCustomersTable.name, mspId: mspCustomersTable.mspId })
      .from(tenantEngineSnapshotsTable)
      .innerJoin(mspCustomersTable, eq(tenantEngineSnapshotsTable.customerId, mspCustomersTable.id))
      .where(eq(tenantEngineSnapshotsTable.engineKey, String(key)))
      .orderBy(mspCustomersTable.name)
      .limit(200);
    res.json({ customers: rows });
  } catch (err) {
    log.error({ err, engineKey: key }, "admin-engines: history-customers failed");
    res.status(500).json({ error: "Failed to load customer list" });
  }
});

// ── GET /api/admin/engines/:key/configuration ───────────────────────────────
// Rule groups + rules scoped to this engine's category prefix, for the
// Configuration tab (reuses the same rows the Tenant Signals page edits).

router.get("/admin/engines/:key/configuration", requireAdmin, async (req: Request, res: Response) => {
  const { key } = req.params;
  const def = getEngineDef(String(key));
  if (!def) {
    res.status(404).json({ error: "Unknown engine" });
    return;
  }
  try {
    const [rules, groups] = await Promise.all([getAllRules(), getAllGroups()]);
    const prefix = `${def.categoryPrefix}:`;
    res.json({
      rules: rules.filter(r => (r.category ?? "").startsWith(prefix)),
      groups: groups.filter(g => (g.category ?? "").startsWith(prefix)),
    });
  } catch (err) {
    log.error({ err, engineKey: key }, "admin-engines: configuration fetch failed");
    res.status(500).json({ error: "Failed to load engine configuration" });
  }
});

// ── GET /api/admin/engines/:key/export ──────────────────────────────────────
// Exports this engine's category-scoped rules + groups as a standalone JSON
// document, downloadable from the Configuration tab and re-importable via
// POST .../import below (round-trips exactly, including DB ids for reference).

router.get("/admin/engines/:key/export", requireAdmin, async (req: Request, res: Response) => {
  const { key } = req.params;
  const def = getEngineDef(String(key));
  if (!def) {
    res.status(404).json({ error: "Unknown engine" });
    return;
  }
  try {
    const [rules, groups] = await Promise.all([getAllRules(), getAllGroups()]);
    const prefix = `${def.categoryPrefix}:`;
    const scopedGroups = groups.filter(g => (g.category ?? "").startsWith(prefix));
    const scopedRules = rules.filter(r => (r.category ?? "").startsWith(prefix));
    res.json({
      engine: def.key,
      engineLabel: def.label,
      categoryPrefix: def.categoryPrefix,
      exportedAt: new Date().toISOString(),
      groups: scopedGroups,
      rules: scopedRules,
    });
  } catch (err) {
    log.error({ err, engineKey: key }, "admin-engines: export failed");
    res.status(500).json({ error: "Failed to export engine rules" });
  }
});

// ── GET /api/admin/engines/:key/import-template ─────────────────────────────
// A downloadable, minimal-but-complete example document for this engine —
// one sample group with one sample rule, using this engine's categoryPrefix
// and its most relevant intelligence field pre-filled to a non-zero example
// value, so an admin can see exactly which fields matter for this engine.

const ENGINE_EXAMPLE_FIELD: Record<string, string> = {
  priority: "priorityScoreContribution",
  pricing: "pricingImpact",
  health: "governanceImpact",
  drift: "trendValue",
  forecasting: "trendValue",
  crm: "crmFitContribution",
  msp: "priorityScoreContribution",
};

router.get("/admin/engines/:key/import-template", requireAdmin, (req: Request, res: Response) => {
  const { key } = req.params;
  const def = getEngineDef(String(key));
  if (!def) {
    res.status(404).json({ error: "Unknown engine" });
    return;
  }
  const prefix = `${def.categoryPrefix}:`;
  const exampleField = ENGINE_EXAMPLE_FIELD[def.key] ?? "priorityScoreContribution";
  res.json({
    engine: def.key,
    engineLabel: def.label,
    categoryPrefix: def.categoryPrefix,
    note:
      `Template for the ${def.label}. 'category' on every rule/group MUST start with "${prefix}" ` +
      `or it will not be picked up by this engine. Delete this example group/rule and add your own, ` +
      `or edit the example in place. Importing this file (unmodified) via the Import JSON button will ` +
      `replace ALL of this engine's current rules/groups with just this one example.`,
    groups: [
      {
        signalKey: `${def.categoryPrefix}:example-signal`,
        logic: "OR",
        label: "Example Group — replace me",
        sortOrder: 0,
        category: `${prefix}example`,
        [exampleField]: 10,
      },
    ],
    rules: [
      {
        signalKey: `${def.categoryPrefix}:example-signal`,
        groupSignalKey: `${def.categoryPrefix}:example-signal`,
        ruleType: "profile_key_truthy",
        sourceKey: "exampleProfileField",
        compareValue: null,
        description: "Example rule — replace with a real profile_key_* or findings_keyword rule.",
        sortOrder: 0,
        category: `${prefix}example`,
        [exampleField]: 10,
      },
    ],
  });
});

// ── POST /api/admin/engines/:key/import ─────────────────────────────────────
// Replaces ALL of this engine's category-scoped rules + groups with the
// imported document. Scoped strictly to rows whose `category` starts with
// this engine's categoryPrefix — other engines' rules/groups (and any
// ungrouped/legacy signals with no category) are left untouched.
//
// Rules reference their group via `groupSignalKey` (or legacy numeric
// `groupId`/`group_id`, remapped like the global bundle importer) since
// group DB ids are not stable across export/import round-trips.

router.post("/admin/engines/:key/import", requireAdmin, async (req: Request, res: Response) => {
  const { key } = req.params;
  const def = getEngineDef(String(key));
  if (!def) {
    res.status(404).json({ error: "Unknown engine" });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const importedGroups = body.groups;
  const importedRules = body.rules;
  if (!Array.isArray(importedRules)) {
    res.status(400).json({ error: "Body must contain a 'rules' array" });
    return;
  }
  const prefix = `${def.categoryPrefix}:`;

  // Validate every row is actually scoped to this engine before touching the DB.
  const badGroup = (importedGroups as Array<Record<string, unknown>> | undefined)?.find(
    g => !String(g.category ?? "").startsWith(prefix),
  );
  if (badGroup) {
    res.status(400).json({ error: `Every group's "category" must start with "${prefix}" for the ${def.label} — got "${badGroup.category}"` });
    return;
  }
  const badRule = (importedRules as Array<Record<string, unknown>>).find(
    r => !String(r.category ?? "").startsWith(prefix),
  );
  if (badRule) {
    res.status(400).json({ error: `Every rule's "category" must start with "${prefix}" for the ${def.label} — got "${badRule.category}"` });
    return;
  }

  try {
    const adminId = (req as unknown as { user?: { id: number } }).user?.id ?? null;
    // Full-ruleset backup before mutating, so a bad import is always recoverable
    // via the existing Rule Versions restore flow.
    const snapshotId = await saveSnapshot(`Pre-import backup (${def.label})`, adminId);

    let ruleCount = 0;
    let groupCount = 0;

    await db.transaction(async (tx) => {
      // Delete only this engine's category-scoped rows.
      await tx.execute(sql`DELETE FROM signal_derivation_rules WHERE category LIKE ${prefix + "%"}`);
      await tx.execute(sql`DELETE FROM signal_rule_groups WHERE category LIKE ${prefix + "%"}`);

      // signalKey -> new group DB id, keyed by the group's own signalKey since
      // that's the only stable cross-reference an exported group carries.
      const groupIdBySignalKey = new Map<string, number>();

      if (Array.isArray(importedGroups)) {
        for (const g of importedGroups as Array<Record<string, unknown>>) {
          const { values: gIntel } = parseIntelligenceFields(g);
          const signalKey = String(g.signalKey ?? g.signal_key ?? "");
          if (!signalKey) continue;
          const result = await tx.execute(sql`
            INSERT INTO signal_rule_groups (
              signal_key, logic, label, sort_order,
              priority, weight, pricing_impact, priority_score_contribution, pricing_value_contribution,
              governance_impact, security_impact, compliance_impact, adoption_impact, copilot_impact,
              architecture_impact, trend_value, trend_direction, decay_rate, ttl_days, confidence,
              severity, category, pillar, crm_fit_contribution, crm_pain_contribution,
              crm_maturity_contribution, crm_intent_contribution, crm_urgency_contribution
            )
            VALUES (
              ${signalKey}, ${(g.logic ?? "OR") as string},
              ${g.label ?? null}, ${(g.sortOrder ?? g.sort_order ?? 0) as number},
              ${gIntel.priority}, ${gIntel.weight}, ${gIntel.pricingImpact}, ${gIntel.priorityScoreContribution}, ${gIntel.pricingValueContribution},
              ${gIntel.governanceImpact}, ${gIntel.securityImpact}, ${gIntel.complianceImpact}, ${gIntel.adoptionImpact}, ${gIntel.copilotImpact},
              ${gIntel.architectureImpact}, ${gIntel.trendValue}, ${gIntel.trendDirection}, ${gIntel.decayRate}, ${gIntel.ttlDays}, ${gIntel.confidence},
              ${gIntel.severity}, ${(g.category as string) ?? prefix}, ${gIntel.pillar}, ${gIntel.crmFitContribution}, ${gIntel.crmPainContribution},
              ${gIntel.crmMaturityContribution}, ${gIntel.crmIntentContribution}, ${gIntel.crmUrgencyContribution}
            )
            RETURNING id
          `);
          const newId = (result.rows[0] as { id: number }).id;
          groupIdBySignalKey.set(signalKey, newId);
          groupCount++;
        }
      }

      for (const r of importedRules as Array<Record<string, unknown>>) {
        const groupRef = String(r.groupSignalKey ?? r.group_signal_key ?? "");
        const mappedGroupId = groupRef ? (groupIdBySignalKey.get(groupRef) ?? null) : null;
        const { values: rIntel } = parseIntelligenceFields(r);
        await tx.execute(sql`
          INSERT INTO signal_derivation_rules (
            signal_key, group_id, rule_type, source_key, compare_value, description, sort_order,
            priority, weight, pricing_impact, priority_score_contribution, pricing_value_contribution,
            governance_impact, security_impact, compliance_impact, adoption_impact, copilot_impact,
            architecture_impact, trend_value, trend_direction, decay_rate, ttl_days, confidence,
            severity, category, pillar, crm_fit_contribution, crm_pain_contribution,
            crm_maturity_contribution, crm_intent_contribution, crm_urgency_contribution
          )
          VALUES (
            ${(r.signalKey ?? r.signal_key) as string}, ${mappedGroupId},
            ${(r.ruleType ?? r.rule_type) as string}, ${(r.sourceKey ?? r.source_key) as string},
            ${(r.compareValue ?? r.compare_value ?? null) as string | null},
            ${(r.description ?? null) as string | null}, ${(r.sortOrder ?? r.sort_order ?? 0) as number},
            ${rIntel.priority}, ${rIntel.weight}, ${rIntel.pricingImpact}, ${rIntel.priorityScoreContribution}, ${rIntel.pricingValueContribution},
            ${rIntel.governanceImpact}, ${rIntel.securityImpact}, ${rIntel.complianceImpact}, ${rIntel.adoptionImpact}, ${rIntel.copilotImpact},
            ${rIntel.architectureImpact}, ${rIntel.trendValue}, ${rIntel.trendDirection}, ${rIntel.decayRate}, ${rIntel.ttlDays}, ${rIntel.confidence},
            ${rIntel.severity}, ${(r.category as string) ?? prefix}, ${rIntel.pillar}, ${rIntel.crmFitContribution}, ${rIntel.crmPainContribution},
            ${rIntel.crmMaturityContribution}, ${rIntel.crmIntentContribution}, ${rIntel.crmUrgencyContribution}
          )
        `);
        ruleCount++;
      }

      await tx.execute(sql`
        INSERT INTO signal_rule_audit_log (action, signal_key, rule_id, before, after, admin_user_id, note)
        VALUES ('import', null, null, null, null, ${adminId},
                ${`Engine import (${def.label}): replaced with ${ruleCount} rule(s) across ${groupCount} group(s). Pre-import snapshot saved as ID ${snapshotId}.`})
      `);
    });

    log.info({ engineKey: key, ruleCount, groupCount, snapshotId }, "admin-engines: engine-scoped import complete");
    res.json({ engine: def.key, imported: ruleCount, groupsImported: groupCount, snapshotId });
  } catch (err) {
    log.error({ err, engineKey: key }, "admin-engines: engine-scoped import failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Import failed" });
  }
});

// ── Reusable rule-group testing/preview/activation-logs ─────────────────────
// Shared infrastructure — any engine's UI can point at these since rule
// groups belong to a signal key, not to a particular engine.

router.post("/admin/engines/rule-groups/:groupId/test", requireAdmin, async (req: Request, res: Response) => {
  const groupId = Number(req.params.groupId);
  try {
    const [rules, groups] = await Promise.all([getAllRules(), getAllGroups()]);
    const group = groups.find(g => g.id === groupId);
    if (!group) { res.status(404).json({ error: "Rule group not found" }); return; }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const customerId = body.customerId != null ? Number(body.customerId) : undefined;
    if (customerId == null || isNaN(customerId)) {
      // Fake-payload testing is retired platform-wide — real tenantId only.
      res.status(400).json({ error: "A real customerId is required. Select a testbed customer." });
      return;
    }
    const input = await buildEngineTestInputForTenant(customerId);

    const groupRules = rules.filter(r => r.groupId === groupId);
    const traces = groupRules.map(r => ({ ruleId: r.id, ...evaluateRule(r, input.mergedProfile, input.parsedFindings) }));
    const groupResult = group.logic === "AND" ? traces.every(t => t.result) : traces.some(t => t.result);

    res.json({ groupId, logic: group.logic, result: groupResult, ruleTraces: traces });
  } catch (err) {
    log.error({ err, groupId }, "admin-engines: rule-group test failed");
    res.status(400).json({ error: err instanceof Error ? err.message : "Rule group test failed" });
  }
});

router.get("/admin/engines/rule-groups/:groupId/preview", requireAdmin, async (req: Request, res: Response) => {
  const groupId = Number(req.params.groupId);
  try {
    const groups = await getAllGroups();
    const group = groups.find(g => g.id === groupId);
    if (!group) { res.status(404).json({ error: "Rule group not found" }); return; }

    const projects = await db.select().from(engagementProjectsTable);
    const knownSignalKeys = new Set([...TENANT_SIGNALS, ...ADJUSTMENT_SIGNALS].map(s => s.key));
    const affectedProjects = projects
      .map(p => ({ id: p.id, title: p.title, match: projectMatchesSignals({ title: p.title, triggeredBy: p.triggeredBy as string[] }, knownSignalKeys, new Set([group.signalKey])) }))
      .filter(p => p.match.included)
      .map(p => ({ id: p.id, title: p.title }));

    res.json({ groupId, signalKey: group.signalKey, affectedProjects });
  } catch (err) {
    log.error({ err, groupId }, "admin-engines: rule-group preview failed");
    res.status(500).json({ error: "Failed to preview rule group" });
  }
});

router.get("/admin/engines/rule-groups/:groupId/activation-logs", requireAdmin, async (req: Request, res: Response) => {
  const groupId = Number(req.params.groupId);
  try {
    const groups = await getAllGroups();
    const group = groups.find(g => g.id === groupId);
    if (!group) { res.status(404).json({ error: "Rule group not found" }); return; }
    const rows = await db.execute(sql`
      SELECT id, action, signal_key AS "signalKey", rule_id AS "ruleId", note, created_at AS "createdAt"
      FROM signal_rule_audit_log
      WHERE signal_key = ${group.signalKey}
      ORDER BY created_at DESC
      LIMIT 50
    `);
    res.json({ logs: rows.rows });
  } catch (err) {
    log.error({ err, groupId }, "admin-engines: rule-group activation logs failed");
    res.status(500).json({ error: "Failed to load activation logs" });
  }
});

// ── Reusable per-signal testing/preview/contribution/logs ───────────────────

router.post("/admin/engines/signals/:signalKey/test", requireAdmin, async (req: Request, res: Response) => {
  const signalKey = String(req.params.signalKey);
  try {
    const customerId = (req.body as Record<string, unknown>)?.customerId != null ? Number((req.body as Record<string, unknown>).customerId) : undefined;
    if (customerId == null || isNaN(customerId)) {
      // Fake-payload testing is retired platform-wide — real tenantId only.
      res.status(400).json({ error: "A real customerId is required. Select a testbed customer." });
      return;
    }
    const input = await buildEngineTestInputForTenant(customerId);

    const scopedRules = input.rules.filter(r => r.signalKey === signalKey);
    const scopedGroups = input.groups.filter(g => g.signalKey === signalKey);
    const { firedSignals, trace } = computeTenantSignals(input.mergedProfile, input.parsedFindings, scopedRules, scopedGroups, input.disabledSignalKeys);
    res.json({ signalKey, fired: firedSignals.has(signalKey), trace });
  } catch (err) {
    log.error({ err, signalKey }, "admin-engines: signal test failed");
    res.status(400).json({ error: err instanceof Error ? err.message : "Signal test failed" });
  }
});

router.get("/admin/engines/signals/:signalKey/preview", requireAdmin, async (req: Request, res: Response) => {
  const signalKey = String(req.params.signalKey);
  try {
    const projects = await db.select().from(engagementProjectsTable);
    const knownSignalKeys = new Set([...TENANT_SIGNALS, ...ADJUSTMENT_SIGNALS].map(s => s.key));
    const affectedProjects = projects
      .map(p => ({ id: p.id, title: p.title, match: projectMatchesSignals({ title: p.title, triggeredBy: p.triggeredBy as string[] }, knownSignalKeys, new Set([signalKey])) }))
      .filter(p => p.match.included)
      .map(p => ({ id: p.id, title: p.title }));
    res.json({ signalKey, affectedProjects });
  } catch (err) {
    log.error({ err, signalKey }, "admin-engines: signal preview failed");
    res.status(500).json({ error: "Failed to preview signal" });
  }
});

router.get("/admin/engines/signals/:signalKey/contribution-preview", requireAdmin, async (req: Request, res: Response) => {
  const signalKey = String(req.params.signalKey);
  try {
    const [rules, groups] = await Promise.all([getAllRules(), getAllGroups()]);
    const contributors: Array<SignalDerivationRule | SignalRuleGroup> = [
      ...groups.filter(g => g.signalKey === signalKey),
      ...rules.filter(r => r.signalKey === signalKey),
    ];
    if (contributors.length === 0) { res.json({ signalKey, contribution: null }); return; }
    const max = (field: string) => Math.max(0, ...contributors.map(c => Number((c as unknown as Record<string, unknown>)[field] ?? 0)));
    res.json({
      signalKey,
      contribution: {
        priorityScoreContribution: max("priorityScoreContribution"),
        pricingImpact: max("pricingImpact"),
        pricingValueContribution: max("pricingValueContribution"),
        governanceImpact: max("governanceImpact"),
        securityImpact: max("securityImpact"),
        complianceImpact: max("complianceImpact"),
        adoptionImpact: max("adoptionImpact"),
        copilotImpact: max("copilotImpact"),
        architectureImpact: max("architectureImpact"),
        trendValue: max("trendValue"),
        crmFitContribution: max("crmFitContribution"),
        crmPainContribution: max("crmPainContribution"),
        crmMaturityContribution: max("crmMaturityContribution"),
        crmIntentContribution: max("crmIntentContribution"),
        crmUrgencyContribution: max("crmUrgencyContribution"),
      },
    });
  } catch (err) {
    log.error({ err, signalKey }, "admin-engines: contribution preview failed");
    res.status(500).json({ error: "Failed to compute contribution preview" });
  }
});

router.get("/admin/engines/signals/:signalKey/logs", requireAdmin, async (req: Request, res: Response) => {
  const signalKey = String(req.params.signalKey);
  try {
    const rows = await db.execute(sql`
      SELECT id, action, signal_key AS "signalKey", rule_id AS "ruleId", note, created_at AS "createdAt"
      FROM signal_rule_audit_log
      WHERE signal_key = ${signalKey}
      ORDER BY created_at DESC
      LIMIT 50
    `);
    res.json({ logs: rows.rows });
  } catch (err) {
    log.error({ err, signalKey }, "admin-engines: signal logs failed");
    res.status(500).json({ error: "Failed to load signal logs" });
  }
});

// ---------------------------------------------------------------------------
// SIMULATOR STUDIO API ROUTES
// ---------------------------------------------------------------------------

/**
 * @route GET /api/admin/engines/simulator/manifest
 * @desc Returns the centralized list of quick-fire events and presets
 */
router.get("/simulator/manifest", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const events = SIMULATOR_MANIFEST.map(({ id, name, icon, category, description, demoSpeakerNote }) => ({
      id,
      name,
      icon,
      category,
      description,
      demoSpeakerNote
    }));
    return res.json({ events });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * @route POST /api/admin/engines/simulator/fire-event
 * @desc Safely triggers a manifest event on an is_testbed MSP/tenant
 */
router.post("/simulator/fire-event", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { eventId, testbedCustomerId, params } = req.body;

    if (!eventId || !testbedCustomerId) {
      return res.status(400).json({ error: "eventId and testbedCustomerId are required." });
    }

    const [customer] = await db
      .select({ id: mspCustomersTable.id, mspId: mspCustomersTable.mspId })
      .from(mspCustomersTable)
      .where(and(eq(mspCustomersTable.id, Number(testbedCustomerId)), eq(mspCustomersTable.isTestbed, true)))
      .limit(1);

    if (!customer) {
      return res.status(400).json({ error: "Testbed customer not found or is not flagged is_testbed." });
    }

    const eventDef = SIMULATOR_MANIFEST.find(e => e.id === eventId);
    if (!eventDef) {
      return res.status(404).json({ error: `Event '${eventId}' not found in simulator manifest.` });
    }

    const startTime = Date.now();
    const context = { isTestbed: true, testbedMspId: customer.mspId, testbedCustomerId: customer.id };
    const result = await simulatorStorage.run(context, async () => {
      return await eventDef.execute(customer.id, params);
    });
    const executionMs = Date.now() - startTime;

    // Push a real-time update to anyone connected to this testbed MSP's
    // portal — reuses the existing notification-center SSE pipeline
    // (same one the NotificationBell in app-shell.tsx already listens to).
    // Non-fatal: the scenario itself already ran regardless of this.
    try {
      const watchingUsers = await db
        .select({ id: mspUsersTable.id })
        .from(mspUsersTable)
        .where(and(eq(mspUsersTable.mspId, customer.mspId), eq(mspUsersTable.isActive, true)));

      for (const mu of watchingUsers) {
        await createNotification({
          title: eventDef.name,
          body: result.message,
          category: "simulator",
          severity: result.success ? "info" : "warning",
          feedType: "personal",
          notifType: "general",
          recipient: { type: "msp_user", mspUserId: mu.id, mspId: customer.mspId },
          mspId: customer.mspId,
        });
      }
    } catch (notifyErr) {
      log.error({ notifyErr }, "admin-engines: simulator fire-event notification broadcast failed");
    }
    return res.json({
      ...result,
      executionMs,
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    log.error({ err }, "Simulator event failed");
    return res.status(500).json({ error: err.message || "Failed to fire event" });
  }
});

// artifacts/api-server/src/routes/admin-engines.ts

/**
 * @route GET /api/admin/engines/simulator/db-schema
 * @desc Inspects live PostgreSQL catalog metadata for user tables, columns, PKs, and FKs.
 * @access PlatformAdmin Only
 */
router.get("/simulator/db-schema", requireAdmin, async (_req: Request, res: Response) => {
  try {
    // 1. Fetch all user tables and columns
    const columnsQuery = `
      SELECT 
        table_name,
        column_name,
        data_type,
        is_nullable,
        column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position;
    `;

    // 2. Fetch all foreign key relationships
    const fkQuery = `
      SELECT
        tc.table_name AS table_name,
        kcu.column_name AS column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public';
    `;

    // 3. Fetch primary keys
    const pkQuery = `
      SELECT 
        tc.table_name,
        kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_schema = 'public';
    `;

    const [colsRes, fkRes, pkRes] = await Promise.all([
      db.execute(sql.raw(columnsQuery)),
      db.execute(sql.raw(fkQuery)),
      db.execute(sql.raw(pkQuery)),
    ]);

    const fkMap = new Map<string, { foreignTable: string; foreignColumn: string }>();
    (fkRes.rows || []).forEach((row: any) => {
      fkMap.set(`${row.table_name}.${row.column_name}`, {
        foreignTable: row.foreign_table_name,
        foreignColumn: row.foreign_column_name,
      });
    });

    const pkSet = new Set<string>();
    (pkRes.rows || []).forEach((row: any) => {
      pkSet.add(`${row.table_name}.${row.column_name}`);
    });

    // Group columns by table
    const tablesMap: Record<string, any[]> = {};
    (colsRes.rows || []).forEach((col: any) => {
      if (!tablesMap[col.table_name]) {
        tablesMap[col.table_name] = [];
      }
      const key = `${col.table_name}.${col.column_name}`;
      const fkInfo = fkMap.get(key);

      tablesMap[col.table_name].push({
        name: col.column_name,
        dataType: col.data_type,
        isNullable: col.is_nullable === "YES",
        isPk: pkSet.has(key),
        foreignKey: fkInfo ? `FK -> ${fkInfo.foreignTable}(${fkInfo.foreignColumn})` : null,
      });
    });

    const tables = Object.keys(tablesMap).sort().map((tableName) => ({
      name: tableName,
      columns: tablesMap[tableName],
    }));

    return res.json({ tables });
  } catch (err: any) {
    log.error({ err }, "DB schema inspector failed");
    return res.status(500).json({ error: err.message || "Failed to fetch DB schema" });
  }
});

// Per-statement result — one entry per statement in the submitted script,
// SSMS-style: each statement shows its own rows/rowCount (SELECT) or a plain
// success (DDL/DML), and a failure on one statement is reported inline without
// stopping the ones after it.
interface StatementResult {
  statementIndex: number;
  statementText: string; // truncated preview, not the full text if huge
  success: boolean;
  rows: any[];
  rowCount: number;
  fields: string[];
  executionMs: number;
  error?: string;
}

const STATEMENT_PREVIEW_MAX = 500;

function previewStatement(text: string): string {
  const collapsed = text.trim();
  return collapsed.length > STATEMENT_PREVIEW_MAX ? `${collapsed.slice(0, STATEMENT_PREVIEW_MAX)}…` : collapsed;
}

// Shared by /simulator/sql/execute and /simulator/migrations/execute — splits
// the raw SQL text into individual statements and runs each in its own
// round-trip, in order, so every statement reports its own result instead of
// only the last one's (the old single-`db.execute(sql.raw(...))` behavior).
//
// The whole batch runs on a SINGLE pooled connection: a `BEGIN; ...; COMMIT;`
// script therefore shares one real transaction across its statements, and a
// best-effort ROLLBACK in the finally guarantees a half-open/aborted
// transaction is never handed back to the pool (a no-op warning on an
// autocommit or already-committed connection).
async function executeRawSql(query: string): Promise<{ statements: StatementResult[] }> {
  const statementTexts = splitSqlStatements(query);
  const statements: StatementResult[] = [];

  const client = await pool.connect();
  try {
    for (let statementIndex = 0; statementIndex < statementTexts.length; statementIndex++) {
      const statementText = statementTexts[statementIndex];
      const startTime = Date.now();
      try {
        const result = await client.query(statementText);
        statements.push({
          statementIndex,
          statementText: previewStatement(statementText),
          success: true,
          rows: result.rows || [],
          rowCount: result.rowCount ?? (result.rows ? result.rows.length : 0),
          fields: result.fields?.map((f: any) => f.name) ?? (result.rows && result.rows.length > 0 ? Object.keys(result.rows[0]) : []),
          executionMs: Date.now() - startTime,
        });
      } catch (err: any) {
        // Per-statement catch: record the failure and keep going so the rest of
        // the batch still runs and reports its own outcome.
        statements.push({
          statementIndex,
          statementText: previewStatement(statementText),
          success: false,
          rows: [],
          rowCount: 0,
          fields: [],
          executionMs: Date.now() - startTime,
          error: err?.message || String(err),
        });
      }
    }
  } finally {
    try {
      await client.query("ROLLBACK");
    } catch {
      // No transaction in progress — expected for autocommit / already-committed scripts.
    }
    client.release();
  }

  return { statements };
}

/**
 * @route POST /api/admin/engines/simulator/sql/execute
 * @desc Executes SQL queries/CRUD scripts with performance timing & safety checks
 */
router.post("/simulator/sql/execute", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { query } = req.body;

    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "A valid SQL query string is required." });
    }

    return res.json(await executeRawSql(query));
  } catch (err: any) {
    log.error({ err, query: req.body?.query }, "SQL console execute failed");
    return res.status(500).json({ error: err.message || "Failed to execute query" });
  }
});

// lib/db/migrations/manual/ — real .sql files committed to the repo, read
// straight off the server filesystem (not a database table).
const MANUAL_MIGRATIONS_DIR = path.resolve(process.cwd(), "../../lib/db/migrations/manual");

async function listManualMigrationFiles(): Promise<string[]> {
  const entries = await fs.readdir(MANUAL_MIGRATIONS_DIR, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".sql"))
    .map((e) => e.name)
    .sort();
}

/**
 * @route GET /api/simulator/migrations/files
 * @desc Lists every .sql file in lib/db/migrations/manual/, sorted alphabetically
 *       (filenames are dated YYYY-MM-DD-description.sql, so alphabetical order
 *       is chronological/dependency order).
 */
router.get("/simulator/migrations/files", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const files = await listManualMigrationFiles();
    return res.json({ files });
  } catch (err: any) {
    systemLog.error({ err }, "Simulator migrations: failed to list manual migration files");
    return res.status(500).json({ error: err.message || "Failed to list migration files" });
  }
});

/**
 * @route POST /api/simulator/migrations/execute
 * @desc Reads one manual migration file's full contents off disk and runs it
 *       through the same execution path as the SQL console.
 */
router.post("/simulator/migrations/execute", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { filename } = req.body;
    if (!filename || typeof filename !== "string") {
      return res.status(400).json({ error: "A valid migration filename is required." });
    }

    // Exact allowlist check against the real directory listing — not just
    // string sanitization — so a path-traversal filename can never reach fs.readFile.
    const realFiles = await listManualMigrationFiles();
    if (!realFiles.includes(filename)) {
      return res.status(400).json({ error: "Not a recognized manual migration file." });
    }

    const filePath = path.join(MANUAL_MIGRATIONS_DIR, filename);
    const query = await fs.readFile(filePath, "utf8");

    return res.json(await executeRawSql(query));
  } catch (err: any) {
    systemLog.error({ err, filename: req.body?.filename }, "Simulator migrations: execute failed");
    return res.status(500).json({ error: err.message || "Failed to execute migration file" });
  }
});

/**
 * @route GET /api/simulator/sql/scripts
 * @desc Gets all saved, categorized SQL utility scripts
 */
router.get("/simulator/sql/scripts", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const scripts = await db.select().from(savedSqlScripts);
    return res.json({ scripts });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * @route POST /api/simulator/sql/scripts
 * @desc Saves a new SQL script to the library under a category
 */
router.post("/simulator/sql/scripts", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { name, category, query, isDestructive, isResetScript } = req.body;

    if (!name || !category || !query) {
      return res.status(400).json({ error: "name, category, and query are required." });
    }

    const [inserted] = await db.insert(savedSqlScripts).values({
      name,
      category,
      query,
      isDestructive: Boolean(isDestructive),
      isResetScript: Boolean(isResetScript)
    }).returning();

    return res.json({ script: inserted });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * @route PUT /api/simulator/sql/scripts/:id
 * @desc Updates an existing saved SQL utility script
 */
router.put("/simulator/sql/scripts/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: "A valid script id is required." });
    }

    const { name, category, query, isDestructive, isResetScript } = req.body;

    if (!name || !category || !query) {
      return res.status(400).json({ error: "name, category, and query are required." });
    }

    const [updated] = await db.update(savedSqlScripts).set({
      name,
      category,
      query,
      isDestructive: Boolean(isDestructive),
      isResetScript: Boolean(isResetScript)
    }).where(eq(savedSqlScripts.id, id)).returning();

    if (!updated) {
      return res.status(404).json({ error: "Script not found." });
    }

    return res.json({ script: updated });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * @route DELETE /api/simulator/sql/scripts/:id
 * @desc Deletes a saved SQL utility script
 */
router.delete("/simulator/sql/scripts/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: "A valid script id is required." });
    }

    const [deleted] = await db.delete(savedSqlScripts).where(eq(savedSqlScripts.id, id)).returning();
    if (!deleted) {
      return res.status(404).json({ error: "Script not found." });
    }

    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * @route POST /api/admin/engines/simulator/session-lock
 * @desc Locks/unlocks a testbed MSP so CRON background tasks bypass it during live demos
 */
router.post("/simulator/session-lock", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { testbedMspId, lock } = req.body;

    if (!testbedMspId) {
      return res.status(400).json({ error: "testbedMspId is required." });
    }

    const lockSessionId = lock ? `demo-session-${Date.now()}` : null;

    await db.update(mspsTable)
      .set({ testbedMetadata: sql`jsonb_set(COALESCE(${mspsTable.testbedMetadata}, '{}'::jsonb), '{sim_lock_session_id}', ${JSON.stringify(lockSessionId)}::jsonb)` })
      .where(eq(mspsTable.id, Number(testbedMspId)));

    return res.json({ 
      success: true, 
      locked: Boolean(lock), 
      lockSessionId 
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
