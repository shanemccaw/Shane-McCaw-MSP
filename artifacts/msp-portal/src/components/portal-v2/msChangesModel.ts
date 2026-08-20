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
  MSC_BUCKETS,
  MSC_DENSITY,
  MSC_FREEZE_BUCKETS,
  MSC_ITEM_BUCKET,
  MSC_WAVE_SHORT,
  MS_POSTS,
  type MsPost,
  type MscDensityRow,
} from "./msChangesData";

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
): ReadonlyArray<readonly [number, number, number, number]> {
  return MSC_BUCKETS.map((_, i) => {
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

export function bucketSums(rows: readonly MscDensityRow[] = MSC_DENSITY): readonly number[] {
  return bucketTotals(rows).map((t) => t[0] + t[1] + t[2] + t[3]);
}

/** The count a wave header shows — prototype 1481. */
export function waveCount(waveIndex: number, rows: readonly MscDensityRow[] = MSC_DENSITY): number {
  const sums = bucketSums(rows);
  return bucketsInWave(waveIndex).reduce((a, i) => a + (sums[i] ?? 0), 0);
}

/**
 * The wave header's label — prototype 1483-1486. A band spanning ONE bucket
 * gets the abbreviated form, because there is only one column of width to draw
 * it in; a wider band keeps the full name.
 */
export function waveLabel(band: WaveBand): string {
  return band.span === 1 ? MSC_WAVE_SHORT[band.wave] ?? band.wave : band.wave;
}

/** `title` on the wave header — prototype 1482. */
export function waveTitle(band: WaveBand, count: number): string {
  return `${band.wave} · ${count} changes`;
}

export function isFreezeBucket(i: number): boolean {
  return MSC_FREEZE_BUCKETS.includes(i);
}

/**
 * The named posts that land inside a wave.
 *
 * Reads MSC_ITEM_BUCKET rather than the post's own `month`, because the two
 * index different axes — see the note on MSC_ITEM_BUCKET. Sorted by bucket then
 * by descending impact, so the soonest and worst reads first.
 */
export function postsInWave(
  waveIndex: number,
  posts: readonly MsPost[] = MS_POSTS,
): readonly MsPost[] {
  const inWave = new Set(bucketsInWave(waveIndex));
  return posts
    .filter((p) => inWave.has(MSC_ITEM_BUCKET[p.id] ?? -1))
    .slice()
    .sort((a, b) => {
      const ab = MSC_ITEM_BUCKET[a.id] ?? 0;
      const bb = MSC_ITEM_BUCKET[b.id] ?? 0;
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
  posts: readonly MsPost[] = MS_POSTS,
): readonly MsPost[] {
  return postsInWave(waveIndex, posts).filter((p) => p.hard || p.impact === "Hits you");
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
): string {
  const total = cell[0] + cell[1] + cell[2] + cell[3];
  const b = MSC_BUCKETS[bucketIndex];
  const tail = cell[0] ? ", one breaks something" : cell[1] ? `, ${cell[1]} need a decision` : "";
  return `${rowName} · ${b.label} ${b.sub} · ${total} items${tail}`;
}

/** The per-row total the grid shows — prototype 1517. */
export function rowTotal(row: MscDensityRow): number {
  return row.cells.reduce((a, c) => a + c[0] + c[1] + c[2] + c[3], 0);
}
