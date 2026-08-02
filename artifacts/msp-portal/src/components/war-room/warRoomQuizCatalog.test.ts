/**
 * warRoomQuizCatalog.test.ts — #306 (War Room epic #302).
 *
 * The thing #306 actually asked for is that the War Room stops asking every
 * customer about a fictional hospital. So the assertions below are written as
 * that claim, not as a shape check: a customer who says they are in aerospace
 * gets Mission Operations, ITAR and Flight Directors, and the Northline Health
 * roster ("Attending Clinician", "42 CFR Part 2", "2,140 seats") is not
 * reachable from any industry at all.
 *
 * Everything runs against the REAL catalogs — `quizCatalog.ts` and the real
 * per-level fallback in `quizCatalogClient.ts` — with no fixtures and no
 * network. That is deliberate and it is also what makes the test meaningful:
 * `resolveQuizCatalog(null, industry)` is exactly the state the War Room renders
 * in before (or instead of) a successful DB fetch, so if the fallback path ever
 * regressed to fictional content these would fail.
 *
 * WarRoomLogic.tsx itself cannot be mounted here — it is `.tsx`, and Node's type
 * stripping does not transform JSX. That is why the catalog resolution lives in
 * warRoomQuizCatalog.ts as real functions the component calls, the same split
 * #303 made for the routing decisions.
 *
 * Run from artifacts/msp-portal:
 *   node --test "src/components/war-room/warRoomQuizCatalog.test.ts"
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  WAR_ROOM_DEFAULT_INDUSTRY,
  buildWarRoomPersonas,
  buildWarRoomQuestions,
  matchIndustryKey,
  resolveWarRoomIndustry,
  warRoomCatalogFor,
} from './warRoomQuizCatalog.ts';
import { INDUSTRY_OPTIONS } from '../copilot-assessment/quizCatalog.ts';

/**
 * Strings the deleted WIZ_PERSONAS / WIZ_QUESTIONS put in front of every
 * customer, and that no real catalog contains.
 *
 * "Compliance Officer" was on the fictional roster too and is deliberately NOT
 * listed: it is also a real persona in the healthcare catalog, so asserting its
 * absence would fail on genuine content. The list is the fiction that was only
 * ever fiction.
 */
const NORTHLINE_HEALTH_FICTION = [
  'Attending Clinician',
  'Nurse Manager',
  'Revenue Cycle Analyst',
  'Support Team Lead',
  'Executive / Board',
  'What is driving the interest in Copilot?',
  'Which regulations apply to your tenant?',
  'Where does most work actually happen?',
  'Has anyone owned governance in the last year?',
  'How are licences assigned today?',
  'What would success look like in six months?',
  'Who signs off on a change to sharing policy?',
  'Have you run a Copilot pilot before?',
  'How is sensitive content classified today?',
  'What is your appetite for change windows?',
  'Who would run remediation internally?',
  'What is the hard deadline, if any?',
  'HIPAA / HITECH',
  '42 CFR Part 2',
  'Joint Commission',
  'Documentation burden',
  'Board mandate',
  'Purview labels',
  'Nobody formally',
  'Fortnightly',
  'Renewal date',
];

function everyStringIn(industry: string): string[] {
  const catalog = warRoomCatalogFor(industry);
  const roster = buildWarRoomPersonas(catalog);
  const questions = buildWarRoomQuestions(catalog, industry, []);
  return [
    ...roster.flatMap((p) => [p.label, p.tools, p.n]),
    ...questions.flatMap((q) => [q.q, ...q.opts]),
  ];
}

