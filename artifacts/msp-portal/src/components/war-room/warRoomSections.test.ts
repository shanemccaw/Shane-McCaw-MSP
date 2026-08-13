/**
 * warRoomSections.test.ts — #303 (War Room epic #302).
 *
 * What this pins down is the thing the issue actually asked for: the War Room's
 * position survives the address bar. Three things have to hold for that, and
 * each is exercised against something real rather than a stand-in:
 *
 *   1. a direct URL lands on the right section — real `wouter` matching the real
 *      route pattern App.tsx registers (WAR_ROOM_ROUTE_PATTERN), rendered
 *      through real react-dom, resolving onto real indices in the real SCRIPT;
 *   2. a refresh preserves position — the URL a given briefing state produces
 *      restores that same state, round-tripped through the real route matcher;
 *   3. Back/Forward behave — driven through wouter's own memoryLocation with
 *      history recording on, so push/replace mean exactly what they mean in a
 *      browser.
 *
 * The briefing itself (WarRoomLogic.tsx) cannot be mounted here: it is .tsx, and
 * Node's type stripping does not transform JSX, so `node --test` cannot load it.
 * That is why the routing decisions live in warRoomSections.ts as real functions
 * the component calls, rather than inline in the component — everything asserted
 * below is the code that actually runs in the browser, not a re-implementation.
 *
 * Run with Node's own test runner (msp-portal has no vitest — see the "test"
 * script in its package.json):
 *   pnpm --filter @workspace/msp-portal test
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Router, Route, useParams } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';

import {
  WAR_ROOM_ROUTE_PATTERN,
  WAR_ROOM_SECTIONS,
  deriveWarRoomSection,
  isWarRoomSection,
  isWarRoomSectionLive,
  parseWarRoomSection,
  resolveWarRoomSection,
  warRoomSectionBeat,
  warRoomSectionPath,
  warRoomUrlSync,
} from './warRoomSections.ts';
import { SCRIPT } from './data/warRoomData.ts';

/**
 * Render the real route and report the `:section` param it resolved, or null if
 * the URL did not match at all. `ssrPath` is wouter's own supported way to drive
 * a location without a browser.
 */
const NO_MATCH = Symbol('no-match');

function matchWarRoomUrl(url: string): string | undefined | typeof NO_MATCH {
  let seen: string | undefined | typeof NO_MATCH = NO_MATCH;

  function Probe() {
    const { section } = useParams<{ section?: string }>();
    seen = section;
    return null;
  }

  renderToStaticMarkup(
    React.createElement(
      Router,
      { ssrPath: url },
      React.createElement(Route, { path: WAR_ROOM_ROUTE_PATTERN }, React.createElement(Probe)),
    ),
  );

  return seen;
}

/** The briefing state each kind of landing produces, as far as the URL cares. */
function stateAfterLanding(section: string): Record<string, unknown> {
  const target = resolveWarRoomSection(section);
  switch (target.kind) {
    // restoreSection() runs enterRoom(), which leaves the prelude and raises the
    // arrivals gate.
    case 'intro':
      return { prelude: null, beat: -1, introStage: 'arriving' };
    // A panel-only stop opens its dive directly.
    case 'panel':
      return { prelude: null, beat: -1, dive: target.dive };
    // A scripted stop jumps to the beat, which carries that beat's own dive.
    case 'beat': {
      const beat = SCRIPT[target.index] as { dive?: string };
      return { prelude: null, beat: target.index, dive: beat.dive ?? null };
    }
    default:
      return { prelude: 'hero' };
  }
}

