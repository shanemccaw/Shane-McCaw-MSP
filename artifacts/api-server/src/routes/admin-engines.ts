
import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { db, pool, usersTable, engagementProjectsTable, tenantsTable, mspsTable, savedSqlScripts, tenantEngineOverridesTable, insertTenantEngineOverrideSchema, monitorChecksTable, salesOfferRuleGroupsTable, tenantEngineSnapshotsTable, impersonationTokensTable, signalDerivationRulesTable, signalRuleGroupsTable, policyRulesTable, policyRuleFiringsTable, psCapabilitySurveyRunsTable, psCapabilitySurveyResultsTable, type PS_CAPABILITY_SURVEY_SESSION_TYPES, type PS_CAPABILITY_SURVEY_STATUSES } from "@workspace/db";
import { splitSqlStatements } from "../lib/sql-statement-splitter";
import { recordFailedSqlRun, recordSqlRun } from "../lib/run-history";
import { createNotification } from "../lib/notification-center";
import { eq, desc, sql, and, inArray } from "drizzle-orm";
import { requireAdmin, requireAdminOrIngestToken } from "../middlewares/requireAuth";
import { executeMonitorCheck } from "../lib/monitor-executor";
import { callPsExecution, PsExecutionError } from "../lib/ps-execution-client";
import { logger } from "../lib/logger";
const log = logger.child({ channel: "engine.signals" });
const policyLog = logger.child({ channel: "engine.policy" });
const systemLog = logger.child({ channel: "system.core" });
const psLog = logger.child({ channel: "integration.ps-execution" });
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
  getAllSignalDefinitions,
  resolveCustomerPortalUserId,
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
// Lists every engine definition for the nav / picker.
//
// `configMode` is the same three-way split GET .../configuration branches on
// (see the "Engine Configuration data sources" note further down), returned
// up-front so a client can group the list into "rules drive these" vs
// "configured elsewhere" without re-deriving server knowledge — the adminv2
// Engines screen's explorer tree and mode pill both read it, and hardcoding
// the set client-side is exactly how it would drift out of step with the
// switch below.

