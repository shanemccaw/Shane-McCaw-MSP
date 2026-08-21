/**
 * paletteIndex.ts — the command palette's client-side index and its ranking.
 *
 * README §"The command palette (⌘K)": indexed are every page and pillar, all
 * documents, finding areas, remediation playbooks, findings, hold windows and
 * change requests by code; the footer states the indexed count; ranking is
 * exact label match → label prefix → label contains → sub/kind contains; results
 * are capped at 14; and the last row is always `Ask ShaneBot`. The README is
 * also explicit that the index is "Built client-side from in-memory arrays. At
 * real scale this is a server-side search endpoint; keep the ranking rules and
 * the ShaneBot fall-through." So THIS module is the ranking rules and the
 * fixture index; the shared `command-palette.tsx` already carries the real
 * `/api/portal/customer/search` backend the README flags as out of scope.
 *
 * ── Every row goes somewhere real ──────────────────────────────────────────
 * The prototype's index rows `setState` the `active` key; here each carries a
 * real `/portal-v2` route (or opens the KB overlay). Kinds whose destination is
 * a not-yet-built page or an in-page panel this part cannot reach are left out
 * rather than shipping a palette result that dead-ends: the Copilot page (Part
 * 9), the fix panel (mounted on pillar pages), the settings sub-pages (Part 12)
 * and the SOP categories (Part 6) join the index with their parts. What is
 * indexed today — pages, pillars, the written library catalogue, hold windows,
 * change requests and every knowledge-base article — exercises every ranking
 * rule, the 14 cap, the coloured type labels and the footer count for real.
 *
 * The ranking (`rankPalette`) and the cap (`PALETTE_CAP`) are unit-tested in
 * `paletteIndex.test.ts` against the prototype's exact algorithm (shell
 * 19126-19132).
 */

// Relative imports (not the `@/` alias) so `npm test` — Node's runner via
// `tsx --test` — resolves them; tsx does not read the tsconfig path alias, which
// is why every tested module in this tree imports relatively.
import { PILLAR_ORDER } from "../../copilot-journey/journeyTokens";
import { DOC_CATALOG, DOC_PILLAR_COLOUR } from "../docLibraryData";

import { KB_ARTICLES } from "./kbData";
import { HOLD_NOW, deriveHoldPaletteRows } from "./holdAlerts";
import { CR_PIPELINE } from "./shellData";

/** Where opening a palette result takes you. */
export type PaletteTarget =
  | { readonly type: "route"; readonly href: string }
  | { readonly type: "kb"; readonly articleId: string };

export interface PaletteEntry {
  /** The coloured type label, e.g. "Page", "Pillar", "Hold window". */
  readonly kind: string;
  readonly label: string;
  readonly sub: string;
  /** Hex colour for the type label and the selected row's left bar. */
  readonly tone: string;
  readonly target: PaletteTarget;
}

/** Results are capped at 14 — shell 19132 (`.slice(0, 14)`). */
export const PALETTE_CAP = 14;

const route = (href: string): PaletteTarget => ({ type: "route", href });

/** Pages — subs are the design's nav-title tails (shell 19112-19115). */
const PAGE_ROWS: readonly PaletteEntry[] = [
  { kind: "Page", label: "Overview", sub: "Tenant health across all six pillars", tone: "#60a5fa", target: route("/portal-v2") },
  { kind: "Page", label: "Change Control", sub: "every tenant change with a request, an approval and a rollback point", tone: "#60a5fa", target: route("/portal-v2/change-control") },
  { kind: "Page", label: "Active Runbooks", sub: "procedures in progress, including hold windows", tone: "#60a5fa", target: route("/portal-v2/runbooks") },
  { kind: "Page", label: "Documents", sub: "your deliverables, and the 84-document library", tone: "#60a5fa", target: route("/portal-v2/documents") },
  { kind: "Page", label: "Risk Register", sub: "accepted risks, with the owner and the review date", tone: "#60a5fa", target: route("/portal-v2/risk-register") },
  { kind: "Page", label: "Microsoft Changes", sub: "message centre posts, read against your tenant", tone: "#60a5fa", target: route("/portal-v2/ms-changes") },
  { kind: "Page", label: "Ownership", sub: "four names against every service, change, control and freeze", tone: "#60a5fa", target: route("/portal-v2/ownership") },
  { kind: "Settings", label: "Settings", sub: "", tone: "#94a3b8", target: route("/portal-v2/settings") },
];

/** The six pillars — shell 19113 (`swatch(p)` tone; the accent reads best). */
const PILLAR_ROWS: readonly PaletteEntry[] = PILLAR_ORDER.map((p) => ({
  kind: "Pillar",
  label: p.label,
  sub: "Pillar overview, findings and fixes",
  tone: p.accent,
  target: route(`/portal-v2/${p.key}`),
}));

