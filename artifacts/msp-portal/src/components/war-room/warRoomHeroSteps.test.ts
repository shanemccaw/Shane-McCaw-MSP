/**
 * warRoomHeroSteps.test.ts — #308 (War Room epic #302).
 *
 * #308's own claim: the hero prelude's "Briefing Whiteboard" used to track seven
 * invented fields — Industry, Core Roles, Collaboration, Sensitivity, Biggest
 * Drag, Decision Owner, Success Looks Like — three of which ("Biggest Drag",
 * "Decision Owner", "Success Looks Like") were never real quiz steps anywhere.
 * The real, authoritative step list is `QUIZ_NAV_ITEMS` (quizCatalog.ts), 14
 * steps, and the whiteboard is supposed to light up the real step just answered
 * as the customer answers it — once the hero conversation itself asks from the
 * real catalog (#306's own follow-up scope note), not the fictional `HERO_Q`.
 *
 * This file asserts both halves against the REAL catalogs and no fixtures,
 * mirroring #306's own `warRoomQuizCatalog.test.ts`:
 *   1. `buildWarRoomHeroSteps` (warRoomQuizCatalog.ts) — the hero prelude's real,
 *      id-bearing question list, including the `personas` step #306 built the
 *      infrastructure for but never wired into anything reachable, and the
 *      cluster→persona / persona→use-case-and-outcome cascade.
 *   2. `buildWarRoomBoard` (warRoomBoard.ts) — the whiteboard's real 12 rows and
 *      the exact rule for when each one lights up, driven by a real `heroAns`
 *      map exactly as `WarRoomLogic.heroAnswer()` would build it answer by
 *      answer.
 *
 * `WarRoomLogic.tsx` itself is `.tsx` and cannot be mounted here (same reason
 * #306's test file gives) — that is why both pieces of real logic this ticket
 * touches live in plain `.ts` modules the component only wraps in styling.
 *
 * Run from artifacts/msp-portal:
 *   node --test "src/components/war-room/warRoomHeroSteps.test.ts"
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildWarRoomHeroSteps, warRoomCatalogFor } from './warRoomQuizCatalog.ts';
import { WAR_ROOM_BOARD_ROWS, buildWarRoomBoard } from './warRoomBoard.ts';
import { QUIZ_NAV_ITEMS } from '../copilot-assessment/quizCatalog.ts';

describe('#308 — the hero prelude asks the real 14-step quiz', () => {
  it('every catalog-backed step id, multi-select flag and label matches the real QUIZ_NAV_ITEMS', () => {
    const catalog = warRoomCatalogFor('space');
    const steps = buildWarRoomHeroSteps(catalog, 'space');
    assert.ok(steps.length > 0, 'space has real content for every catalog-backed level');

    const navById = new Map(QUIZ_NAV_ITEMS.map((n) => [n.id, n]));
    for (const step of steps) {
      const nav = navById.get(step.id);
      assert.ok(nav, `${step.id} is not a real QUIZ_NAV_ITEMS id`);
      assert.equal(step.l, nav.label, `${step.id}'s whiteboard tag should match the real quiz's own label`);
      assert.equal(step.multi, nav.isMultiSelect, `${step.id}'s multi-select flag should match the real quiz`);
    }

    // `personas` — the level #306 built (buildWarRoomPersonas) but never asked
    // as its own conversational step anywhere reachable. #308 asks it.
    assert.ok(steps.some((s) => s.id === 'personas'), 'personas should be its own hero step');
  });

  it('the fixed pre-steps plus the catalog-backed steps plus Review cover exactly the real 14 ids', () => {
    // about-you + industry are fixed (not catalog-tile levels); Review is the
    // wrap-up screen, not a question — see warRoomBoard.ts. Together with every
    // catalog-backed step space's real catalog is rich enough to ask, that is
    // the full real 14.
    const catalog = warRoomCatalogFor('space');
    const catalogStepIds = buildWarRoomHeroSteps(catalog, 'space').map((s) => s.id);
    const heroIds = new Set(['about-you', 'industry', ...catalogStepIds, 'review']);
    const realIds = new Set(QUIZ_NAV_ITEMS.map((n) => n.id));

    assert.deepEqual(
      Array.from(heroIds).sort(),
      Array.from(realIds).sort(),
      'the hero prelude should ask about exactly the real 14 quiz steps, no invented ones and none missing',
    );
  });

  it('personas narrow to the selected clusters, use cases and outcomes narrow to the selected personas', () => {
    const catalog = warRoomCatalogFor('space');

    // No selections yet: personas step shows the whole roster.
    const unfiltered = buildWarRoomHeroSteps(catalog, 'space');
    const allPersonaIds = unfiltered.find((s) => s.id === 'personas').opts.map((o) => o.id);
    assert.ok(allPersonaIds.includes('flight_dir'));
    assert.ok(allPersonaIds.includes('scientist'));

    // Pick the Mission Operations cluster: personas should narrow to that
    // cluster's real roster and drop Science & Research's.
    const withCluster = buildWarRoomHeroSteps(catalog, 'space', ['mission_ops']);
    const personaStep = withCluster.find((s) => s.id === 'personas');
    const narrowedIds = personaStep.opts.map((o) => o.id);
    assert.ok(narrowedIds.includes('flight_dir'), 'Mission Operations personas should still show');
    assert.ok(!narrowedIds.includes('scientist'), 'Science & Research personas should be filtered out');

    // Pick Flight Director: use cases and outcomes should narrow to it, the
    // same predicate the real assessment quiz uses (#271's filter functions).
    const withPersona = buildWarRoomHeroSteps(catalog, 'space', ['mission_ops'], ['flight_dir']);
    const useCaseTitles = withPersona.find((s) => s.id === 'use-cases').opts.map((o) => o.v);
    assert.ok(useCaseTitles.includes('Contingency Protocol Drafting'), 'Flight Director’s own use case should show');
    assert.ok(!useCaseTitles.includes('Literature Synthesis'), 'a scientist’s use case should be filtered out');
  });

  it('a level with no real content for an industry is dropped rather than asked empty', () => {
    // Every real level `buildWarRoomHeroSteps` returns has opts.length > 0 —
    // asking a step with nothing to pick from is not a real state.
    for (const industry of ['space', 'healthcare', 'default']) {
      const catalog = warRoomCatalogFor(industry);
      const steps = buildWarRoomHeroSteps(catalog, industry);
      for (const step of steps) {
        assert.ok(step.opts.length > 0, `${industry}/${step.id} should not be asked with zero options`);
      }
    }
  });
});

describe('#308 — the Briefing Whiteboard reflects real answers as they land', () => {
  it('has exactly 12 rows, covering the real 14 steps with Clusters+Personas+Use Cases combined', () => {
    assert.equal(WAR_ROOM_BOARD_ROWS.length, 12);
    const coveredIds = WAR_ROOM_BOARD_ROWS.flatMap((r) => r.ids);
    assert.deepEqual(coveredIds.sort(), QUIZ_NAV_ITEMS.map((n) => n.id).sort());

    const grouped = WAR_ROOM_BOARD_ROWS.find((r) => r.ids.length > 1);
    assert.ok(grouped, 'exactly one row should group multiple steps');
    assert.deepEqual(grouped.ids, ['clusters', 'personas', 'use-cases']);
  });

  it('every row starts unfilled with nothing answered', () => {
    const rows = buildWarRoomBoard({}, false);
    assert.equal(rows.length, 12);
    for (const row of rows) {
      assert.equal(row.filled, false, `${row.l} should not be filled before anything is answered`);
      assert.equal(row.value, '');
    }
  });

  it('a single-step row lights the moment its real step is answered, with the real answer as its value', () => {
    const rows = buildWarRoomBoard({ 'about-you': 'IT Director — Information Technology' }, false);
    const aboutYou = rows.find((r) => r.l === 'About You');
    assert.equal(aboutYou.filled, true);
    assert.equal(aboutYou.value, 'IT Director — Information Technology');

    // Nothing else should have lit from one unrelated answer.
    const others = rows.filter((r) => r.l !== 'About You');
    assert.ok(others.every((r) => r.filled === false));
  });

  it('the grouped row lights as soon as the first of its three real steps is answered, mid-conversation', () => {
    // Simulates the real sequence: clusters answered, personas and use cases
    // not yet reached.
    const rows = buildWarRoomBoard({ clusters: 'Mission Operations' }, false);
    const group = rows.find((r) => r.ids.length > 1);
    assert.equal(group.filled, true, 'the grouped row should light on the first real sub-answer, not wait for all three');
    assert.equal(group.value, 'Mission Operations');
  });

  it('the grouped row accumulates each real sub-answer as the conversation proceeds', () => {
    const rows = buildWarRoomBoard(
      { clusters: 'Mission Operations', personas: 'Flight Director', 'use-cases': 'Contingency Protocol Drafting' },
      false,
    );
    const group = rows.find((r) => r.ids.length > 1);
    assert.equal(group.filled, true);
    assert.equal(group.value, 'Mission Operations · Flight Director · Contingency Protocol Drafting');
  });

  it('Review lights only once the hero conversation reaches its wrap-up, not from any answer', () => {
    const midway = buildWarRoomBoard({ 'change-mgmt': 'Fortnightly check-ins' }, false);
    assert.equal(midway.find((r) => r.l === 'Review').filled, false);

    const wrapped = buildWarRoomBoard({ 'change-mgmt': 'Fortnightly check-ins' }, true);
    assert.equal(wrapped.find((r) => r.l === 'Review').filled, true);
  });

  it('a fully answered real conversation lights every row', () => {
    const fullAnswers = {
      'about-you': 'IT Director, IT',
      industry: 'Space / Aerospace',
      clusters: 'Mission Operations',
      personas: 'Flight Director',
      'use-cases': 'Contingency Protocol Drafting',
      sensitivity: 'Classified / ITAR',
      collaboration: 'Teams channels',
      tools: 'Microsoft Teams',
      'ai-comfort': 'Comfortable',
      workflow: 'Highly structured',
      'adoption-speed': 'Fast',
      outcomes: 'Mission Safety',
      'change-mgmt': 'Heavy hand-holding',
    };
    const rows = buildWarRoomBoard(fullAnswers, true);
    for (const row of rows) {
      assert.equal(row.filled, true, `${row.l} should be filled once every real step has an answer`);
    }
  });
});
