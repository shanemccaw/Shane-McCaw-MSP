/**
 * warRoomCardScroll.test.ts — #323 (War Room epic #302).
 *
 * Confirms the fix, not just its inputs: for a card taller than the visible
 * container, the returned `scrollTop` puts the card's actual bottom edge
 * inside the visible window (`scrollTop + containerHeight >= cardBottom`) —
 * the same assertion the live Playwright repro made against the real DOM
 * (govThreadEl's scrollTop/clientHeight/scrollHeight after clicking a
 * multi-step remediation card in a viewport shorter than the card).
 *
 * Run with Node's own test runner (msp-portal has no vitest — see the "test"
 * script in its package.json):
 *   pnpm --filter @workspace/msp-portal test
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { cardScrollTop } from './warRoomCardScroll.ts';

describe('cardScrollTop', () => {
  it('lands on the card bottom, not just its header, when the card is taller than the container', () => {
    // Reproduces the live repro's numbers: a 723px remediation card inside a
    // 398px-tall thread panel.
    const cardOffsetTop = 1095;
    const cardHeight = 723;
    const containerHeight = 398;
    const cardBottom = cardOffsetTop + cardHeight;

    const scrollTop = cardScrollTop(cardOffsetTop, cardHeight, containerHeight);

    assert.ok(
      scrollTop + containerHeight >= cardBottom,
      `expected scrollTop (${scrollTop}) + containerHeight (${containerHeight}) to reach the card's bottom (${cardBottom})`
    );
    // and it isn't just "scroll to the end of the world" — it stops right at
    // the card's bottom (plus the existing 12px breathing room), not beyond
    assert.equal(scrollTop, cardBottom - containerHeight + 12);
  });

  it('keeps the original top-of-card landing when the card fits inside the container', () => {
    const cardOffsetTop = 400;
    const cardHeight = 200;
    const containerHeight = 398;

    const scrollTop = cardScrollTop(cardOffsetTop, cardHeight, containerHeight);

    assert.equal(scrollTop, cardOffsetTop - 12);
  });

  it('never returns a negative scrollTop for a card near the top of the thread', () => {
    assert.equal(cardScrollTop(0, 50, 398), 0);
    assert.equal(cardScrollTop(5, 900, 398), 0 + 5 + 900 - 398 + 12);
  });
});
