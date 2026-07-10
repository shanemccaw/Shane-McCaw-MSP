import { Router, type IRouter, type Request, type Response } from "express";
import { db, scriptRunResultsTable, engagementProjectsTable, usersTable } from "@workspace/db";
import { eq, desc, asc, isNull, sql } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import {
  TENANT_SIGNALS,
  ADJUSTMENT_SIGNALS,
  computeTenantSignals,
  projectMatchesSignals,
  getDisabledSignalKeys,
  SIGNAL_TREND_DIRECTIONS,
  SIGNAL_SEVERITIES,
  type SignalDerivationRule,
  type SignalRuleGroup,
} from "../lib/tenant-signals";
import { detectRuleConflicts } from "../lib/signal-conflict-detector";

const router: IRouter = Router();

// ── Intelligence field helpers ─────────────────────────────────────────────
// Shared SELECT fragment for the intelligence fields added on both
// signal_rule_groups and signal_derivation_rules — see the taxonomy comment
// near `signalRuleGroupsTable` in lib/db/src/schema/index.ts.
const INTELLIGENCE_FIELDS_SELECT = sql`
  priority, weight,
  pricing_impact AS "pricingImpact",
  priority_score_contribution AS "priorityScoreContribution",
  pricing_value_contribution AS "pricingValueContribution",
  governance_impact AS "governanceImpact",
  security_impact AS "securityImpact",
  compliance_impact AS "complianceImpact",
  adoption_impact AS "adoptionImpact",
  copilot_impact AS "copilotImpact",
  architecture_impact AS "architectureImpact",
  trend_value AS "trendValue",
  trend_direction AS "trendDirection",
  decay_rate AS "decayRate",
  ttl_days AS "ttlDays",
  confidence,
  severity,
  category,
  pillar,
  crm_fit_contribution AS "crmFitContribution",
  crm_pain_contribution AS "crmPainContribution",
  crm_maturity_contribution AS "crmMaturityContribution",
  crm_intent_contribution AS "crmIntentContribution",
  crm_urgency_contribution AS "crmUrgencyContribution"
`;

interface IntelligenceFieldInput {
  priority?: unknown;
  weight?: unknown;
  pricingImpact?: unknown;
  priorityScoreContribution?: unknown;
  pricingValueContribution?: unknown;
  governanceImpact?: unknown;
  securityImpact?: unknown;
  complianceImpact?: unknown;
  adoptionImpact?: unknown;
  copilotImpact?: unknown;
  architectureImpact?: unknown;
  trendValue?: unknown;
  trendDirection?: unknown;
  decayRate?: unknown;
  ttlDays?: unknown;
  confidence?: unknown;
  severity?: unknown;
  category?: unknown;
  pillar?: unknown;
  crmFitContribution?: unknown;
  crmPainContribution?: unknown;
  crmMaturityContribution?: unknown;
  crmIntentContribution?: unknown;
  crmUrgencyContribution?: unknown;
}

const INTELLIGENCE_FIELD_DEFAULTS: Record<string, number | string> = {
  priority: 0, weight: 0, pricingImpact: 0, priorityScoreContribution: 0, pricingValueContribution: 0,
  governanceImpact: 0, securityImpact: 0, complianceImpact: 0, adoptionImpact: 0, copilotImpact: 0,
  architectureImpact: 0, trendValue: 0, trendDirection: "flat", decayRate: 0, ttlDays: 0, confidence: 0,
  severity: "low", category: "", pillar: "", crmFitContribution: 0, crmPainContribution: 0,
  crmMaturityContribution: 0, crmIntentContribution: 0, crmUrgencyContribution: 0,
};

/**
 * Validates and normalizes the intelligence fields from a request body.
 * Field-by-field merge: any field NOT present on `body` falls back to the
 * corresponding value on `base` (e.g. the prior DB row on a PATCH) rather
 * than a hardcoded default, so a partial update never zeroes out unrelated
 * intelligence data. `base` defaults to the zero/empty defaults for creates.
 */
export function parseIntelligenceFields(
  body: IntelligenceFieldInput,
  base: Record<string, number | string> = INTELLIGENCE_FIELD_DEFAULTS,
): { values: Record<string, number | string>; error?: string } {
  const num = (v: unknown, fallback: number): number => {
    if (v === undefined) return fallback;
    const n = Number(v);
    return isNaN(n) ? fallback : n;
  };
  const str = (v: unknown, fallback: string): string => (v === undefined ? fallback : String(v));
  if (body.trendDirection !== undefined && !SIGNAL_TREND_DIRECTIONS.includes(body.trendDirection as typeof SIGNAL_TREND_DIRECTIONS[number])) {
    return { values: {}, error: `trendDirection must be one of: ${SIGNAL_TREND_DIRECTIONS.join(", ")}` };
  }
  if (body.severity !== undefined && !SIGNAL_SEVERITIES.includes(body.severity as typeof SIGNAL_SEVERITIES[number])) {
    return { values: {}, error: `severity must be one of: ${SIGNAL_SEVERITIES.join(", ")}` };
  }
  return {
    values: {
      priority: num(body.priority, base.priority as number),
      weight: num(body.weight, base.weight as number),
      pricingImpact: num(body.pricingImpact, base.pricingImpact as number),
      priorityScoreContribution: num(body.priorityScoreContribution, base.priorityScoreContribution as number),
      pricingValueContribution: num(body.pricingValueContribution, base.pricingValueContribution as number),
      governanceImpact: num(body.governanceImpact, base.governanceImpact as number),
      securityImpact: num(body.securityImpact, base.securityImpact as number),
      complianceImpact: num(body.complianceImpact, base.complianceImpact as number),
      adoptionImpact: num(body.adoptionImpact, base.adoptionImpact as number),
      copilotImpact: num(body.copilotImpact, base.copilotImpact as number),
      architectureImpact: num(body.architectureImpact, base.architectureImpact as number),
      trendValue: num(body.trendValue, base.trendValue as number),
      trendDirection: str(body.trendDirection, base.trendDirection as string),
      decayRate: num(body.decayRate, base.decayRate as number),
      ttlDays: num(body.ttlDays, base.ttlDays as number),
      confidence: num(body.confidence, base.confidence as number),
      severity: str(body.severity, base.severity as string),
      category: str(body.category, base.category as string),
      pillar: str(body.pillar, base.pillar as string),
      crmFitContribution: num(body.crmFitContribution, base.crmFitContribution as number),
      crmPainContribution: num(body.crmPainContribution, base.crmPainContribution as number),
      crmMaturityContribution: num(body.crmMaturityContribution, base.crmMaturityContribution as number),
      crmIntentContribution: num(body.crmIntentContribution, base.crmIntentContribution as number),
      crmUrgencyContribution: num(body.crmUrgencyContribution, base.crmUrgencyContribution as number),
    },
  };
}

// ── Raw DB helpers ─────────────────────────────────────────────────────────────

export async function getAllRules(): Promise<SignalDerivationRule[]> {
  const rows = await db.execute(sql`
    SELECT id, signal_key AS "signalKey", group_id AS "groupId", rule_type AS "ruleType",
           source_key AS "sourceKey", compare_value AS "compareValue", description,
           sort_order AS "sortOrder", created_at AS "createdAt", updated_at AS "updatedAt",
           ${INTELLIGENCE_FIELDS_SELECT}
    FROM signal_derivation_rules
    ORDER BY signal_key, sort_order, id
  `);
  return rows.rows as unknown as SignalDerivationRule[];
}

export async function getAllGroups(): Promise<SignalRuleGroup[]> {
  const rows = await db.execute(sql`
    SELECT id, signal_key AS "signalKey", logic, label, sort_order AS "sortOrder", created_at AS "createdAt",
           ${INTELLIGENCE_FIELDS_SELECT}
    FROM signal_rule_groups
    ORDER BY signal_key, sort_order, id
  `);
  return rows.rows as unknown as SignalRuleGroup[];
}

// ── Signal enabled/disabled state ──────────────────────────────────────────────
// Signals default to enabled — only rows explicitly written with enabled=false
// are treated as disabled. A missing row means "enabled" (unchanged default
// behavior for every existing signal until an admin explicitly toggles one).

async function getSignalEnabledMap(): Promise<Record<string, boolean>> {
  const rows = await db.execute(sql`
    SELECT signal_key AS "signalKey", enabled FROM signal_enabled_state
  `);
  const map: Record<string, boolean> = {};
  for (const r of rows.rows as Array<{ signalKey: string; enabled: boolean }>) {
    map[r.signalKey] = r.enabled;
  }
  return map;
}

async function appendAuditLog(entry: {
  action: string;
  signalKey?: string | null;
  ruleId?: number | null;
  before?: unknown;
  after?: unknown;
  adminUserId?: number | null;
  note?: string | null;
}) {
  await db.execute(sql`
    INSERT INTO signal_rule_audit_log (action, signal_key, rule_id, before, after, admin_user_id, note)
    VALUES (
      ${entry.action},
      ${entry.signalKey ?? null},
      ${entry.ruleId ?? null},
      ${entry.before ? JSON.stringify(entry.before) : null}::jsonb,
      ${entry.after ? JSON.stringify(entry.after) : null}::jsonb,
      ${entry.adminUserId ?? null},
      ${entry.note ?? null}
    )
  `);
}

export async function saveSnapshot(name: string, adminId?: number | null): Promise<number> {
  const rules = await getAllRules();
  const groups = await getAllGroups();
  const snapshot = { rules, groups };
  const result = await db.execute(sql`
    INSERT INTO signal_rule_versions (name, snapshot, rule_count, created_by_admin_id)
    VALUES (${name}, ${JSON.stringify(snapshot)}::jsonb, ${rules.length}, ${adminId ?? null})
    RETURNING id
  `);
  return (result.rows[0] as { id: number }).id;
}

// ── Seed default adjustment signal rules ──────────────────────────────────────
// Called once at module init. Uses ON CONFLICT DO NOTHING so it is idempotent.
// Each adj:* signal gets one OR-group with its recommended rules seeded.

async function seedAdjustmentSignalRules(): Promise<void> {
  try {
    for (const sig of ADJUSTMENT_SIGNALS) {
      // Skip if any rule already exists for this signal key
      const existing = await db.execute(sql`
        SELECT id FROM signal_derivation_rules WHERE signal_key = ${sig.key} LIMIT 1
      `);
      if ((existing.rows as unknown[]).length > 0) continue;

      if (sig.recommendedRules.length === 0) continue;

      // Create an OR-group for the signal
      const groupResult = await db.execute(sql`
        INSERT INTO signal_rule_groups (signal_key, logic, label, sort_order)
        VALUES (${sig.key}, 'OR', ${`${sig.label} Conditions`}, 0)
        RETURNING id
      `);
      const groupId = (groupResult.rows[0] as { id: number }).id;

      // Seed each recommended rule into that group
      for (let i = 0; i < sig.recommendedRules.length; i++) {
        const rule = sig.recommendedRules[i]!;
        await db.execute(sql`
          INSERT INTO signal_derivation_rules
            (signal_key, group_id, rule_type, source_key, compare_value, description, sort_order)
          VALUES (
            ${sig.key}, ${groupId}, ${rule.ruleType}, ${rule.sourceKey},
            ${rule.compareValue ?? null}, ${rule.rationale}, ${i}
          )
        `);
      }

      logger.info({ signalKey: sig.key }, "admin-signal-rules: seeded default adjustment signal rules");
    }
  } catch (err) {
    logger.warn({ err }, "admin-signal-rules: adjustment signal seeder failed (non-fatal)");
  }
}

