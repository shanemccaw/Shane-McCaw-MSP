/**
 * warRoomBoard.ts — the hero prelude's "Briefing Whiteboard" real step list (#308,
 * parent epic #302).
 *
 * The whiteboard used to be seven invented fields hardcoded in `warRoomData.ts`'s
 * `HERO_Q` — Industry, Core Roles, Collaboration, Sensitivity, Biggest Drag,
 * Decision Owner, Success Looks Like. Three of those ("Biggest Drag", "Decision
 * Owner", "Success Looks Like") were never real quiz steps anywhere; they were
 * Claude Design's own invented placeholder structure.
 *
 * The real, authoritative step list is `QUIZ_NAV_ITEMS` (quizCatalog.ts), 14
 * steps: About You, Industry, Persona Clusters, Personas, Use Cases, Data
 * Sensitivity, Collaboration Pattern, Tool Usage, AI Comfort, Workflow
 * Structure, Adoption Speed, Outcome Priorities, Change Management, Review.
 * `WAR_ROOM_BOARD_ROWS` below is that list, with Persona Clusters + Personas +
 * Use Cases combined into one row — the grouping Shane confirmed on the issue,
 * for screen space — so the board renders 12 rows for the real 14 steps.
 *
 * Kept as a pure, dependency-free module (no React, no class-component state) so
 * it is unit-testable with `node --test` the way #306's `warRoomQuizCatalog.ts`
 * is: `WarRoomLogic.tsx` is a `.tsx` class component and cannot be mounted under
 * Node's type stripping, so the actual "does the board reflect what was
 * answered" logic has to live somewhere that can be exercised directly, with
 * `WarRoomLogic.tsx` only wrapping this in styling.
 */

/** One row of the whiteboard: which real step ids fill it, and its display tag. */
export interface WarRoomBoardRowDef {
  ids: string[];
  l: string;
}

export const WAR_ROOM_BOARD_ROWS: WarRoomBoardRowDef[] = [
  { ids: ['about-you'], l: 'About You' },
  { ids: ['industry'], l: 'Industry' },
  { ids: ['clusters', 'personas', 'use-cases'], l: 'Clusters · Personas · Use Cases' },
  { ids: ['sensitivity'], l: 'Data Sensitivity' },
  { ids: ['collaboration'], l: 'Collaboration Pattern' },
  { ids: ['tools'], l: 'Tool Usage' },
  { ids: ['ai-comfort'], l: 'AI Comfort' },
  { ids: ['workflow'], l: 'Workflow Structure' },
  { ids: ['adoption-speed'], l: 'Adoption Speed' },
  { ids: ['outcomes'], l: 'Outcome Priorities' },
  { ids: ['change-mgmt'], l: 'Change Management' },
  { ids: ['review'], l: 'Review' },
];

export interface WarRoomBoardRow {
  l: string;
  ids: string[];
  filled: boolean;
  value: string;
}

/**
 * The whiteboard's real, current state: which rows are lit and what they show,
 * derived straight from the hero conversation's real answers.
 *
 * `heroAns` is `WarRoomLogic`'s real answer map, keyed by the real step id
 * (`about-you`, `industry`, `clusters`, …) exactly as `heroAnswer()` writes it —
 * no separate copy of that shape exists here.
 *
 * `review` is not an answerable question (it is the wrap-up screen the room
 * shows once every real question is answered), so it has no id of its own and
 * lights from `heroWrap` — true once the conversation reaches the end of
 * `heroQuestions()` — instead of from an answer.
 *
 * The grouped Clusters/Personas/Use Cases row lights as soon as ANY one of the
 * three is answered, and its value is whichever of the three answers exist so
 * far, joined the same way a multi-select answer already is — the same
 * "light up as the customer answers" behaviour every other row has, applied to
 * a row that happens to cover three real steps instead of one.
 */
export function buildWarRoomBoard(heroAns: Record<string, string> | null | undefined, heroWrap: boolean): WarRoomBoardRow[] {
  const ans = heroAns || {};
  return WAR_ROOM_BOARD_ROWS.map((row) => {
    const isReview = row.ids[0] === 'review';
    const answeredIds = isReview ? [] : row.ids.filter((id) => !!ans[id]);
    const filled = isReview ? !!heroWrap : answeredIds.length > 0;
    const value = isReview ? (heroWrap ? 'reviewed' : '') : answeredIds.map((id) => ans[id]).join(' · ');
    return { l: row.l, ids: row.ids, filled, value };
  });
}
