/**
 * adpDashboardData.ts — the Adoption pillar dashboard fixture.
 *
 * Transcribed from the prototype's own Adoption logic
 * (`Customer Portal Shell.dc.html` lines 12602-12940).
 *
 * ── The prototype states this pillar's thesis in its own source comment ─────
 * Adoption is "measurement — not a write action. Items with a real technical
 * enabler can automate; the rest are deliberately people-shaped, and any play
 * can be PARKED as a business decision rather than ACCEPTED as a risk."
 *
 * Three consequences run right through the data, and each one is easy to lose:
 *
 *  1. Plays carry `canAutomate`. Four of the six are false, and the playbook
 *     mapper branches on it — a people play offers no Graph route at all. This
 *     is the only pillar where a fix legitimately has no switch to throw.
 *  2. Parking is NOT accepting a risk. The park drawer's copy says so
 *     explicitly ("nothing is exposed and nothing degrades") and the parked
 *     cards are grey rather than the pillar's orange, because a parked play is
 *     a business decision, not a suppressed finding.
 *  3. Nothing on the page is red-as-danger. The workload and matrix tones are
 *     read as "where to start", and the page's own copy says "Nothing on this
 *     page is a risk and nothing here is failing."
 *
 * ── Design content, not tenant data ─────────────────────────────────────────
 * The prototype's fictional Halden Materials figures, in one module.
 */

export type AdpTone = "green" | "amber" | "red";
export type AdpPlayKind = "play" | "hybrid";

/** `adpOrange` (12608). */
export const ADP_ORANGE = "#F97316";
export const ADP_ORANGE_TEXT = "#fb923c";
export const ADP_ORANGE_EYEBROW = "#fdba74";

export const ADP_TONE: Readonly<Record<AdpTone, string>> = {
  green: "#34d399",
  amber: "#fb923c",
  red: "#f87171",
};

/** Hero scalars — 12609 and the literals inline in the markup. */
export const ADP_HERO = {
  score: 88,
  /** Hardcoded in the ring markup (3272) and GREEN, like Licensing's. */
  delta: "+1 this month",
  eyebrow: "Where you are",
  headline: "You have climbed 27 points in ten scans. Six things would move the next ten.",
  standfirst:
    "Nothing on this page is a risk and nothing here is failing. These are places where capability you already own is not yet in play — mostly a training, comms, or rollout question rather than a switch to throw.",
  trendLabel: "Adoption index · last 10 scans",
  trendCaption: "61 → 88 since scan 1. No month has gone backwards.",
  parkedStripSuffix: "plays parked as business decisions · nothing at risk",
} as const;

export const ADP_HISTORY: readonly number[] = [61, 63, 66, 68, 71, 74, 78, 82, 87, 88];

/**
 * `adpTrend` (12611-12624). A THIRD distinct trend domain across the pillars:
 * the floor is padded by FOUR, not three, while the ceiling is padded by three.
 * Governance/Security/Compliance use ±3 both ends; Licensing anchors at 0 with a
 * ×1.12 ceiling. Four pillars, three different domains — which is why none of
 * them share a geometry helper.
 */
