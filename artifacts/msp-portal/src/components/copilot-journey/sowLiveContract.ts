/**
 * sowLiveContract.ts — the real per-tenant content behind the Statement of
 * Work's `derived` rows and its Section 7 carry table (#292, document 9 of 9).
 *
 * A pure `.ts` module, not inlined into `StatementOfWorkBody.tsx`, for the same
 * reason every other live-rendered document's logic lives outside its `.tsx`:
 * `node --test` cannot load `.tsx`, so this is what makes the honesty rules
 * below testable.
 *
 * EVERY FUNCTION HERE TAKES AN `isPreview` FLAG AND RETURNS THE DESIGN'S OWN
 * TEXT VERBATIM WHEN IT IS TRUE. `previewStatementOfWork.ts` used to hold these
 * strings directly on the row as a static `value`; they moved here, unchanged,
 * so the preview surface (`?preview=design`, permanently badged) keeps
 * rendering Halden Materials' exact worked example while a live tenant's copy
 * of the same row is computed from what this platform actually measured.
 *
 * WHAT #292'S AUDIT FOUND, AND THE THREE SHAPES THE FIX TAKES
 * -------------------------------------------------------------
 *   1. Genuinely derivable from data already on the journey's view or the two
 *      named SOW endpoints (`objective`, `findingsCarried`, `elapsedDays`,
 *      `telemetrySource`, `validity`, `wasteRecovered`, the Section 7 carry
 *      table and blockers list) — computed for real below.
 *   2. Not derivable from any check this platform runs, on the same rule
 *      #451 already established for a required licence tier: "New budget
 *      required" claims a specific uplift figure and user count for an E5
 *      upgrade, and nothing in `monitor_checks` or the licensing pillar's own
 *      stats names a required tier per user — only a licence gap's own
 *      `_licenseGapFeature` does, and that names a capability, not a SKU count.
 *      `newBudget` and the `netYear` figure computed from it are therefore an
 *      honest declared gap on a live tenant, exactly as `GOVERNANCE_FRAMEWORK_GAP`
 *      is for the Governance Posture Report.
 *   3. Contract terms invented for the worked example that do not match what
 *      the real `sow/payment-options` endpoint reports: the design's "40%
 *      deposit … 14 days net" names a deposit percentage and net term this
 *      platform's real billing does not use — `phased.selfServe` on the real
 *      endpoint is `false` with the comment "Milestone billing is
 *      provider-arranged for Assessment … there is no self-serve deposit
 *      charge." `paymentTerms` states that real fact instead of a percentage
 *      nobody would actually be charged.
 */

import { COPILOT_GATE_TARGET, type PillarKey } from "./journeyTokens.ts";
import type { JourneyPillarView } from "./journeyModel.ts";
import { findingRows } from "./liveReportBlocks.ts";
import type { SowPillarCarry } from "./previewStatementOfWork.ts";

/* ------------------------------------------------------------------ *
 * Section 5 blockers + Section 7 carry table — real, ranked findings
 * ------------------------------------------------------------------ */

/**
 * The real blockers list: this tenant's own critical findings, one per pillar
 * that has one, in `PILLAR_KEYS` order, capped at six to match the design's own
 * "6 findings holding the gate shut" framing.
 *
 * Each `text` is the finding's own title VERBATIM — the same rule
 * `findingRows()` applies everywhere else in this journey — never an invented
 * elaboration like the design's "four holding HR and finance content", which
 * this platform's findings do not carry as a second sentence.
 */
export function buildLiveBlockers(
  pillars: readonly JourneyPillarView[],
): readonly { readonly pillar: PillarKey; readonly text: string }[] {
  const rows: { pillar: PillarKey; text: string }[] = [];
  for (const p of pillars) {
    const critical = p.findings.find((f) => f.severity === "critical");
    if (critical) rows.push({ pillar: p.key, text: critical.title });
    if (rows.length >= 6) break;
  }
  return rows;
}

/**
 * Section 7's real carry table: every pillar this tenant's scan actually
 * evaluated, with its real finding count and its real finding titles joined —
 * never the design's invented per-pillar prose ("no lifecycle policy", "90-day
 * audit retention") which is Halden's own detail, not a fact this platform
 * reads for any tenant.
 *
 * A pillar with a real score and zero findings is a genuine clean result
 * (#399) and is still listed, with `count: 0` and a clean-result detail — the
 * same distinction `findingsBlocks()` draws, reproduced here because this is a
 * table row rather than a block list. A pillar with no score at all (never
 * evaluated) is left out entirely: there is nothing carried into scope from a
 * pillar the scan did not reach.
 */
