/**
 * licDashboardData.ts — the Licensing pillar dashboard fixture.
 *
 * Transcribed from the prototype's own Licensing logic
 * (`Customer Portal Shell.dc.html` lines 12275-12600).
 *
 * ── The prototype states this pillar's thesis in its own source comment ─────
 * "This pillar is a money page, not a risk page. Every figure is monthly and
 * annual, and every recovery is labelled with WHEN it reaches the bill —
 * monthly-billed SKUs reduce now, annual commitments only reduce at renewal,
 * and reassignment changes nothing on the invoice while recovering value
 * already paid for." (12275-12279.)
 *
 * That is not decoration. It is why the page has three recovery BUCKETS rather
 * than one number, why every SKU row carries a `timing` chip, and why the
 * headline figure and the reassignable figure are deliberately kept apart —
 * $2,679/mo is money that leaves the bill, and $1,470/mo is value already paid
 * for that can be handed to someone. Collapsing them into one "savings" number
 * would misstate what the customer actually gets.
 *
 * ── What this pillar does NOT have ─────────────────────────────────────────
 * No scan strip, no status pill, no cluster area cards, and no "Licensing
 * Health" title — the hero's left column is an eyebrow, a 38px figure and a
 * sentence. It is also the only pillar HERO carrying a provenance block, which
 * the README places on drill-downs only.
 *
 * ── Design content, not tenant data ─────────────────────────────────────────
 * The prototype's fictional Halden Materials figures, in one module.
 */

export type LicTone = "red" | "amber" | "green";

/** `licTeal` (12280). */
export const LIC_TEAL = "#14B8A6";

/** `licFmt` (12323) — en-US grouping, dollar prefix, no decimals. */
export function licFmt(n: number): string {
  return "$" + n.toLocaleString("en-US");
}

/** Hero scalars — 12281-12282 and the renderVals literals at 17504-17512. */
export const LIC_HERO = {
  score: 71,
  /** Hardcoded in the ring markup (3568) and GREEN — the only pillar with a positive delta. */
  delta: "+3 this month",
  renewal: "14 March 2027",
  onTable: "$2,679",
  onTableAnnual: "$32,148 a year",
  recoveredQuarter: "$4,100",
  recoveredTotal: "$4,100",
  utilisation: "73%",
  ackMonthly: "$900",
  /** The hero's eyebrow — this pillar has no title/subtitle pair. */
  eyebrow: "Money on the table",
  trendLabel: "Cumulative recovered · last 10 scans",
  trendCaption: "$4,100/mo of recurring spend removed since scan 1 — $49,200 annualised.",
  onTableSentence:
    "$32,148 a year across 6 identified items, plus $1,470/mo of paid seats sitting idle that can be reassigned today.",
} as const;

/** `licSavedHistory` (12283) — cumulative recovered, so it only ever rises. */
export const LIC_SAVED_HISTORY: readonly number[] = [
  0, 400, 400, 900, 1340, 1340, 2100, 2760, 3450, 4100,
];

/**
 * `licTrend` (12285-12298). NOT the shared `trendGeometry`.
 *
 * The shared one pads the domain by ±3 around min and max, which is right for a
 * SCORE that hovers in a band. This series starts at 0 and is cumulative, so a
 * padded floor would lift the baseline off zero and a padded ceiling would waste
 * the top of the frame. The prototype instead anchors the floor at 0 and sets
 * the ceiling to `max * 1.12` — 12% headroom above the current total. Reusing
 * DriftTrend's maths here would draw a visibly different line.
 */
export function licTrendGeometry() {
  const w = 280;
  const h = 84;
  const max = Math.max(...LIC_SAVED_HISTORY) * 1.12;
  const pts = LIC_SAVED_HISTORY.map((v, i) => {
    const x = (i / (LIC_SAVED_HISTORY.length - 1)) * w;
    const y = h - (v / (max || 1)) * h;
    return { x: +x.toFixed(1), y: +y.toFixed(1) };
  });
  return {
    w,
    h,
    line: pts.map((p) => `${p.x},${p.y}`).join(" "),
    area:
      `M${pts[0].x},${h} L` +
      pts.map((p) => `${p.x},${p.y}`).join(" L") +
      ` L${pts[pts.length - 1].x},${h} Z`,
    lastX: pts[pts.length - 1].x,
    lastY: pts[pts.length - 1].y,
  };
}

