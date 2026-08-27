/**
 * portal-governance-areas.ts — the pure model behind the Governance pillar
 * dashboard's area-link grid (Git #1333).
 *
 * The portal-v2 Governance page (`portal-v2-governance.tsx`) renders a
 * cluster/area-card grid whose per-card score, delta and sparkline were, until
 * this issue, a hardcoded design fixture (`GOV_AREA_LINKS` in
 * `govDashboardData.ts`) — confident fake numbers on a genuinely never-scanned
 * tenant (#1330 / #1333). Ten of those cards DO have a real, active
 * `monitor_checks` check behind them, confirmed live against the catalog and
 * against `tenant_monitor_profiles`; this module is the mapping and the
 * derivations that turn those real scan rows into per-card values.
 *
 * ── Route split ─────────────────────────────────────────────────────────────
 * DB-free on purpose, the same lib/route split `portal-oversharing-sites.ts`
 * uses: `routes/portal-governance-areas.ts` does the `tenant_monitor_profiles`
 * read and hands the rows here. That keeps the card→check mapping and the
 * status/delta derivation unit-testable without a database (see
 * `portal-governance-areas.test.ts`).
 *
 * ── Which cards are real, and which are honest no-data ──────────────────────
 * Thirteen of the fourteen `GOV_AREA_LINKS` cards in `GOV_AREA_CHECK_DEFS` have
 * a confirmed backing check. Only one card is deliberately absent here so the
 * page renders it as an honest "—":
 *   • "External Sharing Drift" — no scan-to-scan diff check exists in the whole
 *     catalog yet; tracked to #1287's drift-engine rollout (blocked_by). It is
 *     no-data ONLY until that lands.
 *
 * The three "Devices …" cards were left as honest no-data through #1333 pending
 * Shane's call on whether real device-governance checks should be mapped
 * (flagged in #1366); Shane confirmed 2026-08-27 to map them to
 * `devices:enrollment-status`, `devices:stale-duplicate-records`, and
 * `devices:compliant-vs-noncompliant` — see #1366's thread.
 *
 * ── The count per card ──────────────────────────────────────────────────────
 * Each card reads ONE `targetField` out of the check's mapped
 * `extracted_properties` (the same field name `monitor_checks.mapping[].targetField`
 * writes). These are all risk-reduction counts — lower is better, target 0.
 *
 * ── Previous value = previous scan ──────────────────────────────────────────
 * `tenant_monitor_profiles` keeps one row per collection, so the delta is the
 * genuine change since the prior scan: the second-most-recent `collected_at`
 * row for the same (tenant, check). No prior scan ⇒ no delta, not a fake one.
 */

export type GovAreaStatus = "red" | "yellow" | "green";

/** A card that has a real, confirmed backing check. */
export interface GovAreaCheckDef {
  /** The `GOV_AREA_LINKS` card key this maps to (`govDashboardData.ts`). */
  readonly key: string;
  /** The real `monitor_checks.key` behind it. */
  readonly checkKey: string;
  /** The `extracted_properties` field holding this card's count. */
  readonly targetField: string;
}

/**
 * The thirteen confirmed-real cards. The first ten were verified live
 * 2026-08-26 (#1333); the three Devices cards were added 2026-08-27 (#1366)
 * per Shane's confirmed mapping. Each `checkKey` is an active `monitor_checks`
 * row and each `targetField` is a real mapped field on it.
 */
export const GOV_AREA_CHECK_DEFS: readonly GovAreaCheckDef[] = [
  { key: "governance-oversharing", checkKey: "compliance:eeeu-site-sharing", targetField: "oversharedSiteCount" },
  { key: "governance-public-teams", checkKey: "governance:public-teams-discoverable", targetField: "publicTeamCount" },
  { key: "governance-channels", checkKey: "teams:channel-sprawl", targetField: "channelCount" },
  { key: "governance-guests", checkKey: "governance:guest-count", targetField: "guestAccountCount" },
  { key: "governance-group-owners", checkKey: "governance:ownerless-groups", targetField: "ownerlessGroupCount" },
  { key: "governance-team-owners", checkKey: "teams:ownerless-teams", targetField: "ownerlessTeamCount" },
  { key: "governance-orphaned-groups", checkKey: "governance:empty-security-groups", targetField: "emptySecurityGroupCount" },
  { key: "governance-orphaned-teams", checkKey: "teams:inactive-teams", targetField: "inactiveTeamCount" },
  { key: "governance-app-access", checkKey: "appgov:risky-permission-grants", targetField: "riskyPermissionGrantCount" },
  { key: "governance-pim", checkKey: "identity:pim-permanent-roles", targetField: "permanentRoleAssignmentCount" },
  { key: "governance-device-inventory", checkKey: "devices:enrollment-status", targetField: "enrolledDeviceCount" },
  { key: "governance-device-lifecycle", checkKey: "devices:stale-duplicate-records", targetField: "staleDeviceRecordCount" },
  { key: "governance-device-ownership", checkKey: "devices:compliant-vs-noncompliant", targetField: "nonCompliantDeviceCount" },
] as const;