/** The written library catalogue — shell 19119 (unowned rows). */
const DOC_ROWS: readonly PaletteEntry[] = DOC_CATALOG.map((d) => ({
  kind: "Library document",
  label: d.title,
  sub: `${d.num} · ${d.type} · ${d.pillar} · not in your library`,
  tone: DOC_PILLAR_COLOUR[d.pillar] ?? "#60a5fa",
  target: route("/portal-v2/documents"),
}));

/** Hold windows — shell 19124. Every window, including the ones still running. */
const HOLD_ROWS: readonly PaletteEntry[] = deriveHoldPaletteRows(HOLD_NOW).map((h) => ({
  kind: "Hold window",
  label: h.title,
  sub: h.sub,
  tone: h.tone,
  target: route("/portal-v2/runbooks"),
}));

/** Change requests by code — shell 19125. */
const CR_ROWS: readonly PaletteEntry[] = CR_PIPELINE.map((c) => ({
  kind: "Change request",
  label: `${c.code} · ${c.title}`,
  sub: c.status,
  tone: "#93c5fd",
  target: route("/portal-v2/change-control"),
}));

/** Knowledge-base articles — shell 19121. Opening one opens the KB overlay. */
const KB_ROWS: readonly PaletteEntry[] = KB_ARTICLES.map((a) => ({
  kind: "Knowledge base",
  label: a.title,
  sub: a.summary,
  tone: "#93c5fd",
  target: { type: "kb", articleId: a.id },
}));

/** The whole index, in the prototype's push order. */
export const PALETTE_INDEX: readonly PaletteEntry[] = [
  ...PAGE_ROWS,
  ...PILLAR_ROWS,
  ...DOC_ROWS,
  ...HOLD_ROWS,
  ...CR_ROWS,
  ...KB_ROWS,
];

/**
 * Rank the index for a query — shell 19126-19132, exactly.
 *
 *   hay   = (label + ' ' + sub + ' ' + kind), lower-cased
 *   keep  only rows where hay contains the query
 *   score 0 exact label · 1 label prefix · 2 label contains · 3 sub/kind only
 *   sort  by score, then by first match position in the hay
 *   cap   at 14
 */
export function rankPalette(
  index: readonly PaletteEntry[],
  query: string,
): PaletteEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: Array<{ entry: PaletteEntry; score: number; at: number }> = [];
  for (const entry of index) {
    const lab = entry.label.toLowerCase();
    const hay = `${entry.label} ${entry.sub} ${entry.kind}`.toLowerCase();
    const at = hay.indexOf(q);
    if (at < 0) continue;
    const score = lab === q ? 0 : lab.indexOf(q) === 0 ? 1 : lab.indexOf(q) > 0 ? 2 : 3;
    scored.push({ entry, score, at });
  }
  scored.sort((a, b) => a.score - b.score || a.at - b.at);
  return scored.slice(0, PALETTE_CAP).map((s) => s.entry);
}

/**
 * The no-query view — "needs a decision, and where you were" (shell
 * 19133-19140). A fixed six-row list, each row skipped if it is not in the
 * index (so it never renders a hole).
 */
export function paletteDefault(index: readonly PaletteEntry[]): PaletteEntry[] {
  const find = (pred: (r: PaletteEntry) => boolean) => index.find(pred);
  return [
    find((r) => r.kind === "Hold window" && r.sub.indexOf("T-0") === 0),
    find((r) => r.label === "Change Control"),
    find((r) => r.label === "Documents"),
    find((r) => r.label === "Active Runbooks"),
    find((r) => r.kind === "Pillar" && r.label === "Security"),
    find((r) => r.label === "Risk Register"),
  ].filter((r): r is PaletteEntry => Boolean(r));
}

/** Footer scope note — shell 19229. */
export function paletteScopeNote(index: readonly PaletteEntry[]): string {
  return `${index.length} pages, documents, findings, fixes and change requests indexed`;
}

/** The uppercase hint above the rows — shell 19221. */
export function paletteHint(query: string, count: number): string {
  if (!query.trim()) return "Needs a decision, and where you were";
  return count ? `${count} match${count === 1 ? "" : "es"}` : "No match in the portal";
}

/** The always-last Ask ShaneBot row label — shell 19223. */
export function paletteAskLabel(query: string): string {
  const q = query.trim();
  return q ? `Ask ShaneBot: ${q}` : "Ask ShaneBot anything about your tenant";
}

/** The query ShaneBot is asked when the ask row fires with no text — shell 19143. */
export const PALETTE_ASK_FALLBACK =
  "I could not find what I was looking for in the portal — help me find it";
