/**
 * portal-change-collision-store.ts — the DB side of collision detection on
 * `targetResource` (#1504). The pure overlap rule lives in
 * `portal-change-collision.ts`; this is where it meets
 * `msp_change_requests`.
 */

import { db, mspChangeRequestsTable } from "@workspace/db";
import { and, eq, inArray, isNotNull, ne } from "drizzle-orm";

import {
  findCollidingChangeRequest,
  type ChangeRequestCollisionCandidate,
} from "./portal-change-collision";
import { formatChangeRequestCode } from "./portal-change-control";

/** Statuses a CR can still collide through — a completed/rejected/rolled-back
 *  change no longer occupies its booked window. */
export const COLLISION_OPEN_STATUSES = ["pending_approval", "scheduled", "in_progress"] as const;

/**
 * Every OTHER open, scheduled CR for this (mspId, tenantId) — the pure
 * `targetResource`/overlap match happens in the caller, not here, so this
 * stays a plain scoped read. `excludeChangeRequestId` omits the CR being
 * evaluated itself (relevant once a PATCH can move a CR's own schedule).
 */
export async function openScheduledChangeRequests(
  mspId: number,
  tenantId: string,
  excludeChangeRequestId?: number,
): Promise<ChangeRequestCollisionCandidate[]> {
  const rows = await db
    .select({
      id: mspChangeRequestsTable.id,
      targetResource: mspChangeRequestsTable.targetResource,
      scheduledStart: mspChangeRequestsTable.scheduledStart,
      scheduledEnd: mspChangeRequestsTable.scheduledEnd,
    })
    .from(mspChangeRequestsTable)
    .where(
      and(
        eq(mspChangeRequestsTable.mspId, mspId),
        eq(mspChangeRequestsTable.tenantId, tenantId),
        inArray(mspChangeRequestsTable.status, [...COLLISION_OPEN_STATUSES]),
        isNotNull(mspChangeRequestsTable.scheduledStart),
        ...(excludeChangeRequestId !== undefined ? [ne(mspChangeRequestsTable.id, excludeChangeRequestId)] : []),
      ),
    );

  return rows.map((r) => ({
    id: r.id,
    code: formatChangeRequestCode(r.id),
    targetResource: r.targetResource,
    scheduledStart: r.scheduledStart as Date,
    scheduledEnd: r.scheduledEnd,
  }));
}

/**
 * The existing open CR a submission's booked window collides with on
 * `targetResource`, or null. Callers gate this on a non-null booked
 * `spanStart` themselves, same discipline the freeze/maintenance booked-
 * window checks follow.
 */
export async function collidingChangeRequestForSubmit(
  mspId: number,
  tenantId: string,
  targetResource: string,
  spanStart: Date,
  spanEnd: Date | null,
  excludeChangeRequestId?: number,
): Promise<ChangeRequestCollisionCandidate | null> {
  const candidates = await openScheduledChangeRequests(mspId, tenantId, excludeChangeRequestId);
  return findCollidingChangeRequest(candidates, targetResource, spanStart, spanEnd);
}
