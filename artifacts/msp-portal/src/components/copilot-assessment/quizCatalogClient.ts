/**
 * quizCatalogClient.ts
 *
 * Client half of the DB-backed quiz catalog added in #271 (Copilot Assessment
 * epic, #183): talks to GET /api/portal/copilot-assessment/quiz-catalog, which
 * serves the persona clusters, personas, use cases and outcomes that used to be
 * hardcoded in quizCatalog.ts.
 *
 * Same plain-fetch-wrapper shape as quizProfileClient.ts — this module moves
 * catalog data and resolves which copy of it to use; QuizScreen still owns all
 * the rendering and answer state.
 *
 * ── Why the static catalogs are still imported here ──────────────────────────
 * They are the FALLBACK, not the source. Two real situations need one:
 *
 *   1. Shane runs the #271 SQL by hand. Between this code deploying and those
 *      files being run, every table is empty. Without a fallback the quiz would
 *      render zero tiles and no customer could complete an assessment — a much
 *      worse failure than serving the old content for a few hours.
 *   2. A failed or slow request. The quiz is mid-funnel for a paying customer;
 *      a catalog fetch hiccup must not end their assessment.
 *
 * The fallback is applied PER LEVEL and reported in `sources`, so "we are
 * showing the old hardcoded content" is always observable rather than silent —
 * useQuizCatalog logs it, and the debug panel could surface it later. #270's
 * workloadInference.ts also still reads the static catalogs directly for its
 * use-case categorisation; that is a real known limitation, documented at the
 * bottom of this file.
 */
import {
  ADAPTIVE_CLUSTERS,
  ADAPTIVE_PERSONAS,
  ADAPTIVE_USE_CASES,
  ADAPTIVE_OUTCOME_PRIORITIES,
  type QuizOptionTile,
} from './quizCatalog';

type FetchWithAuth = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const QUIZ_CATALOG_URL = '/api/portal/copilot-assessment/quiz-catalog';

/** Which copy of a level the wizard ended up rendering. */
export type QuizCatalogLevelSource = 'db' | 'db-default' | 'static';

export interface QuizCatalogLevels {
  clusters: QuizOptionTile[];
  personas: QuizOptionTile[];
  useCases: QuizOptionTile[];
  outcomes: QuizOptionTile[];
}

export interface QuizCatalogPayload extends QuizCatalogLevels {
  industry: string;
  sources: {
    clusters: 'industry' | 'default' | 'empty';
    personas: 'industry' | 'default' | 'empty';
    useCases: 'industry' | 'default' | 'empty';
    outcomes: 'industry' | 'default' | 'empty';
  };
}

export interface ResolvedQuizCatalog extends QuizCatalogLevels {
  sources: Record<keyof QuizCatalogLevels, QuizCatalogLevelSource>;
}

/** The pre-#271 lookup, unchanged: an industry's own array, else the default one. */
function staticLevel(catalog: Record<string, QuizOptionTile[]>, industry: string): QuizOptionTile[] {
  return catalog[industry] || catalog['default'] || [];
}

export function staticQuizCatalog(industry: string): QuizCatalogLevels {
  return {
    clusters: staticLevel(ADAPTIVE_CLUSTERS, industry),
    personas: staticLevel(ADAPTIVE_PERSONAS, industry),
    useCases: staticLevel(ADAPTIVE_USE_CASES, industry),
    outcomes: staticLevel(ADAPTIVE_OUTCOME_PRIORITIES, industry),
  };
}

/**
 * Fetch one industry's catalog. Returns null on any failure — the caller falls
 * back to the static catalog, so a null here degrades to the pre-#271
 * experience rather than to a broken quiz.
 */
