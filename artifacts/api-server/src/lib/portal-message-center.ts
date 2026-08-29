/**
 * portal-message-center.ts — turns the tenant's real Microsoft 365 Message
 * Center rows into the dataset the Customer Portal v2 "Microsoft Changes" page
 * is drawn from.
 *
 * The rows come from `msp_message_center_items`, which `message-center-sync.ts`
 * fills from Graph `/admin/serviceAnnouncement/messages` on a daily schedule.
 * Nothing here fetches from Graph; this module is pure derivation over rows that
 * are already persisted, which is what makes it unit-testable without a tenant.
 *
 * ── The one rule this module is written around ─────────────────────────────
 * Every value it emits is derived from a field Microsoft actually publishes.
 * Where the design's fixture carries a number that only a read of the tenant's
 * OWN configuration could produce — how many mailboxes still use legacy auth,
 * which named person owns Exchange, what the service desk will be asked — this
 * module emits nothing and says so, rather than inventing a plausible figure.
 * The page keeps the design fixture for those surfaces and the route's response
 * marks which is which (`derivedFrom`). A fabricated "11 accounts affected" on a
 * real customer's screen is worse than an honest blank.
 *
 * ── What Microsoft actually gives us, per post ─────────────────────────────
 *   category                    stayInformed | planForChange | preventOrFixIssue
 *   isMajorChange               boolean
 *   services[]                  e.g. ["Microsoft Teams"]
 *   tags[]                      e.g. ["User impact", "Retirement"]
 *   body.content                the post itself, as HTML
 *   startDateTime               when Microsoft published it
 *   endDateTime                 when the rollout completes
 *   actionRequiredByDateTime    the hard deadline, when there is one
 *   lastModifiedDateTime        the last edit
 *
 * Of the thirty-three fields on the page's `MsPost`, nine have a real source in
 * that list. The rest are tenant analysis (`youSay`, `evidence`, `seats`,
 * `ignore`), change-control linkage (`crCode`), or people (`toldYou`), and are
 * left for the caller to fill from the design fixture or leave stated-absent.
 */

/** One `msp_message_center_items` row, narrowed to what derivation reads. */
export interface MessageCenterRow {
  readonly graphMessageId: string;
  readonly title: string;
  readonly category: string | null;
  readonly isMajorChange: boolean;
  readonly services: readonly string[];
  readonly tags: readonly string[];
  readonly bodyContent: string | null;
  readonly startDateTime: Date | null;
  readonly endDateTime: Date | null;
  readonly actionRequiredByDateTime: Date | null;
  readonly lastModifiedDateTime: Date;
  readonly lastSeenAt: Date;
  /** #1536 — the prose rollout-schedule phrase, or null. Advisory only; see `DATE_UNCLEAR`'s header. */
  readonly advisoryDateText: string | null;
}

/* ── The workload axis ─────────────────────────────────────────────────────
 *
 * The design draws six workload rows. Microsoft's `services[]` uses far more
 * names than that (nineteen distinct values in the live testbed tenant alone),
 * so they are folded onto the six the page knows how to colour, plus one
 * explicit residual row — "M365" — that catches everything else.
 *
 * The residual row EXISTS rather than the unmapped services being dropped,
 * because dropping them would make every total on the page quietly wrong: the
 * wave counts, the stat cards and the density grid all sum the same corpus, and
 * a silently-discarded service breaks that agreement. A visible "everything
 * else" row is honest; a missing 58 Dynamics posts is not.
 */
export const WORKLOAD_ORDER = ["Exchange", "Teams", "SharePoint", "Entra", "Purview", "Copilot", "M365"] as const;
export type Workload = (typeof WORKLOAD_ORDER)[number];

/** The readable name each workload row carries. */
export const WORKLOAD_NAMES: Readonly<Record<Workload, string>> = {
  Exchange: "Exchange Online & Apps",
  Teams: "Microsoft Teams",
  SharePoint: "SharePoint & OneDrive",
  Entra: "Entra ID",
  Purview: "Purview",
  Copilot: "Copilot",
  M365: "Microsoft 365 suite & other apps",
};

/**
 * Substring tests against Microsoft's own service strings, in priority order.
 * Ordered, not a map, because the names overlap: "Microsoft 365 Copilot Chat"
 * must reach Copilot before the "Microsoft 365" test claims it, and "Microsoft
 * Defender XDR" must not be read as Entra just because both are security.
 */
