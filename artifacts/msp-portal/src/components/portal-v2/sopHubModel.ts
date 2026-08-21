/**
 * sopHubModel.ts — the SOPs & Runbooks hub's pure derivations.
 *
 * Everything the page draws that is COMPUTED rather than fixed lives here, so it
 * can be unit-tested without a DOM: the library filter (proto `sopFiltered`,
 * 16648), the stat cards (proto `sopStatCards`, 16842), the grouped index (proto
 * `sopIndexGroups`, 16691), the category chips (proto `sopCatChips`, 16695), the
 * selected-SOP detail (proto `sopDetail`, 16709), the execution step scope (proto
 * `sopExecSteps`, 16934) and the hold banner text (proto `holdBanner*`, 20721).
 *
 * ── Every derivation now takes its data as an argument ─────────────────────
 * These used to read `SOP_LIBRARY` / `SOP_META` at module scope, which made the
 * counts module-level constants — `sopTotalCount` was literally
 * `SOP_LIBRARY.length` evaluated at import time. That is exactly what a fixture
 * lets you get away with and real data does not: the library arrives after a
 * request, differs per tenant, and can be empty.
 *
 * So every function here takes a `SopsPayload` (from `useSops`). The BEHAVIOUR of
 * each derivation is unchanged — same precedence, same labels, same prototype
 * quirks honoured — and the unit tests still pin it, now against their own small
 * fixtures rather than against the tenant data that used to ship in the bundle.
 *
 * Three of them gained a genuinely new case, because real data has states a
 * fixture never did: an EMPTY library (`resolveSelectedId` and `detailFor` return
 * null rather than indexing `[0]` of nothing), a zero total (`statCards` no
 * longer divides by zero into "NaN%"), and no open hold windows (`holdBanner`
 * returns null instead of announcing "0 running").
 *
 * Nothing here reaches a data source; `useSops.ts` is the only thing that does.
 */

import {
  sopMetaFor,
  SOP_SOURCE_META,
  type SopHoldCounts,
  type SopLibraryItem,
  type SopMeta,
  type SopOwner,
  type SopsPayload,
} from "./sopHubData";

/* ── Counts — proto 16705/16706/16840/16841 ─────────────────────────────── */
//
// Counted server-side over the tenant's real rows and carried on `stats`, so the
// page and the API cannot disagree about how many procedures there are. Read
// through these accessors rather than off `stats` directly, so a caller that
// wants a count does not have to know which of the two shapes holds it.

export const sopTotalCount = (data: SopsPayload): number => data.stats.totalCount;
export const sopBaselineCount = (data: SopsPayload): number => data.stats.baselineCount;
export const sopOursCount = (data: SopsPayload): number => data.stats.oursCount;
export const sopAutomatedCount = (data: SopsPayload): number => data.stats.automatedCount;
export const sopTotalExecs = (data: SopsPayload): number => data.stats.totalExecs;

/* ── Filter — proto sopFiltered (16648) ─────────────────────────────────── */

export interface SopFilterState {
  source: string;
  cat: string;
  type: string;
  tag: string;
  query: string;
}

export function filterSops(data: SopsPayload, state: SopFilterState): SopLibraryItem[] {
  const q = state.query.trim().toLowerCase();
  return data.library.filter((s) => {
    const m: SopMeta = sopMetaFor(data.meta, s.id);
    return (
      (state.source === "all" || s.source === state.source) &&
      (state.cat === "All" || s.category === state.cat) &&
      (state.type === "all" || m.level === state.type) &&
      (state.tag === "All tags" || m.tags.indexOf(state.tag) !== -1) &&
      (!q || (s.title + " " + s.purpose + " " + s.category + " " + m.code).toLowerCase().includes(q))
    );
  });
}

/**
 * The id that is actually selected — the requested one if it survived the
 * filter, else the first result, else the first in the library. proto 16656.
 *
 * Returns null for an empty library, which the fixture version could never do:
 * it indexed `SOP_LIBRARY[0]` unconditionally, and a tenant with no procedures
 * would have thrown on the first render.
 */
export function resolveSelectedId(
  data: SopsPayload,
  filtered: SopLibraryItem[],
  requested: string | null,
): string | null {
  if (requested && filtered.some((s) => s.id === requested)) return requested;
  return (filtered[0] ?? data.library[0])?.id ?? null;
}

/* ── Categories in first-seen order — proto sopCatsAll (16689) ──────────── */