describe('#306 — the War Room asks from the real quiz catalog', () => {
  it('renders real Space / Aerospace content for a customer who says they are in space', () => {
    const industry = resolveWarRoomIndustry({ spoken: 'Space / Aerospace' });
    assert.equal(industry, 'space');

    const catalog = warRoomCatalogFor(industry);
    const roster = buildWarRoomPersonas(catalog);
    const questions = buildWarRoomQuestions(catalog, industry, []);

    // Real personas out of the space catalog, not a hospital's.
    const labels = roster.map((p) => p.label);
    assert.ok(labels.includes('Flight Director'), `expected a Flight Director, got: ${labels.join(', ')}`);
    assert.ok(labels.includes('Payload Engineer'));
    assert.ok(labels.includes('Scientist'));

    // Real space clusters as the options to the first question.
    const clusters = questions.find((q) => q.id === 'clusters');
    assert.ok(clusters, 'the cluster question should be asked');
    assert.deepEqual(clusters.opts, [
      'Science & Research',
      'Mission Operations',
      'Engineering',
      'Program & Administration',
    ]);

    // Real space-specific sensitivity, which is the answer that most obviously
    // has to be industry-scoped: ITAR is not a thing a hospital would be asked.
    const sensitivity = questions.find((q) => q.id === 'sensitivity');
    assert.ok(sensitivity, 'the sensitivity question should be asked');
    assert.ok(
      sensitivity.opts.some((o) => o.includes('ITAR')),
      `expected an ITAR option, got: ${sensitivity.opts.join(', ')}`,
    );

    // Real space outcomes.
    const outcomes = questions.find((q) => q.id === 'outcomes');
    assert.ok(outcomes.opts.includes('Mission Safety'));
  });

  it('renders healthcare content for a healthcare customer — different questions, same mechanics', () => {
    const industry = resolveWarRoomIndustry({ spoken: 'Healthcare' });
    const catalog = warRoomCatalogFor(industry);
    const questions = buildWarRoomQuestions(catalog, industry, []);

    const clusters = questions.find((q) => q.id === 'clusters');
    assert.ok(clusters.opts.includes('Clinical Care'));
    assert.ok(!clusters.opts.includes('Mission Operations'));

    const sensitivity = questions.find((q) => q.id === 'sensitivity');
    assert.ok(sensitivity.opts.some((o) => o.includes('PHI')));
    assert.ok(!sensitivity.opts.some((o) => o.includes('ITAR')));

    // The real content differs but the wizard contract does not: still a list of
    // { id, q, opts } that wizStep can index and wizAnswers can key on.
    for (const question of questions) {
      assert.equal(typeof question.id, 'string');
      assert.ok(question.id.length > 0);
      assert.equal(typeof question.q, 'string');
      assert.ok(question.opts.length > 0, `${question.id} should have real options to choose between`);
      assert.ok(question.opts.every((o) => typeof o === 'string' && o.length > 0));
    }
    assert.equal(new Set(questions.map((q) => q.id)).size, questions.length, 'question ids must be unique');
  });

  it('never shows the Northline Health mock again, for any industry the platform offers', () => {
    for (const option of [...INDUSTRY_OPTIONS, { id: WAR_ROOM_DEFAULT_INDUSTRY }]) {
      const strings = everyStringIn(option.id);
      for (const fiction of NORTHLINE_HEALTH_FICTION) {
        assert.ok(
          !strings.includes(fiction),
          `industry "${option.id}" still offers the fictional "${fiction}"`,
        );
      }
    }
  });

  it('states no seat count on the roster, because the scan has not run yet', () => {
    const catalog = warRoomCatalogFor('space');
    for (const persona of buildWarRoomPersonas(catalog)) {
      assert.equal(persona.n, '', `${persona.label} should not claim a headcount before the scan`);
      // The slot the invented "Outlook · Teams · Word" tool list used to fill
      // now carries the catalog's own real description of the role.
      assert.ok(persona.tools.length > 0);
    }
  });

  it('nothing is pre-selected on the roster, so the wizard asks rather than assumes', () => {
    // The deleted WIZ_PERSONAS flagged four of six `default: true`. The real
    // roster carries no such flag at all — asserted structurally so a future
    // re-introduction of one is a test failure.
    const roster = buildWarRoomPersonas(warRoomCatalogFor('space'));
    assert.ok(roster.length > 0);
    assert.ok(roster.every((p) => !('default' in p)));
  });
});