const WORKLOAD_MATCHERS: ReadonlyArray<{ readonly wl: Workload; readonly test: (s: string) => boolean }> = [
  { wl: "Copilot", test: (s) => s.includes("copilot") },
  { wl: "Exchange", test: (s) => s.includes("exchange") || s.includes("outlook") },
  { wl: "Teams", test: (s) => s.includes("teams") },
  { wl: "SharePoint", test: (s) => s.includes("sharepoint") || s.includes("onedrive") },
  { wl: "Entra", test: (s) => s.includes("entra") || s.includes("azure active directory") },
  { wl: "Purview", test: (s) => s.includes("purview") || s.includes("compliance center") },
];

/** Folds one Microsoft service name onto a workload row. Unmatched lands on M365. */
export function workloadForService(service: string): Workload {
  const s = service.trim().toLowerCase();
  for (const m of WORKLOAD_MATCHERS) {
    if (m.test(s)) return m.wl;
  }
  return "M365";
}

/**
 * A post's workload. Microsoft can list several services on one post; the FIRST
 * that folds onto a named row wins, and a post whose services all fold to the
 * residual stays there. Taking the first named row rather than the first service
 * matters: a post tagged ["Microsoft 365 suite", "Microsoft Teams"] is a Teams
 * change that Microsoft happened to file broadly, and belongs on the Teams row.
 */
export function workloadForPost(services: readonly string[]): Workload {
  for (const svc of services) {
    const wl = workloadForService(svc);
    if (wl !== "M365") return wl;
  }
  return "M365";
}

/* ── The kind of change ────────────────────────────────────────────────────
 *
 * The density grid stacks four kinds per cell and the wave tiles count them, so
 * a post must land in EXACTLY ONE. The classification is a priority ladder over
 * Microsoft's own category and tags — never over a reading of the tenant.
 */
export type ChangeKind = "b" | "d" | "v" | "s";

/**
 * b — breaks something: Microsoft filed it as "prevent or fix an issue" (its own
 *     wording for "act or something stops working"), or tagged it a Retirement.
 * d — needs a decision: a plan-for-change post with a hard deadline, or one
 *     Microsoft flags as a major change carrying admin impact. The deadline is
 *     the strongest available signal that a choice expires.
 * v — your people will see it: Microsoft's own "User impact" tag. This is a
 *     published claim about end users, not a guess about this tenant's staff.
 * s — silent: everything left, which is most of it, and the page says so.
 */
export function kindForPost(row: Pick<MessageCenterRow, "category" | "tags" | "isMajorChange" | "actionRequiredByDateTime">): ChangeKind {
  const tags = row.tags.map((t) => t.toLowerCase());
  const has = (t: string) => tags.some((x) => x.includes(t));

  if (row.category === "preventOrFixIssue" || has("retirement")) return "b";
  if (row.category === "planForChange" && (row.actionRequiredByDateTime !== null || (row.isMajorChange && has("admin impact")))) return "d";
  if (has("user impact")) return "v";
  return "s";
}

/**
 * The readable kind label on a post. Microsoft's tags name the change better
 * than its category does ("Retirement" against "preventOrFixIssue"), so a tag
 * is preferred and the category is the fallback.
 */
export function kindLabel(row: Pick<MessageCenterRow, "category" | "tags">): string {
  const tags = row.tags.map((t) => t.trim());
  for (const preferred of ["Retirement", "Deferred feature", "Feature update", "New feature"]) {
    if (tags.some((t) => t.toLowerCase() === preferred.toLowerCase())) return preferred;
  }
  if (row.category === "preventOrFixIssue") return "Action required";
  if (row.category === "planForChange") return "Plan for change";
  return "Stay informed";
}

/**
 * The date the page reads a post as landing on. Preference order is
 * deadline → rollout end → publication, because that is the date the reader is
 * actually being asked about. `lastModifiedDateTime` is the last resort and
 * never null, so this always returns a date.
 */
export function effectiveDate(row: Pick<MessageCenterRow, "actionRequiredByDateTime" | "endDateTime" | "startDateTime" | "lastModifiedDateTime">): Date {
  return row.actionRequiredByDateTime ?? row.endDateTime ?? row.startDateTime ?? row.lastModifiedDateTime;
}

