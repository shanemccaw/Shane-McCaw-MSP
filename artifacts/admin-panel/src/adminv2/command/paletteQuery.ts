/**
 * Query parsing and result assembly for the command palette.
 *
 * Separate from `cmdScore` so the ranking algorithm can be tested without a
 * query language and the query language without a ranking algorithm.
 */

import { COMMAND_PREFIX, type CommandItem, type CommandKind, type CommandType } from "../registry/types";
import { cmdScore, type ScoreContext } from "./cmdScore";

export interface ParsedQuery {
  /** Set when the query opened with a prefix. */
  type: CommandType | null;
  /** The query with any prefix stripped. */
  text: string;
}

/**
 * Splits a raw input into a type filter and the text to match on.
 *
 * A bare prefix is meaningful: `@` on its own means "show me every destination",
 * which is how you browse without knowing any names.
 */
export function parseQuery(raw: string): ParsedQuery {
  const trimmed = raw.trimStart();
  const prefix = trimmed[0] ?? "";
  const type = COMMAND_PREFIX[prefix];
  if (type) {
    return { type, text: trimmed.slice(1).trim() };
  }
  return { type: null, text: trimmed.trim() };
}

/** How many rows the palette will render. Beyond this nobody is reading. */
export const RESULT_LIMIT = 40;

/** Band labels, from the design. */
export const GROUP = {
  recent: "Pick up where you were",
  destination: "Go to",
  answer: "Answers",
  action: "Do",
} as const;

/** Badge kind for an item that did not declare one. */
export function defaultKind(item: CommandItem): CommandKind {
  if (item.kind) return item.kind;
  switch (item.type) {
    case "destination":
      return "go";
    case "action":
      return "run";
    case "answer":
      return "answer";
    case "record":
      return "tenant";
  }
}

/** Band an item sorts under when it did not declare one. */
export function defaultGroup(item: CommandItem): string {
  if (item.group) return item.group;
  switch (item.type) {
    case "destination":
      return GROUP.destination;
    case "answer":
      return GROUP.answer;
    case "action":
      return GROUP.action;
    case "record":
      return "Records";
  }
}

export interface PaletteContext extends ScoreContext {
  /** Most-recent-first command ids, used for both the boost and the empty state. */
  recentIds?: readonly string[];
}

/** Stamps every row with the band it renders under. */
function grouped(items: readonly CommandItem[], override?: string): CommandItem[] {
  return items.map((item) => ({ ...item, group: override ?? defaultGroup(item) }));
}

/**
 * The empty state: recents first, then destinations, then answers, then actions.
 *
 * Deliberately not a ranking — with no query there is nothing to rank against,
 * and showing the same bands in the same order every time is what lets the list
 * be used from muscle memory.
 *
 * Note the answers band sits between destinations and actions. handoff.md's
 * prose says "recents, then all destinations, then actions"; the prototype's
 * own code puts answers in the middle, and the code is the more specific
 * source. It also reads better: the numbers you check are not verbs.
 */
export function emptyStateResults(items: readonly CommandItem[], ctx: PaletteContext): CommandItem[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const out: CommandItem[] = [];

  const take = (item: CommandItem | undefined, group: string) => {
    if (!item || seen.has(item.id)) return;
    seen.add(item.id);
    out.push({ ...item, group });
  };

  for (const id of ctx.recentIds ?? []) take(byId.get(id), GROUP.recent);
  for (const item of items) if (item.type === "destination") take(item, defaultGroup(item));
  for (const item of items) if (item.type === "answer") take(item, defaultGroup(item));
  for (const item of items) if (item.type === "action") take(item, defaultGroup(item));

  return out.slice(0, RESULT_LIMIT);
}

/**
 * Ranks a non-empty query.
 *
 * Ties break on name so the order is stable between keystrokes — a list that
 * reshuffles under an unchanged query is unusable at speed.
 */
export function rankResults(
  items: readonly CommandItem[],
  text: string,
  ctx: PaletteContext,
): CommandItem[] {
  const scored: Array<{ item: CommandItem; score: number }> = [];
  for (const item of items) {
    const score = cmdScore(item, text, ctx);
    if (score > 0) scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));
  return scored.slice(0, RESULT_LIMIT).map((s) => s.item);
}

/** The counter in the palette header. */
export function paletteCount(
  parsed: ParsedQuery,
  poolSize: number,
  hitCount: number,
  totalSize: number,
): string {
  if (parsed.text) return `${hitCount} of ${totalSize}`;
  switch (parsed.type) {
    case "action":
      return `${poolSize} things you can do`;
    case "answer":
      return `${poolSize} live numbers`;
    case "destination":
      return `${poolSize} places to go`;
    case "record":
      return `${poolSize} records`;
    default:
      return `${poolSize} things`;
  }
}

/** The full palette pipeline: parse, filter by type, then rank or fall back to the empty state. */
export function runPaletteQuery(
  items: readonly CommandItem[],
  raw: string,
  ctx: PaletteContext,
): { parsed: ParsedQuery; results: CommandItem[]; count: string } {
  const parsed = parseQuery(raw);
  const pool = parsed.type ? items.filter((item) => item.type === parsed.type) : items;

  let results: CommandItem[];
  let hitCount = 0;

  if (parsed.text) {
    // Count every match, not just the rendered page: rankResults truncates to
    // RESULT_LIMIT, so using its length saturates the numerator at 40 and the
    // counter stops moving as you narrow the query.
    hitCount = countMatches(pool, parsed.text, ctx);
    results = grouped(rankResults(pool, parsed.text, ctx));
  } else if (parsed.type) {
    // A bare prefix browses the whole category, recents first.
    results = grouped(browseCategory(pool, ctx));
  } else {
    results = emptyStateResults(pool, ctx);
  }

  // Denominator is the prefix-filtered pool, not the whole index: under `@` the
  // design reads "3 of 20 destinations", never "3 of 143 things".
  return { parsed, results, count: paletteCount(parsed, pool.length, hitCount, pool.length) };
}

/** How many commands match at all, before the render cap. */
export function countMatches(
  items: readonly CommandItem[],
  text: string,
  ctx: PaletteContext,
): number {
  let n = 0;
  for (const item of items) if (cmdScore(item, text, ctx) > 0) n++;
  return n;
}

function browseCategory(pool: readonly CommandItem[], ctx: PaletteContext): CommandItem[] {
  const byId = new Map(pool.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const out: CommandItem[] = [];

  for (const id of ctx.recentIds ?? []) {
    const item = byId.get(id);
    if (item && !seen.has(item.id)) {
      seen.add(item.id);
      out.push(item);
    }
  }
  for (const item of pool) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      out.push(item);
    }
  }
  return out.slice(0, RESULT_LIMIT);
}