describe('a direct URL lands on the right section (#303)', () => {
  // Deliberately spans all three landing kinds — a scripted dive, another
  // scripted dive, the scripted live demo, and a panel-only stop with no beat.
  const DIRECT_LINKS = ['governance', 'security', 'licensing', 'demo', 'sow'];

  for (const section of DIRECT_LINKS) {
    it(`/war-room/${section} resolves to a real landing target`, () => {
      const url = warRoomSectionPath(section);
      assert.equal(url, `/war-room/${section}`);

      // The real route pattern matches, and hands the component this section.
      assert.equal(matchWarRoomUrl(url), section);

      const target = resolveWarRoomSection(matchWarRoomUrl(url) as string);
      assert.notEqual(target.kind, 'unreachable', `${section} must be reachable`);

      if (target.kind === 'beat') {
        // A real index into the real script, and the beat there really is the
        // one that opens this section.
        assert.ok(target.index >= 0 && target.index < SCRIPT.length);
        const beat = SCRIPT[target.index] as { dive?: string; demo?: unknown };
        if (section === 'demo') assert.ok(beat.demo, 'the demo stop must land on the demo beat');
        else assert.equal(beat.dive, section);
      } else if (target.kind === 'panel') {
        assert.equal(target.dive, section);
        // Panel-only stops are exactly the ones no beat names.
        assert.equal(warRoomSectionBeat(section), -1);
      }
    });
  }

  it('resolves each of the deep-dive stops to a DIFFERENT beat', () => {
    const indices = ['governance', 'licensing', 'adoption', 'compliance', 'health', 'security'].map(
      (k) => warRoomSectionBeat(k),
    );
    assert.equal(new Set(indices).size, indices.length, 'each pillar dive is its own position');
    assert.ok(indices.every((i) => i >= 0));
  });

  it('bare /war-room matches but names no section, so the prelude still opens', () => {
    assert.equal(matchWarRoomUrl('/war-room'), undefined);
    assert.equal(parseWarRoomSection(undefined), null);
    assert.equal(resolveWarRoomSection(undefined).kind, 'unreachable');
  });

  it('a stale or hand-typed section falls back instead of throwing', () => {
    assert.equal(matchWarRoomUrl('/war-room/not-a-real-section'), 'not-a-real-section');
    assert.equal(parseWarRoomSection('not-a-real-section'), null);
    assert.equal(resolveWarRoomSection('not-a-real-section').kind, 'unreachable');
    assert.equal(isWarRoomSectionLive('not-a-real-section'), false);
  });

  it('does not swallow unrelated or deeper paths', () => {
    assert.equal(matchWarRoomUrl('/dashboard'), NO_MATCH);
    assert.equal(matchWarRoomUrl('/war-rooms'), NO_MATCH);
    assert.equal(matchWarRoomUrl('/war-room/governance/extra'), NO_MATCH);
  });
});

describe('a refresh preserves position (#303)', () => {
  // Refreshing is exactly: take where we are, write it to the URL, then restore
  // from that URL alone. If that round-trip is lossy, refresh loses your place.
  for (const { key } of WAR_ROOM_SECTIONS) {
    it(`round-trips ${key} through the URL without losing the position`, () => {
      assert.ok(isWarRoomSectionLive(key), `${key} is a reachable stop`);

      const landed = stateAfterLanding(key);
      const derived = deriveWarRoomSection(landed);
      assert.equal(derived, key, 'the state a landing produces must name that same section');

      // …and the URL that derivation produces restores the identical target.
      const url = warRoomSectionPath(derived as string);
      const afterRefresh = matchWarRoomUrl(url);
      assert.equal(afterRefresh, key);
      assert.deepEqual(resolveWarRoomSection(afterRefresh as string), resolveWarRoomSection(key));
    });
  }

  it('resolution depends on the URL alone, so two loads of one link agree', () => {
    for (const { key } of WAR_ROOM_SECTIONS) {
      assert.deepEqual(resolveWarRoomSection(key), resolveWarRoomSection(key));
    }
  });

  it('the opening prelude is not a section, so bare /war-room is left alone', () => {
    // If this derived a section, entering the room would immediately rewrite the
    // URL and the hero prelude could never be linked to.
    assert.equal(deriveWarRoomSection({ prelude: 'hero', introStage: 'arriving' }), null);
    assert.equal(deriveWarRoomSection({ prelude: 'questions' }), null);
  });

  it('the main scripted thread between dives keeps the last section, not a blank URL', () => {
    // A closed dive mid-briefing derives nothing — which must mean "leave the URL
    // as it is", never "reset to /war-room", or a refresh there would drop the
    // viewer back to the prelude.
    assert.equal(deriveWarRoomSection({ prelude: null, beat: 0, dive: null }), null);
  });

  it('the live demo is read off the beat, not off the lingering demo state', () => {
    // The briefing keeps its `demo` object long after the demo beat has passed.
    // Deriving from that instead of the beat would rewind the URL to
    // /war-room/demo every time a later dive closed.
    const demoBeat = warRoomSectionBeat('demo');
    assert.ok(demoBeat >= 0);
    assert.equal(deriveWarRoomSection({ prelude: null, beat: demoBeat }), 'demo');

    const laterBeat = demoBeat + 1;
    assert.ok(laterBeat < SCRIPT.length, 'the briefing continues past the demo');
    assert.equal(
      deriveWarRoomSection({ prelude: null, beat: laterBeat, demo: { stage: 2 } } as never),
      null,
      'a stale demo object must not keep claiming the URL',
    );
  });

  it('ignores dive panels that are not named stops', () => {
    // `dive` also carries in-room panels like the decisions board, which are not
    // sections and must not reach the URL.
    assert.equal(deriveWarRoomSection({ prelude: null, beat: 0, dive: 'board' }), null);
    assert.equal(isWarRoomSection('board'), false);
  });
});

