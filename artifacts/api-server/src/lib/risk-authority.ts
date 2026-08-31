/**
 * risk-authority.ts — role-based risk-acceptance authority (Git #1511).
 *
 * Settled architecture (see #1511's comment thread, corrected twice before
 * landing): risk-acceptance authority resolves through the M365 WORKLOAD a
 * risk's finding inherits from (#1523 — RACI attaches to the service,
 * findings inherit ownership from their service, risks derive from
 * findings), via whoever currently holds Accountable (A) on that workload's
 * Ownership/RACI matrix cell (#1491) — never through a per-risk assignment.
 *
 * What "A" means here (#1515/#1517, both landed):
 *   - A can be held by MULTIPLE individuals, never a group.
 *   - Holders are ordered (primary/second/third) but ALL carry identical
 *     authority — the order is informational only, no succession logic.
 *   - Any current holder may sign at any time, for any reason.
 *
 * Point-in-time resolution (#1522) is required for the record a signed RBD
 * keeps: because `portal_ownership_assignments` is CURRENT state, "who held A
 * when this RBD was signed" must be answered by replaying the append-only
 * `portal_ownership_events` log as of that moment, never by re-reading
 * current state after the fact (a later roster change must not be able to
 * rewrite who actually had authority at sign time).
 */

import { and, asc, eq, lte } from "drizzle-orm";
import { db, portalOwnershipAssignmentsTable, portalOwnershipEventsTable, usersTable } from "@workspace/db";

import { resolveWorkloadForCheckKey } from "./tenant-workloads";
import { resolveCustomerMspId } from "./portal-customer-scope";
import { personIdForUser } from "./portal-ownership";

export interface RiskAuthorityWorkload {
  /** The matrix object id, e.g. "wl-icam" — same id space
   * `portal_ownership_assignments.objectId` / `workloadObject()` use. */
  readonly objectId: string;
  /** The bare workload key, e.g. "icam". */
  readonly key: string;
  readonly label: string;
}

/**
 * Resolves a `msp_risk_decisions.check_key` (== `monitor_checks.key`) to the
 * workload whose matrix row carries risk-acceptance authority for it. Null
 * for a null/empty checkKey, or one whose category this build's map does not
 * cover (`resolveWorkloadForCheckKey`'s own "silence is the honest answer"
 * rule) — both real, unexceptional states, not errors.
 */
export function resolveRiskWorkload(checkKey: string | null): RiskAuthorityWorkload | null {
  if (!checkKey) return null;
  const def = resolveWorkloadForCheckKey(checkKey);
  if (!def) return null;
  return { objectId: "wl-" + def.key, key: def.key, label: def.label };
}

/**
 * Every wire person id currently holding Accountable on one workload's matrix
 * cell — CURRENT state (`portal_ownership_assignments` as it stands right
 * now). Used to gate a live sign action. Order matches the matrix's own
 * precedence (`orderRank`), though every holder carries identical authority.
 */
export async function currentAHolderPersonIds(customerId: number, workloadObjectId: string): Promise<string[]> {
  const rows = await db
    .select({ ownerPersonId: portalOwnershipAssignmentsTable.ownerPersonId })
    .from(portalOwnershipAssignmentsTable)
    .where(
      and(
        eq(portalOwnershipAssignmentsTable.customerId, customerId),
        eq(portalOwnershipAssignmentsTable.objectId, workloadObjectId),
        eq(portalOwnershipAssignmentsTable.roleKey, "a"),
      ),
    )
    .orderBy(asc(portalOwnershipAssignmentsTable.orderRank), asc(portalOwnershipAssignmentsTable.id));
  return rows.map((r) => r.ownerPersonId).filter((id) => id !== "");
}

