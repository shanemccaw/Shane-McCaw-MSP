/**
 * journeyPricing.ts — the scope arithmetic behind the SOW Proposal and the
 * Checkout summary.
 *
 * NO PRICE IS DECLARED IN THIS FILE. Every figure arrives on a payload —
 * remediation phases come from `GET /api/portal/assessment/sow` (workstreams,
 * `priceUsd`) and the pay-in-full / phased split from
 * `GET /api/portal/assessment/sow/payment-options`; the optional-service tiers
 * come from the products catalogue. This module only decides what the selected
 * set adds up to, which is the part worth testing and the part that must not
 * disagree between the proposal and the confirmation screen.
 *
 * Keeping it here rather than inside a component is also what keeps the
 * platform's no-hardcoding rule honest: a grep for literal prices across `.tsx`
 * finds nothing for this journey, because the components render what these
 * functions return.
 */

import type { PillarKey } from "./journeyTokens.ts";

/* ------------------------------------------------------------------ *
 * Inputs
 * ------------------------------------------------------------------ */

/**
 * Git #593's Gantt sequencing bucket, keyed on phase TYPE (not position —
 * which phases appear varies by tenant): Foundation always renders first,
 * Closeout always last, Parallel-eligible phases overlap/any order among
 * themselves, Continuous has no bounded duration and renders as a background
 * band. Real values come from `services.type_attributes.stage`
 * (2026-08-08-sow-phase-stage-duration-593.sql) — see `sowLiveScope.ts`'s
 * `normalizeStage()` for how an unrecognised wire string becomes `null`
 * rather than a guess.
 */
export type JourneyPhaseStage = "foundation" | "parallel-eligible" | "closeout" | "continuous";

export interface JourneyPhase {
  /** Stable identity — the workstream title the SOW document uses. */
  readonly id: string;
  /** "Identity & Access Hardening". */
  readonly title: string;
  /** Which pillar's findings this phase closes. Drives the identity swatch. */
  readonly pillar: PillarKey;
  /** Scope prose, capped at ~52ch by the layout. */
  readonly scope: string;
  /** Whole dollars. `sow_pricing_lines.priceUsd` is dollars, not cents — this is
   *  the one place the platform's cents rule does not hold, so it is not
   *  silently converted here. */
  readonly priceUsd: number;
  /** Estimated weeks, used only for the "approx. N weeks" summary line. */
  readonly weeks: number;
  /** The pillar score today. */
  readonly scoreFrom: number;
  /** The pillar score once this phase lands. */
  readonly scoreTo: number;
  /** The findings line — "Addresses: 212 sites shared org-wide". */
  readonly addresses: string;
  /**
   * How many assessment findings this phase closes. The SOW's telemetry section
   * counts them across the phases actually in scope, so the number moves when
   * the customer removes one — which is the whole point of stating it on a
   * contract they are about to sign.
   *
   * OPTIONAL because the platform's own SOW wire format does not carry it:
   * `journeyScopeFromSow.ts` builds phases from quoted workstream lines, which
   * have a price and a scope but no finding tally. A consumer must render the
   * absence rather than treat it as zero.
   */
  readonly findingCount?: number;
  /**
   * Phase 1 is required: it is the identity work that lands before Copilot is
   * enabled for anyone. A locked phase must be genuinely inert, not a working
   * toggle wearing a "Required" badge, so this flag drives both the disabled
   * rendering AND the absence of a click handler.
   */
  readonly locked: boolean;
  /**
   * Git #593's Gantt bucket. `null`/absent where this phase's source carries
   * none — a stored-document workstream (`journeyScopeFromSow.ts`) never has
   * one, so the Gantt falls back to rendering it as a plain sequential bar
   * rather than guessing a stage.
   */
  readonly stage?: JourneyPhaseStage | null;
}

export interface JourneyTier {
  readonly id: string;
  readonly label: string;
  /** One-off setup in whole dollars. 0 where the service is purely recurring. */
  readonly upfrontUsd: number;
  /** Recurring monthly in whole dollars. 0 where the service is purely one-off. */
  readonly monthlyUsd: number;
  /** "1,000–2,500 seats" or "Team-run setup, live sessions". */
  readonly detail: string;
  /**
   * The badge above the price. Monitoring tiers are seat-banded so the matching
   * one is genuinely "your seat count"; adoption tiers are described by delivery
   * model, so the middle one is only ever "recommended" — calling it "your seat
   * count" would assert a band that does not exist.
   */
  readonly emphasis?: "seat-match" | "recommended";
}

