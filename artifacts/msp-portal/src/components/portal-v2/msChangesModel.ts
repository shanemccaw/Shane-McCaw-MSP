/**
 * msChangesModel.ts — the Microsoft Changes derivations.
 *
 * Prototype references are to 'Microsoft Changes.dc.html'.
 *
 * The module's spine is a WAVE: an uneven run of time buckets that the eleven
 * density columns are grouped into. Everything else on the page — which posts
 * are listed, which columns are lit, what the header counts — hangs off which
 * wave is selected, so the banding is derived once here and tested.
 */

import {
  FIXTURE_DATASET,
  MSC_BUCKETS,
  MSC_DENSITY,
  type MscDataset,
  type MscLanded,
  type MscQueueItem,
  type MscSeen,
  type MsPost,
  type MscDensityRow,
} from "./msChangesData";

/**
 * ── The dataset parameter ──────────────────────────────────────────────────
 *
 * Every derivation below that used to read a module constant now takes a
 * `MscDataset` as its LAST parameter, defaulting to `FIXTURE_DATASET`. That
 * shape was chosen so the design fixture keeps rendering — and every existing
 * test keeps passing — with no call site changed, while the page can hand in the
 * tenant's real Microsoft Message Center (`useMessageCenter()`) instead.
 *
 * `MSC_BUCKETS` and `MSC_DENSITY` remain imported only as the defaults for the
 * two functions whose signatures already took them explicitly.
 */

/** The workload on/off map the services filter drives. Absent means on. */
export type Services = Readonly<Record<string, boolean>>;
const svcOn = (services: Services, wl: string): boolean => services[wl] !== false;

/**
 * Which of the eleven buckets an item lands in.
 *
 * A LIVE post carries its own `bucket`, computed server-side from Microsoft's
 * published date. A FIXTURE post does not — a design fixture has no real dates —
 * so it falls back to the hand-built `itemBucket` map. -1 means "not on the
 * axis", which every caller already treats as "not in any wave".
 */
function bucketOf(item: { id: string; bucket?: number }, ds: MscDataset): number {
  return item.bucket ?? ds.itemBucket[item.id] ?? -1;
}

/** A seen item's app maps onto a scannable workload — prototype 1827. */
export function seenWorkload(app: string): string {
  if (app === "Outlook" || app === "Office apps") return "Exchange";
  if (app === "OneDrive") return "SharePoint";
  return app;
}

export interface WaveBand {
  wave: string;
  /** First bucket index in the band. */
  start: number;
  /** How many buckets it covers. */
  span: number;
}

/**
 * `waveBands` — prototype 1469-1473.
 *
 * Adjacent buckets carrying the SAME `wave` string merge into one band. That
 * is why the September wave is one two-column band rather than two, and why
 * the band list is derived rather than declared: the buckets are the source of
 * truth for the axis, and the waves are a reading of them.
 */
export function waveBands(buckets: readonly { wave: string }[] = MSC_BUCKETS): readonly WaveBand[] {
  const out: WaveBand[] = [];
  buckets.forEach((b, i) => {
    const last = out[out.length - 1];
    if (last && last.wave === b.wave) last.span += 1;
    else out.push({ wave: b.wave, span: 1, start: i });
  });
  return out;
}

/** `bucketWave` — prototype 1474. Which band index contains a bucket. */
export function bucketWave(i: number, bands: readonly WaveBand[] = waveBands()): number {
  let n = 0;
  bands.forEach((w, k) => {
    if (i >= w.start && i < w.start + w.span) n = k;
  });
  return n;
}

/**
 * `wsel` — prototype 1476. The selection is CLAMPED into range rather than
 * trusted, because it arrives from outside the module (the shell's sub-nav in
 * the prototype, the URL here) and an out-of-range value would index past the
 * band list and throw while rendering.
 */
export function clampWave(requested: number | null, bands: readonly WaveBand[] = waveBands()): number {
  if (requested === null || Number.isNaN(requested)) return 0;
  return Math.max(0, Math.min(requested, bands.length - 1));
}

