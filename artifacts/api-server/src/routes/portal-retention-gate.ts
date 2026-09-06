/**
 * The subscription gate's own status endpoint (Git #2765, EPIC #1944 parts 7-8).
 *
 * The "Come back! Download your data" screen is NOT in this issue's scope — there is no
 * `Design/portal/` export for it yet and it is filed separately as a Portal issue. This
 * is the backend half: the one endpoint that screen will read, so that when it is built
 * every number on it (when the subscription lapsed, how long the retention window is,
 * when the data purges) comes from the database rather than from a constant typed into a
 * component.
 *
 * It is on the gate's own allowlist — a wall that could not fetch its own state would
 * have to invent the numbers it renders, which is exactly what this project forbids.
 *
 * Deliberately readable while the subscription is ACTIVE too, returning
 * `subscriptionActive: true`. The portal shell needs one endpoint it can ask "is this
 * account gated" without having to provoke a 403 to find out, and an active customer
 * asking gets a truthful "no" rather than an error.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { apiError, ApiErrorCode } from "../lib/api-helpers";
import {
  SUBSCRIPTION_GATE_ALLOWED_PREFIXES,
  subscriptionGateBody,
} from "../lib/retention/subscription-gate";
import { readTenantSubscriptionState } from "../lib/retention/subscription-state";
import {
  REINSTATEMENT_NOTE_MAX,
  listReinstatementRequests,
  readOpenReinstatementRequest,
  submitReinstatementRequest,
  withdrawReinstatementRequest,
} from "../lib/retention/reinstatement";
import type { RetentionReinstatementRequest } from "@workspace/db";

const router: IRouter = Router();

/** One request, as the wall reads it. Every field real; nothing computed for display. */
function toWireRequest(row: RetentionReinstatementRequest) {
  return {
    id: row.id,
    status: row.status,
    requestedAt: row.requestedAt.toISOString(),
    note: row.note,
    lapseSource: row.lapseSource,
    lapseWasMspCascade: row.lapseWasMspCascade,
    lapsedAt: row.lapsedAt?.toISOString() ?? null,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    resolution: row.resolution,
  };
}

/**
 * GET /api/portal/retention/subscription-gate
 *
 * The caller's own tenant only — read off the verified `customerId` claim, never off a
 * query parameter. There is no cross-tenant form of this route: a customer asking about
 * another customer's cancellation is not a question the product answers.
 */
