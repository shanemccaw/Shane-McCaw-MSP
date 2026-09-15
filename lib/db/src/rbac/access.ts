/**
 * `evaluateAccess()` — the ONE decision point composing RBAC and tier entitlement
 * (#4191, leaf 1 of #1704). Implements Shane's 2026-08-29 decision comment on #1704.
 *
 * ── One call, two evaluators, distinct denials ───────────────────────────────
 *
 * Shane, #1704 (2026-08-29): *"RBAC and tier gating go through the same engine. They
 * are not separate middleware."* With 1,626 API endpoints, two independent interception
 * points guarantee routes that carry one and not the other — that bug already exists
 * between `requireRole`/`requireMspScope`, and a third hand-applied guard
 * (`requireTierFeature`, 31 call sites) makes three ways to be half-protected. One
 * decision point is the only shape #1698's gating pass can verify exhaustively.
 *
 * But the two evaluators answer DIFFERENT questions, and the denial must say which:
 *
 *   | RBAC ("may this PERSON do this")            | Tier ("did this ORG pay for this")      |
 *   | the individual, via their roles             | the organisation, via entitlement       |
 *   | "your admin has not granted this"           | "your plan does not include this"       |
 *   | UI: dead end — explain and stop             | UI: upsell — the upgrade panel          |
 *   | changes when an admin edits a role          | changes when a plan is bought/downgraded|
 *
 * A tier denial is a sales moment. An RBAC denial is not. Collapsing them into a generic
 * 403 throws the difference away, so `basis` is what drives the UI.
 *
 * ── The rules, stated once, deliberately ────────────────────────────────────
 *
 * 1. **RBAC is evaluated first, unconditionally.** If the person may not do the thing
 *    at all, the answer is `basis: "rbac"` and the tier input is NOT READ — telling
 *    someone to upgrade is wrong, and it leaks what the org has not bought to a person
 *    who could not use it anyway. ./access.test.ts proves the input's `tier` property is
 *    never touched on an RBAC denial, not merely that the outcome is right.
 *
 * 2. **Only if RBAC allows is the tier consulted.** `tier: null` means this action has no
 *    tier axis at all (most of the 1,626 routes) and the RBAC answer stands alone. A
 *    tier miss is `basis: "entitlement"`, carrying the real `requiredTier` and the
 *    `upgradePath` the portal already uses for exactly this moment.
 *
 * 3. **Every denial carries a human-readable `reason`.** Neither `requireCapability` nor
 *    `requireCustomerCapability` logs a real deny today (only the `unavailable` path
 *    logs) — Shane's decision requires *"both denials audited with their reason
 *    (`logger.child({ channel: "auth" })`)"*. This function does not log (it is pure);
 *    the middleware built on it (#4192) logs, and the `reason` returned here is what it
 *    logs. The full `rbac` sub-decision (effect, deciding role ids) rides along for the
 *    same audit record.
 *
 * 4. **Scoping is composed, not reinvented.** The RBAC half is `evaluateCapability`'s
 *    `orgId` scoping (a foreign org's mapping rows are discarded); the tier half is the
 *    customer-scoped `includedFeatures` list `resolveCustomerIncludedFeatures` already
 *    resolves. #1704 requirement 3 (resource-scoped) is met by composing those two
 *    existing scoped checks — no new resource model.
 *
 * 5. **Fail closed, both halves.** An uncatalogued capability is an RBAC denial (#1696
 *    rule 4, via `evaluateCapability`). An uncatalogued module key is an entitlement
 *    denial with `requiredTier: null`, never an allow.
 *
 * ── The data stays separate ─────────────────────────────────────────────────
 *
 * Shared decision point, SEPARATE sources of truth. RBAC: `*_roles`, `*_user_roles`,
 * `*_feature_role_mapping` (#1696). Entitlement: `services.type_attributes.includedFeatures`
 * on the twelve `monitoring_tier` rows (#1168/#1280). A role is not a tier and a tier is
 * not a role; nothing here lets one table answer the other's question.
 *
 * Deliberately NOT folded in, each already its own correct, separate gate with its own
 * header warning against conflation: `subscriptionGate.ts` (whole-tenant billing/retention
 * lapse), `portal-addon-entitlements.ts` (per-tenant add-on purchase, e.g. Change Control),
 * `lib/msp-entitlement.ts` (the MSP's own platform subscription).
 *
 * ── Caching — decided here, not left open (#4191) ───────────────────────────
 *
 * There is NO cross-request cache for per-principal RBAC resolution or per-customer tier
 * resolution, and this is #1704's real, final answer, not a placeholder. A revoke must
 * take effect on the next request, not after a TTL — `rbac-capability.ts` puts it as
 * "caching them is exactly how a revoke stops taking effect" — and a tier downgrade is
 * the same statement about the other axis. The one deliberate exception is
 * `rbac-ladder.ts`'s 30-second snapshot of seven platform-wide, rarely-mutated rows shared
 * across 616 gates: broad, shared, and not per-principal, which is a genuinely different
 * case. This function is pure and holds no state, so it cannot cache anything; the
 * discipline lives in the loaders that feed it.
 *
 * This module is PURE — no database, no clock, no environment, no logger. Loading the
 * rows is the caller's job, exactly as ./load.ts feeds ./evaluate.ts.
 */

