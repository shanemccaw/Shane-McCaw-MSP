/**
 * Live-Postgres test for the `diffSnapshots()` cache-key collision fix (Git #2032).
 *
 * `sameKey` was built from (baseSnapshotRowId, headSnapshotRowId, mode,
 * rulesetFingerprint) only, and `config_diffs_pair_uidx` matched the same four
 * columns — `resourceKeys` was never part of the identity. A resource-scoped
 * recompute for a pair therefore collided on the SAME stored row as a full-tenant
 * diff of that pair: whichever ran second silently overwrote the other.
 *
 * Live rather than mocked, deliberately: the whole bug lived in a database unique
 * index plus the Drizzle `and(eq(...))` key built against it, and a mock would have
 * asserted the code calls `db.insert`/`db.select` correctly without ever exercising
 * the constraint that actually collided.
 *
 * Skips cleanly with no `DATABASE_URL`, matching `config-change-attribution.live-db.test.ts`.
 * Every row it writes is synthetic, suffixed, and removed in `afterAll`.
 *
 * Run: pnpm --filter @workspace/api-server vitest run config-snapshot-differ.live-db
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  db,
  mspsTable,
  tenantsTable,
  configDiffsTable,
  tenantConfigSnapshotsTable,
  tenantConfigSnapshotResourceStatusTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { diffSnapshots, fingerprintResourceKeys } from "./config-snapshot-differ.ts";

const suffix = `vitest-2032-${Math.floor(Math.random() * 1e9)}`;
const RESOURCE_A = "graph:v1.0:/identity/conditionalAccess/policies";
const RESOURCE_B = "graph:v1.0:/policies/authorizationPolicy";

describe.skipIf(!process.env.DATABASE_URL)(
  "diffSnapshots() cache key includes resourceKeys — Git #2032",
  () => {
    let mspId: number;
    let tenantRowId: number;
    let baseSnapId: number;
    let headSnapId: number;

    beforeAll(async () => {
      const [msp] = await db.insert(mspsTable)
        .values({ name: `Diff Cache Key Test MSP ${suffix}`, slug: suffix })
        .returning({ id: mspsTable.id });
      mspId = msp!.id;

      const [tenant] = await db.insert(tenantsTable)
        .values({ mspId, customerName: `Diff Cache Key Test Customer ${suffix}`, tenantId: suffix })
        .returning({ id: tenantsTable.id });
      tenantRowId = tenant!.id;

      const snap = async (capturedAt: Date): Promise<number> => {
        const [s] = await db.insert(tenantConfigSnapshotsTable).values({
          tenantId: tenantRowId,
          entraTenantId: suffix,
          capturedAt,
          trigger: "manual",
          status: "sealed",
          sealedAt: capturedAt,
        }).returning({ id: tenantConfigSnapshotsTable.id });
        return s!.id;
      };
      baseSnapId = await snap(new Date("2026-07-01T00:00:00Z"));
      headSnapId = await snap(new Date("2026-07-02T00:00:00Z"));

      // Two comparable resources on both sides, so both a full-tenant diff and a
      // diff scoped to one of them have something real to compute over.
      for (const snapshotRowId of [baseSnapId, headSnapId]) {
        for (const resourceKey of [RESOURCE_A, RESOURCE_B]) {
          await db.insert(tenantConfigSnapshotResourceStatusTable).values({
            snapshotRowId, resourceKey, readTransport: "graph",
            status: "empty", objectCount: 0,
          });
        }
      }
    });

    afterAll(async () => {
      await db.delete(configDiffsTable).where(eq(configDiffsTable.headTenantId, tenantRowId));
      await db.delete(tenantConfigSnapshotsTable).where(eq(tenantConfigSnapshotsTable.tenantId, tenantRowId));
      await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantRowId));
      await db.delete(mspsTable).where(eq(mspsTable.id, mspId));
    });

    it("fingerprints an omitted scope as '*' and a real scope as a stable, order-independent hash", () => {
      expect(fingerprintResourceKeys(undefined)).toBe("*");
      expect(fingerprintResourceKeys([RESOURCE_A])).toBe(fingerprintResourceKeys([RESOURCE_A]));
      expect(fingerprintResourceKeys([RESOURCE_A, RESOURCE_B]))
        .toBe(fingerprintResourceKeys([RESOURCE_B, RESOURCE_A]));
      expect(fingerprintResourceKeys([RESOURCE_A])).not.toBe("*");
      expect(fingerprintResourceKeys([RESOURCE_A])).not.toBe(fingerprintResourceKeys([RESOURCE_B]));
    });

    it("a resource-scoped recompute gets its OWN row instead of overwriting the full-tenant diff", async () => {
      const full = await diffSnapshots({
        mode: "drift", baseSnapshotRowId: baseSnapId, headSnapshotRowId: headSnapId,
        trigger: "manual",
      });
      expect(full.status).toBe("sealed");

      const scoped = await diffSnapshots({
        mode: "drift", baseSnapshotRowId: baseSnapId, headSnapshotRowId: headSnapId,
        trigger: "manual", resourceKeys: [RESOURCE_A],
      });
      expect(scoped.status).toBe("sealed");

      // THE FIX: two distinct rows for the same (base, head, mode, ruleset), not one
      // overwriting the other.
      expect(scoped.diffRowId).not.toBe(full.diffRowId);

      const rows = await db.select().from(configDiffsTable).where(and(
        eq(configDiffsTable.baseSnapshotRowId, baseSnapId),
        eq(configDiffsTable.headSnapshotRowId, headSnapId),
        eq(configDiffsTable.mode, "drift"),
      ));
      expect(rows).toHaveLength(2);
      expect(rows.find((r) => r.id === full.diffRowId)?.resourceKeysFingerprint).toBe("*");
      expect(rows.find((r) => r.id === scoped.diffRowId)?.resourceKeysFingerprint)
        .toBe(fingerprintResourceKeys([RESOURCE_A]));

      // Re-requesting the full-tenant diff still serves the SAME row from cache — it
      // was never touched by the scoped recompute.
      const fullAgain = await diffSnapshots({
        mode: "drift", baseSnapshotRowId: baseSnapId, headSnapshotRowId: headSnapId,
        trigger: "manual",
      });
      expect(fullAgain.fromCache).toBe(true);
      expect(fullAgain.diffRowId).toBe(full.diffRowId);
    });
  },
);
