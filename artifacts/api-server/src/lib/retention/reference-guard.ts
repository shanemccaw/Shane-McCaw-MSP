/**
 * THE REFERENTIAL DELETE GUARD (Git #1947, EPIC #1944's H answer).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The rule
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * *"A record with unsatisfied upstream references cannot be deleted. The delete is
 * refused, not queued and not held."*
 *
 * This replaced the legal-hold concept outright. A hold suspends a clock that is
 * already running, which means the delete already happened and something is now
 * fighting to keep the record alive. Refusing at the point of request means the clock
 * never starts: no suspended-purge state, no hold to remember to release, no race
 * between a hold expiring and a purge firing.
 *
 * Three things the epic is explicit about, all of which are mechanism-level and
 * therefore live here rather than in a consuming module:
 *
 * 1. **The refusal names what is blocking it.** *"'This risk cannot be deleted: POA&M
 *    #1234 is open against it' is actionable; 'cannot delete' is a dead end and the
 *    customer will assume the product is broken."* `DeleteRefusedError.message` is
 *    built from the real blockers, and the whole chain is carried on the error — the
 *    UI shows the chain, not just the first blocker.
 *
 * 2. **A soft-deleted upstream item still blocks** (part 5, confirmed). A POA&M inside
 *    its 90-day soft window is recoverable, therefore unresolved. Only a *purged* or
 *    *genuinely closed* item stops blocking. Without this, deleting a POA&M and then
 *    its risk defeats the guard in two clicks — so `blockerStillBlocks()` below is the
 *    platform's answer to it and edges are told, in the type, not to filter
 *    soft-deleted rows out of their own query.
 *
 * 3. **The bypass does not bypass this.** *"A record that other records already depend
 *    on is not a mistake-create, whatever its origin. Provenance decides whether the
 *    bypass is offered; references decide whether any delete is possible at all. The
 *    two gates are independent and both must pass."* This module knows nothing about
 *    provenance, and `origin-registry.ts` knows nothing about references, on purpose.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Scope: the registry ships EMPTY
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * #1947: *"This issue establishes the guard mechanism generically; each module's real
 * edges are that module's responsibility to register against it."*
 *
 * That is load-bearing rather than merely tidy. The guard is only as good as the edges
 * being real, and #1944 names the reason: `msp_change_requests.linked_finding` is a
 * nullable free-text string, and *"a referential-integrity delete guard built on
 * free-text links is not a guard."* #1505 is the issue that replaces those with actual
 * foreign keys. Registering a guessed edge here, against a link that is not real yet,
 * would produce a guard that reports confidently and blocks nothing — worse than no
 * guard, because it would be trusted.
 *
 * This module imports neither the database nor the platform logger — the logger's own
 * sink writes to `platform_log_stream`, so importing it would open a connection pool
 * and make the guard's rules untestable without one. Logging and the audit write for a
 * refusal both live in `lifecycle.ts`, which is database-bound anyway;
 * `checkDeleteAllowed` reports an edge failure through the `onEdgeError` callback
 * instead of swallowing it.
 */

/** One real, unresolved reference that is preventing a delete. */
export interface DeleteBlocker {
  /** The edge that found it, for tracing which rule fired. */
  edgeId: string;
  /** The blocking record's own registry key / table name. */
  recordType: string;
  recordId: string;
  /** How the blocker should be named to a human, e.g. `"POA&M #1234"`. */
  label: string;
  /**
   * The blocker's own state, verbatim from its own table — `"open"`, `"in_progress"`,
   * `"soft-deleted"`. Real values only: an edge reports the state it read, never a
   * normalized one this module invented.
   */
  state: string;
  /**
   * The clause that completes the refusal sentence, e.g. `"is open against it"`. The
   * edge writes it because only the edge knows what the relationship means.
   */
  becauseClause: string;
}

/**
 * A registered blocking relationship: given a record about to be deleted, find the
 * records that still depend on it.
 *
 * **`findBlockers` must NOT exclude soft-deleted rows from its own query.** A
 * soft-deleted dependant is recoverable and therefore unresolved, and it still blocks
 * (part 5). Use `blockerStillBlocks()` to decide, rather than a `deleted_at IS NULL`
 * filter, which would silently implement the two-click defeat the epic calls out.
 */
export interface ReferenceEdge {
  /** Stable, unique id for this rule. */
  id: string;
  /** The record type this edge protects from deletion. */
  protects: string;
  /** The record type that does the blocking, for documentation and for the UI's chain view. */
  blockerType: string;
  /** One line saying what the relationship is, for anyone reading the registry later. */
  description: string;
  findBlockers: (target: DeleteGuardTarget) => Promise<DeleteBlocker[]>;
}

export interface DeleteGuardTarget {
  recordType: string;
  recordId: string;
  /** The customer that owns the record, so an edge can scope its own query. */
  tenantId: number;
  mspId: number;
  /** How the record should be named in the refusal message. */
  label?: string | null;
}

