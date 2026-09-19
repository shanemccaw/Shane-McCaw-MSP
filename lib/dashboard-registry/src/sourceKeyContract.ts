/**
 * sourceKeyContract.ts — the guard on the registry's one unverifiable claim.
 *
 * A `monitor_profile` metric's `sourceKey` asserts that a row with that exact
 * `key` exists in the live `monitor_checks` table. Nothing in the repo can
 * confirm that: the check catalog is DATA, edited in SQL, and a check can be
 * renamed or retired without a single file changing here. So the assertion rots
 * silently, and it rots in the worst possible direction — `resolveMetric`
 * returns `unknown_check_key`, every consumer renders an empty cell, and an
 * empty cell is indistinguishable from a tenant that simply has not collected
 * the check. Three audits have now found phantom keys this way:
 *
 *   2026-07-26  identity:high-risk-signins   → real key is identity:risky-signins
 *   2026-07-26  cost:license-waste-estimate  → no such check; waste is arithmetic
 *                                              over the stored /subscribedSkus page
 *   2026-08-05  usage:*  (#441)              → an entire phantom DOMAIN, 12 keys
 *                                              across 14 metrics
 *
 * The third one reached a customer. Four `usage:*` keys were printed verbatim
 * into a paid Copilot Readiness Report as "not wired to a check in the
 * catalogue", under a heading saying they were figures the customer's own scan
 * did not carry. The scan was never asked for them.
 *
 * ── WHAT THIS FILE CAN AND CANNOT PROVE ──────────────────────────────────────
 * Deliberately a DENY list plus an optional snapshot, and not an allow-list of
 * "real" domains. An allow-list would have to be written from memory of the
 * catalog, and a wrong entry in it would wave a phantom key straight through —
 * the same class of guess that caused the bug. What is encoded here instead:
 *
 *   1. `AUDIT_CONFIRMED_ABSENT_SOURCE_KEYS` — keys a dated, live SQL audit has
 *      confirmed do not exist. Fact, not inference. This is the line Shane adds
 *      to when a check is renamed or retired; the test then names every metric
 *      and every document still pointing at it, which is exactly the "this will
 *      keep happening" loop #441 asked to close.
 *   2. `MONITOR_CHECK_CATALOG_SNAPSHOT` — the full set of live `monitor_checks`
 *      keys, when someone has captured one. Absent by default. When present it
 *      upgrades the deny list into a complete membership check, so a rename is
 *      caught the next time the snapshot is refreshed rather than the next time
 *      a customer reads a report. Regenerate with the SQL in
 *      `lib/db/migrations/manual/2026-08-05-registry-sourcekey-catalog-audit-441.sql`.
 *
 * `not_collected:` keys are sentinels, not catalog claims — the registry's own
 * existing idiom for "no producer exists yet" — and are exempt from both.
 */

/** Sentinel prefix for a metric with no producer. Never a monitor_checks key. */
export const NOT_COLLECTED_PREFIX = "not_collected:";

/**
 * Keys (or whole domains, as a `<domain>:` prefix) a live audit has confirmed
 * absent from `monitor_checks`. Every entry carries the date it was confirmed
 * and what replaced it, so a future reader can tell a settled fact from a
 * suspicion. NOTHING may be added here on inference.
 */
export const AUDIT_CONFIRMED_ABSENT_SOURCE_KEYS: readonly {
  readonly key: string;
  /** True when `key` is a `<domain>:` prefix rather than a single check key. */
  readonly isDomain?: boolean;
  readonly confirmedOn: string;
  readonly note: string;
}[] = [
  {
    key: "identity:high-risk-signins",
    confirmedOn: "2026-07-26",
    note: "never existed; the real key is identity:risky-signins, which IS curated into core:security-baseline",
  },
  {
    key: "cost:license-waste-estimate",
    confirmedOn: "2026-07-26",
    note: "no such check. Real waste is prepaidUnits.enabled - consumedUnits over the stored /subscribedSkus page (license-waste-source.ts), not a check output",
  },
  {
    key: "usage:",
    isDomain: true,
    confirmedOn: "2026-08-05",
    note: "#441 — `usage` is not a check-key domain. The real per-workload activity checks are adoption:teams-activity-trend, adoption:sharepoint-onedrive-trend, adoption:email-activity-trend and adoption:overall-active-rate, all of which are per-USER or per-SITE Graph usage-report detail endpoints and cannot honestly back an active-user COUNT",
  },
];