export function buildLiveCarry(pillars: readonly JourneyPillarView[]): readonly SowPillarCarry[] {
  const rows: SowPillarCarry[] = [];
  for (const p of pillars) {
    if (p.score === null) continue;
    const leads = findingRows(p.findings).map((f) => f.lead);
    rows.push({
      pillar: p.key,
      count: leads.length,
      detail: leads.length ? leads.join(", ") : "No critical or warning findings on this tenant's last scan.",
    });
  }
  // Worst first, matching the design's own count-descending order.
  return [...rows].sort((a, b) => b.count - a.count);
}

/* ------------------------------------------------------------------ *
 * Section 1
 * ------------------------------------------------------------------ */

export function resolveObjective(isPreview: boolean, score: number | null): string {
  if (isPreview) return "Copilot Gate clearance · readiness 41 → 82 minimum";
  return score === null
    ? `Copilot Gate clearance · readiness at or above ${COPILOT_GATE_TARGET}`
    : `Copilot Gate clearance · readiness ${score} → ${COPILOT_GATE_TARGET} minimum`;
}

export function resolveFindingsCarried(
  isPreview: boolean,
  totalFindings: number | null,
  blockersCount: number,
): string {
  if (isPreview) return "41 findings across six pillars · 6 of them gate blockers";
  if (totalFindings === null) return "No findings are yet recorded for this tenant's scan";
  const blockersClause = blockersCount > 0 ? ` · ${blockersCount} of them gate blockers` : "";
  return `${totalFindings} findings across six pillars${blockersClause}`;
}

export function resolveWhyMatters(isPreview: boolean, sitesInScope: number | null): string {
  const lead =
    "Copilot inherits every permission, label and licence state on day one. Enabling it against the current configuration extends a known identity and exposure gap into a conversational interface";
  if (isPreview) {
    return `${lead} across 1,847 sites.`;
  }
  return sitesInScope !== null
    ? `${lead} across ${sitesInScope.toLocaleString("en-US")} sites.`
    : `${lead}.`;
}

export function resolveBasisOfScope(isPreview: boolean, signalCount: number | null): string {
  if (isPreview) return "Read-only Microsoft Graph assessment · 158 signal derivation checks · no configuration altered";
  const checksClause = signalCount !== null ? ` · ${signalCount} signal derivation checks` : "";
  return `Read-only Microsoft Graph assessment${checksClause} · no configuration altered`;
}

/* ------------------------------------------------------------------ *
 * Section 2
 * ------------------------------------------------------------------ */

export function resolveChangeWindows(isPreview: boolean): string {
  if (isPreview) {
    return "2 change windows — legacy authentication retirement (1 week notice) and device compliance enforcement (3 days, 88 devices)";
  }
  // Neither the affected device count nor a per-tenant notice period is a
  // figure any check this platform runs produces — the two windows themselves
  // are a real fact about the sequence (identity work always touches legacy
  // auth and device compliance), stated without a Halden-specific count.
  return "2 change windows — legacy authentication retirement and device compliance enforcement, each scheduled with advance notice";
}

/**
 * "Phases in parallel" — the design hardcoded "Phases 1–3 overlap by design"
 * against its own fixed 6-phase structure. #590: real phases are now
 * dynamically selected by the Sales Offer Engine per tenant, so the phase
 * count and mix vary and no real dependency data exists yet (#593, deferred)
 * to say which of THIS tenant's phases could run concurrently. Rather than
 * assert a parallel structure the platform cannot back up, a live tenant gets
 * an honest declared gap, on the same discipline `resolveNewBudget` applies.
 */
export function resolvePhasesInParallel(isPreview: boolean): string {
  if (isPreview) {
    return "Phases 1–3 overlap by design — Compliance labelling begins while Governance sharing work continues, since both touch the same sites";
  }
  return "Not fixed to a specific phase structure — which phases in your scope can run in parallel depends on the phases actually selected.";
}