export interface JourneyAddon {
  readonly id: string;
  readonly title: string;
  readonly blurb: string;
  readonly tiers: readonly JourneyTier[];
  /** Whether the toggle starts on. */
  readonly defaultOn: boolean;
  /** Which tier starts selected. */
  readonly defaultTierId: string | null;
  /** Git #593 — set to `"continuous"` for an always-on recurring service (Tenant Monitoring); absent otherwise. */
  readonly stage?: "continuous";
}

export interface JourneyScopeInput {
  readonly phases: readonly JourneyPhase[];
  readonly addons: readonly JourneyAddon[];
}

export interface JourneySelection {
  /** Phase id → included. A locked phase is always included regardless. */
  readonly phases: Readonly<Record<string, boolean>>;
  /** Addon id → included. */
  readonly addons: Readonly<Record<string, boolean>>;
  /** Addon id → selected tier id. */
  readonly tiers: Readonly<Record<string, string>>;
}

/* ------------------------------------------------------------------ *
 * Selection helpers
 * ------------------------------------------------------------------ */

export function defaultSelection(scope: JourneyScopeInput): JourneySelection {
  const phases: Record<string, boolean> = {};
  scope.phases.forEach((p) => {
    phases[p.id] = true;
  });
  const addons: Record<string, boolean> = {};
  const tiers: Record<string, string> = {};
  scope.addons.forEach((a) => {
    addons[a.id] = a.defaultOn;
    if (a.defaultTierId) tiers[a.id] = a.defaultTierId;
    else if (a.tiers.length) tiers[a.id] = a.tiers[0].id;
  });
  return { phases, addons, tiers };
}

/** A locked phase can never be dropped — the toggle has no handler at all. */
export function togglePhase(
  scope: JourneyScopeInput,
  selection: JourneySelection,
  phaseId: string,
): JourneySelection {
  const phase = scope.phases.find((p) => p.id === phaseId);
  if (!phase || phase.locked) return selection;
  return {
    ...selection,
    phases: { ...selection.phases, [phaseId]: !selection.phases[phaseId] },
  };
}

export function toggleAddon(selection: JourneySelection, addonId: string): JourneySelection {
  return {
    ...selection,
    addons: { ...selection.addons, [addonId]: !selection.addons[addonId] },
  };
}

/** Picking a tier also switches the addon on — clicking a price is intent to buy. */
export function pickTier(
  selection: JourneySelection,
  addonId: string,
  tierId: string,
): JourneySelection {
  return {
    ...selection,
    addons: { ...selection.addons, [addonId]: true },
    tiers: { ...selection.tiers, [addonId]: tierId },
  };
}

export function isPhaseIncluded(
  scope: JourneyScopeInput,
  selection: JourneySelection,
  phaseId: string,
): boolean {
  const phase = scope.phases.find((p) => p.id === phaseId);
  if (!phase) return false;
  return phase.locked || selection.phases[phaseId] === true;
}

/* ------------------------------------------------------------------ *
 * Totals
 * ------------------------------------------------------------------ */

export interface JourneyAddonLine {
  readonly addonId: string;
  readonly addonTitle: string;
  readonly tier: JourneyTier;
}

export interface JourneyTotals {
  /** Remediation phases only. */
  readonly oneOffUsd: number;
  /**
   * What actually leaves the account today: the remediation total PLUS any
   * one-off setup fee on a selected optional service. The sticky header is
   * labelled "Today {upfront} then {monthly}" precisely so this figure cannot
   * silently drop a line item on a screen the customer signs.
   */
  readonly upfrontUsd: number;
  /** Everything recurring, per month. */
  readonly monthlyUsd: number;
  readonly includedPhaseCount: number;
  readonly totalPhaseCount: number;
  readonly weeks: number;
  /** Selected optional services carrying a one-off, for the summary rail. */
  readonly addonLines: readonly JourneyAddonLine[];
  /** Names of everything recurring, for "Monitoring + Retainer, cancel with 30 days". */
  readonly recurringNames: readonly string[];
  /**
   * Readiness after this scope: the mean of the six resulting pillar scores, so
   * removing a phase visibly costs points. `null` when no pillar in the scope
   * has a real score — better nothing than a mean of fabrications.
   */
  readonly projectedScore: number | null;
}

