/**
 * quizCatalogClient.test.ts — #271 (Copilot Assessment epic #183).
 *
 * #271 moves four quiz catalogs from hardcoded objects to DB rows. The risk
 * that actually matters is a silent behaviour change: the wizard's cluster ->
 * persona -> use-case filtering was written against the static shape, and a
 * customer must not get a different set of tiles than they would have before.
 * These tests pin that down against the REAL static catalogs, not fixtures:
 *
 *   - the per-level fallback resolves exactly what `X[industry] || X['default']`
 *     resolved, for every industry the catalogs actually define;
 *   - migrated outcomes (no persona linkage) still show for any persona
 *     selection, so no industry loses its outcome step while Shane backfills;
 *   - real persona-scoped outcomes DO narrow — the capability #271 adds.
 *
 * Run from artifacts/msp-portal:
 *   node --test "src/components/copilot-assessment/quizCatalogClient.test.ts"
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  staticQuizCatalog,
  resolveQuizCatalog,
  filterPersonasByClusters,
  filterUseCasesByPersonas,
  filterOutcomesByPersonas,
  type QuizCatalogPayload,
} from './quizCatalogClient.ts';
import {
  ADAPTIVE_CLUSTERS,
  ADAPTIVE_PERSONAS,
  ADAPTIVE_USE_CASES,
  ADAPTIVE_OUTCOME_PRIORITIES,
  INDUSTRY_OPTIONS,
  type QuizOptionTile,
} from './quizCatalog.ts';

const tile = (id: string, extra: Partial<QuizOptionTile> = {}): QuizOptionTile => ({
  id,
  title: `Title ${id}`,
  description: `Description ${id}`,
  iconName: 'Sparkles',
  ...extra,
});

function payload(over: Partial<QuizCatalogPayload> = {}): QuizCatalogPayload {
  return {
    industry: 'space',
    clusters: [],
    personas: [],
    useCases: [],
    outcomes: [],
    sources: { clusters: 'empty', personas: 'empty', useCases: 'empty', outcomes: 'empty' },
    ...over,
  };
}

describe('static fallback preserves pre-#271 behaviour (#271)', () => {
  test('every real industry resolves the same tiles the hardcoded lookup did', () => {
    // The whole point of the fallback: before Shane runs the catalog SQL, and
    // whenever the fetch fails, the customer must see EXACTLY the old content.
    for (const { id: industry } of INDUSTRY_OPTIONS) {
      const resolved = resolveQuizCatalog(null, industry);

      assert.deepEqual(resolved.clusters, ADAPTIVE_CLUSTERS[industry] || ADAPTIVE_CLUSTERS['default']);
      assert.deepEqual(resolved.personas, ADAPTIVE_PERSONAS[industry] || ADAPTIVE_PERSONAS['default']);
      assert.deepEqual(resolved.useCases, ADAPTIVE_USE_CASES[industry] || ADAPTIVE_USE_CASES['default']);
      assert.deepEqual(
        resolved.outcomes,
        ADAPTIVE_OUTCOME_PRIORITIES[industry] || ADAPTIVE_OUTCOME_PRIORITIES['default'],
      );
    }
  });

  test('the asymmetry in the real data survives — healthcare has own personas but default outcomes', () => {
    // This is the case that forced per-level fallback. If it ever collapses to
    // a whole-catalog fallback, healthcare loses its own clinical personas.
    const resolved = staticQuizCatalog('healthcare');

    assert.ok(resolved.personas.some((p) => p.id === 'clinician'), 'healthcare keeps its own personas');
    assert.equal(ADAPTIVE_OUTCOME_PRIORITIES['healthcare'] !== undefined, true);

    // An industry that genuinely has no outcomes of its own falls to default.
    const manufacturing = staticQuizCatalog('manufacturing');
    assert.equal(ADAPTIVE_OUTCOME_PRIORITIES['manufacturing'], undefined);
    assert.deepEqual(manufacturing.outcomes, ADAPTIVE_OUTCOME_PRIORITIES['default']);
    assert.ok(manufacturing.personas.length > 0, 'but keeps its own personas');
    assert.notDeepEqual(manufacturing.personas, ADAPTIVE_PERSONAS['default']);
  });

  test('a null payload reports every level as static, never as real data', () => {
    const resolved = resolveQuizCatalog(null, 'space');
    assert.deepEqual(resolved.sources, {
      clusters: 'static',
      personas: 'static',
      useCases: 'static',
      outcomes: 'static',
    });
  });
});

describe('server content replaces the fallback per level (#271)', () => {
  test('a populated level wins; an empty one keeps the built-in content', () => {
    const resolved = resolveQuizCatalog(
      payload({
        clusters: [tile('db_cluster')],
        sources: { clusters: 'industry', personas: 'empty', useCases: 'empty', outcomes: 'empty' },
      }),
      'space',
    );

    assert.deepEqual(resolved.clusters.map((c) => c.id), ['db_cluster']);
    assert.equal(resolved.sources.clusters, 'db');

    // One loaded level must not drag the other three anywhere.
    assert.deepEqual(resolved.personas, ADAPTIVE_PERSONAS['space']);
    assert.equal(resolved.sources.personas, 'static');
  });

  test("a level served from the DB's own default rows is reported distinctly", () => {
    const resolved = resolveQuizCatalog(
      payload({
        outcomes: [tile('dev_velocity')],
        sources: { clusters: 'empty', personas: 'empty', useCases: 'empty', outcomes: 'default' },
      }),
      'healthcare',
    );

    // 'db-default' is real content, just not this industry's own — worth
    // telling apart from 'db' when auditing how much Shane has backfilled.
    assert.equal(resolved.sources.outcomes, 'db-default');
    assert.deepEqual(resolved.outcomes.map((o) => o.id), ['dev_velocity']);
  });

  test('all four levels populated means nothing static remains', () => {
    const resolved = resolveQuizCatalog(
      payload({
        clusters: [tile('c')],
        personas: [tile('p', { clusterId: 'c' })],
        useCases: [tile('u', { personaId: 'p' })],
        outcomes: [tile('o', { personaId: 'p' })],
        sources: { clusters: 'industry', personas: 'industry', useCases: 'industry', outcomes: 'industry' },
      }),
      'space',
    );

    assert.deepEqual(Object.values(resolved.sources), ['db', 'db', 'db', 'db']);
  });
});

describe('filtering behaviour is unchanged for personas and use cases (#271)', () => {
  const personas = [
    tile('flight_dir', { clusterId: 'mission_ops' }),
    tile('scientist', { clusterId: 'science_research' }),
    tile('floating', {}), // no cluster linkage
  ];

  test('no cluster selected shows every persona', () => {
    assert.deepEqual(filterPersonasByClusters(personas, []).map((p) => p.id), [
      'flight_dir',
      'scientist',
      'floating',
    ]);
  });

  test('a cluster selection narrows, but an unlinked persona always shows', () => {
    const got = filterPersonasByClusters(personas, ['mission_ops']).map((p) => p.id);
    assert.deepEqual(got, ['flight_dir', 'floating']);
  });

  test('two personas surfacing the same use case render it once', () => {
    // Impossible in the static catalog (one use case, one persona) but real in
    // the DB, where (industry, persona_key, use_case_key) is the unique key.
    const useCases = [
      tile('status_reporting', { personaId: 'flight_dir' }),
      tile('status_reporting', { personaId: 'scientist' }),
      tile('lit_synthesis', { personaId: 'scientist' }),
    ];

    const got = filterUseCasesByPersonas(useCases, ['flight_dir', 'scientist']).map((u) => u.id);
    assert.deepEqual(got, ['status_reporting', 'lit_synthesis']);
  });

  test('dedupe keeps the first row, so catalog sort order decides the winner', () => {
    const useCases = [
      { ...tile('shared'), title: 'First by sort order', personaId: 'a' },
      { ...tile('shared'), title: 'Second', personaId: 'b' },
    ];
    assert.equal(filterUseCasesByPersonas(useCases, ['a', 'b'])[0].title, 'First by sort order');
  });
});

describe('outcomes become persona-scoped without breaking migrated content (#271)', () => {
  test('migrated outcomes (no persona linkage) show for ANY persona selection', () => {
    // Every outcome carried over from the hardcoded catalog is stored with the
    // '*' sentinel and arrives with no personaId. If these were filtered out,
    // ten industries would lose their outcome step entirely.
    const migrated = [tile('res_accel'), tile('mission_safety')];

    assert.deepEqual(filterOutcomesByPersonas(migrated, []).map((o) => o.id), ['res_accel', 'mission_safety']);
    assert.deepEqual(
      filterOutcomesByPersonas(migrated, ['flight_dir']).map((o) => o.id),
      ['res_accel', 'mission_safety'],
      'a persona selection must not hide unlinked outcomes',
    );
  });

  test('real persona-scoped outcomes DO narrow — the capability #271 adds', () => {
    const outcomes = [
      tile('mission_safety', { personaId: 'flight_dir' }),
      tile('res_accel', { personaId: 'scientist' }),
      tile('doc_quality'), // industry-wide, migrated
    ];

    const got = filterOutcomesByPersonas(outcomes, ['flight_dir']).map((o) => o.id);
    assert.deepEqual(got, ['mission_safety', 'doc_quality']);
  });

  test('outcomes for several selected personas union without duplicates', () => {
    const outcomes = [
      tile('shared_outcome', { personaId: 'flight_dir' }),
      tile('shared_outcome', { personaId: 'scientist' }),
      tile('res_accel', { personaId: 'scientist' }),
    ];

    assert.deepEqual(
      filterOutcomesByPersonas(outcomes, ['flight_dir', 'scientist']).map((o) => o.id),
      ['shared_outcome', 'res_accel'],
    );
  });

  test('selecting a persona with no outcomes of its own still yields the shared ones', () => {
    const outcomes = [
      tile('mission_safety', { personaId: 'flight_dir' }),
      tile('doc_quality'),
    ];
    assert.deepEqual(filterOutcomesByPersonas(outcomes, ['payload_eng']).map((o) => o.id), ['doc_quality']);
  });
});
