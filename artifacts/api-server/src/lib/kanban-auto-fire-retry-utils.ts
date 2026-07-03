/**
 * kanban-auto-fire-retry-utils.ts
 *
 * Pure functions and constants for the Kanban auto-fire retry budget.
 * Extracted so they can be unit-tested without mocking any DB / Azure / HTTP
 * dependencies.  Imported by kanban-auto-fire.ts for production use and
 * directly by kanban-auto-fire-retry-budget.test.ts for tests.
 */

/**
 * Maximum consecutive Azure job failures before a card is permanently flagged
 * for manual review (completionStatus = "auto_fire_exhausted").
 */
export const MAX_AUTO_FIRE_FAILURES = 3;

/**
 * Given the current consecutive-failure count stored in a card's metadata,
 * returns:
 *   - newCount       — the incremented count to persist
 *   - exhausted      — true when the budget is now spent
 *   - completionStatus — the DB value to write (for type-safety, callers use this)
 *
 * Pure: no side effects, no I/O.
 */
export function computeNextFailureState(currentCount: number): {
  newCount: number;
  exhausted: boolean;
  completionStatus: "auto_fire_failed" | "auto_fire_exhausted";
} {
  const newCount = currentCount + 1;
  const exhausted = newCount >= MAX_AUTO_FIRE_FAILURES;
  return {
    newCount,
    exhausted,
    completionStatus: exhausted ? "auto_fire_exhausted" : "auto_fire_failed",
  };
}
