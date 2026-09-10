/**
 * The two identity-derived presentation rules the PORTAL used to own (#2459,
 * part of #1696) — migration step 4 of 5.
 *
 * #1696's re-measure comment is explicit about the new artifacts: *"Neither
 * should ever import a role literal. They consume capabilities, not roles."*
 * `artifacts/portal` was importing three: a seven-member `MspRole` union, a
 * role→label table, and a role→landing-surface chain repeated twice in
 * `auth-context.tsx` (`:476` and `:801`). All three are identity rules, and an
 * identity rule that lives only in a component is — in #1696's own words — *"a
 * rule that exists nowhere the server can enforce it."*
 *
 * So they live here, once, server-side, and the portal reads the ANSWER.
 *
 * ── Why these two are NOT capabilities ──────────────────────────────────────
 *
 * They deliberately do not go through `rbac_capabilities`. A capability is an
 * authorization decision — something a role may be granted or denied, and that
 * a route can gate on. Neither of these is:
 *
 *  - A display label answers "what should this badge say", not "may you". It
 *    grants nothing, and cataloguing it would be exactly the "display vocabulary
 *    that maps onto nothing" the catalog's own header warns against.
 *  - A landing surface answers "where does this identity start". Every landing
 *    target is a route the identity can reach anyway; picking a different one
 *    grants no access it did not already have. What it must not do is DISAGREE
 *    with the server, which is what having two copies in the client guaranteed.
 *
 * Capabilities are served separately, from the real evaluator, by
 * `routes/auth-session-context.ts`. This module is the presentation half of the
 * same response, and is kept apart from it so the distinction is legible.
 *
 * ── Transitional, by construction ───────────────────────────────────────────
 *
 * Both functions key off the legacy `MspRole` rung, because that is genuinely
 * what decides them today. That is not an endorsement of the ladder — it is the
 * same discipline `legacy-ladder.ts` applies: transcribe today's real rule into
 * one server-side place, so that when #2460 retires `MSP_ROLES` there is exactly
 * one call site to change instead of three files across two apps.
 */

import { effectiveLegacyRole, type LegacyRole } from "@workspace/db/rbac/legacy-ladder";

/**
 * The portal route segment an identity lands on after an impersonation exchange.
 *
 * Transcribed verbatim from what `artifacts/portal/src/lib/auth-context.tsx`
 * decided client-side before this landed — the same chain, in both of the two
 * places it was written out:
 *
 *   Assessment    -> "copilot-readiness"
 *   CustomerUser  -> "portal-v2"
 *   everything else (and an absent/unknown role) -> "dashboard"
 *
 * `Free` falling through to "dashboard" is carried across deliberately rather
 * than tidied to "portal-v2": that is what the running product does today, and a
 * step whose contract is "nothing observable changes" is the wrong place to
 * change where a Free-tier user lands. If that is wrong it is a real product
 * decision, and it now has one place to be made instead of two.
 */
export type PortalLandingSurface = string;

export function portalLandingSurface(effective: LegacyRole | undefined): PortalLandingSurface {
  if (effective === "Assessment") return "copilot-readiness";
  if (effective === "CustomerUser") return "portal-v2";
  return "dashboard";
}

/**
 * Display label for the signed-in identity's badge.
 *
 * Transcribed from `artifacts/portal/src/components/shell/UserMenu.tsx`'s
 * `MSP_ROLE_LABEL` table, including its fallback: when there is no recognisable
 * `mspRole`, the coarse `users.role` column decides between "Admin" and
 * "Customer". Display only — nothing branches on the returned string.
 */
const ROLE_LABELS: Readonly<Record<LegacyRole, string>> = Object.freeze({
  Assessment: "Assessment",
  Free: "Free",
  CustomerUser: "Customer",
  ServiceAccount: "Service Account",
  MSPOperator: "MSP Operator",
  MSPAdmin: "MSP Admin",
  PlatformAdmin: "Platform Admin",
});

export function identityRoleLabel(user: { role: string; mspRole: string | null }): string {
  const effective = effectiveLegacyRole(user);
  if (effective) return ROLE_LABELS[effective];
  return user.role === "admin" ? "Admin" : "Customer";
}

/**
 * Both presentation values for one identity, resolved together.
 *
 * `effectiveLegacyRole` — not `mspRole` directly — is what both rules read, so
 * the `role === "admin"` → `PlatformAdmin` promotion `requireRole` has always
 * applied (`requireAuth.ts:210-212`) is honoured here too. #1696 requires that
 * promotion be *"carried across deliberately rather than inherited by
 * accident"*; reading it through the same shared function is how.
 */
export function identityPresentation(user: { role: string; mspRole: string | null }): {
  roleLabel: string;
  landingSurface: PortalLandingSurface;
} {
  const effective = effectiveLegacyRole(user);
  return {
    roleLabel: effective ? ROLE_LABELS[effective] : user.role === "admin" ? "Admin" : "Customer",
    landingSurface: portalLandingSurface(effective),
  };
}