/**
 * Point-in-time replay (#1522): every wire person id that held Accountable on
 * one workload's cell AS OF a given moment, reconstructed from the
 * append-only event log rather than current state.
 *
 * Each (customerId, objectId, roleKey, ownerPersonId) tuple is its own
 * sub-log (`assigned` the first time a holder appears, `reassigned` on every
 * re-assert after — see `assignEventType`'s own header). There is no
 * "remove one holder" event or route in this codebase today (#1517's reorder
 * requires naming every CURRENT holder, it cannot drop one) — clearing is
 * only ever an empty-owner event, which is its own group keyed by `""` and
 * never mutates a real holder's row. So the replay is exactly: every
 * non-empty ownerPersonId with at least one event at or before `asOf`.
 */
export async function aHoldersAsOf(customerId: number, workloadObjectId: string, asOf: Date): Promise<string[]> {
  const rows = await db
    .select({ ownerPersonId: portalOwnershipEventsTable.ownerPersonId })
    .from(portalOwnershipEventsTable)
    .where(
      and(
        eq(portalOwnershipEventsTable.customerId, customerId),
        eq(portalOwnershipEventsTable.objectId, workloadObjectId),
        eq(portalOwnershipEventsTable.roleKey, "a"),
        lte(portalOwnershipEventsTable.createdAt, asOf),
      ),
    );
  return [...new Set(rows.map((r) => r.ownerPersonId).filter((id) => id !== ""))];
}

/**
 * Display-name lookup for a set of wire person ids, over the SAME roster
 * `portal-ownership.ts`'s matrix draws from — the customer's own team
 * (`users.tenantId = customerId`) plus their MSP's staff (`users.mspId`,
 * MSPAdmin/MSPOperator). A holder id resolving to no row (a deactivated or
 * deleted account) falls back to the bare id rather than being dropped —
 * an authority record naming someone no longer resolvable is still evidence.
 */
export async function namesForPersonIds(
  customerId: number,
  personIds: readonly string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (personIds.length === 0) return result;

  const mspId = await resolveCustomerMspId(customerId);
  const [teamRows, staffRows] = await Promise.all([
    db
      .select({ id: usersTable.id, email: usersTable.email, name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.tenantId, customerId)),
    mspId === null
      ? Promise.resolve([])
      : db
          .select({ id: usersTable.id, email: usersTable.email, name: usersTable.name })
          .from(usersTable)
          .where(eq(usersTable.mspId, mspId)),
  ]);

  const wanted = new Set(personIds);
  for (const row of [...teamRows, ...staffRows]) {
    const pid = personIdForUser(row.id);
    if (wanted.has(pid)) result.set(pid, (row.name ?? "").trim() || row.email);
  }
  return result;
}

export interface RiskAuthorityHolder {
  readonly personId: string;
  readonly name: string;
}

export interface RiskAuthority {
  readonly workload: RiskAuthorityWorkload;
  /** Current A holders on the workload. Empty when the workload is real but
   * nobody has been assigned yet — a genuine ownership gap, not an error. */
  readonly holders: readonly RiskAuthorityHolder[];
}

/** The full CURRENT authority picture for one risk: which workload its
 * finding resolves to, and who currently holds Accountable there. Null when
 * `checkKey` resolves to no workload. */
export async function resolveRiskAuthority(customerId: number, checkKey: string | null): Promise<RiskAuthority | null> {
  const workload = resolveRiskWorkload(checkKey);
  if (!workload) return null;
  const holderIds = await currentAHolderPersonIds(customerId, workload.objectId);
  const names = await namesForPersonIds(customerId, holderIds);
  const holders = holderIds.map((id) => ({ personId: id, name: names.get(id) ?? id }));
  return { workload, holders };
}

export interface RiskAuthorizedBy {
  readonly workload: RiskAuthorityWorkload;
  /** Every holder the point-in-time replay found AS OF the acceptance —
   * evidence of who backed the signature, not just who typed it. */
  readonly holders: readonly RiskAuthorityHolder[];
}

/** The point-in-time authority picture for an ALREADY-SIGNED risk: which
 * workload authorised it, and who held Accountable there at that moment
 * (replayed from the event log, never from current state). Null when
 * `checkKey` resolves to no workload. */