/** The three hero stats (3572-3588). The third's value is 15px, not 22px — it is a date. */
export const LIC_HERO_STATS: readonly {
  label: string;
  value: string;
  sub: string;
  /** The renewal date renders smaller because it is prose, not a figure. */
  small?: boolean;
}[] = [
  {
    label: "Recovered this quarter",
    value: `${LIC_HERO.recoveredQuarter}/mo`,
    sub: "5 actions, all verified on re-scan",
  },
  {
    label: "Seat utilisation",
    value: LIC_HERO.utilisation,
    sub: "of purchased seats active in 30 days",
  },
  {
    label: "Next renewal",
    value: LIC_HERO.renewal,
    sub: "Reductions must be lodged before this date",
    small: true,
  },
];

/**
 * `licBuckets` (12303-12312). The three buckets are the pillar's whole argument:
 * the same tenant produces money that leaves the bill NEXT INVOICE, money that
 * can only leave AT RENEWAL, and value that never leaves the bill at all but can
 * be REASSIGNED. Note the third has no annualised figure — it says "value
 * already paid" instead, because annualising it would imply a saving.
 */
export const LIC_BUCKETS: readonly {
  label: string;
  value: string;
  annual: string;
  when: string;
  what: string;
}[] = [
  {
    label: "Removable today",
    value: "$399/mo",
    annual: "$4,788/yr",
    when: "Next invoice",
    what: "Monthly-billed SKUs that duplicate an entitlement you already own, plus idle standalone seats. Cancelling these reduces the very next invoice — no renewal date involved.",
  },
  {
    label: "Recoverable at renewal",
    value: "$2,280/mo",
    annual: "$27,360/yr",
    when: LIC_HERO.renewal,
    what: `38 unassigned E5 seats on an annual commitment. Removing the assignment frees the seat immediately, but the billed quantity can only be reduced at renewal — so this is a decision to take before ${LIC_HERO.renewal}, not a saving available this month.`,
  },
  {
    label: "Reassignable now",
    value: "$1,470/mo",
    annual: "value already paid",
    when: "34 people waiting",
    // THE ONE SANCTIONED DEVIATION FROM THE PROTOTYPE'S COPY. Line 12311 reads
    // "£1,470-worth" — a pound sign on a page denominated in dollars
    // everywhere else, including in this same sentence's own "$1,470/mo" value
    // above it. It was flagged rather than silently corrected, and Shane
    // confirmed on 2026-08-19 that it should be "$". Recorded here because
    // "copy is final" otherwise forbids exactly this edit: the rule was not
    // bypassed, it was overruled by the copy's owner.
    what: "Seats you are already paying for that nobody is using: 27 idle Copilot seats and 11 E5 licences held by disabled accounts. Reassigning changes nothing on the invoice and hands $1,470-worth of monthly capability to the 34 people currently on the request list.",
  },
];

/* ── The licence ledger — LIC_SKUS (12313-12322) ──────────────────────────── */

export interface LicSku {
  sku: string;
  part: string;
  purchased: number;
  assigned: number;
  active: number;
  unit: number;
  waste: number;
  timing: string;
  tone: LicTone;
  note: string;
}

export const LIC_TONE: Readonly<Record<LicTone, string>> = {
  red: "#f87171",
  amber: "#c2a63d",
  green: "#34d399",
};