/**
 * The live catalog, when someone has captured it. Empty means "not captured" —
 * NOT "the catalog is empty" — so membership checking is skipped rather than
 * failing every key. See the file header for how to fill it.
 */
export const MONITOR_CHECK_CATALOG_SNAPSHOT: {
  /** ISO date the snapshot was taken, or null when there is no snapshot. */
  readonly capturedOn: string | null;
  readonly keys: readonly string[];
} = {
  capturedOn: "2026-09-17",
  keys: [
    "adoption:email-activity-trend",
    "adoption:m365-mobile-app-usage",
    "adoption:overall-active-rate",
    "adoption:planner-usage",
    "adoption:sharepoint-onedrive-trend",
    "adoption:sharepoint-user-activity",
    "adoption:teams-activity-trend",
    "adoption:teams-phone-provisioning",
    "adoption:viva-engage-health",
    "adoption:viva-engage-user-activity",
    "appgov:cert-secret-expiration",
    "appgov:consent-policy-status",
    "appgov:dormant-service-principals",
    "appgov:enterprise-app-count",
    "appgov:enterprise-app-registration-list",
    "appgov:risky-permission-grants",
    "appgov:stale-app-registrations",
    "appgov:unreviewed-consents",
    "appgov:workload-identity-risk",
    "compliance:app-conditional-access-policy-disabled",
    "compliance:audit-log-retention",
    "compliance:device-conditional-access-rule-weak-password",
    "compliance:device-config-policy-weak-password",
    "compliance:device-config-rule-weak-password",
    "compliance:dlp-incidents",
    "compliance:dlp-rule-package-invalid",
    "compliance:dlp-rules-not-enforcing",
    "compliance:eeeu-site-sharing",
    "compliance:file-plan-property-authority-disabled",
    "compliance:file-plan-property-category-disabled",
    "compliance:file-plan-property-citation-disabled",
    "compliance:file-plan-property-department-disabled",
    "compliance:label-errors",
    "compliance:missing-labels",
    "compliance:policy-config-dlp-simulation-mode",
    "compliance:protection-alert-policy-disabled",
    "compliance:record-tag-missing-reviewer",
    "compliance:retention-event-type-unlinked",
    "compliance:retention-policy-coverage",
    "compliance:retention-rule-no-action",
    "compliance:role-group-empty-membership",
    "compliance:sensitive-info-type-custom",
    "compliance:supervisory-review-policy-no-reviewers",
    "compliance:supervisory-review-rule-zero-sampling",
    "compliance:weak-dlp-policies",
    "compliance:zero-dlp-policies",
    "copilot:active-usage-rate",
    "copilot:data-exposure-risk",
    "copilot:license-vs-total-users",
    "copilot:licensed-but-inactive",
    "copilot:readiness-prerequisite",
    "copilot:sensitivity-labels-exist",
    "copilot:usage-activity",
    "copilot:usage-by-app",
    "cost:duplicate-assignments",
    "cost:entra-license-tier-distribution",
    "cost:group-based-licensing-adoption",
    "cost:license-count-by-sku",
    "cost:underutilized-premium",
    "cost:unused-unassigned-licenses",
    "cost:utilization-by-sku",
    "devices:app-protection-coverage",
    "devices:autopilot-coverage",
    "devices:bitlocker-key-escrow",
    "devices:compliance-policy-coverage",
    "devices:compliant-vs-noncompliant",
    "devices:encryption-status",
    "devices:enrollment-status",
    "devices:kfm-configuration",
    "devices:os-patch-compliance",
    "devices:stale-duplicate-records",
    "devices:unassigned-intune-profiles",
    "devices:update-rings-config",
    "diagnostics:ps-execution-test",
    "directory:cloud-licensing-allotment-exhausted",
    "directory:cloud-licensing-assignment-disabled-plans",
    "directory:cloud-licensing-assignment-errors",
    "directory:org-contact-provisioning-errors",
    "directory:partner-delegated-admin-relationships",
    "directory:service-health-active-incidents",
    "exchange:antispam-policy-coverage",
    "exchange:archive-mailbox-rate",
    "exchange:auto-forwarding-rules",
    "exchange:connector-health",
    "exchange:distribution-list-count",
    "exchange:dkim-spf-dmarc-status",
    "exchange:litigation-hold-coverage",
    "exchange:mail-flow-rule-review",
    "exchange:mailbox-quota-utilization",
    "exchange:shared-mailbox-licensing",
    "exchange:transport-rule-count",
    "governance:access-review-completion",
    "governance:auto-labeling-coverage",
    "governance:dynamic-group-usage",
    "governance:empty-security-groups",
    "governance:group-expiration-policy",
    "governance:guest-access-reviews",
    "governance:guest-count",
    "governance:guest-staleness",
    "governance:overdue-access-reviews",
    "governance:ownerless-groups",
    "governance:public-groups-discoverable",
    "governance:public-teams-discoverable",
    "governance:retention-label-adoption",
    "governance:retention-policy-coverage",
    "governance:sensitivity-label-adoption",
    "identity:app-federated-identity-credentials",
    "identity:app-proxy-connector-groups",
    "identity:b2b-collaboration-settings",
    "identity:break-glass-health",
    "identity:ca-device-compliance",
    "identity:ca-legacy-auth-block",
    "identity:ca-mfa-coverage",
    "identity:ca-policy-count",
    "identity:ca-report-only",
    "identity:continuous-access-evaluation",
    "identity:cross-tenant-access",
    "identity:department-directory",
    "identity:global-admin-count",
    "identity:guest-mfa-enforcement",
    "identity:hybrid-sync-health",
    "identity:legacy-auth-usage",
    "identity:mfa-method-breakdown",
    "identity:mfa-registration",
    "identity:named-locations",
    "identity:password-expiration-policy",
    "identity:pim-eligible-roles",
    "identity:pim-groups",
    "identity:pim-permanent-roles",
    "identity:privileged-mfa-gap",
    "identity:risky-signins",
    "identity:risky-users",
    "identity:signin-risk-policy",
    "identity:sspr-config",
    "identity:stale-accounts",
    "identity:terms-of-use",
    "identity:transitive-role-assignments",
    "identity:user-risk-policy",
    "license:copilot-assignment",
    "license:sku-utilization",
    "license:unused-assigned",
    "licensing:project-online-detection",
    "m365:message-center",
    "m365:service-health",
    "onedrive:active-users",
    "onedrive:departed-user-access",
    "onedrive:external-sharing-settings",
    "onedrive:overshared-files",
    "onedrive:storage-utilization",
    "onedrive:sync-errors",
    "platform:branding-config",
    "platform:multi-geo-status",
    "platform:tenant-password-expiration",
    "policy:activity-based-timeout",
    "policy:admin-consent-workflow",
    "policy:app-management-policies",
    "policy:authentication-flows",
    "policy:authentication-methods-policy",
    "policy:authentication-strength-policies",
    "policy:claims-mapping-policies",
    "policy:cross-tenant-access-default",
    "policy:cross-tenant-identity-sync-template",
    "policy:cross-tenant-m365-capabilities",
    "policy:cross-tenant-partners",
    "policy:default-app-management-policy",
    "policy:external-identities-policy",
    "policy:home-realm-discovery",
    "policy:security-defaults",
    "policy:terms-of-use-agreements",
    "policy:token-issuance-policies",
    "policy:token-lifetime-policies",
    "security:alert-count-by-severity",
    "security:antiphishing-coverage",
    "security:automated-investigation",
    "security:azure-roleDefinitions-compliance",
    "security:dlp-true-positive-rate",
    "security:dlp-violations",
    "security:insider-risk-alerts",
    "security:open-incidents",
    "security:password-protection-policy",
    "security:safe-attachments-coverage",
    "security:safe-links-coverage",
    "security:secure-score",
    "security:secure-score-by-category",
    "sharepoint:inactive-sites",
    "sharepoint:site-count",
    "sharepoint:site-label-coverage",
    "sharepoint:storage-near-limit",
    "sharepoint:storage-utilization",
    "sharepoint:tenant-sharing-capability",
    "teams:app-permission-policy",
    "teams:channel-sprawl",
    "teams:external-access-settings",
    "teams:guest-membership",
    "teams:guest-settings-governance",
    "teams:inactive-teams",
    "teams:inventory-count",
    "teams:meeting-policy-coverage",
    "teams:messaging-policy-coverage",
    "teams:ownerless-teams",
    "teams:rooms-device-health",
    "teams:team-count",
  ],
};