/**
 * "Strictly sequential" — same gap as `resolvePhasesInParallel`, for the
 * design's paired "Phases 4–6 are strictly sequential" claim.
 */
export function resolveStrictlySequential(isPreview: boolean): string {
  if (isPreview) {
    return "Phases 4–6 · enablement cannot precede validation, certification cannot precede either";
  }
  return "Final sequencing across your selected phases is confirmed with your assessment lead at kickoff.";
}

/**
 * The Delivery Timeline & Deliverables intro paragraph. Paired with the two
 * resolvers above — same #590 gap, restated for the timeline section's own
 * copy rather than repeated verbatim.
 */
export function resolveTimelineIntro(isPreview: boolean): string {
  if (isPreview) {
    return "Phases 1 to 3 overlap by design — Compliance labelling begins while Governance sharing work continues, since both touch the same sites. Phases 4 to 6 are strictly sequential. The schedule below recalculates as you set scope.";
  }
  return "Sequencing across the phases in your scope is confirmed with your assessment lead at kickoff. The schedule below recalculates as you set scope.";
}

/* ------------------------------------------------------------------ *
 * Section 3
 * ------------------------------------------------------------------ */

/** Whole days between `scannedOnIso` and `nowIso`, or `null` when either is unknown. Floored, never rounded, so "today" reads as 0 rather than 1. */
export function elapsedDaysSince(scannedOnIso: string | null, nowIso: string): number | null {
  if (!scannedOnIso) return null;
  const scanned = new Date(scannedOnIso).getTime();
  const now = new Date(nowIso).getTime();
  if (Number.isNaN(scanned) || Number.isNaN(now)) return null;
  const days = Math.floor((now - scanned) / (24 * 60 * 60 * 1000));
  return days >= 0 ? days : null;
}

export function resolveElapsedDays(isPreview: boolean, days: number | null): string {
  if (isPreview) return "12 days";
  return days === null ? "Not established — no scan date on record" : `${days} ${days === 1 ? "day" : "days"}`;
}

export function resolveTelemetrySource(isPreview: boolean, scannedOn: string | null): string {
  const lead = "Microsoft Graph API · read-only delegated permissions";
  if (isPreview) return `${lead} · 3 August 2026`;
  return scannedOn ? `${lead} · ${scannedOn}` : lead;
}

/* ------------------------------------------------------------------ *
 * Section 4 — Commercial Terms
 * ------------------------------------------------------------------ */

/**
 * "New budget required" claims a specific new-licence-spend figure and a user
 * count for an E5 upgrade. Neither is derivable: #451 established that no
 * check this platform runs names a REQUIRED tier per user — only a licence
 * gap's own `_licenseGapFeature` names a capability, never a seat count. So a
 * live tenant gets an honest declared gap here, the same discipline
 * `GOVERNANCE_FRAMEWORK_GAP` applies to a claim this platform cannot evaluate.
 */
export function resolveNewBudget(isPreview: boolean): string {
  if (isPreview) return "$27,600 — the E5 uplift for 96 users, offset by reclaimed licence waste";
  return "Not stated on this contract — no check this platform runs names a required licence tier per user; see the Licensing Alignment Report's Upgrade Opportunities for what confirming one would take.";
}

/**
 * The real annual recoverable licence spend, off the licensing pillar's own
 * `licensing.annualWaste` stat — already on the journey's view, not a new
 * fetch. `null` when that check did not report for this tenant.
 */
export function resolveWasteRecovered(isPreview: boolean, annualWasteUsd: number | null): string {
  if (isPreview) return "$18,400 a year, available from month one";
  return annualWasteUsd === null
    ? "Not measured on this tenant's last scan"
    : `$${Math.round(annualWasteUsd).toLocaleString("en-US")} a year, from paid seats provisioned but unassigned`;
}

/** Depends on the E5 uplift figure `resolveNewBudget` cannot state for a live tenant, so a net figure cannot be honestly stated either. */
export function resolveNetYear(isPreview: boolean): string {
  if (isPreview) return "$9,200 net, after $18,400 of recovered licence waste";
  return "Not stated — this figure would net the recovered licence waste above against a required-budget figure this contract does not assert for your tenant.";
}

