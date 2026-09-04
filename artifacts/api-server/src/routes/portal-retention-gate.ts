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

const router: IRouter = Router();

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
        // An active customer has no lapse instant and no purge date. Null, not a
        // computed placeholder — the screen renders those as unavailable.
        lapsedAt: null,
        purgeDueAt: null,
        purgedAt: null,
        retentionYears: state.postTerminationYears,
        retentionYearsIsDefault: state.postTerminationIsDefault,
        allowedPaths: SUBSCRIPTION_GATE_ALLOWED_PREFIXES,
      });
      return;
    }

    // Byte-identical to the body the gate itself returns on a 403, so the screen has one
    // shape to render whether it arrived by being turned away or by asking directly.
    res.json(subscriptionGateBody(state));
  } catch (err) {
    req.log.error({ err, tenantId }, "portal: subscription-gate status read failed");
    apiError(res, 500, ApiErrorCode.INTERNAL, "Failed to read subscription state");
  }
});

export default router;
