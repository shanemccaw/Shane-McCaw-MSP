/**
 * msp-change-freeze-windows.ts — MSP-console CRUD for the Change Control
 * freeze / blackout calendar (#1500).
 *
 *   GET   /api/msp/change-freeze-windows       — this MSP's windows
 *   POST  /api/msp/change-freeze-windows       — create a window
 *   PATCH /api/msp/change-freeze-windows/:id   — edit a window (incl. retire it)
 *
 * No freeze window can exist without a way to create one, and the two
 * submit-time enforcement points (`portal-change-control.ts`,
 * `msp-changes.ts`) only ever READ `change_freeze_windows` — this is the
 * write side. Scoped by `mspId` (`resolveMspIdStrict`), the same MSP-era shape
 * `msp-changes.ts` itself uses, since a freeze window belongs to the MSP that
 * declared it, not to one customer's own settings the way the Change Control
 * POLICY (`portal_change_control_policy`, keyed on `customer_id`) does.
 *
 * `active: false` rather than DELETE retires a window: the row is what a
 * `cr_approvals.freeze_window_id` still points back to for an already-decided
 * exception, and losing that audit trail to a hard delete would be worse than
 * an inactive row nobody matches against any more.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  changeFreezeWindowsTable,
  CHANGE_FREEZE_SCOPES,
  CHANGE_FREEZE_RECURRENCES,
  type ChangeFreezeWindow,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { requireAuth, requireRole } from "../middlewares/requireAuth.ts";
import { resolveMspIdStrict } from "../lib/resolve-msp-id.ts";
import { apiError, ApiErrorCode } from "../lib/api-helpers.ts";
import { logger } from "../lib/logger.ts";
import { CHANGE_REQUEST_WORKLOADS } from "../lib/portal-change-control.ts";

const log = logger.child({ channel: "workflow.change-control" });

const router: IRouter = Router();

/** One freeze window, as the MSP console consumes it. */
interface WireFreezeWindow {
  readonly id: number;
  readonly scope: (typeof CHANGE_FREEZE_SCOPES)[number];
  readonly tenantId: string | null;
  readonly workload: string | null;
  readonly name: string;
  readonly reason: string | null;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly recurrence: (typeof CHANGE_FREEZE_RECURRENCES)[number];
  readonly recurrenceUntil: string | null;
  readonly active: boolean;
  readonly createdBy: string | null;
  readonly createdAt: string;
}