export const LIC_SKUS: readonly LicSku[] = [
  { sku: "Microsoft 365 E5", part: "SPE_E5", purchased: 240, assigned: 202, active: 183, unit: 60, waste: 2280, timing: "At renewal", tone: "red", note: "38 unassigned seats on annual commitment" },
  { sku: "Microsoft 365 Copilot", part: "Microsoft_365_Copilot", purchased: 75, assigned: 68, active: 41, unit: 30, waste: 1020, timing: "Reassign", tone: "amber", note: "27 assigned seats with no Copilot activity in 30 days" },
  { sku: "Power BI Pro (standalone)", part: "POWER_BI_PRO", purchased: 12, assigned: 12, active: 12, unit: 14, waste: 168, timing: "Today", tone: "red", note: "Already included in every E5 licence these 12 users hold" },
  { sku: "Visio Plan 2", part: "VISIOCLIENT", purchased: 12, assigned: 9, active: 3, unit: 15, waste: 135, timing: "Today", tone: "red", note: "3 unassigned, 6 assigned with no Visio launch in 90 days" },
  { sku: "Defender for Office P1", part: "ATP_ENTERPRISE", purchased: 36, assigned: 36, active: 36, unit: 2, waste: 72, timing: "Today", tone: "amber", note: "Superseded by the Defender entitlement inside E5" },
  { sku: "Exchange Online Plan 1", part: "EXCHANGESTANDARD", purchased: 8, assigned: 8, active: 2, unit: 4, waste: 24, timing: "Today", tone: "amber", note: "6 assigned to shared mailboxes that do not require a licence" },
  { sku: "Entra ID P1 (add-on)", part: "AAD_PREMIUM", purchased: 41, assigned: 41, active: 41, unit: 6, waste: 0, timing: "Right-sized", tone: "green", note: "Fully used, and the licence that makes guest access reviews possible" },
  { sku: "Project Plan 3", part: "PROJECTPROFESSIONAL", purchased: 6, assigned: 6, active: 5, unit: 30, waste: 0, timing: "Right-sized", tone: "green", note: "One seat idle 40 days — inside normal project cadence, not flagged" },
];

/**
 * Per-row derived values (12324-12341). The utilisation bar is `active /
 * PURCHASED`, not active/assigned — the bar answers "how much of what we BOUGHT
 * is being used", which is the only ratio that maps to the invoice.
 */
export function licSkuGeometry(s: LicSku) {
  return {
    c: LIC_TONE[s.tone],
    util: Math.round((s.active / s.purchased) * 100),
    wasteLabel: s.waste ? `${licFmt(s.waste)}/mo` : "—",
    unitLabel: licFmt(s.unit),
  };
}

/** `licTotals` (12342-12347) — sums, not literals. */
export const LIC_TOTALS = {
  purchased: LIC_SKUS.reduce((a, s) => a + s.purchased, 0),
  assigned: LIC_SKUS.reduce((a, s) => a + s.assigned, 0),
  active: LIC_SKUS.reduce((a, s) => a + s.active, 0),
  waste: LIC_SKUS.reduce((a, s) => a + s.waste, 0),
};

/* ── Recovery items — LIC_FINDINGS (12348-12412) ──────────────────────────── */

export interface LicFinding {
  id: string;
  title: string;
  monthly: number;
  timing: string;
  why: string;
  evidence: { k: string; v: string }[];
  action: string;
  actionSub: string;
  fixKey: string;
}

