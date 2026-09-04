/**
 * portal-remediation-checklist.ts — the checklist derived from findings (#1538).
 *
 *   GET /api/portal/remediation/checklist
 *     — the calling customer's tenant, resolved from their LATEST scan's real
 *       adverse findings. One item per open finding, each carrying its fix
 *       route (#1539) and the tracker's current claim about it.
 *   PUT /api/portal/remediation/checklist/:checkKey
 *     — record the customer's claim about ONE item. Same idempotent-upsert,
 *       same status vocabulary and same verification-reset-on-write rule as
 *       `portal-remediation-tracker.ts`'s s1–s30 world — this is that same
 *       table, just addressed by the finding's own identity.
 *   POST /api/portal/remediation/checklist/:checkKey/raise-change
 *     — raise a real Change Request FROM this checklist item (#1941): builds
 *       the CR body from the finding itself (`lib/remediation-raise-change.ts`)
 *       and inserts it through the SAME `raiseChangeRequest` the wizard's
 *       `POST /portal/change-control` uses, with `remediationCheckKey` set to
 *       this item's checkKey — the real row #1541's reveal gate has had
 *       nothing to authorize until now.
 *
 * WHY THIS IS A SEPARATE ROUTE FROM `portal-remediation-tracker.ts`
 * -------------------------------------------------------------------
 * That route's `STEP_ID_SET` guard intentionally rejects anything outside the
 * hand-authored `s1`…`s30` catalogue (belt-and-braces against a step being
 * renumbered out from under a stale write). This route is the new, additive
 * address space #1538 establishes: any real `monitor_checks.key` a current
 * finding names. Both write the exact same `remediation_tracker_steps` table
 * — `step_id` is plain text with no CHECK constraint — so this needed no
 * schema change and does not touch the s1–s30 rows, route, export or
 * verification job at all.
 *
 * SCOPE STOP: this ends at the wire contract. There is no `artifacts/portal`
 * page for Remediation Tracking yet (no design export exists for this module).
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, remediationTrackerStepsTable, REMEDIATION_TRACKER_STEP_STATUS } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { requireRole } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { resolveRemediationChecklist, resolveRemediationChecklistItem, isKnownCheckKey } from "../lib/remediation-checklist";
import { logRetainerWorkFromTracker } from "../lib/retainer-work-logger";
import { buildRaiseChangeRequestInputForChecklistItem } from "../lib/remediation-raise-change";
import { raiseChangeRequest, RaiseChangeRequestError } from "../lib/portal-change-control-raise";
import { resolveTenantScope } from "../lib/portal-customer-scope";
import { declineRemediationChecklistItemToRisk } from "../lib/remediation-tracker-risk-decline";

/** Roles that represent SHANE / the MSP acting — see portal-remediation-tracker.ts's own note on why the retainer hook is scoped to these only. */
const RETAINER_MSP_ACTOR_ROLES = new Set(["admin", "PlatformAdmin", "MSPOperator", "MSPAdmin"]);

const log = logger.child({ channel: "engine.remediation-tracker" });

const router: IRouter = Router();

const putItemSchema = z.object({
  status: z.enum(REMEDIATION_TRACKER_STEP_STATUS),
});

// Same shape as portal-remediation-tracker.ts's own decline-to-risk schema —
// a typed full name + explicit confirmation, because this creates a signed
// liability record. `fullName` is not checked against the account's own name
// for the same reason that route documents: the person signing may
// legitimately be signing in a role, and the JWT-derived actor (logged below)
// is the separately-recorded real identity claim.
const declineToRiskSchema = z.object({
  fullName: z.string().trim().min(2, "Type your full name to accept this risk").max(200),
  confirmed: z.literal(true),
  statement: z.string().trim().min(1).max(2000),
});

/** tenants.id off the JWT's `customerId` claim — same resolution as the rest of this journey. */
function resolveCustomerId(req: Request): number | null {
  const id = (req.user as { customerId?: number } | undefined)?.customerId;
  return typeof id === "number" && !isNaN(id) ? id : null;
}

// ── Read: the findings-derived checklist ────────────────────────────────────
router.get(
  "/portal/remediation/checklist",
  requireRole("Assessment"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    try {
      const result = await resolveRemediationChecklist(customerId);
      res.json(result);
    } catch (err) {
      log.error({ err, customerId }, "GET /portal/remediation/checklist failed");
      res.status(500).json({ error: "Failed to resolve remediation checklist" });
    }
  },
);

