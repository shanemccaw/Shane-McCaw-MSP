import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { db, usersTable, engagementProjectsTable } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import {
  ENGINE_DEFS,
  getEngineDef,
  buildEngineTestInputForTenant,
  buildEngineTestInputForPayload,
} from "../lib/engine-registry";
import {
  computeTenantSignals,
  evaluateRule,
  projectMatchesSignals,
  TENANT_SIGNALS,
  ADJUSTMENT_SIGNALS,
  type SignalDerivationRule,
  type SignalRuleGroup,
} from "../lib/tenant-signals";
import { getAllRules, getAllGroups } from "./admin-signal-rules";
import { pushEngineTestLog, listEngineTestLogs } from "../lib/engine-test-log-buffer";

const router: IRouter = Router();

// ── Shared helpers ──────────────────────────────────────────────────────────

function parsePayloadBody(body: Record<string, unknown>): { profileUpdates: Record<string, unknown>; parsedFindings: string[] } {
  const payload = (body.payload ?? {}) as Record<string, unknown>;
  const profileUpdates = (payload.profileUpdates ?? {}) as Record<string, unknown>;
  const parsedFindings = Array.isArray(payload.parsedFindings) ? (payload.parsedFindings as string[]) : [];
  return { profileUpdates, parsedFindings };
}

async function runEngine(
  engineKey: string,
  body: Record<string, unknown>,
): Promise<{ mode: "tenant" | "payload"; tenantId?: number; output: unknown }> {
  const def = getEngineDef(engineKey);
  if (!def) throw new Error(`Unknown engine: ${engineKey}`);

  const tenantId = body.tenantId != null ? Number(body.tenantId) : undefined;
  if (tenantId != null && !isNaN(tenantId)) {
    const output = await def.runForTenant(tenantId);
    return { mode: "tenant", tenantId, output };
  }

  const { profileUpdates, parsedFindings } = parsePayloadBody(body);
  const input = await buildEngineTestInputForPayload(profileUpdates, parsedFindings);
  const output = def.runForPayload(input);
  return { mode: "payload", output };
}

// ── GET /api/admin/engines ──────────────────────────────────────────────────
// Lists all seven engine definitions for the nav / picker.

router.get("/admin/engines", requireAdmin, (_req: Request, res: Response) => {
  res.json({
    engines: ENGINE_DEFS.map(e => ({ key: e.key, label: e.label, description: e.description, categoryPrefix: e.categoryPrefix, tenantScoped: e.tenantScoped })),
  });
});

// ── POST /api/admin/engines/:key/test ───────────────────────────────────────
// Test against a real tenant ({ tenantId }) or a sample payload
// ({ payload: { profileUpdates, parsedFindings } }). Every run is logged to
// the in-memory ring buffer so the Testing tab can show recent runs.

router.post("/admin/engines/:key/test", requireAdmin, async (req: Request, res: Response) => {
  const { key } = req.params;
  const debug = Boolean((req.body as Record<string, unknown> | undefined)?.debug);
  try {
    const { mode, tenantId, output } = await runEngine(String(key), (req.body ?? {}) as Record<string, unknown>);
    pushEngineTestLog({ id: randomUUID(), engineKey: String(key), createdAt: new Date().toISOString(), mode, tenantId, debug, output });
    res.json({ mode, tenantId, output });
  } catch (err) {
    logger.error({ err, engineKey: key }, "admin-engines: test run failed");
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
    const { mode, tenantId, output } = await runEngine(String(key), (req.body ?? {}) as Record<string, unknown>);

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

    res.json({ mode, tenantId, output, workflowOutputPreview, sowImpactPreview, mspImpactPreview });
  } catch (err) {
    logger.error({ err, engineKey: key }, "admin-engines: preview failed");
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
    logger.error({ err, engineKey: key }, "admin-engines: dashboard failed");
    res.status(500).json({ error: "Failed to load engine dashboard" });
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
    logger.error({ err, engineKey: key }, "admin-engines: configuration fetch failed");
    res.status(500).json({ error: "Failed to load engine configuration" });
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
    const tenantId = body.tenantId != null ? Number(body.tenantId) : undefined;
    const payload = (body.payload ?? {}) as Record<string, unknown>;
    const input = tenantId != null && !isNaN(tenantId)
      ? await buildEngineTestInputForTenant(tenantId)
      : await buildEngineTestInputForPayload(
          (payload.profileUpdates as Record<string, unknown>) ?? {},
          (payload.parsedFindings as string[]) ?? [],
        );

    const groupRules = rules.filter(r => r.groupId === groupId);
    const traces = groupRules.map(r => ({ ruleId: r.id, ...evaluateRule(r, input.mergedProfile, input.parsedFindings) }));
    const groupResult = group.logic === "AND" ? traces.every(t => t.result) : traces.some(t => t.result);

    res.json({ groupId, logic: group.logic, result: groupResult, ruleTraces: traces });
  } catch (err) {
    logger.error({ err, groupId }, "admin-engines: rule-group test failed");
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
    logger.error({ err, groupId }, "admin-engines: rule-group preview failed");
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
    logger.error({ err, groupId }, "admin-engines: rule-group activation logs failed");
    res.status(500).json({ error: "Failed to load activation logs" });
  }
});

// ── Reusable per-signal testing/preview/contribution/logs ───────────────────

router.post("/admin/engines/signals/:signalKey/test", requireAdmin, async (req: Request, res: Response) => {
  const signalKey = String(req.params.signalKey);
  try {
    const tenantId = (req.body as Record<string, unknown>)?.tenantId != null ? Number((req.body as Record<string, unknown>).tenantId) : undefined;
    const input = tenantId != null && !isNaN(tenantId)
      ? await buildEngineTestInputForTenant(tenantId)
      : await buildEngineTestInputForPayload(
          ((req.body as Record<string, unknown>)?.payload as Record<string, unknown> | undefined)?.profileUpdates as Record<string, unknown> ?? {},
          ((req.body as Record<string, unknown>)?.payload as Record<string, unknown> | undefined)?.parsedFindings as string[] ?? [],
        );

    const scopedRules = input.rules.filter(r => r.signalKey === signalKey);
    const scopedGroups = input.groups.filter(g => g.signalKey === signalKey);
    const { firedSignals, trace } = computeTenantSignals(input.mergedProfile, input.parsedFindings, scopedRules, scopedGroups, input.disabledSignalKeys);
    res.json({ signalKey, fired: firedSignals.has(signalKey), trace });
  } catch (err) {
    logger.error({ err, signalKey }, "admin-engines: signal test failed");
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
    logger.error({ err, signalKey }, "admin-engines: signal preview failed");
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
    logger.error({ err, signalKey }, "admin-engines: contribution preview failed");
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
    logger.error({ err, signalKey }, "admin-engines: signal logs failed");
    res.status(500).json({ error: "Failed to load signal logs" });
  }
});

export default router;