describe('#306 — resolving what the customer said onto a catalog industry', () => {
  it('matches the suggestion chips the room itself offers', () => {
    // HERO_Q's industry question offers exactly these as one-tap hints, so each
    // one has to land somewhere real.
    assert.equal(matchIndustryKey('Healthcare'), 'healthcare');
    assert.equal(matchIndustryKey('Financial services'), 'finance');
    assert.equal(matchIndustryKey('Manufacturing'), 'manufacturing');
    assert.equal(matchIndustryKey('Government / public sector'), 'government');
  });

  it('matches free text a customer would plausibly type', () => {
    assert.equal(matchIndustryKey('Space'), 'space');
    assert.equal(matchIndustryKey('aerospace & defence'), 'space');
    assert.equal(matchIndustryKey('we run a hospital group'), 'healthcare');
    assert.equal(matchIndustryKey('LEGAL'), 'legal');
  });

  it('falls back to the real default catalog rather than guessing', () => {
    // "Professional services" is a real chip the room offers and the catalog has
    // no such industry. Resolving it to something adjacent would be inventing a
    // taxonomy; the default row set is real content and the honest answer.
    assert.equal(matchIndustryKey('Professional services'), '');
    assert.equal(resolveWarRoomIndustry({ spoken: 'Professional services' }), WAR_ROOM_DEFAULT_INDUSTRY);
    assert.equal(resolveWarRoomIndustry({}), WAR_ROOM_DEFAULT_INDUSTRY);

    // And the default catalog is genuinely usable, not an empty shell.
    const questions = buildWarRoomQuestions(
      warRoomCatalogFor(WAR_ROOM_DEFAULT_INDUSTRY),
      WAR_ROOM_DEFAULT_INDUSTRY,
      [],
    );
    assert.ok(questions.length >= 8, `default industry should still ask a real conversation, got ${questions.length}`);
  });

  it('what the customer says now outranks what a months-old saved profile says', () => {
    assert.equal(
      resolveWarRoomIndustry({ spoken: 'aerospace', saved: 'healthcare' }),
      'space',
      'a customer who has just said aerospace must not get the healthcare catalog',
    );
    // ...but the saved profile is used when they have not said anything yet.
    assert.equal(resolveWarRoomIndustry({ spoken: '', saved: 'healthcare' }), 'healthcare');
    assert.equal(resolveWarRoomIndustry({ spoken: null, saved: 'finance' }), 'finance');
  });
});

describe('#306 — the questions narrow to the roles the customer ticked', () => {
  it('use cases and outcomes follow the persona selection, as the real quiz does', () => {
    const catalog = warRoomCatalogFor('space');
    const all = buildWarRoomQuestions(catalog, 'space', []);
    const narrowed = buildWarRoomQuestions(catalog, 'space', ['flight_dir']);

    const allUseCases = all.find((q) => q.id === 'use-cases').opts;
    const flightDirUseCases = narrowed.find((q) => q.id === 'use-cases').opts;

    assert.ok(flightDirUseCases.length > 0, 'a picked persona must still have something to offer');
    assert.ok(
      flightDirUseCases.length < allUseCases.length,
      'picking one role should narrow the use-case question',
    );
    for (const useCase of flightDirUseCases) {
      assert.ok(allUseCases.includes(useCase), 'narrowing must not invent options');
    }
  });

  it('drops an empty level instead of asking a question with no answers', () => {
    // An unpopulated catalog level is a real state while Shane backfills an
    // industry by SQL. It must not surface as a prompt with nothing under it,
    // and the count Shane's opening line promises has to follow.
    const empty = { ...warRoomCatalogFor('space'), clusters: [] };
    const questions = buildWarRoomQuestions(empty, 'space', []);
    assert.ok(!questions.some((q) => q.id === 'clusters'), 'an empty level is not a question');
    assert.ok(questions.length > 0, 'the rest of the conversation still happens');
    assert.equal(questions.length, buildWarRoomQuestions(warRoomCatalogFor('space'), 'space', []).length - 1);
  });
});