export async function resolveAuthorizedByAsOf(
  customerId: number,
  checkKey: string | null,
  asOf: Date,
): Promise<RiskAuthorizedBy | null> {
  const workload = resolveRiskWorkload(checkKey);
  if (!workload) return null;
  const holderIds = await aHoldersAsOf(customerId, workload.objectId, asOf);
  const names = await namesForPersonIds(customerId, holderIds);
  const holders = holderIds.map((id) => ({ personId: id, name: names.get(id) ?? id }));
  return { workload, holders };
}

export interface RiskAuthorityRowInput {
  readonly checkKey: string | null;
  /** Non-null only for an already-accepted risk. */
  readonly acceptedAt: Date | null;
}

export interface RiskAuthorityBatchResult {
  /** CURRENT authority picture, aligned index-for-index with the input rows. */
  readonly current: ReadonlyArray<RiskAuthority | null>;
  /** Point-in-time authority AS OF `acceptedAt`, aligned index-for-index with
   * the input rows. Null for a row with no `acceptedAt` or no resolvable
   * workload. */
  readonly authorizedBy: ReadonlyArray<RiskAuthorizedBy | null>;
}

/**
 * The batched form of `resolveRiskAuthority` / `resolveAuthorizedByAsOf` for a
 * whole register listing: one query per DISTINCT workload for current
 * holders, one query per distinct (workload, acceptedAt) pair for point-in-
 * time holders, and one shared name lookup for everyone involved — instead of
 * the N (or 2N) round trips a naive per-row call would cost.
 */
export async function resolveRiskAuthoritiesBatch(
  customerId: number,
  rows: readonly RiskAuthorityRowInput[],
): Promise<RiskAuthorityBatchResult> {
  const workloadByRow = rows.map((r) => resolveRiskWorkload(r.checkKey));

  const distinctWorkloadIds = [
    ...new Set(workloadByRow.filter((w): w is RiskAuthorityWorkload => w !== null).map((w) => w.objectId)),
  ];
  const currentHolderIdsByObjectId = new Map<string, string[]>();
  await Promise.all(
    distinctWorkloadIds.map(async (objectId) => {
      currentHolderIdsByObjectId.set(objectId, await currentAHolderPersonIds(customerId, objectId));
    }),
  );

  const asOfKey = (objectId: string, at: Date) => objectId + "@" + at.toISOString();
  const asOfPairs = new Map<string, { objectId: string; at: Date }>();
  rows.forEach((r, i) => {
    const w = workloadByRow[i];
    if (w && r.acceptedAt) asOfPairs.set(asOfKey(w.objectId, r.acceptedAt), { objectId: w.objectId, at: r.acceptedAt });
  });
  const asOfHolderIdsByKey = new Map<string, string[]>();
  await Promise.all(
    [...asOfPairs.entries()].map(async ([key, { objectId, at }]) => {
      asOfHolderIdsByKey.set(key, await aHoldersAsOf(customerId, objectId, at));
    }),
  );

  const allIds = new Set<string>();
  for (const ids of currentHolderIdsByObjectId.values()) for (const id of ids) allIds.add(id);
  for (const ids of asOfHolderIdsByKey.values()) for (const id of ids) allIds.add(id);
  const names = await namesForPersonIds(customerId, [...allIds]);
  const toHolders = (ids: readonly string[]): RiskAuthorityHolder[] => ids.map((id) => ({ personId: id, name: names.get(id) ?? id }));

  const current = rows.map((_, i) => {
    const w = workloadByRow[i];
    if (!w) return null;
    return { workload: w, holders: toHolders(currentHolderIdsByObjectId.get(w.objectId) ?? []) };
  });

  const authorizedBy = rows.map((r, i) => {
    const w = workloadByRow[i];
    if (!w || !r.acceptedAt) return null;
    const ids = asOfHolderIdsByKey.get(asOfKey(w.objectId, r.acceptedAt)) ?? [];
    return { workload: w, holders: toHolders(ids) };
  });

  return { current, authorizedBy };
}
