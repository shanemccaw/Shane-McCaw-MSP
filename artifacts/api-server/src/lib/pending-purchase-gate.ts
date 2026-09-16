/**
 * THE PENDING-PURCHASE GATE — decision logic (Git #4375, issue 5 of Feature #4370).
 *
 * The Express middleware lives in `src/middlewares/pendingPurchaseGate.ts`; this module is
 * the decision itself, kept pure — a function of (principal, method, path) with no request
 * object and no database — the same split `retention/subscription-gate.ts` (#2765) uses.
 *
 * Confirmed with Shane (#4370, 2026-09-16): *"a `*Pending` account
 * (`MonitoringPending`/`PackPending`/`RetainerPending`) can see ONLY the
 * resume-your-purchase stub — nothing else in the portal."*
 *
 * Mounted once in `app.ts`, ahead of the whole `/api` router, for the same reason the
 * subscription gate is: a handful of routes verify the JWT themselves rather than going
 * through `requireAuth` (notifications, portal-projects, portal-offers, …), so a gate
 * inside `requireAuth` would have holes. A gate in front of routing has none — an
 * arbitrary route nobody thought of is closed to a pending session by default.
 *
 * Checked server-side against the verified JWT claim and then confirmed against the live
 * `users` row (see the middleware) — never trusted from the client.
 */

import type { MspRole } from "@workspace/db";
import { LEGACY_ROLE, canonicalRoleValue } from "@workspace/db/rbac/legacy-ladder";

/** The machine-readable code a gated response carries. The portal shell keys on it. */
export const PENDING_PURCHASE_GATE_CODE = "pending_purchase";

/**
 * The three pre-consent rungs #4371 put on the ladder. A principal holding one of these
 * has an account but no consented tenant yet, and may reach only the resume stub.
 */
export const PENDING_PURCHASE_ROLES: readonly MspRole[] = Object.freeze([
  LEGACY_ROLE.monitoringPending,
  LEGACY_ROLE.packPending,
  LEGACY_ROLE.retainerPending,
]);

/**
 * Everything a pending session may still reach. Prefix matches; paths are as the router
 * sees them (`/api` is stripped by the mount point).
 *
 *   - **Session** (`/auth/`) — login, refresh, logout, password reset, and every
 *     `/auth/mfa/*` enrollment and challenge route. A pending account is a real
 *     password + MFA account (#4370 issue 4); blocking enrollment would deadlock against
 *     #439's `mfaSetupPending` gate inside `requireAuth`, and logout must never be gated.
 *     Every route under this prefix still enforces its own authentication.
 *   - **Public** (`/public/`) — routes that are reachable anonymously by design, so gating
 *     them for a caller who happens to send a bearer token protects nothing. The purchase
 *     stage machines the stub resumes into (#4377/#4378 — `/public/purchase/*`,
 *     `/public/flow/*`) live here.
 *   - **Liveness** — `/health`, `/version`.
 *
 * TODO(#4379): add the resume-purchase stub's own API route(s) here once #4379 settles
 * them. Deliberately not guessed — until then the stub's data read is gated like any
 * other portal route, which fails closed rather than open.
 */
export const PENDING_PURCHASE_GATE_ALLOWED_PREFIXES: readonly string[] = Object.freeze([
  "/auth/",
  "/public/",
  "/health",
  "/version",
]);

/**
 * Where the gated portal should send a pending session.
 *
 * TODO(#4379): set to the resume-purchase stub's real portal route once #4379 posts it on
 * #4375. Null until then — the body reports "no destination yet" honestly rather than a
 * guessed path.
 */
export const PENDING_PURCHASE_RESUME_PATH: string | null = null;

export interface PendingGatePrincipal {
  /** Legacy top-level role claim. `"admin"` is PlatformAdmin and is never pending. */
  role?: "admin" | "client";
  mspRole?: string | null;
}

/** The pending rung this principal holds, or null when it holds none. */
export function pendingRoleOf(principal: PendingGatePrincipal | null | undefined): MspRole | null {
  if (!principal || principal.role === "admin") return null;
  // A token signed before #4371's rename still says `RetainerNoConsent`.
  const role = canonicalRoleValue(principal.mspRole ?? null);
  return typeof role === "string" && (PENDING_PURCHASE_ROLES as readonly string[]).includes(role)
    ? (role as MspRole)
    : null;
}

/** True when this path stays reachable for a pending session. */
export function isPendingGateAllowedPath(path: string): boolean {
  const clean = (path.split("?")[0] ?? path).replace(/\/+$/, "") || "/";
  return PENDING_PURCHASE_GATE_ALLOWED_PREFIXES.some(
    (prefix) => clean === prefix.replace(/\/+$/, "") || clean.startsWith(prefix),
  );
}

export type PendingGateOutcome =
  | { gated: false; reason: "not_pending" }
  | { gated: false; reason: "allowlisted"; pendingRole: MspRole }
  | { gated: true; pendingRole: MspRole };

/**
 * The whole decision. `pendingRole` is the rung the caller holds, already resolved (the
 * middleware resolves it from the verified token and confirms it against the live row).
 *
 * CORS preflight passes — a browser sends `OPTIONS` without credentials, and gating it
 * would surface the real request as a CORS error instead of the gate's body.
 */
export function evaluatePendingPurchaseGate(input: {
  pendingRole: MspRole | null;
  method: string;
  path: string;
}): PendingGateOutcome {
  if (input.method === "OPTIONS" || input.pendingRole === null) return { gated: false, reason: "not_pending" };
  if (isPendingGateAllowedPath(input.path)) return { gated: false, reason: "allowlisted", pendingRole: input.pendingRole };
  return { gated: true, pendingRole: input.pendingRole };
}

export interface PendingPurchaseGateBody {
  code: typeof PENDING_PURCHASE_GATE_CODE;
  /** The pending rung that closed the portal — tells the stub which purchase to resume. */
  pendingRole: MspRole;
  /** The stub's portal route. Null until #4379 lands (see `PENDING_PURCHASE_RESUME_PATH`). */
  resumePath: string | null;
  allowedPaths: readonly string[];
}

export function pendingPurchaseGateBody(pendingRole: MspRole): PendingPurchaseGateBody {
  return {
    code: PENDING_PURCHASE_GATE_CODE,
    pendingRole,
    resumePath: PENDING_PURCHASE_RESUME_PATH,
    allowedPaths: PENDING_PURCHASE_GATE_ALLOWED_PREFIXES,
  };
}