export const LIC_FINDINGS: readonly LicFinding[] = [
  {
    id: "LIC-01",
    title: "38 E5 licences are purchased and assigned to nobody",
    monthly: 2280,
    timing: `Recoverable at renewal · ${LIC_HERO.renewal}`,
    why: "These seats have never been assigned since the last true-up. On an annual commitment the billed quantity cannot be reduced mid-term, so the money is only recoverable if the reduction is decided before renewal — after which it renews for another twelve months automatically.",
    evidence: [
      { k: "Where this comes from", v: "subscribedSkus: prepaidUnits.enabled 240, consumedUnits 202" },
      { k: "Unit cost", v: "$60.00 per seat per month on your current agreement" },
      { k: "Monthly", v: "$2,280 — annualised $27,360" },
      { k: "Billing reality", v: `Annual commitment. Seat count reduces at renewal on ${LIC_HERO.renewal}, not on the next invoice.` },
      { k: "Deadline that matters", v: "The reduction has to be lodged before renewal. Miss it and the same $27,360 commits again." },
      { k: "Headcount check", v: "The hiring plan accounts for 12 of the 38 in Q3. Those 12 are on the acknowledged-spend list, so the recoverable figure is 26 seats at $1,560/mo unless the plan changes." },
    ],
    action: "Lodge the renewal reduction for 26 seats",
    actionSub: "Keeps the 12 planned-headcount seats, recovers $18,720 a year",
    fixKey: "lic-e5-unassigned",
  },
  {
    id: "LIC-02",
    title: "27 Copilot seats have shown no activity in 30 days while 34 people are waiting for one",
    monthly: 810,
    timing: "Reassign now · no invoice change",
    why: "This is the cheapest win on the page because it costs nothing and changes nothing on the bill. Twenty-seven people hold a $30 seat they have not used in a month, and thirty-four have asked for one. Reassignment converts spend you have already committed into capability someone actually wants.",
    evidence: [
      { k: "Where this comes from", v: "reports/getMicrosoft365CopilotUsageUserDetail(period='D30') cross-referenced with assignedLicenses" },
      { k: "Assigned", v: "68 of 75 purchased" },
      { k: "Active in 30 days", v: "41 — 60% of assigned seats" },
      { k: "Idle value", v: "27 seats × $30 = $810/mo, $9,720/yr already committed" },
      { k: "Waiting list", v: "34 requests open, oldest 41 days" },
      { k: "What good looks like", v: "A 30-day idle-then-reclaim rule on Copilot seats, which keeps utilisation above 90% without anyone policing it" },
    ],
    action: "Reassign 27 idle Copilot seats from the waiting list",
    actionSub: "Notifies current holders first with a 7-day keep-or-release window",
    fixKey: "lic-copilot-reassign",
  },
  {
    id: "LIC-03",
    title: "11 E5 licences are still assigned to disabled accounts",
    monthly: 660,
    timing: "Reassign now · reduces at renewal",
    why: "Offboarding disables the account but does not remove the licence, so the seat stays consumed and unavailable. Removing the assignment frees a seat you can hand to someone on the waiting list today; the billed quantity still reduces only at renewal.",
    evidence: [
      { k: "Where this comes from", v: "users where accountEnabled eq false and assignedLicenses/$count ne 0" },
      { k: "Accounts", v: "11, disabled between 6 weeks and 8 months ago" },
      { k: "Value held", v: "$660/mo of consumed seats, $7,920/yr" },
      { k: "Mailbox consideration", v: "4 of the 11 need the mailbox retained — convert to shared or apply an inactive-mailbox hold before removing the licence, or the mailbox is deleted after 30 days" },
      { k: "Root cause", v: "The offboarding runbook has no licence-removal step. Same runbook gap that leaves Teams ownerless." },
    ],
    action: "Reclaim 11 seats, preserving the 4 mailboxes that need it",
    actionSub: "Mailbox conversion runs first; licence removal second",
    fixKey: "lic-disabled-accounts",
  },
  {
    id: "LIC-04",
    title: "12 standalone Power BI Pro licences duplicate an entitlement E5 already includes",
    monthly: 168,
    timing: "Removable today",
    why: "Every one of these twelve users holds an E5 licence, which includes Power BI Pro. The standalone subscription is being paid for a second time. It is monthly-billed, so cancellation reaches the next invoice rather than waiting for a renewal date.",
    evidence: [
      { k: "Where this comes from", v: "servicePlans comparison: POWER_BI_PRO present in both SPE_E5 and the standalone SKU for all 12 users" },
      { k: "Monthly", v: "$168 — annualised $2,016" },
      { k: "Billing", v: "Monthly subscription. Reduces on the next invoice." },
      { k: "How it happened", v: "Self-service purchase is enabled, so users bought these directly on a card without going through procurement" },
      { k: "Verification before removal", v: "Confirm no workspace depends on the standalone tenant assignment — in practice the E5 entitlement covers all 12" },
    ],
    action: "Cancel the duplicate Power BI Pro subscription",
    actionSub: "Verifies E5 entitlement coverage per user first",
    fixKey: "lic-powerbi-duplicate",
  },
  {
    id: "LIC-05",
    title: "9 Visio and 36 Defender for Office P1 seats are idle or superseded",
    monthly: 207,
    timing: "Removable today",
    why: "Six of the nine Visio seats have not launched the application in ninety days and three are unassigned. The Defender for Office P1 add-on is superseded by the equivalent entitlement inside E5 for all thirty-six holders. Both are monthly-billed.",
    evidence: [
      { k: "Where this comes from", v: "reports/getM365AppUserDetail(period='D90') for Visio, servicePlans comparison for Defender" },
      { k: "Visio", v: "3 unassigned + 6 idle 90 days = $135/mo" },
      { k: "Defender P1", v: "36 seats superseded by E5 = $72/mo" },
      { k: "Combined", v: "$207/mo, annualised $2,484" },
      { k: "Caution on Visio", v: "Two of the six idle users are architects who use Visio in bursts around release cycles. Confirm before removing rather than assuming idle means unwanted." },
    ],
    action: "Remove the superseded and idle add-on seats",
    actionSub: "Visio holders get a 7-day keep-or-release note; Defender removal is unconditional",
    fixKey: "lic-addons-idle",
  },
  {
    id: "LIC-06",
    title: "6 shared mailboxes are carrying an Exchange Online Plan 1 licence they do not need",
    monthly: 24,
    timing: "Removable today",
    why: "A shared mailbox needs no licence below 50 GB. These six are between 2 and 18 GB and were licensed when they were converted from user mailboxes. The figure is small, and it is the kind of line a controller notices in an audit precisely because it is small and avoidable.",
    evidence: [
      { k: "Where this comes from", v: "Get-Mailbox -RecipientTypeDetails SharedMailbox cross-referenced with assignedLicenses" },
      { k: "Mailboxes", v: "6, sizes 2.1 GB to 18.4 GB — all well under the 50 GB threshold" },
      { k: "Monthly", v: "$24 — annualised $288" },
      { k: "Exception", v: "One of the eight EXCHANGESTANDARD seats is legitimately used by an archive-only account and stays" },
      { k: "Litigation-hold note", v: "A shared mailbox on litigation hold does require a licence. None of these six is on hold — checked, not assumed." },
    ],
    action: "Remove licences from the 6 unlicensed-eligible shared mailboxes",
    actionSub: "Hold and size checked per mailbox before removal",
    fixKey: "lic-shared-mailboxes",
  },
];

