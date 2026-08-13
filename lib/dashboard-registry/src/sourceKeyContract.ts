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
  capturedOn: null,
  keys: [],
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
  | { readonly ok: true; readonly kind: "sentinel" | "in_snapshot" | "unverified" }
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