export function adpTrendGeometry() {
  const w = 280;
  const h = 84;
  const min = Math.min(...ADP_HISTORY) - 4;
  const max = Math.max(...ADP_HISTORY) + 3;
  const pts = ADP_HISTORY.map((v, i) => {
    const x = (i / (ADP_HISTORY.length - 1)) * w;
    const y = h - ((v - min) / (max - min || 1)) * h;
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

/** The three hero stats (3277-3293). */
export const ADP_HERO_STATS: readonly { label: string; value: string; sub: string }[] = [
  { label: "Workloads in real use", value: "6 of 10", sub: "Above 50% of licensed users" },
  { label: "Copilot weekly active", value: "41 / 68", sub: "Up from 22 when the pilot opened" },
  { label: "Open plays", value: "6", sub: "2 with a technical enabler, 4 people-led" },
];

/* ── Workload utilisation — ADP_WORKLOADS (12641-12652) ───────────────────── */

export interface AdpWorkload {
  name: string;
  active: number;
  tone: AdpTone;
  note: string;
  /** The counted population — "1,215 of 1,240 sent or read mail in 30 days". */
  of: string;
  src: string;
  reading: string;
  /** The collection window the "Active" fact reports against. Defaults to the
   * fixture's "30 days"; a live-overlaid row states its own check's real
   * window (#1252 — these checks run at D7, not D30). */
  window?: string;
}

export const ADP_WORKLOADS: readonly AdpWorkload[] = [
  { name: "Exchange / Outlook", active: 98, tone: "green", note: "Universal. Nothing to do here.", of: "1,215 of 1,240 sent or read mail in 30 days", src: "getEmailActivityUserDetail(period=D30)", reading: "The 25 who did not are shared and resource mailboxes, which is correct." },
  { name: "Teams chat & meetings", active: 94, tone: "green", note: "Strong. The gap is where the work lands, not whether Teams is used.", of: "1,166 of 1,240 posted or joined a meeting", src: "getTeamsUserActivityUserDetail(period=D30)", reading: "Usage is high but 1:1 chat dominates. Work is happening in Teams and landing nowhere durable." },
  { name: "SharePoint", active: 81, tone: "green", note: "Healthy after the intranet refresh.", of: "1,004 of 1,240 viewed or edited a file", src: "getSharePointActivityUserDetail(period=D30)", reading: "Up 14 points since the intranet refresh in March. The remaining fifth are mostly manufacturing floor accounts." },
  { name: "OneDrive", active: 60, tone: "amber", note: "Sync configured on 60% of devices. The rest keep work on local disks.", of: "127 of 212 devices have sync configured", src: "getOneDriveUsageAccountDetail + Intune device config", reading: "Eighty-five devices keep work on local disks. That is a backup problem before it is an adoption one." },
  { name: "Teams channels", active: 38, tone: "amber", note: "Most collaboration still happens in 1:1 chat.", of: "471 of 1,240 posted in a channel", src: "getTeamsUserActivityUserDetail — channel messages", reading: "Channel posting is the single best predictor of whether content is findable later. This is the number to move." },
  { name: "Copilot", active: 55, tone: "amber", note: "41 of 68 assigned seats active, concentrated in meeting recap.", of: "41 of 68 assigned seats used it in 30 days", src: "getMicrosoft365CopilotUsageUserDetail(period=D30)", reading: "Eighty per cent of all Copilot use is meeting recap. Nobody is using it in Excel or Word, which is where the licence pays for itself." },
  { name: "Power BI (in E5)", active: 6, tone: "red", note: "12 of 202 E5 holders. Paid for, effectively unused.", of: "12 of 202 E5 holders opened it", src: "getOffice365ActiveUserDetail(period=D30)", reading: "You also hold 12 standalone Power BI Pro licences for people who already have it inside E5. See the licence ledger." },
  { name: "Teams Phone", active: 0, tone: "red", note: "Licensed on 41 seats, never provisioned.", of: "0 of 41 licensed seats provisioned", src: "getPstnCalls + subscribedSkus", reading: "Never set up. No numbers assigned and no calling plan attached, so the licence has produced nothing since it was bought." },
  { name: "Planner / Tasks", active: 22, tone: "amber", note: "Two departments only. Project tracking still lives in spreadsheets.", of: "273 of 1,240 have an assigned task", src: "Planner plan and task enumeration", reading: "Engineering and Sales only. Operations deliberately runs project tracking elsewhere — that is a parked decision, not a gap." },
  { name: "Viva Engage", active: 4, tone: "red", note: "Deliberately not launched — see the parked play.", of: "50 of 1,240 posted or read", src: "getYammerActivityUserDetail(period=D30)", reading: "Not launched on purpose. Leadership parked it this quarter, so this number staying flat is the expected outcome." },
];

/**
 * The expanded workload detail (`adpWorkloadRows`, 12692-12708). The "Counted"
 * fact is the first three words of `of`, and the reading joins `of` and
 * `reading` with a full stop — both are DERIVED so the expansion cannot disagree
 * with the population line it is drawn from.
 */
export function adpWorkloadDetail(w: AdpWorkload) {
  return {
    facts: [
      { k: "Active", v: `${w.active}%` },
      { k: "Counted", v: w.of.split(" ").slice(0, 3).join(" ") },
      { k: "Window", v: w.window ?? "30 days" },
    ],
    reading: `${w.of}. ${w.reading}`,
    src: w.src,
  };
}

/**
 * #1252 — the 4 workload rows the platform already collects real data for:
 * Exchange/Outlook, Teams chat & meetings, SharePoint and OneDrive. Every
 * field here traces to a real `monitor_checks` row already running on the
 * normal cadence (see lib/dashboard-registry/src/metrics.ts's
 * usage.exchangeActiveCount / usage.teamsActiveCount /
 * usage.sharePointActiveCount / usage.oneDriveActiveCount and their new
 * denominator/sync-error siblings). The remaining six rows (Teams channels,
 * Copilot, Power BI, Teams Phone, Planner, Viva Engage) have no per-item
 * server feed and stay fixture — same honest-gap contract useLivePillarHero
 * documents for the rest of this page.
 */
export interface AdpWorkloadLiveCounts {
  exchangeActive: number | null;
  exchangeLicensed: number | null;
  teamsActive: number | null;
  teamsLicensed: number | null;
  sharePointActive: number | null;
  sharePointScanned: number | null;
  oneDriveActive: number | null;
  oneDriveScanned: number | null;
  oneDriveStaleSync: number | null;
}

export const ADP_WORKLOAD_LIVE_EMPTY: AdpWorkloadLiveCounts = {
  exchangeActive: null,
  exchangeLicensed: null,
  teamsActive: null,
  teamsLicensed: null,
  sharePointActive: null,
  sharePointScanned: null,
  oneDriveActive: null,
  oneDriveScanned: null,
  oneDriveStaleSync: null,
};

function adpWorkloadTone(pct: number): AdpTone {
  return pct >= 70 ? "green" : pct >= 45 ? "amber" : "red";
}

const fmtCount = (n: number) => n.toLocaleString();

/**
 * Overlay real counts onto the first 4 fixture rows. Each row is overlaid
 * independently — a partial payload (some checks scanned, others not yet)
 * overlays only the rows that genuinely resolved, leaving the rest on their
 * design fixture rather than guessing.
 */
export function adpWorkloadsWithLive(live: AdpWorkloadLiveCounts): readonly AdpWorkload[] {
  const rows = ADP_WORKLOADS.map((w) => ({ ...w }));

  const overlayRatio = (index: number, active: number | null, total: number | null, ofSuffix: string, src: string) => {
    if (active == null || total == null || total <= 0) return;
    const pct = Math.round((active / total) * 100);
    rows[index] = {
      ...rows[index],
      active: pct,
      tone: adpWorkloadTone(pct),
      of: `${fmtCount(active)} of ${fmtCount(total)} ${ofSuffix}`,
      src,
      window: "7 days",
    };
  };

  overlayRatio(0, live.exchangeActive, live.exchangeLicensed, "sent or read mail in the last 7 days", "getEmailActivityUserDetail(period=D7)");
  overlayRatio(1, live.teamsActive, live.teamsLicensed, "posted or joined a meeting in the last 7 days", "getTeamsUserActivityUserDetail(period=D7)");
  // Honest per-SITE proxy, not per-user (getSharePointSiteUsageDetail has
  // never queried a per-user file open — see metrics.ts's own caveat).
  overlayRatio(2, live.sharePointActive, live.sharePointScanned, "sites had a recently active owner", "getSharePointSiteUsageDetail(period=D7) — per site, not per user");

  if (live.oneDriveActive != null && live.oneDriveScanned != null && live.oneDriveScanned > 0) {
    const pct = Math.round((live.oneDriveActive / live.oneDriveScanned) * 100);
    const stale = live.oneDriveStaleSync;
    rows[3] = {
      ...rows[3],
      active: pct,
      tone: adpWorkloadTone(pct),
      of: `${fmtCount(live.oneDriveActive)} of ${fmtCount(live.oneDriveScanned)} accounts active in the last 7 days`,
      note:
        stale != null && stale > 0
          ? `${fmtCount(stale)} account(s) show no OneDrive sync activity in 30+ days.`
          : "No accounts show stale OneDrive sync activity in the last 30 days.",
      reading:
        stale != null && stale > 0
          ? `${fmtCount(stale)} account(s) have not synced in 30+ days and are not marked deleted — a client-side sync-health proxy, not a literal error read.`
          : rows[3].reading,
      src: "getOneDriveUsageAccountDetail(period=D7, D30)",
      window: "7 days",
    };
  }

  return rows;
}

/** `adpDeptCoverage` / `adpDeptNote` (19827-19830) — the department-mapping caveat. */
export const ADP_DEPT = {
  coverage: "1,036 of 1,240 mapped",
  note: "Read from the Entra department attribute. 204 people have it blank or misspelled and sit outside every row below, so treat these as indicative until they are mapped.",
} as const;

/**
 * `adpKindLegend` (19847-19851). THREE bands — who does the work and whether it
 * costs you anything — even though only two play kinds exist, because the legend
 * is naming the cost model, not the play taxonomy.
 */
export const ADP_KIND_LEGEND: readonly { label: string; dot: string }[] = [
  { label: "We deliver it · billable", dot: "#fb923c" },
  { label: "We configure it · included in your plan", dot: "#60a5fa" },
  { label: "Your team does it · no cost", dot: "#34d399" },
];

/* ── Department matrix — ADP_MATRIX (12664-12674) ─────────────────────────── */

export const ADP_MATRIX = {
  cols: ["Teams channels", "OneDrive sync", "Copilot", "Mobile"] as const,
  rows: [
    { dept: "Engineering", people: 96, vals: [71, 88, 74, 68] },
    { dept: "Sales", people: 148, vals: [52, 61, 66, 84] },
    { dept: "Finance", people: 41, vals: [24, 39, 18, 31] },
    { dept: "Operations", people: 212, vals: [33, 54, 12, 49] },
    { dept: "HR", people: 28, vals: [46, 71, 43, 57] },
    { dept: "Legal", people: 14, vals: [21, 36, 7, 22] },
  ],
};

/**
 * The heatmap cell tone (12679-12684). Note the BACKGROUND alpha also steps with
 * the band — `1f` at green, `18` at amber, `14` at red — so a strong cell is
 * both greener AND more filled. Using one alpha for all three flattens the map.
 */
export function adpMatrixCell(v: number) {
  const c = v >= 70 ? "#34d399" : v >= 45 ? "#fb923c" : "#f87171";
  const alpha = v >= 70 ? "1f" : v >= 45 ? "18" : "14";
  return { c, alpha };
}

/** The reading under the matrix (3338) — the pattern, stated rather than implied. */
export const ADP_MATRIX_NOTE =
  "Finance, Operations and Legal sit at the bottom of every column and have no champion between them. That is the pattern worth acting on — the plays below start there.";

/* ── Plays — ADP_PLAYS (12688-12775) ──────────────────────────────────────── */

export interface AdpPlay {
  id: string;
  title: string;
  kind: AdpPlayKind;
  now: string;
  target: string;
  affects: string;
  why: string;
  upside: string;
  value: string;
  plan: { k: string; v: string }[];
  effort: string;
  canAutomate: boolean;
  actionLabel: string;
  actionSub: string;
}

/**
 * `adpKindMeta` (14583-14586). The prototype's own source comment: "'Play' meant
 * nothing to anyone reading it. Each item now says who does the work." So the
 * badge on every play row names the delivery model, and agrees with the cost
 * legend above it (ADP_KIND_LEGEND) rather than the superseded play taxonomy.
 */
export const ADP_KIND_META: Readonly<Record<AdpPlayKind, { label: string; c: string }>> = {
  play: { label: "We deliver it · billable", c: "#fb923c" },
  hybrid: { label: "We configure it · included", c: "#60a5fa" },
};

export const ADP_PLAYS: readonly AdpPlay[] = [
  {
    id: "ADP-01",
    title: "Copilot is assigned to 68 people and nobody has been trained",
    kind: "play",
    now: "41 weekly active · 12 using it outside Teams",
    target: "60 weekly active · 40 using it in Word or Excel",
    affects: "68 assigned users, 27 of them idle",
    why: "The seats are bought and the licence is the expensive part — this is the cheap half. Usage is concentrated almost entirely in meeting recap because that is the one surface people stumble into without being shown. Nobody has run a session on prompting, and the two departments with the lowest usage are the two with the most repetitive document work.",
    upside: "Finance and Operations are the lowest-usage departments and the highest-volume document producers. Moving them from 12% to 50% is where the return on the Copilot line actually appears.",
    value: "$810/mo of assigned-but-idle seats, and the same seats are on the Licensing reassignment list",
    plan: [
      { k: "Shape", v: "Two 45-minute live sessions per department, recorded, plus a one-page prompt card for the three tasks that department does most" },
      { k: "Timeline", v: "Weeks 1–4. One department per week, lowest usage first." },
      { k: "Who runs it", v: "Shane McCaw Consulting delivers the sessions; your champions host and follow up in-channel" },
      { k: "Measured by", v: "Weekly active users per department, and Copilot actions outside Teams — both read straight from the usage report, not from a survey" },
      { k: "Prerequisite", v: "None. Everything needed is already licensed and enabled." },
    ],
    effort: "4 weeks · 2 sessions per dept",
    canAutomate: false,
    actionLabel: "Run the Copilot enablement play with us",
    actionSub: "We deliver the sessions; you keep the recordings and the prompt cards",
  },
  {
    id: "ADP-02",
    title: "OneDrive sync is not configured on 84 of 212 devices",
    kind: "hybrid",
    now: "60% of devices syncing Known Folders",
    target: "95% of devices, silently configured",
    affects: "84 devices, 61 users who have never synced anything",
    why: "Work on those 84 devices lives on local disks. That means no version history, nothing to recover after a hardware failure, and — the part that matters for the rest of the programme — Copilot cannot see any of it. Known Folder Move handles this silently through Intune, so this is one of the few plays on this page with a real technical enabler behind it.",
    upside: "It removes the single biggest blind spot in your Copilot grounding without asking anyone to change how they work. Nobody notices the change except when they need a file they lost.",
    value: "No licence cost. It is the prerequisite that makes the Copilot investment produce answers grounded in real work.",
    plan: [
      { k: "Shape", v: "Intune configuration profile: silently move Desktop, Documents and Pictures, silently sign in with the work account, block the sync of personal accounts" },
      { k: "Timeline", v: "Week 1 pilot on 20 devices, week 2 the remaining 64" },
      { k: "Who runs it", v: "We configure and stage the profile; your team approves the assignment" },
      { k: "Measured by", v: "Devices reporting KFM enabled, and first-sync completion per user" },
      { k: "Watch for", v: "Large local archives on 6 devices — those get a staged first sync outside working hours so nobody loses a morning to it" },
    ],
    effort: "2 weeks · mostly invisible",
    canAutomate: true,
    actionLabel: "Stage the Known Folder Move profile",
    actionSub: "Pilot on 20 devices first, then the remaining 64",
  },
  {
    id: "ADP-03",
    title: "62% of collaboration still happens in 1:1 chat rather than channels",
    kind: "play",
    now: "38% of messages in channels",
    target: "60% in channels within a quarter",
    affects: "Every department, most sharply Finance and Legal",
    why: "Chat is private by design, so anything decided there is invisible to the next person who joins, absent from search, and outside Copilot’s reach. This is not a compliance problem and nothing is at risk — it is institutional memory quietly being written to a place nobody else can read.",
    upside: "A new joiner in Finance currently has to ask three people for context that would have been in a channel. That is the cost, and it is paid every time someone joins or covers.",
    value: "No cost to change. The return is onboarding time and less repeated work.",
    plan: [
      { k: "Shape", v: 'Pick two real workflows per department and move them into channels with a named owner, rather than asking people to "use channels more"' },
      { k: "Timeline", v: "Weeks 2–8, two departments at a time" },
      { k: "Who runs it", v: "Your champions lead it. We provide the workflow templates and sit in the first session." },
      { k: "Measured by", v: "Share of messages posted in channels per department, monthly" },
      { k: "Honest caveat", v: "Finance and Legal have legitimate reasons for private conversation. The target for those two is lower by design, and that is fine." },
    ],
    effort: "6 weeks · champion-led",
    canAutomate: false,
    actionLabel: "Run the channel-first play with us",
    actionSub: "Two workflows per department, not a behaviour campaign",
  },
  {
    id: "ADP-04",
    title: "Teams Phone is licensed on 41 seats and has never been provisioned",
    kind: "hybrid",
    now: "0 of 41 licensed seats in use",
    target: "41 seats provisioned, or the licences released",
    affects: "41 people, mostly Sales and Operations",
    why: "Someone bought calling for the people who are on the phone all day and the project stopped before provisioning. This is the clearest example on the page of paying for capability and receiving none of it — and unlike the other plays it has a binary ending: either it gets provisioned or the licences should go back to the Licensing page.",
    upside: "Sales is currently running on personal mobiles, so call history and recording live nowhere. Provisioning fixes a capability gap and a records gap at the same time.",
    value: "41 seats at $8 = $328/mo either producing value or recoverable",
    plan: [
      { k: "Shape", v: "Number porting plan, calling policies, emergency address per site, then a pilot group of 8 in Sales" },
      { k: "Timeline", v: "Weeks 1–2 planning and porting request, weeks 6–10 cutover once numbers release" },
      { k: "Who runs it", v: "We handle policy configuration and the porting paperwork; your telco relationship stays yours" },
      { k: "Measured by", v: "Provisioned seats, then call minutes per provisioned user at week 4" },
      { k: "The other ending", v: "If calling is not wanted, say so and the 41 licences move to the Licensing recovery list at $3,936 a year" },
    ],
    effort: "10 weeks · porting dependent",
    canAutomate: false,
    actionLabel: "Scope the Teams Phone rollout",
    actionSub: "Includes the release-the-licences option costed alongside it",
  },
  {
    id: "ADP-05",
    title: "Power BI is included in E5 and 12 of 202 holders have opened it",
    kind: "play",
    now: "6% of E5 holders",
    target: "25% within two quarters",
    affects: "202 E5 holders; Finance and Operations first",
    why: "You are already paying for Power BI inside E5, and the Licensing page shows twelve people bought a second standalone licence because they did not know that. Reporting is being done in spreadsheets emailed around, which is slower and less reliable than the thing you own.",
    upside: "Three reports produced manually every month — the finance pack, the operations dashboard, the sales pipeline — are the obvious first builds. Automating those three is roughly two days of work and recurring hours back every month.",
    value: "Zero additional licence cost. Removes the $168/mo duplicate subscription reason as a side effect.",
    plan: [
      { k: "Shape", v: "Build three real reports with the people who currently make them by hand, rather than running a Power BI training course" },
      { k: "Timeline", v: "Weeks 3–10, one report at a time" },
      { k: "Who runs it", v: "Joint. We build the first, co-build the second, watch the third." },
      { k: "Measured by", v: "Monthly active Power BI users, and hours saved on the three named reports" },
      { k: "Prerequisite", v: "Confirm workspace ownership so the reports do not end up owned by one person’s account" },
    ],
    effort: "8 weeks · 3 reports",
    canAutomate: false,
    actionLabel: "Build the first three reports with us",
    actionSub: "Starts with the finance pack, the most manual of the three",
  },
  {
    id: "ADP-06",
    title: "Meeting recording and transcription are on, and only 23% of meetings use them",
    kind: "hybrid",
    now: "23% of eligible meetings",
    target: "50% for internal recurring meetings",
    affects: "All meeting organisers; recurring internal meetings first",
    why: "Transcription went on two scans ago and usage climbed from 9% to 23% on its own, which tells you the appetite is there. The remaining gap is that recording is a per-meeting decision nobody remembers to make. Auto-recording can be set on recurring internal meetings by policy.",
    upside: "Recap and follow-up actions are the Copilot feature people find most useful, and they only work on meetings that were recorded. This play makes the Copilot play land harder.",
    value: "No cost. It compounds with the Copilot enablement play.",
    plan: [
      { k: "Shape", v: "Teams meeting policy change for auto-recording on internal recurring meetings, plus a short note on how to turn it off for a sensitive conversation" },
      { k: "Timeline", v: "Week 2 policy change, week 3 the note, week 6 review" },
      { k: "Who runs it", v: "We stage the policy; you approve. The comms note is yours to send in your own voice." },
      { k: "Measured by", v: "Share of internal recurring meetings with a recording, and recap usage after" },
      { k: "Handle carefully", v: "HR and Legal meetings are excluded from auto-recording by policy scope, not by asking people to remember" },
    ],
    effort: "3 weeks · policy + one note",
    canAutomate: true,
    actionLabel: "Stage the auto-recording policy",
    actionSub: "Scoped to internal recurring meetings, HR and Legal excluded",
  },
];

/** `actionGo` (12799) — the play's own id, lowercased, behind an `adp-` prefix. */
export function adpPlayFixKey(play: AdpPlay): string {
  return `adp-${play.id.toLowerCase()}`;
}

/* ── Parked plays — ADP_PARKED (12809-12819) ──────────────────────────────── */

export const ADP_PARKED: readonly {
  id: string;
  title: string;
  decision: string;
  rationale: string;
  cost: string;
  owner: string;
  revisit: string;
  register: string;
}[] = [
  {
    id: "ADP-P1",
    title: "Viva Engage launch",
    decision: "Parked this quarter",
    rationale:
      "A company-wide social feed was tried in 2024 and did not take. Leadership would rather put the change-management effort behind Copilot and channels this year than relaunch something people already ignored once.",
    cost: "Foregone upside only. Nothing degrades and nothing is exposed — 4% of staff use Engage today and that number simply stays where it is.",
    owner: "Chief of Staff",
    revisit: "Q1 2027 planning",
    register: "ADP-2026-002",
  },
  {
    id: "ADP-P2",
    title: "Planner rollout beyond Engineering and Sales",
    decision: "Parked this quarter",
    rationale:
      "Operations runs project tracking in a line-of-business system that is not being replaced this year. Pushing Planner alongside it would create two sources of truth, which is worse than one imperfect one.",
    cost: "Adoption stays at 22%. The metric will keep showing amber, which is the correct reading of a deliberate decision rather than a gap.",
    owner: "Operations Director",
    revisit: "When the LOB contract renews, March 2027",
    register: "ADP-2026-005",
  },
];

/** The parked card's meta grid (12822-12826) — THREE fields, not four. */
export function adpParkedMeta(p: (typeof ADP_PARKED)[number]) {
  return [
    { k: "Owner", v: p.owner },
    { k: "Revisit", v: p.revisit },
    { k: "Register", v: p.register },
  ];
}

/* ── Wins — ADP_WINS (12629-12636) ────────────────────────────────────────── */

export const ADP_WINS: readonly {
  what: string;
  from: string;
  to: string;
  delta: string;
  when: string;
}[] = [
  { what: "Teams channel messages", from: "4,100/wk", to: "5,490/wk", delta: "+34%", when: "since scan 1" },
  { what: "OneDrive Known Folder Move", from: "44%", to: "60%", delta: "+16 pts", when: "scans 6–14" },
  { what: "Copilot weekly active users", from: "22", to: "41", delta: "+19 people", when: "since the pilot opened" },
  { what: "Mobile app configured", from: "51%", to: "59%", delta: "+8 pts", when: "since scan 4" },
  { what: "Meetings with a recording", from: "9%", to: "23%", delta: "+14 pts", when: "since transcription went on" },
  { what: "SharePoint news readership", from: "112", to: "486", delta: "4.3×", when: "after the intranet refresh" },
];

/**
 * `adpWinRows` tiering (14425-14430) — bigger movement, bigger box. A multiplier
 * ("4.3×") weighs 12× its factor; a points/percent move weighs its own
 * magnitude. Tier 2 at ≥40, tier 1 at ≥18, else tier 0. The box, glow, delta and
 * label all scale off the returned tier, so "how far it moved" is legible from
 * across the panel without reading a single number.
 */
export function adpWinTier(delta: string): 0 | 1 | 2 {
  const mult = /×/.test(delta) ? parseFloat(delta) : 0;
  const pts = /pt|%/.test(delta) ? Math.abs(parseFloat(delta.replace(/[^0-9.\-]/g, ""))) : 0;
  const weight = mult ? mult * 12 : pts;
  return weight >= 40 ? 2 : weight >= 18 ? 1 : 0;
}

/* ── Enablers — ADP_ENABLERS (12828-12835) ────────────────────────────────── */

export const ADP_ENABLERS: readonly {
  name: string;
  detail: string;
  status: string;
  tone: AdpTone;
  fixKey: string;
}[] = [
  { name: "Champions network", detail: "6 champions named across 3 departments. Finance, Operations and Legal have none, which is exactly where adoption is lowest.", status: "3 of 6 depts", tone: "amber", fixKey: "adp-champions" },
  { name: "Training delivered", detail: "No sessions in the last 6 months. The Copilot pilot opened without any enablement behind it.", status: "None in 6 mo", tone: "red", fixKey: "adp-training-plan" },
  { name: "Launch communications", detail: "No standing channel for feature announcements. Changes arrive without notice, which is the fastest way to lose goodwill for the next one.", status: "Ad hoc", tone: "amber", fixKey: "adp-comms-channel" },
  { name: "Adoption baseline reporting", detail: "Usage reports are pulled manually when someone asks. A monthly pack per department makes progress visible to the people who own it.", status: "On request", tone: "amber", fixKey: "adp-monthly-pack" },
  // Deliberately points at PLAY ADP-02's playbook, not a bespoke one: the
  // Copilot prerequisite IS the OneDrive rollout. The prototype reuses the key.
  { name: "Copilot prerequisites", detail: "OneDrive sync at 60% and channel usage at 38% both cap how useful Copilot can be, regardless of training.", status: "Capping value", tone: "amber", fixKey: "adp-adp-02" },
  { name: "Usage report anonymisation", detail: "Reports are set to show real names, which is what makes per-department targeting possible. Worth a note to staff about how the data is used.", status: "Names shown", tone: "green", fixKey: "adp-report-transparency" },
];

/* ── Provenance — ADP_PROV (12846-12856) ──────────────────────────────────── */

export const ADP_PROV: readonly {
  src: "graph" | "ps" | "derived";
  call: string;
  scope: string;
  note: string;
}[] = [
  { src: "graph", call: "/v1.0/reports/getOffice365ActiveUserDetail(period='D30')", scope: "Reports.Read.All", note: "Per-service last activity per user. The base layer for every percentage on this page." },
  { src: "graph", call: "/v1.0/reports/getTeamsUserActivityUserDetail(period='D30')", scope: "Reports.Read.All", note: "Channel messages versus private chat messages per user — the 38% figure." },
  { src: "graph", call: "/v1.0/reports/getOneDriveUsageAccountDetail(period='D30')", scope: "Reports.Read.All", note: "Whether an account has ever synced, and how much sits in it." },
  { src: "graph", call: "/v1.0/deviceManagement/deviceConfigurations?$expand=assignments", scope: "DeviceManagementConfiguration.Read.All", note: "Whether a Known Folder Move profile exists and which devices it reaches. This is how 84 uncovered devices are identified." },
  { src: "graph", call: "/v1.0/reports/getMicrosoft365CopilotUsageUserDetail(period='D30')", scope: "Reports.Read.All", note: 'Copilot activity by surface, which is how "41 active but only 12 outside Teams" is measured.' },
  { src: "graph", call: "/v1.0/reports/getM365AppUserDetail(period='D30')", scope: "Reports.Read.All", note: "App and platform level usage, including mobile — the source of the mobile-configured figure." },
  { src: "ps", call: "Get-CsTeamsMeetingPolicy | Select Identity,AllowCloudRecording,AllowTranscription,AutoRecording", scope: "Teams Administrator", note: "Whether recording and transcription are permitted, and whether auto-recording can be scoped." },
  { src: "ps", call: "Get-CsOnlineUser | Select UserPrincipalName,EnterpriseVoiceEnabled,LineUri", scope: "Teams Administrator", note: "Teams Phone provisioning state per licensed user — the 0 of 41 figure." },
  { src: "derived", call: "adoptionIndex = weighted(workloadActive%, licensedSeats, departmentSize)", scope: "—", note: "The score. Weighted so a workload nobody is licensed for cannot drag it down, and a parked play is excluded rather than counted as failure." },
];

/** `adpPlayCount` / `adpParkedCount` (17474-17475) — lengths, not literals. */
export const ADP_PLAY_COUNT = ADP_PLAYS.length;
export const ADP_PARKED_COUNT = ADP_PARKED.length;
