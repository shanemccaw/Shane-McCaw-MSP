/**
 * portal-ownership-policy.ts — the per-customer RACI acceptance-gate mode
 * (#2162, redo of #1518).
 *
 * One tiny lookup, factored out of `routes/portal-ownership.ts` because three
 * call sites need it identically: the customer-side assign/accept/decline
 * routes in that file, the symmetric MSP-side routes in
 * `routes/msp-ownership.ts` (a cross-boundary MSP holder responding without a
 * customer JWT still has to be gated by the SAME customer's setting), and the
 * Settings read/write route. No row for a customer means "loose" — the
 * default is computed here rather than backfilled, so an existing customer's
 * behaviour does not change until they opt in to strict.
 */
import { db, portalOwnershipPolicyTable, OWNERSHIP_GATE_MODES, type OwnershipGateMode } from "@workspace/db";
import { eq } from "drizzle-orm";

export const DEFAULT_OWNERSHIP_GATE_MODE: OwnershipGateMode = "loose";

export function isOwnershipGateMode(value: unknown): value is OwnershipGateMode {
  return (OWNERSHIP_GATE_MODES as readonly string[]).includes(value as string);
}

export async function resolveGateMode(customerId: number): Promise<OwnershipGateMode> {
  const [row] = await db
    .select({ gateMode: portalOwnershipPolicyTable.gateMode })
    .from(portalOwnershipPolicyTable)
    .where(eq(portalOwnershipPolicyTable.customerId, customerId))
    .limit(1);
  return row?.gateMode ?? DEFAULT_OWNERSHIP_GATE_MODE;
}