// Run seeder at module load — safe because it no-ops for any signal that already has rules.
void seedAdjustmentSignalRules();

// ── Seed illustrative category taxonomy examples ────────────────────────────
// Purely illustrative, inert example rules — one per `category` prefix — so
// admins can see how the taxonomy is meant to be used. These signal keys
// ("example:*") are NOT registered in TENANT_SIGNALS/ADJUSTMENT_SIGNALS, so
// they are never evaluated by computeTenantSignals() and can never affect
// signal firing, pricing, or SOW gating. Idempotent: skipped if any
// "example:*" rule already exists.
const CATEGORY_TAXONOMY_EXAMPLES: Array<{
  signalKey: string;
  label: string;
  ruleType: string;
  sourceKey: string;
  compareValue: string | null;
  description: string;
  category: string;
  pillar: string;
  severity: string;
  priority: number;
  weight: number;
}> = [
  { signalKey: "example:pricing", label: "Pricing — High Deal Value", ruleType: "gte", sourceKey: "estimatedAnnualValue", compareValue: "50000", description: "Illustrates a pricing:* category signal used to influence deal pricing.", category: "pricing:high_value_deal", pillar: "pricing", severity: "medium", priority: 5, weight: 3 },
  { signalKey: "example:priority", label: "Priority — Executive Escalation", ruleType: "equals", sourceKey: "escalationFlag", compareValue: "true", description: "Illustrates a priority:* category signal used to bump project priority.", category: "priority:executive_escalation", pillar: "priority", severity: "high", priority: 9, weight: 5 },
  { signalKey: "example:governance", label: "Governance — Policy Gaps", ruleType: "equals", sourceKey: "hasGovernanceGaps", compareValue: "true", description: "Illustrates a governance:* category signal for tenant policy maturity.", category: "governance:policy_gaps", pillar: "governance", severity: "medium", priority: 4, weight: 2 },
  { signalKey: "example:security", label: "Security — DLP Coverage Gap", ruleType: "equals", sourceKey: "hasDLPGaps", compareValue: "true", description: "Illustrates a security:* category signal for data-loss-prevention coverage.", category: "security:dlp_gap", pillar: "security", severity: "high", priority: 8, weight: 4 },
  { signalKey: "example:compliance", label: "Compliance — Retention Policy Missing", ruleType: "equals", sourceKey: "hasRetentionPolicy", compareValue: "false", description: "Illustrates a compliance:* category signal for regulatory retention posture.", category: "compliance:retention_policy_missing", pillar: "compliance", severity: "high", priority: 7, weight: 4 },
  { signalKey: "example:adoption", label: "Adoption — Low License Utilization", ruleType: "lt", sourceKey: "licenseUtilizationPct", compareValue: "40", description: "Illustrates an adoption:* category signal for underused licenses.", category: "adoption:low_license_utilization", pillar: "adoption", severity: "low", priority: 3, weight: 2 },
  { signalKey: "example:copilot", label: "Copilot — Readiness Achieved", ruleType: "equals", sourceKey: "hasCopilotLicenses", compareValue: "true", description: "Illustrates a copilot:* category signal for Copilot AI rollout readiness.", category: "copilot:readiness_achieved", pillar: "copilot", severity: "medium", priority: 5, weight: 3 },
  { signalKey: "example:architecture", label: "Architecture — Hybrid Exchange Complexity", ruleType: "equals", sourceKey: "hasExchangeOnPrem", compareValue: "true", description: "Illustrates an architecture:* category signal for tenant topology complexity.", category: "architecture:hybrid_exchange", pillar: "architecture", severity: "medium", priority: 6, weight: 3 },
  { signalKey: "example:drift", label: "Drift — Config Baseline Deviation", ruleType: "equals", sourceKey: "hasConfigDrift", compareValue: "true", description: "Illustrates a drift:* category signal for configuration drift detection (future engine input).", category: "drift:config_baseline_deviation", pillar: "drift", severity: "medium", priority: 5, weight: 2 },
  { signalKey: "example:forecasting", label: "Forecasting — Growth Trend Positive", ruleType: "gte", sourceKey: "userGrowthRatePct", compareValue: "10", description: "Illustrates a forecasting:* category signal for tenant growth trend (future engine input).", category: "forecasting:growth_trend_positive", pillar: "forecasting", severity: "low", priority: 3, weight: 2 },
  { signalKey: "example:crm", label: "CRM — Strong Deal Fit", ruleType: "gte", sourceKey: "crmFitScore", compareValue: "80", description: "Illustrates a crm:* category signal contributing to CRM fit/pain/maturity scoring (future engine input).", category: "crm:strong_deal_fit", pillar: "crm", severity: "low", priority: 4, weight: 3 },
  { signalKey: "example:msp", label: "MSP — Multi-Tenant Managed", ruleType: "equals", sourceKey: "isMspManaged", compareValue: "true", description: "Illustrates an msp:* category signal for managed-service-provider relationships.", category: "msp:multi_tenant_managed", pillar: "msp", severity: "low", priority: 2, weight: 1 },
  { signalKey: "example:workflow", label: "Workflow — Automation Candidate", ruleType: "equals", sourceKey: "hasManualProcessOverhead", compareValue: "true", description: "Illustrates a workflow:* category signal flagging automation opportunities.", category: "workflow:automation_candidate", pillar: "workflow", severity: "low", priority: 3, weight: 2 },
];

async function seedCategoryTaxonomyExamples(): Promise<void> {
  try {
    const existing = await db.execute(sql`
      SELECT id FROM signal_derivation_rules WHERE signal_key LIKE 'example:%' LIMIT 1
    `);
    if ((existing.rows as unknown[]).length > 0) return;

    for (const ex of CATEGORY_TAXONOMY_EXAMPLES) {
      const groupResult = await db.execute(sql`
        INSERT INTO signal_rule_groups (signal_key, logic, label, sort_order, category, pillar, severity, priority, weight)
        VALUES (${ex.signalKey}, 'OR', ${ex.label}, 0, ${ex.category}, ${ex.pillar}, ${ex.severity}, ${ex.priority}, ${ex.weight})
        RETURNING id
      `);
      const groupId = (groupResult.rows[0] as { id: number }).id;
      await db.execute(sql`
        INSERT INTO signal_derivation_rules
          (signal_key, group_id, rule_type, source_key, compare_value, description, sort_order,
           category, pillar, severity, priority, weight)
        VALUES (
          ${ex.signalKey}, ${groupId}, ${ex.ruleType}, ${ex.sourceKey}, ${ex.compareValue}, ${ex.description}, 0,
          ${ex.category}, ${ex.pillar}, ${ex.severity}, ${ex.priority}, ${ex.weight}
        )
      `);
    }
    logger.info({ count: CATEGORY_TAXONOMY_EXAMPLES.length }, "admin-signal-rules: seeded illustrative category taxonomy examples");
  } catch (err) {
    logger.warn({ err }, "admin-signal-rules: category taxonomy example seeder failed (non-fatal)");
  }
}

void seedCategoryTaxonomyExamples();

// ── Custom signals DB helper ────────────────────────────────────────────────────

async function getCustomSignals(): Promise<Array<{ key: string; label: string; description: string; expectedImpact: string; isAdjustment: boolean }>> {
  const rows = await db.execute(sql`
    SELECT key, label, description, expected_impact AS "expectedImpact", is_adjustment AS "isAdjustment"
    FROM custom_signals ORDER BY created_at ASC
  `);
  return rows.rows as Array<{ key: string; label: string; description: string; expectedImpact: string; isAdjustment: boolean }>;
}

// ── GET /api/admin/custom-signals ──────────────────────────────────────────────

router.get("/admin/custom-signals", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const custom = await getCustomSignals();
    res.json(custom);
  } catch (err) {
    logger.error({ err }, "GET /admin/custom-signals failed");
    res.status(500).json({ error: "Failed to fetch custom signals" });
  }
});

// ── DELETE /api/admin/custom-signals/:key ──────────────────────────────────────

router.delete("/admin/custom-signals/:key", requireAdmin, async (req: Request, res: Response) => {
  try {
    const key = String(req.params.key);
    const allBuiltin = [...TENANT_SIGNALS, ...ADJUSTMENT_SIGNALS].map(s => s.key);
    if (allBuiltin.includes(key)) {
      res.status(403).json({ error: "Built-in signals cannot be deleted" });
      return;
    }
    const adminId = (req as unknown as { user?: { id: number } }).user?.id ?? null;

    await db.transaction(async (tx) => {
      await tx.execute(sql`DELETE FROM signal_derivation_rules WHERE signal_key = ${key}`);
      await tx.execute(sql`DELETE FROM signal_rule_groups WHERE signal_key = ${key}`);
      await tx.execute(sql`DELETE FROM custom_signals WHERE key = ${key}`);
      await tx.execute(sql`
        INSERT INTO signal_rule_audit_log (action, signal_key, rule_id, before, after, admin_user_id, note)
        VALUES ('delete_signal', ${key}, null, null, null, ${adminId}, ${`Deleted custom signal "${key}" and all its groups/rules`})
      `);
    });

    logger.info({ key }, "admin-signal-rules: custom signal deleted");
    res.json({ deleted: key });
  } catch (err) {
    logger.error({ err }, "DELETE /admin/custom-signals/:key failed");
    res.status(500).json({ error: "Failed to delete signal" });
  }
});

// ── POST /api/admin/custom-signals ─────────────────────────────────────────────

router.post("/admin/custom-signals", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { key, label, description, expectedImpact, isAdjustment } = (req.body ?? {}) as Record<string, unknown>;
    if (!key || !label) {
      res.status(400).json({ error: "key and label are required" });
      return;
    }
    const slug = String(key).trim().toLowerCase().replace(/[^a-z0-9:_-]/g, "-");
    const allBuiltin = [...TENANT_SIGNALS, ...ADJUSTMENT_SIGNALS].map(s => s.key);
    if (allBuiltin.includes(slug)) {
      res.status(409).json({ error: "A built-in signal with that key already exists" });
      return;
    }
    await db.execute(sql`
      INSERT INTO custom_signals (key, label, description, expected_impact, is_adjustment)
      VALUES (
        ${slug},
        ${String(label).trim()},
        ${String(description ?? "").trim()},
        ${String(expectedImpact ?? "").trim()},
        ${Boolean(isAdjustment)}
      )
      ON CONFLICT (key) DO UPDATE
        SET label = EXCLUDED.label,
            description = EXCLUDED.description,
            expected_impact = EXCLUDED.expected_impact,
            is_adjustment = EXCLUDED.is_adjustment
    `);
    await appendAuditLog({ action: "custom_signal_created", signalKey: slug });
    res.status(201).json({ key: slug });
  } catch (err) {
    logger.error({ err }, "POST /admin/custom-signals failed");
    res.status(500).json({ error: "Failed to create custom signal" });
  }
});

// ── GET /api/admin/signal-rules/adjustment-signals ───────────────────────────

