/**
 * warRoomQuizCatalog.ts — #306 (War Room epic #302).
 *
 * The War Room's opening conversation used to ask twelve invented questions and
 * offer a roster of six invented personas, both hardcoded in warRoomData.ts as
 * part of the Northline Health demo org that came over with the Claude Design
 * prototype: "Attending Clinician · 2,140 seats", "Which regulations apply to
 * your tenant?" and so on. None of it was real, none of it was the customer's,
 * and every customer in the platform saw the same fictional hospital.
 *
 * This module replaces that content — and ONLY that content. It is a data-source
 * swap: `wizStep`, `wizAnswers`, `wizNext` and `wizBack` in WarRoomLogic still
 * work exactly as they did, on a list that is now built from the same catalog the
 * real Copilot assessment quiz asks from.
 *
 * ── Where the content comes from ─────────────────────────────────────────────
 * Four levels — persona clusters, personas, use cases and outcomes — are served
 * per industry by GET /api/portal/copilot-assessment/quiz-catalog (#271, with
 * the failure diagnostics from #286), through the existing
 * `quizCatalogClient.ts`. That client already resolves the DB answer against the
 * static catalog PER LEVEL, so a level Shane has not yet populated falls back to
 * real hardcoded platform content rather than to nothing; nothing about that
 * behaviour is re-implemented here.
 *
 * The remaining levels the War Room asks about — data sensitivity, collaboration
 * pattern, tool usage, AI comfort, workflow structure, adoption speed and change
 * management — are not DB-backed yet: #271 moved four catalogs, not eleven. They
 * are read straight from `quizCatalog.ts`, which is still where the real quiz
 * reads them from too, and two of them (sensitivity, collaboration) are genuinely
 * industry-scoped there. So every question below is real platform content for the
 * customer's own industry, whether or not the DB half has been populated.
 *
 * ── What is deliberately NOT here ────────────────────────────────────────────
 * Seat counts. The old roster carried "2,140 seats" per persona and the wizard
 * runs BEFORE the tenant scan, so there is no real number to put there — the
 * persona list therefore carries the catalog's own description instead of an
 * invented headcount. Swapping one fiction for another would defeat the point.
 *
 * Persistence. Whether the answers collected here should be written back as a
 * real QuizProfile (`tenants.copilot_assessment`, #237) so the downstream
 * generators consume them is an open scope question on #306, which is filed with
 * no body and no comments. Answers stay in component state exactly as they did
 * before, and that decision is recorded rather than guessed at.
 */
import {
  INDUSTRY_OPTIONS,
  ADAPTIVE_DATA_SENSITIVITY,
  ADAPTIVE_COLLABORATION,
  UNIVERSAL_TOOL_USAGE,
  UNIVERSAL_AI_COMFORT,
  UNIVERSAL_WORKFLOW_STRUCTURE,
  UNIVERSAL_ADOPTION_SPEED,
  UNIVERSAL_CHANGE_MGMT,
  type QuizOptionTile,
  // Explicit .ts specifiers throughout this module so it is loadable by
  // `node --test`, the same reason quizCatalogClient.ts spells them out.
} from '../copilot-assessment/quizCatalog.ts';
import {
  fetchQuizCatalog,
  resolveQuizCatalog,
  filterUseCasesByPersonas,
  filterOutcomesByPersonas,
  type ResolvedQuizCatalog,
} from '../copilot-assessment/quizCatalogClient.ts';
import { fetchSavedQuizProfile } from '../copilot-assessment/quizProfileClient.ts';

/** The catalog key every unrecognised industry resolves to — a real row set, not a placeholder. */
export const WAR_ROOM_DEFAULT_INDUSTRY = 'default';

/** One persona tile in the wizard's roster — the shape WIZ_PERSONAS used to have. */
export interface WarRoomPersonaOption {
  id: string;
  label: string;
  /**
   * Real seat count, once one exists. Always '' before the scan has run, which
   * is every point at which this roster is shown — see the header note.
   */
  n: string;
  /** The catalog's own description of the role, in the slot the fiction used for a tool list. */
  tools: string;
}

/** One conversational question — the shape WIZ_QUESTIONS used to have. */
export interface WarRoomQuestion {
  id: string;
  q: string;
  opts: string[];
}

/**
 * The War Room's question spine: which real quiz level each conversational
 * question draws its options from, and how Shane asks it.
 *
 * The wording is the War Room's own. The real quiz is a form and phrases these
 * as instructions ("Select All Applicable Data Sensitivity Levels"); this is a
 * conversation, and Shane asking a customer to "Select All" would read as a
 * broken port. The OPTIONS are the shared, real thing — the question text is
 * presentation, per medium.
 *
 * `level` names where the options come from. 'clusters' | 'useCases' |
 * 'outcomes' are the DB-backed levels resolved through quizCatalogClient;
 * everything else is a static-but-real catalog looked up below.
 */
