/**
 * Monitoring-tier module keys — the ENTITLEMENT axis's vocabulary (#4191, part of #1704).
 *
 * These are the canonical strings written into `services.type_attributes.includedFeatures`
 * on the twelve `monitoring_tier` rows by
 * `lib/db/migrations/manual/2026-09-05-portal-tier-included-features-1168.sql`, and
 * checked by `artifacts/api-server/src/lib/portal-tier-features.ts`'s `hasTierFeature` /
 * `requireTierFeature` (#1168's "creation unconditional, tier only gates visibility" rule).
 *
 * They lived in that api-server module until #4191. They moved here — unchanged, one
 * key at a time — because `./access.ts`'s `evaluateAccess()` is a PURE function in this
 * package (no DB, no Express, same discipline as `./evaluate.ts`) and its `tier` input is
 * typed as `PortalTierModuleKey`; a `lib/*` package cannot import an `artifacts/*` app.
 * `portal-tier-features.ts` re-exports both names from here, so every existing route
 * import and every test that mocks that module is untouched.
 *
 * This is the vocabulary of the SECOND evaluator in Shane's 2026-08-29 decision on
 * #1704 ("did this ORG pay for this"), deliberately separate from `./capabilities.ts`
 * ("may this PERSON do this"). A tier is not a role and a role is not a tier — do not
 * merge these into the capability catalog; that conflation is exactly what #1696
 * diagnoses in `MSP_ROLES`.
 *
 * There is no `change_control` key (#4462). It used to be listed for documentation only
 * (Premier "functionally gets both", #1168) while nothing on the tier axis read it.
 * Change Control is an add-on, gated by `requireAddOnEntitlement` in
 * `artifacts/api-server/src/lib/portal-addon-entitlements.ts`, and Shane's decision on
 * #4463 made Premier's inclusion real there: a Premier tier passes every add-on gate by
 * tier. A doc-only key here implied a narrower, per-key model than the one enforced, so
 * it was removed along with the matching `includedFeatures` entries
 * (lib/db/migrations/manual/2026-09-17-premier-includes-all-add-ons-4462.sql).
 */
export const PORTAL_TIER_MODULE_KEYS = {
  policyDecisions: "policy_decisions",
  riskRegister: "risk_register",
  runbooks: "runbooks",
  remediationTracking: "remediation_tracking",
  sopsRunbooks: "sops_runbooks",
  messageCenter: "message_center",
  ownership: "ownership",
  securityPlan: "security_plan",
  piiGovernance: "pii_governance",
  poams: "poams", // #3104 — customer-facing POA&M reads only; MSP-console side stays ungated
} as const;

export type PortalTierModuleKey = (typeof PORTAL_TIER_MODULE_KEYS)[keyof typeof PORTAL_TIER_MODULE_KEYS];

/** Every module key, as a frozen list — the enumerable form, for tests and pickers. */
export const PORTAL_TIER_MODULE_KEY_LIST: readonly PortalTierModuleKey[] = Object.freeze(
  Object.values(PORTAL_TIER_MODULE_KEYS),
);

/**
 * Is this string one of the catalogued module keys?
 *
 * The type already guarantees it at compile time; this is the runtime check for a
 * value that arrived as a plain string (a route param, a jsonb value), so the tier
 * evaluator can fail closed on a key that maps onto nothing rather than treat a typo
 * as "not bundled by any tier, please upgrade".
 */
export function isPortalTierModuleKey(value: unknown): value is PortalTierModuleKey {
  return typeof value === "string" && (PORTAL_TIER_MODULE_KEY_LIST as readonly string[]).includes(value);
}