router.get("/admin/signal-rules/adjustment-signals", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const custom = await getCustomSignals();
    const customAdj = custom
      .filter(c => c.isAdjustment)
      .map(c => ({ key: c.key, label: c.label, description: c.description, expectedImpact: c.expectedImpact, recommendedRules: [] }));
    const enabledMap = await getSignalEnabledMap();
    const all = [...ADJUSTMENT_SIGNALS, ...customAdj].map(s => ({ ...s, enabled: enabledMap[s.key] ?? true }));
    res.json(all);
  } catch (err) {
    logger.error({ err }, "GET /admin/signal-rules/adjustment-signals failed");
    res.status(500).json({ error: "Failed to fetch adjustment signals" });
  }
});

// ── GET /api/admin/signal-rules/enabled-state ─────────────────────────────────

router.get("/admin/signal-rules/enabled-state", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const map = await getSignalEnabledMap();
    res.json(map);
  } catch (err) {
    logger.error({ err }, "GET /admin/signal-rules/enabled-state failed");
    res.status(500).json({ error: "Failed to fetch signal enabled state" });
  }
});

// ── PATCH /api/admin/signal-rules/:signalKey/enabled ──────────────────────────

router.patch("/admin/signal-rules/:signalKey/enabled", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { signalKey } = req.params as { signalKey: string };
    if (!signalKey) { res.status(400).json({ error: "Missing signalKey" }); return; }
    const { enabled } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof enabled !== "boolean") {
      res.status(400).json({ error: "Body must include a boolean 'enabled' field" });
      return;
    }

    const priorResult = await db.execute(sql`
      SELECT signal_key AS "signalKey", enabled FROM signal_enabled_state WHERE signal_key = ${signalKey}
    `);
    const prior = (priorResult.rows[0] as { signalKey: string; enabled: boolean } | undefined) ?? { signalKey, enabled: true };

    await db.execute(sql`
      INSERT INTO signal_enabled_state (signal_key, enabled, updated_at)
      VALUES (${signalKey}, ${enabled}, now())
      ON CONFLICT (signal_key) DO UPDATE SET enabled = ${enabled}, updated_at = now()
    `);

    const adminId = (req as unknown as { user?: { id: number } }).user?.id ?? null;
    await appendAuditLog({
      action: enabled ? "signal_enabled" : "signal_disabled",
      signalKey,
      before: prior,
      after: { signalKey, enabled },
      adminUserId: adminId,
      note: `Signal "${signalKey}" ${enabled ? "enabled" : "disabled"} by admin`,
    });

    logger.info({ signalKey, enabled }, "admin-signal-rules: signal enabled state updated");
    res.json({ signalKey, enabled });
  } catch (err) {
    logger.error({ err }, "PATCH /admin/signal-rules/:signalKey/enabled failed");
    res.status(500).json({ error: "Failed to update signal enabled state" });
  }
});

// ── GET /api/admin/signal-rules ────────────────────────────────────────────────

router.get("/admin/signal-rules", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const [rules, groups, custom] = await Promise.all([getAllRules(), getAllGroups(), getCustomSignals()]);

    const bySignal: Record<string, { rules: SignalDerivationRule[]; groups: SignalRuleGroup[] }> = {};
    for (const sig of [...TENANT_SIGNALS, ...ADJUSTMENT_SIGNALS]) {
      bySignal[sig.key] = { rules: [], groups: [] };
    }
    for (const c of custom) {
      if (!bySignal[c.key]) bySignal[c.key] = { rules: [], groups: [] };
    }
    for (const r of rules) {
      if (!bySignal[r.signalKey]) bySignal[r.signalKey] = { rules: [], groups: [] };
      bySignal[r.signalKey].rules.push(r);
    }
    for (const g of groups) {
      if (!bySignal[g.signalKey]) bySignal[g.signalKey] = { rules: [], groups: [] };
      bySignal[g.signalKey].groups.push(g);
    }

    res.json({ bySignal, rules, groups });
  } catch (err) {
    logger.error({ err }, "GET /admin/signal-rules failed");
    res.status(500).json({ error: "Failed to fetch signal rules" });
  }
});

// ── POST /api/admin/signal-rules ───────────────────────────────────────────────

router.post("/admin/signal-rules", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { signalKey, groupId, ruleType, sourceKey, compareValue, description, sortOrder, ...intelligenceBody } =
      (req.body ?? {}) as Record<string, unknown>;
    if (!signalKey || !ruleType || !sourceKey) {
      res.status(400).json({ error: "signalKey, ruleType, sourceKey are required" });
      return;
    }
    const { values: intel, error: intelError } = parseIntelligenceFields(intelligenceBody);
    if (intelError) { res.status(400).json({ error: intelError }); return; }

    // Pre-check: simulate the post-insert rule list and detect conflicts before writing
    const existingRules = await getAllRules();
    const now = new Date();
    const proposedRule: SignalDerivationRule = {
      id: -1,
      signalKey: signalKey as string,
      groupId: groupId != null ? Number(groupId) : null,
      ruleType: ruleType as SignalDerivationRule["ruleType"],
      sourceKey: sourceKey as string,
      compareValue: (compareValue as string | null) ?? null,
      description: (description as string | null) ?? null,
      sortOrder: (sortOrder as number) ?? 0,
      createdAt: now,
      updatedAt: now,
      ...intel,
    } as SignalDerivationRule;
    const simulatedRules = [...existingRules, proposedRule];
    const conflicts = detectRuleConflicts(simulatedRules);
    const introducedConflicts = conflicts.filter(c => c.ruleIds.includes(-1));
    if (introducedConflicts.length > 0) {
      res.status(422).json({
        error: "This rule introduces a conflict with existing rules and was not saved.",
        conflicts: introducedConflicts.map(c => ({ ...c, ruleIds: c.ruleIds.filter(id => id !== -1) })),
      });
      return;
    }

    const result = await db.execute(sql`
      INSERT INTO signal_derivation_rules (
        signal_key, group_id, rule_type, source_key, compare_value, description, sort_order,
        priority, weight, pricing_impact, priority_score_contribution, pricing_value_contribution,
        governance_impact, security_impact, compliance_impact, adoption_impact, copilot_impact,
        architecture_impact, trend_value, trend_direction, decay_rate, ttl_days, confidence,
        severity, category, pillar, crm_fit_contribution, crm_pain_contribution,
        crm_maturity_contribution, crm_intent_contribution, crm_urgency_contribution
      )
      VALUES (
        ${signalKey as string}, ${groupId ?? null}, ${ruleType as string}, ${sourceKey as string},
        ${compareValue ?? null}, ${description ?? null}, ${(sortOrder as number) ?? 0},
        ${intel.priority}, ${intel.weight}, ${intel.pricingImpact}, ${intel.priorityScoreContribution}, ${intel.pricingValueContribution},
        ${intel.governanceImpact}, ${intel.securityImpact}, ${intel.complianceImpact}, ${intel.adoptionImpact}, ${intel.copilotImpact},
        ${intel.architectureImpact}, ${intel.trendValue}, ${intel.trendDirection}, ${intel.decayRate}, ${intel.ttlDays}, ${intel.confidence},
        ${intel.severity}, ${intel.category}, ${intel.pillar}, ${intel.crmFitContribution}, ${intel.crmPainContribution},
        ${intel.crmMaturityContribution}, ${intel.crmIntentContribution}, ${intel.crmUrgencyContribution}
      )
      RETURNING id, signal_key AS "signalKey", group_id AS "groupId", rule_type AS "ruleType",
                source_key AS "sourceKey", compare_value AS "compareValue", description,
                sort_order AS "sortOrder", created_at AS "createdAt", updated_at AS "updatedAt",
                ${INTELLIGENCE_FIELDS_SELECT}
    `);
    const created = result.rows[0] as unknown as SignalDerivationRule;
    const adminId = (req as unknown as { user?: { id: number } }).user?.id ?? null;
    await appendAuditLog({ action: "create", signalKey: signalKey as string, ruleId: created.id, after: created, adminUserId: adminId });
    res.status(201).json(created);
  } catch (err) {
    logger.error({ err }, "POST /admin/signal-rules failed");
    res.status(500).json({ error: "Failed to create rule" });
  }
});

// ── PATCH /api/admin/signal-rules/:id ─────────────────────────────────────────