export function computeTotals(
  scope: JourneyScopeInput,
  selection: JourneySelection,
): JourneyTotals {
  let oneOffUsd = 0;
  let weeks = 0;
  let includedPhaseCount = 0;
  const resultingScores: number[] = [];

  scope.phases.forEach((p) => {
    const on = isPhaseIncluded(scope, selection, p.id);
    if (on) {
      oneOffUsd += p.priceUsd;
      weeks += p.weeks;
      includedPhaseCount += 1;
    }
    resultingScores.push(on ? p.scoreTo : p.scoreFrom);
  });

  let addonUpfront = 0;
  let monthlyUsd = 0;
  const addonLines: JourneyAddonLine[] = [];
  const recurringNames: string[] = [];

  scope.addons.forEach((a) => {
    if (!selection.addons[a.id]) return;
    const tierId = selection.tiers[a.id];
    const tier = a.tiers.find((t) => t.id === tierId) ?? a.tiers[0];
    if (!tier) return;
    if (tier.upfrontUsd > 0) {
      addonUpfront += tier.upfrontUsd;
      addonLines.push({ addonId: a.id, addonTitle: a.title, tier });
    }
    if (tier.monthlyUsd > 0) {
      monthlyUsd += tier.monthlyUsd;
      recurringNames.push(a.title);
    }
  });

  return {
    oneOffUsd,
    upfrontUsd: oneOffUsd + addonUpfront,
    monthlyUsd,
    includedPhaseCount,
    totalPhaseCount: scope.phases.length,
    weeks,
    addonLines,
    recurringNames,
    projectedScore: resultingScores.length
      ? Math.round(resultingScores.reduce((a, b) => a + b, 0) / resultingScores.length)
      : null,
  };
}

/* ------------------------------------------------------------------ *
 * Phased payment schedule
 * ------------------------------------------------------------------ */

export interface ScheduleRow {
  readonly when: string;
  readonly amountUsd: number;
}

/**
 * The phased plan: a deposit today, then each remaining phase invoiced on the
 * day that phase is signed off as complete. Phases beyond the third are grouped
 * into one closing row so the schedule stays readable at six phases.
 *
 * Every row is `price × (1 - depositFraction)` — the deposit is taken evenly
 * across the programme rather than consuming the earliest phases, so a customer
 * who stops after Phase 2 has not overpaid for work they did not take.
 */
export function phasedSchedule(
  scope: JourneyScopeInput,
  selection: JourneySelection,
  depositPct: number,
): ScheduleRow[] {
  const totals = computeTotals(scope, selection);
  const pct = Math.max(0, Math.min(100, depositPct)) / 100;
  const rest = 1 - pct;
  const rows: ScheduleRow[] = [{ when: "Deposit — today", amountUsd: totals.oneOffUsd * pct }];

  const included = scope.phases.filter((p) => isPhaseIncluded(scope, selection, p.id));
  const detailed = included.slice(0, 3);
  const grouped = included.slice(3);

  detailed.forEach((p, i) => {
    rows.push({
      when: `On Phase ${i + 1} sign-off — ${p.title}`,
      amountUsd: p.priceUsd * rest,
    });
  });

  if (grouped.length === 1) {
    rows.push({
      when: `On Phase ${included.length} sign-off — ${grouped[0].title}`,
      amountUsd: grouped[0].priceUsd * rest,
    });
  } else if (grouped.length > 1) {
    const from = detailed.length + 1;
    rows.push({
      when: `On Phases ${from}–${included.length} sign-off`,
      amountUsd: grouped.reduce((sum, p) => sum + p.priceUsd, 0) * rest,
    });
  }

  return rows;
}

export function depositAmountUsd(totals: JourneyTotals, depositPct: number): number {
  const pct = Math.max(0, Math.min(100, depositPct)) / 100;
  return totals.oneOffUsd * pct;
}