/** Every bucket index inside a band — prototype 1478. */
export function bucketsInWave(waveIndex: number, bands: readonly WaveBand[] = waveBands()): readonly number[] {
  const w = bands[waveIndex];
  if (!w) return [];
  return Array.from({ length: w.span }, (_, k) => w.start + k);
}

/** `bTotals` / `bSum` — the four kind counts and their total, per bucket. */
export function bucketTotals(
  rows: readonly MscDensityRow[] = MSC_DENSITY,
  ds: MscDataset = FIXTURE_DATASET,
): ReadonlyArray<readonly [number, number, number, number]> {
  return ds.buckets.map((_, i) => {
    let b = 0, d = 0, v = 0, s = 0;
    for (const row of rows) {
      const c = row.cells[i];
      if (!c) continue;
      b += c[0];
      d += c[1];
      v += c[2];
      s += c[3];
    }
    return [b, d, v, s] as const;
  });
}

export function bucketSums(
  rows: readonly MscDensityRow[] = MSC_DENSITY,
  ds: MscDataset = FIXTURE_DATASET,
): readonly number[] {
  return bucketTotals(rows, ds).map((t) => t[0] + t[1] + t[2] + t[3]);
}

/** The count a wave header shows — prototype 1481. */
export function waveCount(
  waveIndex: number,
  rows: readonly MscDensityRow[] = MSC_DENSITY,
  ds: MscDataset = FIXTURE_DATASET,
): number {
  const sums = bucketSums(rows, ds);
  return bucketsInWave(waveIndex, waveBands(ds.buckets)).reduce((a, i) => a + (sums[i] ?? 0), 0);
}

/**
 * The wave header's label — prototype 1483-1486. A band spanning ONE bucket
 * gets the abbreviated form, because there is only one column of width to draw
 * it in; a wider band keeps the full name.
 */
export function waveLabel(band: WaveBand, ds: MscDataset = FIXTURE_DATASET): string {
  return band.span === 1 ? ds.waveShort[band.wave] ?? band.wave : band.wave;
}

/** `title` on the wave header — prototype 1482. */
export function waveTitle(band: WaveBand, count: number): string {
  return `${band.wave} · ${count} changes`;
}

export function isFreezeBucket(i: number, ds: MscDataset = FIXTURE_DATASET): boolean {
  return ds.freezeBuckets.includes(i);
}

/**
 * The named posts that land inside a wave.
 *
 * Reads the post's BUCKET rather than its own `month`, because the two index
 * different axes — see the note on MSC_ITEM_BUCKET. Sorted by bucket then by
 * descending impact, so the soonest and worst reads first.
 */
export function postsInWave(
  waveIndex: number,
  posts: readonly MsPost[] = FIXTURE_DATASET.posts,
  ds: MscDataset = FIXTURE_DATASET,
): readonly MsPost[] {
  const inWave = new Set(bucketsInWave(waveIndex, waveBands(ds.buckets)));
  return posts
    .filter((p) => inWave.has(bucketOf(p, ds)))
    .slice()
    .sort((a, b) => {
      const ab = bucketOf(a, ds);
      const bb = bucketOf(b, ds);
      return ab === bb ? b.score - a.score : ab - bb;
    });
}

/**
 * What a wave BREAKS — prototype 1761. A post counts when it is a hard
 * retirement OR its tenant impact is "Hits you"; the two are not the same, and
 * the design counts both because a change that does not technically break
 * anything can still land on people.
 */
export function breakingInWave(
  waveIndex: number,
  posts: readonly MsPost[] = FIXTURE_DATASET.posts,
  ds: MscDataset = FIXTURE_DATASET,
): readonly MsPost[] {
  return postsInWave(waveIndex, posts, ds).filter((p) => p.hard || p.impact === "Hits you");
}

/** The dots one density cell draws, in kind order — prototype 1519-1523. */
export function cellDots(cell: readonly [number, number, number, number]): readonly ("b" | "d" | "v" | "s")[] {
  const out: ("b" | "d" | "v" | "s")[] = [];
  (["b", "d", "v", "s"] as const).forEach((k, ki) => {
    for (let x = 0; x < cell[ki]; x++) out.push(k);
  });
  return out;
}

