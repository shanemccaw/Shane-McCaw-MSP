/**
 * THE SUBSCRIPTION GATE — decision logic (Git #2765, EPIC #1944 part 8).
 *
 * The Express middleware lives in `src/middlewares/subscriptionGate.ts`; this module is
 * the decision itself, kept separate so it is testable as a pure function of
 * (principal, method, path, subscription state) with no request object and no database.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The mechanism, exactly as #1944 part 8 specifies it
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   *"Active-subscription check, evaluated on login and on every navigation, sitting in
 *   front of routing rather than inside it. Subscription active → normal portal, normal
 *   `can()` evaluation... Subscription inactive → every route resolves to one screen:
 *   'Come back! Download your data.' Export remains reachable; everything else is
 *   unreachable before role evaluation is ever consulted."*
 *
 * Three properties that are requirements, not implementation details:
 *
 *   1. **No new role and no new permission.** Nothing here mints a principal, and
 *      nothing consults `can()`. The gate runs strictly earlier than permission
 *      evaluation and answers a different question — not *may this principal do this*,
 *      but *is this customer's portal open at all*.
 *   2. **No per-route lock-down awareness.** No route knows this exists. The allowlist
 *      below is the gate's own data, held in one place; a route is reachable during
 *      lock-down because this list names it, never because the route checks a flag.
 *   3. **Symmetric and live.** *"Full unlock the moment the subscription goes active
 *      again — the gate is re-evaluated live, not a one-time transition."* Nothing here
 *      is decided at login and cached into a token.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Who the gate applies to
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The customer's own portal session, and only that. An operator (MSPOperator, MSPAdmin,
 * PlatformAdmin) reaching a lapsed customer's data passes through untouched, for a
 * reason that is structural rather than a convenience: the #1571 operator review queue
 * exists precisely to look at cancelled customers' ghosted records, and #1944 part 7 is
 * explicit that the bare shell is *the customer's* capability. Gating the operator would
 * make the wall opaque from the only side that can act on what is behind it.
 *
 * Reading `mspRole` to tell a customer principal from an operator one is NOT the "new
 * role" part 8 rules out — the roles already exist and already mean this. What part 8
 * forbids is inventing a *locked-down* role or permission, and there is none here.
 */

import type { MspRole } from "@workspace/db";
import type { TenantSubscriptionState } from "./subscription-state";

/** The machine-readable code the gated response carries. The portal shell keys on it. */
export const SUBSCRIPTION_GATE_CODE = "subscription_inactive";

/**
 * Everything a customer principal may still reach while the subscription is inactive.
 *
 * *"Export remains reachable; everything else is unreachable."* Four groups, and every
 * entry earns its place:
 *
 *   - **Export.** The one real capability of the bare shell. All three real export
 *     endpoints, because a customer who is owed their data must not be told which
 *     module happens to hold it.
 *   - **Session.** Without login/refresh/logout there is no session to render the wall
 *     to, and a customer would be locked out of their own export by the gate meant to
 *     hand it to them. Logout in particular must never be gated — trapping someone in a
 *     session they cannot end is the one failure mode worse than over-gating.
 *   - **MFA.** Enrollment and challenge endpoints are part of logging in. #439's
 *     `mfaSetupPending` gate already sits inside `requireAuth`; if this gate blocked
 *     those routes the two would deadlock — one demanding enrollment, the other refusing
 *     the enrollment call.
 *   - **The gate's own status endpoint**, so the wall can render real numbers (when the
 *     subscription lapsed, when the data purges) instead of a blank screen. Excluding it
 *     would force the screen to invent them, which this project forbids.
 *
 * Prefix matches, deliberately. `/portal/data-export` and any future
 * `/portal/data-export/:id` are the same capability, and enumerating sub-paths is the
 * per-route awareness part 8 exists to avoid.
 *
 * Paths are as the router sees them: `/api` is stripped by the mount point.
 */
export const SUBSCRIPTION_GATE_ALLOWED_PREFIXES: readonly string[] = [
  // ── Export — the bare shell's one capability ──
  // Both real export endpoints, confirmed against the router rather than assumed:
  // `portal-privacy.ts` serves /portal/data-export and `portal-customer-engines.ts`
  // serves /portal/customer/export. There is no third; none is listed speculatively.
  "/portal/data-export",
  "/portal/customer/export",
  // ── Session ──
  // One prefix covers login, refresh, logout, password reset and every /auth/mfa/*
  // challenge and enrollment route, which is the point: enumerating them is the
  // per-route awareness part 8 rules out, and a missed one locks a customer out of
  // the export the wall is offering them.
  "/auth/",
  // ── The wall's own data ──
  "/portal/retention/subscription-gate",
  // ── Liveness, so a gated deployment is still observable ──
  "/health",
  "/version",
];

/** MSP-side and platform-side principals. The gate is the customer's portal, not theirs. */
const OPERATOR_ROLES: readonly MspRole[] = ["ServiceAccount", "MSPOperator", "MSPAdmin", "PlatformAdmin"];

export interface GatePrincipal {
  /** Legacy top-level role claim. `"admin"` is PlatformAdmin, same as everywhere else. */
  role?: "admin" | "client";
  mspRole?: MspRole;
  /** `users.tenantId`, carried under the frozen `customerId` claim name (Phase 1, #94). */
  customerId?: number;
}

