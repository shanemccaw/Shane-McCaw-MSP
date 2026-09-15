/**
 * msp-automation-registry.ts
 *
 * A single, read-only MSP-operator route onto `automation_registry` (Git
 * #3771), added as part of Kanban Phase 2 (#4240). Every existing route on
 * this table (`admin-automation-registry.ts`) is `requireAdmin` — the
 * schema's own comment says MyArchitect (desktop/MyArchitect, Epic #3454) is
 * the primary client creating/updating entries here, and that stays true:
 * this file adds no create/edit/delete capability for MSP operators.
 *
 * It exists purely so the Kanban board's "link an existing automation entry"
 * picker (an Automation Registry card can only ever link to an entry that
 * already exists — see msp-kanban.ts) has something to query without
 * requiring PlatformAdmin auth.
 *
 *   GET /api/msp/customers/:customerId/automation-registry
 *     — List a customer's automation registry entries, most-recently-updated
 *       first. Same wire shape as `admin-automation-registry.ts`'s
 *       `entryToWire`.
 *
 * Auth: requireCapability("ladder.msp-operator") + assertCustomerAccess,
 * the same pattern every other msp-*.ts route in this Phase 2 build uses.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, automationRegistryTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireCapability, assertCustomerAccess } from "../middlewares/requireAuth.ts";
import { logger } from "../lib/logger.ts";

const log = logger.child({ channel: "tenant.portal" });

const router: IRouter = Router();

function entryToWire(row: typeof automationRegistryTable.$inferSelect) {
  return {
    id: row.id,
    customerId: row.customerId,
    type: row.type,
    name: row.name,
    status: row.status,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

router.get(
  "/msp/customers/:customerId/automation-registry",
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response) => {
    const customerId = parseInt(req.params.customerId as string, 10);
    if (isNaN(customerId)) return res.status(400).json({ error: "Invalid customerId" });

    try {
      if (!(await assertCustomerAccess(req.user!, customerId))) {
        return res.status(404).json({ error: "Customer not found" });
      }

      const entries = await db
        .select()
        .from(automationRegistryTable)
        .where(eq(automationRegistryTable.customerId, customerId))
        .orderBy(desc(automationRegistryTable.updatedAt));

      return res.json({ entries: entries.map(entryToWire) });
    } catch (err) {
      log.error({ err, customerId }, "msp-automation-registry: GET list failed");
      return res.status(500).json({ error: "Failed to load automation registry" });
    }
  },
);

export default router;