export function resolvePaymentTerms(
  isPreview: boolean,
  phasedSelfServe: boolean | null,
  payInFullActive: boolean,
  /** Git #659 — the coupon's own live percentage, stated instead of a vague "the active discount" when known. */
  payInFullDiscountPct: number | null = null,
): string {
  if (isPreview) {
    return "40% deposit at signature · balance invoiced per phase on your sign-off · 14 days net";
  }
  if (phasedSelfServe === null) {
    return "Confirmed at checkout for your agreed scope";
  }
  const phasedClause = phasedSelfServe
    ? "phased billing invoices per phase on your sign-off"
    : "phased billing is milestone-based and arranged directly with your assessment lead, not a self-serve deposit";
  const discountClause = payInFullActive
    ? ` · paying in full at checkout applies${payInFullDiscountPct !== null ? ` the current ${payInFullDiscountPct}% off` : " the active discount"}`
    : "";
  return `Pay in full at checkout, or ${phasedClause}${discountClause}`;
}

export function resolveValidity(isPreview: boolean, validUntil: string | null): string {
  if (isPreview) return "Quoted pricing holds until 2 September 2026, after which a fresh scan is required";
  return validUntil
    ? `Quoted pricing holds until ${validUntil}, after which a fresh scan is required`
    : "No fixed hold date is quoted for this scope";
}

/* ------------------------------------------------------------------ *
 * Section 3 Telemetry row + the two rows the original switch hardcoded
 * Halden's own numbers into directly (found on #292's audit — neither was
 * routed through `previewStatementOfWork.ts`'s fixture at all).
 * ------------------------------------------------------------------ */

/** "Findings in scope" — the design hardcoded "of 41" as the tenant's total finding count. A live tenant states its own real total, or omits the clause when that too is unmeasured. */
export function resolveFindingsInScope(
  isPreview: boolean,
  findingsInScope: number | null,
  totalFindings: number | null,
): string {
  if (isPreview) {
    return findingsInScope === null
      ? "Not itemised per phase on this statement of work"
      : `${findingsInScope} of 41 findings addressed by the selected phases`;
  }
  if (findingsInScope === null) return "Not itemised per phase on this statement of work";
  return totalFindings === null
    ? `${findingsInScope} findings addressed by the selected phases`
    : `${findingsInScope} of ${totalFindings} findings addressed by the selected phases`;
}

/** "Objective target" — the design hardcoded "41 of 100 today" as the tenant's current score. */
export function resolveProjected(
  isPreview: boolean,
  currentScore: number | null,
  projected: number | null,
  gate: number,
): string {
  if (isPreview) return `41 of 100 today · ${projected} on this scope · ${gate} is safe to deploy`;
  // The reason, restated for what actually produces a null here now. It used to
  // read "no pillar in this scope has a score", which was written when the
  // projection was a mean over pillar scores. It is `projectedFromPhases()`
  // below that decides this, and what it declines on is a scope whose phases
  // assert no score movement at all — see its own note.
  if (projected === null) return "No projection — this scope's phases quote prices, not projected pillar scores";
  const todayClause = currentScore === null ? "unmeasured today" : `${currentScore} of 100 today`;
  return `${todayClause} · ${projected} on this scope · ${gate} is safe to deploy`;
}

/* ------------------------------------------------------------------ *
 * The engine-sourced live scope (no stored document row)
 * ------------------------------------------------------------------ *
 *
 * The resolvers below exist because `journeyScopeFromOffers()` (see
 * `sowLiveScope.ts`) supplies a scope with no durations and no score movement,
 * and the design's own copy assumes both. Each was previously a bare format call
 * that turned a missing figure into a stated one:
 *
 *   • `weeksLabel(totals.weeks)` → "approx. 0 weeks", over a scope that quoted
 *     no timeline at all, on a page with a price on it. `computeTotals().weeks`
 *     sums a field flattened from `null` to `0`, so it cannot tell "runs zero
 *     weeks" from "quoted no duration". `weeksQuoted` can, which is exactly why
 *     `quotedWeeks()` exists on the proposal screen.
 *   • `totals.projectedScore` → `0`, the mean of flat `scoreTo`s, which rendered
 *     as "0 · 82 points short of the gate". That is a forecast this platform
 *     never made. It PREDATES this change — a SOW mapped from a stored document
 *     is flat too (`journeyScopeFromSow.toPhase()` sets both ends to 0
 *     deliberately) — so it was already wrong for every live tenant; it is fixed
 *     here rather than left to become the universal reading.
 *
 * Preview is untouched. The design's fixture quotes real per-phase weeks and
 * real score movement, so every `isPreview` branch below returns exactly the
 * string the design rendered before.
 */

