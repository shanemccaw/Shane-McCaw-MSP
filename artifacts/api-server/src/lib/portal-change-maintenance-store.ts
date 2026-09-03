/**
 * portal-change-maintenance-store.ts — the DB side of the maintenance-window
 * calendar (#1504). The pure matching rules live in
 * `portal-change-maintenance.ts`; this is where they meet
 * `change_maintenance_windows`.
 */

import { db, changeMaintenanceWindowsTable } from "@workspace/db";
import { and, eq, or } from "drizzle-orm";

import {
  findMaintenanceCoverage,
  toMaintenanceCandidate,
  type MaintenanceMatchContext,
  type MaintenanceWindowCandidate,
} from "./portal-change-maintenance";

/**
 * Every ACTIVE window that could possibly apply to this (mspId, tenantId,
 * workload) — global, this tenant, or this workload — ordered
 * tenant-then-workload-then-global, same shape as `candidateFreezeWindows`.
 */
export async function candidateMaintenanceWindows(ctx: MaintenanceMatchContext): Promise<MaintenanceWindowCandidate[]> {
  const rows = await db
    .select()
    .from(changeMaintenanceWindowsTable)
    .where(
      and(
        eq(changeMaintenanceWindowsTable.mspId, ctx.mspId),
        eq(changeMaintenanceWindowsTable.active, true),
        or(
          eq(changeMaintenanceWindowsTable.scope, "global"),
          and(eq(changeMaintenanceWindowsTable.scope, "tenant"), eq(changeMaintenanceWindowsTable.tenantId, ctx.tenantId)),
          and(eq(changeMaintenanceWindowsTable.scope, "workload"), eq(changeMaintenanceWindowsTable.workload, ctx.workload)),
        ),
      ),
    );

  const rank: Record<string, number> = { tenant: 0, workload: 1, global: 2 };
  return rows.map(toMaintenanceCandidate).sort((a, b) => rank[a.scope] - rank[b.scope]);
}

/**
 * The maintenance window covering a change's booked span, or null when the
 * span is not covered by any matching, active window — the VIOLATION case
 * when `enforce_maintenance_windows` is on. Callers gate on a non-null
 * `spanStart` themselves (same discipline `activeFreezeForSubmit`'s booked-
 * window sibling follows) — this always evaluates when called.
 */
export async function maintenanceCoverageForBookedSpan(
  ctx: MaintenanceMatchContext,
  spanStart: Date,
  spanEnd: Date | null,
): Promise<MaintenanceWindowCandidate | null> {
  const candidates = await candidateMaintenanceWindows(ctx);
  return findMaintenanceCoverage(candidates, ctx, spanStart, spanEnd);
}