/**
 * Sentinel prefix for a sourceKey resolved out of the itemized `drift_events`
 * store rather than `monitor_checks` (Git #4560). See `classifySourceKey`.
 */
export const DRIFT_EVENTS_PREFIX = "drift:";

/**
 * THE KNOWN, ENUMERATED CATALOG DRIFT — every registry sourceKey a live audit
 * has confirmed is not in `monitor_checks`, as of the date below (Git #4560).
 *
 * ── WHY THIS LIST EXISTS AND WHY IT IS `ok: true` ────────────────────────────
 * Filling `MONITOR_CHECK_CATALOG_SNAPSHOT` — the deliverable #441 specified on
 * 2026-08-05 and which was never actually done — upgraded the guard from a
 * 3-entry deny list into a real membership check, and it immediately found 65
 * phantom sourceKeys, not the 13 #4560 was filed about. The registry has been
 * drifting from the catalog for months, silently, exactly as the file header
 * above predicted.
 *
 * Remapping 65 keys by inference in one pass is the WORST available option: a
 * wrong guess does not render an empty cell, it renders a confidently WRONG
 * number under a customer-facing caption. (That risk is not hypothetical —
 * `compliance:overshared-sites` was deliberately left pointing at the older
 * aggregate check by #357's own "not a rewrite" decision, so the obvious-looking
 * swap to `compliance:eeeu-site-sharing` would have contradicted a decision
 * already made on purpose.)
 *
 * So the drift is recorded here as a dated, enumerated FACT with its affected
 * metrics named, and the guard passes it — while still failing on any sourceKey
 * that is neither in the live catalog nor on this list. That is the property
 * that actually matters: the backlog cannot silently GROW. Every entry is a
 * metric that resolves to `unknown_check_key` for every tenant today; each
 * needs a real per-check audit against its successor's `extractedProperties`
 * shape, or retirement to a `not_collected:` sentinel where no successor
 * exists. Tracked as its own issue — do not "fix" one by guessing.
 *
 * Shrinking this list is the goal. Adding to it requires a live audit, the same
 * bar as `AUDIT_CONFIRMED_ABSENT_SOURCE_KEYS`.
 *
 * ── #4573: THE PER-CHECK AUDIT (2026-09-18) ──────────────────────────────────
 * The 65 keys were audited one at a time against the live catalog (202 active
 * `monitor_checks` rows; none of the 65 exists in ANY status, and none has a
 * single `tenant_monitor_profiles` row). Outcome: 6 remapped to a real successor
 * whose `extractedProperties` shape was checked against the metric, 46 retired
 * to the `not_collected:` sentinel because no check measures what they claim,
 * and the 13 below left in place, each with the specific reason it is not safe
 * to decide by inference (`blockers`). The full per-key evidence is in
 * `build-journal/4573-plan.md`.
 *
 * The audit's practical lesson, worth keeping next to the list it produced: a
 * successor that is close by NAME is often not a successor. Several candidates
 * measured a different quantity than their name implies — a policy count under
 * a mailbox caption, a total device count in a field called
 * `outdatedOsDeviceCount`, a duplicate-license count that is structurally always
 * 0, a distribution that would render one `unknown` bucket. Every one of those
 * would have shown a confident number, not an empty cell.
 */
