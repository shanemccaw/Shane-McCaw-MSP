/**
 * `cmdScore` — the command palette's matcher.
 *
 * Layered, best first: exact name, prefix, word-start, substring, acronym,
 * then subsequence with a gap penalty.
 *
 * The acronym tier is load-bearing and must not be dropped as redundant: it is
 * what lets `gar` find "Guest Access Review" when you cannot remember what the
 * thing is actually called. The whole palette exists so navigation does not
 * require memory (handoff.md, principle 1); a matcher that only rewards
 * remembering the name defeats it.
 */

/** Tier floors. Separated widely enough that a boost reorders within a tier, not across two. */
export const TIER = {
  exact: 1000,
  prefix: 800,
  wordStart: 640,
  substring: 480,
  acronym: 360,
  subsequence: 200,
} as const;

/** Boosts, per handoff.md section 2. */
export const BOOST = {
  /** The result belongs to the area you are currently in. */
  area: 60,
  /** Verbs rank above nouns at equal match quality. */
  action: 25,
  /** Most recent selection. Decays geometrically down the recents list. */
  recencyMax: 90,
  recencyDecay: 0.72,
} as const;

/**
 * Acronyms below this length match too much to be useful.
 *
 * In practice a one-character query can never reach the acronym tier anyway —
 * an acronym's first letter is the name's first letter, so `prefix` catches it
 * first. The guard stays as an explicit statement of intent.
 */
const MIN_ACRONYM_QUERY = 2;

/** Worst case a subsequence match can be penalised, so it still beats no match. */
const MAX_SUBSEQUENCE_PENALTY = TIER.subsequence - 40;

const WORD_SPLIT = /[^a-z0-9]+/;

function normalise(value: string): string {
  return value.toLowerCase().trim();
}

function words(value: string): string[] {
  return normalise(value).split(WORD_SPLIT).filter(Boolean);
}

/** First letter of each word: "Guest Access Review" -> "gar". */
export function acronymOf(name: string): string {
  return words(name)
    .map((w) => w[0])
    .join("");
}

/**
 * Subsequence match with a gap penalty.
 *
 * Returns the penalty (0 = every query char was adjacent), or `null` when the
 * query is not a subsequence at all. Leading offset counts too, so `xyz`
 * matching late in a long string ranks below the same match near the front.
 */
function subsequencePenalty(name: string, query: string): number | null {
  let nameIndex = 0;
  let gaps = 0;
  let previous = -1;

  for (const char of query) {
    const found = name.indexOf(char, nameIndex);
    if (found === -1) return null;
    gaps += previous === -1 ? found : found - previous - 1;
    previous = found;
    nameIndex = found + 1;
  }
  return gaps;
}

export interface ScoreContext {
  /** The area the user is currently in, for the +60 boost. */
  currentArea?: string;
  /** Most-recent-first list of command ids, for the decaying recency boost. */
  recentIds?: readonly string[];
}

export interface ScorableCommand {
  id: string;
  name: string;
  type: string;
  area?: string;
}

/**
 * Scores one command against a query. `0` means no match at all.
 *
 * An empty query scores every command 0 — the empty state is a curated list
 * (recents, then destinations, then actions), not a ranking.
 */
export function cmdScore(command: ScorableCommand, rawQuery: string, ctx: ScoreContext = {}): number {
  const query = normalise(rawQuery);
  if (!query) return 0;

  const name = normalise(command.name);
  let base = 0;

  if (name === query) {
    base = TIER.exact;
  } else if (name.startsWith(query)) {
    base = TIER.prefix;
  } else if (words(command.name).some((w) => w.startsWith(query))) {
    base = TIER.wordStart;
  } else if (name.includes(query)) {
    base = TIER.substring;
  } else if (query.length >= MIN_ACRONYM_QUERY && acronymOf(command.name).startsWith(query)) {
    base = TIER.acronym;
  } else {
    const penalty = subsequencePenalty(name, query);
    if (penalty === null) return 0;
    base = TIER.subsequence - Math.min(penalty, MAX_SUBSEQUENCE_PENALTY);
  }

  let score = base;

  if (ctx.currentArea && command.area && command.area === ctx.currentArea) {
    score += BOOST.area;
  }
  if (command.type === "action") {
    score += BOOST.action;
  }

  const recentIndex = ctx.recentIds?.indexOf(command.id) ?? -1;
  if (recentIndex >= 0) {
    score += BOOST.recencyMax * Math.pow(BOOST.recencyDecay, recentIndex);
  }

  return score;
}
