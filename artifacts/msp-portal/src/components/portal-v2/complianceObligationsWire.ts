/**
 * complianceObligationsWire.ts — the shape `portal-compliance-obligations.ts`
 * serves, and the normalisation into `CMP_OBLIGATIONS`'s own `CmpObligation`
 * type so the page's rendering does not need to know live rows exist.
 *
 * Split out of `complianceObligationsLive.ts` so it can be tested as a plain
 * function — no React, no fetching.
 */

import type { CmpObligation, CmpObligationTone } from "./cmpDrilldownData";

export interface WireObligation {
  readonly framework: string;
  readonly scope: "In scope" | "Marked out of scope";
  readonly requires: string;
  readonly state: string;
  readonly tone: CmpObligationTone;
}

export function toCmpObligation(row: WireObligation): CmpObligation {
  return {
    framework: row.framework,
    scope: row.scope,
    requires: row.requires,
    state: row.state,
    tone: row.tone,
  };
}