/**
 * Whole weeks across the phases handed in, or `null` when not one of them quoted
 * a duration.
 *
 * The same rule `quotedWeeks()` applies on the proposal screen — "ANY included
 * phase quoted a duration", not "all of them did". A scope quoting three
 * durations out of five has a real, if partial, timeline, and the platform's own
 * SOW selector guards the same field the same way.
 */
export function quotedWeeksOf(
  phases: readonly { readonly weeksQuoted: number | null }[],
): number | null {
  let weeks = 0;
  let anyQuoted = false;
  for (const p of phases) {
    if (typeof p.weeksQuoted !== "number") continue;
    weeks += p.weeksQuoted;
    anyQuoted = true;
  }
  return anyQuoted ? weeks : null;
}

/** The summary timeline, beside the phase count in the totals block. */
export function resolveTimeline(isPreview: boolean, weeks: number | null): string {
  if (isPreview) return `approx. ${weeks ?? 0} weeks`;
  return weeks === null ? "timeline set at kickoff" : `approx. ${weeks} weeks`;
}

/** Section 3's engagement-duration row. */
export function resolveWeeksRow(isPreview: boolean, weeks: number | null): string {
  if (isPreview) return `approx. ${weeks ?? 0} weeks to certification`;
  return weeks === null
    ? "Set at kickoff — no phase on this scope quotes a duration"
    : `approx. ${weeks} weeks to certification`;
}

/** The right-hand cell on one Delivery Timeline row. */
export function resolvePhaseDuration(
  isPreview: boolean,
  included: boolean,
  weeksQuoted: number | null,
): string {
  if (!included) return "Out of scope";
  if (isPreview) return `${weeksQuoted ?? 0} ${weeksQuoted === 1 ? "week" : "weeks"}`;
  return weeksQuoted === null ? "Duration: not quoted" : `${weeksQuoted} ${weeksQuoted === 1 ? "week" : "weeks"}`;
}

/**
 * The projected readiness this scope claims, or `null` when it claims none.
 *
 * A phase whose `scoreFrom` equals its `scoreTo` asserts no movement. Where
 * EVERY phase is flat — which is every phase the Sales Offer Engine produces,
 * and every phase mapped from a stored SOW's pricing lines, because neither
 * carries a projected pillar score — the mean of those flat values is not a
 * projection, it is arithmetic over nothing.
 *
 * `fallback` is `computeTotals().projectedScore`, passed rather than recomputed
 * so the design's own fixture (which DOES quote real per-phase movement) keeps
 * producing the identical number through the identical arithmetic.
 */
export function projectedFromPhases(
  phases: readonly { readonly scoreFrom: number; readonly scoreTo: number }[],
  fallback: number | null,
): number | null {
  if (phases.length === 0) return fallback;
  return phases.some((p) => p.scoreTo !== p.scoreFrom) ? fallback : null;
}

/**
 * The signature block's copy when the contract is readable but not signable.
 *
 * SIGNING IS NOT HIDDEN FOR PRESENTATION REASONS. `POST
 * /portal/assessment/sow/checkout` writes an `assessment_sow_agreements` row
 * whose `doc_id` is a stored `insights_generated_documents` id, and `GET
 * .../sow/payment-options` reads its totals off that same row. With no stored
 * document there is no agreement to record and no payment that can be taken — a
 * sign button here would execute a contract into a checkout that cannot accept
 * it, which is worse than not offering one.
 *
 * The copy says that in the customer's terms and deliberately does NOT imply a
 * generation step they are waiting on: the scope and its prices are final and on
 * the page above. What is outstanding is issuing it as a signable document.
 */
export const SOW_UNSIGNABLE = {
  eyebrow: "Scope confirmed — not yet issued for signature",
  blurb:
    "Every phase and price above is your own, set against the findings your assessment actually recorded. Issuing this as a signable agreement is the last step, and your assessment lead takes it with you: they confirm the scope you have set here, and the signature and payment options follow on the agreement itself.",
} as const;