/**
 * A density cell's tooltip — prototype 1526.
 *
 * The trailing clause is an either/or, not both: it names the breaking item if
 * there is one, otherwise the decision count, otherwise nothing. Reproduced
 * exactly, including that a cell with both only mentions the break.
 */
export function cellTitle(
  rowName: string,
  bucketIndex: number,
  cell: readonly [number, number, number, number],
  ds: MscDataset = FIXTURE_DATASET,
): string {
  const total = cell[0] + cell[1] + cell[2] + cell[3];
  const b = ds.buckets[bucketIndex];
  const tail = cell[0] ? ", one breaks something" : cell[1] ? `, ${cell[1]} need a decision` : "";
  return `${rowName} · ${b.label} ${b.sub} · ${total} items${tail}`;
}

/** The per-row total the grid shows — prototype 1517. */
export function rowTotal(row: MscDensityRow): number {
  return row.cells.reduce((a, c) => a + c[0] + c[1] + c[2] + c[3], 0);
}

/* ────────────────────────────────────────────────────────────────────────────
   Part 10 — the wave page, its retrospective, and the surfaces around them
   ──────────────────────────────────────────────────────────────────────── */

export function impactTone(impact: string): string {
  return impact === "Hits you" ? "#f87171" : impact === "Might hit you" ? "#fbbf24" : "#64748b";
}

export function scoreTone(n: number): string {
  return n >= 65 ? "#f87171" : n >= 35 ? "#fbbf24" : "#34d399";
}

/** Prototype 1785 — two leading capitals off the words in a name. */
export function nameInitials(name: string): string {
  return (
    (name || "")
      .split(/[ ·]+/)
      .filter((x) => /^[A-Z]/.test(x))
      .slice(0, 2)
      .map((x) => x[0])
      .join("") || "—"
  );
}

/** The density rows still switched on — prototype 1458. */
export function activeDensity(services: Services, ds: MscDataset = FIXTURE_DATASET): readonly MscDensityRow[] {
  return ds.density.filter((r) => svcOn(services, r.wl));
}

/** A wave's four kind totals, over only the services in use — prototype 1763-1767. */
export function waveTotals(
  waveIndex: number,
  services: Services,
  bands: readonly WaveBand[] = waveBands(),
  ds: MscDataset = FIXTURE_DATASET,
): readonly [number, number, number, number] {
  const totals = bucketTotals(activeDensity(services, ds), ds);
  const t: [number, number, number, number] = [0, 0, 0, 0];
  for (const i of bucketsInWave(waveIndex, bands)) {
    const c = totals[i];
    if (!c) continue;
    t[0] += c[0];
    t[1] += c[1];
    t[2] += c[2];
    t[3] += c[3];
  }
  return t;
}

/** The wave's date range — prototype 1753-1760. */
export function rangeOf(band: WaveBand, ds: MscDataset = FIXTURE_DATASET): string {
  const a = ds.buckets[band.start];
  const b = ds.buckets[band.start + band.span - 1];
  if (band.span === 1) return `${a.label} ${a.sub}`;
  if (b.sub.indexOf("–") === 0) return `${a.label} ${b.sub}`;
  const from = a.label.split("–")[0].trim();
  const to = b.label.split("–").pop()!.trim();
  return `${from} – ${to} ${b.sub}`;
}

/** The wave's status label, falling back to its range — prototype 1865. */
export function waveStatus(
  waveIndex: number,
  bands: readonly WaveBand[] = waveBands(),
  ds: MscDataset = FIXTURE_DATASET,
): string {
  // On a LIVE dataset the design's five hardcoded status labels ("Landing now",
  // "Lands in 3 weeks"...) are a claim about dates they no longer describe, so
  // only the fixture uses them; the real axis falls back to its own range.
  if (ds.live) return rangeOf(bands[waveIndex], ds);
  return ds.waveStatus[waveIndex] ?? rangeOf(bands[waveIndex], ds);
}

/** The tenant freeze a wave lands inside, if any — prototype 1783. */
export function freezeInWave(
  waveIndex: number,
  bands: readonly WaveBand[] = waveBands(),
  ds: MscDataset = FIXTURE_DATASET,
): { i: number; label: string } | null {
  const inWave = new Set(bucketsInWave(waveIndex, bands));
  return ds.freezeBucketDefs.find((f) => inWave.has(f.i)) ?? null;
}

