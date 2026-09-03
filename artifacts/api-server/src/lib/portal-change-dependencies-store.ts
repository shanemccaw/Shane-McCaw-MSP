/**
 * portal-change-dependencies-store.ts — `blocked_by` edges between change
 * requests (#1504).
 *
 * One row in `change_request_dependencies` is one directed edge:
 * `changeRequestId` is BLOCKED BY `blocksChangeRequestId`. This module owns
 * the CRUD (`msp-change-dependencies.ts` is the only route caller) and the
 * one real query the write gate needs — `unresolvedBlockersFor` — so
 * `change-control-write-gate.ts` never touches this table directly.
 */

import { db, changeRequestDependenciesTable, mspChangeRequestsTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";

import { formatChangeRequestCode } from "./portal-change-control";
import { logger } from "./logger";

const log = logger.child({ channel: "workflow.change-control" });

/**
 * One edge, always described from "my" side: `otherChangeRequestId`/`Code`/
 * `Status` describe the CR on the OTHER end, whichever direction that is —
 * the blocker when this came out of `blockedBy`, the dependent CR when this
 * came out of `blocks`. Callers never have to remember which raw column means
 * what per direction.
 */
export interface DependencyEdge {
  readonly id: number;
  readonly otherChangeRequestId: number;
  readonly otherChangeRequestCode: string;
  readonly otherStatus: string;
  readonly note: string | null;
  readonly createdBy: string | null;
  readonly createdAt: Date;
}

/** Both directions for one CR: what blocks it, and what it blocks. */
export interface DependencyEdges {
  readonly blockedBy: readonly DependencyEdge[];
  readonly blocks: readonly DependencyEdge[];
}

/**
 * Every edge touching this CR, in either direction, scoped to `mspId`. Joins
 * the OTHER side's status/code in — the write gate and the wire layer both
 * need "is the blocker done yet", not just its id.
 */
export async function dependencyEdgesFor(changeRequestId: number, mspId: number): Promise<DependencyEdges> {
  const blockedByRows = await db
    .select({
      id: changeRequestDependenciesTable.id,
      otherId: changeRequestDependenciesTable.blocksChangeRequestId,
      note: changeRequestDependenciesTable.note,
      createdBy: changeRequestDependenciesTable.createdBy,
      createdAt: changeRequestDependenciesTable.createdAt,
    })
    .from(changeRequestDependenciesTable)
    .where(
      and(
        eq(changeRequestDependenciesTable.mspId, mspId),
        eq(changeRequestDependenciesTable.changeRequestId, changeRequestId),
      ),
    );

  const blocksRows = await db
    .select({
      id: changeRequestDependenciesTable.id,
      otherId: changeRequestDependenciesTable.changeRequestId,
      note: changeRequestDependenciesTable.note,
      createdBy: changeRequestDependenciesTable.createdBy,
      createdAt: changeRequestDependenciesTable.createdAt,
    })
    .from(changeRequestDependenciesTable)
    .where(
      and(
        eq(changeRequestDependenciesTable.mspId, mspId),
        eq(changeRequestDependenciesTable.blocksChangeRequestId, changeRequestId),
      ),
    );

  const otherIds = [...new Set([...blockedByRows.map((r) => r.otherId), ...blocksRows.map((r) => r.otherId)])];
  const otherStatuses = otherIds.length === 0
    ? []
    : await db
        .select({ id: mspChangeRequestsTable.id, status: mspChangeRequestsTable.status })
        .from(mspChangeRequestsTable)
        .where(inArray(mspChangeRequestsTable.id, otherIds));
  const statusById = new Map<number, string>(otherStatuses.map((r) => [r.id, r.status] as const));

  const toEdge = (r: { id: number; otherId: number; note: string | null; createdBy: string | null; createdAt: Date }): DependencyEdge => ({
    id: r.id,
    otherChangeRequestId: r.otherId,
    otherChangeRequestCode: formatChangeRequestCode(r.otherId),
    otherStatus: statusById.get(r.otherId) ?? "unknown",
    note: r.note,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
  });

  return {
    blockedBy: blockedByRows.map(toEdge),
    blocks: blocksRows.map(toEdge),
  };
}

/**
 * The bulk counterpart to `dependencyEdgesFor`, for a register page rendering
 * many CRs at once (`GET /portal/change-control`) — one pair of queries for
 * the whole page instead of `dependencyEdgesFor` called once per row. CRs
 * with no edges at all are simply absent from the returned map (the
 * overwhelming majority); callers default to `{ blockedBy: [], blocks: [] }`.
 */
export async function dependencyEdgesForMany(changeRequestIds: readonly number[], mspId: number): Promise<Map<number, DependencyEdges>> {
  const result = new Map<number, DependencyEdges>();
  if (changeRequestIds.length === 0) return result;

  const edgeRows = await db
    .select({
      id: changeRequestDependenciesTable.id,
      changeRequestId: changeRequestDependenciesTable.changeRequestId,
      blocksChangeRequestId: changeRequestDependenciesTable.blocksChangeRequestId,
      note: changeRequestDependenciesTable.note,
      createdBy: changeRequestDependenciesTable.createdBy,
      createdAt: changeRequestDependenciesTable.createdAt,
    })
    .from(changeRequestDependenciesTable)
    .where(
      and(
        eq(changeRequestDependenciesTable.mspId, mspId),
        inArray(changeRequestDependenciesTable.changeRequestId, [...changeRequestIds]),
      ),
    );
  const reverseEdgeRows = await db
    .select({
      id: changeRequestDependenciesTable.id,
      changeRequestId: changeRequestDependenciesTable.changeRequestId,
      blocksChangeRequestId: changeRequestDependenciesTable.blocksChangeRequestId,
      note: changeRequestDependenciesTable.note,
      createdBy: changeRequestDependenciesTable.createdBy,
      createdAt: changeRequestDependenciesTable.createdAt,
    })
    .from(changeRequestDependenciesTable)
    .where(
      and(
        eq(changeRequestDependenciesTable.mspId, mspId),
        inArray(changeRequestDependenciesTable.blocksChangeRequestId, [...changeRequestIds]),
      ),
    );

  const otherIds = [...new Set([...edgeRows.map((r) => r.blocksChangeRequestId), ...reverseEdgeRows.map((r) => r.changeRequestId)])];
  const otherStatuses = otherIds.length === 0
    ? []
    : await db
        .select({ id: mspChangeRequestsTable.id, status: mspChangeRequestsTable.status })
        .from(mspChangeRequestsTable)
        .where(inArray(mspChangeRequestsTable.id, otherIds));
  const statusById = new Map<number, string>(otherStatuses.map((r) => [r.id, r.status] as const));

  for (const id of changeRequestIds) result.set(id, { blockedBy: [], blocks: [] });
  for (const r of edgeRows) {
    const entry = result.get(r.changeRequestId);
    if (!entry) continue;
    (entry.blockedBy as DependencyEdge[]).push({
      id: r.id,
      otherChangeRequestId: r.blocksChangeRequestId,
      otherChangeRequestCode: formatChangeRequestCode(r.blocksChangeRequestId),
      otherStatus: statusById.get(r.blocksChangeRequestId) ?? "unknown",
      note: r.note,
      createdBy: r.createdBy,
      createdAt: r.createdAt,
    });
  }
  for (const r of reverseEdgeRows) {
    const entry = result.get(r.blocksChangeRequestId);
    if (!entry) continue;
    (entry.blocks as DependencyEdge[]).push({
      id: r.id,
      otherChangeRequestId: r.changeRequestId,
      otherChangeRequestCode: formatChangeRequestCode(r.changeRequestId),
      otherStatus: statusById.get(r.changeRequestId) ?? "unknown",
      note: r.note,
      createdBy: r.createdBy,
      createdAt: r.createdAt,
    });
  }
  return result;
}

/**
 * Every OPEN (non-`completed`) blocker still standing in the way of claiming
 * `changeRequestId` for a write — the exact list `change-control-write-gate.ts`
 * needs. Empty means unblocked.
 */
export async function unresolvedBlockersFor(changeRequestId: number, mspId: number): Promise<DependencyEdge[]> {
  const { blockedBy } = await dependencyEdgesFor(changeRequestId, mspId);
  return blockedBy.filter((e) => e.otherStatus !== "completed");
}

export type CreateDependencyResult =
  | { readonly ok: true; readonly edge: DependencyEdge }
  | { readonly ok: false; readonly reason: string };

/**
 * Create a `changeRequestId` BLOCKED BY `blocksChangeRequestId` edge. Rejects
 * a self-edge and a DIRECT reverse-of-an-existing-edge cycle (A blocks B, then
 * B blocks A) — a real cycle detector over the whole graph is not implemented
 * (see the schema's own header: Postgres cannot express this declaratively,
 * and a full transitive walk is out of scope for a two-CR dependency edge);
 * this catches the one shape that is trivial and common to create by mistake.
 */
export async function createDependency(args: {
  mspId: number;
  changeRequestId: number;
  blocksChangeRequestId: number;
  note?: string | null;
  createdBy?: string | null;
}): Promise<CreateDependencyResult> {
  if (args.changeRequestId === args.blocksChangeRequestId) {
    return { ok: false, reason: "a change request cannot be blocked by itself" };
  }

  const both = await db
    .select({ id: mspChangeRequestsTable.id, status: mspChangeRequestsTable.status })
    .from(mspChangeRequestsTable)
    .where(
      and(
        eq(mspChangeRequestsTable.mspId, args.mspId),
        inArray(mspChangeRequestsTable.id, [args.changeRequestId, args.blocksChangeRequestId]),
      ),
    );
  if (both.length !== 2) {
    return { ok: false, reason: "both change requests must exist and belong to this MSP" };
  }

  const [reverseExists] = await db
    .select({ id: changeRequestDependenciesTable.id })
    .from(changeRequestDependenciesTable)
    .where(
      and(
        eq(changeRequestDependenciesTable.mspId, args.mspId),
        eq(changeRequestDependenciesTable.changeRequestId, args.blocksChangeRequestId),
        eq(changeRequestDependenciesTable.blocksChangeRequestId, args.changeRequestId),
      ),
    )
    .limit(1);
  if (reverseExists) {
    return { ok: false, reason: "the reverse dependency already exists — this would create a two-CR cycle" };
  }

  try {
    const [inserted] = await db
      .insert(changeRequestDependenciesTable)
      .values({
        mspId: args.mspId,
        changeRequestId: args.changeRequestId,
        blocksChangeRequestId: args.blocksChangeRequestId,
        note: args.note ?? null,
        createdBy: args.createdBy ?? null,
      })
      .returning();

    const blockerStatus = both.find((r) => r.id === args.blocksChangeRequestId)?.status ?? "unknown";
    log.info(
      { mspId: args.mspId, changeRequestId: args.changeRequestId, blocksChangeRequestId: args.blocksChangeRequestId },
      "change-control: blocked_by dependency created",
    );
    return {
      ok: true,
      edge: {
        id: inserted.id,
        otherChangeRequestId: inserted.blocksChangeRequestId,
        otherChangeRequestCode: formatChangeRequestCode(inserted.blocksChangeRequestId),
        otherStatus: blockerStatus,
        note: inserted.note,
        createdBy: inserted.createdBy,
        createdAt: inserted.createdAt,
      },
    };
  } catch (err) {
    // Unique-index collision (the same edge already exists) surfaces here
    // rather than being pre-checked, avoiding a TOCTOU race between the check
    // and the insert.
    log.warn({ err, mspId: args.mspId, changeRequestId: args.changeRequestId, blocksChangeRequestId: args.blocksChangeRequestId }, "change-control: dependency create failed");
    return { ok: false, reason: "this dependency already exists" };
  }
}

export async function deleteDependency(id: number, mspId: number): Promise<boolean> {
  const deleted = await db
    .delete(changeRequestDependenciesTable)
    .where(and(eq(changeRequestDependenciesTable.id, id), eq(changeRequestDependenciesTable.mspId, mspId)))
    .returning({ id: changeRequestDependenciesTable.id });
  return deleted.length > 0;
}
