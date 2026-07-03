/**
 * kanban-auto-fire-retry-budget.test.ts
 *
 * Unit tests for the Kanban auto-fire retry-budget logic.
 *
 * Imports only kanban-auto-fire-retry-utils.ts, which contains pure functions
 * with zero dependencies — no DB, no Azure, no mocking required.
 *
 * Validates that:
 *  1. computeNextFailureState increments the failure count correctly.
 *  2. The exhausted flag becomes true exactly at MAX_AUTO_FIRE_FAILURES.
 *  3. completionStatus is "auto_fire_failed" for retryable failures and
 *     "auto_fire_exhausted" for budget-exhausted failures.
 *  4. Beyond the budget limit the state remains "exhausted" (not reset).
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test
 *   node --experimental-strip-types --test \
 *        'src/lib/kanban-auto-fire-retry-budget.test.ts'
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Direct import — no mocks needed; these are pure functions with no side effects.
import {
  computeNextFailureState,
  MAX_AUTO_FIRE_FAILURES,
} from "./kanban-auto-fire-retry-utils.ts";

// =============================================================================
// Attempt 1 — first failure, budget not yet exhausted
// =============================================================================

describe("computeNextFailureState — attempt 1 (count was 0)", () => {
  const result = computeNextFailureState(0);

  it("increments newCount to 1", () => {
    assert.equal(result.newCount, 1);
  });

  it("is NOT exhausted", () => {
    assert.equal(result.exhausted, false);
  });

  it("sets completionStatus to auto_fire_failed (card stays retryable)", () => {
    assert.equal(result.completionStatus, "auto_fire_failed");
  });
});

// =============================================================================
// Attempt 2 — second failure, still within budget
// =============================================================================

describe("computeNextFailureState — attempt 2 (count was 1)", () => {
  const result = computeNextFailureState(1);

  it("increments newCount to 2", () => {
    assert.equal(result.newCount, 2);
  });

  it("is NOT exhausted (budget is MAX_AUTO_FIRE_FAILURES = " + MAX_AUTO_FIRE_FAILURES + ")", () => {
    assert.equal(result.exhausted, false);
  });

  it("sets completionStatus to auto_fire_failed", () => {
    assert.equal(result.completionStatus, "auto_fire_failed");
  });
});

// =============================================================================
// Budget boundary — final attempt that exhausts the retry budget
// =============================================================================

describe(`computeNextFailureState — attempt ${MAX_AUTO_FIRE_FAILURES} (budget exhausted)`, () => {
  const result = computeNextFailureState(MAX_AUTO_FIRE_FAILURES - 1);

  it(`increments newCount to ${MAX_AUTO_FIRE_FAILURES}`, () => {
    assert.equal(result.newCount, MAX_AUTO_FIRE_FAILURES);
  });

  it("IS exhausted (reached the budget limit)", () => {
    assert.equal(result.exhausted, true);
  });

  it("sets completionStatus to auto_fire_exhausted (card must NOT be auto-fired again)", () => {
    assert.equal(result.completionStatus, "auto_fire_exhausted");
  });
});

// =============================================================================
// Beyond budget — count already at or above limit
// Ensures the exhausted state is stable and not reset by further failures.
// =============================================================================

describe("computeNextFailureState — beyond budget (count already at limit)", () => {
  const result = computeNextFailureState(MAX_AUTO_FIRE_FAILURES);

  it("increments newCount beyond the limit", () => {
    assert.equal(result.newCount, MAX_AUTO_FIRE_FAILURES + 1);
  });

  it("remains exhausted", () => {
    assert.equal(result.exhausted, true);
  });

  it("keeps completionStatus as auto_fire_exhausted", () => {
    assert.equal(result.completionStatus, "auto_fire_exhausted");
  });
});

// =============================================================================
// All counts from 0 → MAX+2 produce monotonically increasing newCount
// and the exhaustion boundary is exactly at MAX_AUTO_FIRE_FAILURES.
// =============================================================================

describe("computeNextFailureState — exhaustion boundary is exactly at MAX_AUTO_FIRE_FAILURES", () => {
  it("counts 0 to MAX-1 are all non-exhausted", () => {
    for (let i = 0; i < MAX_AUTO_FIRE_FAILURES - 1; i++) {
      const { exhausted } = computeNextFailureState(i);
      assert.equal(exhausted, false, `count ${i} → newCount ${i + 1} should not be exhausted`);
    }
  });

  it(`count ${MAX_AUTO_FIRE_FAILURES - 1} transitions to exhausted (newCount = MAX)`, () => {
    const { exhausted, newCount } = computeNextFailureState(MAX_AUTO_FIRE_FAILURES - 1);
    assert.equal(newCount, MAX_AUTO_FIRE_FAILURES);
    assert.equal(exhausted, true);
  });

  it("counts at or beyond MAX all produce exhausted=true", () => {
    for (let i = MAX_AUTO_FIRE_FAILURES; i <= MAX_AUTO_FIRE_FAILURES + 5; i++) {
      const { exhausted } = computeNextFailureState(i);
      assert.equal(exhausted, true, `count ${i} should already be exhausted`);
    }
  });
});
