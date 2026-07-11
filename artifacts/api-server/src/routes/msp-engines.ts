/**
 * msp-engines.ts
 *
 * MSP Portal-scoped engine configuration routes.
 *
 * /api/msp/engines/:key/configuration — returns this engine's rule groups and
 * rules scoped to the calling MSP's mspId. MSP-owned engines (sla, scope_creep)
 * can have rules that override platform defaults. Editing those rules requires
 * the `sla_scope_creep_custom_rules` plan feature (Pro tier).
 *
 * Auth: requireRole("MSPOperator") — requires a valid MSP JWT with at least
 * MSPOperator role. PlatformAdmin bypasses all scope checks.
 *
 * Plan gating: requirePlanFeature("sla_scope_creep_custom_rules") for write ops.
 */

import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireRole } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { ENGINE_DEFS } from "../lib/engine-registry";

const router: IRouter = Router();

// ── Plan feature gate ─────────────────────────────────────────────────────────
// Stub: currently any MSPOperator+ can use this. When billing tiers are
// introduced, check the MSP's plan here and 403 if the feature flag is absent.

function requirePlanFeature(_feature: string) {
  return (_req: Request, _res: Response, next: NextFunction): void => {
    next();
  };
}

const MSP_OWNED_ENGINES = new Set(["sla", "scope_creep"]);

// ── GET /api/msp/engines — list engines available to this MSP ─────────────────

router.get(
  "/msp/engines",
  requireRole("MSPOperator"),
  (_req: Request, res: Response) => {
    res.json({
      engines: ENGINE_DEFS.map(e => ({
        key: e.key,
        label: e.label,
        description: e.description,
        categoryPrefix: e.categoryPrefix,
        tenantScoped: e.tenantScoped,
        ruleOwnership: e.ruleOwnership ?? "platform",
        mspEditable: MSP_OWNED_ENGINES.has(e.key),
      })),
    });
  },
);

// ── GET /api/msp/engines/:key/configuration ───────────────────────────────────
// Returns rule groups and rules for this engine scoped to the caller's mspId.
// Platform-owned engines show only platform rules (read-only to MSP).
// MSP-owned engines show the union of platform defaults + this MSP's overrides.

router.get(
  "/msp/engines/:key/configuration",
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    const key = req.params["key"] as string;
    const user = req.user!;
    const mspId = user.mspId ?? null;

    const def = ENGINE_DEFS.find(e => e.key === key);
    if (!def) {
      res.status(404).json({ error: "Unknown engine" });
      return;
    }

    try {
      const prefix = `${def.categoryPrefix}:`;
      const isMspOwned = MSP_OWNED_ENGINES.has(key);

      let groupRows, ruleRows;

      if (isMspOwned && mspId != null) {
        [groupRows, ruleRows] = await Promise.all([
          db.execute(sql`
            SELECT id, signal_key AS "signalKey", logic, label, sort_order AS "sortOrder",
                   category, msp_id AS "mspId", created_at AS "createdAt"
            FROM signal_rule_groups
            WHERE category LIKE ${prefix + "%"}
              AND (msp_id IS NULL OR msp_id = ${mspId})
            ORDER BY sort_order, id
          `),
          db.execute(sql`
            SELECT id, signal_key AS "signalKey", group_id AS "groupId", rule_type AS "ruleType",
                   source_key AS "sourceKey", compare_value AS "compareValue",
                   description, sort_order AS "sortOrder", category, msp_id AS "mspId",
                   created_at AS "createdAt", updated_at AS "updatedAt"
            FROM signal_derivation_rules
            WHERE category LIKE ${prefix + "%"}
              AND (msp_id IS NULL OR msp_id = ${mspId})
            ORDER BY sort_order, id
          `),
        ]);
      } else {
        [groupRows, ruleRows] = await Promise.all([
          db.execute(sql`
            SELECT id, signal_key AS "signalKey", logic, label, sort_order AS "sortOrder",
                   category, msp_id AS "mspId", created_at AS "createdAt"
            FROM signal_rule_groups
            WHERE category LIKE ${prefix + "%"} AND msp_id IS NULL
            ORDER BY sort_order, id
          `),
          db.execute(sql`
            SELECT id, signal_key AS "signalKey", group_id AS "groupId", rule_type AS "ruleType",
                   source_key AS "sourceKey", compare_value AS "compareValue",
                   description, sort_order AS "sortOrder", category, msp_id AS "mspId",
                   created_at AS "createdAt", updated_at AS "updatedAt"
            FROM signal_derivation_rules
            WHERE category LIKE ${prefix + "%"} AND msp_id IS NULL
            ORDER BY sort_order, id
          `),
        ]);
      }

      res.json({
        engine: key,
        categoryPrefix: def.categoryPrefix,
        ruleOwnership: def.ruleOwnership ?? "platform",
        mspEditable: isMspOwned,
        mspId,
        groups: groupRows.rows,
        rules: ruleRows.rows,
      });
    } catch (err) {
      logger.error({ err, engineKey: key }, "msp-engines: configuration fetch failed");
      res.status(500).json({ error: "Failed to fetch engine configuration" });
    }
  },
);

