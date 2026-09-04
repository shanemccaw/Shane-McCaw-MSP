// #1907 — real committed coverage for #1869's pure config-resource coverage
// classifier. Ported from the ad-hoc in-session run #1869 did against the
// worktree source (12 cases, including the no_executor-wins-first precedence
// rule) into a real regression guard, now that lib/db has somewhere to put one.
import { describe, expect, it } from "vitest";
import {
  CONFIG_READ_TRANSPORTS,
  EXECUTOR_BACKED_TRANSPORTS,
  coverageStateFor,
  transportHasExecutor,
} from "./config-state";

describe("transportHasExecutor", () => {
  it("is true for every transport this platform actually has an executor for", () => {
    for (const transport of EXECUTOR_BACKED_TRANSPORTS) {
      expect(transportHasExecutor(transport)).toBe(true);
    }
  });

  it("is false for 'unknown' — a declared transport with no executor", () => {
    expect(transportHasExecutor("unknown")).toBe(false);
  });

  it("is false for null/undefined — no transport recorded at all", () => {
    expect(transportHasExecutor(null)).toBe(false);
    expect(transportHasExecutor(undefined)).toBe(false);
  });

  it("is false for a string that is not a declared transport at all", () => {
    expect(transportHasExecutor("carrier-pigeon")).toBe(false);
  });

  it("never claims coverage for a transport not in the declared vocabulary", () => {
    // Every executor-backed transport must itself be a declared read transport —
    // guards EXECUTOR_BACKED_TRANSPORTS from silently drifting off CONFIG_READ_TRANSPORTS.
    for (const transport of EXECUTOR_BACKED_TRANSPORTS) {
      expect(CONFIG_READ_TRANSPORTS).toContain(transport);
    }
  });
});

describe("coverageStateFor", () => {
  it("is 'no_executor' for a transport with no executor, regardless of check count", () => {
    expect(coverageStateFor("unknown", 0)).toBe("no_executor");
    // The precedence rule #1869 exists to enforce: no_executor wins even when
    // checkCoverageCount is non-zero (stale/mismapped coverage data should never
    // present as reachable when the transport itself cannot be dispatched).
    expect(coverageStateFor("unknown", 5)).toBe("no_executor");
  });

  it("is 'no_executor' for a null/undefined transport", () => {
    expect(coverageStateFor(null, 0)).toBe("no_executor");
    expect(coverageStateFor(undefined, 3)).toBe("no_executor");
  });

  it("is 'uncovered' for an executor-backed transport with zero mapped checks", () => {
    for (const transport of EXECUTOR_BACKED_TRANSPORTS) {
      expect(coverageStateFor(transport, 0)).toBe("uncovered");
    }
  });

  it("is 'covered' for an executor-backed transport with at least one mapped check", () => {
    for (const transport of EXECUTOR_BACKED_TRANSPORTS) {
      expect(coverageStateFor(transport, 1)).toBe("covered");
      expect(coverageStateFor(transport, 42)).toBe("covered");
    }
  });
});
