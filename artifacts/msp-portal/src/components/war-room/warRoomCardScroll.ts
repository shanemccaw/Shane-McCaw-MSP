/**
 * warRoomCardScroll.ts — #323 (War Room epic #302).
 *
 * The briefing's thread auto-scroll (WarRoomLogic.tsx's `setThread` ref
 * callback) lands on the TOP of the newest message when it carries a card,
 * so the reader sees the card's header rather than being dropped mid-thread.
 * That is correct for a card that fits inside the visible container — but a
 * card taller than the container (e.g. a multi-step remediation walkthrough)
 * left its own bottom, the actual interactive portion (later steps, follow-up
 * question chips, the "back to topic" action), below the fold with nothing
 * ever bringing it into view.
 *
 * Pulled out as a pure function for the same reason warRoomSections.ts pulled
 * routing decisions out of the component: WarRoomLogic.tsx is `@ts-nocheck`
 * JSX-bearing ported design source `node --test` cannot load, so the actual
 * scroll math lives here where it's a real, directly-tested function, and the
 * component just calls it.
 */

/**
 * The `scrollTop` the thread container should land on for its newest message.
 *
 * @param cardOffsetTop    the card element's `offsetTop` within the container
 * @param cardHeight       the card element's `offsetHeight`
 * @param containerHeight  the container's `clientHeight` (visible height)
 */
export function cardScrollTop(cardOffsetTop: number, cardHeight: number, containerHeight: number): number {
  const overflows = cardHeight > containerHeight;
  return overflows
    // the card doesn't fit — land on its BOTTOM so the interactive portion
    // (later steps, confirm actions) is what's in view, not just the header
    ? Math.max(0, cardOffsetTop + cardHeight - containerHeight + 12)
    // the card fits — land on its TOP, unchanged from the original behaviour
    : Math.max(0, cardOffsetTop - 12);
}