import type { RbacSystem } from "./capabilities.ts";
import { evaluateCapability, type RbacDecision, type RbacEvaluationInput } from "./evaluate.ts";
import { isPortalTierModuleKey, type PortalTierModuleKey } from "./tier-modules.ts";

/**
 * Where an entitlement denial sends the customer.
 *
 * The portal SPA mounts at `/portal/` (artifacts/portal/src/App.tsx, `ROUTER_BASE`) and
 * its `/billing` page is where every tier-gated page already points a customer whose
 * tier does not bundle a module ("See your plan" on ownership.tsx, "Your plan and tier
 * under Billing" on poams.tsx). Absolute rather than router-relative so an API response
 * can carry it verbatim — the same convention `msp-entitlement.ts`'s `upgradeUrl` uses.
 */
export const TIER_UPGRADE_PATH = "/portal/billing";

/**
 * One `services` row with `service_type = 'monitoring_tier'`, decoded — the catalog the
 * entitlement half names `requiredTier` from.
 *
 * `sortOrder` is the real `services.sort_order` column, which orders the twelve live rows
 * Foundation (1–4) < Growth (5–8) < Premier (9–12). The tier ladder is therefore read from
 * data, not from a tier-name list compiled into this file; a re-ordered catalog re-orders
 * the answer with no code change.
 */
export interface TierCatalogEntry {
  /** `services.tier` — `foundation` / `growth` / `premier` in the live vocabulary (#4035). */
  readonly tier: string;
  /** `services.sort_order`. Lower is the cheaper, less inclusive tier. */
  readonly sortOrder: number;
  /** `services.type_attributes.includedFeatures`, strings only. */
  readonly includedFeatures: readonly string[];
}

/** The entitlement half's input. `null` on `AccessEvaluationInput.tier` = no tier axis for this action. */
export interface TierEvaluationInput {
  /** The module this action reads. Typed against the catalogued vocabulary. */
  readonly moduleKey: PortalTierModuleKey;
  /**
   * The org's ACTIVE monitoring tier's `includedFeatures` — `resolveCustomerIncludedFeatures`'s
   * result, customer-scoped. Empty = no active monitoring subscription, which bundles
   * nothing (fails closed with no null check needed).
   */
  readonly includedFeatures: readonly string[];
  /** `services.tier` of that active row, for the reason string. `null`/omitted = no active subscription or unknown. */
  readonly currentTier?: string | null;
  /**
   * Every `monitoring_tier` catalog row, so a miss can name the tier that bundles the
   * module. Omitted or empty ⇒ `requiredTier` is `null` — the DECISION is unaffected
   * (a miss is still a miss); only the upsell loses its label.
   */
  readonly catalog?: readonly TierCatalogEntry[];
}

export interface AccessEvaluationInput {
  /** From ./evaluate.ts, unchanged. */
  readonly rbac: RbacEvaluationInput;
  /** `null` = this action has no tier check; the RBAC answer stands alone. */
  readonly tier: TierEvaluationInput | null;
}

/** What the entitlement half checked, kept on an allow for the audit record. */
export interface TierGrant {
  readonly moduleKey: PortalTierModuleKey;
  readonly currentTier: string | null;
}

export interface AccessAllowed {
  readonly allowed: true;
  readonly rbac: RbacDecision;
  /** `null` when the action had no tier axis (`tier: null`). */
  readonly tier: TierGrant | null;
}

/** "Your admin has not granted this." The UI explains and stops; no upgrade offer. */
export interface AccessDeniedByRbac {
  readonly allowed: false;
  readonly basis: "rbac";
  /** Human-readable, audit-ready. */
  readonly reason: string;
  /** The catalog key that was asked about, e.g. `changes.approve`. */
  readonly capability: string;
  /** The identity system it belongs to — the key alone is not unique (#2455). */
  readonly system: RbacSystem;
  /** The full RBAC sub-decision: `effect` and the deciding role ids, for the audit record. */
  readonly rbac: RbacDecision;
}

