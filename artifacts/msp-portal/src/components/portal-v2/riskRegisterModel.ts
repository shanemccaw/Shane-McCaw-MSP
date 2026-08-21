/**
 * riskRegisterModel.ts — the Risk Register's derived state.
 *
 * Transcribed from the prototype's own derivation
 * ('Customer Portal Shell.dc.html' 15253-15355), plus the state defaults at
 * 6483-6488 and the render exports at 17101-17108.
 *
 * ── Three behaviours here are faithfully reproduced DEFECTS ────────────────
 * The prototype is the specification, so these are carried over exactly rather
 * than tidied. Each is called out because a later reader would otherwise assume
 * a mistake and "fix" it, changing the design:
 *
 *  1. `severity` FILTERS ON `inherent`, while the table shows BOTH `inherent`
 *     and `residual` (15270 vs the row's two severity spans). Four risks differ
 *     across the two — RSK-003 High→Low, RSK-006 Medium→Low, RSK-007 Medium→Low,
 *     RSK-012 High→Low — so filtering to "Low" does NOT return the four risks
 *     whose residual severity reads Low on screen. That is the prototype's
 *     choice: a register filters on the risk as identified, not as controlled.
 *
 *  2. The "Review date" sort is `localeCompare` on a DISPLAY STRING (15276),
 *     so it sorts alphabetically, not chronologically. The review column holds
 *     '27 Aug 2026', 'Not set', 'Closed 14 Aug 2026' and 'Acceptance expired
 *     4 Jul 2026' — free text, not dates — so no chronological sort is even
 *     available without parsing prose. Reproduced as-is.
 *
 *  3. `rrExpanded` is an INDEX INTO THE FILTERED LIST (15286/15303), not a risk
 *     id. Changing a filter while a row is open therefore leaves the same
 *     ordinal expanded, which is a different risk. The prototype's own deep
 *     links rely on this — they set `rrExpanded: 0` to mean "open the first
 *     result" (18014-18016) — so an id-keyed rewrite would break them.
 *
 * ── One deliberate improvement, with identical output ──────────────────────
 * The prototype hardcodes the string 'Acceptance expired 4 Jul 2026' inside the
 * expiring-list derivation (15351) because the one Expired risk carries no
 * `accepted` block to read a date from. That same string is ALSO already in the
 * fixture, as RSK-012's own `review` field. This module reads it from the data
 * instead of restating it, which is byte-identical on screen and satisfies the
 * build's rule that no number or date is hardcoded above the data layer.
 */

import { RR_RISKS, type RiskEntry } from "./riskRegisterData";

/* ── Colour maps — 15253-15255, exact hexes ──────────────────────────────── */

/** Severity → colour. Its KEY ORDER is also the severity sort order (15275). */
export const RR_SEV_META: Readonly<Record<string, string>> = {
  Critical: "#f87171",
  High: "#fb923c",
  Medium: "#c2a63d",
  Low: "#34d399",
};

export const RR_STATUS_META: Readonly<Record<string, string>> = {
  Open: "#f87171",
  Mitigating: "#60a5fa",
  Accepted: "#a78bfa",
  Closed: "#34d399",
  Expired: "#fb923c",
};

/**
 * Pillar → colour. NOT the same palette as `journeyTokens.PILLARS`: this page
 * uses the design's own hexes, including a slate `#cbd5e1` for Compliance,
 * which is why they are restated here rather than imported.
 */
export const RR_PILLAR_META: Readonly<Record<string, string>> = {
  Governance: "#3B82F6",
  Security: "#8B5CF6",
  Compliance: "#cbd5e1",
  Licensing: "#14B8A6",
  Adoption: "#F97316",
  Health: "#22C55E",
};

/** The severity sort's ordering, taken from RR_SEV_META's key order (15275). */
const SEVERITY_ORDER = Object.keys(RR_SEV_META);

/* ── Filters — 15256-15261, and their defaults at 6483-6488 ──────────────── */

export interface RiskFilterState {
  pillar: string;
  severity: string;
  status: string;
  owner: string;
  sort: string;
}

