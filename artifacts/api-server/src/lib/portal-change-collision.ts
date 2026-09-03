/**
 * portal-change-collision.ts — the pure derivations behind Change Control's
 * collision detection on `targetResource` (#1504).
 *
 * "Two changes hitting the same object" — the substance of #1504. Unlike the
 * freeze/maintenance calendars (a standing rule checked against one change's
 * booked span), collision detection compares one CR's booked span against
 * every OTHER open CR the same MSP/tenant already has scheduled, and asks
 * whether they name the same `targetResource` AND their booked windows
 * overlap. No recurrence math is involved — a change request is a one-off
 * event, never a standing rule — so this module is much smaller than the two
 * calendar ones.
 *
 * Gated the same way the freeze booked-window check is: only evaluated when
 * the change being submitted carries a real `scheduled_start`. A change with
 * no real instant cannot collide with anything by definition — there is
 * nothing to guess a window from.
 */

/** One existing open CR this submission is checked against. */
export interface ChangeRequestCollisionCandidate {
  readonly id: number;
  readonly code: string;
  readonly targetResource: string;
  readonly scheduledStart: Date;
  readonly scheduledEnd: Date | null;
}

/**
 * Whether two booked spans overlap. Either end may be null — a change known
 * only by its start instant (the Microsoft-routing path produces exactly
 * this) is treated as a zero-duration point in time. Two points collide only
 * when they land on the exact same instant; a point and a real span collide
 * when the point falls inside `[start, end)`; two real spans collide by the
 * ordinary half-open-interval rule (each starts before the other ends).
 */
export function spansCollide(aStart: Date, aEnd: Date | null, bStart: Date, bEnd: Date | null): boolean {
  const aIsPoint = aEnd === null;
  const bIsPoint = bEnd === null;
  if (aIsPoint && bIsPoint) return aStart.getTime() === bStart.getTime();
  if (aIsPoint) return aStart.getTime() >= bStart.getTime() && aStart.getTime() < bEnd!.getTime();
  if (bIsPoint) return bStart.getTime() >= aStart.getTime() && bStart.getTime() < aEnd!.getTime();
  return aStart.getTime() < bEnd!.getTime() && bStart.getTime() < aEnd!.getTime();
}

/**
 * The first existing CR this submission collides with — same `targetResource`
 * (trimmed, case-insensitive — `msp_change_requests.target_resource` is free
 * text typed by a human, and "Exchange::mailbox-flow-rule-7" and
 * "exchange::mailbox-flow-rule-7 " are the same object) with an overlapping
 * booked window — or null when none does. Candidates are the caller's
 * responsibility to have already scoped to the right (mspId, tenantId) and
 * excluded the CR being updated, if any (an edit re-checking itself would
 * always "collide" with its own prior row).
 */
export function findCollidingChangeRequest(
  candidates: readonly ChangeRequestCollisionCandidate[],
  targetResource: string,
  spanStart: Date,
  spanEnd: Date | null,
): ChangeRequestCollisionCandidate | null {
  const target = targetResource.trim().toLowerCase();
  if (!target) return null;
  for (const c of candidates) {
    if (c.targetResource.trim().toLowerCase() !== target) continue;
    if (spansCollide(c.scheduledStart, c.scheduledEnd, spanStart, spanEnd)) return c;
  }
  return null;
}
