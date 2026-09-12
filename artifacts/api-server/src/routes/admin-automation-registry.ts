/**
 * admin-automation-registry.ts — the Automation Registry's API (Git #3771).
 *
 * A persistent, browsable list of the Microsoft-ecosystem automations Shane
 * builds for a customer — Power Automate flows and Power Platform/Azure AI
 * Studio agents, same shape, distinguished by `type`. MyArchitect
 * (desktop/MyArchitect, Epic #3454) is the primary client creating/updating
 * entries here.
 *
 * Deliberately NOT a time-log stream — the real ad-hoc hour-logging path
 * (POST /api/admin/retainer/:customerId/unscoped, admin-retainer.ts, #1293)
 * already exists for logging time spent building/maintaining an entry; this
 * table answers "what automations does Customer X have, and what's their
 * status", a different, complementary concern.
 *
 *   GET    /api/admin/automation-registry/:customerId       — a customer's entries
 *   POST   /api/admin/automation-registry/:customerId       — create an entry
 *   PATCH  /api/admin/automation-registry/entry/:id         — edit an entry
 *   DELETE /api/admin/automation-registry/entry/:id         — remove an entry
 *
 * Auth: `requireAdmin` — the platform-admin session the AdminV2 console (and
 * MyArchitect, per #3501) carries. Every customer's rows are scoped by
 * resolving its own tenant (mspId+tenantId) through `resolveTenantScope`,
 * exactly as admin-retainer.ts does, so a stamped `msp_id` is always the
 * customer's real MSP, never assumed.
 *
 * UI/display in MSP Console is a separate, later Feature blocked on #3768
 * (nav placement) — this route serves the data model; it has no MSP-Console
 * consumer yet.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  automationRegistryTable,
  AUTOMATION_REGISTRY_TYPES,
  AUTOMATION_REGISTRY_STATUSES,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "../middlewares/requireAuth.ts";
import { resolveTenantScope } from "../lib/portal-customer-scope.ts";
import { logger } from "../lib/logger.ts";

const log = logger.child({ channel: "admin.automation-registry" });

const router: IRouter = Router();

// ── Wire mapper ─────────────────────────────────────────────────────────────
export function entryToWire(row: typeof automationRegistryTable.$inferSelect) {
  return {
    id: row.id,
    customerId: row.customerId,
    type: row.type,
    name: row.name,
    status: row.status,
    notes: row.notes,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
  };
}

// ── GET /admin/automation-registry/:customerId ─────────────────────────────
router.get("/admin/automation-registry/:customerId", requireAdmin, async (req: Request, res: Response) => {
  try {
    const customerId = Number(req.params.customerId);
    if (!Number.isInteger(customerId) || customerId <= 0) {
      res.status(400).json({ error: "Invalid customerId" });
      return;
    }
    const scope = await resolveTenantScope(customerId);
    if (!scope) {
      res.status(404).json({ error: "Customer not found or has no tenant identity" });
      return;
    }

    const entries = await db
      .select()
      .from(automationRegistryTable)
      .where(eq(automationRegistryTable.customerId, customerId))
      .orderBy(desc(automationRegistryTable.updatedAt));

    res.json({
      customer: { customerId, name: scope.tenantName },
      entries: entries.map(entryToWire),
    });
  } catch (err) {
    log.error({ err }, "GET /admin/automation-registry/:customerId failed");
    res.status(500).json({ error: "Failed to load automation registry" });
  }
});

// ── POST /admin/automation-registry/:customerId ────────────────────────────
const createSchema = z.object({
  type: z.enum(AUTOMATION_REGISTRY_TYPES),
  name: z.string().min(1).max(500),
  status: z.enum(AUTOMATION_REGISTRY_STATUSES).optional(),
  notes: z.string().max(4000).nullable().optional(),
});

router.post("/admin/automation-registry/:customerId", requireAdmin, async (req: Request, res: Response) => {
  try {
    const customerId = Number(req.params.customerId);
    if (!Number.isInteger(customerId) || customerId <= 0) {
      res.status(400).json({ error: "Invalid customerId" });
      return;
    }
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
      return;
    }
    const scope = await resolveTenantScope(customerId);
    if (!scope) {
      res.status(404).json({ error: "Customer not found or has no tenant identity" });
      return;
    }

    const [inserted] = await db
      .insert(automationRegistryTable)
      .values({
        customerId,
        mspId: scope.mspId,
        type: parsed.data.type,
        name: parsed.data.name,
        status: parsed.data.status ?? "active",
        notes: parsed.data.notes ?? null,
      })
      .returning();

    log.info({ customerId, entryId: inserted.id, type: inserted.type }, "automation registry entry created");
    res.status(201).json({ entry: entryToWire(inserted) });
  } catch (err) {
    log.error({ err }, "POST /admin/automation-registry/:customerId failed");
    res.status(500).json({ error: "Failed to create entry" });
  }
});

// ── PATCH /admin/automation-registry/entry/:id ─────────────────────────────
const patchSchema = z.object({
  type: z.enum(AUTOMATION_REGISTRY_TYPES).optional(),
  name: z.string().min(1).max(500).optional(),
  status: z.enum(AUTOMATION_REGISTRY_STATUSES).optional(),
  notes: z.string().max(4000).nullable().optional(),
});

router.patch("/admin/automation-registry/entry/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid entry id" });
      return;
    }
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
      return;
    }

    const patch: Partial<typeof automationRegistryTable.$inferInsert> = { updatedAt: new Date() };
    if (parsed.data.type !== undefined) patch.type = parsed.data.type;
    if (parsed.data.name !== undefined) patch.name = parsed.data.name;
    if (parsed.data.status !== undefined) patch.status = parsed.data.status;
    if (parsed.data.notes !== undefined) patch.notes = parsed.data.notes;

    const [updated] = await db
      .update(automationRegistryTable)
      .set(patch)
      .where(eq(automationRegistryTable.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Entry not found" });
      return;
    }
    log.info({ entryId: updated.id }, "automation registry entry updated");
    res.json({ entry: entryToWire(updated) });
  } catch (err) {
    log.error({ err }, "PATCH /admin/automation-registry/entry/:id failed");
    res.status(500).json({ error: "Failed to update entry" });
  }
});

// ── DELETE /admin/automation-registry/entry/:id ────────────────────────────
router.delete("/admin/automation-registry/entry/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid entry id" });
      return;
    }
    const [deleted] = await db
      .delete(automationRegistryTable)
      .where(eq(automationRegistryTable.id, id))
      .returning({ id: automationRegistryTable.id });
    if (!deleted) {
      res.status(404).json({ error: "Entry not found" });
      return;
    }
    log.info({ entryId: deleted.id }, "automation registry entry deleted");
    res.json({ ok: true, id: deleted.id });
  } catch (err) {
    log.error({ err }, "DELETE /admin/automation-registry/entry/:id failed");
    res.status(500).json({ error: "Failed to delete entry" });
  }
});

export default router;
