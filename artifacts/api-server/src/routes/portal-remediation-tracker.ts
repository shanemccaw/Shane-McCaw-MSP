/**
 * portal-remediation-tracker.ts — the Remediation Tracker's persistent state
 * (Git #730, Phase A of epic #647; widened #731, Phase B; verification #732,
 * Phase C).
 *
 *   GET /api/portal/remediation-tracker
 *     — every stored step state for the calling customer.
 *   PUT /api/portal/remediation-tracker/steps/:stepId
 *     — set one step's state. Idempotent upsert; safe to send twice.
 *
 * WHAT THIS REPLACES
 * ------------------
 * The Full Remediation Guide's tick boxes were React state that died with the
 * tab, and `RemediationGuideBody.tsx` said so in its own header and in the
 * document's standfirst ("your progress is kept while this page is open").
 * #730 makes them survive a reload, a re-login and a different device.
 *
 * WHAT A TICK IS, AND WHAT IT IS NOT
 * ----------------------------------
 * It is the customer's own claim that they did a step. It is NOT evidence the
 * change landed in their tenant, and nothing in this platform's scoring, gate
 * or readiness maths reads it — the honest answer to "did this really happen"
 * stays a re-scan. That is why the stored field is `status` and not `verified`,
 * and why #732 added its verification state as its OWN column
 * (`verificationState`/`verifiedAt`/`verifiedByRunId`) rather than another
 * value of `status`: a step a rescan re-verified and a step somebody ticked
 * are different facts and must never collapse together.
 *
 * VERIFICATION IS SET ELSEWHERE, RESET HERE. Only
 * `reverifyRemediationTrackerSteps()` (`../lib/remediation-tracker-
 * verification.ts`), fired from inside a real scan in `diagnostics-runner.ts`,
 * ever moves a row to `verified` or `drift`. This route's PUT handler does the
 * other half: every write to `status` resets `verificationState` back to
 * `unverified` and clears `verifiedAt`/`verifiedByRunId`, because a changed
 * claim invalidates whatever the last scan confirmed or flagged about the OLD
 * one. Without that reset, ticking a drifted step complete again would still
 * show the stale "Drifted" badge until the next rescan happened to run.
 *
 * SCOPED TO THE CUSTOMER, NOT THE USER. Remediation is a shared engagement
 * record — a second admin on the account, and Shane looking at the same
 * customer, see one tracker rather than a private copy each. Which is also why
 * the write records `updatedByUserId`.
 *
 * WHY THIS ROUTE DOES NOT RETURN A TOTAL
 * --------------------------------------
 * The step CATALOGUE lives in one place and it is not here: it is
 * `previewRemediationGuide.ts` / `remediationLiveGuide.ts` in msp-portal, the
 * tested `.ts` modules that already freeze the design's thirty steps and their
 * ids. This route holds those ids ONLY to reject writes for a step that does
 * not exist, and `portal-remediation-tracker-step-ids.test.ts` reads the
 * portal's own module to prove the two lists have not drifted. A `total` served
 * from here would be a second source of truth for "how many steps are there",
 * disagreeing with the guide the customer is actually looking at the moment
 * anybody edits it. The client counts what it renders; this route only ever
 * answers "what state is stored".
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, remediationTrackerStepsTable, REMEDIATION_TRACKER_STEP_STATUS } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { requireRole } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "engine.remediation-tracker" });

const router: IRouter = Router();

/**
 * The remediation guide's own step ids, "s1" … "s30".
 *
 * VALIDATION ONLY — never a count, never a catalogue (see the header). The real
 * catalogue is msp-portal's `previewRemediationGuide.ts`, and
 * `portal-remediation-tracker-step-ids.test.ts` reads that file directly and
 * fails if this list stops matching it, so a step added or renumbered there
 * cannot silently start 400ing here.
 */
export const REMEDIATION_TRACKER_STEP_IDS: readonly string[] = Array.from(
  { length: 30 },
  (_, i) => `s${i + 1}`,
);

const STEP_ID_SET = new Set(REMEDIATION_TRACKER_STEP_IDS);

const putStepSchema = z.object({
  status: z.enum(REMEDIATION_TRACKER_STEP_STATUS),
});

/** The wire shape of one stored step. */
interface WireTrackerStep {
  readonly stepId: string;
  readonly status: string;
  readonly completedAt: string | null;
  readonly updatedAt: string | null;
  /** "unverified" | "verified" | "drift" — see remediation-tracker-verification.ts. */
  readonly verificationState: string;
  readonly verifiedAt: string | null;
}

/**
 * tenants.id, off the JWT's `customerId` claim — the same resolution
 * portal-assessment.ts uses for every other route on this journey.
 */
function resolveCustomerId(req: Request): number | null {
  const id = (req.user as { customerId?: number } | undefined)?.customerId;
  return typeof id === "number" && !isNaN(id) ? id : null;
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
  };
}

// ── Read ──────────────────────────────────────────────────────────────────────
//
// Only rows that exist. A step with no row is `not_started` — nothing pre-seeds
// thirty rows per customer, so an untouched tracker reads as an empty array and
// costs one indexed lookup. The client resolves the absence against the steps
// it is rendering.
router.get(
  "/portal/remediation-tracker",
  // Same floor as the rest of the Copilot Readiness journey (see
  // portal-assessment.ts): Assessment is the lowest role carrying a customerId.
  requireRole("Assessment"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

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

      // Rows for ids the guide no longer holds are dropped rather than served:
      // the write path can only ever store a known id, so this is belt-and-
      // braces against a step being renumbered out of the guide later.
      res.json({ steps: rows.filter((r) => STEP_ID_SET.has(r.stepId)).map(toWire) });
    } catch (err) {
      log.error({ err, customerId }, "GET /portal/remediation-tracker failed");
      res.status(500).json({ error: "Failed to load remediation tracker" });
    }
  },
);

// ── Write ─────────────────────────────────────────────────────────────────────
//
// One step at a time, idempotent. `completedAt` is derived from the status
// rather than accepted from the client: the moment a step became complete is a
// server fact, and un-ticking clears it rather than leaving a stale timestamp
// behind claiming a completion that was withdrawn.
router.put(
  "/portal/remediation-tracker/steps/:stepId",
  requireRole("Assessment"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

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
    const now = new Date();
    const completedAt = status === "completed" ? now : null;
    const userId = typeof req.user?.id === "number" ? req.user.id : null;

    // A changed claim invalidates whatever the last rescan confirmed or
    // flagged about the OLD one (see the header). Every write resets
    // verification back to `unverified` — only reverifyRemediationTrackerSteps()
    // (fired from a real scan) ever sets `verified` or `drift`.
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

      // Read back rather than trusting `.returning()`: the row is the record and
      // this is the one response the client writes into its own state.
      const [row] = await db
        .select({
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

      log.info({ customerId, stepId, status, userId }, "remediation tracker step updated");

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
            },
      });
    } catch (err) {
      log.error({ err, customerId, stepId, status }, "PUT /portal/remediation-tracker/steps failed");
      res.status(500).json({ error: "Failed to save remediation step" });
    }
  },
);

export default router;