/** The distinct check keys this module reads, for the route's DB query. */
export const GOV_AREA_CHECK_KEYS: readonly string[] = GOV_AREA_CHECK_DEFS.map((d) => d.checkKey);

/** One scan row, in the minimal shape the derivations need. */
export interface GovProfileRow {
  readonly extractedProperties: Record<string, unknown> | null;
  readonly severityMatched: string | null;
  readonly severityLabel: string | null;
  readonly collectedAt: Date | string | null;
}

/** One card's real values, in the shape the drill-down grid consumes. */
export interface WireGovArea {
  readonly key: string;
  readonly checkKey: string;
  readonly value: number | null;
  readonly prevValue: number | null;
  readonly status: GovAreaStatus | null;
  readonly hasData: boolean;
  readonly severityLabel: string | null;
  readonly collectedAt: string | null;
}

/** Reads one numeric count field out of a check's mapped properties. */
export function extractGovAreaCount(
  props: Record<string, unknown> | null | undefined,
  targetField: string,
): number | null {
  if (!props) return null;
  const raw = props[targetField];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

/**
 * red / yellow / green for a card, matching `GOV_STATUS_META`'s own semantics
 * ("Not yet addressed" / "Partially addressed" / "Fully covered").
 *
 * A check that carries its own severity rule (only `appgov:risky-permission-grants`
 * does today) wins — its `severity_matched` is the real graded verdict. Every
 * other check has empty `severity_rules`, so status is derived from the count
 * itself, treating each as the risk-reduction count it is (target 0):
 *   0 → green,  1–9 → yellow,  ≥10 → red.
 */
export function deriveGovAreaStatus(value: number | null, severityMatched: string | null): GovAreaStatus | null {
  if (value === null) return null;

  const sev = (severityMatched ?? "").trim().toLowerCase();
  if (sev === "critical" || sev === "high") return "red";
  if (sev === "warning" || sev === "medium") return "yellow";
  // A real "clean" verdict still reflects the count: an explicit ok on a 0 is
  // green, but a non-zero graded ok stays yellow rather than claiming covered.
  if (sev === "ok" || sev === "info" || sev === "low" || sev === "none") {
    return value === 0 ? "green" : "yellow";
  }

  if (value === 0) return "green";
  if (value >= 10) return "red";
  return "yellow";
}

function toIso(collectedAt: Date | string | null): string | null {
  if (collectedAt === null) return null;
  if (collectedAt instanceof Date) return collectedAt.toISOString();
  const d = new Date(collectedAt);
  return Number.isNaN(d.getTime()) ? String(collectedAt) : d.toISOString();
}

/**
 * Builds one card's wire values from its latest and previous scan rows. A
 * missing/undefined latest row (the check never collected for this tenant) is
 * honest no-data: value null, status null, hasData false.
 */
export function buildGovArea(
  def: GovAreaCheckDef,
  latest: GovProfileRow | undefined,
  previous: GovProfileRow | undefined,
): WireGovArea {
  const value = latest ? extractGovAreaCount(latest.extractedProperties, def.targetField) : null;
  const prevValue = previous ? extractGovAreaCount(previous.extractedProperties, def.targetField) : null;
  const status = deriveGovAreaStatus(value, latest?.severityMatched ?? null);

  return {
    key: def.key,
    checkKey: def.checkKey,
    value,
    prevValue,
    status,
    hasData: value !== null,
    severityLabel: latest?.severityLabel ?? null,
    collectedAt: toIso(latest?.collectedAt ?? null),
  };
}