export type GateOutcome =
  /** No customer principal to gate — a public route, or an operator session. */
  | { gated: false; reason: "no_customer_principal" }
  /** The customer is paying. Normal portal. */
  | { gated: false; reason: "subscription_active" }
  /** Inactive, but this path is the export/session/wall surface that stays reachable. */
  | { gated: false; reason: "allowlisted"; state: TenantSubscriptionState }
  /** Inactive, and this is one of the routes that resolve to the wall. */
  | { gated: true; state: TenantSubscriptionState };

/**
 * The tenant this request's principal is a customer of, or null when the request has no
 * customer principal to gate.
 *
 * Null covers three genuinely different cases that all mean "not this gate's business":
 * an unauthenticated request (public marketing routes, the login call itself), an
 * operator session, and a customer principal with no tenant claim.
 *
 * That last one is the interesting one, and it is deliberately NOT treated as suspicious.
 * A gate that denied on an unresolvable principal would break the assessment/free signup
 * flows, which legitimately hold a session before a tenant exists — and it would be
 * denying on a question it cannot answer. Authentication is `requireAuth`'s job and
 * happens immediately after; a request that reaches a real route with no valid identity
 * is rejected there, by the middleware that actually owns that decision.
 */
export function gatedTenantIdFor(principal: GatePrincipal | null | undefined): number | null {
  if (!principal) return null;
  const effectiveRole: MspRole | undefined =
    principal.role === "admin" ? "PlatformAdmin" : principal.mspRole;
  if (effectiveRole && OPERATOR_ROLES.includes(effectiveRole)) return null;
  return typeof principal.customerId === "number" ? principal.customerId : null;
}

/** True when this path stays reachable while the subscription is inactive. */
export function isGateAllowedPath(path: string): boolean {
  // Query string and trailing slash are not part of the capability.
  const clean = (path.split("?")[0] ?? path).replace(/\/+$/, "") || "/";
  return SUBSCRIPTION_GATE_ALLOWED_PREFIXES.some(
    (prefix) => clean === prefix.replace(/\/+$/, "") || clean.startsWith(prefix),
  );
}

/**
 * The whole decision. Pure — every input is an argument, so the matrix is testable
 * without a server, a token or a database.
 *
 * CORS preflight passes: a browser sends `OPTIONS` with no credentials, so gating it
 * would make the real request fail as a CORS error rather than render the wall. The
 * request that follows carries the token and is gated properly.
 */
export function evaluateSubscriptionGate(input: {
  principal: GatePrincipal | null | undefined;
  method: string;
  path: string;
  /** Null when the principal's tenant does not exist — see `gatedTenantIdFor`. */
  state: TenantSubscriptionState | null;
}): GateOutcome {
  if (input.method === "OPTIONS") return { gated: false, reason: "no_customer_principal" };
  if (gatedTenantIdFor(input.principal) === null) return { gated: false, reason: "no_customer_principal" };
  if (!input.state) return { gated: false, reason: "no_customer_principal" };
  if (input.state.active) return { gated: false, reason: "subscription_active" };
  if (isGateAllowedPath(input.path)) return { gated: false, reason: "allowlisted", state: input.state };
  return { gated: true, state: input.state };
}

/**
 * The body a gated request gets back. 403 with a typed code, the same shape
 * `ConsentRevokedError` already returns for its own re-authorize wall — established
 * precedent in this codebase rather than a new contract.
 *
 * Every field is real or null. `lapsedAt`/`purgeDueAt` are null until the reconciliation
 * has stamped a real lapse instant, and the screen must render that as unavailable
 * rather than as a date it computed itself.
 */
export interface SubscriptionGateBody {
  code: typeof SUBSCRIPTION_GATE_CODE;
  subscriptionActive: false;
  tenantId: number;
  status: string;
  /**
   * Which rule closed the portal (#2847): `"subscription"` when a real
   * `tenant_subscriptions` row is cancelled/unpaid, `"tenant_status"` when this customer
   * has no subscription on record and `tenants.status` alone said so. The wall needs
   * this to be honest — telling a customer their subscription ended when the platform
   * holds no subscription record for them would be inventing a billing fact.
   */
  billingSource: "subscription" | "tenant_status";
  /** The status of the subscription that ended, or null when there is none on record. */
  subscriptionStatus: string | null;
  /** What they had, as it was named at purchase. Null, never a placeholder. */
  planName: string | null;
  lapsedAt: string | null;
  /** The post-termination window this customer is inside, in years. */
  retentionYears: number;
  /** True when `retentionYears` is the platform default rather than a per-customer override. */
  retentionYearsIsDefault: boolean;
  /** When the data purges if they never return. Null until a real lapse instant exists. */
  purgeDueAt: string | null;
  /** Non-null only on a tombstone — the data is already gone. */
  purgedAt: string | null;
  /** What is still reachable. The wall renders its one button from this, not from a constant. */
  allowedPaths: readonly string[];
}

export function subscriptionGateBody(state: TenantSubscriptionState): SubscriptionGateBody {
  return {
    code: SUBSCRIPTION_GATE_CODE,
    subscriptionActive: false,
    tenantId: state.tenantId,
    status: state.status,
    billingSource: state.billingSource,
    subscriptionStatus: state.subscriptionStatus,
    planName: state.planName,
    lapsedAt: state.lapsedAt?.toISOString() ?? null,
    retentionYears: state.postTerminationYears,
    retentionYearsIsDefault: state.postTerminationIsDefault,
    purgeDueAt: state.purgeDueAt?.toISOString() ?? null,
    purgedAt: state.purgedAt?.toISOString() ?? null,
    allowedPaths: SUBSCRIPTION_GATE_ALLOWED_PREFIXES,
  };
}
