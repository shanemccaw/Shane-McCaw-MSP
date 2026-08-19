/**
 * secDashboardData.test.ts — the Security hero fixture, pinned to the prototype.
 *
 * Two things here are worth more than the rest.
 *
 * The first is `findingCount`. The prototype declares `const secFindingCount = 5`
 * at line 15652 and then OVERRIDES it with a literal `7` in `renderVals`
 * (18028), which is the bag the template actually reads. A build that
 * transcribed the const would put the wrong number on the hero and nothing would
 * catch it — not tsc, not a screenshot, not a reviewer who did not also open the
 * prototype. So the screen value is asserted explicitly.
 *
 * The second is the category progress bar, which is INVERSE severity. Reading
 * `progressPct` as a normal "how bad is it" fill inverts the meaning of the
 * whole panel: the worst area would look best. The arithmetic is pinned per
 * card, not just in aggregate.
 *
 * `govTrendGeometry` is re-asserted here too. It was rewritten this pass to
 * delegate to the shared `trendGeometry`, and this is the guard that the
 * extraction did not move Governance's line by a pixel.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { trendGeometry } from "./DriftTrend";
import { GOV_HERO, govTrendGeometry } from "./govDashboardData";
import {
  SEC_AREA_LINKS,
  SEC_AREA_ROW_1,
  SEC_AREA_ROW_2,
  SEC_CRITICAL_COUNT,
  SEC_HERO,
  SEC_HERO_STATS,
  SEC_HISTORY,
  secAreaGeometry,
} from "./secDashboardData";

describe("Security hero — the numbers on screen", () => {
  it("renders 7 findings, NOT the 5 the prototype's const declares", () => {
    assert.equal(SEC_HERO.findingCount, 7);
    const card = SEC_HERO_STATS.find((s) => s.label === "Security Findings")!;
    assert.equal(card.value, "7");
  });

  it("counts 3 critical exposures, and uses that count twice", () => {
    assert.equal(SEC_CRITICAL_COUNT, 3);
    // Once in the red headline above the hero, once as the first stat card.
    assert.equal(SEC_HERO_STATS[0].label, "Critical Exposures");
    assert.equal(SEC_HERO_STATS[0].value, "3");
  });

  it("carries the prototype's scalars, delta sign included", () => {
    assert.equal(SEC_HERO.score, 54);
    assert.equal(SEC_HERO.delta, "-6 this month");
    assert.equal(SEC_HERO.mfaCoverage, 94);
    assert.equal(SEC_HERO.secureScore, 68);
    assert.equal(SEC_HERO.secureScoreIndustryAvg, 61);
    assert.equal(SEC_HERO.scanNumber, 14);
    assert.equal(SEC_HERO.fixedSinceScan1, 4);
    assert.equal(SEC_HERO.statusLabel, "Critical");
  });

  it("has FOUR stat cards, and only Critical Exposures prints its value in the accent", () => {
    assert.equal(SEC_HERO_STATS.length, 4);
    const accented = SEC_HERO_STATS.filter((s) => s.valueInAccent).map((s) => s.label);
    assert.deepEqual(accented, ["Critical Exposures"]);
  });

  it("ends its ten-scan history on the current score", () => {
    assert.equal(SEC_HISTORY.length, 10);
    assert.equal(SEC_HISTORY[SEC_HISTORY.length - 1], SEC_HERO.score);
  });
});

describe("Security categories — the inverse-severity bar", () => {
  it("empties the bar on the WORST area and nearly fills it on the mildest", () => {
    const byKey = (k: string) => SEC_AREA_LINKS.find((a) => a.key === k)!;
    // Conditional Access is the max at 17, so its bar is empty.
    assert.equal(secAreaGeometry(byKey("security-ca")).progressPct, 0);
    // OAuth Apps is 1 of 17 — almost entirely fine.
    assert.equal(secAreaGeometry(byKey("security-oauth")).progressPct, 94);
    assert.equal(secAreaGeometry(byKey("security-mfa")).progressPct, 53);
    assert.equal(secAreaGeometry(byKey("security-legacy-auth")).progressPct, 88);
    assert.equal(secAreaGeometry(byKey("security-email")).progressPct, 82);
  });

  it("makes the worst area the widest card, not the narrowest", () => {
    const widest = [...SEC_AREA_LINKS].sort(
      (a, b) => secAreaGeometry(b).grow - secAreaGeometry(a).grow,
    )[0];
    assert.equal(widest.key, "security-ca");
    assert.equal(secAreaGeometry(widest).grow, 4.5);
  });

  it("pins row 1 to MFA then Conditional Access, regardless of declaration order", () => {
    assert.deepEqual(
      SEC_AREA_ROW_1.map((a) => a.key),
      ["security-mfa", "security-ca"],
    );
    assert.deepEqual(
      SEC_AREA_ROW_2.map((a) => a.key),
      ["security-oauth", "security-legacy-auth", "security-email"],
    );
    assert.equal(SEC_AREA_ROW_1.length + SEC_AREA_ROW_2.length, SEC_AREA_LINKS.length);
  });
});

describe("DriftTrend geometry — shared without moving either line", () => {
  it("plots Security's history against a ±3-padded domain", () => {
    const t = trendGeometry(SEC_HISTORY);
    assert.equal(t.w, 280);
    assert.equal(t.h, 84);
    assert.equal(t.line.split(" ")[0], "0,24");
    assert.equal(t.lastX, 280);
    assert.equal(t.lastY, 66);
  });

  it("leaves Governance's line exactly where it was before the extraction", () => {
    const g = govTrendGeometry();
    assert.equal(g.w, 280);
    assert.equal(g.h, 84);
    // Governance's domain is [62-3, 71+3] = a span of 15, so its first point
    // sits at 22.4 — NOT the 24 Security's span-of-14 produces. The two pillars
    // genuinely do not share a y-scale, which is the point of passing the
    // history in rather than the geometry.
    assert.equal(g.line.split(" ")[0], "0,22.4");
    assert.equal(g.lastX, 280);
    assert.equal(g.lastY, 67.2);
    // And it is still derived from Governance's own history, not Security's.
    assert.deepEqual(g, trendGeometry(GOV_HERO.history));
    assert.notDeepEqual(g, trendGeometry(SEC_HISTORY));
  });
});