router.patch("/admin/signal-rules/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const priorResult = await db.execute(sql`
      SELECT id, signal_key AS "signalKey", group_id AS "groupId", rule_type AS "ruleType",
             source_key AS "sourceKey", compare_value AS "compareValue", description,
             sort_order AS "sortOrder", created_at AS "createdAt", updated_at AS "updatedAt",
             ${INTELLIGENCE_FIELDS_SELECT}
      FROM signal_derivation_rules WHERE id = ${id}
    `);
    const prior = priorResult.rows[0] as unknown as SignalDerivationRule | undefined;
    if (!prior) { res.status(404).json({ error: "Not found" }); return; }

    const { groupId, ruleType, sourceKey, compareValue, description, sortOrder, ...intelligenceBody } =
      (req.body ?? {}) as Record<string, unknown>;

    const hasIntelligenceUpdate = Object.keys(intelligenceBody).length > 0;
    const { values: parsedIntel, error: intelError } = parseIntelligenceFields(intelligenceBody, prior as unknown as Record<string, number | string>);
    if (intelError) { res.status(400).json({ error: intelError }); return; }
    const intel = hasIntelligenceUpdate ? parsedIntel : (prior as unknown as Record<string, number | string>);

    const groupIdInt = groupId !== undefined
      ? (groupId === null || groupId === "" ? null : Number(groupId))
      : prior.groupId;
    const sortOrderInt = sortOrder !== undefined && sortOrder !== null
      ? Number(sortOrder)
      : null;

    // Pre-check: simulate the post-update rule list and detect conflicts before writing
    const existingRules = await getAllRules();
    const proposedRule: SignalDerivationRule = {
      ...prior,
      groupId: groupIdInt,
      ruleType: (ruleType as SignalDerivationRule["ruleType"]) ?? prior.ruleType,
      sourceKey: (sourceKey as string) ?? prior.sourceKey,
      compareValue: compareValue !== undefined ? (compareValue as string | null) ?? null : prior.compareValue,
      description: description !== undefined ? (description as string | null) ?? null : prior.description,
      sortOrder: sortOrderInt ?? prior.sortOrder,
      ...(hasIntelligenceUpdate ? intel : {}),
    };
    const simulatedRules = existingRules.map(r => r.id === id ? proposedRule : r);
    const conflicts = detectRuleConflicts(simulatedRules);
    const introducedConflicts = conflicts.filter(c => c.ruleIds.includes(id));
    if (introducedConflicts.length > 0) {
      res.status(422).json({
        error: "This change introduces a conflict with existing rules and was not saved.",
        conflicts: introducedConflicts,
      });
      return;
    }

    const result = await db.execute(sql`
      UPDATE signal_derivation_rules
      SET group_id = ${groupIdInt}::integer,
          rule_type = COALESCE(${ruleType ?? null}, rule_type),
          source_key = COALESCE(${sourceKey ?? null}, source_key),
          compare_value = ${compareValue !== undefined ? (compareValue ?? null) : prior.compareValue},
          description = ${description !== undefined ? (description ?? null) : prior.description},
          sort_order = COALESCE(${sortOrderInt}, sort_order),
          priority = ${intel.priority as number},
          weight = ${intel.weight as number},
          pricing_impact = ${intel.pricingImpact as number},
          priority_score_contribution = ${intel.priorityScoreContribution as number},
          pricing_value_contribution = ${intel.pricingValueContribution as number},
          governance_impact = ${intel.governanceImpact as number},
          security_impact = ${intel.securityImpact as number},
          compliance_impact = ${intel.complianceImpact as number},
          adoption_impact = ${intel.adoptionImpact as number},
          copilot_impact = ${intel.copilotImpact as number},
          architecture_impact = ${intel.architectureImpact as number},
          trend_value = ${intel.trendValue as number},
          trend_direction = ${intel.trendDirection as string},
          decay_rate = ${intel.decayRate as number},
          ttl_days = ${intel.ttlDays as number},
          confidence = ${intel.confidence as number},
          severity = ${intel.severity as string},
          category = ${intel.category as string},
          pillar = ${intel.pillar as string},
          crm_fit_contribution = ${intel.crmFitContribution as number},
          crm_pain_contribution = ${intel.crmPainContribution as number},
          crm_maturity_contribution = ${intel.crmMaturityContribution as number},
          crm_intent_contribution = ${intel.crmIntentContribution as number},
          crm_urgency_contribution = ${intel.crmUrgencyContribution as number},
          updated_at = now()
      WHERE id = ${id}
      RETURNING id, signal_key AS "signalKey", group_id AS "groupId", rule_type AS "ruleType",
                source_key AS "sourceKey", compare_value AS "compareValue", description,
                sort_order AS "sortOrder", created_at AS "createdAt", updated_at AS "updatedAt",
                ${INTELLIGENCE_FIELDS_SELECT}
    `);
    const updated = result.rows[0] as unknown as SignalDerivationRule;
    const adminId = (req as unknown as { user?: { id: number } }).user?.id ?? null;
    await appendAuditLog({ action: "update", signalKey: updated.signalKey, ruleId: id, before: prior, after: updated, adminUserId: adminId });
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "PATCH /admin/signal-rules/:id failed");
    res.status(500).json({ error: "Failed to update rule" });
  }
});

// ── DELETE /api/admin/signal-rules/:id ────────────────────────────────────────

router.delete("/admin/signal-rules/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const priorResult = await db.execute(sql`
      SELECT id, signal_key AS "signalKey", group_id AS "groupId", rule_type AS "ruleType",
             source_key AS "sourceKey", compare_value AS "compareValue", description,
             sort_order AS "sortOrder", created_at AS "createdAt", updated_at AS "updatedAt"
      FROM signal_derivation_rules WHERE id = ${id}
    `);
    const prior = priorResult.rows[0] as unknown as SignalDerivationRule | undefined;
    if (!prior) { res.status(404).json({ error: "Not found" }); return; }
    await db.execute(sql`DELETE FROM signal_derivation_rules WHERE id = ${id}`);
    const adminId = (req as unknown as { user?: { id: number } }).user?.id ?? null;
    await appendAuditLog({ action: "delete", signalKey: prior.signalKey, ruleId: id, before: prior, adminUserId: adminId });
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "DELETE /admin/signal-rules/:id failed");
    res.status(500).json({ error: "Failed to delete rule" });
  }
});

// ── POST /api/admin/signal-rule-groups ────────────────────────────────────────

router.post("/admin/signal-rule-groups", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { signalKey, logic, label, sortOrder, ...intelligenceBody } = (req.body ?? {}) as Record<string, unknown>;
    if (!signalKey || !logic) { res.status(400).json({ error: "signalKey and logic are required" }); return; }
    const { values: intel, error: intelError } = parseIntelligenceFields(intelligenceBody);
    if (intelError) { res.status(400).json({ error: intelError }); return; }
    const result = await db.execute(sql`
      INSERT INTO signal_rule_groups (
        signal_key, logic, label, sort_order,
        priority, weight, pricing_impact, priority_score_contribution, pricing_value_contribution,
        governance_impact, security_impact, compliance_impact, adoption_impact, copilot_impact,
        architecture_impact, trend_value, trend_direction, decay_rate, ttl_days, confidence,
        severity, category, pillar, crm_fit_contribution, crm_pain_contribution,
        crm_maturity_contribution, crm_intent_contribution, crm_urgency_contribution
      )
      VALUES (
        ${signalKey as string}, ${logic as string}, ${label ?? null}, ${(sortOrder as number) ?? 0},
        ${intel.priority}, ${intel.weight}, ${intel.pricingImpact}, ${intel.priorityScoreContribution}, ${intel.pricingValueContribution},
        ${intel.governanceImpact}, ${intel.securityImpact}, ${intel.complianceImpact}, ${intel.adoptionImpact}, ${intel.copilotImpact},
        ${intel.architectureImpact}, ${intel.trendValue}, ${intel.trendDirection}, ${intel.decayRate}, ${intel.ttlDays}, ${intel.confidence},
        ${intel.severity}, ${intel.category}, ${intel.pillar}, ${intel.crmFitContribution}, ${intel.crmPainContribution},
        ${intel.crmMaturityContribution}, ${intel.crmIntentContribution}, ${intel.crmUrgencyContribution}
      )
      RETURNING id, signal_key AS "signalKey", logic, label, sort_order AS "sortOrder", created_at AS "createdAt",
                ${INTELLIGENCE_FIELDS_SELECT}
    `);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    logger.error({ err }, "POST /admin/signal-rule-groups failed");
    res.status(500).json({ error: "Failed to create group" });
  }
});

// ── PATCH /api/admin/signal-rule-groups/:id ───────────────────────────────────

router.patch("/admin/signal-rule-groups/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const priorResult = await db.execute(sql`
      SELECT id, signal_key AS "signalKey", logic, label, sort_order AS "sortOrder", created_at AS "createdAt",
             ${INTELLIGENCE_FIELDS_SELECT}
      FROM signal_rule_groups WHERE id = ${id}
    `);
    const prior = priorResult.rows[0] as unknown as (SignalRuleGroup & Record<string, number | string>) | undefined;
    if (!prior) { res.status(404).json({ error: "Not found" }); return; }
    const { logic, label, sortOrder, ...intelligenceBody } = (req.body ?? {}) as Record<string, unknown>;
    const hasIntelligenceUpdate = Object.keys(intelligenceBody).length > 0;
    const { values: intel, error: intelError } = parseIntelligenceFields(intelligenceBody, prior as unknown as Record<string, number | string>);
    if (intelError) { res.status(400).json({ error: intelError }); return; }
    const result = hasIntelligenceUpdate
      ? await db.execute(sql`
        UPDATE signal_rule_groups
        SET logic = COALESCE(${logic ?? null}, logic),
            label = ${label !== undefined ? (label ?? null) : sql`label`},
            sort_order = COALESCE(${sortOrder ?? null}, sort_order),
            priority = ${intel.priority}, weight = ${intel.weight},
            pricing_impact = ${intel.pricingImpact},
            priority_score_contribution = ${intel.priorityScoreContribution},
            pricing_value_contribution = ${intel.pricingValueContribution},
            governance_impact = ${intel.governanceImpact}, security_impact = ${intel.securityImpact},
            compliance_impact = ${intel.complianceImpact}, adoption_impact = ${intel.adoptionImpact},
            copilot_impact = ${intel.copilotImpact}, architecture_impact = ${intel.architectureImpact},
            trend_value = ${intel.trendValue}, trend_direction = ${intel.trendDirection},
            decay_rate = ${intel.decayRate}, ttl_days = ${intel.ttlDays}, confidence = ${intel.confidence},
            severity = ${intel.severity}, category = ${intel.category}, pillar = ${intel.pillar},
            crm_fit_contribution = ${intel.crmFitContribution}, crm_pain_contribution = ${intel.crmPainContribution},
            crm_maturity_contribution = ${intel.crmMaturityContribution},
            crm_intent_contribution = ${intel.crmIntentContribution},
            crm_urgency_contribution = ${intel.crmUrgencyContribution}
        WHERE id = ${id}
        RETURNING id, signal_key AS "signalKey", logic, label, sort_order AS "sortOrder", created_at AS "createdAt",
                  ${INTELLIGENCE_FIELDS_SELECT}
      `)
      : await db.execute(sql`
        UPDATE signal_rule_groups
        SET logic = COALESCE(${logic ?? null}, logic),
            label = ${label !== undefined ? (label ?? null) : sql`label`},
            sort_order = COALESCE(${sortOrder ?? null}, sort_order)
        WHERE id = ${id}
        RETURNING id, signal_key AS "signalKey", logic, label, sort_order AS "sortOrder", created_at AS "createdAt",
                  ${INTELLIGENCE_FIELDS_SELECT}
      `);
    if (result.rows.length === 0) { res.status(404).json({ error: "Not found" }); return; }
    res.json(result.rows[0]);
  } catch (err) {
    logger.error({ err }, "PATCH /admin/signal-rule-groups/:id failed");
    res.status(500).json({ error: "Failed to update group" });
  }
});

// ── DELETE /api/admin/signal-rule-groups/:id ──────────────────────────────────

router.delete("/admin/signal-rule-groups/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    await db.execute(sql`UPDATE signal_derivation_rules SET group_id = NULL WHERE group_id = ${id}`);
    await db.execute(sql`DELETE FROM signal_rule_groups WHERE id = ${id}`);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "DELETE /admin/signal-rule-groups/:id failed");
    res.status(500).json({ error: "Failed to delete group" });
  }
});

// ── POST /api/admin/signal-rules/evaluate ─────────────────────────────────────

router.post("/admin/signal-rules/evaluate", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { profileUpdates, parsedFindings } = (req.body ?? {}) as Record<string, unknown>;
    const mergedProfile = (profileUpdates as Record<string, unknown>) ?? {};
    const findings = Array.isArray(parsedFindings) ? (parsedFindings as string[]) : [];

    const [rules, groups, disabledKeys] = await Promise.all([getAllRules(), getAllGroups(), getDisabledSignalKeys()]);
    const { firedSignals, trace } = computeTenantSignals(mergedProfile, findings, rules, groups, disabledKeys);

    const signalMeta = new Map(TENANT_SIGNALS.map(s => [s.key, s]));
    const firedArr = [...firedSignals].map(key => {
      const meta = signalMeta.get(key);
      return { key, label: meta?.label ?? key, expectedImpact: meta?.expectedImpact ?? "" };
    });

    res.json({ firedSignals: firedArr, ruleTrace: trace });
  } catch (err) {
    logger.error({ err }, "POST /admin/signal-rules/evaluate failed");
    res.status(500).json({ error: "Evaluation failed" });
  }
});

// ── POST /api/admin/signal-rules/preview-projects ─────────────────────────────

router.post("/admin/signal-rules/preview-projects", requireAdmin, async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    let firedSignalKeys: string[];
    let firedArr: Array<{ key: string; label: string; expectedImpact: string }> = [];

    if (Array.isArray(body.firedSignals)) {
      firedSignalKeys = body.firedSignals as string[];
      const signalMeta = new Map(TENANT_SIGNALS.map(s => [s.key, s]));
      firedArr = firedSignalKeys.map(key => {
        const meta = signalMeta.get(key);
        return { key, label: meta?.label ?? key, expectedImpact: meta?.expectedImpact ?? "" };
      });
    } else {
      const mergedProfile = (body.profileUpdates as Record<string, unknown>) ?? {};
      const findings = Array.isArray(body.parsedFindings) ? (body.parsedFindings as string[]) : [];
      const [rules, groups, disabledKeys] = await Promise.all([getAllRules(), getAllGroups(), getDisabledSignalKeys()]);
      const { firedSignals, trace: _trace } = computeTenantSignals(mergedProfile, findings, rules, groups, disabledKeys);
      firedSignalKeys = [...firedSignals];
      const signalMeta = new Map(TENANT_SIGNALS.map(s => [s.key, s]));
      firedArr = firedSignalKeys.map(key => {
        const meta = signalMeta.get(key);
        return { key, label: meta?.label ?? key, expectedImpact: meta?.expectedImpact ?? "" };
      });
    }

    const allProjects = await db.execute(sql`
      SELECT id, title, price_range AS "priceRange", description, triggered_by AS "triggeredBy",
             sow_items AS "sowItems", pages, sort_order AS "sortOrder", is_visible AS "isVisible",
             meaning, created_at AS "createdAt", updated_at AS "updatedAt"
      FROM engagement_projects WHERE is_visible = true ORDER BY sort_order
    `);

    const knownSignalKeys = new Set(TENANT_SIGNALS.map(s => s.key));
    const firedSet = new Set(firedSignalKeys);
    const included: unknown[] = [];
    const excluded: Array<{ project: unknown; reason: string }> = [];

    for (const p of allProjects.rows as Array<{ id: number; title: string; triggeredBy: string[] }>) {
      const { included: inc, reason } = projectMatchesSignals(p, knownSignalKeys, firedSet);
      if (inc) {
        included.push(p);
      } else {
        excluded.push({ project: p, reason: reason ?? "Not matched" });
      }
    }

    res.json({ firedSignals: firedArr, included, excluded });
  } catch (err) {
    logger.error({ err }, "POST /admin/signal-rules/preview-projects failed");
    res.status(500).json({ error: "Preview failed" });
  }
});

// ── GET /api/admin/signal-rules/conflicts ─────────────────────────────────────

router.get("/admin/signal-rules/conflicts", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const rules = await getAllRules();
    const conflicts = detectRuleConflicts(rules);
    res.json({ conflicts, count: conflicts.length });
  } catch (err) {
    logger.error({ err }, "GET /admin/signal-rules/conflicts failed");
    res.status(500).json({ error: "Conflict detection failed" });
  }
});

// ── GET /api/admin/signal-rules/health ────────────────────────────────────────

router.get("/admin/signal-rules/health", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const [rules, groups, disabledKeys] = await Promise.all([getAllRules(), getAllGroups(), getDisabledSignalKeys()]);

    const clientsResult = await db.execute(sql`
      SELECT DISTINCT c.id AS client_id,
             COALESCE(srr.profile_updates, '{}') AS profile_updates,
             COALESCE(f.findings, '[]') AS findings
      FROM users c
      LEFT JOIN LATERAL (
        SELECT jsonb_object_agg(key, value) AS profile_updates
        FROM (
          SELECT (jsonb_each(profile_updates)).key, (jsonb_each(profile_updates)).value
          FROM script_run_results WHERE customer_id = c.id AND status = 'completed'
        ) kv
      ) srr ON true
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(DISTINCT f) AS findings
        FROM (
          SELECT jsonb_array_elements_text(parsed_findings) AS f
          FROM script_run_results WHERE customer_id = c.id AND status = 'completed'
        ) sub
      ) f ON true
      WHERE c.role = 'client'
    `);

    const totalClients = clientsResult.rows.length;
    const signalCounts: Record<string, number> = {};
    for (const sig of TENANT_SIGNALS) signalCounts[sig.key] = 0;

    for (const row of clientsResult.rows as Array<{ profile_updates: Record<string, unknown>; findings: string[] }>) {
      const profile = row.profile_updates ?? {};
      const findings = Array.isArray(row.findings) ? row.findings : [];
      const { firedSignals } = computeTenantSignals(profile, findings, rules, groups, disabledKeys);
      for (const key of firedSignals) {
        signalCounts[key] = (signalCounts[key] ?? 0) + 1;
      }
    }

    const health: Record<string, { clientCount: number; totalClients: number }> = {};
    for (const [key, count] of Object.entries(signalCounts)) {
      health[key] = { clientCount: count, totalClients };
    }

    res.json(health);
  } catch (err) {
    logger.error({ err }, "GET /admin/signal-rules/health failed");
    res.status(500).json({ error: "Health check failed" });
  }
});

// ── GET /api/admin/signal-rules/script-fields ─────────────────────────────────

router.get("/admin/signal-rules/script-fields", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const result = await db.execute(sql`
      SELECT profile_updates, COUNT(*)::int AS run_count
      FROM script_run_results
      WHERE profile_updates IS NOT NULL AND status = 'completed'
      GROUP BY profile_updates
      LIMIT 500
    `);

    const keyStats = new Map<string, { type: string; examples: unknown[]; runCount: number }>();

    for (const row of result.rows as Array<{ profile_updates: Record<string, unknown>; run_count: number }>) {
      const pu = row.profile_updates;
      if (!pu || typeof pu !== "object") continue;
      for (const [k, v] of Object.entries(pu)) {
        const existing = keyStats.get(k);
        const inferredType = v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
        if (!existing) {
          keyStats.set(k, { type: inferredType, examples: [v], runCount: row.run_count });
        } else {
          if (existing.examples.length < 3 && !existing.examples.includes(v)) {
            existing.examples.push(v);
          }
          existing.runCount += row.run_count;
        }
      }
    }

    const fields = [...keyStats.entries()].map(([key, stats]) => ({
      key,
      type: stats.type,
      examples: stats.examples,
      seenInNRuns: stats.runCount,
    })).sort((a, b) => b.seenInNRuns - a.seenInNRuns);

    res.json(fields);
  } catch (err) {
    logger.error({ err }, "GET /admin/signal-rules/script-fields failed");
    res.status(500).json({ error: "Failed to fetch script fields" });
  }
});

// ── GET /api/admin/signal-rules/audit-log ─────────────────────────────────────

router.get("/admin/signal-rules/audit-log", requireAdmin, async (req: Request, res: Response) => {
  try {
    const signalKey = req.query.signalKey as string | undefined;
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const offset = Number(req.query.offset ?? 0);

    const [countResult, rowResult] = signalKey
      ? await Promise.all([
          db.execute(sql`SELECT COUNT(*)::int AS total FROM signal_rule_audit_log WHERE signal_key = ${signalKey}`),
          db.execute(sql`
            SELECT id, action, signal_key AS "signalKey", rule_id AS "ruleId",
                   before, after, admin_user_id AS "adminUserId", note, created_at AS "createdAt"
            FROM signal_rule_audit_log
            WHERE signal_key = ${signalKey}
            ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}
          `),
        ])
      : await Promise.all([
          db.execute(sql`SELECT COUNT(*)::int AS total FROM signal_rule_audit_log`),
          db.execute(sql`
            SELECT id, action, signal_key AS "signalKey", rule_id AS "ruleId",
                   before, after, admin_user_id AS "adminUserId", note, created_at AS "createdAt"
            FROM signal_rule_audit_log
            ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}
          `),
        ]);

    res.json({
      rows: rowResult.rows,
      total: (countResult.rows[0] as { total: number }).total,
      limit,
      offset,
    });
  } catch (err) {
    logger.error({ err }, "GET /admin/signal-rules/audit-log failed");
    res.status(500).json({ error: "Failed to fetch audit log" });
  }
});

// ── POST /api/admin/signal-rules/import ───────────────────────────────────────

router.post("/admin/signal-rules/import", requireAdmin, async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const importedRules = body.rules;
    const importedGroups = body.groups;
    const projectAssociations = body.projectAssociations as Record<string, number[]> | undefined;
    if (!Array.isArray(importedRules)) {
      res.status(400).json({ error: "Body must contain a 'rules' array" }); return;
    }

    const adminId = (req as unknown as { user?: { id: number } }).user?.id ?? null;

    // Capture backup BEFORE the transaction so it is always committed even if the
    // import transaction rolls back.
    const snapshotId = await saveSnapshot("Pre-import backup", adminId);

    let ruleCount = 0;
    let groupCount = 0;
    let projectLinkCount = 0;

    await db.transaction(async (tx) => {
      await tx.execute(sql`DELETE FROM signal_derivation_rules`);
      await tx.execute(sql`DELETE FROM signal_rule_groups`);

      const groupIdMap = new Map<number, number>();

      if (Array.isArray(importedGroups)) {
        for (const g of importedGroups as Array<Record<string, unknown>>) {
          const { values: gIntel } = parseIntelligenceFields(g);
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
              ${g.signalKey ?? g.signal_key as string}, ${(g.logic ?? "OR") as string},
              ${g.label ?? null}, ${(g.sortOrder ?? g.sort_order ?? 0) as number},
              ${gIntel.priority}, ${gIntel.weight}, ${gIntel.pricingImpact}, ${gIntel.priorityScoreContribution}, ${gIntel.pricingValueContribution},
              ${gIntel.governanceImpact}, ${gIntel.securityImpact}, ${gIntel.complianceImpact}, ${gIntel.adoptionImpact}, ${gIntel.copilotImpact},
              ${gIntel.architectureImpact}, ${gIntel.trendValue}, ${gIntel.trendDirection}, ${gIntel.decayRate}, ${gIntel.ttlDays}, ${gIntel.confidence},
              ${gIntel.severity}, ${gIntel.category}, ${gIntel.pillar}, ${gIntel.crmFitContribution}, ${gIntel.crmPainContribution},
              ${gIntel.crmMaturityContribution}, ${gIntel.crmIntentContribution}, ${gIntel.crmUrgencyContribution}
            )
            RETURNING id
          `);
          const newId = (result.rows[0] as { id: number }).id;
          if (g.id) groupIdMap.set(Number(g.id), newId);
          groupCount++;
        }
      }

      for (const r of importedRules as Array<Record<string, unknown>>) {
        const originalGroupId = r.groupId ?? r.group_id;
        const mappedGroupId = originalGroupId ? (groupIdMap.get(Number(originalGroupId)) ?? null) : null;
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
            ${r.signalKey ?? r.signal_key as string}, ${mappedGroupId},
            ${r.ruleType ?? r.rule_type as string}, ${r.sourceKey ?? r.source_key as string},
            ${r.compareValue ?? r.compare_value ?? null},
            ${r.description ?? null}, ${(r.sortOrder ?? r.sort_order ?? 0) as number},
            ${rIntel.priority}, ${rIntel.weight}, ${rIntel.pricingImpact}, ${rIntel.priorityScoreContribution}, ${rIntel.pricingValueContribution},
            ${rIntel.governanceImpact}, ${rIntel.securityImpact}, ${rIntel.complianceImpact}, ${rIntel.adoptionImpact}, ${rIntel.copilotImpact},
            ${rIntel.architectureImpact}, ${rIntel.trendValue}, ${rIntel.trendDirection}, ${rIntel.decayRate}, ${rIntel.ttlDays}, ${rIntel.confidence},
            ${rIntel.severity}, ${rIntel.category}, ${rIntel.pillar}, ${rIntel.crmFitContribution}, ${rIntel.crmPainContribution},
            ${rIntel.crmMaturityContribution}, ${rIntel.crmIntentContribution}, ${rIntel.crmUrgencyContribution}
          )
        `);
        ruleCount++;
      }

      // Reconcile engagement-project ↔ signal associations (engagement_projects.triggered_by)
      // for every signal key present in the export, so importing a bundle restores which
      // projects are linked to each signal, not just the rule logic.
      if (projectAssociations && typeof projectAssociations === "object") {
        const signalKeysInExport = new Set(Object.keys(projectAssociations));
        const allProjects = await tx.execute(sql`
          SELECT id, triggered_by AS "triggeredBy" FROM engagement_projects
        `);
        for (const proj of allProjects.rows as Array<{ id: number; triggeredBy: string[] | null }>) {
          const current = new Set(proj.triggeredBy ?? []);
          let changed = false;
          for (const signalKey of signalKeysInExport) {
            const shouldHave = (projectAssociations[signalKey] ?? []).includes(proj.id);
            const has = current.has(signalKey);
            if (shouldHave && !has) { current.add(signalKey); changed = true; }
            else if (!shouldHave && has) { current.delete(signalKey); changed = true; }
          }
          if (changed) {
            const updated = Array.from(current);
            await tx.execute(sql`
              UPDATE engagement_projects SET triggered_by = ${updated} WHERE id = ${proj.id}
            `);
            projectLinkCount++;
          }
        }
      }

      await tx.execute(sql`
        INSERT INTO signal_rule_audit_log (action, signal_key, rule_id, before, after, admin_user_id, note)
        VALUES ('import', null, null, null, null, ${adminId},
                ${`Imported ${ruleCount} rules across ${groupCount} groups (${projectLinkCount} project link(s) updated). Pre-import snapshot saved as ID ${snapshotId}.`})
      `);
    });

    res.json({ imported: ruleCount, snapshotId, projectLinksUpdated: projectLinkCount });
  } catch (err) {
    logger.error({ err }, "POST /admin/signal-rules/import failed");
    res.status(500).json({ error: "Import failed" });
  }
});

// ── POST /api/admin/signal-rules/:signalKey/import ────────────────────────────
// Replaces all rules (and orphaned groups) for one signal key only.
// Accepts a flat array of rule objects — the format exported per-signal from the UI.

router.post("/admin/signal-rules/:signalKey/import", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { signalKey } = req.params as { signalKey: string };
    if (!signalKey) { res.status(400).json({ error: "Missing signalKey" }); return; }

    const body = (req.body ?? {}) as Record<string, unknown>;

    // Accept either a flat array OR `{ rules: [...] }` wrapper
    let rawRules: unknown[];
    if (Array.isArray(body)) {
      rawRules = body;
    } else if (Array.isArray(body.rules)) {
      rawRules = body.rules as unknown[];
    } else {
      res.status(400).json({ error: "Body must be a rules array or { rules: [...] }" }); return;
    }

    const importedRules = rawRules as Array<Record<string, unknown>>;

    // Validate — all rules must belong to this signal (or have no key specified)
    const mismatch = importedRules.find(r => {
      const rk = r.signalKey ?? r.signal_key;
      return rk !== undefined && rk !== signalKey;
    });
    if (mismatch) {
      res.status(400).json({
        error: `signalKey mismatch: expected "${signalKey}", got "${mismatch.signalKey ?? mismatch.signal_key}"`,
      }); return;
    }

    const adminId = (req as unknown as { user?: { id: number } }).user?.id ?? null;

    await db.transaction(async (tx) => {
      // Remove existing rules for this signal
      await tx.execute(sql`DELETE FROM signal_derivation_rules WHERE signal_key = ${signalKey}`);
      // Remove orphaned groups (no remaining rules reference them) for this signal
      await tx.execute(sql`
        DELETE FROM signal_rule_groups
        WHERE signal_key = ${signalKey}
          AND id NOT IN (SELECT COALESCE(group_id, -1) FROM signal_derivation_rules WHERE group_id IS NOT NULL)
      `);

      // Insert new rules — groupId from JSON is ignored (flat import, no group re-creation)
      for (let i = 0; i < importedRules.length; i++) {
        const r = importedRules[i]!;
        await tx.execute(sql`
          INSERT INTO signal_derivation_rules
            (signal_key, group_id, rule_type, source_key, compare_value, description, sort_order)
          VALUES (
            ${signalKey}, null,
            ${(r.ruleType ?? r.rule_type) as string},
            ${(r.sourceKey ?? r.source_key) as string},
            ${(r.compareValue ?? r.compare_value ?? null) as string | null},
            ${(r.description ?? null) as string | null},
            ${((r.sortOrder ?? r.sort_order ?? i) as number)}
          )
        `);
      }

      await tx.execute(sql`
        INSERT INTO signal_rule_audit_log (action, signal_key, rule_id, before, after, admin_user_id, note)
        VALUES ('import', ${signalKey}, null, null, null, ${adminId},
                ${`Per-signal import: replaced rules for ${signalKey} with ${importedRules.length} rule(s).`})
      `);
    });

    logger.info({ signalKey, count: importedRules.length }, "admin-signal-rules: per-signal import complete");
    res.json({ imported: importedRules.length, signalKey });
  } catch (err) {
    logger.error({ err }, "POST /admin/signal-rules/:signalKey/import failed");
    res.status(500).json({ error: "Import failed" });
  }
});

// ── POST /api/admin/signal-rules/import-bundle ────────────────────────────────
// Imports a { group, rules } bundle atomically.
// Creates the group on group.signalKey, then inserts all rules for that same
// signal and assigns them to the new group.  Each rule's own "signalKey" field
// in the JSON is treated as a descriptive sub-key reference and is NOT used as
// the DB signal_key — all rules land on group.signalKey.

router.post("/admin/signal-rules/import-bundle", requireAdmin, async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const grp = body.group as Record<string, unknown> | undefined;
    const rawRules = body.rules as unknown[] | undefined;

    if (!grp || typeof grp.signalKey !== "string" || !Array.isArray(rawRules)) {
      res.status(400).json({ error: 'Body must be { group: { signalKey, logic, label }, rules: [...] }' });
      return;
    }

    const signalKey = grp.signalKey.trim();
    if (!signalKey) { res.status(400).json({ error: "group.signalKey is required" }); return; }

    const logic = (grp.logic as string | undefined) ?? "OR";
    const label = (grp.label as string | undefined) ?? null;
    const groupSortOrder = (grp.sortOrder as number | undefined) ?? 0;
    const adminId = (req as unknown as { user?: { id: number } }).user?.id ?? null;

    const rules = rawRules as Array<Record<string, unknown>>;

    let newGroupId!: number;
    let imported = 0;

    // Derive a human-readable label for the signal itself from the group label
    // (strip the group-specific suffix heuristic: take up to the first comma/dash)
    const signalLabel = label
      ? label.replace(/\s+(Conditions?|Rules?|Signals?|Factors?|Group)$/i, "").trim() || label
      : signalKey.replace(/^adj:/, "").replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    const isAdj = signalKey.startsWith("adj:");

    await db.transaction(async (tx) => {
      // Auto-register in custom_signals if not already known (hardcoded signals
      // don't live in this table so the insert is always safe to attempt).
      await tx.execute(sql`
        INSERT INTO custom_signals (key, label, description, expected_impact, is_adjustment)
        VALUES (
          ${signalKey},
          ${signalLabel},
          ${(grp.description as string | undefined) ?? ""},
          ${(grp.expectedImpact as string | undefined) ?? ""},
          ${isAdj}
        )
        ON CONFLICT (key) DO NOTHING
      `);

      const grpRes = await tx.execute(sql`
        INSERT INTO signal_rule_groups (signal_key, logic, label, sort_order)
        VALUES (${signalKey}, ${logic}, ${label}, ${groupSortOrder})
        RETURNING id
      `);
      newGroupId = ((grpRes.rows as Array<{ id: number }>)[0]!).id;

      for (let i = 0; i < rules.length; i++) {
        const r = rules[i]!;
        await tx.execute(sql`
          INSERT INTO signal_derivation_rules
            (signal_key, group_id, rule_type, source_key, compare_value, description, sort_order)
          VALUES (
            ${signalKey},
            ${newGroupId},
            ${(r.ruleType ?? r.rule_type) as string},
            ${(r.sourceKey ?? r.source_key) as string},
            ${(r.compareValue ?? r.compare_value ?? null) as string | null},
            ${(r.description ?? null) as string | null},
            ${((r.sortOrder ?? r.sort_order ?? i) as number)}
          )
        `);
        imported++;
      }

      await tx.execute(sql`
        INSERT INTO signal_rule_audit_log (action, signal_key, rule_id, before, after, admin_user_id, note)
        VALUES (
          'import_bundle', ${signalKey}, null, null,
          ${JSON.stringify({ groupId: newGroupId, ruleCount: imported })}::jsonb,
          ${adminId},
          ${`Bundle import: created group "${label ?? "unnamed"}" with ${imported} rule(s) for ${signalKey}`}
        )
      `);
    });

    logger.info({ signalKey, groupId: newGroupId, imported }, "admin-signal-rules: bundle import complete");
    res.json({ signalKey, groupId: newGroupId, imported });
  } catch (err) {
    logger.error({ err }, "POST /admin/signal-rules/import-bundle failed");
    res.status(500).json({ error: "Bundle import failed" });
  }
});

// ── GET /api/admin/signal-rules/versions ──────────────────────────────────────

router.get("/admin/signal-rules/versions", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const result = await db.execute(sql`
      SELECT id, name, rule_count AS "ruleCount", created_by_admin_id AS "createdByAdminId", created_at AS "createdAt"
      FROM signal_rule_versions ORDER BY created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    logger.error({ err }, "GET /admin/signal-rules/versions failed");
    res.status(500).json({ error: "Failed to fetch versions" });
  }
});

