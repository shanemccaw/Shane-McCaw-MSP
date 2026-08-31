/**
 * rbd-scope-diff.ts — the #1510 derivation itself, kept dependency-free from
 * `@workspace/db` on purpose so it is trivially unit-testable and so
 * `rbd-versioning.ts` (which does the DB orchestration around it) has a single
 * place to import the pure logic from.
 *
 * ── Signature required on scope expansion, never on contraction ───────────────
 *
 * Settled architecture (#1487, #1510): nobody consents to being safer.
 *   - Additions present in the instance set => a fresh signature is required.
 *   - Subtractions only (or no change at all) => the version being superseded's
 *     OWN signature is inherited onto the new version automatically; a version
 *     row is still recorded either way.
 *
 * The distinction is DERIVED by `computeRbdScopeDiff`, comparing instance-id
 * SETS between the new version and the one it supersedes — never a flag a
 * caller sets, so it cannot be gamed. `rbd-versioning.ts`'s `createRbdVersion`
 * requires its caller to derive the scope from the live `risk_instances` table
 * (never from client-supplied JSON) for the same reason.
 *
 * This is also the mechanism that makes "a new instance is never silently
 * absorbed under an old signature" true BY CONSTRUCTION, not by a separate
 * check: any id present in `nextScope` that was not in `previousScope` is an
 * addition, and any addition forces `requiresSignature: true` — so a version
 * carrying a new, not-yet-covered instance can never auto-inherit a prior
 * signature no matter how it is captured.
 *
 * ── The deliberately-undecided case: narrative-only drift ─────────────────────
 *
 * A narrative-only revision (hazard text, compensating controls, residual
 * score) with the instance set untouched requires no signature by the letter of
 * this rule — deliberately not changed here (see the issue's own text: "a
 * residual score could move under a signature given when it read differently").
 * `diffNarrativeSnapshot` is the interim answer: `rbd-versioning.ts` records
 * every such change as an `msp_rbd_narrative_audit` row, catchable without
 * gating capture on it or requiring a signature for it.
 */

/** The narrative/score fields #1510's audit trail watches — see
 * `RbdNarrativeSnapshot` (`@workspace/db`) for the full shape this is a subset
 * view of. */
export const NARRATIVE_AUDIT_FIELDS = ["hazardDescription", "compensatingControls", "residualRiskScore", "residualRiskLevel"] as const;

export interface NarrativeSnapshotLike {
  hazardDescription: unknown;
  compensatingControls: unknown;
  residualRiskScore: unknown;
  residualRiskLevel: unknown;
}

export interface RbdVersionScopeDiff {
  /** Instance ids present in the new scope but not the one it supersedes. */
  added: number[];
  /** Instance ids present in the superseded scope but not the new one. */
  removed: number[];
  /** true = a fresh signature is required for this version; false = the
   * superseded version's own signature may be inherited onto it. */
  requiresSignature: boolean;
}

/**
 * #1510's own derivation — the ONE place "does this scope change need a fresh
 * signature" is decided, so it cannot be judged by a human or gamed by a caller.
 * `previousScope` is `null` for the very first version ever captured for a
 * container: nothing exists yet to inherit from, so it always requires a
 * signature (every id in `nextScope` reads as an "addition" against nothing).
 */
export function computeRbdScopeDiff(previousScope: number[] | null, nextScope: number[]): RbdVersionScopeDiff {
  const prevSet = new Set(previousScope ?? []);
  const nextSet = new Set(nextScope);
  const added = [...nextSet].filter((id) => !prevSet.has(id));
  const removed = [...prevSet].filter((id) => !nextSet.has(id));
  return { added, removed, requiresSignature: previousScope === null || added.length > 0 };
}

export interface RbdNarrativeFieldChange {
  field: (typeof NARRATIVE_AUDIT_FIELDS)[number];
  previousValue: unknown;
  newValue: unknown;
}

/** Compares two narrative/score snapshots field-by-field, returning only the
 * fields that actually changed. `previous === null` (the first version ever
 * captured) always yields no changes — there is nothing to have drifted from. */
export function diffNarrativeSnapshot<T extends NarrativeSnapshotLike>(
  previous: T | null,
  next: T,
): RbdNarrativeFieldChange[] {
  if (!previous) return [];
  const changes: RbdNarrativeFieldChange[] = [];
  for (const field of NARRATIVE_AUDIT_FIELDS) {
    const previousValue = previous[field];
    const newValue = next[field];
    if (JSON.stringify(previousValue) !== JSON.stringify(newValue)) {
      changes.push({ field, previousValue, newValue });
    }
  }
  return changes;
}
