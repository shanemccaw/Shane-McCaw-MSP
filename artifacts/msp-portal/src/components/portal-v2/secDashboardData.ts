/**
 * secDashboardData.ts — the Security pillar dashboard fixture.
 *
 * Transcribed from the prototype's own Security logic
 * (`Customer Portal Shell.dc.html` lines 15646-15834), read independently rather
 * than adapted from `govDashboardData.ts`. Security is NOT Governance with a
 * different palette — see the structural notes below, each one verified against
 * its own markup.
 *
 * ── One trap worth naming ───────────────────────────────────────────────────
 * `const secFindingCount = 5` at line 15652 is NOT what the page renders.
 * `renderVals` overrides it with a literal `secFindingCount: 7` at line 18028,
 * and the template reads the renderVals bag. The screen says 7. Reading only the
 * const declaration would have shipped the wrong number on the hero — which is
 * exactly the class of error this fixture exists to make reviewable.
 *
 * ── What is WIRED to real data now, and what is still fixture ────────────────
 * The Security page's HERO is wired to the live war-room-pillars payload
 * (`useLivePillarHero` + pillarDashboardModel): the score ring, the delta, the
 * 30-day trend sparkline, the severity/status pill, the honest trend verdict, the
 * red critical headline (real critical finding count), and the hero tiles
 * ("Critical Exposures" = real critical count; "Security Findings" = real finding
 * total; "MFA Coverage" and "Secure Score" are stated gaps — a % with no
 * denominator check, and a real metric that lives on the security-posture route,
 * not this payload). The `SEC_HERO.*` / `SEC_HERO_STATS` scalars below are now
 * only FALLBACKS used before the payload loads / on an unscored tenant.
 *
 * Still fixture, and a GENUINE GAP: the `SEC_AREA_LINKS` category scores (MFA
 * gaps / OAuth / Conditional Access / legacy auth / email) — no per-category
 * score feed exists server-side. Real backend design work, not a fixture swap.
 */

export interface SecAreaLink {
  key: string;
  label: string;
  score: number;
  sub: string;
  /** `iconSvg` name — mapped to its lucide-react equivalent at render. */
  icon: "lock" | "key" | "shield-check" | "clipboard-list" | "mail";
  /**
   * The named principals behind the score. Computed into a `previewText` by the
   * prototype (15806) but NOT rendered anywhere in the Security section — the
   * card shows icon, score, label, sub and a progress bar only. Kept because it
   * is the evidence the drill-downs will need, not because this page uses it.
   */
  who: string[];
}

/**
 * `secStatusMeta` at the default 'bad' tenant stage, where `applyStage('red')`
 * returns 'red' (15791-15796). The stage machinery is not ported, so the red
 * branch's literal expansions are used.
 */
export const SEC_STATUS = {
  c: "#f87171",
  grow: 3,
  wash: "linear-gradient(160deg, #f8717112, rgba(15,23,42,.5))",
  /** `secW` for tier 'large' (15796). */
  pad: "9px 11px",
  icon: 12,
  score: 18,
} as const;

/** `secHistory` (15655) — ten scans, the last of which is the current score. */
export const SEC_HISTORY: readonly number[] = [61, 62, 60, 58, 59, 57, 56, 58, 56, 54];

/**
 * Hero scalars. Sources, in order: 15646-15654, the renderVals overrides at
 * 18021-18032, and 18095-18096 for the two Secure Score figures.
 */
export const SEC_HERO = {
  score: 54,
  /** `secDelta: \`${secDelta} this month\`` (18022) — the sign is part of the value. */
  delta: "-6 this month",
  mfaCoverage: 94,
  /** See the header note: the const says 5, renderVals ships 7. */
  findingCount: 7,
  scanNumber: 14,
  fixedSinceScan1: 4,
  lastScan: "2 hours ago",
  nextScan: "22 hours",
  secureScore: 68,
  secureScoreIndustryAvg: 61,
  /** The strip above the hero — Security's own copy, not Governance's. */
  riskAccepted: 1,
  /** Hero card title and subtitle — prototype 555-556. */
  title: "Security Health",
  subtitle: "Security pillar score from your latest scan",
  /** Status pill — prototype 557-560. Red "Critical", not amber "Needs attention". */
  statusLabel: "Critical",
  /** The trend verdict sentence Governance does not have — prototype 566. */
  trendVerdict: "Getting worse — 2 new exposures since scan 12",
  /**
   * `secAllResolved = secTileStatus === 'resolved'` (15797), which is false at
   * the default stage. Kept as a flag so the all-resolved panel — which sits at
   * the BOTTOM of this page, unlike Governance's, where it is above the hero —
   * is implemented rather than omitted.
   */
  allResolved: false,
} as const;

/**
 * `secFindingDefs` severities (15669-15676). Only the COUNT reaches the screen:
 * `secCriticalCount` drives both the red headline above the hero and the first
 * stat card. The definitions themselves feed `securityRows`, which the prototype
 * builds and exports but NO template consumes — the same dead export Governance
 * has, and the reason neither pillar renders finding rows.
 */