// ── POST /api/admin/signal-rules/versions ─────────────────────────────────────

router.post("/admin/signal-rules/versions", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { name } = (req.body ?? {}) as Record<string, unknown>;
    if (!name || typeof name !== "string") {
      res.status(400).json({ error: "name is required" }); return;
    }
    const adminId = (req as unknown as { user?: { id: number } }).user?.id ?? null;
    const id = await saveSnapshot(name.trim(), adminId);
    res.status(201).json({ id });
  } catch (err) {
    logger.error({ err }, "POST /admin/signal-rules/versions failed");
    res.status(500).json({ error: "Failed to save snapshot" });
  }
});

// ── POST /api/admin/signal-rules/versions/:id/restore ────────────────────────

router.post("/admin/signal-rules/versions/:id/restore", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const versionResult = await db.execute(sql`
      SELECT snapshot FROM signal_rule_versions WHERE id = ${id}
    `);
    if (versionResult.rows.length === 0) { res.status(404).json({ error: "Version not found" }); return; }

    const snapshot = (versionResult.rows[0] as { snapshot: { rules: unknown[]; groups: unknown[] } }).snapshot;
    const adminId = (req as unknown as { user?: { id: number } }).user?.id ?? null;

    // Capture backup BEFORE the transaction so it is always committed even if the
    // restore transaction rolls back.
    const backupId = await saveSnapshot("Pre-restore backup", adminId);

    let ruleCount = 0;

    await db.transaction(async (tx) => {
      await tx.execute(sql`DELETE FROM signal_derivation_rules`);
      await tx.execute(sql`DELETE FROM signal_rule_groups`);

      const groupIdMap = new Map<number, number>();
      if (Array.isArray(snapshot.groups)) {
        for (const g of snapshot.groups as Array<Record<string, unknown>>) {
          const result = await tx.execute(sql`
            INSERT INTO signal_rule_groups (signal_key, logic, label, sort_order)
            VALUES (${g.signalKey as string}, ${(g.logic ?? "OR") as string}, ${g.label ?? null}, ${(g.sortOrder ?? 0) as number})
            RETURNING id
          `);
          const newId = (result.rows[0] as { id: number }).id;
          if (g.id) groupIdMap.set(Number(g.id), newId);
        }
      }

      if (Array.isArray(snapshot.rules)) {
        for (const r of snapshot.rules as Array<Record<string, unknown>>) {
          const originalGroupId = r.groupId;
          const mappedGroupId = originalGroupId ? (groupIdMap.get(Number(originalGroupId)) ?? null) : null;
          await tx.execute(sql`
            INSERT INTO signal_derivation_rules (signal_key, group_id, rule_type, source_key, compare_value, description, sort_order)
            VALUES (${r.signalKey as string}, ${mappedGroupId}, ${r.ruleType as string}, ${r.sourceKey as string},
                    ${r.compareValue ?? null}, ${r.description ?? null}, ${(r.sortOrder ?? 0) as number})
          `);
          ruleCount++;
        }
      }

      await tx.execute(sql`
        INSERT INTO signal_rule_audit_log (action, signal_key, rule_id, before, after, admin_user_id, note)
        VALUES ('restore_version', null, null, null, null, ${adminId},
                ${`Restored version ID ${id}. Pre-restore backup saved as snapshot ID ${backupId}.`})
      `);
    });

    res.json({ restored: ruleCount, backupSnapshotId: backupId });
  } catch (err) {
    logger.error({ err }, "POST /admin/signal-rules/versions/:id/restore failed");
    res.status(500).json({ error: "Restore failed" });
  }
});

