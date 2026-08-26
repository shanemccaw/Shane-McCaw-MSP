/**
 * PortalV2LoadingState.test.ts — pins the honest "real data is loading"
 * convention (Git #1343): a page shows a skeleton while a real fetch is in
 * flight, NEVER the design fixture.
 *
 * These are the pure-export guards (copy stability, exported surface), matching
 * the sibling NoScanDataState.test.ts — the portal-v2 unit tests run under
 * "tsx --test" with jsx:"preserve", so JSX-authored components are not rendered
 * here. The DOM-level proof that the hidden "loading" marker is genuinely on
 * screen lives in the test manifest (a uiStep expect textContains), per
 * CLAUDE.md's testing guidance.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  PortalV2LoadingState,
  PortalV2Skeleton,
  PV2_LOADING_LABEL,
} from "./PortalV2LoadingState";

describe("PV2_LOADING_LABEL", () => {
  it("keeps the canonical loading sentence verbatim — copy is final", () => {
    assert.equal(PV2_LOADING_LABEL, "Loading your latest data…");
  });

  it("is an honest loading line, never the word fixture", () => {
    assert.ok(!PV2_LOADING_LABEL.toLowerCase().includes("fixture"));
  });
});

describe("exported surface", () => {
  it("exports both the block and the primitive as components", () => {
    assert.equal(typeof PortalV2LoadingState, "function");
    assert.equal(typeof PortalV2Skeleton, "function");
  });
});