router.get("/portal/retention/subscription-gate", requireAuth, async (req: Request, res: Response) => {
  const tenantId = req.user?.customerId;
  if (typeof tenantId !== "number") {
    // An operator or platform session has no customer of its own to report on. Not an
    // error condition, but not this route's subject either.
    apiError(res, 400, ApiErrorCode.VALIDATION, "This session is not scoped to a customer");
    return;
  }

  try {
    const state = await readTenantSubscriptionState(tenantId);
    if (!state) {
      apiError(res, 404, ApiErrorCode.NOT_FOUND, "Customer not found");
      return;
    }

    if (state.active) {
      res.json({
        subscriptionActive: true,
        tenantId: state.tenantId,
        status: state.status,
        // #2847 — the real per-customer subscription behind that `true`. `billingSource`
        // is `"tenant_status"` for a customer with no subscription on record, and the
        // three fields below it are then null: the platform genuinely does not know what
        // that customer is paying for, and saying so is the only honest answer.
        billingSource: state.billingSource,
        // #2936 — reported even while active, and normally all-false/null. A customer
        // whose MSP is mid-dunning but not yet lapsed is genuinely open, and the honest
        // answer to "is my MSP in trouble" is the real dunning state, not silence.
        mspLapsed: state.mspLapsed,
        mspSubscriptionStatus: state.mspSubscriptionStatus,
        mspDunningState: state.mspDunningState,
        subscriptionStatus: state.subscriptionStatus,
        planName: state.planName,
        currentPeriodEnd: state.currentPeriodEnd?.toISOString() ?? null,
        // An active customer has no lapse instant and no purge date. Null, not a
        // computed placeholder — the screen renders those as unavailable.
        lapsedAt: null,
        purgeDueAt: null,
        purgedAt: null,
        retentionYears: state.postTerminationYears,
        retentionYearsIsDefault: state.postTerminationIsDefault,
        allowedPaths: SUBSCRIPTION_GATE_ALLOWED_PREFIXES,
        // An open request cannot survive the portal reopening — the reconciliation
        // resolves it in the same breath as it resumes the clocks — so this is null for
        // an active customer by construction, not by omission.
        reinstatementRequest: null,
      });
      return;
    }

    // Byte-identical to the body the gate itself returns on a 403, so the screen has one
    // shape to render whether it arrived by being turned away or by asking directly —
    // plus the customer's own open reinstatement request, which the 403 body deliberately
    // does not carry (the gate runs on every request and must not pay for a second read).
    const open = await readOpenReinstatementRequest(tenantId);
    res.json({
      ...subscriptionGateBody(state),
      reinstatementRequest: open ? toWireRequest(open) : null,
    });
  } catch (err) {
    req.log.error({ err, tenantId }, "portal: subscription-gate status read failed");
    apiError(res, 500, ApiErrorCode.INTERNAL, "Failed to read subscription state");
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Reinstatement (Git #2936)
// ─────────────────────────────────────────────────────────────────────────────
//
// The third of the three actions Shane's #2936 decision keeps reachable from behind the
// wall. The other two already existed and only needed the gate's allowlist:
// `/portal/data-export` (download) and `/portal/deletion-request` (delete your own data).
//
// All three routes sit under the `/portal/retention/reinstatement` prefix so a single
// allowlist entry covers them — the per-route awareness #1944 part 8 rules out.

/**
 * POST /api/portal/retention/reinstatement
 *
 * Record that this customer is asking to be let back in. The caller's own tenant only,
 * off the verified `customerId` claim.
 *
 * Idempotent while a request is open: a second submission returns the existing request
 * with `alreadyOpen: true` rather than an error. A wall that double-submits is a real
 * thing, and telling a customer their request failed when it did not would be worse than
 * the duplicate.
 */
router.post("/portal/retention/reinstatement", requireAuth, async (req: Request, res: Response) => {
  const tenantId = req.user?.customerId;
  if (typeof tenantId !== "number") {
    apiError(res, 400, ApiErrorCode.VALIDATION, "This session is not scoped to a customer");
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const noteRaw = typeof body.note === "string" ? body.note : null;
  if (noteRaw !== null && noteRaw.length > REINSTATEMENT_NOTE_MAX) {
    apiError(res, 400, ApiErrorCode.VALIDATION, `Your message must be ${REINSTATEMENT_NOTE_MAX} characters or fewer`);
    return;
  }

  try {
    const state = await readTenantSubscriptionState(tenantId);
    if (!state) {
      apiError(res, 404, ApiErrorCode.NOT_FOUND, "Customer not found");
      return;
    }
    // Asking to be reinstated while already inside is not a request, it is a mistake —
    // and recording it would put a row in the queue that resolves itself immediately.
    if (state.active) {
      apiError(res, 409, ApiErrorCode.VALIDATION, "This account is already active");
      return;
    }

    const result = await submitReinstatementRequest({
      tenantId,
      requestedByUserId: req.user?.id ?? null,
      note: noteRaw,
      // The snapshot is taken from the SAME resolved state the wall was rendered from,
      // so the row records what the customer was actually looking at when they asked.
      lapseSource: state.billingSource,
      lapseWasMspCascade: state.mspLapsed,
      lapsedAt: state.lapsedAt,
    });

    if (result.outcome === "tenant_missing") {
      apiError(res, 404, ApiErrorCode.NOT_FOUND, "Customer not found");
      return;
    }

    res.status(result.outcome === "created" ? 201 : 200).json({
      ok: true,
      alreadyOpen: result.outcome === "already_open",
      request: toWireRequest(result.request),
    });
  } catch (err) {
    req.log.error({ err, tenantId }, "portal: reinstatement request failed");
    apiError(res, 500, ApiErrorCode.INTERNAL, "Failed to submit reinstatement request");
  }
});

/** GET /api/portal/retention/reinstatement — this customer's own request history. */
router.get("/portal/retention/reinstatement", requireAuth, async (req: Request, res: Response) => {
  const tenantId = req.user?.customerId;
  if (typeof tenantId !== "number") {
    apiError(res, 400, ApiErrorCode.VALIDATION, "This session is not scoped to a customer");
    return;
  }

  try {
    const requests = await listReinstatementRequests(tenantId);
    res.json({
      open: requests.find((r) => r.status === "open") ? toWireRequest(requests.find((r) => r.status === "open")!) : null,
      requests: requests.map(toWireRequest),
    });
  } catch (err) {
    req.log.error({ err, tenantId }, "portal: reinstatement request list failed");
    apiError(res, 500, ApiErrorCode.INTERNAL, "Failed to read reinstatement requests");
  }
});

/** DELETE /api/portal/retention/reinstatement — the customer withdrawing their request. */
router.delete("/portal/retention/reinstatement", requireAuth, async (req: Request, res: Response) => {
  const tenantId = req.user?.customerId;
  if (typeof tenantId !== "number") {
    apiError(res, 400, ApiErrorCode.VALIDATION, "This session is not scoped to a customer");
    return;
  }

  try {
    const withdrawn = await withdrawReinstatementRequest(tenantId);
    res.json({ ok: true, withdrawn });
  } catch (err) {
    req.log.error({ err, tenantId }, "portal: reinstatement withdrawal failed");
    apiError(res, 500, ApiErrorCode.INTERNAL, "Failed to withdraw reinstatement request");
  }
});

export default router;
