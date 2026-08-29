/**
 * billingData.ts — the Billing page fixture (Part 12).
 *
 * EXTRACTED from the prototype's `BILL_TIER_CARDS` (Customer Portal Shell.dc.html
 * 15510-15514), `BILL_ADDONS` (15515-15521), `BILL_ONEOFFS` (15524-15529), the
 * retainer price (15573), `billStreams` seed (15578-15585) and `billReceipts`
 * (19655-19660). Every string is the design's, verbatim.
 *
 * ── The third tier is Premier, not Command (#1128) ──────────────────────────
 * The shell carries TWO tier ladders that disagree on the third tier. `BILL_TIERS`
 * (shell 15478) names it "Premier" at 2350; `BILL_TIER_CARDS` (shell 15510),
 * which is the ladder THIS billing page's cards render, names it "Command" at
 * 1980. Per #1128 the NAME is settled platform-wide — Premier, never Command — so
 * the third card is named Premier here. The PRICE is still open: this page shows
 * 1980 because that is the number the card ladder it renders carries; the other
 * ladder prices Premier at 2350. That discrepancy is flagged for Shane and must
 * be resolved before this page carries real money (real prices aren't in the
 * services catalog yet). See PLATFORM_BUILD.md.
 *
 * UI-only: design content for the fictional Halden Materials tenant. A later pass
 * reuses the live Stripe integration; nothing bills here.
 */

/* ── Header + section copy — shell 2378-2515 ──────────────────────────────── */

export const BILL_WHAT_YOU_PAY = "What you pay";
export const BILL_A_MONTH_PREFIX = "a month · next charge";
export const BILL_NEXT_CHARGE = "1 September 2026";
export const BILL_MONTHLY = "Monthly";
export const BILL_YEARLY = "Yearly";
export const BILL_MONITORING_KICKER = "Monitoring plan";
export const BILL_MONITORING_NOTE =
  "Change it here. It takes effect immediately and Stripe prorates the difference.";
export const BILL_ADDONS_KICKER = "Add-on modules";
export const BILL_ADDONS_NOTE = "One tap on, one tap off. Prorated to the day.";
export const BILL_ONEOFF_KICKER = "One-time work";
export const BILL_ONEOFF_NOTE = "Bought once, charged once.";
export const BILL_DELIVERY_PREFIX = "Delivery ·";
export const BILL_BUY_IT = "Buy it";
export const BILL_RECEIPTS_KICKER = "Receipts";
export const BILL_RECEIPTS_NOTE =
  "Everything is charged through Stripe, which issues the receipt. There is nothing to chase and no card details held here.";
export const BILL_RECEIPT_BTN = "Receipt";
export const BILL_MANAGE_STRIPE = "Manage payment in Stripe";
export const BILL_PAUSE = "Pause everything";
export const BILL_CARD_LINE = "Card ending 4242 · held by Stripe, not by us";

/* ── Plan state — GET /api/portal/billing/subscriptions (Git #1611) ───────── */

export const BILL_PLAN_KICKER = "Your plan";
export const BILL_PLAN_NOTE = "Live from Stripe — status, renewal and seats as billed today.";
export const BILL_PLAN_EMPTY = "No active recurring subscriptions on this account yet.";
export const BILL_PLAN_ERROR = "Couldn't load your plan just now. Try again shortly.";
export const BILL_PLAN_SEATS_SUFFIX = " seats";
export const BILL_PLAN_RENEWS_PREFIX = "Renews";
export const BILL_PLAN_ENDS_PREFIX = "Access ends";
export const BILL_PLAN_CANCELLING_NOTE = "Cancels at the end of the current period";
export const BILL_PLAN_NO_STRIPE_LINK = "No linked Stripe subscription";

/** The retainer line's monthly price — shell `billRetainerPrice` (15573). */
export const BILL_RETAINER_PRICE = 2400;

/** The one-time item bought this year, for the streams sub-line — shell 15585. */
export const BILL_ONEOFF_THIS_YEAR = 4500;

export type BillTierKey = "foundation" | "growth" | "premier";

/** The tenant that is currently subscribed — shell `billTierNow` seed (15570). */
export const BILL_CURRENT_TIER: BillTierKey = "growth";

export interface BillTierCard {
  key: BillTierKey;
  name: string;
  price: number;
  blurb: string;
  has: readonly string[];
  lacks: readonly string[];
}

/** prototype `BILL_TIER_CARDS` (15510-15514), third tier renamed to Premier. */
export const BILL_TIER_CARDS: readonly BillTierCard[] = [
  {
    key: "foundation",
    name: "Foundation",
    price: 690,
    blurb: "Daily scans, findings and evidence export.",
    has: ["Six-pillar daily scan", "Findings with evidence", "Runbook library", "Evidence packs"],
    lacks: ["Automated fixes", "Drift detection", "Webhooks"],
  },
  {
    key: "growth",
    name: "Growth",
    price: 1180,
    blurb: "Everything in Foundation, and we can act.",
    has: ["Everything in Foundation", "Automated fixes through Graph", "Configuration drift detection", "Webhook delivery"],
    lacks: ["Change control module", "Named response window"],
  },
  {
    key: "premier",
    name: "Premier",
    price: 1980,
    blurb: "The full operating model, with change control.",
    has: ["Everything in Growth", "Change control module", "Policy decisions and CAB", "4-hour response window", "Quarterly board pack"],
    lacks: [],
  },
];