export function catList(data: SopsPayload): string[] {
  const out: string[] = [];
  for (const s of data.library) if (out.indexOf(s.category) < 0) out.push(s.category);
  return out;
}

/* ── Grouped index — proto sopIndexGroups (16691) ───────────────────────── */

export interface SopIndexRow {
  id: string;
  title: string;
  category: string;
  code: string;
  sourceLabel: "Baseline" | "Yours";
  sourceColor: string;
  runnable: boolean;
  owner: SopOwner;
}

export interface SopIndexGroup {
  label: string;
  n: string;
  items: SopIndexRow[];
}

function indexRow(data: SopsPayload, s: SopLibraryItem): SopIndexRow {
  return {
    id: s.id,
    title: s.title,
    category: s.category,
    code: sopMetaFor(data.meta, s.id).code,
    sourceLabel: s.source === "baseline" ? "Baseline" : "Yours",
    sourceColor: SOP_SOURCE_META[s.source].c,
    runnable: s.runnable,
    // The real person the row names, resolved server-side. The fixture version
    // mapped the category string onto one of nine invented people.
    owner: s.owner,
  };
}

export function indexGroups(data: SopsPayload, filtered: SopLibraryItem[]): SopIndexGroup[] {
  const rows = filtered.map((s) => indexRow(data, s));
  return catList(data)
    .map((cat) => {
      const items = rows.filter((r) => r.category === cat);
      return { label: cat, n: String(items.length), items };
    })
    .filter((g) => g.items.length > 0);
}

/* ── Category chips — proto sopCatChips (16695) ─────────────────────────── */

export interface SopCatChip {
  key: string;
  label: string;
  n: string;
  on: boolean;
}

export function catChips(data: SopsPayload, catSel: string): SopCatChip[] {
  const cats = catList(data);
  // The "Everything" reset key is "All", the same value the Category <select>
  // and `filterSops` use. The prototype's own chip (16695) sets "all" (lower
  // case) here while `sopFiltered` (16651) tests `=== 'All'`, so its Everything
  // chip empties the list — a latent typo. Reproducing the intent, not the bug.
  const defs = [{ k: "All", label: "Everything" }].concat(cats.map((c) => ({ k: c, label: c })));
  return defs.map((c) => ({
    key: c.k,
    label: c.label,
    n: String(
      c.k === "All" ? data.library.length : data.library.filter((x) => x.category === c.k).length,
    ),
    on: (catSel || "All") === c.k,
  }));
}

/* ── Stat cards — proto sopStatCards (16842) ────────────────────────────── */

export interface SopStatCard {
  label: string;
  value: string;
  sub: string;
  c: string;
}

export function statCards(data: SopsPayload): SopStatCard[] {
  const total = sopTotalCount(data);
  const automated = sopAutomatedCount(data);
  // Zero-safe: an empty library used to divide by zero and render "NaN%".
  const ratio = total > 0 ? Math.round((automated / total) * 100) : 0;
  return [
    {
      label: "Published SOPs & runbooks",
      value: String(total),
      sub: `${sopBaselineCount(data)} baseline · ${sopOursCount(data)} yours`,
      c: "#60a5fa",
    },
    {
      label: "Automated execution ratio",
      value: `${ratio}%`,
      sub: `${automated} of ${total} can run through Graph`,
      c: "#34d399",
    },
    {
      label: "Average execution time",
      value: data.stats.avgExecTime,
      sub: "Across automated runs, last 90 days",
      c: "#22d3ee",
    },
    {
      label: "Executions this month",
      value: data.stats.execsThisMonth,
      // The design's own sub-line ended "· 2 in flight now", a second fixed
      // number from the same snapshot. The lifetime figure is real and counted;
      // the in-flight one is the queue's length and is drawn on the queue view
      // itself, so it is not asserted twice here from a different source.
      sub: `${sopTotalExecs(data)} lifetime`,
      c: "#a78bfa",
    },
  ];
}

/* ── One procedure step — proto sopDetail.steps (16731) ─────────────────── */

export interface SopStep {
  n: string;
  text: string;
  endpoint: string;
  hasEndpoint: boolean;
  kindLabel: "Graph" | "Manual";
  isGraph: boolean;
}

function stepsFor(sop: SopLibraryItem, meta: SopMeta): SopStep[] {
  return sop.steps.map((text, i) => {
    const ep = meta.auto[i];
    return {
      n: String(i + 1).padStart(2, "0"),
      text,
      endpoint: ep || "",
      hasEndpoint: !!ep,
      kindLabel: ep ? "Graph" : "Manual",
      isGraph: !!ep,
    };
  });
}

