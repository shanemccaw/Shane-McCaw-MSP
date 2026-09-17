/**
 * pillar-check-observations.ts — the tenant's REAL latest observation per
 * monitor check, and the per-pillar coverage roll-up the pillar pages'
 * "what feeds this score" panel is drawn from (Git #4560).
 *
 * ── WHY THIS EXISTS, AND WHY IT IS NOT THE METRIC REGISTRY ───────────────────
 * `pillar-summary-stats.ts`'s stat tiles resolved through
 * `DASHBOARD_METRICS[…].sourceKey` — a registry indirection with TWO failure
 * modes this module removes for the tiles:
 *
 *   1. The `sourceKey` is a claim about a row in `monitor_checks` that nothing
 *      in the repo can verify, so it rots silently. Thirteen pillar stats were
 *      resolving to `unknown_check_key` for EVERY tenant when #4560 was filed —
 *      all four Governance tiles among them — because the registry still named
 *      `compliance:sharepoint-sites`, `compliance:overshared-sites`,
 *      `copilot:overshare-exposure`, `compliance:public-channels`, four
 *      `intune:*` keys and three `licensing:*`/`compliance:*` keys that the
 *      live catalog does not contain. (Confirmed live 2026-09-17: the catalog's
 *      oldest rows date to 2026-07-20 and were never wiped, so this is
 *      long-standing registry drift — first documented open in #441 on
 *      2026-08-05 — and NOT a post-reset seed gap.)
 *
 *   2. `pickMappedValueField` picks WHICH numeric field of a check's mapping a
 *      metric means by token-overlap heuristic. That is the right default for a
 *      dashboard metric, and the wrong one for a customer-facing tile: a check
 *      like `governance:ownerless-groups` carries both `ownerlessGroupCount`
 *      (26) and `_itemCount` (104, the whole group census). A heuristic that
 *      resolves the second under the first's caption shows a customer a wrong
 *      number, which is worse than showing them nothing.
 *
 * So a pillar tile now names its check key and its value field EXPLICITLY, and
 * this module reads exactly that field off the tenant's own latest row. The
 * tile set itself is not invented here either — it is the one specified by
 * `Design/portal/design_handoff_full_site/screens/Pillar Pages.dc.html`, whose
 * per-pillar `tiles` arrays name real, current catalog keys (verified live
 * 2026-09-17: all 155 check keys the design references exist in
 * `monitor_checks`).
 *
 * ── HONESTY RULES, UNCHANGED ────────────────────────────────────────────────
 * Every non-value outcome keeps its own distinct reason, exactly as
 * `dashboard-resolvers.ts` does — a licence gap, a Microsoft service that is
 * not set up, a check that errored, and a check that never ran are four
 * different facts and none of them is a zero.
 */

import { db, tenantMonitorProfilesTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";

/**
 * What the tenant's latest row for a check actually says. Mirrors the real
 * `tenant_monitor_profiles.status` vocabulary observed live (`ok`,
 * `license_gap`, `service_not_configured`, `error`), plus the one state that is
 * the ABSENCE of a row rather than a value in it.
 */
export type CheckObservationStatus =
  | "ok"
  | "license_gap"
  | "service_not_configured"
  | "error"
  | "never_run";

export interface CheckObservation {
  checkKey: string;
  status: CheckObservationStatus;
  /** The row's real `extracted_properties`, minus the bulky `_evidence` blob. */
  props: Record<string, unknown>;
  collectedAt: string | null;
  /** Only ever monitor-executor's own `_licenseGapFeature` — never synthesised. */
  licenseFeature: string | null;
  /** Only on `service_not_configured` — which Microsoft service refused. */
  serviceName: string | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeStatus(raw: string | null): CheckObservationStatus {
  switch (raw) {
    case "license_gap":
    case "service_not_configured":
    case "error":
      return raw;
    default:
      // Anything else that produced a stored row is a completed observation.
      return "ok";
  }
}

function stringProp(props: Record<string, unknown>, key: string): string | null {
  const raw = props[key];
  return typeof raw === "string" && raw.trim() ? raw : null;
}

/**
 * The tenant's newest row per check key, as one read.
 *
 * `tenant_monitor_profiles` keeps the newest row per (tenant, check) forever,
 * so this is the same "latest observation" every other resolver in this
 * codebase means — just fetched once for the whole catalog instead of once per
 * metric, because a pillar page needs all of it at the same instant.
 */
export async function fetchLatestCheckObservations(
  tenantId: string,
): Promise<Map<string, CheckObservation>> {
  const rows = await db
    .select({
      checkKey: tenantMonitorProfilesTable.checkKey,
      status: tenantMonitorProfilesTable.status,
      extractedProperties: tenantMonitorProfilesTable.extractedProperties,
      collectedAt: tenantMonitorProfilesTable.collectedAt,
    })
    .from(tenantMonitorProfilesTable)
    .where(eq(tenantMonitorProfilesTable.tenantId, tenantId))
    .orderBy(desc(tenantMonitorProfilesTable.collectedAt));

  const byKey = new Map<string, CheckObservation>();
  for (const row of rows) {
    // Ordered newest-first, so the first row seen for a key IS the latest.
    if (byKey.has(row.checkKey)) continue;
    const props = asRecord(row.extractedProperties);
    // `_evidence` is the per-item sample list (up to 50 objects per check) — it
    // is genuinely useful on a drill-down and pure weight on a summary payload.
    const { _evidence: _dropped, ...rest } = props;
    const status = normalizeStatus(typeof row.status === "string" ? row.status : null);
    byKey.set(row.checkKey, {
      checkKey: row.checkKey,
      status,
      props: rest,
      collectedAt: row.collectedAt ? row.collectedAt.toISOString() : null,
      licenseFeature: status === "license_gap" ? stringProp(props, "_licenseGapFeature") : null,
      serviceName: status === "service_not_configured" ? stringProp(props, "_serviceName") : null,
    });
  }
  return byKey;
}

/** A finite number off a named property, or null. Never coerces "" or booleans. */
export function numericProp(
  props: Record<string, unknown>,
  field: string,
): number | null {
  const raw = props[field];
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

// ── Coverage roll-up ─────────────────────────────────────────────────────────

/**
 * The design's own coverage segments
 * (`Pillar Pages.dc.html` → `segs`, `SEGC`), mapped one-to-one onto the real
 * observation statuses above. Deliberately NOT a new vocabulary:
 *
 *   ok      ← status "ok"                      — observed with data
 *   gap     ← status "license_gap"             — the tenant's SKUs can't feed it
 *   blocked ← status "error" | "service_not_configured"
 *   queued  ← no row at all, or an inactive catalog row — never run
 */
export type PillarCoverageSegmentKind = "ok" | "gap" | "blocked" | "queued";

export interface PillarCoverageSegment {
  kind: PillarCoverageSegmentKind;
  count: number;
}

export interface PillarCoverageBreakdown {
  /** Every catalog check tagged to this pillar. The segment denominator. */
  total: number;
  segments: PillarCoverageSegment[];
  /** The real check keys behind the `blocked` segment, so the note names evidence. */
  blockedCheckKeys: string[];
  /** The real check keys behind the `gap` segment. */
  licenseGappedCheckKeys: string[];
  /**
   * The distinct Microsoft add-on names the tenant's own gapped checks
   * reported, with how many checks each one gates — straight from
   * `_licenseGapFeature`, never a tier decided here.
   */
  licenseGapFeatures: { feature: string; checkCount: number }[];
  /** Distinct Microsoft service names behind `service_not_configured` rows. */
  blockedServices: string[];
}

/**
 * Roll the tenant's real observations up per pillar.
 *
 * `checkKeyPillars` is the FULL check → pillar resolution `buildPillarSummary`
 * already computes (rule-derived first, `PILLAR_CHECK_DOMAINS` fallback
 * second) — passed in rather than re-derived so the coverage panel and the
 * score can never disagree about which pillar a check belongs to.
 *
 * `inactiveCheckKeys` are catalog rows marked inactive: they can never run, so
 * they count as `queued`/never-run rather than silently inflating `ok`.
 */
export function buildPillarCoverage<P extends string>(
  checkKeyPillars: Record<string, P>,
  observations: ReadonlyMap<string, CheckObservation>,
  inactiveCheckKeys: ReadonlySet<string>,
): Record<P, PillarCoverageBreakdown> {
  const out = {} as Record<P, PillarCoverageBreakdown>;

  const ensure = (pillar: P): PillarCoverageBreakdown => {
    let entry = out[pillar];
    if (!entry) {
      entry = {
        total: 0,
        segments: [],
        blockedCheckKeys: [],
        licenseGappedCheckKeys: [],
        licenseGapFeatures: [],
        blockedServices: [],
      };
      out[pillar] = entry;
    }
    return entry;
  };

  const counts = new Map<P, Map<PillarCoverageSegmentKind, number>>();
  const features = new Map<P, Map<string, number>>();
  const services = new Map<P, Set<string>>();

  for (const [checkKey, pillar] of Object.entries(checkKeyPillars) as [string, P][]) {
    const entry = ensure(pillar);
    entry.total += 1;

    const observation = observations.get(checkKey);
    let kind: PillarCoverageSegmentKind;
    if (!observation || inactiveCheckKeys.has(checkKey)) {
      kind = "queued";
    } else if (observation.status === "license_gap") {
      kind = "gap";
      entry.licenseGappedCheckKeys.push(checkKey);
      if (observation.licenseFeature) {
        const perPillar = features.get(pillar) ?? new Map<string, number>();
        perPillar.set(observation.licenseFeature, (perPillar.get(observation.licenseFeature) ?? 0) + 1);
        features.set(pillar, perPillar);
      }
    } else if (observation.status === "error" || observation.status === "service_not_configured") {
      kind = "blocked";
      entry.blockedCheckKeys.push(checkKey);
      if (observation.serviceName) {
        const perPillar = services.get(pillar) ?? new Set<string>();
        perPillar.add(observation.serviceName);
        services.set(pillar, perPillar);
      }
    } else {
      kind = "ok";
    }

    const perPillar = counts.get(pillar) ?? new Map<PillarCoverageSegmentKind, number>();
    perPillar.set(kind, (perPillar.get(kind) ?? 0) + 1);
    counts.set(pillar, perPillar);
  }

  // Fixed segment order so the bar reads identically on every pillar and every
  // render — the design's own left-to-right order.
  const ORDER: PillarCoverageSegmentKind[] = ["ok", "gap", "blocked", "queued"];
  for (const [pillar, entry] of Object.entries(out) as [P, PillarCoverageBreakdown][]) {
    const perPillar = counts.get(pillar);
    entry.segments = ORDER.map((kind) => ({ kind, count: perPillar?.get(kind) ?? 0 })).filter(
      (segment) => segment.count > 0,
    );
    entry.blockedCheckKeys.sort();
    entry.licenseGappedCheckKeys.sort();
    entry.licenseGapFeatures = [...(features.get(pillar) ?? new Map<string, number>())]
      .map(([feature, checkCount]) => ({ feature, checkCount }))
      .sort((a, b) => b.checkCount - a.checkCount || a.feature.localeCompare(b.feature));
    entry.blockedServices = [...(services.get(pillar) ?? new Set<string>())].sort();
  }

  return out;
}