/* ── Intentional spend — LIC_ACK (12446-12455) ────────────────────────────── */

export interface LicAck {
  id: string;
  title: string;
  monthly: number;
  rationale: string;
  offset: string;
  owner: string;
  approved: string;
  review: string;
  register: string;
}

export const LIC_ACK: readonly LicAck[] = [
  {
    id: "LIC-A1",
    title: "12 spare E5 seats held for Q3 hiring",
    monthly: 720,
    rationale:
      "The hiring plan approved in February adds 12 people between July and September. Buying seats at renewal for a July start would mean paying the higher mid-term rate, and provisioning day one matters more than the carry cost.",
    offset:
      "Carry cost $2,160 for three months against an estimated $3,400 in mid-term uplift and provisioning delay if the seats are released.",
    owner: "Controller",
    approved: "19 February 2026",
    review: "30 September 2026",
    register: "FIN-2026-031",
  },
  {
    id: "LIC-A2",
    title: "6 Copilot seats reserved for the executive pilot",
    monthly: 180,
    rationale:
      "Reserved for the executive group during the Copilot readiness programme. Deliberately unassigned until the tenant clears the readiness gate, so the first executive experience is not a badly grounded one.",
    offset:
      "Carry cost $180/mo until the gate clears, expected within the 14-week remediation window. Reviewed at gate clearance rather than on a calendar date.",
    owner: "CIO",
    approved: "3 March 2026",
    review: "At gate clearance",
    register: "FIN-2026-034",
  },
];

/** The 2×2 meta grid on each acknowledgement card (12459-12464). */
export function licAckMeta(a: LicAck) {
  return [
    { k: "Owner", v: a.owner },
    { k: "Approved", v: a.approved },
    { k: "Next review", v: a.review },
    { k: "Finance register", v: a.register },
  ];
}

/* ── Savings ledger — LIC_LEDGER (12467-12473) ────────────────────────────── */

export const LIC_LEDGER: readonly { what: string; when: string; amount: number; by: string }[] = [
  { what: "Retired 14 unused Yammer/Viva Engage add-ons", when: "Scan 13 · 3 weeks ago", amount: 650, by: "Automated via Graph" },
  { what: "Downgraded 9 inactive E5 users to E3", when: "Scan 11 · 7 weeks ago", amount: 690, by: "Approved by Controller" },
  { what: "Cancelled duplicate Project Plan 1 subscription", when: "Scan 9 · 3 months ago", amount: 760, by: "Automated via Graph" },
  { what: "Reclaimed 22 licences from disabled accounts", when: "Scan 7 · 4 months ago", amount: 1320, by: "Shane McCaw Consulting" },
  { what: "Removed self-service Power BI purchases", when: "Scan 4 · 6 months ago", amount: 680, by: "Automated via Graph" },
];

/* ── Why the waste recurs — LIC_POLICY (12478-12486) ──────────────────────── */