/* ── Run-history row tone — proto 16748 ─────────────────────────────────── */

export function runStateTone(state: string): string {
  if (state === "Complete") return "#34d399";
  if (state === "Dry run") return "#94a3b8";
  return "#c2a63d";
}

/* ── The selected-SOP detail — proto sopDetail (16709) ──────────────────── */

export interface SopDetailRun {
  when: string;
  who: string;
  outcome: string;
  state: string;
  tone: string;
}

export interface SopDetail {
  id: string;
  title: string;
  purpose: string;
  forWho: string;
  updated: string;
  author: string;
  reviewCadence: string;
  category: string;
  sourceLabel: string;
  sourceNote: string;
  sourceColor: string;
  code: string;
  level: string;
  avg: string;
  execs: string;
  stepCount: string;
  tags: string[];
  hasTags: boolean;
  hasAutoSteps: boolean;
  steps: SopStep[];
  isRunnable: boolean;
  isReference: boolean;
  isOurs: boolean;
  finding: string;
  hasFinding: boolean;
  runs: SopDetailRun[];
  hasRuns: boolean;
  neverRun: boolean;
}

/** Null when the id names nothing — an empty library has no detail to draw. */
export function detailFor(data: SopsPayload, id: string | null): SopDetail | null {
  const sop = data.library.find((s) => s.id === id) ?? data.library[0];
  if (!sop) return null;
  const meta = sopMetaFor(data.meta, sop.id);
  const sm = SOP_SOURCE_META[sop.source];
  return {
    id: sop.id,
    title: sop.title,
    purpose: sop.purpose,
    forWho: sop.forWho,
    updated: sop.updated,
    author: sop.author,
    reviewCadence: sop.reviewCadence,
    category: sop.category,
    sourceLabel: sm.label,
    sourceNote: sm.note,
    sourceColor: sm.c,
    code: meta.code,
    level: meta.level,
    avg: meta.avg,
    execs: `${meta.execs} executions on record`,
    stepCount: `${sop.steps.length} steps`,
    tags: [...meta.tags],
    hasTags: meta.tags.length > 0,
    hasAutoSteps: Object.keys(meta.auto).length > 0,
    steps: stepsFor(sop, meta),
    isRunnable: sop.runnable,
    isReference: !sop.runnable,
    isOurs: sop.source === "ours",
    finding: sop.finding || "",
    hasFinding: !!sop.finding,
    runs: sop.runs.map((r) => ({
      when: r.when,
      who: r.who,
      outcome: r.outcome,
      state: r.state,
      tone: runStateTone(r.state),
    })),
    hasRuns: sop.runs.length > 0,
    neverRun: sop.runnable && sop.runs.length === 0,
  };
}

/* ── Execution scope — proto sopExecSteps (16934) ───────────────────────── */

export type SopExecMode = "all" | "auto";

export function execStepsFor(data: SopsPayload, id: string | null, mode: SopExecMode): SopStep[] {
  const sop = data.library.find((s) => s.id === id);
  if (!sop) return [];
  const meta = sopMetaFor(data.meta, sop.id);
  const all = stepsFor(sop, meta);
  return mode === "auto" ? all.filter((s) => s.isGraph) : all;
}

/* ── Hold banner — proto holdBanner* (20721-20725) ──────────────────────── */

export interface SopHoldBanner {
  tag: string;
  text: string;
  due: boolean;
}

/**
 * Null when there are no open windows, so the banner is absent rather than
 * announcing "0 running". The fixture was a fixed four-window snapshot and could
 * never be absent; the real counts can, and for most tenants are.
 */
export function holdBanner(counts: SopHoldCounts | null): SopHoldBanner | null {
  if (!counts || counts.total <= 0) return null;
  const { total, due, closing, early } = counts;
  const parts = [`${total} running`];
  if (due) parts.push(`${due} decision due`);
  if (closing) parts.push(`${closing} closing within 24h`);
  if (early) parts.push(`${early} clear to close early`);
  const tag = due ? `${due} decision due` : early ? "Can close early" : `${total} holding`;
  const detail = parts.slice(1).join(", ");
  return {
    tag,
    text:
      `${total} procedures are in a hold window — a step that waits on elapsed time rather than ` +
      `on work.${detail ? ` ${detail}.` : ""}`,
    due: due > 0,
  };
}
