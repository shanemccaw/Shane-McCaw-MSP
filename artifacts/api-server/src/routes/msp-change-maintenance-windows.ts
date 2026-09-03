/**
 * msp-change-maintenance-windows.ts — MSP-console CRUD for the Change Control
 * maintenance-window calendar (#1504).
 *
 *   GET   /api/msp/change-maintenance-windows       — this MSP's windows
 *   POST  /api/msp/change-maintenance-windows       — create a window
 *   PATCH /api/msp/change-maintenance-windows/:id   — edit a window (incl. retire it)
 *
 * Mirrors `msp-change-freeze-windows.ts` exactly — same CRUD shape, same
 * scoping (`resolveMspIdStrict`), same `active: false` retire-not-delete
 * discipline — for the OPPOSITE calendar: a maintenance window is when
 * change is EXPECTED, a freeze window is when it is FORBIDDEN. See the
 * Drizzle schema's own header on why these stay two tables.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  changeMaintenanceWindowsTable,
  CHANGE_MAINTENANCE_SCOPES,
  CHANGE_MAINTENANCE_RECURRENCES,
  type ChangeMaintenanceWindow,
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

/** One maintenance window, as the MSP console consumes it. */
interface WireMaintenanceWindow {
  readonly id: number;
  readonly scope: (typeof CHANGE_MAINTENANCE_SCOPES)[number];
  readonly tenantId: string | null;
  readonly workload: string | null;
  readonly name: string;
  readonly reason: string | null;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly recurrence: (typeof CHANGE_MAINTENANCE_RECURRENCES)[number];
  readonly recurrenceUntil: string | null;
  readonly active: boolean;
  readonly createdBy: string | null;
  readonly createdAt: string;
}

function toWire(row: ChangeMaintenanceWindow): WireMaintenanceWindow {
  return {
    id: row.id,
    scope: row.scope as (typeof CHANGE_MAINTENANCE_SCOPES)[number],
    tenantId: row.tenantId,
    workload: row.workload,
    name: row.name,
    reason: row.reason,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    recurrence: row.recurrence as (typeof CHANGE_MAINTENANCE_RECURRENCES)[number],
    recurrenceUntil: row.recurrenceUntil ? row.recurrenceUntil.toISOString() : null,
    active: row.active,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

router.get(
  "/msp/change-maintenance-windows",
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
        .from(changeMaintenanceWindowsTable)
        .where(eq(changeMaintenanceWindowsTable.mspId, mspId))
        .orderBy(desc(changeMaintenanceWindowsTable.startsAt));
      res.json({ windows: rows.map(toWire) });
    } catch (err) {
      log.error({ err, mspId }, "GET /msp/change-maintenance-windows failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, "Failed to load maintenance windows");
    }
  },
);

const createSchema = z
  .object({
    scope: z.enum(CHANGE_MAINTENANCE_SCOPES),
    tenantId: z.string().trim().max(200).optional(),
    workload: z.enum(CHANGE_REQUEST_WORKLOADS).optional(),
    name: z.string().trim().min(1).max(200),
    reason: z.string().trim().max(2_000).optional(),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    recurrence: z.enum(CHANGE_MAINTENANCE_RECURRENCES).default("none"),
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
  "/msp/change-maintenance-windows",
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
      apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid maintenance window", parsed.error.flatten());
      return;
    }
    const body = parsed.data;
    try {
      const [inserted] = await db
        .insert(changeMaintenanceWindowsTable)
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
      log.info({ mspId, maintenanceWindowId: inserted.id, scope: body.scope, recurrence: body.recurrence }, "change maintenance window created");
      res.status(201).json({ window: toWire(inserted) });
    } catch (err) {
      log.error({ err, mspId }, "POST /msp/change-maintenance-windows failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, "Failed to create maintenance window");
    }
  },
);

const patchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  reason: z.string().trim().max(2_000).nullable().optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  recurrence: z.enum(CHANGE_MAINTENANCE_RECURRENCES).optional(),
  recurrenceUntil: z.string().datetime().nullable().optional(),
  active: z.boolean().optional(),
});

router.patch(
  "/msp/change-maintenance-windows/:id",
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
      apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid maintenance window id");
      return;
    }
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid maintenance window update", parsed.error.flatten());
      return;
    }

    try {
      const [existing] = await db
        .select()
        .from(changeMaintenanceWindowsTable)
        .where(and(eq(changeMaintenanceWindowsTable.id, id), eq(changeMaintenanceWindowsTable.mspId, mspId)))
        .limit(1);
      if (!existing) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "Maintenance window not found");
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
        .update(changeMaintenanceWindowsTable)
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
        .where(eq(changeMaintenanceWindowsTable.id, id))
        .returning();

      log.info({ mspId, maintenanceWindowId: id, active: updated.active }, "change maintenance window updated");
      res.json({ window: toWire(updated) });
    } catch (err) {
      log.error({ err, mspId, maintenanceWindowId: id }, "PATCH /msp/change-maintenance-windows/:id failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, "Failed to update maintenance window");
    }
  },
);

export default router;
