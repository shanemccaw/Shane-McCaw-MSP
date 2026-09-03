/**
 * msp-remediation-tracker.ts — Git #2670, Feature #1684 (Remediation Tracking,
 * MSP Console).
 *
 *   GET  /api/msp/customers/:customerId/remediation-tracker
 *     — every stored step state for the given customer.
 *   PUT  /api/msp/customers/:customerId/remediation-tracker/steps/:stepId
 *     — set one step's state, as the MSP working the tracker on the
 *       customer's behalf.
 *   POST /api/msp/customers/:customerId/remediation-tracker/steps/:stepId/verify
 *     — fire the pointed re-scan that is the only thing that actually closes
 *       a step (#1540) — Feature #1684's own words: "trigger the pointed
 *       re-scan that is the only legitimate closer."
 *   GET  /api/msp/customers/:customerId/remediation-tracker/steps/:stepId/verification-guide
 *     — the human-readable "how to validate" content for a step's mapped check(s).
 *
 * WHY THIS FILE EXISTS AND NOT A FORK OF THE BUSINESS LOGIC
 * -----------------------------------------------------------
 * `portal-remediation-tracker.ts` (the customer-facing original, #730/#731/
 * #732/#1540/#1542) already does everything this route needs — every write
 * rule (idempotent upsert, `completedAt` derived not accepted, verification
 * reset on every claim change, `accepted_risk` rejected outside the signed
 * decline flow) is untouched here, unchanged, because this file does not
 * duplicate it: it is the exact same `remediationTrackerStepsTable` write and
 * the exact same `toWire`/`remediationTerminalState` shape, just resolving
 * `customerId` from `:customerId` + an MSP-ownership check instead of the
 * caller's own JWT `customerId` claim. Two call sites, one rule set.
 *
 * WHY `accepted_risk` / decline-to-risk IS NOT MIRRORED HERE
 * -------------------------------------------------------------
 * `POST .../decline-to-risk` on the portal route creates a SIGNED liability
 * record — a typed full name + explicit confirmation the CUSTOMER is
 * accepting risk on their own account (`requireRole("CustomerUser")`, a
 * higher floor than the rest of that journey precisely because of what it
 * creates). That is the customer's own signature, not something an MSP
 * operator can complete on their behalf without misattributing who actually
 * accepted the risk — a real product/legal distinction, not a missing route.
 * If Shane wants an MSP-initiated risk-decline flow later, it needs its own
 * signed-actor design, not a copy of this one with the role floor lowered.
 *
 * Auth: `requireRole("MSPOperator")` (MSPAdmin/PlatformAdmin clear that floor
 * too) + `assertCustomerAccess` — the same ownership + per-staff-scoping
 * single source of truth every other `/api/msp/*` single-customer route in
 * this repo uses (msp-diagnostics.ts, msp-active-directory.ts, …). A customer
 * outside the caller's book 404s — existence is never disclosed.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, remediationTrackerStepsTable, tenantsTable, REMEDIATION_TRACKER_STEP_STATUS } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { requireRole, assertCustomerAccess } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { computeRemediationTrackerPricing } from "../lib/remediation-tracker-pricing";
import { logRetainerWorkFromTracker } from "../lib/retainer-work-logger";
import { stepCheckKeysFor } from "../lib/remediation-tracker-verification";
import { emitWorkflowEvent } from "../lib/workflow-executor";
import { fetchPublishedKnowledgeBaseRows } from "../lib/remediation-knowledge-base";
import { REMEDIATION_TRACKER_STEP_IDS } from "./portal-remediation-tracker";

const log = logger.child({ channel: "engine.remediation-tracker" });

const router: IRouter = Router();

const STEP_ID_SET = new Set(REMEDIATION_TRACKER_STEP_IDS);

const putStepSchema = z.object({
  status: z.enum(REMEDIATION_TRACKER_STEP_STATUS),
});

/** Same three-state read model as portal-remediation-tracker.ts (#1542). */
type RemediationTerminalState = "verified" | "accepted" | "outstanding";

function remediationTerminalState(status: string, verificationState: string): RemediationTerminalState {
  if (verificationState === "verified") return "verified";
  if (status === "accepted_risk") return "accepted";
  return "outstanding";
}

interface WireTrackerStep {
  readonly stepId: string;
  readonly status: string;
  readonly completedAt: string | null;
  readonly updatedAt: string | null;
  readonly verificationState: string;
  readonly verifiedAt: string | null;
  readonly terminalState: RemediationTerminalState;
}