describe('Back and Forward behave (#303)', () => {
  it('explicit jumps become Back stops; the briefing drifting on its own does not', () => {
    const { navigate, history } = memoryLocation({ path: '/war-room', record: true });

    const go = (section: string, explicit: boolean) => {
      const { path, replace } = warRoomUrlSync(section, explicit);
      navigate(path, { replace });
    };

    // Enter the room: the briefing got here by itself, so it replaces.
    go('intro', false);
    assert.deepEqual(history, ['/war-room/intro']);

    // The viewer picks a stop from the transport menu: that is a real Back stop.
    go('governance', true);
    assert.deepEqual(history, ['/war-room/intro', '/war-room/governance']);

    // The briefing plays on and opens the next dive by itself — the URL follows
    // it, but it must not bury the viewer's own choice under history entries.
    go('licensing', false);
    go('adoption', false);
    assert.deepEqual(history, ['/war-room/intro', '/war-room/adoption']);

    // Another explicit jump.
    go('security', true);
    assert.deepEqual(history, ['/war-room/intro', '/war-room/adoption', '/war-room/security']);

    // Going Back from here lands on a real, restorable position rather than a
    // dead URL — which is the whole point of the push/replace split.
    const back = history[history.length - 2];
    assert.equal(matchWarRoomUrl(back), 'adoption');
    assert.deepEqual(resolveWarRoomSection('adoption'), { kind: 'beat', index: warRoomSectionBeat('adoption') });

    // …and every entry in the stack is restorable, forward as well as back.
    for (const entry of history) {
      const section = matchWarRoomUrl(entry);
      assert.notEqual(section, NO_MATCH);
      assert.notEqual(resolveWarRoomSection(section as string).kind, 'unreachable');
    }
  });

  it('navigating to the same section twice does not stack duplicate Back stops', () => {
    const { navigate, history } = memoryLocation({ path: '/war-room', record: true });
    const { path, replace } = warRoomUrlSync('sow', false);
    navigate(path, { replace });
    navigate(path, { replace });
    assert.deepEqual(history, ['/war-room/sow']);
  });
});

describe('the transport jump-menu still names the same stops (#303)', () => {
  // The menu's target list moved out of renderVals() into this module. It is the
  // same list, and this is what says so.
  it('carries the 13 stops, in order, with their labels and dot colours intact', () => {
    assert.deepEqual(
      WAR_ROOM_SECTIONS.map((s) => s.key),
      [
        'intro',
        'governance',
        'licensing',
        'adoption',
        'compliance',
        'health',
        'security',
        'demo',
        'copilot',
        'sow',
        'remediation',
        'timeline',
        'docs',
      ],
    );
    assert.equal(WAR_ROOM_SECTIONS.find((s) => s.key === 'governance')?.label, 'Governance deep-dive');
    assert.equal(WAR_ROOM_SECTIONS.find((s) => s.key === 'governance')?.dot, '#3B82F6');
    assert.equal(WAR_ROOM_SECTIONS.find((s) => s.key === 'docs')?.label, 'Documents');
    assert.equal(WAR_ROOM_SECTIONS.find((s) => s.key === 'docs')?.dot, '#7dd3fc');
  });

  it('every stop it names is reachable — none render as a dead menu row', () => {
    for (const { key, label } of WAR_ROOM_SECTIONS) {
      assert.ok(isWarRoomSectionLive(key), `${label} (${key}) must be reachable`);
      assert.notEqual(resolveWarRoomSection(key).kind, 'unreachable');
    }
  });

  it('every stop has a URL, and every URL parses back to its stop', () => {
    for (const { key } of WAR_ROOM_SECTIONS) {
      assert.equal(parseWarRoomSection(matchWarRoomUrl(warRoomSectionPath(key)) as string), key);
    }
  });
});
