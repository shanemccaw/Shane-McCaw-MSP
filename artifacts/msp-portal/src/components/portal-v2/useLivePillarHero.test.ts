/**
 * useLivePillarHero.test.ts — the pure ring-delta helper behind the Licensing /
 * Adoption / Health real-score wiring.
 *
 * `deriveHeroDelta` turns the engine's real, replayed score series into the
 * "+3 this month" chip beneath each hero ring. It is the one piece of the
 * wiring with logic worth pinning: the sign, the colour and the fact that it
 * reads the LAST movement rather than the whole span. Everything else in the
 * hook is a passthrough of the war-room payload.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { deriveHeroDelta, HERO_DELTA_UP, HERO_DELTA_DOWN } from "./useLivePillarHero.ts";

describe("deriveHeroDelta", () => {
  it("returns null when there is no series or too little history to state a movement", () => {
    assert.equal(deriveHeroDelta(null), null);
    assert.equal(deriveHeroDelta(undefined), null);
    assert.equal(deriveHeroDelta([]), null);
    assert.equal(deriveHeroDelta([62]), null);
  });

  it("uses the LAST two points, not the whole span, and prints an explicit + sign when the score rose", () => {
    // last - prev = 63 - 60 = +3, even though the span from the start is larger.
    assert.deepEqual(deriveHeroDelta([50, 55, 60, 63]), {
      text: "+3 this month",
      color: HERO_DELTA_UP,
    });
  });

  it("prints a real minus sign and the red colour when the score fell", () => {
    assert.deepEqual(deriveHeroDelta([68, 66]), {
      text: "-2 this month",
      color: HERO_DELTA_DOWN,
    });
  });

  it("treats a flat movement as non-negative: +0 and green, never a bare 0 or red", () => {
    assert.deepEqual(deriveHeroDelta([70, 70]), {
      text: "+0 this month",
      color: HERO_DELTA_UP,
    });
  });

  it("is uniform across pillars — a rising Health score is green here even though its debt trend chart is red-because-rising", () => {
    // Health's ring delta tracks the SCORE (higher is better), unlike its debt
    // trend which counts open items (lower is better). Up is green regardless.
    assert.deepEqual(deriveHeroDelta([64, 66]), {
      text: "+2 this month",
      color: HERO_DELTA_UP,
    });
  });
});
