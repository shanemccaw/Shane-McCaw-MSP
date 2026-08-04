/**
 * revealAutoScan.ts — the gating decision behind Scene 0's auto-trigger
 * (#367): a tenant who has NEVER been scanned must not fall through to the
 * verdict scene with nothing to show. Extracted from copilot-readiness.tsx so
 * the decision itself is `node --test`-able without rendering the page.
 *
 * `debug-trigger-scan` is the platform's ONLY scan trigger and it is
 * hard-gated server-side to testbed tenants (portal-assessment.ts) — real
 * customers never get a self-serve trigger, to stop AI-credit spam. A real
 * customer's scan already fired at consent time (consent.ts's
 * runDiagnostics), so a real tenant reaching "never scanned, nothing
 * running" means that scan genuinely hasn't landed yet, not that none
 * exists to find — this must never invent a second trigger pathway for them.
 */

export type AutoScanDecision =
  /** Nothing to do: the payload hasn't loaded yet, or this tenant already has
   *  a scan (running or completed) — the existing overlay logic covers it. */
  | { readonly kind: "skip" }
  /** A testbed tenant with no scan and nothing running: start one for real. */
  | { readonly kind: "trigger" }
  /** A real tenant with no scan and nothing running: no self-serve trigger
   *  exists for them, so report why rather than starting a second pathway. */
  | { readonly kind: "unavailable"; readonly message: string };

export const AUTO_SCAN_UNAVAILABLE_MESSAGE =
  "Your tenant scan hasn't started yet — this can take a few minutes right after granting access. Try refreshing shortly.";

export interface AutoScanStatus {
  readonly active: unknown;
  readonly everScanned: boolean;
  readonly isTestbed: boolean;
}

/**
 * `status` is `null` until the scan-status payload's first poll returns —
 * treating that as "never scanned" would fire on every single page load
 * before the tenant's real state is known, so it is a `skip`, not a
 * `trigger`.
 */
export function decideAutoScan(status: AutoScanStatus | null): AutoScanDecision {
  if (!status) return { kind: "skip" };
  if (status.active || status.everScanned) return { kind: "skip" };
  if (!status.isTestbed) return { kind: "unavailable", message: AUTO_SCAN_UNAVAILABLE_MESSAGE };
  return { kind: "trigger" };
}
