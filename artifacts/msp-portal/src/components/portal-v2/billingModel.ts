/**
 * billingModel.ts — the Billing derivations (Part 12).
 *
 * Transcribes the prototype's billing maths (Customer Portal Shell.dc.html
 * 15570-15644, 19645-19661): the monthly total, the yearly saving, the four
 * streams, the tier-card deltas/badges and the add-on totals. Named and tested
 * here so a wrong total or saving can't render as a plausible number.
 *
 * The third tier is Premier (never Command) per #1128 — see billingData.ts. Its
 * price (1980 here, vs 2350 on the other ladder) is the still-open discrepancy
 * flagged for Shane; the maths below is agnostic to which number wins.
 */

import {
  BILL_ADDONS,
  BILL_CURRENT_TIER,
  BILL_MONITORING_STREAM_SUFFIX,
  BILL_ONEOFF_THIS_YEAR,
  BILL_RECEIPTS,
  BILL_RETAINER_PRICE,
  BILL_STREAM_SEEDS,
  BILL_TIER_CARDS,
  type BillAddonKey,
  type BillTierCard,
  type BillTierKey,
} from "./billingData";

/** '$' + thousands-grouped integer — prototype `fmt$` (15577). */
export function fmt$(n: number): string {
  return "$" + Number(n).toLocaleString("en-US");
}

/** The billing page's local state — the four things the design lets you change. */
export interface BillState {
  /** Live tier — prototype `billTierLive` (15570), defaults to the current plan. */
  tier: BillTierKey;
  /** Per-add-on overrides on top of the seed on/off — prototype `billAddons`. */
  addons: Partial<Record<BillAddonKey, boolean>>;
  /** Monthly vs yearly toggle — prototype `billYearly` (15507). */
  yearly: boolean;
  /** Which tier card is mid-switch — prototype `billPick` (15508). */
  pick: BillTierKey | null;
}

export const BILL_STATE_SEED: BillState = {
  tier: BILL_CURRENT_TIER,
  addons: {},
  yearly: false,
  pick: null,
};

/** Whether an add-on is on — prototype `billAddonOn` (15523): override, else seed. */
export function billAddonOn(addons: BillState["addons"], key: BillAddonKey): boolean {
  const override = addons[key];
  if (override !== undefined) return override;
  return BILL_ADDONS.find((a) => a.key === key)?.on ?? false;
}

/** Sum of the switched-on add-ons — prototype `billAddonTotal` (15571). */
export function billAddonTotal(addons: BillState["addons"]): number {
  return BILL_ADDONS.filter((a) => billAddonOn(addons, a.key)).reduce((t, a) => t + a.price, 0);
}

/** How many add-ons are on — for the streams sub-line. */
export function billAddonOnCount(addons: BillState["addons"]): number {
  return BILL_ADDONS.filter((a) => billAddonOn(addons, a.key)).length;
}

function tierCard(tier: BillTierKey): BillTierCard {
  return BILL_TIER_CARDS.find((t) => t.key === tier) ?? BILL_TIER_CARDS[1];
}

/** The live tier's monthly price — prototype `billTierPrice` (15572). */
export function billTierPrice(tier: BillTierKey): number {
  return tierCard(tier).price;
}

/** The full monthly recurring total — prototype `billMonthly` (15574). */
export function billMonthly(state: BillState): number {
  return billTierPrice(state.tier) + BILL_RETAINER_PRICE + billAddonTotal(state.addons);
}

/** The yearly price (ten months) — prototype `billYearPrice` (15575). */
export function billYearPrice(monthly: number): number {
  return Math.round(monthly * 10);
}

/** The annual saving — prototype `billSaving` (15576). */
export function billSaving(monthly: number): number {
  return monthly * 12 - billYearPrice(monthly);
}

/** The saving label — prototype 15650. */
export function billSavingLabel(yearly: boolean, saving: number): string {
  return yearly ? `Saving ${fmt$(saving)} a year` : `Pay yearly and save ${fmt$(saving)}`;
}

export interface BillStreamView {
  key: string;
  label: string;
  sub: string;
  price: string;
  tone: string;
}

/** The four spend streams — prototype `billStreams` (15578-15592). */
export function billStreams(state: BillState): readonly BillStreamView[] {
  const tierName = tierCard(state.tier).name;
  const prices: Record<string, number> = {
    monitoring: billTierPrice(state.tier),
    retainer: BILL_RETAINER_PRICE,
    addons: billAddonTotal(state.addons),
    oneoff: BILL_ONEOFF_THIS_YEAR,
  };
  return BILL_STREAM_SEEDS.map((s) => {
    const sub =
      s.key === "monitoring"
        ? tierName + BILL_MONITORING_STREAM_SUFFIX
        : s.key === "addons"
          ? `${billAddonOnCount(state.addons)} of ${BILL_ADDONS.length} switched on`
          : s.sub;
    return {
      key: s.key,
      label: s.label,
      sub,
      price: fmt$(prices[s.key]) + (s.oneTime ? "" : "/mo"),
      tone: s.tone,
    };
  });
}

export interface BillTierCardView {
  key: BillTierKey;
  name: string;
  blurb: string;
  price: string;
  per: string;
  isNow: boolean;
  isPick: boolean;
  badge: string;
  deltaLabel: string;
  has: readonly string[];
  lacks: readonly string[];
}

/** The tier cards, priced for the interval and badged by delta — prototype 15593-15612. */
export function billTierCards(state: BillState): readonly BillTierCardView[] {
  const current = billTierPrice(state.tier);
  return BILL_TIER_CARDS.map((t) => {
    const isNow = t.key === state.tier;
    const delta = t.price - current;
    return {
      key: t.key,
      name: t.name,
      blurb: t.blurb,
      price: fmt$(state.yearly ? Math.round(t.price * 10) : t.price),
      per: state.yearly ? "/year" : "/month",
      isNow,
      isPick: state.pick === t.key,
      badge: isNow ? "Your plan" : delta > 0 ? "Upgrade" : "Downgrade",
      deltaLabel:
        delta === 0 ? "" : `${delta > 0 ? "+" : "−"}${fmt$(Math.abs(delta))}/mo from today, prorated`,
      has: t.has,
      lacks: t.lacks,
    };
  });
}

export interface BillAddonCardView {
  key: BillAddonKey;
  name: string;
  blurb: string;
  price: string;
  on: boolean;
  stateLabel: string;
}

/** The add-on cards — prototype `billAddonCards` (15614-15628). */
export function billAddonCards(state: BillState): readonly BillAddonCardView[] {
  return BILL_ADDONS.map((a) => {
    const on = billAddonOn(state.addons, a.key);
    return { key: a.key, name: a.name, blurb: a.blurb, price: fmt$(a.price) + "/mo", on, stateLabel: on ? "On" : "Add it" };
  });
}

export interface BillOneOffCardView {
  key: string;
  name: string;
  blurb: string;
  when: string;
  price: string;
}

export interface BillReceiptView {
  date: string;
  what: string;
  ref: string;
  amount: string;
}

/** The receipts list — prototype `billReceipts` (19655-19660): the recurring
 *  rows carry the live monthly total. */
export function billReceipts(monthly: number): readonly BillReceiptView[] {
  const monthlyLabel = fmt$(monthly);
  return BILL_RECEIPTS.map((r) => ({ date: r.date, what: r.what, ref: r.ref, amount: r.amount ?? monthlyLabel }));
}
