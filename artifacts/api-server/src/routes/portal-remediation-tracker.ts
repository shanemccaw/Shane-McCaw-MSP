/**
 * portal-remediation-tracker.ts — the Remediation Tracker's persistent state
 * (Git #730, Phase A of epic #647; widened #731, Phase B; verification #732,
 * Phase C).
 *
 *   GET /api/portal/remediation-tracker
 *     — every stored step state for the calling customer.
 *   PUT /api/portal/remediation-tracker/steps/:stepId
 *     — set one step's state. Idempotent upsert; safe to send twice.
 *   POST /api/portal/remediation-tracker/steps/:stepId/decline-to-risk
 *     — #1542: the customer declines to fix this item. The decline IS a risk
 *     acceptance (the same rejection-to-risk path #1514 built for Change
 *     Control) — see `remediation-tracker-risk-decline.ts` for the derivation
 *     and `remediationTerminalState()` below for the three-state read model.
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
 * tested `.ts` modules that already freeze the guide's twenty-eight steps and
 * their ids. This route holds those ids ONLY to reject writes for a step that does
 * not exist, and `portal-remediation-tracker-step-ids.test.ts` reads the
 * portal's own module to prove the two lists have not drifted. A `total` served
 * from here would be a second source of truth for "how many steps are there",
 * disagreeing with the guide the customer is actually looking at the moment
 * anybody edits it. The client counts what it renders; this route only ever
 * answers "what state is stored".
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, remediationTrackerStepsTable, tenantsTable, REMEDIATION_TRACKER_STEP_STATUS } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { requireRole } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { computeRemediationTrackerPricing } from "../lib/remediation-tracker-pricing";
import { logRetainerWorkFromTracker } from "../lib/retainer-work-logger";
import { stepCheckKeysFor } from "../lib/remediation-tracker-verification";
import { emitWorkflowEvent } from "../lib/workflow-executor";
import { fetchPublishedKnowledgeBaseRows } from "../lib/remediation-knowledge-base";
import { resolveTenantScope } from "../lib/portal-customer-scope";
import { declineRemediationStepToRisk } from "../lib/remediation-tracker-risk-decline";
import { apiError, ApiErrorCode } from "../lib/api-helpers";
import {
  remediationTerminalState,
  type RemediationTerminalState,
} from "../lib/remediation-tracker-terminal-state";

/**
 * Roles that represent SHANE / the MSP acting, as opposed to the customer
 * self-servicing their own tracker. The retainer byproduct hook below fires
 * ONLY for these — a customer ticking their own remediation step is not Shane
 * logging retainer hours, and attributing his time to their action would be
 * wrong. `admin` is the platform-admin session the AdminV2 console carries.
 */
const RETAINER_MSP_ACTOR_ROLES = new Set(["admin", "PlatformAdmin", "MSPOperator", "MSPAdmin"]);

const log = logger.child({ channel: "engine.remediation-tracker" });

const router: IRouter = Router();

/**
 * The remediation guide's own step ids: s1–s23 and s26–s30.
 *
 * Steps 24 and 25 were removed from the catalogue in #757 (adoption/rollout
 * guidance that belongs to White-Glove Copilot Adoption #350/#668), and the
 * remaining ids are deliberately NOT renumbered — s26–s30 keep their own
 * numbers, so this list has a gap where 24/25 were.
 *
 * VALIDATION ONLY — never a count, never a catalogue (see the header). The real
 * catalogue is msp-portal's `previewRemediationGuide.ts`, and the drift test in
 * `portal-remediation-tracker.test.ts` reads that file directly and fails if
 * this list stops matching it, so a step added, removed or renumbered there
 * cannot silently start 400ing here. Keeping s24/s25 out of this set is also
 * what makes a stray write to a removed step return 400 rather than resurrect it.
 */