export const CATALOG_DRIFT_BACKLOG: {
  readonly confirmedOn: string;
  readonly keys: readonly string[];
  /**
   * Why each key is STILL here (Git #4573) — exactly one entry per key (asserted
   * by `registry-source-key-contract.test.ts`). A key stays on this list only
   * because the per-check audit found a candidate successor that is not safe to
   * remap by inference, or found the work needs a decision or a change outside
   * the registry. Each blocker is the audit's own finding, not a note to self.
   */
  readonly blockers: Readonly<Record<string, string>>;
} = {
  confirmedOn: "2026-09-18",
  keys: [
    "audit:signins", // identity.signinActivity
    "compliance:onedrive-external", // compliance.oneDriveExternalCount
    "compliance:overshared-sites", // compliance.oversharedSiteCount
    "compliance:sharepoint-sites", // compliance.sharePointSiteCount
    "copilot:license-readiness", // licensing.copilotLicenseBreakdown
    "intune:outdated-devices", // intune.outdatedDeviceCount
    "licensing:duplicate-assignments", // licensing.duplicateLicenseCount
    "licensing:inactive-user-licenses", // licensing.inactiveLicenseCount
    "licensing:sku-utilization", // licensing.skuBreakdown
    "security:active-alerts", // security.activeAlertCount, security.alertsBySeverity
    "security:high-severity-alerts", // security.highSeverityAlertCount
    "security:risk-detections", // security.riskDetectionCount
    "security:secure-score-controls", // security.secureScoreControls
  ],
  blockers: {
    "audit:signins":
      "the only check fetching /auditLogs/signIns is identity:legacy-auth-usage, which is license_gap on the only tenant with data (unverifiable) and whose own definition looks unfiltered (count(clientAppUsed) counts every sign-in, yet its severity rule says legacy). Coupling a heatmap to a check about to be corrected would be a guess",
    "compliance:onedrive-external":
      "genuinely ambiguous: onedrive:overshared-files maps oversharedDriveCount (incl. org-wide links), anonymousLinkDriveCount and everyoneDriveCount, and none of them is exactly 'external shares'. Needs a decision on which one",
    "compliance:overshared-sites":
      "obvious successor is compliance:eeeu-site-sharing.oversharedSiteCount (the resolver's picker chooses it correctly), but #357 deliberately left this metric off the new check ('not a rewrite'), and its denominatorMetric compliance.sharePointSiteCount is the next row. Needs Shane to confirm the #357 decision has lapsed",
    "compliance:sharepoint-sites":
      "two candidates with different populations: sharepoint:site-count (live 99, includes 5 personal sites and 1 site with no drive) vs compliance:eeeu-site-sharing.sitesScanned (live 93). It is the denominator of the already-live compliance.eeeuSiteCount, so remapping it would newly make that metric emit a percentage. Needs a decision on the population",
    "copilot:license-readiness":
      "a distribution metric declared status 'available', so the resolver returns a scalar; no check emits buckets. Needs a needs_aggregation transform (and a decision on what the buckets are), not a key swap",
    "intune:outdated-devices":
      "candidate devices:os-patch-compliance maps count(osVersion) into a field named outdatedOsDeviceCount, which counts EVERY device with an OS version. The check needs a per-OS minimum-build definition of 'outdated' first (a product decision); remapping now would print the total device count as outdated devices",
    "licensing:duplicate-assignments":
      "candidate cost:duplicate-assignments runs countDuplicates(skuId) over /users with no $select, and skuId is not a top-level /users field, so it is structurally always 0. The check must be fixed (a real definition of a duplicate license) before anything can point at it",
    "licensing:inactive-user-licenses":
      "candidate license:unused-assigned stores a bare countWhere with no predicate, which the executor treats as malformed and leaves unset; its tenant is also license_gap (Entra ID P1/P2 is needed for signInActivity). The check's mapping must be repaired first",
    "licensing:sku-utilization":
      "a distribution metric declared status 'available': license:sku-utilization's skuData is a raw array, so the scalar resolver would return _itemCount (the number of SKUs, live 4) under a breakdown caption. Needs a needs_aggregation transform",
    "security:active-alerts":
      "candidate security:alert-count-by-severity fetches /security/alerts_v2 with no status filter, so it counts resolved alerts too, and 'Active Alerts' is not 'all alerts'. The only tenant with data is license_gap (Defender), so the raw shape behind security.alertsBySeverity is unverifiable. Open-vs-all is a product decision",
    "security:high-severity-alerts":
      "candidate security:alert-count-by-severity.highSeverityAlertCount matches by name but counts alerts of every status, and the metric is smart-graded against a target of 0, so a resolved high alert would grade a tenant down. Unverifiable live (license_gap). Needs the open-vs-all decision",
    "security:risk-detections":
      "candidate identity:risky-signins is server-filtered to activity eq 'signin', a subset of 'Risk Detections by Type', and is license_gap on the only tenant with data. Not a genuine match without a decision on scope",
    "security:secure-score-controls":
      "candidate security:secure-score-by-category cannot back this metric as-is: its stored raw page is 90 daily score snapshots and controlScores_values is an array of 90 arrays, so aggregateGroupBy(controlCategory) renders ONE bucket 'unknown = 90' (verified over the real stored row). Needs a transform over the latest snapshot's controlScores[] and a decision whether buckets count controls or sum scores",
  },
};
/**
 * The metrics whose `sourceKey` is NOT a catalog lookup, and so is not a claim
 * this file can hold to account.
 *
 * Exactly one today, and it is deliberate rather than an escape hatch:
 * `licensing.wasteEstimateBreakdown` is `needs_aggregation`, and its resolver
 * (`resolveMonitorAggregation`) never fetches `def.sourceKey` — it passes it to
 * `resolveLicenseWasteCounts` as a *preferred* candidate, which is discarded
 * unless it turns up among the real /subscribedSkus checks discovered by
 * endpoint. The figure is arithmetic over another check's stored Graph page.
 *
 * It cannot simply be retired to a `not_collected:` sentinel either: the
 * sentinel guard in `resolveMonitorProfile` fires BEFORE the aggregation branch,
 * so doing that would take a working metric dark. The key stays, inert, and is
 * named here so the deny list can keep failing every OTHER occurrence of it.
 */
