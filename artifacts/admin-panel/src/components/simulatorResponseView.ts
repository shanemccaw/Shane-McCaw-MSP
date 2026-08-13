// artifacts/admin-panel/src/components/simulatorResponseView.ts
//
// Pure logic for what SimulatorEndpointCanvas's Response panel should render.
// Split out (same convention as simulatorFullResponse.ts / simulatorTreeState.ts)
// so the exact race this guards against — a completed run's real result flashing,
// then silently getting replaced by an empty raw-items array a moment later — can
// be unit-tested directly instead of only through a full component render.
//
// ROOT CAUSE (see PLATFORM_BUILD.md "Fix Full Response Flash-to-Empty Bug"): the
// backend is not losing data. `completeRun()` (simulator-run-store.ts) persists
// `items` and `itemCount` from the SAME CheckResult in one atomic UPDATE, so the
// two are always consistent, and GET /:runId/items 409s explicitly whenever a
// run's items were omitted or the run didn't complete successfully — it never
// silently substitutes an empty array for missing data. The bug was here, on the
// client: `run.result` (the mapped/extracted summary — see monitor-executor.ts
// applyMapping()) is a STRUCTURALLY DIFFERENT payload from the raw captured
// items, and applyMapping() always produces a real, non-empty-looking object
// (counts, booleans, `_itemCount`) even when the underlying item list is empty.
// The old `rawItems ?? run?.result ?? ...` fallback let that always-populated
// summary render first, then swapped in the true (possibly genuinely empty) raw
// array the moment it loaded, with nothing to tell the operator what happened.
//
// The fix: once the panel is showing the raw view (`viewingRaw`), it NEVER falls
// back to `run.result` again — it shows a loading state until the raw fetch
// resolves one way or the other, so a genuine empty capture reads as "we asked
// and got zero items", never as "your data vanished".

export interface ResponseViewInputs {
  /** True once the raw captured-items view is active for the run on screen —
   *  either a Full Response run just completed, or the operator clicked
   *  "View full response" manually. */
  viewingRaw: boolean;
  /** True once a GET .../items fetch has resolved with a real (possibly empty) array. */
  rawItemsLoaded: boolean;
  /** The raw items last fetched, or null if none/failed. */
  rawItems: unknown[] | null;
  /** The mapped/extracted summary from the run's own poll response. */
  runResult: unknown;
  /** The run's error string, if it failed. */
  runError?: string | null;
}

/** What JsonResponseViewer's `value` prop should be for the current state. */
export function resolveResponseValue(inputs: ResponseViewInputs): unknown {
  if (inputs.viewingRaw) {
    // Deliberately does NOT fall back to runResult — see module header.
    return inputs.rawItemsLoaded ? inputs.rawItems : undefined;
  }
  if (inputs.runResult !== undefined && inputs.runResult !== null) return inputs.runResult;
  if (inputs.runError) return { error: inputs.runError };
  return undefined;
}

/** The empty-state label to show alongside resolveResponseValue's result. */
export function resolveResponseEmptyLabel(
  inputs: Pick<ResponseViewInputs, "viewingRaw" | "rawItemsLoaded"> & { loadingRawItems: boolean; rawItemsError?: string | null },
): string {
  if (inputs.viewingRaw) {
    if (inputs.loadingRawItems) return "Loading the full captured response…";
    if (inputs.rawItemsError) return "Failed to load the full captured response — see error below";
  }
  return "Run this endpoint to see the real tenant response";
}

/** True when the raw view has genuinely loaded a real, empty capture — the
 *  "this is real data, not a failure" note the panel shows underneath. */
export function isGenuineEmptyRawCapture(inputs: Pick<ResponseViewInputs, "viewingRaw" | "rawItemsLoaded" | "rawItems">): boolean {
  return inputs.viewingRaw && inputs.rawItemsLoaded && Array.isArray(inputs.rawItems) && inputs.rawItems.length === 0;
}
