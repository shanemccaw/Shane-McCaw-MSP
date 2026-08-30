/**
 * msp-vip-classifications.ts — MSP-side authoring of the Policy Engine's VIP
 * classification object (#1552).
 *
 *   GET  /api/msp/vip-classifications           — this customer's current classifications
 *   POST /api/msp/vip-classifications           — Told: the platform decision (always wins)
 *   POST /api/msp/vip-classifications/discover  — seed from group/attribute read hints
 *
 * ── The resolved question this route enforces ────────────────────────────────
 * #1552's own resolution (2026-08-28): a user becomes VIP by one of three
 * routes — Told, group membership, AD attribute — but they are NOT equal
 * truth-holders. THE PLATFORM IS AUTHORITATIVE, not the tenant.
 *
 *   - "Told" is a decision made HERE. It always wins and is the only route
 *     that may move an existing classification.
 *   - Group membership / AD attribute are read hints used only for DISCOVERY —
 *     useful at onboarding to seed who is already VIP in an existing estate.
 *     Once a classification exists for a principal (by ANY source), a
 *     discovery call never overwrites it — that precedence is enforced here,
 *     at the write path, not left to a reader to reconstruct. A tenant-side
 *     change to an existing classification is DRIFT for #1553 to surface as a
 *     finding, not a value this route adopts.
 *
 * ── Scope of THIS route ──────────────────────────────────────────────────────
 * Read + author only. De-VIP is a "told" call with isVip=false — no separate
 * lifecycle endpoint, because de-VIP is a decision, not a state machine, per
 * the resolution. The runbook that PROPAGATES a told decision outward (#1548's
 * enactment path) and the drift/finding detection for a tenant-side removal
 * (#1553) are both separate builds; this route ends at the wire contract.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, vipClassificationsTable, tenantsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { requireAuth, requireRole } from "../middlewares/requireAuth";
import { resolveMspIdStrict } from "../lib/resolve-msp-id";
import { personIdForUser } from "../lib/portal-ownership";
import { apiError, ApiErrorCode } from "../lib/api-helpers";
import { logger } from "../lib/logger";
import { toWireVipClassification, VIP_DISCOVERY_SOURCES } from "../lib/vip-classifications";

const log = logger.child({ channel: "tenant.lifecycle" });

const router: IRouter = Router();

/** The identity a "told" classification is stamped with. Never "the system". */
function actorIdentity(req: Request): { personId: string; name: string } {
  const user = req.user!;
  return {
    personId: personIdForUser(user.id),
    name: (user.email ?? "").trim() || `User ${user.id}`,
  };
}

/** True only if `customerId` is a real tenant owned by `mspId`. */
async function customerBelongsToMsp(customerId: number, mspId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: tenantsTable.id })
    .from(tenantsTable)
    .where(and(eq(tenantsTable.id, customerId), eq(tenantsTable.mspId, mspId)))
    .limit(1);
  return !!row;
}

