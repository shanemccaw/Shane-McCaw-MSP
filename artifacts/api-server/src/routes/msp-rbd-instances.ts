/**
 * msp-rbd-instances.ts — the RBD's line items, MSP-side (#1509, part of #1487).
 *
 *   GET   /api/msp/rbd/:rbdId/instances                    — every line item for a container
 *   POST  /api/msp/rbd/:rbdId/instances                     — add a line item (found)
 *   PATCH /api/msp/rbd/:rbdId/instances/:instanceId/accept  — accept a single line item
 *   PATCH /api/msp/rbd/:rbdId/instances/:instanceId/resolve — record why a line left
 *
 * MSP-side only, matching `msp-rbd.ts` and `msp-rbd-versions.ts` (#1508) next
 * door — there is no customer-portal counterpart in this build. `SCOPE STOP`
 * on #1509 ends this build at the wire contract: no `artifacts/portal` page
 * exists to wire this to yet (`Design/portal/` carries no export for this
 * module).
 *
 * Container resolution: `rbdId` in the path resolves to the `msp_risk_decisions`
 * row for (mspId, rbdId) — the existing unique constraint on that table means
 * exactly one such row exists. A line item's own primary key
 * (`risk_decision_id`) is what it actually FKs to; the route resolves the
 * container once per request so callers only ever need the human-facing rbdId,
 * matching every other RBD route's addressing scheme.
 *
 * Auth: `requireRole("MSPOperator")` to list/add a line (same floor as
 * `POST /api/msp/rbd` and capturing a version); `requireRole("MSPAdmin")` to
 * accept or resolve one — accepting or closing out a line carries the same
 * weight as signing/revoking the container itself, matching
 * `msp-rbd.ts`'s existing sign/revoke floor. Scoped by `resolveMspIdStrict`,
 * never taken from the request body.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { requireAuth, requireRole } from "../middlewares/requireAuth.ts";
import { resolveMspIdStrict } from "../lib/resolve-msp-id.ts";
import { apiError, ApiErrorCode } from "../lib/api-helpers.ts";
import { logger } from "../lib/logger.ts";
import {
  addRiskInstance,
  acceptRiskInstance,
  listRiskInstancesByRbdId,
  resolveRiskInstance,
} from "../lib/rbd-instances.ts";
import { db, mspRiskDecisionsTable, RISK_INSTANCE_EXIT_REASONS, type RiskInstance } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

const log = logger.child({ channel: "tenant.portal" });

const router: IRouter = Router();

/** One line item, on the wire. */
interface WireRiskInstance {
  readonly id: number;
  readonly rbdId: string;
  readonly label: string;
  readonly objectId: string | null;
  readonly foundAt: string;
  readonly acceptedAt: string | null;
  readonly status: string;
  readonly resolvedAt: string | null;
  readonly resolutionNote: string | null;
}

function iso(value: Date | null | undefined): string | null {
  return value instanceof Date ? value.toISOString() : null;
}

function toWireInstance(row: RiskInstance): WireRiskInstance {
  return {
    id: row.id,
    rbdId: row.rbdId,
    label: row.label,
    objectId: row.objectId ?? null,
    foundAt: iso(row.foundAt) as string,
    acceptedAt: iso(row.acceptedAt),
    status: row.status,
    resolvedAt: iso(row.resolvedAt),
    resolutionNote: row.resolutionNote ?? null,
  };
}

/** Resolves the container row for (mspId, rbdId), or writes 404 and returns null. */
async function resolveContainerOrNotFound(mspId: number, rbdId: string, res: Response): Promise<number | null> {
  const [container] = await db
    .select({ id: mspRiskDecisionsTable.id })
    .from(mspRiskDecisionsTable)
    .where(and(eq(mspRiskDecisionsTable.rbdId, rbdId), eq(mspRiskDecisionsTable.mspId, mspId)))
    .limit(1);
  if (!container) {
    apiError(res, 404, ApiErrorCode.NOT_FOUND, "Risk-Based Decision not found");
    return null;
  }
  return container.id;
}