function toWire(row: {
  stepId: string;
  status: string;
  completedAt: Date | string | null;
  updatedAt: Date | string | null;
  verificationState: string;
  verifiedAt: Date | string | null;
}): WireTrackerStep {
  const iso = (v: Date | string | null): string | null =>
    v === null ? null : v instanceof Date ? v.toISOString() : String(v);
  return {
    stepId: row.stepId,
    status: row.status,
    completedAt: iso(row.completedAt),
    updatedAt: iso(row.updatedAt),
    verificationState: row.verificationState,
    verifiedAt: iso(row.verifiedAt),
    terminalState: remediationTerminalState(row.status, row.verificationState),
  };
}

/**
 * Parses `:customerId` and checks MSP ownership in one step. Returns the
 * numeric id on success; on failure it has already written the response
 * (400 for a malformed id, 404 for anything the caller may not reach —
 * matching msp-diagnostics.ts's "don't disclose existence" convention).
 */
async function resolveAuthorizedCustomerId(req: Request, res: Response): Promise<number | null> {
  const customerId = parseInt(req.params.customerId as string, 10);
  if (isNaN(customerId)) {
    res.status(400).json({ error: "Invalid customerId" });
    return null;
  }
  if (!(await assertCustomerAccess(req.user!, customerId))) {
    res.status(404).json({ error: "Customer not found" });
    return null;
  }
  return customerId;
}

// ── Read ──────────────────────────────────────────────────────────────────────
router.get(
  "/msp/customers/:customerId/remediation-tracker",
  requireRole("MSPOperator"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = await resolveAuthorizedCustomerId(req, res);
    if (customerId === null) return;

    try {
      const rows = await db
        .select({
          stepId: remediationTrackerStepsTable.stepId,
          status: remediationTrackerStepsTable.status,
          completedAt: remediationTrackerStepsTable.completedAt,
          updatedAt: remediationTrackerStepsTable.updatedAt,
          verificationState: remediationTrackerStepsTable.verificationState,
          verifiedAt: remediationTrackerStepsTable.verifiedAt,
        })
        .from(remediationTrackerStepsTable)
        .where(eq(remediationTrackerStepsTable.customerId, customerId));

      const knownRows = rows.filter((r) => STEP_ID_SET.has(r.stepId));
      const pricing = computeRemediationTrackerPricing(knownRows);

      res.json({ steps: knownRows.map(toWire), pricing });
    } catch (err) {
      log.error({ err, customerId }, "GET /msp/customers/:customerId/remediation-tracker failed");
      res.status(500).json({ error: "Failed to load remediation tracker" });
    }
  },
);