// ── POST /api/msp/engines/:key/rules — create MSP-owned rule (Pro tier) ───────

router.post(
  "/msp/engines/:key/rules",
  requireRole("MSPOperator"),
  requirePlanFeature("sla_scope_creep_custom_rules"),
  async (req: Request, res: Response) => {
    const key = req.params["key"] as string;
    const user = req.user!;
    const mspId = user.mspId ?? null;

    if (!MSP_OWNED_ENGINES.has(key)) {
      res.status(403).json({ error: `Engine "${key}" is platform-owned; MSP rule editing is not permitted` });
      return;
    }
    if (!mspId) {
      res.status(400).json({ error: "mspId required" });
      return;
    }

    const def = ENGINE_DEFS.find(e => e.key === key);
    if (!def) {
      res.status(404).json({ error: "Unknown engine" });
      return;
    }

    const b = req.body as Record<string, unknown>;
    const prefix = `${def.categoryPrefix}:`;
    const category = String(b.category ?? prefix + "custom");

    if (!category.startsWith(prefix)) {
      res.status(400).json({ error: `category must start with "${prefix}"` });
      return;
    }

    try {
      const result = await db.execute(sql`
        INSERT INTO signal_derivation_rules (
          signal_key, group_id, rule_type, source_key, compare_value,
          description, sort_order, category, msp_id
        ) VALUES (
          ${b.signalKey as string}, ${(b.groupId ?? null) as number | null},
          ${b.ruleType as string}, ${b.sourceKey as string},
          ${(b.compareValue ?? null) as string | null},
          ${(b.description ?? null) as string | null},
          ${(b.sortOrder ?? 0) as number}, ${category}, ${mspId}
        ) RETURNING id
      `);
      const id = (result.rows[0] as { id: number }).id;
      logger.info({ id, engineKey: key, mspId }, "msp-engines: MSP rule created");
      res.status(201).json({ id });
    } catch (err) {
      logger.error({ err, engineKey: key }, "msp-engines: create rule failed");
      res.status(500).json({ error: "Failed to create rule" });
    }
  },
);

// ── DELETE /api/msp/engines/:key/rules/:ruleId — remove MSP-owned rule ────────

router.delete(
  "/msp/engines/:key/rules/:ruleId",
  requireRole("MSPOperator"),
  requirePlanFeature("sla_scope_creep_custom_rules"),
  async (req: Request, res: Response) => {
    const key = req.params["key"] as string;
    const ruleId = req.params["ruleId"] as string;
    const user = req.user!;
    const mspId = user.mspId ?? null;

    if (!MSP_OWNED_ENGINES.has(key) || !mspId) {
      res.status(403).json({ error: "Not permitted" });
      return;
    }

    try {
      await db.execute(sql`
        DELETE FROM signal_derivation_rules
        WHERE id = ${Number(ruleId)} AND msp_id = ${mspId}
      `);
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err, ruleId }, "msp-engines: delete rule failed");
      res.status(500).json({ error: "Failed to delete rule" });
    }
  },
);

export default router;