function toWire(row: ChangeFreezeWindow): WireFreezeWindow {
  return {
    id: row.id,
    scope: row.scope as (typeof CHANGE_FREEZE_SCOPES)[number],
    tenantId: row.tenantId,
    workload: row.workload,
    name: row.name,
    reason: row.reason,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    recurrence: row.recurrence as (typeof CHANGE_FREEZE_RECURRENCES)[number],
    recurrenceUntil: row.recurrenceUntil ? row.recurrenceUntil.toISOString() : null,
    active: row.active,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

router.get(
  "/msp/change-freeze-windows",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response): Promise<void> => {
    const mspId = resolveMspIdStrict(req);
    if (mspId === null) {
      res.status(403).json({ error: "MSP context required" });
      return;
    }
    try {
      const rows = await db
        .select()
        .from(changeFreezeWindowsTable)
        .where(eq(changeFreezeWindowsTable.mspId, mspId))
        .orderBy(desc(changeFreezeWindowsTable.startsAt));
      res.json({ windows: rows.map(toWire) });
    } catch (err) {
      log.error({ err, mspId }, "GET /msp/change-freeze-windows failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, "Failed to load freeze windows");
    }
  },
);

const createSchema = z
  .object({
    scope: z.enum(CHANGE_FREEZE_SCOPES),
    tenantId: z.string().trim().max(200).optional(),
    workload: z.enum(CHANGE_REQUEST_WORKLOADS).optional(),
    name: z.string().trim().min(1).max(200),
    reason: z.string().trim().max(2_000).optional(),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    recurrence: z.enum(CHANGE_FREEZE_RECURRENCES).default("none"),
    recurrenceUntil: z.string().datetime().optional(),
  })
  .refine((v) => v.scope !== "tenant" || (v.tenantId && v.tenantId.length > 0), {
    message: "tenantId is required when scope is 'tenant'",
    path: ["tenantId"],
  })
  .refine((v) => v.scope !== "workload" || v.workload !== undefined, {
    message: "workload is required when scope is 'workload'",
    path: ["workload"],
  })
  .refine((v) => new Date(v.endsAt).getTime() > new Date(v.startsAt).getTime(), {
    message: "endsAt must be after startsAt",
    path: ["endsAt"],
  });

router.post(
  "/msp/change-freeze-windows",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response): Promise<void> => {
    const mspId = resolveMspIdStrict(req);
    if (mspId === null) {
      res.status(403).json({ error: "MSP context required" });
      return;
    }
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid freeze window", parsed.error.flatten());
      return;
    }
    const body = parsed.data;
    try {
      const [inserted] = await db
        .insert(changeFreezeWindowsTable)
        .values({
          mspId,
          scope: body.scope,
          tenantId: body.scope === "tenant" ? body.tenantId ?? null : null,
          workload: body.scope === "workload" ? body.workload ?? null : null,
          name: body.name,
          reason: body.reason ?? null,
          startsAt: new Date(body.startsAt),
          endsAt: new Date(body.endsAt),
          recurrence: body.recurrence,
          recurrenceUntil: body.recurrenceUntil ? new Date(body.recurrenceUntil) : null,
          createdBy: req.user?.email ?? null,
        })
        .returning();
      log.info({ mspId, freezeWindowId: inserted.id, scope: body.scope, recurrence: body.recurrence }, "change freeze window created");
      res.status(201).json({ window: toWire(inserted) });
    } catch (err) {
      log.error({ err, mspId }, "POST /msp/change-freeze-windows failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, "Failed to create freeze window");
    }
  },
);

const patchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  reason: z.string().trim().max(2_000).nullable().optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  recurrence: z.enum(CHANGE_FREEZE_RECURRENCES).optional(),
  recurrenceUntil: z.string().datetime().nullable().optional(),
  active: z.boolean().optional(),
});

router.patch(
  "/msp/change-freeze-windows/:id",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response): Promise<void> => {
    const mspId = resolveMspIdStrict(req);
    if (mspId === null) {
      res.status(403).json({ error: "MSP context required" });
      return;
    }
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid freeze window id");
      return;
    }
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid freeze window update", parsed.error.flatten());
      return;
    }

    try {
      const [existing] = await db
        .select()
        .from(changeFreezeWindowsTable)
        .where(and(eq(changeFreezeWindowsTable.id, id), eq(changeFreezeWindowsTable.mspId, mspId)))
        .limit(1);
      if (!existing) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "Freeze window not found");
        return;
      }

      const body = parsed.data;
      const nextStartsAt = body.startsAt ? new Date(body.startsAt) : existing.startsAt;
      const nextEndsAt = body.endsAt ? new Date(body.endsAt) : existing.endsAt;
      if (nextEndsAt.getTime() <= nextStartsAt.getTime()) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "endsAt must be after startsAt");
        return;
      }

      const [updated] = await db
        .update(changeFreezeWindowsTable)
        .set({
          name: body.name ?? existing.name,
          reason: body.reason !== undefined ? body.reason : existing.reason,
          startsAt: nextStartsAt,
          endsAt: nextEndsAt,
          recurrence: body.recurrence ?? existing.recurrence,
          recurrenceUntil: body.recurrenceUntil !== undefined
            ? (body.recurrenceUntil ? new Date(body.recurrenceUntil) : null)
            : existing.recurrenceUntil,
          active: body.active ?? existing.active,
          updatedAt: new Date(),
        })
        .where(eq(changeFreezeWindowsTable.id, id))
        .returning();

      log.info({ mspId, freezeWindowId: id, active: updated.active }, "change freeze window updated");
      res.json({ window: toWire(updated) });
    } catch (err) {
      log.error({ err, mspId, freezeWindowId: id }, "PATCH /msp/change-freeze-windows/:id failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, "Failed to update freeze window");
    }
  },
);

export default router;
