/**
 * PROVENANCE — the hard-delete bypass gate (Git #1947, EPIC #1944 part 1).
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * THE OPEN QUESTION #1947 ASKED, AND THE ANSWER THE CODE ACTUALLY SUPPORTS
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * #1947: *"Establish whether that exact enum generalizes across record types, or
 * whether each record class needs its own provenance column following the same
 * pattern."*
 *
 * **The AXIS generalizes. The ENUM does not.** Each record class needs its own
 * provenance column, following #1556's pattern; the platform normalizes those into
 * the single binary the bypass gate needs, here, in one place.
 *
 * The evidence is in the schema already, and it is not close:
 *
 * | Record class            | Column           | Real vocabulary                              |
 * |-------------------------|------------------|----------------------------------------------|
 * | `msp_sop_runs` (#1556)  | `origin`         | `policy \| lifecycle \| remediation \| manual`  |
 * | `config_resources`      | `origin`         | `graph-metadata \| m365dsc \| both`            |
 * | `msp_diagnostic_findings`| `finding_source`| `baseline \| policy`                          |
 * | `msp_change_requests`   | `source_kind`    | `microsoft_change`                            |
 * | `m365_roadmap_items`    | `source_kind`    | `roadmap \| message_center \| manual`          |
 * | `msp_risk_decisions`    | — (FK edges)     | `spawned_by_change_request_id`,               |
 * |                         |                  | `spawned_by_remediation_step_id`              |
 *
 * Three observations settle it:
 *
 * 1. **`config_resources.origin` already uses the identical column name for a
 *    completely different axis** — which discovery transport produced the row, not
 *    what created the record. Declaring `origin: policy | lifecycle | remediation |
 *    manual` to be "the platform provenance enum" would put two unrelated
 *    vocabularies behind one name, which is precisely the duplicate-authority problem
 *    #1759 had to undo.
 *
 * 2. **#1556's four values are meaningless for most record classes.** A status report
 *    is not `lifecycle`-origin; a config resource is not `remediation`-origin. Forcing
 *    them onto a shared enum would mean writing a value that maps onto nothing — the
 *    fabrication this project's standing rules forbid. `msp_diagnostic_findings` and
 *    `msp_change_requests` demonstrate the point: both already carry a provenance
 *    column, and neither vocabulary overlaps #1556's beyond the word `policy`.
 *
 * 3. **`msp_risk_decisions` has no provenance column at all** — its provenance is a
 *    pair of nullable FKs. A shared enum column could not have been backfilled onto
 *    it truthfully anyway; the FK is the real record of what spawned it, and the
 *    resolver below is how that becomes an answer to "manual or not".
 *
 * So the platform does **not** get a shared provenance enum. It gets this: a registry
 * of per-record-type resolvers, each one reading its own class's own real column (or
 * FK), all producing the one binary the gate actually consumes.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHY THE BINARY, AND NOT THE VOCABULARY, IS WHAT THE GATE NEEDS
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * #1944 part 1 gates the hard-delete bypass on manual origin: *"A record generated
 * from a finding, a scan, a drift event, a policy evaluation or any other system path
 * is evidence, and evidence does not get a bypass checkbox — the box should not
 * render, rather than rendering and refusing."*
 *
 * The gate never asks "was this a remediation or a lifecycle run". It asks one
 * question: **did a human create this by hand?** Every vocabulary above can answer
 * that about itself. None of them needs to agree with the others to do it.
 *
 * The raw value is still recorded verbatim on `record_deletions.record_origin`, so
 * the account of a deletion says what the record's own table actually said, not a
 * lossy re-encoding of it.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * SCOPE
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * #1947 is the mechanism only — *"each module's real edges are that module's
 * responsibility to register against it"*, and the same applies here. **This registry
 * ships empty.** A consuming module registers its own class in its own issue:
 *
 * ```ts
 * // in the SOP module's own wiring, under its own issue:
 * registerOriginResolver({
 *   recordType: "msp_sop_runs",
 *   column: "origin",
 *   // #1556's vocabulary: only a hand-started run is a mistake-create.
 *   isManual: (raw) => raw === "manual",
 * });
 * ```
 *
 * An unregistered record type resolves to NOT manual, so the bypass is simply not
 * offered. That is the correct failure direction: an unknown provenance may be
 * evidence, and the cost of being wrong is an irreversible hard delete of it.
 *
 * Like `clock.ts` and `reference-guard.ts`, this module imports neither the database
 * nor the platform logger (whose sink writes to `platform_log_stream` and therefore
 * opens a pool), so the gate's rules are testable as pure functions.
 */