// ── GET /api/admin/signal-rules/simulation-profiles ──────────────────────────

router.get("/admin/signal-rules/simulation-profiles", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const result = await db.execute(sql`
      SELECT id, name, description, profile_updates AS "profileUpdates", parsed_findings AS "parsedFindings",
             tags, last_run_at AS "lastRunAt", last_run_result AS "lastRunResult",
             last_run_project_diff AS "lastRunProjectDiff",
             created_at AS "createdAt", updated_at AS "updatedAt"
      FROM signal_simulation_profiles ORDER BY updated_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    logger.error({ err }, "GET /admin/signal-rules/simulation-profiles failed");
    res.status(500).json({ error: "Failed to fetch simulation profiles" });
  }
});

// ── POST /api/admin/signal-rules/simulation-profiles ─────────────────────────

router.post("/admin/signal-rules/simulation-profiles", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { name, description, profileUpdates, parsedFindings, tags } = (req.body ?? {}) as Record<string, unknown>;
    if (!name || typeof name !== "string") { res.status(400).json({ error: "name is required" }); return; }
    const result = await db.execute(sql`
      INSERT INTO signal_simulation_profiles (name, description, profile_updates, parsed_findings, tags)
      VALUES (${name.trim()}, ${description ?? null},
              ${JSON.stringify(profileUpdates ?? {})}::jsonb,
              ${JSON.stringify(parsedFindings ?? [])}::jsonb,
              ${JSON.stringify(tags ?? [])}::jsonb)
      RETURNING id, name, description, profile_updates AS "profileUpdates", parsed_findings AS "parsedFindings",
                tags, last_run_at AS "lastRunAt", last_run_result AS "lastRunResult",
                created_at AS "createdAt", updated_at AS "updatedAt"
    `);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    logger.error({ err }, "POST /admin/signal-rules/simulation-profiles failed");
    res.status(500).json({ error: "Failed to create simulation profile" });
  }
});

// ── PATCH /api/admin/signal-rules/simulation-profiles/:id ────────────────────

router.patch("/admin/signal-rules/simulation-profiles/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const { name, description, profileUpdates, parsedFindings, tags } = (req.body ?? {}) as Record<string, unknown>;
    const result = await db.execute(sql`
      UPDATE signal_simulation_profiles
      SET name = COALESCE(${name ?? null}, name),
          description = ${description !== undefined ? (description ?? null) : sql`description`},
          profile_updates = COALESCE(${profileUpdates ? sql`${JSON.stringify(profileUpdates)}::jsonb` : null}, profile_updates),
          parsed_findings = COALESCE(${parsedFindings ? sql`${JSON.stringify(parsedFindings)}::jsonb` : null}, parsed_findings),
          tags = COALESCE(${tags ? sql`${JSON.stringify(tags)}::jsonb` : null}, tags),
          updated_at = now()
      WHERE id = ${id}
      RETURNING id, name, description, profile_updates AS "profileUpdates", parsed_findings AS "parsedFindings",
                tags, last_run_at AS "lastRunAt", last_run_result AS "lastRunResult",
                created_at AS "createdAt", updated_at AS "updatedAt"
    `);
    if (result.rows.length === 0) { res.status(404).json({ error: "Not found" }); return; }
    res.json(result.rows[0]);
  } catch (err) {
    logger.error({ err }, "PATCH /admin/signal-rules/simulation-profiles/:id failed");
    res.status(500).json({ error: "Failed to update simulation profile" });
  }
});

// ── DELETE /api/admin/signal-rules/simulation-profiles/:id ───────────────────

router.delete("/admin/signal-rules/simulation-profiles/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    await db.execute(sql`DELETE FROM signal_simulation_profiles WHERE id = ${id}`);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "DELETE /admin/signal-rules/simulation-profiles/:id failed");
    res.status(500).json({ error: "Failed to delete simulation profile" });
  }
});

// ── GET /api/admin/signal-rules/clients-with-runs ─────────────────────────────

router.get("/admin/signal-rules/clients-with-runs", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const result = await db.execute(sql`
      SELECT u.id, u.name, u.email, u.company,
             COUNT(srr.id)::int AS run_count,
             MAX(srr.created_at) AS last_run_at
      FROM users u
      INNER JOIN script_run_results srr ON srr.customer_id = u.id AND srr.status = 'completed'
      WHERE u.role = 'client'
      GROUP BY u.id, u.name, u.email, u.company
      ORDER BY MAX(srr.created_at) DESC
    `);
    res.json(result.rows.map((r: Record<string, unknown>) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      company: r.company,
      runCount: r.run_count,
      lastRunAt: r.last_run_at,
    })));
  } catch (err) {
    logger.error({ err }, "GET /admin/signal-rules/clients-with-runs failed");
    res.status(500).json({ error: "Failed to fetch clients" });
  }
});

// ── POST /api/admin/signal-rules/simulation-profiles/from-client ──────────────

router.post("/admin/signal-rules/simulation-profiles/from-client", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { clientUserId, name, tags } = (req.body ?? {}) as Record<string, unknown>;
    if (!clientUserId) { res.status(400).json({ error: "clientUserId is required" }); return; }
    const cid = Number(clientUserId);
    if (isNaN(cid)) { res.status(400).json({ error: "Invalid clientUserId" }); return; }

    const clientResult = await db.execute(sql`
      SELECT id, name, email, company FROM users WHERE id = ${cid} AND role = 'client'
    `);
    if (clientResult.rows.length === 0) { res.status(404).json({ error: "Client not found" }); return; }
    const client = clientResult.rows[0] as { id: number; name: string | null; email: string; company: string | null };

    const scriptRuns = await db.execute(sql`
      SELECT profile_updates AS "profileUpdates", parsed_findings AS "parsedFindings", created_at AS "createdAt"
      FROM script_run_results
      WHERE customer_id = ${cid} AND status = 'completed'
      ORDER BY created_at DESC LIMIT 50
    `);

    if (scriptRuns.rows.length === 0) {
      res.status(422).json({ error: "This client has no completed script runs to import" });
      return;
    }

    const mergedProfile: Record<string, unknown> = {};
    const allFindings = new Set<string>();

    for (const run of [...(scriptRuns.rows as Array<{ profileUpdates: Record<string, unknown>; parsedFindings: string[] }>)].reverse()) {
      Object.assign(mergedProfile, run.profileUpdates ?? {});
      for (const f of run.parsedFindings ?? []) allFindings.add(f);
    }

    const profileName = typeof name === "string" && name.trim()
      ? name.trim()
      : `${client.name ?? client.email}${client.company ? ` (${client.company})` : ""} — ${new Date().toLocaleDateString()}`;

    const parsedTags = Array.isArray(tags) ? tags as string[] : ["tenant-import"];

    const result = await db.execute(sql`
      INSERT INTO signal_simulation_profiles (name, description, profile_updates, parsed_findings, tags)
      VALUES (
        ${profileName},
        ${`Imported from client ID ${cid}: ${client.email} · ${scriptRuns.rows.length} script run(s)`},
        ${JSON.stringify(mergedProfile)}::jsonb,
        ${JSON.stringify([...allFindings])}::jsonb,
        ${JSON.stringify(parsedTags)}::jsonb
      )
      RETURNING id, name, description, profile_updates AS "profileUpdates", parsed_findings AS "parsedFindings",
                tags, last_run_at AS "lastRunAt", last_run_result AS "lastRunResult",
                created_at AS "createdAt", updated_at AS "updatedAt"
    `);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    logger.error({ err }, "POST /admin/signal-rules/simulation-profiles/from-client failed");
    res.status(500).json({ error: "Failed to create simulation profile from client data" });
  }
});

// ── POST /api/admin/signal-rules/simulation-profiles/:id/run ─────────────────

router.post("/admin/signal-rules/simulation-profiles/:id/run", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const profileResult = await db.execute(sql`
      SELECT profile_updates AS "profileUpdates", parsed_findings AS "parsedFindings",
             last_run_result AS "lastRunResult", last_run_project_diff AS "lastRunProjectDiff"
      FROM signal_simulation_profiles WHERE id = ${id}
    `);
    if (profileResult.rows.length === 0) { res.status(404).json({ error: "Not found" }); return; }
    const { profileUpdates, parsedFindings, lastRunResult, lastRunProjectDiff } = profileResult.rows[0] as {
      profileUpdates: Record<string, unknown>;
      parsedFindings: string[];
      lastRunResult: Array<{ key: string; label: string; expectedImpact: string }> | null;
      lastRunProjectDiff: {
        includedProjects: Array<{ id: number; title: string; priceRange: string | null }>;
        excludedProjects: Array<{ project: { id: number; title: string }; reason: string }>;
      } | null;
    };

    const [rules, groups, disabledKeys] = await Promise.all([getAllRules(), getAllGroups(), getDisabledSignalKeys()]);
    const { firedSignals, trace } = computeTenantSignals(
      profileUpdates ?? {},
      Array.isArray(parsedFindings) ? parsedFindings : [],
      rules,
      groups,
      disabledKeys,
    );

    const signalMeta = new Map(TENANT_SIGNALS.map(s => [s.key, s]));
    const firedArr = [...firedSignals].map(key => {
      const meta = signalMeta.get(key);
      return { key, label: meta?.label ?? key, expectedImpact: meta?.expectedImpact ?? "" };
    });

    // Compute project inclusion diff
    const allProjects = await db.execute(sql`
      SELECT id, title, price_range AS "priceRange", description, triggered_by AS "triggeredBy",
             sort_order AS "sortOrder", is_visible AS "isVisible"
      FROM engagement_projects WHERE is_visible = true ORDER BY sort_order
    `);

    const knownSignalKeys = new Set(TENANT_SIGNALS.map(s => s.key));
    const firedSet = new Set([...firedSignals]);
    const includedProjects: Array<{ id: number; title: string; priceRange: string | null }> = [];
    const excludedProjects: Array<{ project: { id: number; title: string }; reason: string }> = [];

    for (const p of allProjects.rows as Array<{ id: number; title: string; priceRange: string | null; triggeredBy: string[] }>) {
      const { included, reason } = projectMatchesSignals(p, knownSignalKeys, firedSet);
      if (included) {
        includedProjects.push({ id: p.id, title: p.title, priceRange: p.priceRange });
      } else {
        excludedProjects.push({ project: { id: p.id, title: p.title }, reason: reason ?? "Not matched" });
      }
    }

    const projectDiff = { includedProjects, excludedProjects };

    // ── Compute delta vs previous run ──────────────────────────────────────────
    let previousRunDiff: {
      newlyIncluded: Array<{ id: number; title: string }>;
      movedToExcluded: Array<{ id: number; title: string }>;
      newlyFired: Array<{ key: string; label: string }>;
      stoppedFiring: Array<{ key: string; label: string }>;
    } | null = null;

    if (lastRunResult && lastRunProjectDiff) {
      const prevIncludedIds = new Set((lastRunProjectDiff.includedProjects ?? []).map(p => p.id));
      const currIncludedIds = new Set(includedProjects.map(p => p.id));

      const newlyIncluded = includedProjects
        .filter(p => !prevIncludedIds.has(p.id))
        .map(p => ({ id: p.id, title: p.title }));

      const movedToExcluded = (lastRunProjectDiff.includedProjects ?? [])
        .filter(p => !currIncludedIds.has(p.id))
        .map(p => ({ id: p.id, title: p.title }));

      const prevFiredKeys = new Set((lastRunResult ?? []).map(s => s.key));
      const currFiredKeys = new Set(firedArr.map(s => s.key));

      const newlyFired = firedArr
        .filter(s => !prevFiredKeys.has(s.key))
        .map(s => ({ key: s.key, label: s.label }));

      const stoppedFiring = (lastRunResult ?? [])
        .filter(s => !currFiredKeys.has(s.key))
        .map(s => ({ key: s.key, label: s.label }));

      previousRunDiff = { newlyIncluded, movedToExcluded, newlyFired, stoppedFiring };
    }

    await db.execute(sql`
      UPDATE signal_simulation_profiles
      SET last_run_at = now(),
          last_run_result = ${JSON.stringify(firedArr)}::jsonb,
          last_run_project_diff = ${JSON.stringify(projectDiff)}::jsonb,
          updated_at = now()
      WHERE id = ${id}
    `);

    res.json({ firedSignals: firedArr, ruleTrace: trace, includedProjects, excludedProjects, previousRunDiff });
  } catch (err) {
    logger.error({ err }, "POST /admin/signal-rules/simulation-profiles/:id/run failed");
    res.status(500).json({ error: "Failed to run simulation profile" });
  }
});

// ── POST /api/admin/signal-rules/dry-run-sow ──────────────────────────────────

router.post("/admin/signal-rules/dry-run-sow", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { clientUserId } = (req.body ?? {}) as Record<string, unknown>;
    if (!clientUserId) { res.status(400).json({ error: "clientUserId is required" }); return; }
    const cid = Number(clientUserId);
    if (isNaN(cid)) { res.status(400).json({ error: "Invalid clientUserId" }); return; }

    const scriptRuns = await db.execute(sql`
      SELECT profile_updates AS "profileUpdates", parsed_findings AS "parsedFindings"
      FROM script_run_results
      WHERE customer_id = ${cid} AND status = 'completed'
      ORDER BY created_at DESC LIMIT 50
    `);

    const mergedProfile: Record<string, unknown> = {};
    const allFindings = new Set<string>();

    for (const run of [...(scriptRuns.rows as Array<{ profileUpdates: Record<string, unknown>; parsedFindings: string[] }>)].reverse()) {
      Object.assign(mergedProfile, run.profileUpdates ?? {});
      for (const f of run.parsedFindings ?? []) allFindings.add(f);
    }

    const [rules, groups, disabledKeys] = await Promise.all([getAllRules(), getAllGroups(), getDisabledSignalKeys()]);
    const { firedSignals, trace } = computeTenantSignals(mergedProfile, [...allFindings], rules, groups, disabledKeys);
    const firedKeys = [...firedSignals];

    const signalMeta = new Map(TENANT_SIGNALS.map(s => [s.key, s]));
    const firedArr = firedKeys.map(key => {
      const meta = signalMeta.get(key);
      return { key, label: meta?.label ?? key, expectedImpact: meta?.expectedImpact ?? "" };
    });

    const allProjects = await db.execute(sql`
      SELECT id, title, price_range AS "priceRange", description, triggered_by AS "triggeredBy",
             meaning, sort_order AS "sortOrder", is_visible AS "isVisible"
      FROM engagement_projects WHERE is_visible = true ORDER BY sort_order
    `);

    const knownSignalKeys = new Set(TENANT_SIGNALS.map(s => s.key));
    const firedSet = new Set(firedKeys);
    const includedProjects: unknown[] = [];
    const excludedProjects: Array<{ project: unknown; reason: string }> = [];

    for (const p of allProjects.rows as Array<{ id: number; title: string; triggeredBy: string[] }>) {
      const { included, reason } = projectMatchesSignals(p, knownSignalKeys, firedSet);
      if (included) {
        includedProjects.push(p);
      } else {
        excludedProjects.push({ project: p, reason: reason ?? "Not matched" });
      }
    }

    res.json({
      firedSignals: firedArr,
      ruleTrace: trace,
      includedProjects,
      excludedProjects,
      note: "No document was generated. This is a dry run only.",
    });
  } catch (err) {
    logger.error({ err }, "POST /admin/signal-rules/dry-run-sow failed");
    res.status(500).json({ error: "Dry-run failed" });
  }
});

// ─── POST /api/admin/signal-rules/publish-to-prod ────────────────────────────
// Full-replace sync of signal_rule_groups + signal_derivation_rules from dev
// into production. Strategy: delete all prod rules/groups, re-insert from dev
// with remapped group IDs.

router.post("/admin/signal-rules/publish-to-prod", requireAdmin, async (req: Request, res: Response) => {
  const dryRun = String(req.query["dryRun"] ?? "") === "true";
  const { isProdDbConfigured, buildProdDb } = await import("../lib/prod-db.ts");
  if (!isProdDbConfigured()) {
    res.status(503).json({ error: "Production database is not configured. Set DATABASE_URL_PROD in Replit Secrets." });
    return;
  }

  try {
    // Read all custom signals, groups, and rules from dev
    const devCustomRows = await db.execute(sql`
      SELECT key, label, description, expected_impact, is_adjustment
      FROM custom_signals ORDER BY created_at ASC
    `);
    const devCustomSignals = devCustomRows.rows as Array<{
      key: string; label: string; description: string; expected_impact: string; is_adjustment: boolean;
    }>;

    const devGroupRows = await db.execute(sql`
      SELECT id, signal_key, logic, label, sort_order
      FROM signal_rule_groups ORDER BY signal_key, sort_order, id
    `);
    const devGroups = devGroupRows.rows as Array<{
      id: number; signal_key: string; logic: string; label: string | null; sort_order: number;
    }>;

    const devRuleRows = await db.execute(sql`
      SELECT signal_key, group_id, rule_type, source_key, compare_value, description, sort_order
      FROM signal_derivation_rules ORDER BY signal_key, sort_order, id
    `);
    const devRules = devRuleRows.rows as Array<{
      signal_key: string; group_id: number | null; rule_type: string; source_key: string;
      compare_value: string | null; description: string | null; sort_order: number;
    }>;

    const { pool: prodPool } = buildProdDb();
    const client = await prodPool.connect();

    try {
      if (dryRun) {
        // Read prod state and compute diff without writing
        const [prodCustomRes, prodGroupsRes, prodRulesRes] = await Promise.all([
          client.query<{ key: string }>(`SELECT key FROM custom_signals`),
          client.query<{ count: string }>(`SELECT COUNT(*) AS count FROM signal_rule_groups`),
          client.query<{ count: string }>(`SELECT COUNT(*) AS count FROM signal_derivation_rules`),
        ]);
        const prodCustomKeys = new Set(prodCustomRes.rows.map(r => r.key));
        const devCustomKeys = new Set(devCustomSignals.map(s => s.key));

        res.json({
          dryRun: true,
          customSignals: {
            added: devCustomSignals.filter(s => !prodCustomKeys.has(s.key)).map(s => s.key),
            removed: prodCustomRes.rows.filter(r => !devCustomKeys.has(r.key)).map(r => r.key),
          },
          groups: {
            current: parseInt(prodGroupsRes.rows[0]?.count ?? "0", 10),
            incoming: devGroups.length,
          },
          rules: {
            current: parseInt(prodRulesRes.rows[0]?.count ?? "0", 10),
            incoming: devRules.length,
          },
        });
        return;
      }

      // Actual write
      await client.query("BEGIN");

      // 1. Delete all existing prod rules (FK references groups)
      await client.query("DELETE FROM signal_derivation_rules");
      // 2. Delete all existing prod groups
      await client.query("DELETE FROM signal_rule_groups");
      // 3. Delete all existing prod custom signals
      await client.query("DELETE FROM custom_signals");

      // 4. Insert custom signals
      for (const cs of devCustomSignals) {
        await client.query(
          `INSERT INTO custom_signals (key, label, description, expected_impact, is_adjustment)
           VALUES ($1, $2, $3, $4, $5)`,
          [cs.key, cs.label, cs.description, cs.expected_impact, cs.is_adjustment]
        );
      }

      // 5. Insert groups, capturing dev id → prod id mapping
      const groupIdMap = new Map<number, number>();
      for (const g of devGroups) {
        const result = await client.query(
          `INSERT INTO signal_rule_groups (signal_key, logic, label, sort_order)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [g.signal_key, g.logic, g.label, g.sort_order]
        );
        const newId = (result.rows[0] as { id: number }).id;
        groupIdMap.set(g.id, newId);
      }

      // 6. Insert rules with remapped group IDs
      for (const r of devRules) {
        const prodGroupId = r.group_id != null ? (groupIdMap.get(r.group_id) ?? null) : null;
        await client.query(
          `INSERT INTO signal_derivation_rules (signal_key, group_id, rule_type, source_key, compare_value, description, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [r.signal_key, prodGroupId, r.rule_type, r.source_key, r.compare_value, r.description, r.sort_order]
        );
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => { /* ignore */ });
      throw err;
    } finally {
      client.release();
      await prodPool.end();
    }

    logger.info(
      { customSignals: devCustomSignals.length, groups: devGroups.length, rules: devRules.length },
      "signal-rules: published to prod",
    );
    res.json({ ok: true, customSignals: devCustomSignals.length, groups: devGroups.length, rules: devRules.length });
  } catch (err) {
    logger.error({ err }, "signal-rules: publish-to-prod failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to publish to production" });
  }
});

export default router;
