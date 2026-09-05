/**
 * remediation-tracker-terminal-state.ts — the Remediation Tracker's
 * three-state read model (#1542), split out of `portal-remediation-tracker.ts`
 * into its own zero-dependency module (#2922) so a second caller can reuse it
 * without importing that whole route file.
 *
 * Why this had to move rather than just importing the route file: that file
 * pulls in `../lib/workflow-executor` (`emitWorkflowEvent`), which transitively
 * imports `sales-offer-engine.ts` -> `priority-engine.ts` — real, heavy engine
 * code that references `sql` from `drizzle-orm` at module scope. A second
 * route importing the route file for this one pure function silently dragged
 * that whole chain along, breaking every test that mocks `drizzle-orm`/
 * `@workspace/db` minimally (confirmed live: it broke
 * `portal-customer-engines-assessment-redaction.test.ts`,
 * `portal-dashboard-route-collision.test.ts`, and
 * `portal-customer-offboard.test.ts`, none of which have anything to do with
 * remediation). This module has no imports at all, so it cannot repeat that.
 */

/**
 * #1542 — the checklist's three terminal read-states, derived rather than
 * stored: "done means verified, never claimed" (#1489), so `completed` alone
 * is not a terminal state here.
 *
 *   verified    — the pointed check passed (verificationState === "verified").
 *   accepted    — exited to the register with a signature (status ===
 *                 "accepted_risk", which is ONLY ever set by
 *                 remediation-tracker-risk-decline.ts alongside a real signed
 *                 msp_risk_decisions row — never a bare claim).
 *   outstanding — neither. Every other status/verification combination,
 *                 including a customer's un-re-verified `completed` claim.
 */
export type RemediationTerminalState = "verified" | "accepted" | "outstanding";

export function remediationTerminalState(status: string, verificationState: string): RemediationTerminalState {
  if (verificationState === "verified") return "verified";
  if (status === "accepted_risk") return "accepted";
  return "outstanding";
}
