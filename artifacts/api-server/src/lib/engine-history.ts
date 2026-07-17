import { db, tenantEngineSnapshotsTable, engineBaselineHistoryTable, engineScoreSignalDeltasTable, engineScoreDailyRollupTable } from "@workspace/db";
import { and, eq, gte, lte, desc, asc, inArray, lt } from "drizzle-orm";
import { fetchSignalRulesAndGroups } from "./priority-engine";

// ── Function 1 ──────────────────────────────────────────────────────────────
export async function getEngineHistoryMerged(
  customerId: number,
  engineKey: string,
  start?: Date,
  end?: Date,
): Promise<Array<{ date: string; score: number; previousScore: number | null; delta: number | null; trendDirection: string | null; source: "snapshot" | "rollup"; runId: string | null; ruleVersion: number | null }>> {
  const rangeEnd = end ?? new Date();
  const ninetyDaysAgo = new Date(rangeEnd.getTime() - 90 * 24 * 60 * 60 * 1000);
  const rangeStart = start ?? ninetyDaysAgo;

  const actualStartForSnapshots = new Date(Math.max(rangeStart.getTime(), ninetyDaysAgo.getTime()));

  const snapshots = await db
    .select()
    .from(tenantEngineSnapshotsTable)
    .where(
      and(
        eq(tenantEngineSnapshotsTable.customerId, customerId),
        eq(tenantEngineSnapshotsTable.engineKey, engineKey),
        gte(tenantEngineSnapshotsTable.capturedAt, actualStartForSnapshots),
        lte(tenantEngineSnapshotsTable.capturedAt, rangeEnd)
      )
    )
    .orderBy(asc(tenantEngineSnapshotsTable.capturedAt));

  const snapshotRows = snapshots.map((row) => ({
    date: row.capturedAt.toISOString(),
    score: row.score,
    previousScore: row.previousScore,
    delta: row.delta,
    trendDirection: row.trendDirection,
    source: "snapshot" as const,
    runId: row.runId,
    ruleVersion: row.ruleVersion,
  }));

  let rollupRows: Array<{ date: string; score: number; previousScore: number | null; delta: number | null; trendDirection: string | null; source: "snapshot" | "rollup"; runId: string | null; ruleVersion: number | null }> = [];

  if (rangeStart.getTime() < ninetyDaysAgo.getTime()) {
    const rollups = await db
      .select()
      .from(engineScoreDailyRollupTable)
      .where(
        and(
          eq(engineScoreDailyRollupTable.customerId, customerId),
          eq(engineScoreDailyRollupTable.engineKey, engineKey),
          gte(engineScoreDailyRollupTable.day, rangeStart.toISOString().split("T")[0]),
          lt(engineScoreDailyRollupTable.day, ninetyDaysAgo.toISOString().split("T")[0])
        )
      )
      .orderBy(asc(engineScoreDailyRollupTable.day));

    rollupRows = rollups.map((row) => ({
      // @ts-expect-error If day is string, ISOString might fail, assuming it is Date based on instructions
      date: typeof row.day === "string" ? new Date(row.day).toISOString() : row.day.toISOString(),
      score: row.score,
      previousScore: null,
      delta: null,
      trendDirection: null,
      source: "rollup" as const,
      runId: null,
      ruleVersion: null,
    }));
  }

  return [...rollupRows, ...snapshotRows];
}

// ── Function 2 ──────────────────────────────────────────────────────────────
export async function getBaselineEvents(customerId: number, engineKey: string) {
  return db
    .select()
    .from(engineBaselineHistoryTable)
    .where(
      and(
        eq(engineBaselineHistoryTable.customerId, customerId),
        eq(engineBaselineHistoryTable.engineKey, engineKey)
      )
    )
    .orderBy(asc(engineBaselineHistoryTable.createdAt));
}

// ── Function 3 ──────────────────────────────────────────────────────────────
export async function getSignalDeltasForRange(
  customerId: number,
  engineKey: string,
  start?: Date,
  end?: Date,
): Promise<Array<{ signalKey: string; label: string; direction: string; date: string; historyId: number }>> {
  const rangeEnd = end ?? new Date();
  const rangeStart = start ?? new Date(rangeEnd.getTime() - 90 * 24 * 60 * 60 * 1000);

  const snapshots = await db
    .select({
      id: tenantEngineSnapshotsTable.id,
      capturedAt: tenantEngineSnapshotsTable.capturedAt,
    })
    .from(tenantEngineSnapshotsTable)
    .where(
      and(
        eq(tenantEngineSnapshotsTable.customerId, customerId),
        eq(tenantEngineSnapshotsTable.engineKey, engineKey),
        gte(tenantEngineSnapshotsTable.capturedAt, rangeStart),
        lte(tenantEngineSnapshotsTable.capturedAt, rangeEnd)
      )
    );

  if (snapshots.length === 0) {
    return [];
  }

  const snapshotIds = snapshots.map((s) => s.id);
  const snapshotMap = new Map<number, string>(
    snapshots.map((s) => [s.id, s.capturedAt.toISOString()])
  );

  const deltas = await db
    .select()
    .from(engineScoreSignalDeltasTable)
    .where(inArray(engineScoreSignalDeltasTable.historyId, snapshotIds))
    .orderBy(asc(engineScoreSignalDeltasTable.createdAt));

  const { groups } = await fetchSignalRulesAndGroups();
  const groupLabelMap = new Map<string, string>();
  for (const group of groups) {
    if (group.signalKey && group.label) {
      groupLabelMap.set(group.signalKey, group.label);
    }
  }

  return deltas.map((row) => {
    const label = groupLabelMap.get(row.signalKey) ?? row.signalKey;
    const date = snapshotMap.get(row.historyId) ?? "";
    return {
      signalKey: row.signalKey,
      label,
      direction: row.direction,
      date,
      historyId: row.historyId,
    };
  });
}