// ── Write: the customer's claim about one item, keyed by its checkKey ───────
router.put(
  "/portal/remediation/checklist/:checkKey",
  requireRole("Assessment"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    const checkKey = String(req.params.checkKey ?? "");
    const parsed = putItemSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
      return;
    }

    if (!(await isKnownCheckKey(checkKey))) {
      res.status(400).json({ error: "Unknown check key" });
      return;
    }

    const { status } = parsed.data;

    // #2827 — same signed-fact rule as portal-remediation-tracker.ts's s1–s30
    // PUT: `accepted_risk` is ONLY ever set alongside a real, SIGNED
    // `msp_risk_decisions` row (see that route's own header). #2869 gives this
    // route its own decline flow, so reject a bare PUT and point at it rather
    // than letting a bare write fabricate the same unsigned "accepted" state
    // the s1–s30 route already guards against on this identical table.
    if (status === "accepted_risk") {
      res.status(400).json({ error: "accepted_risk cannot be set directly — use POST .../decline-to-risk" });
      return;
    }

    const now = new Date();
    const completedAt = status === "completed" ? now : null;
    const userId = typeof req.user?.id === "number" ? req.user.id : null;

    // Same rule as portal-remediation-tracker.ts: a changed claim invalidates
    // whatever the last rescan confirmed or flagged. Verification for
    // checkKey-keyed rows is set by the SAME `reverifyRemediationTrackerSteps()`
    // job — `mappedKeysFor()` there (#1538) self-maps any step_id outside the
    // legacy s1–s30 catalogue to its own checkKey, so this row gets the same
    // real-rescan verify/drift treatment with no new authored mapping.
    const verificationState = "unverified" as const;

    try {
      await db
        .insert(remediationTrackerStepsTable)
        .values({
          customerId,
          stepId: checkKey,
          status,
          completedAt,
          updatedByUserId: userId,
          verificationState,
          verifiedAt: null,
          verifiedByRunId: null,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [remediationTrackerStepsTable.customerId, remediationTrackerStepsTable.stepId],
          set: { status, completedAt, updatedByUserId: userId, verificationState, verifiedAt: null, verifiedByRunId: null, updatedAt: now },
        });

      const [row] = await db
        .select({
          id: remediationTrackerStepsTable.id,
          stepId: remediationTrackerStepsTable.stepId,
          status: remediationTrackerStepsTable.status,
          completedAt: remediationTrackerStepsTable.completedAt,
          updatedAt: remediationTrackerStepsTable.updatedAt,
          verificationState: remediationTrackerStepsTable.verificationState,
          verifiedAt: remediationTrackerStepsTable.verifiedAt,
        })
        .from(remediationTrackerStepsTable)
        .where(and(eq(remediationTrackerStepsTable.customerId, customerId), eq(remediationTrackerStepsTable.stepId, checkKey)))
        .limit(1);

      log.info({ customerId, checkKey, status, userId }, "remediation checklist item updated");

      // Same retainer byproduct seam as the s-id world (Git #1293) — fires only
      // for an MSP/admin actor closing the item on the customer's behalf.
      const actorRole = typeof req.user?.role === "string" ? req.user.role : "";
      const actorMspId = typeof req.user?.mspId === "number" ? req.user.mspId : null;
      if (status === "completed" && row && RETAINER_MSP_ACTOR_ROLES.has(actorRole) && actorMspId !== null) {
        await logRetainerWorkFromTracker({
          customerId,
          mspId: actorMspId,
          source: "remediation_tracker",
          sourceRefId: row.id,
          item: `Remediation item ${checkKey} completed`,
          finding: checkKey,
          loggedByUserId: userId,
          occurredAt: completedAt ?? now,
        });
      }

      res.json({
        item: row
          ? {
              checkKey: row.stepId,
              status: row.status,
              completedAt: row.completedAt instanceof Date ? row.completedAt.toISOString() : row.completedAt,
              updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
              verificationState: row.verificationState,
              verifiedAt: row.verifiedAt instanceof Date ? row.verifiedAt.toISOString() : row.verifiedAt,
            }
          : {
              checkKey,
              status,
              completedAt: completedAt?.toISOString() ?? null,
              updatedAt: now.toISOString(),
              verificationState,
              verifiedAt: null,
            },
      });
    } catch (err) {
      log.error({ err, customerId, checkKey, status }, "PUT /portal/remediation/checklist failed");
      res.status(500).json({ error: "Failed to save remediation checklist item" });
    }
  },
);

// ── Raise a real Change Request FROM one checklist item (#1941) ─────────────
//
// The structured backend counterpart to the "Raise a change to fix this"
// affordance a future checklist UI will call: builds the CR body from the
// finding itself (see `remediation-raise-change.ts`) and raises it through
// the SAME `raiseChangeRequest` the wizard's `POST /portal/change-control`
// uses, with `remediationCheckKey` set — the one thing #1541's reveal gate
// has been waiting on a real row to authorize.
router.post(
  "/portal/remediation/checklist/:checkKey/raise-change",
  requireRole("Assessment"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    const checkKey = String(req.params.checkKey ?? "");

    try {
      const item = await resolveRemediationChecklistItem(customerId, checkKey);
      if (!item) {
        res.status(404).json({ error: "Unknown or already-resolved checklist item" });
        return;
      }

      const result = await raiseChangeRequest(customerId, req.user!, buildRaiseChangeRequestInputForChecklistItem(item));
      log.info({ customerId, checkKey, code: result.code }, "change request raised from a remediation checklist item");
      res.status(201).json({ ...result, checkKey });
    } catch (err) {
      if (err instanceof RaiseChangeRequestError) {
        res.status(err.status).json({ error: err.message, ...err.body });
        return;
      }
      log.error({ err, customerId, checkKey }, "POST /portal/remediation/checklist/:checkKey/raise-change failed");
      res.status(500).json({ error: "Failed to raise the change request" });
    }
  },
);