export type BillAddonKey = "cc" | "adoption" | "copilot" | "sentinel" | "afterhours";

export interface BillAddon {
  key: BillAddonKey;
  name: string;
  price: number;
  blurb: string;
  /** The seed on/off state — shell `BILL_ADDONS[*].on`. */
  on: boolean;
}

/** prototype `BILL_ADDONS` (15515-15521). */
export const BILL_ADDONS: readonly BillAddon[] = [
  { key: "cc", name: "Change Control", price: 320, blurb: "Every tenant change with a request, two signatures and a rollback point. Gates every action in the portal.", on: true },
  { key: "adoption", name: "White-Glove Adoption", price: 690, blurb: "Enablement sessions, champion support and the monthly adoption pack per department.", on: true },
  { key: "copilot", name: "Copilot Programme", price: 540, blurb: "Readiness gate, grounding clean-up and per-department enablement for Copilot.", on: false },
  { key: "sentinel", name: "Sentinel Streaming", price: 260, blurb: "Every finding, drift and change event streamed to your SIEM as it happens.", on: false },
  { key: "afterhours", name: "After-hours Windows", price: 380, blurb: "Change windows outside 08:00–18:00, including weekends, without a per-change fee.", on: false },
];

export interface BillOneOff {
  key: string;
  name: string;
  /** A number for a fixed fee, or a string like "From $9,000" for a quote. */
  price: number | string;
  blurb: string;
  when: string;
}

/** prototype `BILL_ONEOFFS` (15524-15529). */
export const BILL_ONEOFFS: readonly BillOneOff[] = [
  { key: "assess", name: "Copilot Readiness Assessment", price: 4500, blurb: "Full six-pillar scan, the gate score and a written plan to clear it.", when: "Two weeks" },
  { key: "migrate", name: "Tenant-to-tenant migration", price: "From $9,000", blurb: "Scoped after a discovery call. Mailboxes, sites, Teams and identity.", when: "Quoted" },
  { key: "ir", name: "Incident response retainer top-up", price: 2000, blurb: "A block of 10 hours held for incident work, valid twelve months.", when: "Immediate" },
  { key: "board", name: "Board pack, one-off", price: 850, blurb: "The quarterly pack produced once, for a specific meeting.", when: "Five working days" },
];

export interface BillReceiptSeed {
  date: string;
  what: string;
  ref: string;
  /** A literal amount for one-time rows; null means "the current monthly total". */
  amount: string | null;
}

/** prototype `billReceipts` (19655-19660). The recurring rows show the live
 *  monthly total, so their amount is filled in by the model rather than fixed. */
export const BILL_RECEIPTS: readonly BillReceiptSeed[] = [
  { date: "1 Aug 2026", what: "Tenant Monitoring · Growth, Architect Retainer, add-ons", ref: "rcpt_1Q8mR4", amount: null },
  { date: "1 Jul 2026", what: "Tenant Monitoring · Growth, Architect Retainer, add-ons", ref: "rcpt_1Q4nT9", amount: null },
  { date: "1 Jun 2026", what: "Tenant Monitoring · Growth, Architect Retainer, add-ons", ref: "rcpt_1Q0pV2", amount: null },
  { date: "12 Mar 2026", what: "Copilot Readiness Assessment · one-time", ref: "rcpt_1P4kX2", amount: "$4,500" },
  { date: "1 Mar 2026", what: "Tenant Monitoring · Growth, Architect Retainer", ref: "rcpt_1P2jW8", amount: "$3,580" },
];

/** The four billing "streams" — shell 15578-15585. Prices are derived; the
 *  labels, sub-lines and tones are fixed here. */
export interface BillStreamSeed {
  key: "monitoring" | "retainer" | "addons" | "oneoff";
  label: string;
  sub: string;
  tone: string;
  /** True for the annual one-off, whose price carries no "/mo" suffix. */
  oneTime?: boolean;
}

export const BILL_STREAM_SEEDS: readonly BillStreamSeed[] = [
  { key: "monitoring", label: "Monitoring", sub: "", tone: "#60a5fa" },
  { key: "retainer", label: "Architect retainer", sub: "8 hours a month · 5.5 used, 2.0 rolled forward", tone: "#a78bfa" },
  { key: "addons", label: "Add-on modules", sub: "", tone: "#2dd4bf" },
  { key: "oneoff", label: "One-time this year", sub: "1 purchase · Copilot Readiness Assessment", tone: "#fbbf24", oneTime: true },
];

/** The monitoring stream's sub-line suffix — shell 15581. */
export const BILL_MONITORING_STREAM_SUFFIX = " · tenant-wide, not per seat";