export const RR_DEFAULT_FILTERS: RiskFilterState = {
  pillar: "All pillars",
  severity: "All severities",
  status: "All statuses",
  owner: "All owners",
  sort: "Weight, highest first",
};

/** The row index the page opens on — 6488. Deep links reset it to 0. */
export const RR_DEFAULT_EXPANDED = 0;

export type RiskFilterKey = keyof RiskFilterState;

/** `rrSelects` (15256-15261). Five selects, in this order, with these options. */
export const RR_SELECTS: ReadonlyArray<{
  key: RiskFilterKey;
  label: string;
  options: readonly string[];
}> = [
  {
    key: "pillar",
    label: "Pillar",
    options: ["All pillars", "Governance", "Security", "Compliance", "Licensing", "Adoption", "Health"],
  },
  {
    key: "severity",
    label: "Severity",
    options: ["All severities", "Critical", "High", "Medium", "Low"],
  },
  {
    key: "status",
    label: "Status",
    options: ["All statuses", "Open", "Mitigating", "Accepted", "Expired", "Closed"],
  },
  {
    key: "owner",
    label: "Owner",
    options: [
      "All owners",
      "Unassigned",
      "IT Administrator",
      "Head of Infrastructure",
      "Controller",
      "General Counsel",
      "CIO",
    ],
  },
  {
    key: "sort",
    label: "Sort by",
    options: ["Weight, highest first", "Severity", "Review date", "Risk ID"],
  },
];

/**
 * `rrFiltered` (15268-15279).
 *
 * Note the OWNER predicate is a SUBSTRING test, not equality (15272). That is
 * load-bearing rather than sloppy: owner strings on the register are plain
 * role names, but an acceptance records a person AND their role
 * ('Jordan Diaz · IT Administrator'), so a substring match is what lets one
 * option cover both forms.
 *
 * Sorting relies on Array.prototype.sort being stable (guaranteed since
 * ES2019), which is what keeps ties in fixture order the way the prototype's
 * own comparator does.
 */
export function rrFiltered(
  f: RiskFilterState,
  risks: readonly RiskEntry[] = RR_RISKS,
): RiskEntry[] {
  return risks.filter(
    (r) =>
      (f.pillar === "All pillars" || r.pillar === f.pillar) &&
      (f.severity === "All severities" || r.inherent === f.severity) &&
      (f.status === "All statuses" || r.status === f.status) &&
      (f.owner === "All owners" || r.owner.indexOf(f.owner) !== -1),
  )
    .slice()
    .sort((a, b) => {
      if (f.sort === "Severity") {
        return SEVERITY_ORDER.indexOf(a.inherent) - SEVERITY_ORDER.indexOf(b.inherent);
      }
      // Alphabetical on a display string, not chronological — see the header.
      if (f.sort === "Review date") return a.review.localeCompare(b.review);
      if (f.sort === "Risk ID") return a.id.localeCompare(b.id);
      return b.weight - a.weight;
    });
}

/* ── Register-wide totals — 15336-15343 ──────────────────────────────────── */

/** Statuses whose weight is still being deducted from the pillar scores. */
const COUNTING_STATUSES = ["Open", "Mitigating", "Expired"];

const sumWeight = (list: readonly RiskEntry[]) => list.reduce((a, r) => a + r.weight, 0);

/* ── Fixture-backed constants vs live functions ──────────────────────────────
 *
 * Each total below exists in TWO forms, and the pair is deliberate.
 *
 * The `RR_*` CONSTANTS are computed from the design fixture at module load.
 * They are what the Governance and Security pillar pages read (through
 * `riskPanelModel.ts`), and what this module's own tests assert against — both
 * of which want the fixed, known register the design describes.
 *
 * The `rr*()` FUNCTIONS take the register as an argument. The Risk Register
 * page passes the REAL rows fetched from `/api/portal/risk-register` (see
 * `riskRegisterLive.ts`), so its stat cards count the customer's own risks
 * rather than Halden Materials'.
 *
 * The constants are defined as calls to the functions, so the two can never
 * drift into computing the same total two different ways.
 */

export function rrAccepted(risks: readonly RiskEntry[] = RR_RISKS): readonly RiskEntry[] {
  return risks.filter((r) => r.status === "Accepted");
}

