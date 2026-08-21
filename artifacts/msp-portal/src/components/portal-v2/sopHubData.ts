/**
 * sopHubData.ts — the SOPs & Runbooks hub's design constants, helpers and wire
 * types.
 *
 * Part 6 of PORTAL_V2_PARALLEL_PLAN.md built the hub (`/portal-v2/sops`) and its
 * three sub-views — library / execution queue / execution history — as a direct
 * port of the prototype's `isSopHub` block (`Customer Portal Shell.dc.html`
 * 1633-1978) and its logic class, against fixtures transcribed from that class.
 *
 * ── The fixtures are gone; this module is now design constants only ────────
 * That later wiring pass has happened. `SOP_LIBRARY`, `SOP_META`, `SOP_QUEUE`,
 * `SOP_AUDIT`, `SOP_CAT_OPTIONS`, `SOP_TAGS`, `SOP_AVG_EXEC_TIME`,
 * `SOP_EXECS_THIS_MONTH` and `SOP_HOLD_BANNER` were this tenant's numbers,
 * invented for the prototype, and they have been REMOVED rather than left in
 * place — a fixture nobody imports is still a fixture somebody can re-import by
 * mistake. Every one of them now arrives from `useSops()`
 * (`GET /api/portal/sops` + `GET /api/portal/sop-runs`, api-server
 * `routes/portal-sops.ts`), scoped to the caller's own tenant.
 *
 * What is left here is the part of the design that is NOT tenant data: the type
 * of each wire shape, the monospace stack, the css() parser, the two source-chip
 * treatments and the execution-type filter vocabulary. Those are the design
 * itself and do not vary by customer.
 *
 * The RACI people map went with the fixtures. Owner avatars used to resolve a
 * category string to one of nine invented people; they now carry the REAL person
 * the row names — a SOP's last editor, a run's operator — resolved server-side
 * (`lib/portal-sops.ts`) so the library and the queue cannot disagree about who
 * someone is.
 *
 * ── Why a css() string parser (as Change Control does) ─────────────────────
 * This design computes dozens of inline styles as CSS strings from tones and
 * state. Keeping the design's strings verbatim and parsing them once at render
 * time is the lower-defect choice at this scale than hand-converting each to a
 * camelCase object — the same call `ccPageData.ts` made. `css()` below is a
 * private copy so this module stays independent of Part 4's file.
 */

import type { CSSProperties } from "react";

/** The design's monospace stack (proto: 'SF Mono',Menlo,Consolas,monospace). */
export const MONO = "'SF Mono',Menlo,Consolas,monospace";

/**
 * Parse a design CSS string into a React style object. Splits declarations on
 * `;` and each on its FIRST `:` (values carry `:`-free content but do carry `/`,
 * commas and parentheses). Property names are kebab→camel; values stay strings,
 * which React accepts for every property.
 */
export function css(input: string): CSSProperties {
  const out: Record<string, string> = {};
  for (const decl of input.split(";")) {
    const i = decl.indexOf(":");
    if (i < 0) continue;
    const rawKey = decl.slice(0, i).trim();
    const value = decl.slice(i + 1).trim();
    if (!rawKey || !value) continue;
    const key = rawKey.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    out[key] = value;
  }
  return out as CSSProperties;
}

/* ── Types ──────────────────────────────────────────────────────────────── */
//
// These are the wire shapes `routes/portal-sops.ts` serves, field for field.
// They are declared here rather than in the hook because the model and the page
// both name them, and a wire shape that lives next to its own design constants
// is harder to drift from than one that lives next to the fetch.

export type SopSource = "baseline" | "ours";

/** The avatar for a real person — resolved server-side, never from a fixture. */
export interface SopOwner {
  init: string;
  name: string;
  tone: string;
  unassigned: boolean;
}

export interface SopRun {
  when: string;
  who: string;
  outcome: string;
  state: string;
}

export interface SopLibraryItem {
  id: string;
  title: string;
  source: SopSource;
  category: string;
  purpose: string;
  forWho: string;
  updated: string;
  author: string;
  reviewCadence: string;
  runnable: boolean;
  finding: string | null;
  steps: readonly string[];
  runs: readonly SopRun[];
  owner: SopOwner;
}

export interface SopMeta {
  code: string;
  level: string;
  tags: readonly string[];
  avg: string;
  execs: number;
  /** Step-index → Graph/PowerShell endpoint, for the automated steps. */
  auto: Readonly<Record<number, string>>;
}

export interface SopQueueStep {
  t: string;
  s: "done" | "now" | "todo";
  by: string;
}