export const REMEDIATION_TRACKER_STEP_IDS: readonly string[] = [
  ...Array.from({ length: 23 }, (_, i) => `s${i + 1}`), // s1 … s23
  ...Array.from({ length: 5 }, (_, i) => `s${i + 26}`), // s26 … s30
];

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
  /** #1542 — see remediationTerminalState() above. */
  readonly terminalState: RemediationTerminalState;
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
    terminalState: remediationTerminalState(row.status, row.verificationState),
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
      const knownRows = rows.filter((r) => STEP_ID_SET.has(r.stepId));

      // Phase-gated live pricing (#734, Phase E) — computed from the same
      // known rows, not a second query. Additive field; the `steps` shape
      // above is unchanged.
      const pricing = computeRemediationTrackerPricing(knownRows);

      res.json({ steps: knownRows.map(toWire), pricing });
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

    // #1542 — `accepted_risk` is a signed fact, not a claim: it is ONLY ever
    // set by POST .../decline-to-risk alongside a real msp_risk_decisions row.
    // A bare PUT setting it directly would be an unsigned "accepted" state,
    // exactly the claim-vs-proof collapse this route's own header forbids.
    if (status === "accepted_risk") {
      res.status(400).json({ error: "accepted_risk cannot be set directly — use POST .../decline-to-risk" });
      return;
    }

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

      log.info({ customerId, stepId, status, userId }, "remediation tracker step updated");

      // ── Retainer byproduct seam (Git #1293) ──────────────────────────────
      // The remediation tracker is the customer's own self-service checklist, so
      // this hook fires ONLY when an MSP/admin actor (Shane) completes a step —
      // never on a customer's own tick (see RETAINER_MSP_ACTOR_ROLES). Idempotent
      // on (source, sourceRefId) so it is a no-op if the step is re-completed.
      // The step title/pillar catalogue lives in msp-portal, not reachable here,
      // so the entry lands with a modest label + the stepId as its finding for
      // Shane to flesh out in AdminV2.
      const actorRole = typeof req.user?.role === "string" ? req.user.role : "";
      const actorMspId = typeof req.user?.mspId === "number" ? req.user.mspId : null;
      if (status === "completed" && row && RETAINER_MSP_ACTOR_ROLES.has(actorRole) && actorMspId !== null) {
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
      log.error({ err, customerId, stepId, status }, "PUT /portal/remediation-tracker/steps failed");
      res.status(500).json({ error: "Failed to save remediation step" });
    }
  },
);

// ── Pointed verify (#1540) ───────────────────────────────────────────────────
//
// "Done means verified, never claimed." A customer ticking a step is a claim;
// only a real re-scan closes it. This is the on-demand half: instead of
// waiting for the next full package scan to happen to cover this step's
// check(s), fire ONE targeted re-scan right now. Fire-and-forget through the
// Workflow Engine (`remediation_pointed_verify`, seeded as
// "__system__: Remediation Pointed Verification") — never a bare function
// call — so the run is a real, visible, auditable workflow_runs row. The
// verdict lands on the row this route already serves (verificationState /
// verifiedAt); the client re-polls GET /portal/remediation-tracker to see it,
// the same poll-after-kick shape every other async action on this platform
// uses (document generation, monitor check runs, …).
router.post(
  "/portal/remediation-tracker/steps/:stepId/verify",
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
      log.info({ customerId, stepId, checkKeys: mappedKeys }, "remediation tracker pointed verify requested");

      res.status(202).json({
        message: "Pointed verification started — poll GET /portal/remediation-tracker for the result.",
        stepId,
        checkKeys: mappedKeys,
      });
    } catch (err) {
      log.error({ err, customerId, stepId }, "POST /portal/remediation-tracker/steps/:stepId/verify failed");
      res.status(500).json({ error: "Failed to start pointed verification" });
    }
  },
);

// ── Verification guide (#1540) ───────────────────────────────────────────────
//
// Surfaces `remediation_knowledge_base.validationStep` / `.validationCommand` /
// `.expectedOutcome` for a step's mapped check(s) — human-readable "how to
// validate" content, "already anticipated, never wired" per #1540's own body.
// Read-only: nothing here executes `validationCommand`. The pointed re-scan
// above is the platform's own proof; this is the same guidance a customer can
// read to check it themselves, published rows only (same provenance rule as
// the Remediation Plan document — a draft row is not yet a claim anyone signed
// off on).
router.get(
  "/portal/remediation-tracker/steps/:stepId/verification-guide",
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
      log.error({ err, customerId, stepId }, "GET /portal/remediation-tracker/steps/:stepId/verification-guide failed");
      res.status(500).json({ error: "Failed to load verification guidance" });
    }
  },
);

