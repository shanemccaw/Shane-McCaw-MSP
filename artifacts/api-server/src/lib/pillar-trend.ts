/**
 * pillar-trend.ts
 *
 * Real per-pillar score HISTORY for the Copilot Readiness Reveal's sparklines
 * (#356, epic #343). Before this, `journeyModel.ts`'s `pillarTrend()` returned
 * `null` for every pillar — the only stored history was `tenant_engine_snapshots`,
 * keyed by ENGINE (health/security/drift), not by any of the six Copilot
 * Readiness pillars, so there was no per-pillar series to draw from.
 *
 * ── NO NEW SCORING FORMULA ────────────────────────────────────────────────────
 * `tenant_monitor_profiles` is genuinely insert-only — every scheduled check run
 * writes a new row with a real `collectedAt`. This module walks that history and,
 * at each real checkpoint, replays the EXACT same per-check → pillar-impact
 * resolution the LIVE score already uses:
 *
 *   mergeMonitorProfileRows + deriveMonitorFindings  (tenant-signals.ts)
 *     -> computeHealthEngine + computeSecurityEngine (health-engine.ts / security-engine.ts)
 *     -> computePillarDisplayScore                   (health-display.ts)
 *
 * evaluableSignalKeys (the denominator restriction — see health-display.ts's
 * header) is resolved ONCE via `fetchTenantEvaluableSignalKeys`
 * (pillar-coverage.ts), scoped since #413 to the checks this tenant was actually
 * scanned with, and applied to every checkpoint exactly like the live path does.
 * Only the NUMERATOR — which signals are actually fired — varies by checkpoint,
 * driven by that day's real profile state. This is the same denominator every
 * other pillar-scoring caller (pillar-summary-stats.ts, telemetry-comparison.ts)
 * uses; nothing here invents a second one.
 *
 * The ONE thing that had to change for #413 beyond swapping the function: the
 * replay is now two-phase (engine outputs first, denominator second) so the
 * single fixed denominator can be resolved from the union of everything that
 * fired anywhere in the window. A per-checkpoint denominator would make the
 * points incomparable, which is the one thing a trend line must not be.
 *
 * ── What a "checkpoint" is ─────────────────────────────────────────────────────
 * One calendar day (UTC) in the trailing window that had at least one real
 * `tenant_monitor_profiles` row land. The profile "as of" that day is the latest
 * row per check key with `collectedAt` on or before that day — a running replay
 * seeded from the latest pre-window row per check (so day one of the series
 * reflects real prior state, not an artificially empty tenant) and then walked
 * forward through the window's rows in `collectedAt` order. A day with no new
 * rows for ANY check produces no checkpoint (nothing changed, so no new point).
 *
 * ── Deliberate scope limit, stated rather than hidden ─────────────────────────
 * Only `tenant_monitor_profiles` is replayed — the issue's own scope. The LIVE
 * score (`buildTenantProfile`) additionally merges `client_m365_profiles` and
 * `script_run_results`, which are point-in-time snapshots with no per-check
 * insert history to replay, so a signal fed ONLY by those never varies across
 * this series (it is simply present or absent at every checkpoint alike, exactly
 * as it is in the live merge). This cannot make a checkpoint's score look better
 * or worse than it really was — it only means the series does not capture a
 * change nothing here has a timestamped record of.
 *
 * ── The minimum-data floor ─────────────────────────────────────────────────────
 * A pillar's series is returned only when it has at least
 * `PILLAR_TREND_MIN_POINTS` real checkpoints — two dots is not a trend. Below
 * the floor (or when no evaluable rule ever configures a nonzero impact for a
 * pillar, so `computePillarDisplayScore` returns null at every checkpoint), the
 * pillar's entry is `null`: render nothing, never a synthesised shape.
 */

import { db, tenantsTable, tenantMonitorProfilesTable } from "@workspace/db";
import { and, asc, desc, eq, gte, lt, lte } from "drizzle-orm";
import { computeHealthEngine, getSignalHealthImpacts, type HealthEngineOutput } from "./health-engine.ts";
import { computeSecurityEngine } from "./security-engine.ts";
import { computePillarDisplayScore } from "./health-display.ts";
import { fetchTenantEvaluableSignalKeys, RADAR_PILLARS, type RadarPillar } from "./pillar-coverage.ts";
import { fetchSignalRulesAndGroups } from "./priority-engine.ts";
import {
  getDisabledSignalKeys,
  mergeMonitorProfileRows,
  deriveMonitorFindings,
  type TenantMonitorProfileRow,
} from "./tenant-signals.ts";
import { logger } from "./logger.ts";

