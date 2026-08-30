/**
 * msp-change-catalog.ts — MSP-side authoring and governance of the Standard
 * Change Catalog (#1498).
 *
 *   GET  /api/msp/change-catalog             — this MSP's catalog items
 *   POST /api/msp/change-catalog             — author a new item (starts as `draft`)
 *   POST /api/msp/change-catalog/:id/approve — the signed, dated approval decision
 *   POST /api/msp/change-catalog/:id/revoke  — the signed, dated, reasoned revocation
 *
 * ── What a catalog item is, and why approval/revocation live here ───────────
 * A catalog item points at a `packKey` — a real, already-built config pack (the
 * runbook). "Approve once, execute many": once an item carries `status =
 * 'approved'`, any change request raised from it (see
 * `routes/portal-change-catalog.ts`) inherits that approval and skips CAB —
 * `requiredStages()` returns 0 for a `standard` change class regardless of risk
 * (`lib/portal-change-approvals.ts`). That makes approving/revoking a catalog
 * item a materially different act than editing any other config row: it is
 * itself the authorisation every future execution will point back to. Hence a
 * SIGNED (real person, never "the system"), DATED, and — for revocation —
 * REASONED decision, floored at `MSPAdmin` rather than the `MSPOperator` floor
 * routine CRUD uses elsewhere in this file.
 *
 * ── #1554 / #1555, implemented as written ────────────────────────────────────
 * No partial approval, no mid-run pause — an item is `draft`, `approved`, or
 * `revoked`, covering the WHOLE item, never a subset of the pack it points at.
 * No expiry, no review cycle — there is deliberately no date-based field that
 * would lapse an approval on its own; `revoke` is the only way out of
 * `approved`, and it is immediate: `portal-change-catalog.ts`'s execute route
 * re-reads `status` live on every call, never a cached value.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, changeCatalogItemsTable, configPacksTable, type ChangeCatalogItem } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { requireAuth, requireRole } from "../middlewares/requireAuth";
import { resolveMspIdStrict } from "../lib/resolve-msp-id";
import { personIdForUser } from "../lib/portal-ownership";
import { apiError, ApiErrorCode } from "../lib/api-helpers";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "workflow.change-control" });

const router: IRouter = Router();

const CATEGORIES = ["ConditionalAccess", "Exchange", "Identity", "Intune", "Defender", "SharePoint", "Purview", "Teams"] as const;
const RISK_LEVELS = ["critical", "high", "medium", "low"] as const;

/** The identity a governance decision (approve/revoke) is signed with. Never "the system". */
function actorIdentity(req: Request): { personId: string; name: string } {
  const user = req.user!;
  return {
    personId: personIdForUser(user.id),
    name: (user.email ?? "").trim() || `User ${user.id}`,
  };
}

interface WireChangeCatalogItem {
  readonly id: number;
  readonly packKey: string;
  readonly packLabel: string;
  readonly packStatus: string;
  readonly title: string;
  readonly description: string;
  readonly category: string;
  readonly riskLevel: string;
  readonly status: ChangeCatalogItem["status"];
  readonly approvedByName: string | null;
  readonly approvedAt: string | null;
  readonly revokedByName: string | null;
  readonly revokedAt: string | null;
  readonly revokedReason: string | null;
  readonly createdByName: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

function toWire(row: ChangeCatalogItem, packLabel: string, packStatus: string): WireChangeCatalogItem {
  return {
    id: row.id,
    packKey: row.packKey,
    packLabel,
    packStatus,
    title: row.title,
    description: row.description,
    category: row.category,
    riskLevel: row.riskLevel,
    status: row.status,
    approvedByName: row.approvedByName,
    approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
    revokedByName: row.revokedByName,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    revokedReason: row.revokedReason,
    createdByName: row.createdByName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ── List ──────────────────────────────────────────────────────────────────────
router.get(
  "/msp/change-catalog",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) {
        apiError(res, 403, ApiErrorCode.FORBIDDEN, "MSP context required");
        return;
      }

      const rows = await db
        .select({
          item: changeCatalogItemsTable,
          packLabel: configPacksTable.label,
          packStatus: configPacksTable.status,
        })
        .from(changeCatalogItemsTable)
        .leftJoin(configPacksTable, eq(changeCatalogItemsTable.packKey, configPacksTable.packKey))
        .where(eq(changeCatalogItemsTable.mspId, mspId))
        .orderBy(desc(changeCatalogItemsTable.id));

      res.json({ items: rows.map((r) => toWire(r.item, r.packLabel ?? r.item.packKey, r.packStatus ?? "unknown")) });
    } catch (err: unknown) {
      log.error({ err }, "GET /api/msp/change-catalog failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

// ── Author (draft) ───────────────────────────────────────────────────────────
const createSchema = z.object({
  packKey: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2_000).optional(),
  category: z.enum(CATEGORIES).default("Identity"),
  riskLevel: z.enum(RISK_LEVELS).default("low"),
});

router.post(
  "/msp/change-catalog",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) {
        apiError(res, 403, ApiErrorCode.FORBIDDEN, "MSP context required");
        return;
      }

      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid catalog item", parsed.error.flatten());
        return;
      }

      const [pack] = await db
        .select({ packKey: configPacksTable.packKey, label: configPacksTable.label, status: configPacksTable.status })
        .from(configPacksTable)
        .where(eq(configPacksTable.packKey, parsed.data.packKey))
        .limit(1);
      if (!pack) {
        apiError(res, 400, ApiErrorCode.VALIDATION, `Config pack '${parsed.data.packKey}' does not exist`);
        return;
      }

      const actor = actorIdentity(req);
      const [inserted] = await db
        .insert(changeCatalogItemsTable)
        .values({
          mspId,
          packKey: parsed.data.packKey,
          title: parsed.data.title,
          description: parsed.data.description ?? "",
          category: parsed.data.category,
          riskLevel: parsed.data.riskLevel,
          status: "draft",
          createdByPersonId: actor.personId,
          createdByName: actor.name,
        })
        .returning();

      log.info({ mspId, catalogItemId: inserted.id, packKey: pack.packKey }, "standard change catalog item drafted");
      res.status(201).json(toWire(inserted, pack.label, pack.status));
    } catch (err: unknown) {
      log.error({ err }, "POST /api/msp/change-catalog failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

/** Loads a catalog item scoped to the caller's own MSP — the cross-MSP guard every mutation below shares. */
async function loadScopedItem(id: number, mspId: number) {
  const [row] = await db
    .select()
    .from(changeCatalogItemsTable)
    .where(and(eq(changeCatalogItemsTable.id, id), eq(changeCatalogItemsTable.mspId, mspId)))
    .limit(1);
  return row ?? null;
}

function parseIdParam(res: Response, raw: string): number | null {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid catalog item id");
    return null;
  }
  return id;
}

// ── Approve — the signed, dated decision ─────────────────────────────────────
//
// Floored at MSPAdmin, not MSPOperator: this is the authority every future
// auto-approved CR raised from this item will inherit, so it is deliberately a
// higher bar than authoring the draft.
router.post(
  "/msp/change-catalog/:id/approve",
  requireAuth,
  requireRole("MSPAdmin"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) {
        apiError(res, 403, ApiErrorCode.FORBIDDEN, "MSP context required");
        return;
      }
      const id = parseIdParam(res, String(req.params.id));
      if (id === null) return;

      const item = await loadScopedItem(id, mspId);
      if (!item) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "Catalog item not found");
        return;
      }

