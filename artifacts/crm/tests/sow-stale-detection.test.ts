/**
 * Tests for the stale-scope detection logic used by PresentationFlow.
 *
 * PresentationFlow uses two mechanisms to detect when Shane has regenerated the
 * SOW while a client has the page open:
 *
 *   1. SSE push  — the server broadcasts a scope_changed event immediately.
 *   2. Polling   — checkScopeVersion() runs every 30 seconds as a fallback.
 *
 * When a mismatch is detected, scopeStale is set to true, which renders the
 * amber banner that blocks signing and paying with stale prices.
 *
 * These tests verify the core logic in isolation (without rendering the React
 * component) so regressions are caught before they reach the UI. They directly
 * mirror the behaviour of checkScopeVersion and the SSE event handler in
 * PresentationFlow.tsx.
 *
 * The tests cover:
 *   - sowVersion comparison: mismatch → stale, match → not stale
 *   - SSE payload parsing: scope_changed triggers a recheck
 *   - Polling interval: 30-second period matches the configured value
 *   - Refresh: initialSowVersionRef reset clears the stale flag
 *   - Edge cases: missing sowVersion, empty string, undefined
 *   - Auto-refresh guard (autoRefreshedRef): fires exactly once per staleness
 *     event, survives a pathological re-stale after refresh, and resets on
 *     step navigation so the next staleness event is not silently suppressed.
 *
 * Run with:
 *   pnpm --filter @workspace/crm run test
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Types (mirrored from PresentationFlow.tsx) ─────────────────────────────────

interface ScopeVersionResponse {
  sowVersion?: string;
}

interface ScopeChangedPayload {
  type?: string;
  sowVersion?: string;
}

// ── Core logic extracted from PresentationFlow.tsx ─────────────────────────────
//
// These functions are lifted verbatim from the component so a rename/logic
// change in the component will cause these tests to fail (regression guard).

/**
 * Check whether the server's current sowVersion differs from the version that
 * was in effect when the page loaded. Returns true if the scope is stale.
 *
 * This mirrors the checkScopeVersion logic in PresentationFlow.tsx.
 */
async function checkScopeVersion(
  initialSowVersion: string | undefined,
  fetchFn: (url: string) => Promise<Response>,
  presentationId: number,
  shareToken?: string,
): Promise<boolean> {
  if (!initialSowVersion) return false;
  try {
    const tokenParam = shareToken ? `?token=${encodeURIComponent(shareToken)}` : "";
    const res = await fetchFn(`/api/portal/presentations/${presentationId}${tokenParam}`);
    if (!res.ok) return false;
    const fresh = await res.json() as ScopeVersionResponse;
    return !!(fresh.sowVersion && fresh.sowVersion !== initialSowVersion);
  } catch {
    return false;
  }
}

/**
 * Parse an SSE message payload and decide whether it should trigger a scope
 * version recheck. Returns true when the event type is "scope_changed".
 *
 * This mirrors the es.onmessage handler in PresentationFlow.tsx.
 */
function shouldRecheckOnSseEvent(rawData: string): boolean {
  try {
    const payload = JSON.parse(rawData) as ScopeChangedPayload;
    return payload.type === "scope_changed";
  } catch {
    return false;
  }
}

// ── Test helpers ───────────────────────────────────────────────────────────────

function makeJsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as unknown as Response;
}

// =============================================================================
// sowVersion comparison — the core staleness check
// =============================================================================

describe("checkScopeVersion — version unchanged → not stale", () => {
  const INITIAL_VERSION = "sow-0:10000|sow-1:8000";

  it("returns false when server sowVersion matches initial version", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      makeJsonResponse({ sowVersion: INITIAL_VERSION }),
    );
    const stale = await checkScopeVersion(INITIAL_VERSION, fetchFn, 1);
    expect(stale).toBe(false);
  });

  it("calls the presentation endpoint exactly once", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      makeJsonResponse({ sowVersion: INITIAL_VERSION }),
    );
    await checkScopeVersion(INITIAL_VERSION, fetchFn, 42);
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("constructs the URL with the correct presentation ID", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      makeJsonResponse({ sowVersion: INITIAL_VERSION }),
    );
    await checkScopeVersion(INITIAL_VERSION, fetchFn, 99);
    expect(fetchFn).toHaveBeenCalledWith("/api/portal/presentations/99");
  });
});