// ── Write ─────────────────────────────────────────────────────────────────────
router.put(
  "/msp/customers/:customerId/remediation-tracker/steps/:stepId",
  requireRole("MSPOperator"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = await resolveAuthorizedCustomerId(req, res);
    if (customerId === null) return;

    const stepId = String(req.params.stepId ?? "");
    if (!STEP_ID_SET.has(stepId)) {
      res.status(400).json({ error: "Unknown remediation step" });
      return;
    }

    const parsed = putStepSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
      return;
    }

    const { status } = parsed.data;

    // Same rule as the customer-facing route: accepted_risk is a signed fact,
    // only ever set by the customer's own decline-to-risk flow.
    if (status === "accepted_risk") {
      res.status(400).json({ error: "accepted_risk cannot be set directly — it is only ever set by the customer's own decline-to-risk acceptance" });
      return;
    }

    const now = new Date();
    const completedAt = status === "completed" ? now : null;
    const userId = typeof req.user?.id === "number" ? req.user.id : null;
    const verificationState = "unverified" as const;

    try {
      await db
        .insert(remediationTrackerStepsTable)
        .values({
          customerId,
          stepId,
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
        .where(
          and(
            eq(remediationTrackerStepsTable.customerId, customerId),
            eq(remediationTrackerStepsTable.stepId, stepId),
          ),
        )
        .limit(1);

      log.info({ customerId, stepId, status, userId }, "MSP-side remediation tracker step updated");

      // ── Retainer byproduct seam (Git #1293) — an MSP operator working the
      // tracker through this route is, by definition, always the MSP-actor
      // case portal-remediation-tracker.ts's own hook gates on.
      const actorMspId = typeof req.user?.mspId === "number" ? req.user.mspId : null;
      if (status === "completed" && row && actorMspId !== null) {
        await logRetainerWorkFromTracker({
          customerId,
          mspId: actorMspId,
          source: "remediation_tracker",
          sourceRefId: row.id,
          item: `Remediation step ${stepId} completed`,
          finding: stepId,
          loggedByUserId: userId,
          occurredAt: completedAt ?? now,
        });
      }

      res.json({
        step: row
          ? toWire(row)
          : {
              stepId,
              status,
              completedAt: completedAt?.toISOString() ?? null,
              updatedAt: now.toISOString(),
              verificationState,
              verifiedAt: null,
              terminalState: remediationTerminalState(status, verificationState),
            },
      });
    } catch (err) {
      log.error({ err, customerId, stepId, status }, "PUT /msp/customers/:customerId/remediation-tracker/steps failed");
      res.status(500).json({ error: "Failed to save remediation step" });
    }
  },
);

// ── Pointed verify (#1540) — "the only legitimate closer" per Feature #1684 ──
router.post(
  "/msp/customers/:customerId/remediation-tracker/steps/:stepId/verify",
  requireRole("MSPOperator"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = await resolveAuthorizedCustomerId(req, res);
    if (customerId === null) return;

    const stepId = String(req.params.stepId ?? "");
    if (!STEP_ID_SET.has(stepId)) {
      res.status(400).json({ error: "Unknown remediation step" });
      return;
    }

    const mappedKeys = stepCheckKeysFor(stepId);
    if (!mappedKeys || mappedKeys.length === 0) {
      res.status(400).json({ error: "This step has no automated check behind it — there is nothing a re-scan could verify" });
      return;
    }

    try {
      const [row] = await db
        .select({ status: remediationTrackerStepsTable.status })
        .from(remediationTrackerStepsTable)
        .where(and(eq(remediationTrackerStepsTable.customerId, customerId), eq(remediationTrackerStepsTable.stepId, stepId)))
        .limit(1);

      if (!row || row.status === "not_started") {
        res.status(400).json({ error: "Nothing to verify yet — this step has no claim on it" });
        return;
      }

      const [tenant] = await db.select({ tenantId: tenantsTable.tenantId }).from(tenantsTable).where(eq(tenantsTable.id, customerId)).limit(1);
      if (!tenant?.tenantId) {
        res.status(400).json({ error: "No connected M365 tenant — nothing to re-scan against" });
        return;
      }

      await emitWorkflowEvent("remediation.verify_requested", { customerId, stepId });
      log.info({ customerId, stepId, checkKeys: mappedKeys }, "MSP-side remediation tracker pointed verify requested");

      res.status(202).json({
        message: "Pointed verification started — poll GET /msp/customers/:customerId/remediation-tracker for the result.",
        stepId,
        checkKeys: mappedKeys,
      });
    } catch (err) {
      log.error({ err, customerId, stepId }, "POST /msp/customers/:customerId/remediation-tracker/steps/:stepId/verify failed");
      res.status(500).json({ error: "Failed to start pointed verification" });
    }
  },
);

// ── Verification guide (#1540) ───────────────────────────────────────────────
router.get(
  "/msp/customers/:customerId/remediation-tracker/steps/:stepId/verification-guide",
  requireRole("MSPOperator"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = await resolveAuthorizedCustomerId(req, res);
    if (customerId === null) return;

    const stepId = String(req.params.stepId ?? "");
    if (!STEP_ID_SET.has(stepId)) {
      res.status(400).json({ error: "Unknown remediation step" });
      return;
    }

    const mappedKeys = stepCheckKeysFor(stepId);
    if (!mappedKeys || mappedKeys.length === 0) {
      res.status(404).json({ error: "This step has no automated check behind it — there is no validation guidance to show" });
      return;
    }

    try {
      const kbRows = await fetchPublishedKnowledgeBaseRows([...mappedKeys]);
      const guidance = mappedKeys.map((checkKey) => {
        const row = kbRows.get(checkKey);
        return {
          checkKey,
          validationStep: row?.validationStep ?? null,
          validationCommand: row?.validationCommand ?? null,
          expectedOutcome: row?.expectedOutcome ?? null,
        };
      });

      res.json({ stepId, checkKeys: mappedKeys, guidance });
    } catch (err) {
      log.error({ err, customerId, stepId }, "GET /msp/customers/:customerId/remediation-tracker/steps/:stepId/verification-guide failed");
      res.status(500).json({ error: "Failed to load verification guidance" });
    }
  },
);

export default router;
