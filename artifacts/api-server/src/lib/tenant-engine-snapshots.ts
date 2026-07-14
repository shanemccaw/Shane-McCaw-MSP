/**
* tenant-engine-snapshots.ts
*
* Read/write helpers for tenant_engine_snapshots — point-in-time score history
* per engine (health, drift, priority, etc.) per tenant. Purely additive storage
* layer: nothing currently calls saveEngineSnapshot(). A later task wires it into
* the engine computation flow so history starts accumulating.
*/
import { db, tenantEngineSnapshotsTable } from "@workspace/db";
import { and, eq, desc } from "drizzle-orm";

export interface SaveEngineSnapshotInput {
  mspId: number;
  customerId: number;
  engineKey: string;
  score: number;
  trendDirection?: string | null;
  breakdown?: Record<string, unknown>[];
}

/**
* Persists a single engine score snapshot for a tenant. Call this once per
* engine per completed monitoring/diagnostics run once wired up (not yet wired
* up as of this task).
*/
export async function saveEngineSnapshot(input: SaveEngineSnapshotInput): Promise<void> {
  await db.insert(tenantEngineSnapshotsTable).values({
    mspId: input.mspId,
    customerId: input.customerId,
    engineKey: input.engineKey,
    score: input.score,
    trendDirection: input.trendDirection ?? null,
    breakdown: input.breakdown ?? [],
  });
}

/**
* Returns the N most recent snapshots for a given tenant + engine, newest first.
* Callers wanting "current vs previous" should request limit: 2 and compare
* result[0] (current) against result[1] (previous), guarding for result.length < 2
* (no previous snapshot exists yet).
*/
export async function getRecentEngineSnapshots(
  customerId: number,
  engineKey: string,
  limit: number = 2,
) {
  return db
    .select()
    .from(tenantEngineSnapshotsTable)
    .where(
      and(
        eq(tenantEngineSnapshotsTable.customerId, customerId),
        eq(tenantEngineSnapshotsTable.engineKey, engineKey),
      ),
    )
    .orderBy(desc(tenantEngineSnapshotsTable.capturedAt))
    .limit(limit);
}