const QUESTION_SPINE: Array<{ id: string; q: string; level: string }> = [
  { id: 'clusters', q: 'Which of these groups makes up the bulk of the day-to-day here?', level: 'clusters' },
  { id: 'use-cases', q: 'Of the work those people do, which would you want Copilot taking on first?', level: 'useCases' },
  { id: 'sensitivity', q: 'And what kind of sensitive material sits in the tenant alongside it?', level: 'sensitivity' },
  { id: 'collaboration', q: 'How does work actually move between people here?', level: 'collaboration' },
  { id: 'tools', q: 'Which Microsoft 365 app does the team genuinely live in?', level: 'tools' },
  { id: 'ai-comfort', q: 'How comfortable is the team with AI-generated content today?', level: 'aiComfort' },
  { id: 'workflow', q: 'How structured is a normal working day?', level: 'workflow' },
  { id: 'adoption-speed', q: 'How quickly does this organisation take up new technology?', level: 'adoptionSpeed' },
  { id: 'outcomes', q: 'If Copilot went well, what would be different in six months?', level: 'outcomes' },
  { id: 'change-mgmt', q: 'And how much hand-holding would a rollout need?', level: 'changeMgmt' },
];

/** The pre-#271 lookup shape the static catalogs still use: an industry's own array, else the default one. */
function industryLevel(catalog: Record<string, QuizOptionTile[]>, industry: string): QuizOptionTile[] {
  return catalog[industry] || catalog[WAR_ROOM_DEFAULT_INDUSTRY] || [];
}

/**
 * Phrases a customer can realistically say that do not contain the catalog's own
 * word for their industry.
 *
 * Only the ones the War Room itself puts in front of them: `HERO_Q`'s industry
 * question offers "Financial services", "Government / public sector" and
 * "Professional services" as one-tap hints, and none of those three contain
 * "finance", "government" or any catalog id as a substring. Guessing beyond what
 * the room actually suggests would be inventing a taxonomy; anything unmatched
 * resolves to the real 'default' catalog instead.
 */
const INDUSTRY_ALIASES: Array<{ match: string; key: string }> = [
  { match: 'financial', key: 'finance' },
  { match: 'banking', key: 'finance' },
  { match: 'insurance', key: 'finance' },
  { match: 'public sector', key: 'government' },
  { match: 'defense', key: 'government' },
  { match: 'defence', key: 'government' },
  { match: 'aerospace', key: 'space' },
  { match: 'satellite', key: 'space' },
  { match: 'medical', key: 'healthcare' },
  { match: 'hospital', key: 'healthcare' },
  { match: 'clinical', key: 'healthcare' },
  { match: 'university', key: 'education' },
  { match: 'school', key: 'education' },
  { match: 'law', key: 'legal' },
  { match: 'logistics', key: 'transportation' },
  { match: 'utilities', key: 'energy' },
  { match: 'charity', key: 'nonprofit' },
  { match: 'not-for-profit', key: 'nonprofit' },
];

/**
 * Turn whatever the customer said into a catalog industry key.
 *
 * The War Room asks for industry as free text with suggestion chips, not as a
 * picker off INDUSTRY_OPTIONS, so this has to cope with "Space", "aerospace &
 * defence" and "Financial services" alike. Matching is against the real
 * INDUSTRY_OPTIONS ids and titles first, then the alias list above.
 *
 * Returns '' for nothing recognisable, so a caller can distinguish "they have not
 * told us yet" from a real answer.
 */
export function matchIndustryKey(spoken: string | null | undefined): string {
  const text = (spoken || '').trim().toLowerCase();
  if (!text) return '';

  for (const option of INDUSTRY_OPTIONS) {
    if (text === option.id || text === option.title.toLowerCase()) return option.id;
  }
  // Substring both ways: "space" matches the answer "Space / Aerospace", and the
  // answer "space" matches the option title "Space / Aerospace".
  for (const option of INDUSTRY_OPTIONS) {
    const title = option.title.toLowerCase();
    if (text.includes(option.id) || text.includes(title) || title.includes(text)) return option.id;
  }
  for (const alias of INDUSTRY_ALIASES) {
    if (text.includes(alias.match)) return alias.key;
  }
  return '';
}

/**
 * The industry this customer's catalog should be scoped to.
 *
 * `spoken` — what they typed into the room's own industry question this session.
 * `saved`  — the industry on their saved QuizProfile (#237), already a catalog
 *            key because the quiz collected it off INDUSTRY_OPTIONS.
 *
 * Spoken wins. Both are the customer's own answer, but one of them is being
 * given right now in this conversation and the other could be months old; a
 * customer who has just told Shane they are in aerospace should not get the
 * healthcare catalog because that is what a previous assessment said.
 */
export function resolveWarRoomIndustry(args: { spoken?: string | null; saved?: string | null }): string {
  return (
    matchIndustryKey(args.spoken) ||
    matchIndustryKey(args.saved) ||
    WAR_ROOM_DEFAULT_INDUSTRY
  );
}

/**
 * The real roster for an industry, replacing WIZ_PERSONAS.
 *
 * Nothing is pre-selected. The old roster flagged four of its six as
 * `default: true`, which put words in the customer's mouth about which roles
 * exist in their tenant; the real quiz's persona step starts empty and so does
 * this one.
 */