export interface SopQueueItem {
  code: string;
  title: string;
  mode: string;
  step: string;
  pct: number;
  started: string;
  who: string;
  state: "Running" | "Queued";
  owner: SopOwner;
  cr: string;
  svc: string;
  steps: readonly SopQueueStep[];
}

export interface SopAuditItem {
  when: string;
  code: string;
  action: string;
  actor: string;
  detail: string;
  result: "Success" | "Partial" | "Failure";
  hash: string;
}

/** The hub's four stat-card inputs, all counted server-side over real rows. */
export interface SopStats {
  totalCount: number;
  baselineCount: number;
  oursCount: number;
  automatedCount: number;
  totalExecs: number;
  avgExecTime: string;
  execsThisMonth: string;
}

/** `GET /api/portal/sops`. */
export interface SopsPayload {
  library: readonly SopLibraryItem[];
  meta: Readonly<Record<string, SopMeta>>;
  /** "All" + the categories this tenant's library actually uses. */
  catOptions: readonly string[];
  /** "All tags" + the compliance tags this tenant's library actually carries. */
  tagOptions: readonly string[];
  stats: SopStats;
}

/** `GET /api/portal/sop-runs`. */
export interface SopRunsPayload {
  queue: readonly SopQueueItem[];
  audit: readonly SopAuditItem[];
}

/**
 * The hold-window counts behind the banner, read from the REAL hold source
 * (`GET /api/portal/runbooks`'s summary) that Active Runbooks already owns —
 * which is what the fixture this replaces said the wiring pass should do.
 */
export interface SopHoldCounts {
  total: number;
  due: number;
  closing: number;
  early: number;
}

/* ── The empty payload ──────────────────────────────────────────────────── */

/**
 * What the page derives from before the first response lands, and after a failed
 * one. Everything counts zero and every list is empty, so a load failure renders
 * the honest empty state rather than the last tenant's numbers.
 */
export const EMPTY_SOPS_PAYLOAD: SopsPayload = {
  library: [],
  meta: {},
  catOptions: ["All"],
  tagOptions: ["All tags"],
  stats: {
    totalCount: 0,
    baselineCount: 0,
    oursCount: 0,
    automatedCount: 0,
    totalExecs: 0,
    avgExecTime: "—",
    execsThisMonth: "0",
  },
};

export const EMPTY_SOP_RUNS_PAYLOAD: SopRunsPayload = { queue: [], audit: [] };

/**
 * proto sopMetaFor (16630) — a SOP whose meta is missing reads as reference-only
 * rather than throwing. Kept because the server can serve a library row whose
 * meta key was dropped, and a blank detail panel is a worse failure than this.
 */
export const SOP_FALLBACK_META: SopMeta = {
  code: "—",
  level: "Reference only",
  tags: [],
  avg: "—",
  execs: 0,
  auto: {},
};

export function sopMetaFor(meta: Readonly<Record<string, SopMeta>>, id: string): SopMeta {
  return meta[id] ?? SOP_FALLBACK_META;
}

/* ── Filter option lists — proto 16631-16644 ────────────────────────────── */
//
// Execution type and Source stay FIXED design vocabulary: they enumerate the
// four levels and two sources the design itself defines, not values a tenant
// happens to have. Category and Compliance tag do NOT — those are built from
// what the tenant's own library holds, and arrive on the payload, because the
// prototype's fixed lists named the prototype's own sample categories and would
// offer a customer filters that match nothing.

export const SOP_EXEC_TYPES: readonly { key: string; label: string }[] = [
  { key: "all", label: "All execution types" },
  { key: "Fully automated", label: "Fully automated" },
  { key: "Partially automated", label: "Partially automated" },
  { key: "Manual with verification", label: "Manual with verification" },
  { key: "Reference only", label: "Reference only" },
];

export const SOP_SOURCE_OPTIONS: readonly { key: string; label: string }[] = [
  { key: "all", label: "All procedures" },
  { key: "baseline", label: "Shane McCaw baseline" },
  { key: "ours", label: "Written by your team" },
];

/** proto sopSourceMeta (16657) — the source chip tone, label and note. */
export const SOP_SOURCE_META: Readonly<
  Record<SopSource, { c: string; label: string; note: string }>
> = {
  baseline: {
    c: "#60a5fa",
    label: "Shane McCaw baseline",
    note: "Maintained by us. Updated when Microsoft changes behaviour.",
  },
  ours: {
    c: "#22d3ee",
    label: "Written by your team",
    note: "Your internal policy. We read it, we do not edit it.",
  },
};

/** proto initialsOf (7643). */
export function initialsOf(name: string): string {
  return String(name || "")
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