/** "Your plan does not include this." The UI renders the upgrade panel. */
export interface AccessDeniedByEntitlement {
  readonly allowed: false;
  readonly basis: "entitlement";
  /** Human-readable, audit-ready. */
  readonly reason: string;
  /**
   * The lowest catalog tier that bundles `moduleKey`, by `services.sort_order`.
   *
   * `null` means NO catalog row bundles it — an add-on that is not on the tier axis,
   * an uncatalogued key, an empty catalog. Render the denial, not an upgrade offer:
   * there is no tier to sell.
   */
  readonly requiredTier: string | null;
  /** `TIER_UPGRADE_PATH`. */
  readonly upgradePath: string;
  /** The module that was asked about. A plain string here because an uncatalogued key still lands in this branch. */
  readonly moduleKey: string;
  /** The org's current `services.tier`, when the caller supplied it. */
  readonly currentTier: string | null;
  /** The RBAC half that ALLOWED — the person may act, the org is not entitled. */
  readonly rbac: RbacDecision;
}

export type AccessDenied = AccessDeniedByRbac | AccessDeniedByEntitlement;
export type AccessDecision = AccessAllowed | AccessDenied;

/**
 * The lowest tier that bundles `moduleKey`, by `sortOrder`. Row-level and order-
 * independent: the catalog may arrive in any order and may carry several rows per tier
 * (one per size bracket); the minimum `sortOrder` wins, ties broken by tier name so the
 * answer is stable. `null` when no row bundles it.
 */
export function lowestTierBundling(moduleKey: string, catalog: readonly TierCatalogEntry[]): string | null {
  let best: TierCatalogEntry | null = null;
  for (const entry of catalog) {
    if (!entry.includedFeatures.includes(moduleKey)) continue;
    if (
      best === null ||
      entry.sortOrder < best.sortOrder ||
      (entry.sortOrder === best.sortOrder && entry.tier < best.tier)
    ) {
      best = entry;
    }
  }
  return best === null ? null : best.tier;
}

function rbacReason(rbac: RbacDecision): string {
  const id = `${rbac.system}:${rbac.capability}`;
  switch (rbac.effect) {
    case "deny":
      return `Denied by role: a role this user holds explicitly denies "${id}" (deny wins).`;
    case "unset":
      return `No role this user holds grants "${id}".`;
    case "unknown-capability":
      return `"${id}" is not a catalogued capability; failing closed.`;
    default:
      // Unreachable while `evaluateCapability` only pairs `allowed: true` with `allow` —
      // kept as a plain string rather than a throw, because an authorization path does
      // not get to throw over a reason label.
      return `"${id}" was not granted (${rbac.effect}).`;
  }
}

function entitlementReason(
  moduleKey: string,
  currentTier: string | null,
  hasActiveBundle: boolean,
  requiredTier: string | null,
): string {
  const subject =
    currentTier !== null
      ? `Monitoring tier "${currentTier}" does not bundle "${moduleKey}"`
      : hasActiveBundle
        ? `The organisation's current Monitoring tier does not bundle "${moduleKey}"`
        : `No active Monitoring tier subscription bundles "${moduleKey}"`;
  const tail =
    requiredTier !== null
      ? `it is included from the "${requiredTier}" tier.`
      : `no Monitoring tier in the catalog bundles it.`;
  return `${subject}; ${tail}`;
}

/**
 * Decide ONE action for ONE principal in ONE org. RBAC first; tier only if RBAC allows;
 * both denials say why.
 */
export function evaluateAccess(input: AccessEvaluationInput): AccessDecision {
  // Rule 1 — RBAC first, unconditionally. `input.tier` is not read above this return:
  // a person who may not act is never told what their org has or has not bought.
  const rbac = evaluateCapability(input.rbac);
  if (!rbac.allowed) {
    return {
      allowed: false,
      basis: "rbac",
      reason: rbacReason(rbac),
      capability: rbac.capability,
      system: rbac.system,
      rbac,
    };
  }

  // Rule 2 — only now is the org's entitlement consulted.
  const tier = input.tier;
  if (tier === null) {
    return { allowed: true, rbac, tier: null };
  }

  const moduleKey: string = tier.moduleKey;
  const currentTier = tier.currentTier ?? null;
  const catalog = tier.catalog ?? [];
  const hasActiveBundle = tier.includedFeatures.length > 0;

  // Rule 5 — a key that maps onto nothing is a bug on an authorization path; it fails
  // closed, and with `requiredTier: null` so nobody is offered an upgrade to fix a typo.
  if (!isPortalTierModuleKey(moduleKey)) {
    return {
      allowed: false,
      basis: "entitlement",
      reason: `"${moduleKey}" is not a catalogued Monitoring tier module; failing closed.`,
      requiredTier: null,
      upgradePath: TIER_UPGRADE_PATH,
      moduleKey,
      currentTier,
      rbac,
    };
  }

  if (tier.includedFeatures.includes(moduleKey)) {
    return { allowed: true, rbac, tier: { moduleKey, currentTier } };
  }

  const requiredTier = lowestTierBundling(moduleKey, catalog);
  return {
    allowed: false,
    basis: "entitlement",
    reason: entitlementReason(moduleKey, currentTier, hasActiveBundle, requiredTier),
    requiredTier,
    upgradePath: TIER_UPGRADE_PATH,
    moduleKey,
    currentTier,
    rbac,
  };
}