export const SEC_CRITICAL_COUNT = 3;

/**
 * The four hero stat cards (prototype 596-620). Governance has THREE at
 * `minmax(130px,1fr)`; Security has FOUR at `minmax(110px,1fr)`, and its first
 * card's VALUE is red rather than #f8fafc — the only stat value in either
 * pillar that is not near-white.
 */
export interface SecHeroStat {
  label: string;
  value: string;
  sub: string;
  /** The 2px left rule and the corner orb tint. */
  accent: string;
  /** Orb alpha suffix on the accent hex — `.2` for every Security card. */
  orbAlpha: string;
  /** Critical Exposures alone prints its value in the accent, not #f8fafc. */
  valueInAccent?: boolean;
}

export const SEC_HERO_STATS: readonly SecHeroStat[] = [
  {
    label: "Critical Exposures",
    value: String(SEC_CRITICAL_COUNT),
    sub: "Need action now",
    accent: "#f87171",
    orbAlpha: "33",
    valueInAccent: true,
  },
  {
    label: "MFA Coverage",
    value: `${SEC_HERO.mfaCoverage}%`,
    sub: "8 users still exempt",
    accent: "#8B5CF6",
    orbAlpha: "33",
  },
  {
    label: "Security Findings",
    value: String(SEC_HERO.findingCount),
    sub: "From your latest scan",
    accent: "#8B5CF6",
    orbAlpha: "33",
  },
  {
    label: "Secure Score",
    value: String(SEC_HERO.secureScore),
    sub: `Industry avg ${SEC_HERO.secureScoreIndustryAvg}`,
    accent: "#8B5CF6",
    orbAlpha: "33",
  },
];

/** `secAreaLinks` (15798-15804), in the prototype's own order. */
export const SEC_AREA_LINKS: readonly SecAreaLink[] = [
  {
    key: "security-mfa",
    label: "MFA Gaps",
    score: 8,
    sub: "users without MFA",
    icon: "lock",
    who: [
      "R. Delgado",
      "K. Osei",
      "J. Park",
      "M. Alvarez",
      "T. Nguyen",
      "S. Whitfield",
      "D. Cho (admin)",
      "A. Reyes (admin)",
    ],
  },
  {
    key: "security-oauth",
    label: "OAuth Apps",
    score: 1,
    sub: "flagged grant",
    icon: "key",
    who: ["Unnamed OAuth app (client ID a83f…) — full mailbox access, granted without review"],
  },
  {
    key: "security-ca",
    label: "Conditional Access",
    score: 17,
    sub: "baseline policies missing",
    icon: "shield-check",
    who: [
      "CA001 — Block legacy authentication",
      "CA202 — Require compliant or hybrid-joined device",
      "CA401 — Block high sign-in risk",
      "EM001 — MFA disruption fallback",
    ],
  },
  {
    key: "security-legacy-auth",
    label: "Legacy Auth",
    score: 2,
    sub: "protocols still enabled",
    icon: "clipboard-list",
    who: ["IMAP — 3 accounts still connecting", "POP3 — 1 service account still connecting"],
  },
  {
    key: "security-email",
    label: "Email Security",
    score: 3,
    sub: "open findings",
    icon: "mail",
    who: [
      "SPF record too permissive (+all)",
      'DKIM signing not enabled for marketing subdomain',
      'DMARC policy set to "none" — no enforcement',
    ],
  },
];

/**
 * The per-card geometry (15805-15811). Note what the bar means: `progressPct` is
 * `(1 - score/maxScore)` — an INVERSE severity bar. Conditional Access, the
 * worst area at 17, renders an EMPTY bar; OAuth Apps, the mildest at 1, renders
 * a nearly full one. It reads as "how much of this area is already fine", which
 * is why a naive `score/max` fill would invert the whole panel's meaning.
 *
 * `grow` is the flex-grow, so severity drives width as well: the worst card is
 * physically the widest.
 */
export function secAreaGeometry(link: SecAreaLink) {
  const maxScore = Math.max(...SEC_AREA_LINKS.map((x) => x.score));
  const severityFrac = maxScore ? link.score / maxScore : 0;
  return {
    progressPct: Math.round((1 - severityFrac) * 100),
    grow: SEC_STATUS.grow * (0.5 + severityFrac),
  };
}

/**
 * The two explicit rows (15829-15830). Row 1 is MFA then Conditional Access —
 * pinned by an explicit sort, not by array order; row 2 is everything else in
 * declaration order. Governance groups its tiles into four named CLUSTERS with a
 * heading each; Security has one unnamed panel titled "Security Categories" with
 * two anonymous rows. Different component, not a variant.
 */
export const SEC_AREA_ROW_1: readonly SecAreaLink[] = SEC_AREA_LINKS.filter(
  (a) => a.key === "security-mfa" || a.key === "security-ca",
).sort((a) => (a.key === "security-mfa" ? -1 : 1));

export const SEC_AREA_ROW_2: readonly SecAreaLink[] = SEC_AREA_LINKS.filter(
  (a) => a.key !== "security-mfa" && a.key !== "security-ca",
);