export async function fetchQuizCatalog(
  fetchWithAuth: FetchWithAuth,
  industry: string,
): Promise<QuizCatalogPayload | null> {
  if (!industry) return null;
  try {
    const res = await fetchWithAuth(
      `${QUIZ_CATALOG_URL}?industry=${encodeURIComponent(industry)}`,
      { credentials: 'include' },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as Partial<QuizCatalogPayload> | null;
    if (!json || !Array.isArray(json.clusters)) return null;
    return {
      industry: json.industry ?? industry,
      clusters: json.clusters ?? [],
      personas: json.personas ?? [],
      useCases: json.useCases ?? [],
      outcomes: json.outcomes ?? [],
      sources: json.sources ?? { clusters: 'empty', personas: 'empty', useCases: 'empty', outcomes: 'empty' },
    };
  } catch {
    return null;
  }
}

/**
 * Decide, level by level, whether to render server content or the static
 * fallback. A level the server answered with zero rows falls back on its own —
 * partially-loaded content is a real state while Shane backfills industry by
 * industry, and one empty level must not drag three populated ones back to the
 * hardcoded copy.
 */
export function resolveQuizCatalog(
  payload: QuizCatalogPayload | null,
  industry: string,
): ResolvedQuizCatalog {
  const fallback = staticQuizCatalog(industry);
  const levels: Array<keyof QuizCatalogLevels> = ['clusters', 'personas', 'useCases', 'outcomes'];

  const out = {
    clusters: fallback.clusters,
    personas: fallback.personas,
    useCases: fallback.useCases,
    outcomes: fallback.outcomes,
    sources: {
      clusters: 'static',
      personas: 'static',
      useCases: 'static',
      outcomes: 'static',
    },
  } as ResolvedQuizCatalog;

  if (!payload) return out;

  for (const level of levels) {
    const rows = payload[level];
    if (rows && rows.length > 0) {
      out[level] = rows;
      out.sources[level] = payload.sources?.[level] === 'default' ? 'db-default' : 'db';
    }
  }

  return out;
}

/** Drop repeats by tile id, keeping the first — the catalog's own sort order wins. */
function dedupeById(tiles: QuizOptionTile[]): QuizOptionTile[] {
  const seen = new Set<string>();
  return tiles.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
}

/**
 * Personas narrowed to the selected clusters. Identical predicate to the
 * pre-#271 in-memory filter: an unlinked tile always shows, and selecting
 * nothing shows everything.
 */
export function filterPersonasByClusters(
  personas: QuizOptionTile[],
  selectedClusterIds: string[],
): QuizOptionTile[] {
  if (selectedClusterIds.length === 0) return personas;
  return personas.filter((p) => !p.clusterId || selectedClusterIds.includes(p.clusterId));
}

/**
 * Use cases narrowed to the selected personas.
 *
 * Deduped by id, which the static version never needed: a use case lived under
 * exactly one persona there. In the DB the same use_case_key can legitimately
 * belong to several personas, and selecting two of them must not render the
 * tile twice.
 */
export function filterUseCasesByPersonas(
  useCases: QuizOptionTile[],
  selectedPersonaIds: string[],
): QuizOptionTile[] {
  if (selectedPersonaIds.length === 0) return dedupeById(useCases);
  return dedupeById(useCases.filter((u) => !u.personaId || selectedPersonaIds.includes(u.personaId)));
}

/**
 * Outcomes narrowed to the selected personas — NEW in #271; outcomes had no
 * persona linkage at all before, which is the gap the issue was filed for.
 *
 * Migrated content carries no personaId (the server maps its '*' sentinel to an
 * absent field), so it survives this filter untouched and an industry Shane has
 * not yet given real persona-specific outcomes behaves exactly as it did
 * before. Only real persona-keyed rows actually narrow anything.
 */
export function filterOutcomesByPersonas(
  outcomes: QuizOptionTile[],
  selectedPersonaIds: string[],
): QuizOptionTile[] {
  if (selectedPersonaIds.length === 0) return dedupeById(outcomes);
  return dedupeById(outcomes.filter((o) => !o.personaId || selectedPersonaIds.includes(o.personaId)));
}

/**
 * KNOWN LIMITATION, flagged rather than silently accepted (#271):
 *
 * #270's workloadInference.ts infers the four workload weights from an explicit
 * primary/secondary category attached to each of the 122 hardcoded use cases.
 * That table is keyed by use-case id and lives in TypeScript, so a use case
 * Shane adds via SQL has no category and contributes nothing to the inference.
 * inferWorkloadMix already degrades honestly in that case — an unrecognised id
 * is dropped and its weight redistributed, never scored as neutral — so new
 * content weakens the signal rather than corrupting it.
 *
 * Closing it properly means either a workload-category column on quiz_use_cases
 * or deriving the category server-side, both of which are real scoring changes
 * beyond #271's infrastructure scope. Same applies to ScoringPanel's radar
 * inputs, which are count-based and therefore unaffected.
 */
