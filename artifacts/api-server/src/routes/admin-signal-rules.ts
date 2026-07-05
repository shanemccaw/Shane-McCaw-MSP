import { Router, type IRouter, type Request, type Response } from "express";
import { db, scriptRunResultsTable, engagementProjectsTable, usersTable } from "@workspace/db";
import { eq, desc, asc, isNull, sql } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import {
  TENANT_SIGNALS,
  computeTenantSignals,
  projectMatchesSignals,
  type SignalDerivationRule,
  type SignalRuleGroup,
} from "../lib/tenant-signals";
import { detectRuleConflicts } from "../lib/signal-conflict-detector";

const router: IRouter = Router();

// ── Raw DB helpers ─────────────────────────────────────────────────────────────

async function getAllRules(): Promise<SignalDerivationRule[]> {
  const rows = await db.execute(sql`
    SELECT id, signal_key AS "signalKey", group_id AS "groupId", rule_type AS "ruleType",
           source_key AS "sourceKey", compare_value AS "compareValue", description,
           sort_order AS "sortOrder", created_at AS "createdAt", updated_at AS "updatedAt"
    FROM signal_derivation_rules
    ORDER BY signal_key, sort_order, id
  `);
  return rows.rows as unknown as SignalDerivationRule[];
}

async function getAllGroups(): Promise<SignalRuleGroup[]> {
  const rows = await db.execute(sql`
    SELECT id, signal_key AS "signalKey", logic, label, sort_order AS "sortOrder", created_at AS "createdAt"
    FROM signal_rule_groups
    ORDER BY signal_key, sort_order, id
  `);
  return rows.rows as unknown as SignalRuleGroup[];
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

async function saveSnapshot(name: string, adminId?: number | null): Promise<number> {
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

// ── GET /api/admin/signal-rules ────────────────────────────────────────────────

router.get("/admin/signal-rules", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const [rules, groups] = await Promise.all([getAllRules(), getAllGroups()]);

    const bySignal: Record<string, { rules: SignalDerivationRule[]; groups: SignalRuleGroup[] }> = {};
    for (const sig of TENANT_SIGNALS) {
      bySignal[sig.key] = { rules: [], groups: [] };
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
    const { signalKey, groupId, ruleType, sourceKey, compareValue, description, sortOrder } =
      (req.body ?? {}) as Record<string, unknown>;
    if (!signalKey || !ruleType || !sourceKey) {
      res.status(400).json({ error: "signalKey, ruleType, sourceKey are required" });
      return;
    }
    const result = await db.execute(sql`
      INSERT INTO signal_derivation_rules (signal_key, group_id, rule_type, source_key, compare_value, description, sort_order)
      VALUES (${signalKey as string}, ${groupId ?? null}, ${ruleType as string}, ${sourceKey as string},
              ${compareValue ?? null}, ${description ?? null}, ${(sortOrder as number) ?? 0})
      RETURNING id, signal_key AS "signalKey", group_id AS "groupId", rule_type AS "ruleType",
                source_key AS "sourceKey", compare_value AS "compareValue", description,
                sort_order AS "sortOrder", created_at AS "createdAt", updated_at AS "updatedAt"
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
             sort_order AS "sortOrder", created_at AS "createdAt", updated_at AS "updatedAt"
      FROM signal_derivation_rules WHERE id = ${id}
    `);
    const prior = priorResult.rows[0] as unknown as SignalDerivationRule | undefined;
    if (!prior) { res.status(404).json({ error: "Not found" }); return; }

    const { groupId, ruleType, sourceKey, compareValue, description, sortOrder } =
      (req.body ?? {}) as Record<string, unknown>;

    const groupIdInt = groupId !== undefined
      ? (groupId === null || groupId === "" ? null : Number(groupId))
      : prior.groupId;
    const sortOrderInt = sortOrder !== undefined && sortOrder !== null
      ? Number(sortOrder)
      : null;

    const result = await db.execute(sql`
      UPDATE signal_derivation_rules
      SET group_id = ${groupIdInt}::integer,
          rule_type = COALESCE(${ruleType ?? null}, rule_type),
          source_key = COALESCE(${sourceKey ?? null}, source_key),
          compare_value = ${compareValue !== undefined ? (compareValue ?? null) : prior.compareValue},
          description = ${description !== undefined ? (description ?? null) : prior.description},
          sort_order = COALESCE(${sortOrderInt}, sort_order),
          updated_at = now()
      WHERE id = ${id}
      RETURNING id, signal_key AS "signalKey", group_id AS "groupId", rule_type AS "ruleType",
                source_key AS "sourceKey", compare_value AS "compareValue", description,
                sort_order AS "sortOrder", created_at AS "createdAt", updated_at AS "updatedAt"
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
    const { signalKey, logic, label, sortOrder } = (req.body ?? {}) as Record<string, unknown>;
    if (!signalKey || !logic) { res.status(400).json({ error: "signalKey and logic are required" }); return; }
    const result = await db.execute(sql`
      INSERT INTO signal_rule_groups (signal_key, logic, label, sort_order)
      VALUES (${signalKey as string}, ${logic as string}, ${label ?? null}, ${(sortOrder as number) ?? 0})
      RETURNING id, signal_key AS "signalKey", logic, label, sort_order AS "sortOrder", created_at AS "createdAt"
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
    const { logic, label, sortOrder } = (req.body ?? {}) as Record<string, unknown>;
    const result = await db.execute(sql`
      UPDATE signal_rule_groups
      SET logic = COALESCE(${logic ?? null}, logic),
          label = ${label !== undefined ? (label ?? null) : sql`label`},
          sort_order = COALESCE(${sortOrder ?? null}, sort_order)
      WHERE id = ${id}
      RETURNING id, signal_key AS "signalKey", logic, label, sort_order AS "sortOrder", created_at AS "createdAt"
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

    const [rules, groups] = await Promise.all([getAllRules(), getAllGroups()]);
    const { firedSignals, trace } = computeTenantSignals(mergedProfile, findings, rules, groups);

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
      const [rules, groups] = await Promise.all([getAllRules(), getAllGroups()]);
      const { firedSignals, trace: _trace } = computeTenantSignals(mergedProfile, findings, rules, groups);
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
    const [rules, groups] = await Promise.all([getAllRules(), getAllGroups()]);

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
      const { firedSignals } = computeTenantSignals(profile, findings, rules, groups);
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
    if (!Array.isArray(importedRules)) {
      res.status(400).json({ error: "Body must contain a 'rules' array" }); return;
    }

    const adminId = (req as unknown as { user?: { id: number } }).user?.id ?? null;

    // Capture backup BEFORE the transaction so it is always committed even if the
    // import transaction rolls back.
    const snapshotId = await saveSnapshot("Pre-import backup", adminId);

    let ruleCount = 0;
    let groupCount = 0;

    await db.transaction(async (tx) => {
      await tx.execute(sql`DELETE FROM signal_derivation_rules`);
      await tx.execute(sql`DELETE FROM signal_rule_groups`);

      const groupIdMap = new Map<number, number>();

      if (Array.isArray(importedGroups)) {
        for (const g of importedGroups as Array<Record<string, unknown>>) {
          const result = await tx.execute(sql`
            INSERT INTO signal_rule_groups (signal_key, logic, label, sort_order)
            VALUES (${g.signalKey ?? g.signal_key as string}, ${(g.logic ?? "OR") as string},
                    ${g.label ?? null}, ${(g.sortOrder ?? g.sort_order ?? 0) as number})
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
        await tx.execute(sql`
          INSERT INTO signal_derivation_rules (signal_key, group_id, rule_type, source_key, compare_value, description, sort_order)
          VALUES (${r.signalKey ?? r.signal_key as string}, ${mappedGroupId},
                  ${r.ruleType ?? r.rule_type as string}, ${r.sourceKey ?? r.source_key as string},
                  ${r.compareValue ?? r.compare_value ?? null},
                  ${r.description ?? null}, ${(r.sortOrder ?? r.sort_order ?? 0) as number})
        `);
        ruleCount++;
      }

      await tx.execute(sql`
        INSERT INTO signal_rule_audit_log (action, signal_key, rule_id, before, after, admin_user_id, note)
        VALUES ('import', null, null, null, null, ${adminId},
                ${`Imported ${ruleCount} rules across ${groupCount} groups. Pre-import snapshot saved as ID ${snapshotId}.`})
      `);
    });

    res.json({ imported: ruleCount, snapshotId });
  } catch (err) {
    logger.error({ err }, "POST /admin/signal-rules/import failed");
    res.status(500).json({ error: "Import failed" });
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
      SELECT profile_updates AS "profileUpdates", parsed_findings AS "parsedFindings"
      FROM signal_simulation_profiles WHERE id = ${id}
    `);
    if (profileResult.rows.length === 0) { res.status(404).json({ error: "Not found" }); return; }
    const { profileUpdates, parsedFindings } = profileResult.rows[0] as {
      profileUpdates: Record<string, unknown>;
      parsedFindings: string[];
    };

    const [rules, groups] = await Promise.all([getAllRules(), getAllGroups()]);
    const { firedSignals, trace } = computeTenantSignals(
      profileUpdates ?? {},
      Array.isArray(parsedFindings) ? parsedFindings : [],
      rules,
      groups,
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

    await db.execute(sql`
      UPDATE signal_simulation_profiles
      SET last_run_at = now(), last_run_result = ${JSON.stringify(firedArr)}::jsonb, updated_at = now()
      WHERE id = ${id}
    `);

    res.json({ firedSignals: firedArr, ruleTrace: trace, includedProjects, excludedProjects });
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

    const [rules, groups] = await Promise.all([getAllRules(), getAllGroups()]);
    const { firedSignals, trace } = computeTenantSignals(mergedProfile, [...allFindings], rules, groups);
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

export default router;