// GET /api/msp/rbd/:rbdId/instances — every line item for a container.
router.get(
  "/msp/rbd/:rbdId/instances",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) {
        apiError(res, 403, ApiErrorCode.FORBIDDEN, "MSP context required");
        return;
      }
      const rbdId = String(req.params.rbdId);
      const containerId = await resolveContainerOrNotFound(mspId, rbdId, res);
      if (containerId === null) return;

      const rows = await listRiskInstancesByRbdId(mspId, rbdId);
      res.json({ rbdId, instances: rows.map(toWireInstance) });
    } catch (err: unknown) {
      log.error({ err }, "GET /api/msp/rbd/:rbdId/instances failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

const addInstanceSchema = z.object({
  label: z.string().min(1),
  objectId: z.string().nullable().optional(),
  /** Defaults to now if omitted — most lines are added at discovery time. */
  foundAt: z.string().datetime().nullable().optional(),
});

// POST /api/msp/rbd/:rbdId/instances — add a line item (found).
router.post(
  "/msp/rbd/:rbdId/instances",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) {
        apiError(res, 403, ApiErrorCode.FORBIDDEN, "MSP context required");
        return;
      }
      const rbdId = String(req.params.rbdId);
      const containerId = await resolveContainerOrNotFound(mspId, rbdId, res);
      if (containerId === null) return;

      const parsed = addInstanceSchema.safeParse(req.body);
      if (!parsed.success) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid line item payload", parsed.error.flatten());
        return;
      }

      const created = await addRiskInstance({
        mspId,
        riskDecisionId: containerId,
        rbdId,
        label: parsed.data.label,
        objectId: parsed.data.objectId ?? null,
        foundAt: parsed.data.foundAt ? new Date(parsed.data.foundAt) : new Date(),
      });
      if (!created) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "Risk-Based Decision not found");
        return;
      }

      log.info({ mspId, rbdId, instanceId: created.id }, "risk instance added");
      res.status(201).json({ instance: toWireInstance(created) });
    } catch (err: unknown) {
      log.error({ err }, "POST /api/msp/rbd/:rbdId/instances failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

// PATCH /api/msp/rbd/:rbdId/instances/:instanceId/accept — accept a single
// line item. Never editable after the fact: only an unaccepted instance may
// be accepted.
router.patch(
  "/msp/rbd/:rbdId/instances/:instanceId/accept",
  requireAuth,
  requireRole("MSPAdmin"),
  async (req: Request, res: Response) => {
    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) {
        apiError(res, 403, ApiErrorCode.FORBIDDEN, "MSP context required");
        return;
      }
      const rbdId = String(req.params.rbdId);
      const containerId = await resolveContainerOrNotFound(mspId, rbdId, res);
      if (containerId === null) return;

      const instanceId = Number(req.params.instanceId);
      if (!Number.isInteger(instanceId)) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid instance id");
        return;
      }

      const updated = await acceptRiskInstance(mspId, instanceId);
      if (!updated) {
        apiError(res, 409, ApiErrorCode.CONFLICT, "Instance not found or already accepted");
        return;
      }

      log.info({ mspId, rbdId, instanceId }, "risk instance accepted");
      res.json({ instance: toWireInstance(updated) });
    } catch (err: unknown) {
      log.error({ err }, "PATCH /api/msp/rbd/:rbdId/instances/:instanceId/accept failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

const resolveInstanceSchema = z.object({
  /** Why the line left — remediated vs. the object ceasing to exist (#1509). */
  reason: z.enum(RISK_INSTANCE_EXIT_REASONS as unknown as [string, ...string[]]),
  note: z.string().nullable().optional(),
});

// PATCH /api/msp/rbd/:rbdId/instances/:instanceId/resolve — record why a line
// left. Neither exit reason requires a signature (#1509); only an `active`
// instance may resolve.
router.patch(
  "/msp/rbd/:rbdId/instances/:instanceId/resolve",
  requireAuth,
  requireRole("MSPAdmin"),
  async (req: Request, res: Response) => {
    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) {
        apiError(res, 403, ApiErrorCode.FORBIDDEN, "MSP context required");
        return;
      }
      const rbdId = String(req.params.rbdId);
      const containerId = await resolveContainerOrNotFound(mspId, rbdId, res);
      if (containerId === null) return;

      const instanceId = Number(req.params.instanceId);
      if (!Number.isInteger(instanceId)) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid instance id");
        return;
      }

      const parsed = resolveInstanceSchema.safeParse(req.body);
      if (!parsed.success) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid resolution payload", parsed.error.flatten());
        return;
      }

      const updated = await resolveRiskInstance(
        mspId,
        instanceId,
        parsed.data.reason as "remediated" | "object_removed",
        parsed.data.note ?? null,
      );
      if (!updated) {
        apiError(res, 409, ApiErrorCode.CONFLICT, "Instance not found or not active");
        return;
      }

      log.info({ mspId, rbdId, instanceId, reason: parsed.data.reason }, "risk instance resolved");
      res.json({ instance: toWireInstance(updated) });
    } catch (err: unknown) {
      log.error({ err }, "PATCH /api/msp/rbd/:rbdId/instances/:instanceId/resolve failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

export default router;
