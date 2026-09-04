// #1907 — real committed coverage for #1869's pure config-resource coverage
// classifier. Ported from the ad-hoc in-session run #1869 did against the
// worktree source (12 cases, including the no_executor-wins-first precedence
// rule) into a real regression guard, now that lib/db has somewhere to put one.
import { describe, expect, it } from "vitest";
import {
  CONFIG_READ_TRANSPORTS,
  EXECUTOR_BACKED_TRANSPORTS,
  coverageStateFor,
  isOperationResource,
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

  // #1917 — 7 azure-rm resources sit at billing-account / tenant-root
  // microsoft.aadiam scope, above anything Azure Lighthouse can delegate. The
  // azure-rm executor exists (#1871), but these specific resources are marked
  // `availability = 'unavailable'`, and that must win over an ordinary
  // covered/uncovered check-count verdict.
  it("is 'unavailable' for an executor-backed transport whose resource is marked unavailable, regardless of check count", () => {
    for (const transport of EXECUTOR_BACKED_TRANSPORTS) {
      expect(coverageStateFor(transport, 0, "unavailable")).toBe("unavailable");
      expect(coverageStateFor(transport, 5, "unavailable")).toBe("unavailable");
    }
  });

  it("'no_executor' still wins over 'unavailable' for a transport with no executor at all", () => {
    expect(coverageStateFor("unknown", 0, "unavailable")).toBe("no_executor");
  });

  it("falls through to covered/uncovered when availability is anything other than 'unavailable'", () => {
    for (const transport of EXECUTOR_BACKED_TRANSPORTS) {
      expect(coverageStateFor(transport, 0, "available_now")).toBe("uncovered");
      expect(coverageStateFor(transport, 1, "needs_additional_scope")).toBe("covered");
      expect(coverageStateFor(transport, 0, null)).toBe("uncovered");
      expect(coverageStateFor(transport, 0, undefined)).toBe("uncovered");
    }
  });

  // Git #1929 — a bound Graph Function is an operation, not persistent config
  // state, so it is excluded from the coverage measurement entirely rather
  // than counted as an ordinary gap.
  it("is 'operation' for a function-kind resource, regardless of transport, availability or check count", () => {
    expect(coverageStateFor("graph", 0, null, "function")).toBe("operation");
    expect(coverageStateFor("graph", 5, null, "function")).toBe("operation");
    expect(coverageStateFor("unknown", 0, null, "function")).toBe("operation");
    expect(coverageStateFor("azure-rm", 0, "unavailable", "function")).toBe("operation");
  });

  it("'operation' wins over both 'no_executor' and 'unavailable' — the precedence rule #1929 adds", () => {
    // A function on an unreachable transport, or one whose derived availability
    // happens to read 'unavailable', is still an operation first; reporting it
    // as a transport or permission gap would suggest closing that gap could
    // ever make it "coverable", which is false — it is not config state at all.
    expect(coverageStateFor("unknown", 0, null, "function")).toBe("operation");
    expect(coverageStateFor("azure-rm", 0, "unavailable", "function")).toBe("operation");
  });

  it("is unaffected by a non-function container kind", () => {
    expect(coverageStateFor("graph", 0, null, "entitySet")).toBe("uncovered");
    expect(coverageStateFor("graph", 0, null, "singleton")).toBe("uncovered");
    expect(coverageStateFor("graph", 0, null, "navigation")).toBe("uncovered");
    expect(coverageStateFor("graph", 0, null, null)).toBe("uncovered");
    expect(coverageStateFor("graph", 0, null, undefined)).toBe("uncovered");
  });

  // Git #2821 — a row resolved onto another row is not an independent resource:
  // both extraction pipelines modelled the same real tenant object. It has no
  // coverage question of its own, and counting it as one reported that object
  // twice — once covered, once as a gap no check could ever close.
  it("is 'duplicate' whenever the row resolves onto a canonical resource", () => {
    expect(coverageStateFor("graph", 0, "available_now", "entitySet", 42)).toBe("duplicate");
    expect(coverageStateFor("powershell", 3, "available_now", null, 42)).toBe("duplicate");
  });

  it("'duplicate' wins over 'no_executor' and 'unavailable', but 'operation' wins over it", () => {
    // The duplicate link is a statement about the row's IDENTITY; no_executor and
    // unavailable are statements about THIS row's own reachability, which a
    // duplicate does not independently have. An operation still outranks it: a
    // bound Function is not config state at all, so it can never be some other
    // resource's duplicate in the first place.
    expect(coverageStateFor("unknown", 0, null, null, 42)).toBe("duplicate");
    expect(coverageStateFor("azure-rm", 0, "unavailable", null, 42)).toBe("duplicate");
    expect(coverageStateFor("graph", 0, null, "function", 42)).toBe("operation");
  });

  it("is unaffected when the row IS its own canonical record", () => {
    // Null and undefined both mean "this row is canonical" — undefined is what a
    // caller that predates #2821's column passes, and it must not read as a link.
    expect(coverageStateFor("graph", 0, "available_now", "entitySet", null)).toBe("uncovered");
    expect(coverageStateFor("graph", 1, "available_now", "entitySet", undefined)).toBe("covered");
  });
});

describe("isOperationResource", () => {
  it("is true only for 'function'", () => {
    expect(isOperationResource("function")).toBe(true);
  });

  it("is false for every other container kind, including null/undefined", () => {
    expect(isOperationResource("entitySet")).toBe(false);
    expect(isOperationResource("singleton")).toBe(false);
    expect(isOperationResource("navigation")).toBe(false);
    expect(isOperationResource(null)).toBe(false);
    expect(isOperationResource(undefined)).toBe(false);
  });
});