/** The notice-given / days-left bar — prototype 1837-1838. */
export function waveNotice(
  waveIndex: number,
  ds: MscDataset = FIXTURE_DATASET,
): { given: number; left: number; pct: number } {
  const n = ds.waveNotice[waveIndex] ?? { given: 0, left: 0 };
  const pct = Math.max(4, Math.min(96, Math.round((n.left / (n.given + n.left)) * 100)));
  return { given: n.given, left: n.left, pct };
}

export interface RaciOwner {
  name: string;
  initials: string;
  accountable: string;
}

/**
 * The responsible name a change inherits from its service — prototype 1786.
 *
 * There is no real source for this: nothing in the platform records who owns
 * Exchange at the customer. On a live dataset a workload the design never named
 * — the `M365` residual row, say — correctly falls through to "Unassigned"
 * rather than borrowing a fictional owner from a neighbouring workload.
 */
export function raciOwner(wl: string, ds: MscDataset = FIXTURE_DATASET): RaciOwner {
  const r = ds.raci[wl] ?? { r: "", a: "", c: "", i: "" };
  return { name: r.r || "Unassigned", initials: nameInitials(r.r), accountable: r.a || "" };
}

/** The service RACI rows, only for services in use — prototype 1816. */
export function raciRows(services: Services, ds: MscDataset = FIXTURE_DATASET) {
  return ds.scans.filter((sc) => svcOn(services, sc.wl)).map((sc) => {
    const r = ds.raci[sc.wl] ?? { r: "", a: "", c: "", i: "" };
    return { wl: sc.wl, name: sc.name, r: r.r || "Unassigned", a: r.a || "—", c: r.c || "—", i: r.i || "—", gap: !r.r || r.r === "Unassigned" };
  });
}

/** The workload-filter button's label — prototype 2160. */
export function servicesLabel(services: Services, ds: MscDataset = FIXTURE_DATASET): string {
  return `Services · ${ds.scans.filter((sc) => svcOn(services, sc.wl)).length} of ${ds.scans.length}`;
}

/** Whether a post sits in the selected wave AND its service is on. */
function postInScope(
  p: MsPost,
  waveIndex: number,
  services: Services,
  bands: readonly WaveBand[],
  ds: MscDataset,
): boolean {
  const inWave = new Set(bucketsInWave(waveIndex, bands));
  return svcOn(services, p.wl) && inWave.has(bucketOf(p, ds));
}

export interface WaveBreak {
  id: string;
  when: string;
  countdown: string;
  what: string;
  evidence: string;
  owner: string;
  ownerInitials: string;
  state: string;
  hasCr: boolean;
}

/** "What stops working" for a wave — prototype 1790-1802. */
export function waveBreaks(
  waveIndex: number,
  services: Services,
  bands: readonly WaveBand[] = waveBands(),
  ds: MscDataset = FIXTURE_DATASET,
): readonly WaveBreak[] {
  return ds.posts.filter(
    (p) => postInScope(p, waveIndex, services, bands, ds) && (p.hard || p.impact === "Hits you"),
  ).map((p) => {
    const ev = p.evidence.find((e) => e.bad);
    const owner = raciOwner(p.wl, ds);
    return {
      id: p.id,
      when: p.when,
      countdown: p.countdown,
      what: `${p.plain.split(". ")[0]}.`,
      evidence: ev ? `${ev.q.split(" · ")[0]} → ${ev.a}` : p.seats,
      owner: owner.name,
      ownerInitials: owner.initials,
      state: p.crCode ? `${p.crCode} · ${p.crState}` : "No change raised yet",
      hasCr: !!p.crCode,
    };
  });
}

export interface WaveQueueItem {
  post: MsPost;
  item: MscQueueItem;
  owner: string;
  ownerLine: string;
}

