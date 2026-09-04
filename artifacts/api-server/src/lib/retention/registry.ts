/**
 * THE RETAINED-RECORD REGISTRY (Git #1947, EPIC #1944).
 *
 * The lifecycle in `lifecycle.ts` is generic over record type: it writes the
 * `record_deletions` ledger row, runs the clock, and drives the stage transitions
 * identically for a risk decision, a POA&M and a status report. The three things it
 * cannot do generically are touch the record's OWN row — mark it deleted, unmark it on
 * restore, and destroy it at T-0.
 *
 * A module supplies those four small functions once, in its own issue, and gets the
 * whole lifecycle. That is what stops the four-modules-four-mechanisms drift #1944 was
 * filed to end.
 *
 * **This registry ships empty** — #1947 is the mechanism, and per-module wiring is
 * each consuming module's own issue.
 *
 * ```ts
 * // in the risk module's own wiring, under its own issue:
 * registerRetainedRecordType({
 *   recordType: "msp_risk_decisions",
 *   displayName: "Risk decision",
 *   load: async (id) => { ... },
 *   markDeleted: async (tx, id, mark) => { ... },
 *   clearDeleted: async (tx, id) => { ... },
 *   hardDelete: async (tx, id) => { ... },
 * });
 * ```
 */

import type { db } from "@workspace/db";

/**
 * A drizzle transaction handle. Typed off the real `db.transaction` callback rather
 * than restated, so it cannot drift from the driver's actual type.
 */
export type RetentionTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** What the lifecycle needs to know about a record before it can delete it. */
export interface RetainedRecordSnapshot {
  recordId: string;
  /** `tenants.id` — the customer whose retention policy governs this record's clock. */
  tenantId: number;
  mspId: number;
  /** How the record reads to a human, captured now so it survives the purge. */
  label: string | null;
  /**
   * The record's own provenance value, verbatim from its own column — `"manual"`,
   * `"baseline"`, `"microsoft_change"`. Null for a class that has no provenance column
   * (see `origin-registry.ts` for why there is deliberately no shared enum). The
   * bypass gate's binary is derived from this, not stored in place of it.
   */
  rawOrigin: string | null;
  /** True if the record is already soft-deleted, so a double-delete can be refused. */
  alreadyDeleted: boolean;
}

/** The soft-delete triple, as written onto the record's own row. */
export interface SoftDeleteMark {
  deletedAt: Date;
  deletedBy: string;
  deleteReason: string;
}

export interface RetainedRecordType {
  /** Registry key — conventionally the record's real table name. */
  recordType: string;
  /** How the class is named to a human, e.g. `"Risk decision"`. */
  displayName: string;
  /** Read the record's retention identity. Returns null when the record does not exist. */
  load: (recordId: string) => Promise<RetainedRecordSnapshot | null>;
  /** Write the `softDeleteColumns()` triple onto the record's own row, inside the given transaction. */
  markDeleted: (tx: RetentionTx, recordId: string, mark: SoftDeleteMark) => Promise<void>;
  /** Clear the triple on restore, inside the given transaction. */
  clearDeleted: (tx: RetentionTx, recordId: string) => Promise<void>;
  /**
   * Destroy the row at T-0, inside the given transaction. The `record_deletions` row
   * is NOT destroyed with it — #1944 part 2: the account of what happened survives the
   * record it describes.
   */
  hardDelete: (tx: RetentionTx, recordId: string) => Promise<void>;
}

const types = new Map<string, RetainedRecordType>();

/**
 * Register a record class with the retention lifecycle. Throws on a duplicate: two
 * registrations for one class would decide, by import order, which module's
 * `hardDelete` actually runs at T-0.
 */
export function registerRetainedRecordType(type: RetainedRecordType): void {
  if (types.has(type.recordType)) {
    throw new Error(
      `registerRetainedRecordType: "${type.recordType}" is already registered. ` +
        "Two registrations for one record class would decide by import order which hardDelete runs at T-0.",
    );
  }
  types.set(type.recordType, type);
}

export function getRetainedRecordType(recordType: string): RetainedRecordType | undefined {
  return types.get(recordType);
}

/**
 * The registered class, or a thrown error naming what is missing. The sweep calls this
 * before purging: a record type the platform cannot destroy must fail loudly rather
 * than have its ledger row quietly marked purged while the row itself survives.
 */
export function requireRetainedRecordType(recordType: string): RetainedRecordType {
  const type = types.get(recordType);
  if (!type) {
    throw new Error(
      `retention: no retained-record type registered for "${recordType}". ` +
        "Register it with registerRetainedRecordType() in that module's own wiring.",
    );
  }
  return type;
}

export function listRetainedRecordTypes(): RetainedRecordType[] {
  return [...types.values()];
}

/** Test-only. Never call this from application code. */
export function __resetRetainedRecordTypesForTest(): void {
  types.clear();
}
