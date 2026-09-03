/**
 * rbd-instances.ts — the RBD's line items (#1509, part of #1487).
 *
 * The RBD is a container, not a single risk — one MFA risk with twenty-two
 * accounts, not twenty-two risk records. This module is the one place that
 * reads/writes `risk_instances`, the line items a container carries, so later
 * issues that attach to it (#1510's scope-expansion diff, #1512's signed
 * document render) call these rather than each re-implementing the queries.
 *
 * Each instance owns its own `foundAt`/`acceptedAt` clock — the whole point of
 * #1509 — and each accept is guarded the same way
 * `msp_risk_decisions.acceptedAt` already is: settable exactly once, never
 * edited after the fact. See `lib/db/src/schema/msp.ts`'s `risk_instances`
 * header for the full architecture note, including why this table takes a real
 * FK to the container row where `msp_rbd_versions` (#1508) deliberately does
 * not.
 */
import {
  db,
  riskInstancesTable,
  mspRiskDecisionsTable,
  type RiskInstance,
  type RiskInstanceExitReason,
} from "@workspace/db";
import { and, eq, isNull, desc } from "drizzle-orm";

export interface AddRiskInstanceInput {
  mspId: number;
  riskDecisionId: number;
  rbdId: string;
  label: string;
  objectId?: string | null;
  foundAt: Date;
  /** #1545 — the `drift_events.id` this line item was raised from, when it was
   * (the Shadow IT accumulation path). NULL for a hand-added line item. */
  driftEventId?: number | null;
}

/** Adds a new line item to a container. Returns null if the container row
 * (`riskDecisionId`) does not belong to `mspId` — callers map that to 404. */
export async function addRiskInstance(input: AddRiskInstanceInput): Promise<RiskInstance | null> {
  const [container] = await db
    .select({ id: mspRiskDecisionsTable.id })
    .from(mspRiskDecisionsTable)
    .where(and(eq(mspRiskDecisionsTable.id, input.riskDecisionId), eq(mspRiskDecisionsTable.mspId, input.mspId)))
    .limit(1);
  if (!container) return null;

  const [inserted] = await db
    .insert(riskInstancesTable)
    .values({
      mspId: input.mspId,
      riskDecisionId: input.riskDecisionId,
      rbdId: input.rbdId,
      label: input.label,
      objectId: input.objectId ?? null,
      foundAt: input.foundAt,
      status: "active",
      driftEventId: input.driftEventId ?? null,
    })
    .returning();
  return inserted;
}

/** #1545 — every ACTIVE line item still open against a given drift event, for
 * the Shadow IT accumulation path's own idempotency check (never re-log the
 * same open occurrence twice within one run). */
export async function listActiveRiskInstancesByDriftEventId(mspId: number, driftEventId: number): Promise<RiskInstance[]> {
  return db
    .select()
    .from(riskInstancesTable)
    .where(
      and(
        eq(riskInstancesTable.mspId, mspId),
        eq(riskInstancesTable.driftEventId, driftEventId),
        eq(riskInstancesTable.status, "active"),
      ),
    );
}

/** Every line item for a container, newest-found first. */
export async function listRiskInstances(mspId: number, riskDecisionId: number): Promise<RiskInstance[]> {
  return db
    .select()
    .from(riskInstancesTable)
    .where(and(eq(riskInstancesTable.mspId, mspId), eq(riskInstancesTable.riskDecisionId, riskDecisionId)))
    .orderBy(desc(riskInstancesTable.foundAt));
}

/** Every line item for a container, addressed by the durable container
 * identifier (`rbdId`) rather than the row id — the shape #1510's future diff
 * logic and `msp_rbd_versions` both use. */
export async function listRiskInstancesByRbdId(mspId: number, rbdId: string): Promise<RiskInstance[]> {
  return db
    .select()
    .from(riskInstancesTable)
    .where(and(eq(riskInstancesTable.mspId, mspId), eq(riskInstancesTable.rbdId, rbdId)))
    .orderBy(desc(riskInstancesTable.foundAt));
}

/**
 * Accepts a single line item. NEVER EDITABLE AFTER THE FACT — only an instance
 * with `acceptedAt IS NULL` may be accepted, matching
 * `msp_risk_decisions.acceptedAt`'s existing contract. Returns null if the
 * instance does not exist, does not belong to `mspId`, or is already accepted
 * (the caller maps that to 404/409 as appropriate).
 */
export async function acceptRiskInstance(mspId: number, instanceId: number): Promise<RiskInstance | null> {
  const [updated] = await db
    .update(riskInstancesTable)
    .set({ acceptedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(riskInstancesTable.id, instanceId),
        eq(riskInstancesTable.mspId, mspId),
        isNull(riskInstancesTable.acceptedAt),
      ),
    )
    .returning();
  return updated ?? null;
}

/**
 * Records why a line left — remediated vs. the object ceasing to exist.
 * Neither requires a signature (#1509); this is a plain operational update.
 * Only an `active` instance may exit. Returns null if the instance does not
 * exist, does not belong to `mspId`, or is not currently `active`.
 */
export async function resolveRiskInstance(
  mspId: number,
  instanceId: number,
  reason: RiskInstanceExitReason,
  note: string | null,
): Promise<RiskInstance | null> {
  const [updated] = await db
    .update(riskInstancesTable)
    .set({ status: reason, resolvedAt: new Date(), resolutionNote: note, updatedAt: new Date() })
    .where(
      and(
        eq(riskInstancesTable.id, instanceId),
        eq(riskInstancesTable.mspId, mspId),
        eq(riskInstancesTable.status, "active"),
      ),
    )
    .returning();
  return updated ?? null;
}
