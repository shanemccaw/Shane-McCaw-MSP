/**
 * portal-change-freeze-store.ts — the DB side of the freeze calendar (#1500).
 * The pure matching rules live in `portal-change-freeze.ts`; this is where
 * they meet `change_freeze_windows` and the `cr_approvals` exception stage.
 */

import { db, changeFreezeWindowsTable, crApprovalsTable } from "@workspace/db";
import { and, asc, eq, or } from "drizzle-orm";

import {
  findActiveFreeze,
  findFreezeForBookedWindow,
  toFreezeCandidate,
  type FreezeMatchContext,
  type FreezeWindowCandidate,
} from "./portal-change-freeze";
import { logger } from "./logger";

const log = logger.child({ channel: "workflow.change-control" });

/**
 * Every ACTIVE window that could possibly apply to this (mspId, tenantId,
 * workload) — global, this tenant, or this workload — ordered
 * tenant-then-workload-then-global so `findActiveFreeze` reports the most
 * specific rule when more than one is in effect.
 */
export async function candidateFreezeWindows(ctx: FreezeMatchContext): Promise<FreezeWindowCandidate[]> {
  const rows = await db
    .select()
    .from(changeFreezeWindowsTable)
    .where(
      and(
        eq(changeFreezeWindowsTable.mspId, ctx.mspId),
        eq(changeFreezeWindowsTable.active, true),
        or(
          eq(changeFreezeWindowsTable.scope, "global"),
          and(eq(changeFreezeWindowsTable.scope, "tenant"), eq(changeFreezeWindowsTable.tenantId, ctx.tenantId)),
          and(eq(changeFreezeWindowsTable.scope, "workload"), eq(changeFreezeWindowsTable.workload, ctx.workload)),
        ),
      ),
    );

  const rank: Record<string, number> = { tenant: 0, workload: 1, global: 2 };
  return rows.map(toFreezeCandidate).sort((a, b) => rank[a.scope] - rank[b.scope]);
}

/** The freeze a submission collides with right now, or null. */
export async function activeFreezeForSubmit(
  ctx: FreezeMatchContext,
  now: Date = new Date(),
): Promise<FreezeWindowCandidate | null> {
  const candidates = await candidateFreezeWindows(ctx);
  return findActiveFreeze(candidates, ctx, now);
}

/**
 * #1762 — the freeze a change's own BOOKED window overlaps, or null. `spanEnd`
 * may be null for a start-only booked window (the Microsoft-routing path), in
 * which case the freeze is evaluated at the `spanStart` instant. Callers gate
 * this on a non-null `scheduled_start` — a change with no real instant is not
 * evaluated here at all.
 */
export async function freezeForBookedWindow(
  ctx: FreezeMatchContext,
  spanStart: Date,
  spanEnd: Date | null,
): Promise<FreezeWindowCandidate | null> {
  const candidates = await candidateFreezeWindows(ctx);
  return findFreezeForBookedWindow(candidates, ctx, spanStart, spanEnd);
}

/**
 * Materialise the freeze-EXCEPTION stage on a change already created inside an
 * active freeze window. Appended AFTER whatever ordinary approval stages
 * `materializeApprovalsForChange` (#1496) already wrote, at the next stage
 * number — an ADDITIONAL bar, not a substitute for the ordinary ones. Callers
 * (the two create routes) call this exactly once, in the same request that
 * created the CR.
 */
export async function recordFreezeException(args: {
  changeRequestId: number;
  mspId: number;
  tenantId: string;
  freezeWindowId: number;
  justification: string;
  requestedBy: string;
  now?: Date;
}): Promise<number> {
  const now = args.now ?? new Date();
  const existing = await db
    .select({ stage: crApprovalsTable.stage })
    .from(crApprovalsTable)
    .where(eq(crApprovalsTable.changeRequestId, args.changeRequestId))
    .orderBy(asc(crApprovalsTable.stage));
  const nextStage = existing.length > 0 ? Math.max(...existing.map((r) => r.stage)) + 1 : 1;

  // A short SLA — an exception is asked for because the change is time-
  // sensitive; leaving it pending for the ordinary multi-day window defeats
  // the point of asking.
  const dueAt = new Date(now.getTime() + 1 * 86_400_000);

  const [inserted] = await db
    .insert(crApprovalsTable)
    .values({
      changeRequestId: args.changeRequestId,
      mspId: args.mspId,
      tenantId: args.tenantId,
      stage: nextStage,
      decision: "pending",
      // Placeholder — the row's own `freezeWindowId` is what recordApproval/
      // recordRejection actually enforce against, not this field.
      approverRole: "msp",
      reason: `Freeze exception requested by ${args.requestedBy}`,
      justification: args.justification,
      freezeWindowId: args.freezeWindowId,
      dueAt,
    })
    .returning({ id: crApprovalsTable.id });

  log.info(
    { changeRequestId: args.changeRequestId, mspId: args.mspId, freezeWindowId: args.freezeWindowId, stage: nextStage },
    "change-freeze: exception stage recorded — requires MSP sign-off",
  );
  return inserted.id;
}
