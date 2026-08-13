/**
 * simulatorResponseView.test.ts
 *
 * Regression coverage for the "Full Response flash-to-empty" bug: a completed
 * run whose mapped `result` looks like real data, immediately followed by a
 * GET .../items response that is a genuine empty array. Before the fix, the
 * Response panel's `value` prop fell back to `run.result` while the raw fetch
 * was in flight, then silently swapped to the empty array once it resolved —
 * with nothing telling the operator whether that was a real capture or a
 * failure. Run with: pnpm --filter @workspace/admin-panel run test (vitest)
 */

import { describe, it, expect } from "vitest";
import { resolveResponseValue, resolveResponseEmptyLabel, isGenuineEmptyRawCapture } from "./simulatorResponseView";

// A mapped/extracted summary that LOOKS like real data even though it was
// computed from zero raw items — exactly what applyMapping() (monitor-executor.ts)
// always produces: counts default to 0, booleans default to false, but the
// object itself is never empty.
const REAL_LOOKING_SUMMARY = { mfaRegisteredCount: 0, hasGaps: false, _itemCount: 0 };

describe("resolveResponseValue — the exact race", () => {
  it("shows the mapped summary while the run is completing and no raw fetch has started", () => {
    const value = resolveResponseValue({
      viewingRaw: false,
      rawItemsLoaded: false,
      rawItems: null,
      runResult: REAL_LOOKING_SUMMARY,
    });
    expect(value).toBe(REAL_LOOKING_SUMMARY);
  });

  it("does NOT fall back to the mapped summary once the raw view is active and the fetch is still in flight", () => {
    // This is the moment the old code showed run.result — the "flash".
    const value = resolveResponseValue({
      viewingRaw: true,
      rawItemsLoaded: false,
      rawItems: null,
      runResult: REAL_LOOKING_SUMMARY,
    });
    expect(value).toBeUndefined();
  });

  it("shows the true empty array once the raw fetch resolves with a genuine empty capture — not the summary", () => {
    const value = resolveResponseValue({
      viewingRaw: true,
      rawItemsLoaded: true,
      rawItems: [],
      runResult: REAL_LOOKING_SUMMARY,
    });
    // Real, verifiable outcome: [] is shown honestly, never silently replaced
    // by (or coalesced with) the unrelated mapped summary.
    expect(value).toEqual([]);
    expect(value).not.toBe(REAL_LOOKING_SUMMARY);
  });

  it("shows the real raw items once loaded when the capture was non-empty", () => {
    const items = [{ id: "a" }, { id: "b" }];
    const value = resolveResponseValue({ viewingRaw: true, rawItemsLoaded: true, rawItems: items, runResult: REAL_LOOKING_SUMMARY });
    expect(value).toBe(items);
  });

  it("falls back to the run error, not the summary, once raw view is active with no items and no run result", () => {
    const value = resolveResponseValue({
      viewingRaw: false,
      rawItemsLoaded: false,
      rawItems: null,
      runResult: undefined,
      runError: "socket hang up",
    });
    expect(value).toEqual({ error: "socket hang up" });
  });
});

describe("resolveResponseEmptyLabel", () => {
  it("labels the loading state distinctly while the raw fetch is in flight", () => {
    expect(resolveResponseEmptyLabel({ viewingRaw: true, rawItemsLoaded: false, loadingRawItems: true })).toMatch(/loading/i);
  });

  it("labels a failed raw fetch distinctly from a loading or empty-real state", () => {
    const label = resolveResponseEmptyLabel({
      viewingRaw: true,
      rawItemsLoaded: false,
      loadingRawItems: false,
      rawItemsError: "That run's response was not stored: too large to persist",
    });
    expect(label).toMatch(/failed/i);
  });
});

describe("isGenuineEmptyRawCapture", () => {
  it("is true only once a real empty array has actually loaded", () => {
    expect(isGenuineEmptyRawCapture({ viewingRaw: true, rawItemsLoaded: true, rawItems: [] })).toBe(true);
  });

  it("is false while still loading — an in-flight fetch is not yet a known-empty capture", () => {
    expect(isGenuineEmptyRawCapture({ viewingRaw: true, rawItemsLoaded: false, rawItems: null })).toBe(false);
  });

  it("is false when the capture had real items", () => {
    expect(isGenuineEmptyRawCapture({ viewingRaw: true, rawItemsLoaded: true, rawItems: [{ id: "a" }] })).toBe(false);
  });

  it("is false outside the raw view", () => {
    expect(isGenuineEmptyRawCapture({ viewingRaw: false, rawItemsLoaded: true, rawItems: [] })).toBe(false);
  });
});