// ── Decline to risk (#1542) ─────────────────────────────────────────────────
//
// Same typed-name + checkbox acceptance shape as `POST
// /portal/risk-register/:rbdId/accept` (portal-risk-register.ts) — this IS
// that same signed acceptance, just arriving with its own risk record rather
// than accepting a pre-existing one. `fullName` is not checked against the
// account's own name for the same reason that route documents: the person
// signing may legitimately be signing in a role, and the account that
// actually signed is recorded separately (the JWT-derived actor, logged
// below) as the real identity claim.
const declineToRiskSchema = z.object({
  fullName: z.string().trim().min(2, "Type your full name to accept this risk").max(200),
  confirmed: z.literal(true),
  statement: z.string().trim().min(1).max(2000),
});

// Role floor: `CustomerUser`, matching portal-risk-register.ts's own floor for
// the same reason — this creates a signed liability record, which is a higher
// bar than the `Assessment` floor the rest of this journey uses.
router.post(
  "/portal/remediation-tracker/steps/:stepId/decline-to-risk",
  requireRole("CustomerUser"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      apiError(res, 403, ApiErrorCode.FORBIDDEN, "Customer context required");
      return;
    }

    const stepId = String(req.params.stepId ?? "");
    if (!STEP_ID_SET.has(stepId)) {
      apiError(res, 400, ApiErrorCode.VALIDATION, "Unknown remediation step");
      return;
    }

    const parsed = declineToRiskSchema.safeParse(req.body);
    if (!parsed.success) {
      apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid acceptance", parsed.error.flatten());
      return;
    }

    try {
      const scope = await resolveTenantScope(customerId);
      if (!scope) {
        apiError(res, 403, ApiErrorCode.FORBIDDEN, "Customer context required");
        return;
      }

      const now = new Date();
      const userId = typeof req.user?.id === "number" ? req.user.id : null;

      // Ensure a tracker row exists so there is an id to point the risk
      // decision's back-pointer at — a customer may decline a step they have
      // never otherwise touched. Same upsert idiom the PUT handler above uses
      // (insert .. onConflictDoUpdate), touching only `updatedAt` on an
      // existing row so this step never clobbers a real status before the
      // conflict check below gets to look at it.
      const [row] = await db
        .insert(remediationTrackerStepsTable)
        .values({ customerId, stepId, status: "not_started", updatedByUserId: userId, updatedAt: now })
        .onConflictDoUpdate({
          target: [remediationTrackerStepsTable.customerId, remediationTrackerStepsTable.stepId],
          set: { updatedAt: now },
        })
        .returning({ id: remediationTrackerStepsTable.id, status: remediationTrackerStepsTable.status });

      if (!row) {
        apiError(res, 500, ApiErrorCode.INTERNAL, "Failed to resolve remediation step");
        return;
      }

      // PERMANENT, same guarantee as the Risk Register's own accept endpoint.
      if (row.status === "accepted_risk") {
        apiError(res, 409, ApiErrorCode.CONFLICT, "This item has already been declined to the risk register");
        return;
      }

      const result = await declineRemediationStepToRisk({
        stepId,
        trackerStepRowId: row.id,
        scope,
        approverName: parsed.data.fullName,
        statement: parsed.data.statement,
      });

      // Second upsert to flip the now-real state — same idiom as the PUT
      // handler's own write, including the same verification reset (a changed
      // claim invalidates whatever the last scan confirmed about the old one).
      await db
        .insert(remediationTrackerStepsTable)
        .values({
          customerId,
          stepId,
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
        { customerId, stepId, rbdId: result.rbdId, riskDecisionId: result.riskDecisionId, userId },
        "remediation step declined to risk register",
      );

      res.status(201).json({
        step: {
          stepId,
          status: "accepted_risk",
          completedAt: null,
          updatedAt: now.toISOString(),
          verificationState: "unverified",
          verifiedAt: null,
          terminalState: remediationTerminalState("accepted_risk", "unverified"),
        },
        rbdId: result.rbdId,
        accepted: {
          by: parsed.data.fullName,
          on: now.toISOString(),
          statement: parsed.data.statement,
        },
      });
    } catch (err: unknown) {
      log.error({ err, customerId, stepId }, "POST /portal/remediation-tracker/steps/:stepId/decline-to-risk failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

export default router;