const log = logger.child({ channel: "engine.dashboard" });

/** Trailing window the series covers. Matches engine-history's own default. */
export const PILLAR_TREND_WINDOW_DAYS = 30;

/**
 * Minimum distinct real checkpoints before a pillar's series renders at all.
 * Two points is a line between two dots, not a trend; five is the smallest
 * count that can show a real shape (a dip-then-recover, a plateau) while still
 * being reachable within a month of daily scanning.
 */
export const PILLAR_TREND_MIN_POINTS = 5;

export interface PillarTrendPoint {
  /** Calendar day (UTC), "YYYY-MM-DD". */
  date: string;
  /** 0-100, higher = healthier — the same display score the live card shows. */
  score: number;
}

interface MonitorHistoryRow {
  checkKey: string;
  status: string | null;
  severityMatched: string | null;
  /** Git #549 — replayed alongside the band so a replayed day's finding text matches the live one. */
  severityLabel: string | null;
  extractedProperties: Record<string, unknown> | null;
  collectedAt: Date;
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function toMonitorProfileRows(rows: Iterable<MonitorHistoryRow>): TenantMonitorProfileRow[] {
  return [...rows].map((r) => ({
    checkKey: r.checkKey,
    status: r.status,
    severityMatched: r.severityMatched,
    severityLabel: r.severityLabel,
    extractedProperties: r.extractedProperties,
  }));
}

/**
 * Real per-pillar score history for EVERY `RADAR_PILLARS` entry, from one
 * tenant fetch and one in-memory replay — computed together (rather than once
 * per pillar) because all seven pillars are scored from the exact same
 * checkpoint replay; splitting it seven ways would mean seven redundant
 * `tenant_monitor_profiles` scans and seven redundant rule fetches for what is
 * structurally a single walk.
 *
 * Returns a map with an entry for every `RADAR_PILLARS` key, `null` where that
 * pillar has fewer than `PILLAR_TREND_MIN_POINTS` real checkpoints (including
 * "the tenant has no `tenants.tenantId`" and "no evaluable rule feeds this
 * pillar at all" — both genuinely zero-checkpoint cases).
 */
export async function getPillarScoreTrends(
  customerId: number,
  windowDays: number = PILLAR_TREND_WINDOW_DAYS,
): Promise<Map<RadarPillar, PillarTrendPoint[] | null>> {
  const empty = new Map<RadarPillar, PillarTrendPoint[] | null>(RADAR_PILLARS.map((p) => [p, null]));

  const [tenantRow] = await db
    .select({ tenantId: tenantsTable.tenantId })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, customerId))
    .limit(1);
  const tenantId = tenantRow?.tenantId ?? null;
  if (!tenantId) return empty;

  const rangeEnd = new Date();
  const rangeStart = new Date(rangeEnd.getTime() - windowDays * 24 * 60 * 60 * 1000);

  const [seedRows, windowRows, { rules, groups }, disabledSignalKeys] = await Promise.all([
    // The tenant's state going INTO the window — one row per check, the latest
    // strictly before rangeStart — so the first in-window checkpoint reflects
    // real prior state rather than an artificially empty profile.
    db
      .selectDistinctOn([tenantMonitorProfilesTable.checkKey], {
        checkKey: tenantMonitorProfilesTable.checkKey,
        status: tenantMonitorProfilesTable.status,
        severityMatched: tenantMonitorProfilesTable.severityMatched,
        severityLabel: tenantMonitorProfilesTable.severityLabel,
        extractedProperties: tenantMonitorProfilesTable.extractedProperties,
        collectedAt: tenantMonitorProfilesTable.collectedAt,
      })
      .from(tenantMonitorProfilesTable)
      .where(
        and(
          eq(tenantMonitorProfilesTable.tenantId, tenantId),
          lt(tenantMonitorProfilesTable.collectedAt, rangeStart),
        ),
      )
      .orderBy(tenantMonitorProfilesTable.checkKey, desc(tenantMonitorProfilesTable.collectedAt)),
    db
      .select({
        checkKey: tenantMonitorProfilesTable.checkKey,
        status: tenantMonitorProfilesTable.status,
        severityMatched: tenantMonitorProfilesTable.severityMatched,
        severityLabel: tenantMonitorProfilesTable.severityLabel,
        extractedProperties: tenantMonitorProfilesTable.extractedProperties,
        collectedAt: tenantMonitorProfilesTable.collectedAt,
      })
      .from(tenantMonitorProfilesTable)
      .where(
        and(
          eq(tenantMonitorProfilesTable.tenantId, tenantId),
          gte(tenantMonitorProfilesTable.collectedAt, rangeStart),
          lte(tenantMonitorProfilesTable.collectedAt, rangeEnd),
        ),
      )
      .orderBy(asc(tenantMonitorProfilesTable.collectedAt)),
    fetchSignalRulesAndGroups(),
    getDisabledSignalKeys(),
  ]);

  if (windowRows.length === 0) {
    log.info({ customerId, windowDays }, "pillar-trend: no monitor history in window — no series for any pillar");
    return empty;
  }

  const impacts = getSignalHealthImpacts(rules, groups);

  // Running per-check state, replayed forward in time — seeded from the
  // pre-window latest-per-check rows, then updated as window rows are walked.
  const state = new Map<string, MonitorHistoryRow>();
  for (const row of seedRows as MonitorHistoryRow[]) state.set(row.checkKey, row);

  // Group window rows by calendar day so several checks landing the same day
  // produce ONE checkpoint, not one per row.
  const rowsByDay = new Map<string, MonitorHistoryRow[]>();
  for (const row of windowRows as MonitorHistoryRow[]) {
    const key = dayKey(row.collectedAt);
    const list = rowsByDay.get(key);
    if (list) list.push(row);
    else rowsByDay.set(key, [row]);
  }

  // ── Phase 1: replay every checkpoint's ENGINE output ────────────────────────
  // Split out from the scoring pass below so the denominator can be resolved
  // ONCE from the union of everything that ever fired in the window (#413). It
  // has to be one fixed denominator or the series is not a series — two points
  // computed against different theoreticalMax values are not comparable, and a
  // day whose fired set reached outside the scan package would otherwise exceed
  // its own denominator and clamp to a spurious 0.
  const checkpoints: { day: string; output: HealthEngineOutput }[] = [];
  const firedAcrossWindow = new Set<string>();

  for (const day of [...rowsByDay.keys()].sort()) {
    for (const row of rowsByDay.get(day)!) state.set(row.checkKey, row);

    const monitorRows = toMonitorProfileRows(state.values());
    const mergedProfile: Record<string, unknown> = {};
    mergeMonitorProfileRows(mergedProfile, monitorRows);
    const findings = deriveMonitorFindings(monitorRows);

    const healthResult = computeHealthEngine(mergedProfile, findings, rules, groups, disabledSignalKeys);
    const securityResult = computeSecurityEngine(mergedProfile, findings, rules, groups, disabledSignalKeys);
    const output: HealthEngineOutput = {
      ...healthResult,
      score: healthResult.score + securityResult.score,
      breakdown: [...healthResult.breakdown, securityResult.breakdown],
    };

    for (const signalKey of output.rawSignals) firedAcrossWindow.add(signalKey);
    checkpoints.push({ day, output });
  }

  // ── Phase 2: one denominator, applied to every checkpoint ───────────────────
  const evaluableSignalKeys = await fetchTenantEvaluableSignalKeys(customerId, rules, {
    firedSignalKeys: firedAcrossWindow,
  });

  const byPillar = new Map<RadarPillar, PillarTrendPoint[]>(RADAR_PILLARS.map((p) => [p, []]));

  for (const { day, output } of checkpoints) {
    for (const pillar of RADAR_PILLARS) {
      const displayScore = computePillarDisplayScore(pillar, output, impacts, evaluableSignalKeys);
      if (displayScore == null) continue; // no evaluable rule feeds this pillar — never fabricate
      byPillar.get(pillar)!.push({ date: day, score: displayScore });
    }
  }

  const result = new Map<RadarPillar, PillarTrendPoint[] | null>();
  for (const pillar of RADAR_PILLARS) {
    const points = byPillar.get(pillar) ?? [];
    result.set(pillar, points.length >= PILLAR_TREND_MIN_POINTS ? points : null);
  }
  return result;
}