export const METRICS_WHOSE_SOURCE_KEY_IS_NOT_A_LOOKUP: readonly {
  readonly metricKey: string;
  readonly note: string;
}[] = [
  {
    metricKey: "licensing.wasteEstimateBreakdown",
    note: "needs_aggregation; resolveMonitorAggregation computes from another check's /subscribedSkus page and only offers this key as a discarded preference",
  },
];

/** True when a metric's sourceKey is a label rather than a monitor_checks claim. */
export function sourceKeyIsCatalogClaim(metricKey: string): boolean {
  return !METRICS_WHOSE_SOURCE_KEY_IS_NOT_A_LOOKUP.some((m) => m.metricKey === metricKey);
}

export type SourceKeyVerdict =
  | {
      readonly ok: true;
      readonly kind: "sentinel" | "in_snapshot" | "unverified" | "drift_events" | "known_drift";
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Judge one `sourceKey` against everything the repo genuinely knows.
 *
 * `unverified` is an honest verdict, not a pass with a shrug: with no snapshot
 * captured, a key that is not on the deny list is simply unproven either way,
 * and saying so beats inventing a rule that would let the next phantom through.
 */
export function classifySourceKey(sourceKey: string): SourceKeyVerdict {
  if (sourceKey.startsWith(NOT_COLLECTED_PREFIX)) return { ok: true, kind: "sentinel" };

  // `drift:` is not a catalog claim at all (Git #4560). `resolveMonitorProfile`
  // routes a `drift:`-prefixed sourceKey to `resolveDriftEvents`, which reads
  // the itemized `drift_events` / `drift_baseline_snapshots` store keyed by the
  // bare domain slug — it never looks the key up in `monitor_checks`. Holding
  // these eighteen keys to catalog membership would fail the guard on metrics
  // that resolve correctly today, which is worse than useless: it trains a
  // reader to ignore the guard.
  if (sourceKey.startsWith(DRIFT_EVENTS_PREFIX)) return { ok: true, kind: "drift_events" };

  if (CATALOG_DRIFT_BACKLOG.keys.includes(sourceKey)) {
    return { ok: true, kind: "known_drift" };
  }

  for (const entry of AUDIT_CONFIRMED_ABSENT_SOURCE_KEYS) {
    const hit = entry.isDomain ? sourceKey.startsWith(entry.key) : sourceKey === entry.key;
    if (hit) {
      return {
        ok: false,
        reason: `"${sourceKey}" was confirmed absent from monitor_checks on ${entry.confirmedOn}: ${entry.note}`,
      };
    }
  }

  if (MONITOR_CHECK_CATALOG_SNAPSHOT.keys.length > 0) {
    return MONITOR_CHECK_CATALOG_SNAPSHOT.keys.includes(sourceKey)
      ? { ok: true, kind: "in_snapshot" }
      : {
          ok: false,
          reason:
            `"${sourceKey}" is not in the monitor_checks snapshot captured on ` +
            `${MONITOR_CHECK_CATALOG_SNAPSHOT.capturedOn}. Either the key is wrong, or the ` +
            `check was added after the snapshot — re-capture it before assuming the latter.`,
        };
  }

  return { ok: true, kind: "unverified" };
}
