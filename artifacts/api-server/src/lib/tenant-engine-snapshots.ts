/**
 * tenant-engine-snapshots.ts
 *
 * Read/write helpers for tenant_engine_snapshots — point-in-time score history
 * per engine (health, drift, priority, etc.) per tenant.
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