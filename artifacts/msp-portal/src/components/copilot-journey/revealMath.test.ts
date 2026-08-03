/**
 * revealMath.test.ts — assertions against the Reveal's animation maths.
 *
 * These exist because the handoff names the logic class as the specification, so
 * the transcription of it is the thing most worth pinning: a wrong easing or an
 * off-by-one scene window is invisible in review and obvious to a customer.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  activeSceneIndex,
  blockReveal,
  clampWindow,
  easeBackSettle,
  easeOutCubic,
  generationView,
  pillarCount,
  radarChipOpacity,
  radarStageScale,
  radarWedgeOpacity,
  radarWedgePath,
  railTicks,
  ringCounterRotation,
  ringRotation,
  sceneProgress,
  sparkDelta,
  sparkGeometry,
  sparkPath,
  sparkTip,
  verdictCount,
  RADAR_INNER_R,
  RADAR_OUTER_R,
  SPARK_H,
  SPARK_W,
} from "./revealMath.ts";

describe("easing", () => {
  it("clampWindow saturates at both ends", () => {
    assert.equal(clampWindow(-1, 0, 1), 0);
    assert.equal(clampWindow(2, 0, 1), 1);
    assert.equal(clampWindow(0.5, 0, 1), 0.5);
  });

  it("clampWindow maps a sub-window onto 0..1", () => {
    assert.equal(clampWindow(0.34, 0.34, 0.6), 0);
    assert.equal(clampWindow(0.6, 0.34, 0.6), 1);
    assert.ok(Math.abs(clampWindow(0.47, 0.34, 0.6) - 0.5) < 1e-9);
  });

  it("clampWindow does not divide by zero on a degenerate window", () => {
    assert.equal(clampWindow(0.5, 0.5, 0.5), 1);
    assert.equal(clampWindow(0.4, 0.5, 0.5), 0);
  });

  it("easeOutCubic is anchored at both ends and eases out", () => {
    assert.equal(easeOutCubic(0), 0);
    assert.equal(easeOutCubic(1), 1);
    assert.ok(easeOutCubic(0.5) > 0.5, "should be ahead of linear at the midpoint");
  });

  it("easeBackSettle overshoots before landing on 1", () => {
    assert.equal(easeBackSettle(0), 0);
    assert.ok(Math.abs(easeBackSettle(1) - 1) < 1e-9);
    const peak = Math.max(
      ...Array.from({ length: 101 }, (_, i) => easeBackSettle(i / 100)),
    );
    assert.ok(peak > 1, "a weighted landing must actually overshoot");
  });
});

describe("blockReveal", () => {
  it("rises 24px and fades in over the window", () => {
    const start = blockReveal(0.03, 0.03, 0.2, false);
    assert.equal(start.o, 0);
    assert.equal(start.y, 24);

    const end = blockReveal(0.2, 0.03, 0.2, false);
    assert.equal(end.o, 1);
    assert.equal(end.y, 0);
  });

  it("drops the parallax entirely under reduced motion", () => {
    for (const p of [0, 0.05, 0.1, 0.2, 1]) {
      assert.equal(blockReveal(p, 0.03, 0.2, true).y, 0);
    }
  });

  it("compresses the reduced-motion fade into the first 40% of the window", () => {
    // 0.03 + (0.2-0.03)*0.4 = 0.098 — fully opaque well before the motion path.
    assert.equal(blockReveal(0.098, 0.03, 0.2, true).o, 1);
    assert.ok(blockReveal(0.098, 0.03, 0.2, false).o < 1);
  });
});

describe("scene progress", () => {
  it("is 0 while pinning and 1 once the span is consumed", () => {
    const vh = 900;
    const height = 900 * 2.8; // a 280vh pillar scene
    assert.equal(sceneProgress({ top: 0, bottom: height, height }, vh), 0);
    const span = height - vh;
    assert.equal(sceneProgress({ top: -span, bottom: height - span, height }, vh), 1);
  });

  it("clamps outside its own travel", () => {
    const vh = 900;
    const height = 2520;
    assert.equal(sceneProgress({ top: 400, bottom: height + 400, height }, vh), 0);
    assert.equal(sceneProgress({ top: -9999, bottom: 0, height }, vh), 1);
  });

  it("never divides by zero when a section is shorter than the viewport", () => {
    const p = sceneProgress({ top: -100, bottom: 200, height: 300 }, 900);
    assert.ok(Number.isFinite(p));
    assert.equal(p, 1);
  });

  it("activeSceneIndex picks the scene owning the 40/60 band", () => {
    const vh = 1000;
    const rects = [
      { top: -2000, bottom: -500, height: 1500 },
      { top: -500, bottom: 1500, height: 2000 }, // top <= 400 and bottom > 600
      { top: 1500, bottom: 3500, height: 2000 },
    ];
    assert.equal(activeSceneIndex(rects, vh), 1);
  });

  it("activeSceneIndex defaults to the first scene at the very top", () => {
    const rects = [{ top: 0, bottom: 1700, height: 1700 }];
    assert.equal(activeSceneIndex(rects, 1000), 0);
  });
});

describe("radar", () => {
  it("paints nothing before a pillar starts", () => {
    assert.equal(radarWedgePath(0, 0), "");
    assert.equal(radarWedgeOpacity(0), 0);
  });

  it("grows from the inner radius out to the rim", () => {
    const quarter = radarWedgePath(0, 0.25);
    const full = radarWedgePath(0, 1);
    assert.ok(quarter.includes(String(RADAR_INNER_R)), "inner arc is always at r=104");
    assert.ok(full.includes(String(RADAR_OUTER_R)), "a complete wedge reaches r=214");
    assert.notEqual(quarter, full);
  });

  it("keeps a started wedge visible — 0.58 floor, 1.0 ceiling", () => {
    assert.ok(Math.abs(radarWedgeOpacity(0.0001) - 0.58) < 0.001);
    assert.ok(Math.abs(radarWedgeOpacity(1) - 1) < 1e-9);
  });

  it("places the six wedges at 60 degree increments", () => {
    const paths = [0, 1, 2, 3, 4, 5].map((i) => radarWedgePath(i, 1));
    assert.equal(new Set(paths).size, 6, "no two wedges may share geometry");
  });

  it("fades chips in at 30%, 56% and 82% of pillar progress", () => {
    assert.equal(radarChipOpacity(0.29, 0), 0);
    assert.equal(radarChipOpacity(0.4, 0), 1);
    assert.equal(radarChipOpacity(0.55, 1), 0);
    assert.equal(radarChipOpacity(0.66, 1), 1);
    assert.equal(radarChipOpacity(0.81, 2), 0);
    assert.equal(radarChipOpacity(0.92, 2), 1);
  });

  it("scales the stage down to fit, never up", () => {
    assert.equal(radarStageScale(2560, 1440), 1);
    assert.ok(radarStageScale(600, 700) < 1);
  });
});

describe("count-ups", () => {
  it("verdict reaches its target by 58% of the timeline and holds", () => {
    assert.equal(verdictCount(41, 0), 0);
    assert.equal(verdictCount(41, 0.58), 41);
    assert.equal(verdictCount(41, 1), 41);
  });

  it("a critical pillar overshoots on the way up", () => {
    const samples = Array.from({ length: 61 }, (_, i) =>
      pillarCount(34, 0.34 + (i / 60) * 0.26, false),
    );
    assert.ok(Math.max(...samples) > 34, "critical pillars get a weighted landing");
    assert.equal(samples[samples.length - 1], 34, "and still settle exactly on target");
  });

  it("an attention pillar glides without overshoot", () => {
    const samples = Array.from({ length: 61 }, (_, i) =>
      pillarCount(57, 0.34 + (i / 60) * 0.26, false),
    );
    assert.equal(Math.max(...samples), 57);
  });

  it("reduced motion removes the wobble but keeps the number", () => {
    const samples = Array.from({ length: 61 }, (_, i) =>
      pillarCount(34, 0.34 + (i / 60) * 0.26, true),
    );
    assert.equal(Math.max(...samples), 34, "no overshoot");
    assert.equal(samples[samples.length - 1], 34, "count-up still lands — it is informational");
  });
});

describe("ring settle", () => {
  it("rotates -26deg to 0 and stops", () => {
    assert.ok(Math.abs(ringRotation(0.42, false) - -26) < 1e-9);
    assert.equal(ringRotation(1, false), -0);
  });

  it("is inert under reduced motion", () => {
    assert.equal(ringRotation(0.5, true), 0);
    assert.equal(ringCounterRotation(0.5, true), -0);
  });

  it("labels counter-rotate by exactly the ring's rotation", () => {
    for (const t of [0.42, 0.6, 0.8, 1]) {
      assert.ok(Math.abs(ringRotation(t, false) + ringCounterRotation(t, false)) < 1e-9);
    }
  });
});

describe("sparklines", () => {
  it("renders nothing without a real series — never interpolates", () => {
    assert.equal(sparkGeometry(null), null);
    assert.equal(sparkGeometry(undefined), null);
    assert.equal(sparkGeometry([]), null);
    assert.equal(sparkGeometry([42]), null, "a single point is not a trend");
    assert.equal(sparkPath(null), "");
    assert.equal(sparkTip(null), null);
    assert.equal(sparkDelta([7]), null);
  });

  it("fits the series inside the 92x28 box", () => {
    const pts = sparkGeometry([46, 44, 45, 41, 40, 38]);
    assert.ok(pts);
    assert.equal(pts[0].x, 0);
    assert.equal(pts[pts.length - 1].x, SPARK_W);
    for (const p of pts) {
      assert.ok(p.y >= 0 && p.y <= SPARK_H, `y ${p.y} inside the box`);
    }
  });

  it("puts the highest value at the top of the box", () => {
    const pts = sparkGeometry([10, 50]);
    assert.ok(pts);
    assert.ok(pts[1].y < pts[0].y, "50 must sit above 10");
  });

  it("survives a flat series without dividing by zero", () => {
    const pts = sparkGeometry([50, 50, 50]);
    assert.ok(pts);
    for (const p of pts) assert.ok(Number.isFinite(p.y));
  });

  it("labels a decline red, a rise green and a flat move amber", () => {
    assert.deepEqual(sparkDelta([46, 38]), { label: "−8 pts", color: "#F87171" });
    assert.deepEqual(sparkDelta([39, 46]), { label: "+7 pts", color: "#34D399" });
    assert.deepEqual(sparkDelta([50, 51]), { label: "+1 pts", color: "#FBBF24" });
    assert.deepEqual(sparkDelta([50, 50]), { label: "±0 pts", color: "#FBBF24" });
  });

  it("path starts with a move and continues with lines", () => {
    const d = sparkPath([1, 2, 3]);
    assert.ok(d.startsWith("M "));
    assert.equal((d.match(/L /g) ?? []).length, 2);
  });
});

describe("document generation", () => {
  it("never gates the reveal on generation — pending is a first-class state", () => {
    const g = generationView(3, 9);
    assert.equal(g.done, false);
    assert.equal(g.status, "3 of 9 ready");
    assert.equal(g.pct, "33%");
    assert.match(g.eyebrow, /Generating your findings/);
  });

  it("does not promise a notification the platform does not send", () => {
    // The generation workflow emits `assessment.docs.completed` and nothing
    // consumes it; there is no mail path in document generation. Telling a
    // customer they will be alerted is a promise this platform cannot keep.
    const note = generationView(3, 9).note;
    assert.doesNotMatch(note, /notify|alert|email|notification/i);
    assert.match(note, /Generation continues whether this page is open or not/);
  });

  it("switches to document access on completion", () => {
    const g = generationView(9, 9);
    assert.equal(g.done, true);
    assert.equal(g.pct, "100%");
    assert.equal(g.eyebrow, "The full findings, yours to keep");
  });

  it("clamps a payload that over- or under-reports", () => {
    assert.equal(generationView(12, 9).status, "9 of 9 ready");
    assert.equal(generationView(-2, 9).status, "0 of 9 ready");
  });

  it("reports the real count rather than assuming nine", () => {
    // The expected set is per-service and excludes the SOW and anything not
    // customer-visible, so a real tenant's set is regularly not nine.
    const g = generationView(6, 6);
    assert.equal(g.status, "6 of 6 ready");
    assert.match(g.note, /^All 6 documents/);
  });

  it("says it does not know rather than counting to zero", () => {
    // total === 0 means the status fetch failed or the tenant has no assessment
    // service — NOT that generation finished. "0 of 0 ready" with a progress bar
    // and a promise of a notification would assert a run that is not happening.
    const g = generationView(0, 0);
    assert.equal(g.known, false);
    assert.equal(g.done, false);
    assert.equal(g.status, "");
    assert.equal(g.eyebrow, "");
    assert.equal(g.note, "");
    assert.equal(generationView(3, 9).known, true);
  });
});

describe("progress rail", () => {
  it("marks current, passed and upcoming distinctly", () => {
    const ticks = railTicks(9, 3);
    assert.equal(ticks.length, 9);
    assert.equal(ticks[3].background, "#00B4D8");
    assert.equal(ticks[3].scaleX, 2.4);
    assert.equal(ticks[0].background, "rgba(0,120,212,.6)");
    assert.equal(ticks[8].background, "rgba(51,65,85,.7)");
    assert.equal(ticks[8].scaleX, 1);
  });
});