/** "Decide before it lands" for a wave — prototype 1803-1806. */
export function waveQueue(
  waveIndex: number,
  services: Services,
  bands: readonly WaveBand[] = waveBands(),
  ds: MscDataset = FIXTURE_DATASET,
): readonly WaveQueueItem[] {
  const inWave = new Set(bucketsInWave(waveIndex, bands));
  return ds.queue.map((item) => {
    const post = ds.posts.find((p) => p.id === item.id);
    // The queue is the design's own decision write-ups, keyed by fixture post
    // id. On a LIVE dataset no real post matches one, so this correctly yields
    // nothing rather than pinning a fixture write-up to a real Microsoft notice.
    if (!post || !svcOn(services, post.wl) || !inWave.has(bucketOf(post, ds))) return null;
    const o = raciOwner(post.wl, ds);
    // No RACI table backs any tenant (Git #1342), so `accountable` is often empty
    // and the owner is "Unassigned"; drop the "answers to …" clause rather than
    // render a dangling "answers to " with no name after it.
    const ownerLine = o.accountable ? `${o.name} · answers to ${o.accountable}` : o.name;
    return { post, item, owner: o.name, ownerLine };
  }).filter((x): x is WaveQueueItem => x !== null);
}

export interface WaveQuietItem {
  post: MsPost;
  tag: string;
  tagTone: string;
}

/** "Nothing to do" for a wave — prototype 1807-1813. Everything not breaking or queued. */
export function waveQuiet(
  waveIndex: number,
  services: Services,
  bands: readonly WaveBand[] = waveBands(),
  ds: MscDataset = FIXTURE_DATASET,
): readonly WaveQuietItem[] {
  const breakIds = new Set(waveBreaks(waveIndex, services, bands, ds).map((b) => b.id));
  const queueIds = new Set(waveQueue(waveIndex, services, bands, ds).map((q) => q.item.id));
  return ds.posts.filter(
    (p) => postInScope(p, waveIndex, services, bands, ds) && !breakIds.has(p.id) && !queueIds.has(p.id),
  ).map((p) => ({
    post: p,
    tag: p.impact === "No impact" ? "No action needed" : "Watch only",
    tagTone: p.impact === "No impact" ? "#34d399" : "#94a3b8",
  }));
}

/** The seen-in-the-wild items landing in a wave — prototype 1826-1836. */
export function seenInWave(
  waveIndex: number,
  services: Services,
  bands: readonly WaveBand[] = waveBands(),
  ds: MscDataset = FIXTURE_DATASET,
): readonly MscSeen[] {
  const inWave = new Set(bucketsInWave(waveIndex, bands));
  // Like the decision queue, these are the design's own briefings keyed by
  // fixture post id — a live dataset matches none of them, and says so on the
  // page rather than attaching a fictional briefing to a real notice.
  return ds.seen.filter(
    (v) => svcOn(services, seenWorkload(v.app)) && inWave.has(bucketOf(v, ds)),
  );
}

/** The per-bucket hit strip a group card draws — prototype 1594-1600. */
export function groupStrip(items: readonly string[], ds: MscDataset = FIXTURE_DATASET): readonly number[] {
  return ds.buckets.map((_, i) => items.filter((id) => ds.itemBucket[id] === i).length);
}

/** The wave a group's first item belongs to — prototype 1640. */
export function groupWave(items: readonly string[], ds: MscDataset = FIXTURE_DATASET): string {
  const i = ds.itemBucket[items[0]];
  return i === undefined ? "" : ds.buckets[i]?.wave ?? "";
}

export interface WaveTile {
  key: "changes" | "breaks" | "decide" | "seen";
  label: string;
  value: string;
  tone: string;
}

/**
 * The four tiles on the wave header — prototype 1869-1882. The count singularises
 * its label at exactly one, reproduced from the design's own map.
 */
export function waveTiles(
  waveIndex: number,
  services: Services,
  bands: readonly WaveBand[] = waveBands(),
  ds: MscDataset = FIXTURE_DATASET,
): readonly WaveTile[] {
  const t = waveTotals(waveIndex, services, bands, ds);
  const total = t[0] + t[1] + t[2] + t[3];
  const breaks = Math.max(t[0], waveBreaks(waveIndex, services, bands, ds).length);
  const decide = Math.max(t[1], waveQueue(waveIndex, services, bands, ds).length);
  const raw: readonly { key: WaveTile["key"]; plural: string; singular: string; value: number; tone: string }[] = [
    { key: "changes", plural: "changes in this wave", singular: "change in this wave", value: total, tone: "#60a5fa" },
    { key: "breaks", plural: "stop something working", singular: "stops something working", value: breaks, tone: "#f87171" },
    { key: "decide", plural: "need a decision", singular: "needs a decision", value: decide, tone: "#fbbf24" },
    { key: "seen", plural: "your people will notice", singular: "your people will notice", value: t[2], tone: "#a78bfa" },
  ];
  return raw.map((r) => ({ key: r.key, label: r.value === 1 ? r.singular : r.plural, value: String(r.value), tone: r.tone }));
}