export const LIC_POLICY: readonly {
  name: string;
  detail: string;
  status: string;
  tone: LicTone;
  fixKey: string;
}[] = [
  { name: "Self-service purchase", detail: "Enabled for Power BI, Visio and Project. Users can buy licences on a card, which is how the 12 duplicate Power BI Pro seats appeared.", status: "Enabled", tone: "red", fixKey: "lic-self-service" },
  { name: "Offboarding licence removal", detail: "Not in the runbook. 11 disabled accounts still consume E5 seats — the same runbook gap that leaves Teams without owners.", status: "Missing step", tone: "red", fixKey: "lic-offboarding" },
  { name: "Group-based licensing", detail: "Only 41 of 240 E5 assignments come from a group. Direct assignment is why reclamation is manual and why seats drift.", status: "17% coverage", tone: "amber", fixKey: "lic-group-licensing" },
  { name: "Idle-seat reclamation rule", detail: "No rule exists for any SKU. Copilot at $30 a seat is the one where 30 days of inactivity should trigger a reclaim automatically.", status: "None", tone: "red", fixKey: "lic-idle-rule" },
  { name: "Licence assignment errors", detail: "3 users have a CountViolation and 1 a DependencyViolation, so those assignments are failing silently and the users are unlicensed in practice.", status: "4 errors", tone: "red", fixKey: "lic-assignment-errors" },
  { name: "Renewal calendar", detail: `Annual E5 commitment renews ${LIC_HERO.renewal}. Quantity reductions must be lodged before then; nothing on the calendar currently reminds anyone.`, status: "No reminder", tone: "amber", fixKey: "lic-renewal-calendar" },
  { name: "Cost centre attribution", detail: "No usage location or department attribution on assignments, so licence spend cannot be split by cost centre for the finance review.", status: "Unattributed", tone: "amber", fixKey: "lic-cost-centre" },
];

/* ── How the figures are derived — LIC_PROV (12497-12506) ─────────────────── */

export const LIC_PROV: readonly {
  src: "graph" | "ps" | "derived";
  call: string;
  scope: string;
  note: string;
}[] = [
  { src: "graph", call: "/v1.0/subscribedSkus?$select=skuId,skuPartNumber,prepaidUnits,consumedUnits,servicePlans", scope: "Organization.Read.All", note: "Purchased versus consumed per SKU, and the service-plan list that identifies duplicated entitlements." },
  { src: "graph", call: "/v1.0/users?$select=id,userPrincipalName,accountEnabled,assignedLicenses,licenseAssignmentStates,signInActivity", scope: "User.Read.All + AuditLog.Read.All", note: "Who holds what, whether their account is enabled, and whether the assignment actually succeeded." },
  { src: "graph", call: "/v1.0/reports/getOffice365ActiveUserDetail(period='D30')", scope: "Reports.Read.All", note: "Per-service last activity. The difference between assigned and active is the whole page." },
  { src: "graph", call: "/v1.0/reports/getMicrosoft365CopilotUsageUserDetail(period='D30')", scope: "Reports.Read.All", note: "Copilot activity per user. At $30 a seat this is the highest-value usage signal in the tenant." },
  { src: "graph", call: "/v1.0/reports/getM365AppUserDetail(period='D90')", scope: "Reports.Read.All", note: "Application-level launches, used for Visio and Project idle detection." },
  { src: "ps", call: "Get-MSCommerceProductPolicies -PolicyId AllowSelfServicePurchase", scope: "Billing Administrator", note: "Self-service purchase state per product. Not exposed in Graph — MSCommerce module only." },
  { src: "ps", call: "Get-Mailbox -RecipientTypeDetails SharedMailbox | Select DisplayName,TotalItemSize,LitigationHoldEnabled", scope: "Exchange Online: View-Only Recipients", note: "Shared-mailbox size and hold state, which decide whether a licence is genuinely required." },
  { src: "derived", call: "recoverable(sku) = f(billingTerm, assignmentState, activity30d, entitlementOverlap)", scope: "—", note: "Splits waste into removable today, recoverable at renewal, and reassignable. Billing term is what makes the three different." },
];

/** `licFindingCount` / `licAckCount` (17511-17512) — lengths, not literals. */
export const LIC_FINDING_COUNT = LIC_FINDINGS.length;
export const LIC_ACK_COUNT = LIC_ACK.length;