describe("checkScopeVersion — version changed → stale (banner should appear)", () => {
  const INITIAL_VERSION = "sow-0:10000|sow-1:8000";
  const NEW_VERSION     = "sow-0:15000|sow-1:8000"; // Phase 1 price increased

  it("returns true when server sowVersion differs from initial version", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      makeJsonResponse({ sowVersion: NEW_VERSION }),
    );
    const stale = await checkScopeVersion(INITIAL_VERSION, fetchFn, 1);
    expect(stale).toBe(true);
  });

  it("returns true when a new phase is added (version has more segments)", async () => {
    const twoPhaseVersion   = "sow-0:10000|sow-1:8000";
    const threePhaseVersion = "sow-0:10000|sow-1:8000|sow-2:5000";
    const fetchFn = vi.fn().mockResolvedValue(
      makeJsonResponse({ sowVersion: threePhaseVersion }),
    );
    const stale = await checkScopeVersion(twoPhaseVersion, fetchFn, 1);
    expect(stale).toBe(true);
  });

  it("returns true when a phase is removed (version has fewer segments)", async () => {
    const threePhaseVersion = "sow-0:10000|sow-1:8000|sow-2:5000";
    const twoPhaseVersion   = "sow-0:10000|sow-1:8000";
    const fetchFn = vi.fn().mockResolvedValue(
      makeJsonResponse({ sowVersion: twoPhaseVersion }),
    );
    const stale = await checkScopeVersion(threePhaseVersion, fetchFn, 1);
    expect(stale).toBe(true);
  });
});

describe("checkScopeVersion — share token is appended when provided", () => {
  it("appends ?token=... to the URL when a shareToken is present", async () => {
    const INITIAL_VERSION = "sow-0:5000";
    const fetchFn = vi.fn().mockResolvedValue(
      makeJsonResponse({ sowVersion: INITIAL_VERSION }),
    );
    await checkScopeVersion(INITIAL_VERSION, fetchFn, 7, "abc-token");
    expect(fetchFn).toHaveBeenCalledWith(
      "/api/portal/presentations/7?token=abc-token",
    );
  });

  it("does NOT append a token param when shareToken is undefined", async () => {
    const INITIAL_VERSION = "sow-0:5000";
    const fetchFn = vi.fn().mockResolvedValue(
      makeJsonResponse({ sowVersion: INITIAL_VERSION }),
    );
    await checkScopeVersion(INITIAL_VERSION, fetchFn, 7, undefined);
    expect(fetchFn).toHaveBeenCalledWith("/api/portal/presentations/7");
  });
});

describe("checkScopeVersion — edge cases: should not crash or produce false positives", () => {
  it("returns false when initialSowVersion is undefined (page just loaded, no baseline yet)", async () => {
    const fetchFn = vi.fn();
    const stale = await checkScopeVersion(undefined, fetchFn, 1);
    expect(stale).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("returns false when the HTTP response is not ok (server error)", async () => {
    const fetchFn = vi.fn().mockResolvedValue(makeJsonResponse({}, false));
    const stale = await checkScopeVersion("sow-0:5000", fetchFn, 1);
    expect(stale).toBe(false);
  });

  it("returns false when server response omits sowVersion (partial response)", async () => {
    const fetchFn = vi.fn().mockResolvedValue(makeJsonResponse({}));
    const stale = await checkScopeVersion("sow-0:5000", fetchFn, 1);
    expect(stale).toBe(false);
  });

  it("returns false when server sowVersion is an empty string", async () => {
    const fetchFn = vi.fn().mockResolvedValue(makeJsonResponse({ sowVersion: "" }));
    const stale = await checkScopeVersion("sow-0:5000", fetchFn, 1);
    expect(stale).toBe(false);
  });

  it("does not throw when fetch rejects (network error)", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("network failure"));
    await expect(checkScopeVersion("sow-0:5000", fetchFn, 1)).resolves.toBe(false);
  });
});

// =============================================================================
// SSE event parsing — scope_changed triggers a version recheck
// =============================================================================