/**
 * How one record class answers "was this created by hand?".
 *
 * `column` is documentation, not machinery — it records WHICH of the class's own
 * columns the resolver reads, so a later reader can find the vocabulary without
 * grepping. The resolver itself is handed the already-loaded raw value.
 */
export interface OriginResolver {
  /** The retained-record registry key, conventionally the real table name. */
  recordType: string;
  /**
   * The record class's own provenance column, for documentation. `null` where the
   * class expresses provenance as FK edges instead (e.g. `msp_risk_decisions`), in
   * which case the caller passes whatever it derived from those edges as `raw`.
   */
  column: string | null;
  /** This class's own vocabulary, verbatim, where it has a declared one. */
  vocabulary?: readonly string[];
  /** The one question the bypass gate asks. */
  isManual: (raw: string | null) => boolean;
}

const resolvers = new Map<string, OriginResolver>();

/**
 * Register a record class's provenance resolver. Throws on a duplicate registration
 * rather than overwriting: two modules disagreeing about what counts as manual origin
 * for the same class would decide, silently and by import order, whether a record is
 * eligible for irreversible deletion.
 */
export function registerOriginResolver(resolver: OriginResolver): void {
  const existing = resolvers.get(resolver.recordType);
  if (existing) {
    throw new Error(
      `registerOriginResolver: "${resolver.recordType}" already has an origin resolver. ` +
        "Two resolvers for one record class would decide bypass eligibility by import order.",
    );
  }
  resolvers.set(resolver.recordType, resolver);
}

export function getOriginResolver(recordType: string): OriginResolver | undefined {
  return resolvers.get(recordType);
}

export function listOriginResolvers(): OriginResolver[] {
  return [...resolvers.values()];
}

/** Test-only. Never call this from application code. */
export function __resetOriginResolversForTest(): void {
  resolvers.clear();
}

/**
 * Resolve a record's raw provenance value into the bypass gate's binary.
 *
 * Returns `false` — not manual, therefore not bypass-eligible — for an unregistered
 * record type or a null raw value. The safe reading of an unresolvable provenance is
 * "this might be evidence", and the bypass it gates is irreversible.
 */
export function isManualOrigin(recordType: string, rawOrigin: string | null): boolean {
  const resolver = resolvers.get(recordType);
  // No resolver → not manual → no bypass offered. Silent on purpose: this is the
  // designed answer for an unregistered class, not an anomaly worth a log line on
  // every read.
  if (!resolver) return false;
  return resolver.isManual(rawOrigin);
}

/**
 * Whether the hard-delete bypass checkbox should RENDER for this record.
 *
 * #1944 part 1 is specific that the control should not appear rather than appear and
 * refuse, so this is the question a surface asks — separately from
 * `assertDeleteAllowed()`, which asks whether any delete is possible at all.
 *
 * **The two gates are independent and both must pass** (#1944, the referential-guard
 * comment): *"Provenance decides whether the bypass is offered; references decide
 * whether any delete is possible at all."* A manual-origin record with an open
 * dependant is still undeletable, and this function deliberately does not know that —
 * conflating them would let a provenance check answer a referential question.
 */
export function isHardDeleteBypassEligible(recordType: string, rawOrigin: string | null): boolean {
  return isManualOrigin(recordType, rawOrigin);
}
