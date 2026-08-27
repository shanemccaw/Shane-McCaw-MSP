/**
 * remediation-pillar-scores.ts — Git #1381.
 *
 * The pure reduction behind `GET /api/portal/remediation-tracker/pillar-scores`
 * (portal-remediation-tracker-scores.ts): turning a customer's raw
 * `tenant_pillar_snapshots` rows into the tracker's rolling before/now pair plus
 * the PERMANENT day-one baseline, and turning a run's real findings into each
 * task's point weight. Kept db-free and side-effect-free so it is unit-testable
 * without mocking the database — the route does the I/O and hands the plain rows
 * in.
 */

/**
 * The tracker's six pillar keys (msp-portal's `RtPillarKey`) → the key
 * `tenant_pillar_snapshots` actually stores. The only non-identity mapping is
 * `health` → `architecture`: the engine's internal `architecture` pillar is the
 * one surfaced as "Health" everywhere (pillar-coverage.ts `PILLAR_LABELS`).
 * Copilot is deliberately absent — it is the gate, not a tracker cell.
 */
export const RT_PILLAR_TO_SNAPSHOT_KEY: Readonly<Record<string, string>> = {
  governance: "governance",
  security: "security",
  compliance: "compliance",
  licensing: "licensing",
  adoption: "adoption",
  health: "architecture",
};

const RT_PILLAR_KEYS = Object.keys(RT_PILLAR_TO_SNAPSHOT_KEY);

/**
 * Finding severity → point weight, the same 1-3 scale as the design's own
 * `RT_SEV_WEIGHT` (Critical 3 / Attention 2 / Low risk 1). `ok` is 0 — a check
 * that came back clean has no risk left to earn points against.
 */
export const SEVERITY_WEIGHT: Readonly<Record<string, number>> = {
  critical: 3,
  warning: 2,
  info: 1,
  ok: 0,
};

export type PillarScoreStatus = "scored" | "single_scan" | "insufficient_data";

export interface PillarScore {
  readonly before: number | null;
  readonly now: number | null;
  readonly dayOne: number | null;
  readonly delta: number | null;
  readonly status: PillarScoreStatus;
  readonly capturedAt: string | null;
  readonly scanCount: number;
}

export interface TaskPoint {
  readonly severity: string;
  readonly weight: number;
}

export interface SnapshotRow {
  readonly pillarKey: string;
  readonly score: number;
  readonly previousScore: number | null;
  readonly capturedAt: Date;
}

const iso = (v: Date | string | null): string | null =>
  v === null ? null : v instanceof Date ? v.toISOString() : String(v);

/**
 * Reduce all of a customer's snapshot rows (any pillar), oldest→newest, into the
 * rolling before/now + permanent dayOne per tracker pillar. `before` is the
 * latest row's own `previousScore` (the prior scan's score, already stamped by
 * pillar-snapshot.ts) — NOT recomputed here, so this route and the capture agree.
 * Rows MUST arrive oldest→newest (first seen is dayOne, last seen is now).
 */
export function reducePillarScores(rows: readonly SnapshotRow[]): Record<string, PillarScore> {
  const bySnapshotKey = new Map<
    string,
    { dayOne: number; latest: number; previous: number | null; capturedAt: Date; count: number }
  >();
  for (const row of rows) {
    const existing = bySnapshotKey.get(row.pillarKey);
    if (!existing) {
      bySnapshotKey.set(row.pillarKey, {
        dayOne: row.score,
        latest: row.score,
        previous: row.previousScore,
        capturedAt: row.capturedAt,
        count: 1,
      });
    } else {
      existing.latest = row.score;
      existing.previous = row.previousScore;
      existing.capturedAt = row.capturedAt;
      existing.count += 1;
    }
  }

  const pillars: Record<string, PillarScore> = {};
  for (const rtKey of RT_PILLAR_KEYS) {
    const snapKey = RT_PILLAR_TO_SNAPSHOT_KEY[rtKey];
    const agg = bySnapshotKey.get(snapKey);
    if (!agg) {
      pillars[rtKey] = {
        before: null,
        now: null,
        dayOne: null,
        delta: null,
        status: "insufficient_data",
        capturedAt: null,
        scanCount: 0,
      };
      continue;
    }
    // One scan only ⇒ before is null (nothing to compare yet). count is the gate.
    const before = agg.count >= 2 ? agg.previous : null;
    const now = agg.latest;
    const delta = before != null ? now - before : null;
    const status: PillarScoreStatus = agg.count >= 2 && before != null ? "scored" : "single_scan";
    pillars[rtKey] = {
      before,
      now,
      dayOne: agg.dayOne,
      delta,
      status,
      capturedAt: iso(agg.capturedAt),
      scanCount: agg.count,
    };
  }
  return pillars;
}

/**
 * Per-step real finding severity weight, from a map of checkKey → severity for
 * the customer's latest run. For each tracker step with mapped check keys
 * (`stepCheckKeys`), take the worst severity across the mapped checks that
 * produced a finding this run, mapped to a 1-3 weight. Steps with no finding data
 * are omitted — the client falls back to the design severity for the chip rather
 * than showing a fabricated point value.
 */
export function buildTaskPoints(
  findingSeverityByCheckKey: ReadonlyMap<string, string>,
  stepCheckKeys: Readonly<Record<string, readonly string[]>>,
): Record<string, TaskPoint> {
  const out: Record<string, TaskPoint> = {};
  for (const [stepId, checkKeys] of Object.entries(stepCheckKeys)) {
    let worstSeverity: string | null = null;
    let worstWeight = -1;
    for (const key of checkKeys) {
      const sev = findingSeverityByCheckKey.get(key);
      if (sev === undefined) continue;
      const weight = SEVERITY_WEIGHT[sev] ?? 0;
      if (weight > worstWeight) {
        worstWeight = weight;
        worstSeverity = sev;
      }
    }
    if (worstSeverity !== null) {
      out[stepId] = { severity: worstSeverity, weight: worstWeight };
    }
  }
  return out;
}