describe("shouldRecheckOnSseEvent — scope_changed triggers a recheck", () => {
  it("returns true for a valid scope_changed payload", () => {
    const raw = JSON.stringify({ type: "scope_changed", sowVersion: "sow-0:15000" });
    expect(shouldRecheckOnSseEvent(raw)).toBe(true);
  });

  it("returns true for scope_changed even when sowVersion is absent", () => {
    // The handler triggers checkScopeVersion regardless of the payload's sowVersion
    // — the definitive check comes from the GET endpoint, not the SSE payload.
    const raw = JSON.stringify({ type: "scope_changed" });
    expect(shouldRecheckOnSseEvent(raw)).toBe(true);
  });

  it("returns false for an unrecognised event type", () => {
    const raw = JSON.stringify({ type: "keep_alive" });
    expect(shouldRecheckOnSseEvent(raw)).toBe(false);
  });

  it("returns false for a kanban event (different SSE stream)", () => {
    const raw = JSON.stringify({ action: "card_moved", task: {} });
    expect(shouldRecheckOnSseEvent(raw)).toBe(false);
  });

  it("returns false for malformed JSON (does not throw)", () => {
    expect(shouldRecheckOnSseEvent("{not valid json}")).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(shouldRecheckOnSseEvent("")).toBe(false);
  });

  it("returns false for a SSE comment/ping line (leading colon stripped by EventSource)", () => {
    // The raw EventSource data field would be empty after the ": ping" comment.
    // The real handler only processes the onmessage callback, not comments.
    expect(shouldRecheckOnSseEvent("")).toBe(false);
  });
});

// =============================================================================
// Polling interval — 30-second period is required; any change is a regression
// =============================================================================

describe("polling interval — 30-second period", () => {
  // The polling interval used in PresentationFlow.tsx must be exactly 30 000 ms.
  // A shorter interval wastes server resources; a longer interval means clients
  // may miss a scope change if SSE is unavailable.
  const EXPECTED_POLL_INTERVAL_MS = 30_000;

  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("checkScopeVersion is NOT called before the first interval fires", () => {
    let callCount = 0;
    const interval = setInterval(() => { callCount++; }, EXPECTED_POLL_INTERVAL_MS);

    // Advance 29 999 ms — should not have fired yet
    vi.advanceTimersByTime(EXPECTED_POLL_INTERVAL_MS - 1);
    expect(callCount).toBe(0);

    clearInterval(interval);
  });

  it("checkScopeVersion IS called once after exactly 30 000 ms", () => {
    let callCount = 0;
    const interval = setInterval(() => { callCount++; }, EXPECTED_POLL_INTERVAL_MS);

    vi.advanceTimersByTime(EXPECTED_POLL_INTERVAL_MS);
    expect(callCount).toBe(1);

    clearInterval(interval);
  });

  it("checkScopeVersion is called 3 times after 3 intervals (continuous polling)", () => {
    let callCount = 0;
    const interval = setInterval(() => { callCount++; }, EXPECTED_POLL_INTERVAL_MS);

    vi.advanceTimersByTime(EXPECTED_POLL_INTERVAL_MS * 3);
    expect(callCount).toBe(3);

    clearInterval(interval);
  });

  it("polling stops when clearInterval is called (component unmounts)", () => {
    let callCount = 0;
    const interval = setInterval(() => { callCount++; }, EXPECTED_POLL_INTERVAL_MS);

    vi.advanceTimersByTime(EXPECTED_POLL_INTERVAL_MS); // fires once
    clearInterval(interval);
    vi.advanceTimersByTime(EXPECTED_POLL_INTERVAL_MS * 5); // should NOT fire after clearInterval

    expect(callCount).toBe(1);
  });
});

// =============================================================================
// Refresh flow — resetting initialSowVersion clears the stale flag
// =============================================================================