/** The silent-count under the tiles — prototype 1888. */
export function waveSilent(
  waveIndex: number,
  services: Services,
  bands: readonly WaveBand[] = waveBands(),
  ds: MscDataset = FIXTURE_DATASET,
): number {
  return waveTotals(waveIndex, services, bands, ds)[3];
}

/* ── The four section meta-lines — prototype 1904-1908 ─────────────────────
 *
 * Each of these makes a CLAIM about how the number was arrived at, and on a live
 * dataset two of the design's claims are not true: nothing has been "read
 * against your own configuration" and nothing has been "written up". The lines
 * say what really happened instead — same shape, accurate sentence.
 */

export function breakMeta(
  waveIndex: number,
  services: Services,
  bands: readonly WaveBand[] = waveBands(),
  ds: MscDataset = FIXTURE_DATASET,
): string {
  const breaks = waveBreaks(waveIndex, services, bands, ds);
  if (breaks.length) {
    return ds.live
      ? `${breaks.length} Microsoft has flagged as needing action`
      : `${breaks.length} named, read against your own configuration`;
  }
  return `${waveTotals(waveIndex, services, bands, ds)[0]} flagged by Microsoft, none matched to anything you run`;
}

export function decideMeta(
  waveIndex: number,
  services: Services,
  bands: readonly WaveBand[] = waveBands(),
  ds: MscDataset = FIXTURE_DATASET,
): string {
  const q = waveQueue(waveIndex, services, bands, ds);
  if (q.length) return `${q.length} with a date after which it is decided for you`;
  if (ds.live) {
    const n = waveTotals(waveIndex, services, bands, ds)[1];
    return n
      ? `${n} carry a Microsoft deadline · none written up for a decision yet`
      : "nothing expires in this window";
  }
  return "nothing expires in this window";
}

export function seenMeta(
  waveIndex: number,
  services: Services,
  bands: readonly WaveBand[] = waveBands(),
  ds: MscDataset = FIXTURE_DATASET,
): string {
  const seen = seenInWave(waveIndex, services, bands, ds);
  const total = waveTotals(waveIndex, services, bands, ds)[2];
  if (ds.live && seen.length === 0) return `${total} tagged by Microsoft as user impact · none written up yet`;
  return `${seen.length} of ${total} written up, with the announcement drafted`;
}

export const QUIET_META = "no decision, no ticket, nothing to announce";

/* ── The retrospective — prototype 1840-1863 ─────────────────────────────── */

export interface PastTile {
  label: string;
  value: string;
  tone: string;
}

export interface PastWave {
  name: string;
  range: string;
  verdict: string;
  tone: string;
  tiles: readonly PastTile[];
  rows: MscLanded["rows"];
}

export function pastWave(index: number, ds: MscDataset = FIXTURE_DATASET): PastWave | null {
  const w = ds.landed[index];
  if (!w) return null;
  const tiles: PastTile[] = [
    { label: "changes landed", value: String(w.items), tone: "#60a5fa" },
    { label: w.moved === 1 ? "date Microsoft moved" : "dates Microsoft moved", value: String(w.moved), tone: "#a78bfa" },
    { label: w.tickets === 1 ? "ticket raised" : "tickets raised", value: String(w.tickets), tone: w.tickets > 10 ? "#f87171" : "#fbbf24" },
    { label: w.incidents === 1 ? "incident" : "incidents", value: String(w.incidents), tone: w.incidents ? "#f87171" : "#34d399" },
  ];
  return { name: w.name, range: w.range, verdict: w.verdict, tone: w.tone, tiles, rows: w.rows };
}
