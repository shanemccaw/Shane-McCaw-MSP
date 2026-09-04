/**
 * THE SUBSCRIPTION GATE MIDDLEWARE (Git #2765, EPIC #1944 part 8).
 *
 * ONE check point, mounted ONCE in `app.ts` directly ahead of the entire `/api` router:
 *
 *   app.use("/api", subscriptionGate, router);
 *
 * That mount is the whole design. #1944 part 8:
 *
 *   *"No new role. No new permission. No per-page lock-down awareness anywhere in the
 *   application code — the gate is one check, one place, and every existing route is
 *   automatically covered by simply sitting behind it. ... Nothing can forget to check
 *   it. A flag-based approach requires every route, or at least every route's data
 *   layer, to respect the flag. A gate in front of routing cannot be bypassed by a route
 *   that forgot to check — there is nothing to forget."*
 *
 * Ahead of `requireAuth` and therefore ahead of every `requireRole`/`can()` evaluation,
 * which is the ordering the epic asks for: a lapsed customer never reaches permission
 * evaluation at all. It decodes the JWT itself and does not enforce it — an invalid or
 * absent token is not this middleware's business, and `requireAuth` rejects it moments
 * later on any route that needs one.
 *
 * The decision logic is in `lib/retention/subscription-gate.ts` as a pure function; this
 * file is the plumbing: read the token, resolve the tenant's state, apply the decision,
 * and keep the read cheap enough to run on every request.
 */

import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { logger } from "../lib/logger";
import {
  evaluateSubscriptionGate,
  gatedTenantIdFor,
  subscriptionGateBody,
  type GatePrincipal,
} from "../lib/retention/subscription-gate";
import {
  invalidateSubscriptionGateCache,
  readTenantSubscriptionStateCached,
  syncTenantRetentionState,
} from "../lib/retention/subscription-state";

const log = logger.child({ channel: "auth" });

/** Decode without enforcing. Enforcement is `requireAuth`'s job, on the routes that need it. */
function principalFromRequest(req: Request): GatePrincipal | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  try {
    return jwt.verify(header.slice(7), secret) as GatePrincipal;
  } catch {
    // Expired or forged. Not gated, not authenticated — `requireAuth` answers 401.
    return null;
  }
}

export function subscriptionGate(req: Request, res: Response, next: NextFunction): void {
  const principal = principalFromRequest(req);
  const tenantId = gatedTenantIdFor(principal);

  // No customer principal — public route, operator session, or no tenant claim. The
  // overwhelmingly common case, and it costs one synchronous branch with no I/O.
  if (tenantId === null) {
    next();
    return;
  }

  void readTenantSubscriptionStateCached(tenantId)
    .then((state) => {
      const outcome = evaluateSubscriptionGate({
        principal,
        method: req.method,
        path: req.path,
        state,
      });

      // The gate reads the tenant row on every customer request anyway, so it is also
      // the cheapest place to notice a `tenants.status` that was changed by a path that
      // never called the retention hook. Fire-and-forget: the reconciliation freezes or
      // resumes clocks, which must not sit in the request's latency path, and the sweep
      // would catch it within the day regardless.
      // `lapsedAt === null` is supposed to mean exactly "running now"; when it disagrees
      // with `status`, something wrote the status without reconciling.
      const stateDisagreesWithItself =
        state !== null && state.active === (state.lapsedAt !== null);
      if (stateDisagreesWithItself) {
        void syncTenantRetentionState(tenantId)
          .then((r) => {
            if (r.action !== "none") invalidateSubscriptionGateCache(tenantId);
          })
          .catch((err: unknown) => {
            log.warn({ err, tenantId }, "subscription-gate: opportunistic retention sync failed (non-fatal)");
          });
      }

      if (!outcome.gated) {
        next();
        return;
      }

      log.info(
        { tenantId, status: outcome.state.status, method: req.method, path: req.path },
        "subscription-gate: inactive subscription — route resolved to the retention wall",
      );
      res.status(403).json(subscriptionGateBody(outcome.state));
    })
    .catch((err: unknown) => {
      // FAIL OPEN, deliberately, and this is the one judgement call in the file.
      //
      // A database blip must not lock every paying customer out of the entire product.
      // The gate is a billing boundary, not a security boundary: everything behind it is
      // still fully protected by `requireAuth` and `can()`, which run next and are
      // unaffected by this failure. The worst case here is a cancelled customer briefly
      // reaching a portal they are no longer paying for; the worst case for failing
      // closed is every active customer seeing a cancellation wall. Logged at error so
      // it is never silent.
      log.error({ err, tenantId }, "subscription-gate: state resolution failed — allowing through");
      next();
    });
}