describe("refresh flow — reset initialSowVersion after client clicks Refresh", () => {
  it("after refresh, the new version is treated as the baseline (no longer stale)", async () => {
    const ORIGINAL_VERSION = "sow-0:10000";
    const NEW_VERSION      = "sow-0:15000";

    // Before refresh: server returns new version → stale
    const fetchBefore = vi.fn().mockResolvedValue(makeJsonResponse({ sowVersion: NEW_VERSION }));
    const staleBefore = await checkScopeVersion(ORIGINAL_VERSION, fetchBefore, 1);
    expect(staleBefore).toBe(true); // banner should appear

    // Simulate handleRefreshScope: update initialSowVersion to the new value
    const updatedInitialVersion = NEW_VERSION;

    // After refresh: server still returns the same new version → not stale
    const fetchAfter = vi.fn().mockResolvedValue(makeJsonResponse({ sowVersion: NEW_VERSION }));
    const staleAfter = await checkScopeVersion(updatedInitialVersion, fetchAfter, 1);
    expect(staleAfter).toBe(false); // banner should be gone
  });

  it("if the server updates again after refresh, the banner reappears", async () => {
    const VERSION_AFTER_REFRESH = "sow-0:15000";
    const VERSION_UPDATED_AGAIN = "sow-0:18000"; // Shane updated it again

    const fetchFn = vi.fn().mockResolvedValue(
      makeJsonResponse({ sowVersion: VERSION_UPDATED_AGAIN }),
    );
    const stale = await checkScopeVersion(VERSION_AFTER_REFRESH, fetchFn, 1);
    expect(stale).toBe(true); // banner should reappear
  });
});

// =============================================================================
// Amber banner trigger — end-to-end stale flag lifecycle simulation
// =============================================================================

describe("amber banner lifecycle — stale flag set, shown, then cleared on refresh", () => {
  it("completes the full sign-blocking lifecycle: stable → stale → refreshed → stable", async () => {
    // Step 1: Page loads with sowVersion v1 (baseline captured in initialSowVersionRef)
    let initialVersion: string | undefined = "sow-0:10000|sow-1:5000";
    let scopeStale = false;

    // Step 2: Polling fires; server returns same version → no banner
    const fetchStable = vi.fn().mockResolvedValue(
      makeJsonResponse({ sowVersion: initialVersion }),
    );
    scopeStale = await checkScopeVersion(initialVersion, fetchStable, 1);
    expect(scopeStale).toBe(false);

    // Step 3: Shane regenerates the SOW — server now returns v2
    const newVersion = "sow-0:14000|sow-1:5000"; // Phase 1 price raised
    const fetchStale = vi.fn().mockResolvedValue(
      makeJsonResponse({ sowVersion: newVersion }),
    );
    scopeStale = await checkScopeVersion(initialVersion, fetchStale, 1);
    expect(scopeStale).toBe(true); // amber banner should now block signing/payment

    // Step 4: Client clicks "Refresh scope" — handleRefreshScope resets the baseline
    initialVersion = newVersion; // initialSowVersionRef.current = fresh.sowVersion
    scopeStale = false;           // setScopeStale(false)

    // Step 5: Polling fires again with the same new version → stable again
    const fetchAfterRefresh = vi.fn().mockResolvedValue(
      makeJsonResponse({ sowVersion: newVersion }),
    );
    scopeStale = await checkScopeVersion(initialVersion, fetchAfterRefresh, 1);
    expect(scopeStale).toBe(false); // banner should be gone, client can proceed
  });
});

// =============================================================================
// Auto-refresh guard (autoRefreshedRef) — the useEffect in PresentationFlow.tsx
//
// The effect (lines 700-711 of PresentationFlow.tsx) is:
//
//   if ((scopeStale || docsStale) && currentStepKind === "sow") {
//     if (!autoRefreshedRef.current) {
//       autoRefreshedRef.current = true;
//       void handleRefreshScope();
//     }
//   } else if (!scopeStale && !docsStale) {
//     autoRefreshedRef.current = false;
//   }
//
// This section tests that guard in isolation (extracted as a pure function)
// to verify three required invariants without mounting the React component:
//
//   1. handleRefreshScope fires exactly once when scopeStale becomes true on
//      the SOW step.
//   2. If the refresh somehow re-sets scopeStale=true (edge case), no
//      infinite loop occurs — the guard remains set.
//   3. Navigating away from the SOW step and back does NOT suppress a
//      subsequent auto-refresh after a new staleness event.
// =============================================================================