/* ── The time axis ─────────────────────────────────────────────────────────
 *
 * Eleven uneven buckets: three fortnights, six months, two quarters. The
 * unevenness is the design's point — the near term gets the resolution and the
 * far term gets compressed — and it is reproduced here against the real clock
 * rather than hardcoded, so the axis still reads correctly next March.
 *
 * The FIVE-BAND SHAPE IS FIXED (1 / 2 / 3 / 3 / 2 buckets). It has to be: the
 * page's wave URLs are positional — `WAVE_SLUGS[bandIndex]`, i.e.
 * late-august / september / q2 / q3 / beyond — and the shell's nav is built from
 * the same list. A band count that moved with the data would break every
 * bookmarked wave URL. Only the LABELS move with the clock.
 */
export interface Bucket {
  readonly label: string;
  readonly sub: string;
  readonly wave: string;
  /** Inclusive start of the period, as an ISO instant. */
  readonly from: string;
  /** Exclusive end of the period. */
  readonly to: string;
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/** UTC throughout: the stored timestamps are timestamptz and the axis must not shift with the server's zone. */
function utc(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m, d));
}

function startOfUtcDay(d: Date): Date {
  return utc(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

/** "24 Aug" — the form a bucket label uses. */
function dayLabel(d: Date): string {
  return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`;
}

/**
 * Builds the eleven buckets from `now`.
 *
 * Buckets 0-2 are fortnights starting today, 3-8 are the six whole months that
 * follow them, and 9-10 are the two quarters after that. The month buckets start
 * at the first of the month AFTER the fortnights end, so no day is counted
 * twice and no day falls between two buckets.
 */
export function buildBuckets(now: Date): readonly Bucket[] {
  const day0 = startOfUtcDay(now);
  const out: Bucket[] = [];

  /**
   * Where the month grid takes over from the fortnights.
   *
   * The month buckets have to start on the 1st, and the third fortnight has to
   * end exactly where they begin or the axis has a hole in it — an earlier cut
   * of this ran the fortnights to day0+42 and then started the months at the
   * NEXT first-of-month, which silently dropped every post landing in between
   * (October, on the design's own date). So the third fortnight is the one
   * variable-length bucket: it runs from day0+28 to the following month
   * boundary. On 20 August that is 17 Sep → 1 Oct, exactly the design's own
   * "21 Sep – 4 Oct" shape.
   *
   * The guard covers day0+28 landing a day or two before a month end, which
   * would otherwise leave a two-day sliver on the grid: below a week, the
   * bucket absorbs the following month instead.
   */
  const runUpStart = addDays(day0, 28);
  let firstMonth = utc(runUpStart.getUTCFullYear(), runUpStart.getUTCMonth() + 1, 1);
  if ((firstMonth.getTime() - runUpStart.getTime()) / 86_400_000 < 7) {
    firstMonth = utc(firstMonth.getUTCFullYear(), firstMonth.getUTCMonth() + 1, 1);
  }

  // 0-2 — three fortnights, the last running up to the month boundary.
  for (let i = 0; i < 3; i++) {
    const from = addDays(day0, i * 14);
    const to = i === 2 ? firstMonth : addDays(day0, (i + 1) * 14);
    const last = addDays(to, -1);
    out.push({
      label: dayLabel(from),
      sub: `– ${dayLabel(last)}`,
      wave: "",
      from: from.toISOString(),
      to: to.toISOString(),
    });
  }

  // 3-8 — the six whole months that follow.
  for (let i = 0; i < 6; i++) {
    const from = utc(firstMonth.getUTCFullYear(), firstMonth.getUTCMonth() + i, 1);
    const to = utc(firstMonth.getUTCFullYear(), firstMonth.getUTCMonth() + i + 1, 1);
    out.push({
      label: MONTHS_SHORT[from.getUTCMonth()],
      sub: String(from.getUTCFullYear()),
      wave: "",
      from: from.toISOString(),
      to: to.toISOString(),
    });
  }

  // 9-10 — two quarters. The last one is OPEN-ENDED: everything Microsoft has
  // announced beyond the axis belongs somewhere, and the design's own last
  // bucket is "Q4 and beyond". A closed final bucket would drop the 2028 and
  // 2037 posts the live corpus really does contain.
  const quartersStart = utc(firstMonth.getUTCFullYear(), firstMonth.getUTCMonth() + 6, 1);
  for (let i = 0; i < 2; i++) {
    const from = utc(quartersStart.getUTCFullYear(), quartersStart.getUTCMonth() + i * 3, 1);
    const to = utc(quartersStart.getUTCFullYear(), quartersStart.getUTCMonth() + (i + 1) * 3, 1);
    const lastMonth = utc(from.getUTCFullYear(), from.getUTCMonth() + 2, 1);
    out.push({
      label: `${MONTHS_SHORT[from.getUTCMonth()]} – ${MONTHS_SHORT[lastMonth.getUTCMonth()]}`,
      sub: String(from.getUTCFullYear()),
      wave: "",
      // The final bucket swallows everything after it — see above.
      from: from.toISOString(),
      to: i === 1 ? utc(from.getUTCFullYear() + 100, 0, 1).toISOString() : to.toISOString(),
    });
  }

  return applyWaves(out);
}

/**
 * Names the five bands over the fixed 1 / 2 / 3 / 3 / 2 bucket grouping.
 *
 * Run on 20 August 2026 this reproduces the design's own strings — "Late August
 * wave", "September wave", "Q2 · Oct – Dec" — because the design's labels are
 * themselves a reading of that date, not arbitrary copy.
 */
function applyWaves(buckets: readonly Bucket[]): readonly Bucket[] {
  const monthOf = (b: Bucket) => new Date(b.from).getUTCMonth();
  const dayOf = (b: Bucket) => new Date(b.from).getUTCDate();

  const b0 = buckets[0];
  const band0 = `${dayOf(b0) >= 15 ? "Late " : "Early "}${MONTHS_LONG[monthOf(b0)]} wave`;
  const band1 = `${MONTHS_LONG[monthOf(buckets[1])]} wave`;
  const band2 = `Q2 · ${MONTHS_SHORT[monthOf(buckets[3])]} – ${MONTHS_SHORT[monthOf(buckets[5])]}`;
  const band3 = `Q3 · ${MONTHS_SHORT[monthOf(buckets[6])]} – ${MONTHS_SHORT[monthOf(buckets[8])]}`;
  const band4 = "Q4 and beyond";

  const waves = [band0, band1, band1, band2, band2, band2, band3, band3, band3, band4, band4];
  return buckets.map((b, i) => ({ ...b, wave: waves[i] }));
}

/** The abbreviated form a single-bucket band's header uses. */
export function waveShort(buckets: readonly Bucket[]): Readonly<Record<string, string>> {
  const monthOf = (i: number) => new Date(buckets[i].from).getUTCMonth();
  return {
    [buckets[0].wave]: `${new Date(buckets[0].from).getUTCDate() >= 15 ? "Late" : "Early"} ${MONTHS_SHORT[monthOf(0)]}`,
    [buckets[1].wave]: `${MONTHS_SHORT[monthOf(1)]} wave`,
    [buckets[3].wave]: `Q2 · ${MONTHS_SHORT[monthOf(3)]}–${MONTHS_SHORT[monthOf(5)]}`,
    [buckets[6].wave]: `Q3 · ${MONTHS_SHORT[monthOf(6)]}–${MONTHS_SHORT[monthOf(8)]}`,
    [buckets[9].wave]: "Q4 +",
  };
}

/**
 * Which bucket a date falls in, or -1 when it falls BEFORE the axis starts.
 *
 * -1 is a real answer, not a failure: roughly a fifth of the live corpus is
 * already-completed rollouts whose end date has passed. They are excluded from
 * the grid rather than pinned to bucket 0, which would show "landing in the next
 * fortnight" against a change that landed in June.
 */
export function bucketForDate(d: Date, buckets: readonly Bucket[]): number {
  const t = d.getTime();
  for (let i = 0; i < buckets.length; i++) {
    if (t >= Date.parse(buckets[i].from) && t < Date.parse(buckets[i].to)) return i;
  }
  return -1;
}

/**
 * #1536 — the "date unclear" first-class bucket.
 *
 * `effectiveDate()` always resolves to SOME date because `lastModifiedDateTime`
 * is never null, but a post whose only dates are "when Microsoft published
 * this" and "when Microsoft last edited it" has no actual signal about WHEN
 * THE CHANGE HAPPENS — publish/edit timestamps are administrative, not a
 * rollout window. Placing such a post on the grid via that fallback would be
 * exactly the failure #1536 was filed against: a bucket the reader reads as
 * "this is roughly when it lands" that is really just "this is when Microsoft
 * touched the ticket."
 *
 * `hasStructuralDate` is true once EITHER a real target date exists —
 * `actionRequiredByDateTime` (the deadline) or `endDateTime` (rollout
 * complete-by). `startDateTime` deliberately does NOT count on its own: it is
 * always "when this was announced," never "when it happens."
 */
export function hasStructuralDate(row: Pick<MessageCenterRow, "actionRequiredByDateTime" | "endDateTime">): boolean {
  return row.actionRequiredByDateTime !== null || row.endDateTime !== null;
}

/**
 * Sentinel returned by `placementForPost` for a post with no structural date
 * at all. Distinct from `bucketForDate`'s `-1` ("a real date exists, but it's
 * behind the axis") — the two are different honest states and must not be
 * conflated: one is "already happened", the other is "we don't know when."
 * Both are `< 0` so existing `bi < 0` skip-checks (density, on-axis filters)
 * correctly exclude both from the dated grid without change.
 */
export const DATE_UNCLEAR = -2;

/**
 * Where a post belongs: a real bucket index, `-1` (a real date, behind the
 * axis), or `DATE_UNCLEAR` (no structural date to place it by at all). This is
 * the ONLY function that should decide bucket placement for a post — callers
 * must not fall back to `bucketForDate(effectiveDate(row), buckets)` directly,
 * or a date-unclear post silently reappears on the grid via the
 * `lastModifiedDateTime` fallback.
 */
export function placementForPost(
  row: Pick<MessageCenterRow, "actionRequiredByDateTime" | "endDateTime" | "startDateTime" | "lastModifiedDateTime">,
  buckets: readonly Bucket[],
): number {
  if (!hasStructuralDate(row)) return DATE_UNCLEAR;
  return bucketForDate(effectiveDate(row), buckets);
}

/* ── Density ───────────────────────────────────────────────────────────────*/

export interface DensityRow {
  readonly wl: string;
  readonly name: string;
  readonly cells: ReadonlyArray<readonly [number, number, number, number]>;
}

/** One row per workload, one cell per bucket, each cell `[breaks, decides, visible, silent]`. */
export function buildDensity(
  rows: readonly MessageCenterRow[],
  buckets: readonly Bucket[],
): readonly DensityRow[] {
  const empty = () => buckets.map(() => [0, 0, 0, 0] as [number, number, number, number]);
  const byWl = new Map<Workload, [number, number, number, number][]>(
    WORKLOAD_ORDER.map((wl) => [wl, empty()]),
  );
  const kindIndex: Readonly<Record<ChangeKind, 0 | 1 | 2 | 3>> = { b: 0, d: 1, v: 2, s: 3 };

  for (const row of rows) {
    // Both -1 (behind the axis) and DATE_UNCLEAR (no structural date at all)
    // are < 0 and correctly excluded here — the grid only ever shows a dated,
    // on-axis post. See placementForPost's own header.
    const bi = placementForPost(row, buckets);
    if (bi < 0) continue;
    const cells = byWl.get(workloadForPost(row.services));
    if (!cells) continue;
    cells[bi][kindIndex[kindForPost(row)]] += 1;
  }

  // Only workloads Microsoft has actually posted about get a row. A tenant with
  // no Copilot posts should not be shown an empty Copilot row implying it was
  // checked and found clear — the page has no such state.
  return WORKLOAD_ORDER.map((wl) => ({
    wl,
    name: WORKLOAD_NAMES[wl],
    cells: byWl.get(wl)!.map((c) => [c[0], c[1], c[2], c[3]] as const),
  })).filter((r) => r.cells.some((c) => c[0] + c[1] + c[2] + c[3] > 0));
}

/* ── Post shaping ──────────────────────────────────────────────────────────*/

/**
 * Microsoft posts HTML. The page renders these as text, so the markup is
 * flattened rather than passed through — both because the page has nowhere to
 * put it and because rendering a third party's HTML into a customer's portal is
 * an injection surface nobody asked for.
 *
 * Block-level tags become paragraph breaks so the post keeps the shape
 * Microsoft gave it; `&nbsp;` and the four XML entities are decoded because they
 * appear in almost every real post and read as literal noise otherwise.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6])\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .trim();
}

/** "1 October 2026". */
export function formatWhen(d: Date): string {
  return `${d.getUTCDate()} ${MONTHS_LONG[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * "in 6 weeks" / "in 3 days" / "today" / "2 weeks ago".
 *
 * Months and years are counted on the CALENDAR, not by dividing days by 30.
 * 20 August to 1 February is five months and a bit; `165 / 30` rounds it to six,
 * which is a countdown that disagrees with the date printed next to it.
 */
export function formatCountdown(target: Date, now: Date): string {
  const a = startOfUtcDay(now);
  const b = startOfUtcDay(target);
  const days = Math.round((b.getTime() - a.getTime()) / 86_400_000);
  if (days === 0) return "today";

  const [from, to] = days < 0 ? [b, a] : [a, b];
  const n = Math.abs(days);

  let phrase: string;
  if (n === 1) phrase = "1 day";
  else if (n < 14) phrase = `${n} days`;
  else if (n < 60) phrase = `${Math.round(n / 7)} weeks`;
  else {
    // Whole calendar months elapsed, i.e. not counting a partial trailing month.
    let months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + to.getUTCMonth() - from.getUTCMonth();
    if (to.getUTCDate() < from.getUTCDate()) months -= 1;
    phrase = months >= 24 ? `${Math.floor(months / 12)} years` : `${months} months`;
  }
  return days < 0 ? `${phrase} ago` : `in ${phrase}`;
}

/**
 * The impact reading, and the one place worth being careful about wording.
 *
 * Message Center is already tenant-scoped — Microsoft only posts a notice to a
 * tenant whose services it applies to — so "Hits you" against a
 * `preventOrFixIssue` post is Microsoft's own claim about THIS tenant, not our
 * inference. What it is NOT is a read of the tenant's configuration: it does not
 * know whether the eleven accounts using legacy auth exist. That distinction is
 * carried on the wire as `impactBasis` so the page can state it.
 */
export function impactForPost(row: Pick<MessageCenterRow, "category" | "tags" | "isMajorChange" | "actionRequiredByDateTime">): string {
  const kind = kindForPost(row);
  if (kind === "b") return "Hits you";
  if (kind === "d") return "Might hit you";
  return "No impact";
}

/**
 * A 0-100 weight over Microsoft's published signals ONLY.
 *
 * The fixture's `score` is described in its own header as "a per-tenant impact
 * number, not Microsoft's severity" — something a configuration read produces.
 * We cannot produce that, so this deliberately computes something different and
 * the route names it differently on the wire (`scoreBasis`): how loudly
 * Microsoft is flagging this post, and how soon it lands.
 */
export function scoreForPost(row: MessageCenterRow, now: Date): number {
  const kind = kindForPost(row);
  let score = kind === "b" ? 60 : kind === "d" ? 40 : kind === "v" ? 25 : 10;
  if (row.isMajorChange) score += 15;
  if (row.actionRequiredByDateTime !== null) score += 10;

  const days = Math.round((effectiveDate(row).getTime() - now.getTime()) / 86_400_000);
  if (days <= 30) score += 15;
  else if (days <= 90) score += 8;

  if (row.services.length > 2) score += 5;
  return Math.max(0, Math.min(100, score));
}

/* ── Stat cards ────────────────────────────────────────────────────────────*/

export interface StatDef {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly sub: string;
  readonly tone: string;
}

/**
 * The six cards under "Next 12 months".
 *
 * The design's `sub` lines count how many posts have been "written up" — the
 * tenant-specific write-up that this build has no source for. Each sub line here
 * says what its number IS instead, which is a different sentence but a true one.
 */
export function buildStats(rows: readonly MessageCenterRow[], buckets: readonly Bucket[], now: Date): readonly StatDef[] {
  const onAxis = rows.filter((r) => placementForPost(r, buckets) >= 0);
  const kinds = onAxis.map((r) => kindForPost(r));

  const decisions = kinds.filter((k) => k === "d").length;
  const breaks = kinds.filter((k) => k === "b").length;
  const visible = kinds.filter((k) => k === "v").length;
  const silent = kinds.filter((k) => k === "s").length;

  const soonCutoff = addDays(startOfUtcDay(now), 60).getTime();
  const soon = onAxis.filter((r) => effectiveDate(r).getTime() <= soonCutoff).length;

  // "Edited after publishing" is a real, countable Microsoft behaviour: it tags
  // an edited post "Updated message" and moves lastModifiedDateTime past
  // startDateTime. Both are checked because the tag alone is not always set.
  const edited = onAxis.filter(
    (r) =>
      r.tags.some((t) => t.toLowerCase().includes("updated message")) ||
      (r.startDateTime !== null && r.lastModifiedDateTime.getTime() - r.startDateTime.getTime() > 86_400_000),
  ).length;

  const withDeadline = onAxis.filter((r) => r.actionRequiredByDateTime !== null).length;
  const major = onAxis.filter((r) => r.isMajorChange).length;

  return [
    { key: "decisions", label: "Need a decision", value: String(decisions), sub: `${withDeadline} with a date Microsoft has published`, tone: "#f87171" },
    { key: "hits", label: "Will break something", value: String(breaks), sub: "Retirements and act-now notices", tone: "#fbbf24" },
    { key: "soon", label: "Landing in 60 days", value: String(soon), sub: `of ${onAxis.length} on the next twelve months`, tone: "#60a5fa" },
    { key: "reversed", label: "Edited after publishing", value: String(edited), sub: "dates moved, scope widened or withdrawn", tone: "#a78bfa" },
    { key: "seen", label: "Needs an announcement", value: String(visible), sub: "tagged by Microsoft as user impact", tone: "#a78bfa" },
    { key: "none", label: "No action at all", value: String(silent), sub: `${major} of them flagged a major change anyway`, tone: "#34d399" },
  ];
}

/** "21 August, 00:45" — the design's own scan-time form, from the real sync. */
export function formatScanAt(d: Date): string {
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS_LONG[d.getUTCMonth()]}, ${hh}:${mm}`;
}

/**
 * The per-workload line under the services filter.
 *
 * The design's version reports what a tenant SCAN found ("1,240 mailboxes · 11
 * accounts still using legacy authentication"). No scan of that kind feeds this
 * page, so this reports what the Message Center itself holds for that workload,
 * and the wording says so rather than implying a configuration read.
 */
export function workloadFound(rows: readonly MessageCenterRow[], wl: string, buckets: readonly Bucket[]): string {
  const mine = rows.filter((r) => workloadForPost(r.services) === wl && placementForPost(r, buckets) >= 0);
  if (mine.length === 0) return "No posts on the next twelve months";
  const breaks = mine.filter((r) => kindForPost(r) === "b").length;
  const decide = mine.filter((r) => kindForPost(r) === "d").length;
  const tail = breaks || decide ? ` · ${breaks} act-now, ${decide} needing a decision` : " · none needing a decision";
  return `${mine.length} Microsoft ${mine.length === 1 ? "post" : "posts"} ahead${tail}`;
}

/**
 * Spends a post budget PER WAVE rather than as one global cap.
 *
 * A flat top-N over a bucket-ordered list starves the far end of the axis: on
 * the real testbed tenant 449 posts land on the axis, and a flat top-240 filled
 * up inside the first four buckets, so the Q3 and Q4 waves came back with no
 * posts at all. The page is wave-navigable and its empty states are ASSERTIONS
 * about the customer's estate ("Nothing in this wave stops working here"), so a
 * wave that was merely not sent would make the page state something untrue
 * about it.
 *
 * `items` is expected in the route's own order — bucket ascending, score
 * descending within a bucket — so taking the first `perWave` of each wave group
 * keeps that wave's highest-scoring, earliest posts. Anything whose bucket is
 * off the axis is dropped, since it belongs to no wave.
 */
export function capPerWave<T extends { bucket: number }>(
  items: readonly T[],
  buckets: readonly Bucket[],
  perWave: number,
): readonly T[] {
  const taken = new Map<string, number>();
  return items.filter((it) => {
    const wave = buckets[it.bucket]?.wave;
    if (wave === undefined) return false;
    const n = taken.get(wave) ?? 0;
    if (n >= perWave) return false;
    taken.set(wave, n + 1);
    return true;
  });
}

/**
 * The posts `placementForPost` could not place anywhere on the dated axis —
 * #1536's "date unclear" first-class bucket. Sorted most-recently-modified
 * first, since there is no real target date to sort by. In the live corpus
 * this is empty (every real post carries at least an `endDateTime`), but the
 * shape exists so a post genuinely missing both `actionRequiredByDateTime`
 * and `endDateTime` — a malformed sync, a hand-authored interpretation with
 * no linked post, or any future gap in what Microsoft sends — surfaces
 * honestly instead of silently landing on a bucket via `lastModifiedDateTime`.
 */
export function dateUnclearRows(rows: readonly MessageCenterRow[]): readonly MessageCenterRow[] {
  return rows
    .filter((r) => !hasStructuralDate(r))
    .slice()
    .sort((a, b) => b.lastModifiedDateTime.getTime() - a.lastModifiedDateTime.getTime());
}