export function buildWarRoomPersonas(catalog: ResolvedQuizCatalog): WarRoomPersonaOption[] {
  return catalog.personas.map((persona) => ({
    id: persona.id,
    label: persona.title,
    n: '',
    tools: persona.description,
  }));
}

/**
 * The real question list for an industry, replacing WIZ_QUESTIONS.
 *
 * `selectedPersonaIds` are the roster ids the customer has ticked so far. Use
 * cases and outcomes narrow to them through the SAME predicates the quiz uses
 * (#271's `filterUseCasesByPersonas` / `filterOutcomesByPersonas`), so an
 * unlinked tile always shows and picking nothing shows everything — no second
 * copy of that filtering logic exists here to drift from it.
 *
 * A level with no options at all is dropped rather than asked as an empty
 * question — a real state for an industry Shane is still backfilling by SQL. A
 * level with exactly one is still asked: in this catalog a use case belongs to
 * exactly one persona, so a customer who ticks a single role has exactly one
 * use case, and dropping the most valuable question in the conversation to
 * avoid a one-option prompt would be the worse trade. The list length is
 * therefore real, which is why every "N of M" label reads it rather than a
 * hardcoded twelve.
 */
export function buildWarRoomQuestions(
  catalog: ResolvedQuizCatalog,
  industry: string,
  selectedPersonaIds: string[] = [],
): WarRoomQuestion[] {
  const optionsFor = (level: string): QuizOptionTile[] => {
    switch (level) {
      case 'clusters': return catalog.clusters;
      case 'useCases': return filterUseCasesByPersonas(catalog.useCases, selectedPersonaIds);
      case 'outcomes': return filterOutcomesByPersonas(catalog.outcomes, selectedPersonaIds);
      case 'sensitivity': return industryLevel(ADAPTIVE_DATA_SENSITIVITY, industry);
      case 'collaboration': return industryLevel(ADAPTIVE_COLLABORATION, industry);
      case 'tools': return UNIVERSAL_TOOL_USAGE;
      case 'aiComfort': return UNIVERSAL_AI_COMFORT;
      case 'workflow': return UNIVERSAL_WORKFLOW_STRUCTURE;
      case 'adoptionSpeed': return UNIVERSAL_ADOPTION_SPEED;
      case 'changeMgmt': return UNIVERSAL_CHANGE_MGMT;
      default: return [];
    }
  };

  return QUESTION_SPINE.map((step) => ({
    id: step.id,
    q: step.q,
    // Titles, not ids: the answer is stored and echoed back into the chat
    // transcript verbatim, exactly as the old string options were.
    opts: optionsFor(step.level).map((tile) => tile.title),
  })).filter((question) => question.opts.length > 0);
}

/**
 * The catalog to render right now, without waiting for anything.
 *
 * `resolveQuizCatalog(null, industry)` is the whole static catalog for that
 * industry, so the War Room shows real industry-scoped content on the very first
 * frame and the DB fetch below only ever upgrades it. There is no loading state
 * and no window in which the conversation has nothing to ask.
 */
export function warRoomCatalogFor(industry: string): ResolvedQuizCatalog {
  return resolveQuizCatalog(null, industry);
}

/**
 * Reads the current bearer token. WarRoomLogic is a `React.Component` ported
 * from the design source and cannot call `useAuth()`, so it passes
 * `getCurrentAccessToken` in — the accessor auth-context.tsx exports for exactly
 * this case (its own note says so: it exists so the class-component
 * ErrorBoundary can attach a token without the hook).
 *
 * Injected rather than imported because auth-context is a `.tsx` module, and
 * this file has to stay loadable by `node --test`, which does not transform JSX.
 */
export type WarRoomTokenReader = () => string | null;

/** The bearer-token `fetch` that the two loaders below hand to the existing clients. */
function authedFetch(getToken: WarRoomTokenReader) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const token = getToken();
    const headers = new Headers(init?.headers);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  };
}

/**
 * Upgrade an industry's catalog from the DB, or keep the static one.
 *
 * Deliberately resolves rather than rejects: the caller is a briefing that has
 * already rendered a usable conversation, and a catalog fetch hiccup must not
 * end it. `fetchQuizCatalog` returns null on any failure and
 * `resolveQuizCatalog` turns that into the per-level static fallback.
 */
export async function loadWarRoomCatalog(
  industry: string,
  getToken: WarRoomTokenReader,
): Promise<ResolvedQuizCatalog> {
  const payload = await fetchQuizCatalog(authedFetch(getToken), industry);
  return resolveQuizCatalog(payload, industry);
}

/**
 * The industry on the customer's saved QuizProfile (#237), if they have one.
 *
 * Goes through the existing `fetchSavedQuizProfile` rather than re-reading the
 * route, so "no saved profile" and "the request failed" keep meaning the same
 * thing here as they do in the assessment wizard. A War Room visitor who never
 * took the quiz has no profile, and that is an ordinary state — it just means
 * the industry has to come from what they say in the room.
 */
export async function fetchSavedIndustry(getToken: WarRoomTokenReader): Promise<string> {
  const profile = await fetchSavedQuizProfile(authedFetch(getToken));
  return profile?.industry || '';
}