// ── List ────────────────────────────────────────────────────────────────────
router.get(
  "/msp/vip-classifications",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) {
        apiError(res, 403, ApiErrorCode.FORBIDDEN, "MSP context required");
        return;
      }

      const customerId = Number(req.query.customerId);
      if (!Number.isInteger(customerId) || customerId <= 0) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "customerId is required");
        return;
      }
      if (!(await customerBelongsToMsp(customerId, mspId))) {
        apiError(res, 403, ApiErrorCode.FORBIDDEN, "That customer is not in this MSP's book");
        return;
      }

      const rows = await db
        .select()
        .from(vipClassificationsTable)
        .where(eq(vipClassificationsTable.customerId, customerId))
        .orderBy(vipClassificationsTable.principalUpn);

      res.json({ classifications: rows.map(toWireVipClassification) });
    } catch (err: unknown) {
      log.error({ err }, "GET /api/msp/vip-classifications failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

// ── Told — the platform decision, always wins ───────────────────────────────
const toldSchema = z.object({
  customerId: z.number().int().positive(),
  principalId: z.string().trim().min(1),
  principalUpn: z.string().trim().min(1),
  isVip: z.boolean(),
});

router.post(
  "/msp/vip-classifications",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) {
        apiError(res, 403, ApiErrorCode.FORBIDDEN, "MSP context required");
        return;
      }

      const parsed = toldSchema.safeParse(req.body);
      if (!parsed.success) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid VIP classification", parsed.error.flatten());
        return;
      }
      const { customerId, principalId, principalUpn, isVip } = parsed.data;

      if (!(await customerBelongsToMsp(customerId, mspId))) {
        apiError(res, 403, ApiErrorCode.FORBIDDEN, "That customer is not in this MSP's book");
        return;
      }

      const actor = actorIdentity(req);
      const now = new Date();

      // "Told" always wins — upsert regardless of what source previously held
      // this principal's row (a prior discovery seed, or an earlier told call).
      const [row] = await db
        .insert(vipClassificationsTable)
        .values({
          customerId,
          principalId,
          principalUpn,
          isVip,
          source: "told",
          discoveryDetail: null,
          classifiedByPersonId: actor.personId,
          classifiedByName: actor.name,
          classifiedAt: now,
        })
        .onConflictDoUpdate({
          target: [vipClassificationsTable.customerId, vipClassificationsTable.principalId],
          set: {
            principalUpn,
            isVip,
            source: "told",
            discoveryDetail: null,
            classifiedByPersonId: actor.personId,
            classifiedByName: actor.name,
            classifiedAt: now,
            updatedAt: now,
          },
        })
        .returning();

      log.info(
        { mspId, customerId, principalId, isVip, actor: actor.personId },
        isVip ? "VIP classification told: classified as VIP" : "VIP classification told: de-VIP",
      );
      res.status(200).json(toWireVipClassification(row));
    } catch (err: unknown) {
      log.error({ err }, "POST /api/msp/vip-classifications failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

// ── Discover — seed-only-if-absent, never overwrites ────────────────────────
const discoverySchema = z.object({
  customerId: z.number().int().positive(),
  principals: z
    .array(
      z.object({
        principalId: z.string().trim().min(1),
        principalUpn: z.string().trim().min(1),
        isVip: z.boolean(),
        source: z.enum(VIP_DISCOVERY_SOURCES),
        discoveryDetail: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .min(1)
    .max(1_000),
});

router.post(
  "/msp/vip-classifications/discover",
  requireAuth,
  requireRole("MSPOperator"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) {
        apiError(res, 403, ApiErrorCode.FORBIDDEN, "MSP context required");
        return;
      }

      const parsed = discoverySchema.safeParse(req.body);
      if (!parsed.success) {
        apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid discovery seed batch", parsed.error.flatten());
        return;
      }
      const { customerId, principals } = parsed.data;

      if (!(await customerBelongsToMsp(customerId, mspId))) {
        apiError(res, 403, ApiErrorCode.FORBIDDEN, "That customer is not in this MSP's book");
        return;
      }

      let seeded = 0;
      const skipped: string[] = [];
      for (const p of principals) {
        const inserted = await db
          .insert(vipClassificationsTable)
          .values({
            customerId,
            principalId: p.principalId,
            principalUpn: p.principalUpn,
            isVip: p.isVip,
            source: p.source,
            discoveryDetail: p.discoveryDetail ?? null,
            classifiedByPersonId: null,
            classifiedByName: null,
          })
          // Never overwrites — a classification of ANY source (told, or an
          // earlier discovery seed) is already decided.
          .onConflictDoNothing({
            target: [vipClassificationsTable.customerId, vipClassificationsTable.principalId],
          })
          .returning({ id: vipClassificationsTable.id });

        if (inserted.length > 0) {
          seeded++;
        } else {
          skipped.push(p.principalId);
        }
      }

      log.info({ mspId, customerId, seeded, skippedCount: skipped.length }, "VIP classification discovery seed run");
      res.status(200).json({ seeded, skipped });
    } catch (err: unknown) {
      log.error({ err }, "POST /api/msp/vip-classifications/discover failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

export default router;