/** Weight NOT being deducted, because an acceptance is holding (15337). */
export function rrSuppressedWeight(risks: readonly RiskEntry[] = RR_RISKS): number {
  return sumWeight(rrAccepted(risks));
}

/** Weight still counting against the pillar scores (15338). */
export function rrOpenWeight(risks: readonly RiskEntry[] = RR_RISKS): number {
  return sumWeight(risks.filter((r) => COUNTING_STATUSES.includes(r.status)));
}

/** `rrSuppressed` as the banner renders it — 17105 appends the unit. */
export function rrSuppressedLabel(risks: readonly RiskEntry[] = RR_RISKS): string {
  return `${rrSuppressedWeight(risks)} points`;
}

export const RR_ACCEPTED: readonly RiskEntry[] = rrAccepted();

export const RR_SUPPRESSED_WEIGHT = rrSuppressedWeight();

export const RR_OPEN_WEIGHT = rrOpenWeight();

export const RR_SUPPRESSED_LABEL = rrSuppressedLabel();

export interface RiskStat {
  label: string;
  value: string;
  sub: string;
  /** Card accent; the page builds its border and gradient from this. */
  c: string;
}

/**
 * `rrStats` (15339-15343). Every value is computed from RR_RISKS, never stated:
 * on a page whose whole argument is that acceptance moves points around, a stat
 * that disagreed with the rows beneath it would undo the argument.
 */
export function rrStats(risks: readonly RiskEntry[] = RR_RISKS): readonly RiskStat[] {
  return [
    {
      label: "Risks on the register",
      value: String(risks.length),
      sub: `${risks.filter((r) => r.status === "Open").length} open · ${
        risks.filter((r) => r.status === "Mitigating").length
      } mitigating`,
      c: "#60a5fa",
    },
    {
      label: "Accepted decisions",
      value: String(rrAccepted(risks).length),
      sub: "Each with an owner and a review date",
      c: "#a78bfa",
    },
    {
      label: "Score suppressed by acceptance",
      value: `${rrSuppressedWeight(risks)} pts`,
      sub: "Not deducted while the acceptances hold",
      c: "#22d3ee",
    },
    {
      label: "Weight still counting",
      value: `${rrOpenWeight(risks)} pts`,
      sub: "Across open, mitigating and expired risks",
      c: "#f87171",
    },
  ];
}

export const RR_STATS: readonly RiskStat[] = rrStats();

/* ── Acceptances needing attention — 15349-15355 ─────────────────────────── */

export interface ExpiringAcceptance {
  id: string;
  title: string;
  when: string;
  owner: string;
  tone: "Expired" | "Due";
}

/**
 * `rrExpiring` (15349). An acceptance qualifies if the risk has EXPIRED, or if
 * its review date falls in the current year — tested, as the prototype does it,
 * by looking for '2026' in the date string rather than parsing it.
 *
 * The Expired branch reads the risk's own `review` field rather than the
 * prototype's hardcoded literal; the two are byte-identical. See the header.
 */
export function rrExpiring(risks: readonly RiskEntry[] = RR_RISKS): ExpiringAcceptance[] {
  return risks.filter(
    (r) => r.status === "Expired" || (r.accepted && r.accepted.until.indexOf("2026") !== -1),
  ).map((r) => ({
    id: r.id,
    title: r.title,
    when: r.status === "Expired" ? r.review : `Review due ${r.accepted ? r.accepted.until : r.review}`,
    owner: r.owner,
    tone: r.status === "Expired" ? "Expired" : "Due",
  }));
}

/* ── Per-row derivation — 15281-15334 ────────────────────────────────────── */

/** `weightText` (15293). The glyph is U+2212 MINUS SIGN, not a hyphen. */
export function riskWeightText(r: RiskEntry): string {
  return `−${r.weight} pts`;
}

/** `canAccept` (15322). A closed or already-accepted risk offers no decision. */
export function riskCanAccept(r: RiskEntry): boolean {
  return r.status === "Open" || r.status === "Mitigating" || r.status === "Expired";
}

/**
 * `scoreNote` (15317-15321). Three branches, each interpolating the real weight
 * — which is what makes the page's central claim checkable rather than asserted.
 */