/* ------------------------------------------------------------------ *
 * Formatting
 * ------------------------------------------------------------------ */

/** `$36,200`. Rounded, because a scope total with cents reads as an estimate. */
export function money(usd: number): string {
  return `$${Math.round(usd).toLocaleString("en-US")}`;
}

/** `$1,480/mo`, or an honest phrase when nothing recurs. */
export function monthlyLabel(usd: number): string {
  return usd > 0 ? `${money(usd)}/mo` : "nothing recurring";
}

export function recurringLabel(names: readonly string[]): string {
  return names.length
    ? `${names.join(" + ")}, cancel with 30 days`
    : "No optional services added";
}

export function phaseCountLabel(included: number, total: number): string {
  return `${included} of ${total} phases`;
}

export function weeksLabel(weeks: number): string {
  return `approx. ${weeks} weeks`;
}

/* ------------------------------------------------------------------ *
 * The live pay-in-full discount
 * ------------------------------------------------------------------ */

/**
 * The platform's pay-in-full discount, exactly as
 * `GET /portal/assessment/sow/payment-options` reports it.
 *
 * REAL MONEY, AND IT WAS BEING DROPPED. The server computes this from a real
 * `coupons` row inside the SOW's own discount window, and
 * `POST .../sow/checkout` turns it into a genuine Stripe coupon — but ONLY when
 * the request carries `applyPayInFull: true`. The Copilot Readiness checkout
 * sent no such flag and showed no such offer, so a customer paying in full
 * through this journey was charged the undiscounted total while the same
 * customer on the older `AssessmentPaymentPlan` screen was not.
 */
export interface PayInFullOffer {
  /** What the scope costs without the discount. */
  readonly originalUsd: number;
  readonly discountedUsd: number;
  readonly savingsUsd: number;
  /**
   * `percentage_off` — a straight percentage off the total.
   * `adjustments_waived` — the platform's mandatory adjustment lines are
   * dropped instead. A different promise, so it gets different words.
   */
  readonly variant: "percentage_off" | "adjustments_waived";
  readonly discountPct: number | null;
}

/** The `payInFull` block as it arrives on the wire. Every field optional. */
export interface WirePayInFull {
  readonly active?: boolean;
  readonly discountedTotal?: number | null;
  readonly savings?: number | null;
  readonly variant?: string | null;
  readonly discountPct?: number | null;
}

/**
 * Read the wire's offer, or `null`.
 *
 * Nothing here recomputes a discount — a second arithmetic path on money is a
 * second chance to quote a figure Stripe will not honour, so every number is the
 * server's own and this function only decides whether there is an offer to show
 * at all. The server independently re-runs `computePayInFullOffer` before it
 * creates the coupon, so opting in can only ever ask, never assert.
 *
 * Refuses, in order:
 *   • the design preview — the offer needs a real coupon row and a real SOW
 *     window, and inventing a saving there would put a number in front of a
 *     reviewer that no customer will ever be charged;
 *   • anything the server did not mark `active`;
 *   • a missing, non-numeric or non-finite total or saving;
 *   • a saving of zero or less, which would otherwise print a struck-through
 *     price identical to the one beside it;
 *   • an unrecognised `variant`, because the two variants promise different
 *     things and defaulting would describe a waiver as a percentage.
 */
export function payInFullOfferFromWire(
  wire: WirePayInFull | null | undefined,
  originalUsd: number,
  isPreview: boolean,
): PayInFullOffer | null {
  if (isPreview) return null;
  if (!wire?.active) return null;
  const discountedUsd = wire.discountedTotal;
  const savingsUsd = wire.savings;
  if (typeof discountedUsd !== "number" || typeof savingsUsd !== "number") return null;
  if (!Number.isFinite(discountedUsd) || !Number.isFinite(savingsUsd)) return null;
  if (savingsUsd <= 0) return null;
  if (wire.variant !== "percentage_off" && wire.variant !== "adjustments_waived") return null;
  return {
    originalUsd,
    discountedUsd,
    savingsUsd,
    variant: wire.variant,
    discountPct: typeof wire.discountPct === "number" ? wire.discountPct : null,
  };
}