router.get("/admin/engines", requireAdmin, (_req: Request, res: Response) => {
  res.json({
    engines: ENGINE_DEFS.map(e => ({
      key: e.key,
      label: e.label,
      description: e.description,
      categoryPrefix: e.categoryPrefix,
      tenantScoped: e.tenantScoped,
      dependsOn: e.dependsOn,
      configMode: engineConfigMode(e.key),
      backingTable: ENGINE_BACKING_TABLE[e.key] ?? null,
    })),
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
    const conditions = [eq(tenantsTable.isTestbed, true)];
    if (mspIdStr) {
      const mspId = parseInt(mspIdStr, 10);
      if (isNaN(mspId)) {
        res.status(400).json({ error: "Invalid mspId" });
        return;
      }
      conditions.push(eq(tenantsTable.mspId, mspId));
    }

    const testbeds = await db
      .select({
        id: tenantsTable.id,
        mspId: tenantsTable.mspId,
        name: tenantsTable.customerName,
        domain: tenantsTable.domain,
        isTestbed: tenantsTable.isTestbed,
        // `testbedMetadata` is not carried forward: msp_customers had a
        // per-customer testbed_metadata jsonb, tenants has no analogue, and
        // nothing on the admin-panel side ever read this field (the
        // testbedMetadata the Simulator actually uses is msps.testbed_metadata,
        // which is untouched).
      })
      .from(tenantsTable)
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
      .from(tenantsTable)
      .where(and(eq(tenantsTable.id, Number(testbedCustomerId)), eq(tenantsTable.isTestbed, true)))
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
        id: tenantsTable.id,
        isTestbed: tenantsTable.isTestbed,
        tenantId: tenantsTable.tenantId,
      })
      .from(tenantsTable)
      .where(and(eq(tenantsTable.id, Number(testbedCustomerId)), eq(tenantsTable.isTestbed, true)))
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
      .from(tenantsTable)
      .where(and(eq(tenantsTable.id, Number(testbedCustomerId)), eq(tenantsTable.isTestbed, true)))
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
      .from(tenantsTable)
      .where(and(eq(tenantsTable.id, Number(testbedCustomerId)), eq(tenantsTable.isTestbed, true)))
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
      .select({ id: tenantsTable.id })
      .from(tenantsTable)
      .where(and(eq(tenantsTable.id, Number(testbedCustomerId)), eq(tenantsTable.isTestbed, true)))
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
      .from(tenantsTable)
      .where(and(eq(tenantsTable.id, customerId), eq(tenantsTable.isTestbed, true)))
      .limit(1);
    if (!customer) {
      return res.status(400).json({ error: "Customer not found or is not a testbed customer" });
    }

    // Deterministic canonical active user (shared role-ranked/earliest-created
    // rule) — never an arbitrary unordered pick among multiple active users.
    const mirrorUserId = await resolveCustomerPortalUserId(customerId);
    if (mirrorUserId == null) {
      return res.status(400).json({ error: "This testbed customer has no active portal user to mirror. Create one first, the same way you would for a real customer." });
    }

    const { randomBytes } = await import("node:crypto");
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    await db.insert(impersonationTokensTable).values({
      token,
      clientUserId: mirrorUserId,
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
      .select({ id: tenantsTable.id, name: tenantsTable.customerName, domain: tenantsTable.domain, mspId: tenantsTable.mspId })
      .from(tenantsTable)
      .where(and(eq(tenantsTable.id, customerId), eq(tenantsTable.isTestbed, true)))
      .limit(1);
    if (!customer) {
      return res.status(400).json({ error: "Customer not found or is not a testbed customer" });
    }

    const [portalUser] = await db
      .select({ userId: usersTable.id })
      .from(usersTable)
      .where(and(eq(usersTable.tenantId, customerId), eq(usersTable.isActive, true)))
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
    const [series, baselineEvents, signalDeltas, latestRows] = await Promise.all([
      getEngineHistoryMerged(customerId, String(key), start, end),
      getBaselineEvents(customerId, String(key)),
      getSignalDeltasForRange(customerId, String(key), start, end),
      // The most recent snapshot in full, including the per-signal `breakdown`
      // writeEngineSnapshot stored. `getEngineHistoryMerged` deliberately does
      // not carry it — that helper also backs the customer-facing
      // portal-engine-history route, and the breakdown is internal scoring
      // detail. Selected here, admin-only, so the Engines screen can show how
      // the current score was reached without re-running the engine (which
      // would write another snapshot and move the number it is explaining).
      db
        .select()
        .from(tenantEngineSnapshotsTable)
        .where(and(eq(tenantEngineSnapshotsTable.customerId, customerId), eq(tenantEngineSnapshotsTable.engineKey, String(key))))
        .orderBy(desc(tenantEngineSnapshotsTable.capturedAt))
        .limit(1),
    ]);
    res.json({ engineKey: key, customerId, series, baselineEvents, signalDeltas, latest: latestRows[0] ?? null });
  } catch (err) {
    log.error({ err, engineKey: key, customerId }, "admin-engines: history failed");
    res.status(500).json({ error: "Failed to load engine history" });
  }
});

// ── Route 2: GET /api/admin/engines/:key/history-customers ──────────────────
// Lists only customers who actually have snapshot rows for this engine, so the
// picker dropdown isn't full of empty customers. Keyed on the REAL customerId
// (tenantsTable.id) — do NOT reuse the dashboard route's `usersTable`
// client list for this, they are different id spaces.
router.get("/admin/engines/:key/history-customers", requireAdmin, async (req: Request, res: Response) => {
  const { key } = req.params;
  try {
    const rows = await db
      .selectDistinct({ id: tenantsTable.id, name: tenantsTable.customerName, mspId: tenantsTable.mspId })
      .from(tenantEngineSnapshotsTable)
      .innerJoin(tenantsTable, eq(tenantEngineSnapshotsTable.customerId, tenantsTable.id))
      .where(eq(tenantEngineSnapshotsTable.engineKey, String(key)))
      .orderBy(tenantsTable.customerName)
      .limit(200);
    res.json({ customers: rows });
  } catch (err) {
    log.error({ err, engineKey: key }, "admin-engines: history-customers failed");
    res.status(500).json({ error: "Failed to load customer list" });
  }
});

// ── Engine Configuration data sources ────────────────────────────────────────
// The Configuration tab must show the REAL configuration each engine actually
// consumes. There are three kinds of engine:
//
//  1. Signal-derived (priority, pricing, health, security, drift, forecasting,
//     crm): configured by signal_derivation_rules / signal_rule_groups. The
//     right rows are the ones whose contribution field(s) THIS engine actually
//     SUMS are non-zero — NOT a `{engine}:` category-prefix match. The real
//     signal catalog is categorised by domain (identity/security/sharepoint/…),
//     so the old category-prefix filter only ever matched leftover `example:*`
//     placeholder rows and never the ~120 real signals, even though those
//     signals carry real non-zero values in the scoring fields. drift and crm
//     ADDITIONALLY gate on a `drift:` / `crm:` category prefix, because their
//     own compute functions do (drift-engine.ts, crm-engine.ts).
//
//  2. Non-signal-derived (sla, scope_creep, monitoring, sales_offer): do not
//     read signal_derivation_rules at all — their config lives in dedicated
//     tables (sla_policies, scope_creep_policies, monitor_checks,
//     sales_offer_rule_groups), so the Configuration tab queries those.
//
//  3. Aggregator (msp): has no configuration of its own — it aggregates the
//     health/drift/priority scores. The Configuration tab shows an explainer.

interface ConfigColumn { key: string; label: string; type?: "text" | "number" | "bool" | "array" | "date"; }

/**
 * The dedicated table each non-signal-derived engine actually reads. Kept
 * beside the loaders below so the two can never disagree; `null`/absent means
 * the engine is signal-derived or (msp) has no configuration at all.
 */
const ENGINE_BACKING_TABLE: Record<string, string> = {
  sla: "sla_policies",
  scope_creep: "scope_creep_policies",
  monitoring: "monitor_checks",
  sales_offer: "sales_offer_rule_groups",
};

/**
 * Which of the three kinds of engine this is — the same split the
 * configuration route switches on, exposed on the engine list so a client
 * doesn't have to keep its own copy of the set.
 */
export function engineConfigMode(engineKey: string): "signal-rules" | "backing-table" | "aggregator" {
  if (engineKey === "msp") return "aggregator";
  return ENGINE_BACKING_TABLE[engineKey] ? "backing-table" : "signal-rules";
}

/** True if this rule/group row is real configuration the given signal-derived engine sums. */
function rowContributesToEngine(engineKey: string, row: Record<string, unknown>): boolean {
  const nz = (f: string) => Number(row[f] ?? 0) !== 0;
  const category = String(row.category ?? "");
  switch (engineKey) {
    case "priority":
      return nz("priorityScoreContribution");
    case "pricing":
      return nz("pricingImpact") || nz("pricingValueContribution");
    case "health":
      // health-engine sums the six pillar impacts; only these five are exposed
      // on signal rows via getAllRules()/the editor (licensingImpact is summed
      // by the engine but is not selected/editable through this data source, so
      // it can never be non-zero here). securityImpact belongs to the Security
      // engine and is deliberately excluded from health.
      return nz("governanceImpact") || nz("complianceImpact") || nz("adoptionImpact") || nz("copilotImpact") || nz("architectureImpact");
    case "security":
      return nz("securityImpact");
    case "drift":
      // drift-engine gates rows on a `drift:` category AND sums trendValue + governanceImpact.
      return category.startsWith("drift:") && (nz("trendValue") || nz("governanceImpact"));
    case "forecasting":
      // forecasting-engine has NO category gate — any non-zero trendValue contributes (scaled by decayRate).
      return nz("trendValue");
    case "crm":
      // crm-engine gates rows on a `crm:` category AND sums the five crm contribution fields.
      return category.startsWith("crm:") && (nz("crmFitContribution") || nz("crmPainContribution") || nz("crmMaturityContribution") || nz("crmIntentContribution") || nz("crmUrgencyContribution"));
    default:
      return false;
  }
}

async function loadSlaEngineConfig() {
  const rows = await db.execute(sql`
    SELECT id, name, priority,
           response_time_minutes AS "responseTimeMinutes",
           resolution_time_minutes AS "resolutionTimeMinutes",
           warning_threshold_pct AS "warningThresholdPct",
           is_active AS "isActive", msp_id AS "mspId",
           updated_at AS "updatedAt"
    FROM sla_policies
    ORDER BY msp_id NULLS FIRST, priority, id DESC
  `);
  const items = (rows.rows as Record<string, unknown>[]).map(r => ({ ...r, scope: r.mspId == null ? "Global" : `MSP #${r.mspId}` }));
  return {
    mode: "backing-table" as const,
    engine: "sla",
    backingTable: "sla_policies",
    title: "SLA Policies",
    description: "The SLA Engine tracks response/resolution timers against these policies. Rows with no MSP are platform-global defaults; MSP-scoped rows override them. Edit these under SLA administration, not here.",
    columns: [
      { key: "name", label: "Name" },
      { key: "priority", label: "Priority" },
      { key: "responseTimeMinutes", label: "Response (min)", type: "number" },
      { key: "resolutionTimeMinutes", label: "Resolution (min)", type: "number" },
      { key: "warningThresholdPct", label: "Warn %", type: "number" },
      { key: "isActive", label: "Active", type: "bool" },
      { key: "scope", label: "Scope" },
      { key: "updatedAt", label: "Updated", type: "date" },
    ] as ConfigColumn[],
    items,
    count: items.length,
    rules: [], groups: [],
  };
}

async function loadScopeCreepEngineConfig() {
  const rows = await db.execute(sql`
    SELECT id, name,
           violation_score_threshold AS "violationScoreThreshold",
           drift_threshold_pct AS "driftThresholdPct",
           expansion_threshold_pct AS "expansionThresholdPct",
           timeline_slip_days AS "timelineSlipDays",
           is_active AS "isActive", msp_id AS "mspId",
           updated_at AS "updatedAt"
    FROM scope_creep_policies
    ORDER BY msp_id NULLS FIRST, id DESC
  `);
  const items = (rows.rows as Record<string, unknown>[]).map(r => ({ ...r, scope: r.mspId == null ? "Global" : `MSP #${r.mspId}` }));
  return {
    mode: "backing-table" as const,
    engine: "scope_creep",
    backingTable: "scope_creep_policies",
    title: "Scope Creep Policies",
    description: "The Scope Creep Engine scores deliverable/requirement/timeline drift and SOW expansion against these policies. Rows with no MSP are platform-global defaults. Edit these under Scope Creep administration, not here.",
    columns: [
      { key: "name", label: "Name" },
      { key: "violationScoreThreshold", label: "Violation threshold", type: "number" },
      { key: "driftThresholdPct", label: "Drift %", type: "number" },
      { key: "expansionThresholdPct", label: "Expansion %", type: "number" },
      { key: "timelineSlipDays", label: "Timeline slip (days)", type: "number" },
      { key: "isActive", label: "Active", type: "bool" },
      { key: "scope", label: "Scope" },
      { key: "updatedAt", label: "Updated", type: "date" },
    ] as ConfigColumn[],
    items,
    count: items.length,
    rules: [], groups: [],
  };
}

async function loadMonitoringEngineConfig() {
  const rows = await db
    .select({
      key: monitorChecksTable.key,
      label: monitorChecksTable.label,
      frequency: monitorChecksTable.frequency,
      status: monitorChecksTable.status,
      engines: monitorChecksTable.engines,
      requiresCustomerScript: monitorChecksTable.requiresCustomerScript,
      schemaVersion: monitorChecksTable.schemaVersion,
      updatedAt: monitorChecksTable.updatedAt,
    })
    .from(monitorChecksTable)
    .orderBy(monitorChecksTable.status, monitorChecksTable.key);
  return {
    mode: "backing-table" as const,
    engine: "monitoring",
    backingTable: "monitor_checks",
    title: "Monitor Checks",
    description: "The Monitoring Engine executes these platform-authored Monitor Checks against customer tenants via Graph API. Checks are global (no per-MSP scope); only `active` checks run. Edit these under Monitor Checks administration, not here.",
    columns: [
      { key: "key", label: "Key" },
      { key: "label", label: "Label" },
      { key: "frequency", label: "Frequency" },
      { key: "status", label: "Status" },
      { key: "engines", label: "Feeds engines", type: "array" },
      { key: "requiresCustomerScript", label: "Needs script", type: "bool" },
      { key: "schemaVersion", label: "Schema v", type: "number" },
      { key: "updatedAt", label: "Updated", type: "date" },
    ] as ConfigColumn[],
    items: rows,
    count: rows.length,
    rules: [], groups: [],
  };
}

async function loadSalesOfferEngineConfig() {
  const rows = await db
    .select({
      key: salesOfferRuleGroupsTable.key,
      label: salesOfferRuleGroupsTable.label,
      ruleType: salesOfferRuleGroupsTable.ruleType,
      logic: salesOfferRuleGroupsTable.logic,
      requiredSignalKeys: salesOfferRuleGroupsTable.requiredSignalKeys,
      scoreContribution: salesOfferRuleGroupsTable.scoreContribution,
      pricingAdjustmentPct: salesOfferRuleGroupsTable.pricingAdjustmentPct,
      isActive: salesOfferRuleGroupsTable.isActive,
      sortOrder: salesOfferRuleGroupsTable.sortOrder,
    })
    .from(salesOfferRuleGroupsTable)
    .orderBy(salesOfferRuleGroupsTable.sortOrder, salesOfferRuleGroupsTable.key);
  return {
    mode: "backing-table" as const,
    engine: "sales_offer",
    backingTable: "sales_offer_rule_groups",
    title: "Sales Offer Rule Groups",
    description: "The Sales Offer Engine converts fired signals into priced, scored candidate offers using these rule groups. Groups are global (no per-MSP scope); only `active` groups fire. Per-MSP tuning lives separately in sales_offer_config. Edit these under Sales Offer administration, not here.",
    columns: [
      { key: "key", label: "Key" },
      { key: "label", label: "Label" },
      { key: "ruleType", label: "Type" },
      { key: "logic", label: "Logic" },
      { key: "requiredSignalKeys", label: "Required signals", type: "array" },
      { key: "scoreContribution", label: "Score", type: "number" },
      { key: "pricingAdjustmentPct", label: "Pricing adj %", type: "number" },
      { key: "isActive", label: "Active", type: "bool" },
      { key: "sortOrder", label: "Order", type: "number" },
    ] as ConfigColumn[],
    items: rows,
    count: rows.length,
    rules: [], groups: [],
  };
}

// ── GET /api/admin/engines/:key/configuration ───────────────────────────────
// Real configuration for the Configuration tab. See the "Engine Configuration
// data sources" note above for how the three kinds of engine are handled.

router.get("/admin/engines/:key/configuration", requireAdmin, async (req: Request, res: Response) => {
  const { key } = req.params;
  const def = getEngineDef(String(key));
  if (!def) {
    res.status(404).json({ error: "Unknown engine" });
    return;
  }
  try {
    switch (def.key) {
      case "sla": res.json(await loadSlaEngineConfig()); return;
      case "scope_creep": res.json(await loadScopeCreepEngineConfig()); return;
      case "monitoring": res.json(await loadMonitoringEngineConfig()); return;
      case "sales_offer": res.json(await loadSalesOfferEngineConfig()); return;
      case "msp":
        res.json({
          mode: "aggregator",
          engine: "msp",
          title: def.label,
          description: "The MSP Portfolio Engine has no configuration of its own — it aggregates the Health, Drift, and Priority engine scores per tenant into a portfolio-wide risk roll-up. Configure those engines to change what the MSP engine produces.",
          dependsOn: def.dependsOn,
          rules: [], groups: [],
        });
        return;
    }

    // Signal-derived engines: filter by whichever contribution field(s) this
    // engine actually sums being non-zero (plus a category gate for drift/crm).
    const [rules, groups] = await Promise.all([getAllRules(), getAllGroups()]);
    res.json({
      mode: "signal-rules",
      rules: rules.filter(r => rowContributesToEngine(def.key, r as unknown as Record<string, unknown>)),
      groups: groups.filter(g => rowContributesToEngine(def.key, g as unknown as Record<string, unknown>)),
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
          const { values: gIntel, error: gIntelError } = parseIntelligenceFields(g);
          if (gIntelError) {
            throw new Error(`Import aborted — group for signal "${g.signalKey ?? g.signal_key}": ${gIntelError}`);
          }
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
        const { values: rIntel, error: rIntelError } = parseIntelligenceFields(r);
        if (rIntelError) {
          throw new Error(`Import aborted — rule for signal "${r.signalKey ?? r.signal_key}" (sourceKey "${r.sourceKey ?? r.source_key}"): ${rIntelError}`);
        }
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
    const knownSignalKeys = new Set((await getAllSignalDefinitions()).map(s => s.key));
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
    const knownSignalKeys = new Set((await getAllSignalDefinitions()).map(s => s.key));
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
      .select({ id: tenantsTable.id, mspId: tenantsTable.mspId })
      .from(tenantsTable)
      .where(and(eq(tenantsTable.id, Number(testbedCustomerId)), eq(tenantsTable.isTestbed, true)))
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
      // `notifications.mspUserId` used to hold an msp_users row id; with that
      // table gone the successor id-space is users.id, which this now sends.
      const watchingUsers = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(and(eq(usersTable.mspId, customer.mspId), eq(usersTable.isActive, true)));

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
 * @route POST /api/simulator/sql/execute
 * @desc Executes SQL queries/CRUD scripts with performance timing & safety checks
 *
 * Git #702: also reachable via Shane's Build Tracker browser extension's
 * floaty SQL Runner, same bearer-token pattern used elsewhere in Build
 * Tracker — full read/write, no restrictions, by his own explicit choice
 * after being walked through the risk. Development server, not production.
 */
router.post("/simulator/sql/execute", requireAdminOrIngestToken(), async (req: Request, res: Response) => {
  const startedAt = Date.now();
  const { query } = req.body ?? {};

  if (!query || typeof query !== "string") {
    return res.status(400).json({ error: "A valid SQL query string is required." });
  }

  try {
    const result = await executeRawSql(query);
    // Recorded server-side rather than by the browser, so a query is kept even
    // if the tab closed before the response landed — see lib/run-history.ts.
    await recordSqlRun({ cmd: query, startedAt, statements: result.statements, actorUserId: req.user?.id ?? null });
    return res.json(result);
  } catch (err: any) {
    log.error({ err, query }, "SQL console execute failed");
    await recordFailedSqlRun({
      cmd: query,
      startedAt,
      error: err?.message || "Failed to execute query",
      actorUserId: req.user?.id ?? null,
    });
    return res.status(500).json({ error: err.message || "Failed to execute query" });
  }
});

/**
 * @route POST /api/simulator/ps-execution/cmdlet
 * @desc Runs ONE allowlisted PowerShell cmdlet through the SAME real server code
 *       path a real scan uses — lib/ps-execution-client.callPsExecution() → the
 *       ca-ps-execution[-dev] container (#1404). Backs shaneapp://executeCmdlet so
 *       a local build session can exercise the Security & Compliance / Exchange /
 *       Teams cmdlets that make up the PowerShell-backed scan checks, WITHOUT ever
 *       holding the raw ps-execution bearer secret — that secret is fetched
 *       server-side by ps-execution-client, exactly as monitor-executor's
 *       runPowerShellCheck() does. This closes #1400/#1389's remaining live-verify
 *       gap (a session's own environment correctly refused to fetch that secret).
 *
 * REUSE, NOT A SECOND CLIENT: this calls callPsExecution() directly — the SAME
 * function runPowerShellCheck() calls — so the Dev-vs-Production container
 * selection (getContainerUrl → isProductionEnvironment, #1385: a dev api-server
 * hits the isolated ca-ps-execution-dev, never production), the bearer-token/cert
 * handling, and the container's fixed cmdlet allowlist all apply unchanged.
 * `cmdletKey` resolves ONLY to a catalog entry container-side
 * (services/ps-execution/cmdlet-catalog.ps1); an unknown key is the container's
 * own 400 "unknown_cmdlet", never validated here.
 *
 * #965 TESTBED GATE (a server-side belt to shaneapp://executeCmdlet's own
 * client-side TestbedGate): a real Connect-IPPSSession/Exchange/Teams sign-in
 * against a tenant is a real confidentiality boundary, so — exactly like
 * admin-baseline-templates' write gate — this refuses (403) unless the resolved
 * tenant is a real isTestbed=true, active customer. `tenantId` may be the Entra
 * tenant GUID or the numeric customer id. The Organization actually handed to
 * Connect-* is derived from that GATED testbed tenant's own domain
 * (tenants.domain, GUID fallback — exactly how runPowerShellCheck resolves it),
 * NEVER from an unchecked caller value: a caller-supplied `organization` is
 * honored only if it matches the gated tenant, so the sign-in can never be
 * pointed at a different org than the one that passed the gate, and a caller can
 * never override it through `params.Organization` either.
 */
router.post("/simulator/ps-execution/cmdlet", requireAdminOrIngestToken(), async (req: Request, res: Response) => {
  const startedAt = Date.now();
  const body = (req.body ?? {}) as {
    cmdletKey?: unknown;
    tenantId?: unknown;
    organization?: unknown;
    params?: unknown;
  };

  const cmdletKey = typeof body.cmdletKey === "string" ? body.cmdletKey.trim() : "";
  const tenantArg = body.tenantId == null ? "" : String(body.tenantId).trim();
  const callerOrg = typeof body.organization === "string" ? body.organization.trim() : "";
  const callerParams =
    body.params && typeof body.params === "object" && !Array.isArray(body.params)
      ? (body.params as Record<string, unknown>)
      : {};

  if (!cmdletKey) {
    return res.status(400).json({ ok: false, error: "A cmdletKey (an allowlisted ps-execution cmdlet key) is required." });
  }
  if (!tenantArg) {
    return res.status(400).json({ ok: false, error: "A tenantId (a testbed tenant GUID or numeric customer id) is required." });
  }

  // ── #965 testbed gate + Organization resolution (the server is source of truth) ──
  const numericId = /^\d+$/.test(tenantArg) ? Number(tenantArg) : null;
  const [tenant] = await db
    .select({
      id: tenantsTable.id,
      name: tenantsTable.customerName,
      tenantId: tenantsTable.tenantId,
      domain: tenantsTable.domain,
      isTestbed: tenantsTable.isTestbed,
      status: tenantsTable.status,
    })
    .from(tenantsTable)
    .where(numericId != null ? eq(tenantsTable.id, numericId) : eq(tenantsTable.tenantId, tenantArg))
    .limit(1);

  if (!tenant) {
    return res.status(404).json({ ok: false, error: `No tenant found for '${tenantArg}'.`, cmdletKey });
  }
  if (!tenant.isTestbed || tenant.status !== "active") {
    return res.status(403).json({
      ok: false,
      error:
        `Tenant '${tenant.name ?? tenantArg}' is not a confirmed isTestbed=true, active customer — refusing to run a real PowerShell cmdlet against a non-testbed tenant (#965).`,
      cmdletKey,
      customerId: tenant.id,
      matchedCustomerName: tenant.name ?? null,
    });
  }

  // Organization is the reserved tenant-identity field Connect-* needs
  // (cmdlet-catalog.ps1) — the GATED testbed tenant's own domain, GUID fallback.
  const organization = tenant.domain || tenant.tenantId || "";
  const eqCI = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  if (
    callerOrg &&
    !eqCI(callerOrg, organization) &&
    !eqCI(callerOrg, tenant.tenantId ?? "") &&
    !eqCI(callerOrg, tenant.domain ?? "")
  ) {
    return res.status(400).json({
      ok: false,
      error:
        `organization '${callerOrg}' does not match the resolved testbed tenant ('${organization}') — refusing (the sign-in target must be the gated testbed tenant).`,
      cmdletKey,
      customerId: tenant.id,
      matchedCustomerName: tenant.name ?? null,
    });
  }

  // params fill the cmdlet's allowed parameter VALUES only (the container-side
  // allowlist decides which are honored); Organization is FORCED to the gated
  // value so a caller can never override the sign-in target through params.
  const params: Record<string, unknown> = { ...callerParams, Organization: organization };

  try {
    const { items, rawResponse } = await callPsExecution(cmdletKey, params);
    const elapsedMs = Date.now() - startedAt;
    psLog.info(
      { cmdletKey, organization, customerId: tenant.id, itemCount: items.length, elapsedMs },
      "ps-execution cmdlet (simulator) ok",
    );
    return res.json({
      ok: true,
      cmdletKey,
      organization,
      tenantId: tenant.tenantId,
      customerId: tenant.id,
      matchedCustomerName: tenant.name ?? null,
      itemCount: items.length,
      items,
      rawResponse,
      elapsedMs,
    });
  } catch (err) {
    const elapsedMs = Date.now() - startedAt;
    if (err instanceof PsExecutionError) {
      // Map the container's failure kind to an HTTP status: a malformed check
      // definition (script_error / bad request) is the caller's 400; an
      // auth/cmdlet-availability/unreachable failure is an upstream 502.
      const status = err.kind === "script_error" ? 400 : 502;
      psLog.warn(
        { cmdletKey, organization, customerId: tenant.id, kind: err.kind, containerErrorKind: err.containerErrorKind, elapsedMs },
        "ps-execution cmdlet (simulator) failed",
      );
      return res.status(status).json({
        ok: false,
        error: err.message,
        kind: err.kind,
        containerErrorKind: err.containerErrorKind ?? null,
        cmdletKey,
        organization,
        tenantId: tenant.tenantId,
        customerId: tenant.id,
        matchedCustomerName: tenant.name ?? null,
        elapsedMs,
      });
    }
    psLog.error({ err, cmdletKey, organization }, "ps-execution cmdlet (simulator) threw");
    return res.status(500).json({
      ok: false,
      error: (err as Error)?.message || "ps-execution cmdlet failed",
      cmdletKey,
      elapsedMs,
    });
  }
});

/**
 * @route GET /api/simulator/ps-execution/capability-survey
 * @desc Reads back Git #1793's app-only PowerShell capability survey — which of
 *       the several hundred cmdlets ExchangeOnlineManagement / MicrosoftTeams
 *       actually export survive app-only certificate auth through
 *       ca-ps-execution, with the real output shape of every one that works.
 *
 * WHY A ROUTE AND NOT JUST THE MARKDOWN: #1793 asks for the survey to be
 * "queryable and re-runnable, not only a markdown file". A capability table
 * goes stale the moment the container, the tenant's licensing, or the app's
 * role assignments change, and a stale capability table is worse than none —
 * it produces confident false negatives. This serves whatever is actually in
 * `ps_capability_survey_results` right now; docs/powershell-capability-survey.md
 * is a rendering of the same rows, never a second source of truth.
 *
 * READ-ONLY BY CONSTRUCTION: this route never calls the ps-execution container
 * and never touches a tenant. Producing a survey is
 * `scripts/src/ps-capability-survey.ts` (which goes through the #965-gated
 * cmdlet route above); this only reads what that already recorded.
 *
 * Query params, all optional:
 *   runId   — a specific ps_capability_survey_runs.id; defaults to the latest run.
 *   session — exchange | compliance | teams.
 *   status  — ok | access_denied | cmdlet_unavailable | not_supported_app_only |
 *             throttled | error | auth_failed | not_attempted.
 *   cmdlet  — case-insensitive substring of the cmdlet name.
 */
router.get("/simulator/ps-execution/capability-survey", requireAdminOrIngestToken(), async (req: Request, res: Response) => {
  try {
    const runIdArg = typeof req.query.runId === "string" && /^\d+$/.test(req.query.runId) ? Number(req.query.runId) : null;
    const sessionArg = typeof req.query.session === "string" ? req.query.session.trim() : "";
    const statusArg = typeof req.query.status === "string" ? req.query.status.trim() : "";
    const cmdletArg = typeof req.query.cmdlet === "string" ? req.query.cmdlet.trim() : "";

    // Default to the newest COMPLETED run, not merely the newest. An aborted
    // run has a real but PARTIAL row set, and every cmdlet it never reached is
    // simply absent — read as a capability table, absence looks like "doesn't
    // work". That false negative is the exact failure #1793 says is worse than
    // no table at all. A caller can still ask for a specific run by id, and
    // `run.status` is always returned so an incomplete one is never mistaken
    // for a finished one.
    const [run] = runIdArg
      ? await db.select().from(psCapabilitySurveyRunsTable).where(eq(psCapabilitySurveyRunsTable.id, runIdArg)).limit(1)
      : await db
          .select()
          .from(psCapabilitySurveyRunsTable)
          .where(eq(psCapabilitySurveyRunsTable.status, "completed"))
          .orderBy(desc(psCapabilitySurveyRunsTable.startedAt))
          .limit(1);

    if (!run) {
      // An empty survey table is a real, reportable state — not an error, and
      // deliberately NOT backfilled with anything invented. It means the survey
      // has never been run against this database.
      return res.json({
        ok: true,
        run: null,
        totals: [],
        rows: [],
        note:
          "No COMPLETED capability survey run exists in this database. Either the survey has never been run " +
          "(pnpm --filter @workspace/scripts run ps-capability-survey), or every run so far aborted part-way — " +
          "pass ?runId= to inspect a specific incomplete run.",
      });
    }

    const filters = [eq(psCapabilitySurveyResultsTable.runId, run.id)];
    if (sessionArg) filters.push(eq(psCapabilitySurveyResultsTable.sessionType, sessionArg as (typeof PS_CAPABILITY_SURVEY_SESSION_TYPES)[number]));
    if (statusArg) filters.push(eq(psCapabilitySurveyResultsTable.status, statusArg as (typeof PS_CAPABILITY_SURVEY_STATUSES)[number]));
    if (cmdletArg) filters.push(sql`${psCapabilitySurveyResultsTable.cmdletName} ILIKE ${`%${cmdletArg}%`}`);

    const rows = await db
      .select()
      .from(psCapabilitySurveyResultsTable)
      .where(and(...filters))
      .orderBy(psCapabilitySurveyResultsTable.sessionType, psCapabilitySurveyResultsTable.cmdletName);

    // Totals are always for the WHOLE run, never the filtered slice — a
    // filtered count read as a run total is exactly how a capability table
    // starts lying about coverage.
    const totals = await db
      .select({
        sessionType: psCapabilitySurveyResultsTable.sessionType,
        status: psCapabilitySurveyResultsTable.status,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(psCapabilitySurveyResultsTable)
      .where(eq(psCapabilitySurveyResultsTable.runId, run.id))
      .groupBy(psCapabilitySurveyResultsTable.sessionType, psCapabilitySurveyResultsTable.status)
      .orderBy(psCapabilitySurveyResultsTable.sessionType, psCapabilitySurveyResultsTable.status);

    return res.json({ ok: true, run, totals, rows, filtered: rows.length, note: null });
  } catch (err) {
    psLog.error({ err }, "ps-execution capability survey read failed");
    return res.status(500).json({ ok: false, error: (err as Error)?.message || "capability survey read failed" });
  }
});

// lib/db/migrations/manual/ — real .sql files committed to the repo, read
// straight off the server filesystem (not a database table).
const MANUAL_MIGRATIONS_DIR = path.resolve(process.cwd(), "../../lib/db/migrations/manual");

async function listManualMigrationFiles(): Promise<string[]> {
  const entries = await fs.readdir(MANUAL_MIGRATIONS_DIR, { withFileTypes: true });
  // Non-recursive by design: archived files under archive/diagnostics/ and
  // archive/obsolete/ are meant to disappear from the Simulator tree (#497).
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".sql"))
    .map((e) => e.name)
    .sort()
    .reverse();
}

/**
 * @route GET /api/simulator/migrations/files
 * @desc Lists every .sql file in lib/db/migrations/manual/, sorted reverse-alphabetically
 *       (filenames are dated YYYY-MM-DD-description.sql, so reverse-alphabetical order
 *       is newest-to-oldest chronological order). Each entry carries `ranAt` — the
 *       last time the file's own trailing self-mark INSERT recorded a run in
 *       simulator_migration_runs (#497) — or null if it has never been run.
 */
router.get("/simulator/migrations/files", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const filenames = await listManualMigrationFiles();

    // simulator_migration_runs is provisioned by a manual migration Shane runs
    // himself — until it exists, degrade to ranAt: null on every file rather
    // than breaking the whole migrations tree.
    const ranAtByFilename = new Map<string, string>();
    try {
      const result = await pool.query("SELECT filename, ran_at FROM simulator_migration_runs");
      for (const row of result.rows) {
        if (row.filename && row.ran_at != null) {
          ranAtByFilename.set(String(row.filename), new Date(row.ran_at).toISOString());
        }
      }
    } catch (err: any) {
      systemLog.warn({ err }, "Simulator migrations: simulator_migration_runs not readable — reporting all files as not yet run");
    }

    const files = filenames.map((filename) => ({
      filename,
      ranAt: ranAtByFilename.get(filename) ?? null,
    }));
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
  const startedAt = Date.now();
  const { filename } = req.body ?? {};

  if (!filename || typeof filename !== "string") {
    return res.status(400).json({ error: "A valid migration filename is required." });
  }

  // The run-history row records the repo path, not the SQL: the file is read
  // off the server filesystem and its text never belongs to the browser.
  const cmd = `lib/db/migrations/manual/${filename}`;

  try {
    // Exact allowlist check against the real directory listing — not just
    // string sanitization — so a path-traversal filename can never reach fs.readFile.
    const realFiles = await listManualMigrationFiles();
    if (!realFiles.includes(filename)) {
      return res.status(400).json({ error: "Not a recognized manual migration file." });
    }

    const filePath = path.join(MANUAL_MIGRATIONS_DIR, filename);
    const query = await fs.readFile(filePath, "utf8");

    const result = await executeRawSql(query);
    await recordSqlRun({
      cmd,
      startedAt,
      statements: result.statements,
      migrationFile: filename,
      actorUserId: req.user?.id ?? null,
    });
    return res.json(result);
  } catch (err: any) {
    systemLog.error({ err, filename }, "Simulator migrations: execute failed");
    await recordFailedSqlRun({
      cmd,
      startedAt,
      error: err?.message || "Failed to execute migration file",
      migrationFile: filename,
      actorUserId: req.user?.id ?? null,
    });
    return res.status(500).json({ error: err.message || "Failed to execute migration file" });
  }
});

/**
 * @route POST /api/simulator/migrations/mark-ran
 * @desc Writes the file's own trailing self-mark INSERT directly, without
 *       executing the rest of the file — for the (occasional) migration file
 *       that never got that trailing INSERT written into it, where Shane has
 *       already run the real SQL himself via his own console and just needs
 *       the Migrations tree's checkbox to reflect that. Does not touch the
 *       file's actual schema/data changes — this only ever writes to
 *       simulator_migration_runs.
 */
router.post("/simulator/migrations/mark-ran", requireAdmin, async (req: Request, res: Response) => {
  const { filename } = req.body ?? {};

  if (!filename || typeof filename !== "string") {
    return res.status(400).json({ error: "A valid migration filename is required." });
  }

  try {
    // Exact allowlist check against the real directory listing — same guard
    // `/migrations/execute` uses — so this can never mark an arbitrary string.
    const realFiles = await listManualMigrationFiles();
    if (!realFiles.includes(filename)) {
      return res.status(400).json({ error: "Not a recognized manual migration file." });
    }

    await pool.query(
      `INSERT INTO simulator_migration_runs (filename, ran_at) VALUES ($1, now())
       ON CONFLICT (filename) DO UPDATE SET ran_at = now()`,
      [filename],
    );
    return res.json({ filename, ranAt: new Date().toISOString() });
  } catch (err: any) {
    systemLog.error({ err, filename }, "Simulator migrations: mark-ran failed");
    return res.status(500).json({ error: err.message || "Failed to mark migration as run" });
  }
});

/**
 * @route GET /api/simulator/migrations/:filename/content
 * @desc Reads one manual migration file's real text off disk, for the SQL
 *       Runner's editor to preview before running — no execution, no DB hit.
 *       Safe to expose: these files are already committed to the repo under
 *       lib/db/migrations/manual/, not secret. Distinct from the run-history
 *       row deliberately not carrying SQL text (`/migrations/execute`'s own
 *       comment) — that is about what a *run* records, not whether the file
 *       itself can be read.
 */
router.get("/simulator/migrations/:filename/content", requireAdmin, async (req: Request, res: Response) => {
  const filename = String(req.params.filename ?? "");
  try {
    // Exact allowlist check against the real directory listing — not just
    // string sanitization — so a path-traversal filename can never reach fs.readFile.
    const realFiles = await listManualMigrationFiles();
    if (!realFiles.includes(filename)) {
      return res.status(400).json({ error: "Not a recognized manual migration file." });
    }

    const filePath = path.join(MANUAL_MIGRATIONS_DIR, filename);
    const content = await fs.readFile(filePath, "utf8");
    return res.json({ filename, content });
  } catch (err: any) {
    systemLog.error({ err, filename }, "Simulator migrations: failed to read file content");
    return res.status(500).json({ error: err.message || "Failed to read migration file" });
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
