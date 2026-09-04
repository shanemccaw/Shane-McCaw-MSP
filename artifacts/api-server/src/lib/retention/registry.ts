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

// ─────────────────────────────────────────────────────────────────────────────
// THE TENANT-DATA PURGER REGISTRY (#2765, #1944 part 7)
// ─────────────────────────────────────────────────────────────────────────────
//
// The registry above is per-RECORD: how one row of one class is marked deleted, unmarked
// on restore, and destroyed at its own T-0. This one is per-TENANT: how a module destroys
// EVERYTHING it holds for a customer, once, when the 7-year post-termination window
// expires and the whole dataset goes.
//
// Two registries rather than one method on the first, because the two do not have the
// same membership. A class can be purgeable-with-the-tenant without ever participating in
// the soft-delete lifecycle (scan results, snapshots, telemetry — nobody soft-deletes an
// individual scan sample, but all of it goes when the customer's window ends), and a
// module that registers one should register the other where both apply.
//
// WHY A REGISTRY AND NOT A LIST OF TABLES. A hardcoded roster of every tenant-scoped table
// is precisely the shape #1944 was filed to end, and this codebase already has the
// evidence: the dev-only customer hard-delete in `admin-active-directory.ts` carries a
// hand-maintained list of ~30 auxiliary tables, several of which its own comments record
// as possibly not existing in a given database because their migrations predate a
// refactor. A list like that silently rots, and a purge that silently misses a table is a
// purge that did not happen. A module declaring its own purge puts that declaration where
// the person adding a table is already looking.
//
// **SHIPS EMPTY**, exactly as the record-type registry does. The sweep treats an empty
// registry as a REFUSAL rather than a completed no-op — see `purgeTerminatedTenant()`.

export interface TenantDataPurger {
  /** Registry key — conventionally the owning module, e.g. `"risk-register"`. */
  key: string;
  /** How this data class reads to a human, for the audit account of the purge. */
  displayName: string;
  /**
   * Destroy every row this module holds for `tenantId`, inside the given transaction.
   * Returns the number of rows destroyed, which is recorded in the audit account — a
   * purge that reports what it actually removed is auditable; one that reports "done" is
   * not.
   *
   * Throwing aborts the whole purge and leaves the tenant due for the next sweep. That is
   * the correct failure mode: a partial purge that got marked complete is unrecoverable,
   * whereas a retried one is merely slower.
   */
  purge: (tx: RetentionTx, tenantId: number) => Promise<number>;
}

const tenantPurgers = new Map<string, TenantDataPurger>();

/**
 * Register a module's whole-tenant purge. Throws on a duplicate for the same reason
 * `registerRetainedRecordType` does: two registrations for one key would decide by import
 * order which one actually runs at the end of a customer's retention window.
 */
export function registerTenantDataPurger(purger: TenantDataPurger): void {
  if (tenantPurgers.has(purger.key)) {
    throw new Error(
      `registerTenantDataPurger: "${purger.key}" is already registered. Two purgers for one key ` +
        "would decide by import order which one actually runs at the end of the retention window.",
    );
  }
  tenantPurgers.set(purger.key, purger);
}

export function listTenantDataPurgers(): TenantDataPurger[] {
  return [...tenantPurgers.values()];
}

/** Test-only. Never call this from application code. */
export function __resetTenantDataPurgersForTest(): void {
  tenantPurgers.clear();
}