      const [pack] = await db
        .select({ status: configPacksTable.status, label: configPacksTable.label })
        .from(configPacksTable)
        .where(eq(configPacksTable.packKey, item.packKey))
        .limit(1);
      if (!pack || pack.status !== "active") {
        apiError(
          res,
          409,
          ApiErrorCode.CONFLICT,
          `Cannot approve — config pack '${item.packKey}' is not active`,
        );
        return;
      }

      const actor = actorIdentity(req);
      const now = new Date();
      const [updated] = await db
        .update(changeCatalogItemsTable)
        .set({
          status: "approved",
          approvedByPersonId: actor.personId,
          approvedByName: actor.name,
          approvedAt: now,
          // A fresh approval supersedes any prior revocation — the current
          // state is "approved", so no stale revocation should linger beside it.
          revokedByPersonId: null,
          revokedByName: null,
          revokedAt: null,
          revokedReason: null,
          updatedAt: now,
        })
        .where(eq(changeCatalogItemsTable.id, id))
        .returning();

      log.info({ mspId, catalogItemId: id, approvedBy: actor.name }, "standard change catalog item approved");
      res.json(toWire(updated, pack.label, pack.status));
    } catch (err: unknown) {
      log.error({ err }, "POST /api/msp/change-catalog/:id/approve failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

// ── Revoke — the control, and it is immediate (#1555) ────────────────────────
const revokeSchema = z.object({ reason: z.string().trim().min(1).max(2_000) });

router.post(
  "/msp/change-catalog/:id/revoke",
  requireAuth,
  requireRole("MSPAdmin"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) {
        apiError(res, 403, ApiErrorCode.FORBIDDEN, "MSP context required");
        return;
      }
      const id = parseIdParam(res, String(req.params.id));
      if (id === null) return;

      const parsed = revokeSchema.safeParse(req.body);
      if (!parsed.success) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "A revocation reason is required", parsed.error.flatten());
        return;
      }

      const item = await loadScopedItem(id, mspId);
      if (!item) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "Catalog item not found");
        return;
      }
      if (item.status !== "approved") {
        apiError(res, 409, ApiErrorCode.CONFLICT, `Cannot revoke — item is '${item.status}', not 'approved'`);
        return;
      }

      const actor = actorIdentity(req);
      const now = new Date();
      const [updated] = await db
        .update(changeCatalogItemsTable)
        .set({
          status: "revoked",
          revokedByPersonId: actor.personId,
          revokedByName: actor.name,
          revokedAt: now,
          revokedReason: parsed.data.reason,
          updatedAt: now,
        })
        .where(eq(changeCatalogItemsTable.id, id))
        .returning();

      const [pack] = await db
        .select({ status: configPacksTable.status, label: configPacksTable.label })
        .from(configPacksTable)
        .where(eq(configPacksTable.packKey, item.packKey))
        .limit(1);

      log.info({ mspId, catalogItemId: id, revokedBy: actor.name, reason: parsed.data.reason }, "standard change catalog item revoked");
      res.json(toWire(updated, pack?.label ?? item.packKey, pack?.status ?? "unknown"));
    } catch (err: unknown) {
      log.error({ err }, "POST /api/msp/change-catalog/:id/revoke failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

export default router;