export function riskScoreNote(r: RiskEntry): string {
  if (r.status === "Accepted") {
    return `While accepted, this risk is suppressed in the pillar score — ${r.weight} points are not being deducted — and its alerts are muted. Monitoring continues: if the underlying facts change materially, the acceptance is flagged and the points return.`;
  }
  if (r.status === "Expired") {
    return `The acceptance on this risk expired, so its ${r.weight} points are back in the pillar score and alerting is live again.`;
  }
  return `Currently deducting ${r.weight} points from the ${r.pillar} pillar score, with alerting live.`;
}

export interface MatrixCell {
  /** True for the single cell this risk actually sits on. */
  here: boolean;
  /** Heat colour for the cell, before the un-plotted cells are faded. */
  c: string;
}

/**
 * The 5x5 likelihood-by-impact grid (15306-15312). Twenty-five cells in reading
 * order, with impact rising UP the grid and likelihood across it — hence
 * `row = 4 - floor(k / 5)`, which flips the vertical axis so that row 0 of the
 * output is impact 5 rather than impact 1.
 *
 * Heat is the product of the two axes, banded at 15 and 8.
 */
export function riskMatrix(likelihood: number, impact: number): MatrixCell[] {
  return Array.from({ length: 25 }, (_, k) => {
    const col = k % 5;
    const row = 4 - Math.floor(k / 5);
    const heat = (col + 1) * (row + 1);
    return {
      here: col + 1 === likelihood && row + 1 === impact,
      c: heat >= 15 ? "#f87171" : heat >= 8 ? "#c2a63d" : "#34d399",
    };
  });
}

export function riskLikelihoodText(r: RiskEntry): string {
  return `Likelihood ${r.likelihood} of 5`;
}

export function riskImpactText(r: RiskEntry): string {
  return `Impact ${r.impact} of 5`;
}

/** `askGo` (15323) — the exact topic string handed to ShaneBot. */
export function riskAskTopic(r: RiskEntry): string {
  return `Explain risk ${r.id} — ${r.title} — in plain terms, and tell me whether accepting it is defensible`;
}

/**
 * `acceptGo` (15324-15333) — the AcceptRiskPanel payload.
 *
 * This is the SIXTH distinct contract the shared panel is asked to carry
 * (accept risk / record policy decision / acknowledge intentional spend / park
 * a play / accept operational risk / and now a risk-based decision on the
 * register). Every label is overridden, which is exactly why the panel takes
 * them as props rather than hardcoding a single wording.
 *
 * The apostrophe in "this risk’s alerts" is U+2019 ON PURPOSE. Grepping the
 * prototype for a literal U+2019 byte returns ZERO, which makes it look as
 * though its copy uses straight quotes — but the file carries 48 `’`
 * ESCAPE sequences, and line 15327 is one of them. The rendered string has a
 * curly apostrophe, so a straight one here would be the rewrite, not the fix.
 */
export function riskAcceptSpec(r: RiskEntry) {
  return {
    riskId: r.id,
    title: r.title,
    description: `${r.what} ${r.outcome}`,
    details: `Inherent severity ${r.inherent}, residual ${r.residual} with current controls. Accepting suppresses ${r.weight} points in the ${r.pillar} pillar score and mutes this risk’s alerts. Monitoring continues, and a material change in the underlying facts reopens it automatically. An acceptance needs an owner, a rationale, the compensating controls you are relying on, and a review date.`,
    kicker: "Risk-based decision",
    descLabel: "The risk you are accepting",
    detailsLabel: "What acceptance changes",
    confirmText:
      "I accept this risk on behalf of the organisation, with a named owner, a stated rationale and a review date, and I understand it stays on the register as an accepted risk rather than disappearing.",
    btnLabel: "Record the decision",
  };
}

/**
 * An empty acceptance, used when an expanded row's status is not Accepted
 * (15316). The prototype substitutes this rather than guarding each field, so
 * the accepted block never reads `undefined.by`.
 */
export const RR_EMPTY_ACCEPTANCE = {
  by: "",
  on: "",
  until: "",
  register: "",
  why: "",
  compensating: "",
} as const;