// ── Decline this checklist item to the risk register (#2869) ────────────────
//
// The findings-derived checklist's own counterpart to `POST
// .../remediation-tracker/steps/:stepId/decline-to-risk` (#1542) — same
// signed fields, same real `msp_risk_decisions` row, same idempotency-on-
// repeat-decline rule (409), just addressed by `checkKey` instead of an s-id.
// Role floor: `CustomerUser`, matching the s1–s30 route's own floor for the
// same reason — this creates a signed liability record, a higher bar than
// the `Assessment` floor the rest of this journey (including this route's own
// GET/PUT) uses.
router.post(
  "/portal/remediation/checklist/:checkKey/decline-to-risk",
  requireRole("CustomerUser"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    const checkKey = String(req.params.checkKey ?? "");
    const parsed = declineToRiskSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
      return;
    }

    try {
      // Same fail-closed gate `raise-change` above uses: only a currently
      // OPEN finding for this tenant's latest scan can be declined — a
      // resolved or never-real item has nothing left to accept the risk of.
      const item = await resolveRemediationChecklistItem(customerId, checkKey);
      if (!item) {
        res.status(404).json({ error: "Unknown or already-resolved checklist item" });
        return;
      }

      const scope = await resolveTenantScope(customerId);
      if (!scope) {
        res.status(403).json({ error: "No customer identity on token" });
        return;
      }

      const now = new Date();
      const userId = typeof req.user?.id === "number" ? req.user.id : null;

      // Same upsert idiom as the PUT handler and the s1–s30 decline route:
      // ensure a tracker row exists so there is an id for the risk decision's
      // back-pointer, touching only `updatedAt` on an existing row so this
      // step never clobbers a real status before the conflict check below.
      const [row] = await db
        .insert(remediationTrackerStepsTable)
        .values({ customerId, stepId: checkKey, status: "not_started", updatedByUserId: userId, updatedAt: now })
        .onConflictDoUpdate({
          target: [remediationTrackerStepsTable.customerId, remediationTrackerStepsTable.stepId],
          set: { updatedAt: now },
        })
        .returning({ id: remediationTrackerStepsTable.id, status: remediationTrackerStepsTable.status });

      if (!row) {
        res.status(500).json({ error: "Failed to resolve remediation checklist item" });
        return;
      }

      // PERMANENT, same guarantee as the Risk Register's own accept endpoint.
      if (row.status === "accepted_risk") {
        res.status(409).json({ error: "This item has already been declined to the risk register" });
        return;
      }

      const result = await declineRemediationChecklistItemToRisk({
        checkKey,
        trackerStepRowId: row.id,
        scope,
        findingTitle: item.title,
        severity: item.severity,
        hazardCore: item.summary?.trim() || item.description?.trim() || item.title,
        approverName: parsed.data.fullName,
        statement: parsed.data.statement,
      });

      // Second upsert to flip the now-real state — same verification-reset
      // rule every claim write on this table follows.
      await db
        .insert(remediationTrackerStepsTable)
        .values({
          customerId,
          stepId: checkKey,
          status: "accepted_risk",
          completedAt: null,
          updatedByUserId: userId,
          verificationState: "unverified",
          verifiedAt: null,
          verifiedByRunId: null,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [remediationTrackerStepsTable.customerId, remediationTrackerStepsTable.stepId],
          set: {
            status: "accepted_risk",
            completedAt: null,
            updatedByUserId: userId,
            verificationState: "unverified",
            verifiedAt: null,
            verifiedByRunId: null,
            updatedAt: now,
          },
        });

      log.info(
        { customerId, checkKey, rbdId: result.rbdId, riskDecisionId: result.riskDecisionId, userId },
        "remediation checklist item declined to risk register",
      );

      res.status(201).json({
        item: {
          checkKey,
          status: "accepted_risk",
          completedAt: null,
          updatedAt: now.toISOString(),
          verificationState: "unverified",
          verifiedAt: null,
        },
        rbdId: result.rbdId,
        accepted: {
          by: parsed.data.fullName,
          on: now.toISOString(),
          statement: parsed.data.statement,
        },
      });
    } catch (err) {
      log.error({ err, customerId, checkKey }, "POST /portal/remediation/checklist/:checkKey/decline-to-risk failed");
      res.status(500).json({ error: "Failed to decline this item to the risk register" });
    }
  },
);

export default router;
