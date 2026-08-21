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
 * Fixtures come from `sopHubData.ts`; nothing here reaches a data source.
 */

import {
  SOP_AVG_EXEC_TIME,
  SOP_EXECS_THIS_MONTH,
  SOP_HOLD_BANNER,
  SOP_LIBRARY,
  SOP_META,
  SOP_SOURCE_META,
  sopMetaFor,
  sopOwner,
  type SopLibraryItem,
  type SopMeta,
  type SopOwner,
} from "./sopHubData";

/* ── Counts — proto 16705/16706/16840/16841 ─────────────────────────────── */

export const sopTotalCount = SOP_LIBRARY.length;
export const sopBaselineCount = SOP_LIBRARY.filter((s) => s.source === "baseline").length;
export const sopOursCount = SOP_LIBRARY.filter((s) => s.source === "ours").length;
export const sopAutomatedCount = Object.values(SOP_META).filter(
  (m) => m.level === "Fully automated" || m.level === "Partially automated",
).length;
export const sopTotalExecs = Object.values(SOP_META).reduce((a, m) => a + m.execs, 0);

/* ── Filter — proto sopFiltered (16648) ─────────────────────────────────── */

export interface SopFilterState {
  source: string;
  cat: string;
  type: string;
  tag: string;
  query: string;
}

export function filterSops(state: SopFilterState): SopLibraryItem[] {
  const q = state.query.trim().toLowerCase();
  return SOP_LIBRARY.filter((s) => {
    const m: SopMeta = sopMetaFor(s.id);
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
 */
export function resolveSelectedId(filtered: SopLibraryItem[], requested: string | null): string {
  if (requested && filtered.some((s) => s.id === requested)) return requested;
  return (filtered[0] ?? SOP_LIBRARY[0]).id;
}

/* ── Categories in first-seen order — proto sopCatsAll (16689) ──────────── */

export function catList(): string[] {
  const out: string[] = [];
  for (const s of SOP_LIBRARY) if (out.indexOf(s.category) < 0) out.push(s.category);
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

function indexRow(s: SopLibraryItem): SopIndexRow {
  return {
    id: s.id,
    title: s.title,
    category: s.category,
    code: sopMetaFor(s.id).code,
    sourceLabel: s.source === "baseline" ? "Baseline" : "Yours",
    sourceColor: SOP_SOURCE_META[s.source].c,
    runnable: s.runnable,
    owner: sopOwner((s.category || "") + " " + (s.title || "")),
  };
}

export function indexGroups(filtered: SopLibraryItem[]): SopIndexGroup[] {
  const rows = filtered.map(indexRow);
  return catList()
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

export function catChips(catSel: string): SopCatChip[] {
  const cats = catList();
  // The "Everything" reset key is "All", the same value the Category <select>
  // and `filterSops` use. The prototype's own chip (16695) sets "all" (lower
  // case) here while `sopFiltered` (16651) tests `=== 'All'`, so its Everything
  // chip empties the list — a latent typo. Reproducing the intent, not the bug.
  const defs = [{ k: "All", label: "Everything" }].concat(cats.map((c) => ({ k: c, label: c })));
  return defs.map((c) => ({
    key: c.k,
    label: c.label,
    n: String(
      c.k === "All" ? SOP_LIBRARY.length : SOP_LIBRARY.filter((x) => x.category === c.k).length,
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

export function statCards(): SopStatCard[] {
  const ratio = Math.round((sopAutomatedCount / sopTotalCount) * 100);
  return [
    {
      label: "Published SOPs & runbooks",
      value: String(sopTotalCount),
      sub: `${sopBaselineCount} baseline · ${sopOursCount} yours`,
      c: "#60a5fa",
    },
    {
      label: "Automated execution ratio",
      value: `${ratio}%`,
      sub: `${sopAutomatedCount} of ${sopTotalCount} can run through Graph`,
      c: "#34d399",
    },
    {
      label: "Average execution time",
      value: SOP_AVG_EXEC_TIME,
      sub: "Across automated runs, last 90 days",
      c: "#22d3ee",
    },
    {
      label: "Executions this month",
      value: SOP_EXECS_THIS_MONTH,
      sub: `${sopTotalExecs} lifetime · 2 in flight now`,
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

export function detailFor(id: string): SopDetail {
  const sop = SOP_LIBRARY.find((s) => s.id === id) ?? SOP_LIBRARY[0];
  const meta = sopMetaFor(sop.id);
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

export function execStepsFor(id: string, mode: SopExecMode): SopStep[] {
  const sop = SOP_LIBRARY.find((s) => s.id === id);
  if (!sop) return [];
  const meta = sopMetaFor(sop.id);
  const all = stepsFor(sop, meta);
  return mode === "auto" ? all.filter((s) => s.isGraph) : all;
}

/* ── Hold banner — proto holdBanner* (20721-20725) ──────────────────────── */

export interface SopHoldBanner {
  tag: string;
  text: string;
  due: boolean;
}

export function holdBanner(): SopHoldBanner {
  const { total, due, closing, early } = SOP_HOLD_BANNER;
  const parts = [`${total} running`];
  if (due) parts.push(`${due} decision due`);
  if (closing) parts.push(`${closing} closing within 24h`);
  if (early) parts.push(`${early} clear to close early`);
  const tag = due
    ? `${due} decision due`
    : early
      ? "Can close early"
      : `${total} holding`;
  return {
    tag,
    text: `${total} procedures are in a hold window — a step that waits on elapsed time rather than on work. ${parts
      .slice(1)
      .join(", ")}.`,
    due: due > 0,
  };
}