const edges = new Map<string, ReferenceEdge[]>();
const edgeIds = new Set<string>();

/**
 * Register a blocking edge. Duplicate ids throw: two edges sharing an id would make
 * the `edgeId` on a blocker ambiguous, and the blocker is what the refusal message and
 * the audit record are built from.
 */
export function registerReferenceEdge(edge: ReferenceEdge): void {
  if (edgeIds.has(edge.id)) {
    throw new Error(`registerReferenceEdge: duplicate edge id "${edge.id}"`);
  }
  edgeIds.add(edge.id);
  const list = edges.get(edge.protects) ?? [];
  list.push(edge);
  edges.set(edge.protects, list);
}

export function listReferenceEdges(recordType?: string): ReferenceEdge[] {
  if (recordType) return [...(edges.get(recordType) ?? [])];
  return [...edges.values()].flat();
}

/** Test-only. Never call this from application code. */
export function __resetReferenceEdgesForTest(): void {
  edges.clear();
  edgeIds.clear();
}

/**
 * Does a dependant in this state still block? The platform's single answer to part 5's
 * confirmed rule, so no module has to re-derive it.
 *
 * Only two things stop a dependant blocking:
 *   - it was **purged** — the record genuinely no longer exists; or
 *   - it is **genuinely closed** — resolved on its own terms, which only its own
 *     module can judge, so the caller passes that verdict in.
 *
 * A soft-deleted or ghosted dependant blocks. It is recoverable, so it is unresolved.
 */
export function blockerStillBlocks(input: {
  /** The dependant's record has actually been destroyed. */
  purged: boolean;
  /** The dependant reached a genuine terminal state of its own — closed, completed, cancelled. */
  closed: boolean;
  /** The dependant is soft-deleted (any stage before purge). Does NOT stop it blocking. */
  softDeleted?: boolean;
}): boolean {
  if (input.purged) return false;
  if (input.closed) return false;
  return true;
}

export interface DeleteGuardResult {
  allowed: boolean;
  blockers: DeleteBlocker[];
  /** Names every blocker. Null when the delete is allowed. */
  message: string | null;
}

/**
 * Build the refusal sentence. Names the record and every blocker, because the UI shows
 * the blocking chain and a message listing only the first one would make a two-blocker
 * record look like a one-fix problem.
 */
export function formatRefusal(target: DeleteGuardTarget, blockers: DeleteBlocker[]): string {
  const subject = target.label?.trim() ? `"${target.label.trim()}"` : `${target.recordType} ${target.recordId}`;
  const clauses = blockers.map((b) => `${b.label} ${b.becauseClause}`);
  return `${subject} cannot be deleted: ${clauses.join("; ")}.`;
}

/** Thrown by `assertDeleteAllowed`. Carries the whole chain, not just the message. */
export class DeleteRefusedError extends Error {
  readonly blockers: DeleteBlocker[];
  readonly target: DeleteGuardTarget;
  /** For a route handler: this is a 409, not a 500 and not a 403. */
  readonly httpStatus = 409;

  constructor(target: DeleteGuardTarget, blockers: DeleteBlocker[]) {
    super(formatRefusal(target, blockers));
    this.name = "DeleteRefusedError";
    this.target = target;
    this.blockers = blockers;
  }
}

/**
 * Run every registered edge for this record type and report whether the delete may
 * proceed.
 *
 * A record type with no registered edges is allowed through. That is honest rather
 * than permissive: the guard blocks on the edges that are real, and #1944 is explicit
 * that a guard built on links that are not real yet is not a guard. What it must never
 * do is claim to have checked something it has not, so the empty case is logged.
 *
 * An edge that throws is **treated as blocking**, not as passing. A delete is
 * irreversible at the end of its clock and a failed dependency check is not evidence
 * that there are no dependants. The failure is surfaced through `onEdgeError` so the
 * caller can log it, rather than being swallowed here.
 */
export async function checkDeleteAllowed(
  target: DeleteGuardTarget,
  options?: { onEdgeError?: (edge: ReferenceEdge, err: unknown) => void },
): Promise<DeleteGuardResult> {
  const applicable = edges.get(target.recordType) ?? [];
  if (applicable.length === 0) {
    return { allowed: true, blockers: [], message: null };
  }

  const blockers: DeleteBlocker[] = [];
  for (const edge of applicable) {
    try {
      blockers.push(...(await edge.findBlockers(target)));
    } catch (err) {
      options?.onEdgeError?.(edge, err);
      blockers.push({
        edgeId: edge.id,
        recordType: edge.blockerType,
        recordId: "",
        label: `the ${edge.blockerType} dependency check`,
        state: "check_failed",
        becauseClause: "could not be completed, so this delete cannot be confirmed safe",
      });
    }
  }

  if (blockers.length === 0) return { allowed: true, blockers: [], message: null };
  return { allowed: false, blockers, message: formatRefusal(target, blockers) };
}
