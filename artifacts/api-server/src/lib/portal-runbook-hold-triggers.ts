/**
 * portal-runbook-hold-triggers.ts — Git #4617.
 *
 * Before this, the only INSERT into `portal_hold_windows` anywhere in the
 * codebase was the admin-testbed QA fixture (`admin-testbed.ts`'s
 * `seed-runbooks`). This is the real trigger: a small catalogue, keyed by a
 * runbook's own `runbookKey`, naming which step position — when actually
 * checked by a customer or MSP operator — starts a real wait-then-decide
 * hold window gating a later step. `portal-runbook-wire.ts`'s
 * `maybeRaiseHoldWindowForStep` reads this catalogue; it is called from both
 * step-tick routes (`portal-runbooks.ts`, `msp-runbooks.ts`).
 *
 * ── Why only ONE entry exists here ──────────────────────────────────────────
 * `portal_hold_windows` is inherently a TIME-gated mechanism (`waitDays`,
 * `startedAt`, a due/closing state machine derived purely from elapsed days —
 * see `portal-hold-windows.ts`). A trigger belongs in this catalogue only when
 * the product has already promised a concrete day count somewhere real.
 *
 * `oversharing-convert-to-private` (`portal-oversharing-sites.ts`'s
 * `RUNBOOK_CATALOGUE.convert`) is the one case that qualifies: its own step 4
 * copy already says *"If no admin responds within 30 days, convert the site
 * to Private automatically"* — a real, already-shipped customer-facing wait,
 * with nothing behind it. Step 1 ("Notify all site admins...") is what starts
 * that 30-day clock, so checking step 1 is the trigger and step 4 is the gate.
 *
 * The other two SOPs in the same catalogue (`reduceAdmins`, `manageGuests`)
 * describe the same SHAPE of wait ("allow time…", "wait for admin
 * response…") but name no concrete day count anywhere in code or design copy
 * — grep for "30 days" / "14 day" against either finds nothing. Inventing a
 * number for either would be inventing a customer-facing timing promise that
 * does not exist in the product today, which is a product decision, not an
 * implementation detail — filed as #4662 (Ask Shane), not guessed here.
 *
 * Two CA-policy Git issues (#4518/#4522) were also considered as a trigger —
 * every CA policy write defaults to report-only unless a pack run explicitly
 * chose "immediate" (`ca-enforcement-mode.ts`), which looks superficially like
 * "raise a hold window." It is deliberately NOT wired: Shane's recorded
 * decision on #4518 is that promotion to enforced is never time-gated
 * ("explicit promotion... not automatic timed promotion, Option C"). Raising
 * a `portal_hold_windows` row off that write would bolt exactly the
 * fixed-day-wait mechanism he rejected onto a workflow he decided is
 * impact-gated, not time-gated — see `build-journal/4617-plan.md`.
 */

export interface RunbookHoldTrigger {
  /** The step position that, once checked, starts this hold window's clock. */
  readonly triggerStepPosition: number;
  /** Unique per customer (matches the `portal_hold_windows_customer_key_idx` index). */
  readonly holdKey: string;
  readonly title: string;
  readonly gates: string;
  readonly gatesStepPosition: number;
  readonly pillar: string;
  readonly waitDays: number;
  readonly why: string;
  readonly scanSource: string;
  readonly scanCadence: string;
  readonly scanLine: string;
}

export const RUNBOOK_HOLD_TRIGGERS: Record<string, RunbookHoldTrigger> = {
  "oversharing-convert-to-private": {
    triggerStepPosition: 1,
    holdKey: "oversharing-convert-notice",
    title: "Site admin notice period — 30 days before automatic conversion",
    gates: "Gates step 4 — convert the site to Private automatically",
    gatesStepPosition: 4,
    pillar: "governance",
    waitDays: 30,
    why:
      "Thirty days is the notice period this runbook already promises site admins before " +
      "the site converts automatically. Converting sooner than promised is what generates " +
      "the surprised ticket.",
    scanSource: "Site admin activity",
    scanCadence: "manual",
    scanLine:
      "No automated scan is wired for this window yet — check with the site's admins " +
      "directly before deciding.",
  },
};

/** Null when `runbookKey` has no configured hold trigger. */
export function holdTriggerForRunbookKey(runbookKey: string): RunbookHoldTrigger | null {
  return RUNBOOK_HOLD_TRIGGERS[runbookKey] ?? null;
}