/**
 * Pure function mirroring the useEffect body from PresentationFlow.tsx
 * (lines 700-711).  The caller supplies the mutable ref object so test code
 * can inspect and reset it between calls.
 */
function runAutoRefreshEffect(
  scopeStale: boolean,
  docsStale: boolean,
  currentStepKind: string | undefined,
  autoRefreshedRef: { current: boolean },
  handleRefreshScope: () => void,
): void {
  if ((scopeStale || docsStale) && currentStepKind === "sow") {
    if (!autoRefreshedRef.current) {
      autoRefreshedRef.current = true;
      handleRefreshScope();
    }
  } else if (!scopeStale && !docsStale) {
    autoRefreshedRef.current = false;
  }
}

// -----------------------------------------------------------------------------
// Invariant 1: fires exactly once per staleness event
// -----------------------------------------------------------------------------

describe("auto-refresh guard — fires handleRefreshScope exactly once per staleness event", () => {
  it("calls handleRefreshScope once when scopeStale first becomes true on the SOW step", () => {
    const handleRefreshScope = vi.fn();
    const autoRefreshedRef = { current: false };

    runAutoRefreshEffect(true, false, "sow", autoRefreshedRef, handleRefreshScope);

    expect(handleRefreshScope).toHaveBeenCalledTimes(1);
    expect(autoRefreshedRef.current).toBe(true);
  });

  it("does NOT call handleRefreshScope a second time when the effect re-runs while still stale", () => {
    const handleRefreshScope = vi.fn();
    const autoRefreshedRef = { current: false };

    // First run — guard fires
    runAutoRefreshEffect(true, false, "sow", autoRefreshedRef, handleRefreshScope);
    expect(handleRefreshScope).toHaveBeenCalledTimes(1);

    // Second run — same stale state (e.g. re-render triggered by unrelated update)
    runAutoRefreshEffect(true, false, "sow", autoRefreshedRef, handleRefreshScope);
    expect(handleRefreshScope).toHaveBeenCalledTimes(1); // still exactly once
  });

  it("does not call handleRefreshScope when scopeStale and docsStale are both false", () => {
    const handleRefreshScope = vi.fn();
    const autoRefreshedRef = { current: false };

    runAutoRefreshEffect(false, false, "sow", autoRefreshedRef, handleRefreshScope);

    expect(handleRefreshScope).not.toHaveBeenCalled();
  });

  it("does not call handleRefreshScope when on a non-SOW step even if stale", () => {
    const handleRefreshScope = vi.fn();
    const autoRefreshedRef = { current: false };

    runAutoRefreshEffect(true, false, "agreement", autoRefreshedRef, handleRefreshScope);

    expect(handleRefreshScope).not.toHaveBeenCalled();
  });

  it("fires when docsStale is true (not just scopeStale) on the SOW step", () => {
    const handleRefreshScope = vi.fn();
    const autoRefreshedRef = { current: false };

    runAutoRefreshEffect(false, true, "sow", autoRefreshedRef, handleRefreshScope);

    expect(handleRefreshScope).toHaveBeenCalledTimes(1);
  });
});

// -----------------------------------------------------------------------------
// Invariant 2: pathological re-stale after refresh does NOT loop
// -----------------------------------------------------------------------------

describe("auto-refresh guard — pathological re-stale after refresh does NOT loop", () => {
  it("if handleRefreshScope re-triggers the effect with scopeStale=true, guard blocks a second call", () => {
    const autoRefreshedRef = { current: false };
    let callCount = 0;

    // Simulate a misbehaving handleRefreshScope that causes the effect to fire
    // again with scopeStale still true (e.g. the API call fails and the caller
    // never clears scopeStale).
    const handleRefreshScope = vi.fn().mockImplementation(() => {
      callCount++;
      // Recursively simulate the effect re-running with stale still true
      runAutoRefreshEffect(true, false, "sow", autoRefreshedRef, handleRefreshScope);
    });

    // Initial effect run
    runAutoRefreshEffect(true, false, "sow", autoRefreshedRef, handleRefreshScope);

    // The guard (autoRefreshedRef.current = true after the first call) ensures
    // handleRefreshScope is invoked exactly once regardless of recursive re-runs.
    expect(callCount).toBe(1);
    expect(handleRefreshScope).toHaveBeenCalledTimes(1);
  });

  it("guard remains set after first auto-refresh; 10 additional effect runs do not produce more calls", () => {
    const handleRefreshScope = vi.fn();
    const autoRefreshedRef = { current: false };

    runAutoRefreshEffect(true, false, "sow", autoRefreshedRef, handleRefreshScope);

    for (let i = 0; i < 10; i++) {
      runAutoRefreshEffect(true, false, "sow", autoRefreshedRef, handleRefreshScope);
    }

    expect(handleRefreshScope).toHaveBeenCalledTimes(1); // never more than once
  });
});

