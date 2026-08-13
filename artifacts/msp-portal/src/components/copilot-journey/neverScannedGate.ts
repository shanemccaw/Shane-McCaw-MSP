/**
 * neverScannedGate.ts — the #536 never-scanned backstop gate, extracted from
 * copilot-readiness.tsx so the decision itself is `node --test`-able without
 * rendering the page (same pattern as revealAutoScan.ts).
 *
 * #539 regression: the original gate read `!scan.everScanned` alone, which is
 * `true` both for a genuinely never-scanned tenant AND for a tenant whose
 * first /api/portal/scan-status poll simply hasn't returned yet — `scanData`
 * stays `null` either way, so `scanData?.everScanned === true` reads `false`
 * for both. That made the gate fire on literally every initial render, for
 * every customer, before `loaded` first flips true. `loaded` is required here
 * so the gate can never fire before the platform actually knows the answer.
 */

export interface RevealNoScanGateInput {
  /** True once the first /api/portal/scan-status response has landed. */
  readonly loaded: boolean;
  readonly isPreview: boolean;
  readonly everScanned: boolean;
  readonly running: boolean;
  readonly awaitingAutoScan: boolean;
}

export function shouldBlockNeverScanned(input: RevealNoScanGateInput): boolean {
  return (
    input.loaded &&
    !input.isPreview &&
    !input.everScanned &&
    !input.running &&
    !input.awaitingAutoScan
  );
}