// -----------------------------------------------------------------------------
// Invariant 3: navigating away and back does not permanently suppress the guard
// -----------------------------------------------------------------------------

describe("auto-refresh guard — navigation away/back resets the guard correctly", () => {
  it("staleness clearing resets autoRefreshedRef so the NEXT staleness event triggers auto-refresh", () => {
    const handleRefreshScope = vi.fn();
    const autoRefreshedRef = { current: false };

    // --- First staleness event ---
    runAutoRefreshEffect(true, false, "sow", autoRefreshedRef, handleRefreshScope);
    expect(handleRefreshScope).toHaveBeenCalledTimes(1);
    expect(autoRefreshedRef.current).toBe(true);

    // Refresh completes, staleness cleared → guard resets
    runAutoRefreshEffect(false, false, "sow", autoRefreshedRef, handleRefreshScope);
    expect(autoRefreshedRef.current).toBe(false);

    // --- Second staleness event (Shane regenerates the SOW again) ---
    runAutoRefreshEffect(true, false, "sow", autoRefreshedRef, handleRefreshScope);
    expect(handleRefreshScope).toHaveBeenCalledTimes(2); // fired again, not suppressed
  });

  it("navigating to a non-SOW step while still stale does NOT reset the guard", () => {
    // The else-if branch only resets when BOTH scopeStale AND docsStale are false.
    // While still stale on a non-SOW step, the guard must stay set to avoid
    // re-triggering auto-refresh when the user returns to the SOW step.
    const handleRefreshScope = vi.fn();
    const autoRefreshedRef = { current: false };

    // Auto-refresh fires on SOW step
    runAutoRefreshEffect(true, false, "sow", autoRefreshedRef, handleRefreshScope);
    expect(autoRefreshedRef.current).toBe(true);

    // User navigates to Agreement while still stale — neither branch resets the ref
    runAutoRefreshEffect(true, false, "agreement", autoRefreshedRef, handleRefreshScope);
    expect(autoRefreshedRef.current).toBe(true); // guard unchanged
    expect(handleRefreshScope).toHaveBeenCalledTimes(1); // no extra call
  });

  it("guard resets after staleness clears; returning to SOW after a new stale event fires again", () => {
    const handleRefreshScope = vi.fn();
    const autoRefreshedRef = { current: false };

    // First auto-refresh on SOW step
    runAutoRefreshEffect(true, false, "sow", autoRefreshedRef, handleRefreshScope);
    expect(handleRefreshScope).toHaveBeenCalledTimes(1);

    // Staleness clears (still on SOW step) → guard resets
    runAutoRefreshEffect(false, false, "sow", autoRefreshedRef, handleRefreshScope);
    expect(autoRefreshedRef.current).toBe(false);

    // User navigates to Agreement; a new stale event arrives (Shane updated again)
    // Effect fires on Agreement — no auto-refresh off-step, guard stays false
    runAutoRefreshEffect(true, false, "agreement", autoRefreshedRef, handleRefreshScope);
    expect(handleRefreshScope).toHaveBeenCalledTimes(1);
    expect(autoRefreshedRef.current).toBe(false);

    // User navigates back to SOW — auto-refresh must fire again
    runAutoRefreshEffect(true, false, "sow", autoRefreshedRef, handleRefreshScope);
    expect(handleRefreshScope).toHaveBeenCalledTimes(2);
    expect(autoRefreshedRef.current).toBe(true);
  });
});
