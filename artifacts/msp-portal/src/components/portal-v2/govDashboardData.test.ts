/**
 * govDashboardData.test.ts — the Governance fixture and its area-card geometry.
 *
 * The load-bearing assertions here pin the thing a future edit is most likely to
 * quietly break: the area card's derived values. The page was originally built
 * from an earlier design revision whose tile was a plain score/label card; the
 * current design gives it the same anatomy as Compliance's — an icon, a
 * four-bar sparkline, and a tier-scaled delta chip that ALWAYS prints (`±0` when
 * flat) and is muted on a green area rather than coloured. `govAreaGeometry` is
 * where that lives, so the delta arithmetic and the sparkbar shape are asserted
 * rather than left to a reviewer's eye — including the trap that a green area
 * whose score rose is still a neutral delta, not a red one.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { trendGeometry } from "./DriftTrend";
import {
  GOV_AREA_LINKS,
  GOV_CLUSTERS,
  GOV_HERO,
  GOV_STATUS_META,
  govAreaGeometry,
  govTrendGeometry,
} from "./govDashboardData";

describe("Governance hero", () => {
  it("scores 62 with the design's own copy, three stats and their accents", () => {
    assert.equal(GOV_HERO.score, 62);
    assert.equal(GOV_HERO.delta, "-4 this month");
    assert.equal(GOV_HERO.title, "Governance Health");
    assert.equal(GOV_HERO.subtitle, "Governance pillar score from your latest scan");
    assert.equal(GOV_HERO.statusLabel, "Needs attention");
    // The history's last entry is the current score — the ring and sparkline agree.
    assert.equal(GOV_HERO.history[GOV_HERO.history.length - 1], GOV_HERO.score);
    // Copy is final: the three stat labels and their left-rule accents, in order.
    assert.deepEqual(
      GOV_HERO.stats.map((s) => s.label),
      ["Overdue Access Reviews", "Global Administrators", "Governance Findings"],
    );
    assert.deepEqual(
      GOV_HERO.stats.map((s) => s.accent),
      ["#14B8A6", "#3B82F6", "#8B5CF6"],
    );
  });

  it("binds its trend to its own falling history, drawn in blue", () => {
    // The page passes NO verdict on this pillar (unlike Security), and the trend
    // is drawn in the pillar's own blue — govTrendGeometry is just the binding.
    const bound = govTrendGeometry();
    const direct = trendGeometry(GOV_HERO.history);
    assert.equal(bound.line, direct.line);
    assert.equal(bound.lastX, 280);
  });
});

describe("Governance area cards", () => {
  it("covers every tile by exactly one cluster", () => {
    const clustered = GOV_CLUSTERS.flatMap((c) => GOV_AREA_LINKS.filter((a) => a.cluster === c));
    assert.equal(clustered.length, GOV_AREA_LINKS.length);
    assert.equal(GOV_AREA_LINKS.length, 14);
  });

  it("uses ITS OWN tier sizes, which are not Compliance's 24/19/16", () => {
    assert.equal(GOV_STATUS_META.red.tier, "large");
    assert.equal(GOV_STATUS_META.yellow.tier, "medium");
    assert.equal(GOV_STATUS_META.green.tier, "small");
    // Governance's score sizes are 26/20/17; the delta chip reads Math.max(label-1,9).
    assert.equal(govAreaGeometry(byKey("governance-oversharing")).meta.tier, "large");
  });

  it("colours the delta by direction, and treats green as neutral", () => {
    // Overshared SharePoint rose 3 → 5: more oversharing is BAD, on a red area.
    const worse = govAreaGeometry(byKey("governance-oversharing"));
    assert.equal(worse.deltaText, "+2");
    assert.equal(worse.deltaColor, "#f87171");
    // Channel Governance fell 15 → 12 on a yellow area: an improvement, so green.
    const better = govAreaGeometry(byKey("governance-channels"));
    assert.equal(better.deltaText, "-3");
    assert.equal(better.deltaColor, "#34d399");
    // Device Inventory rose 205 → 212 but the area is GREEN — a fully covered area
    // is muted rather than flagged, so its delta is slate even though it moved up.
    const green = govAreaGeometry(byKey("governance-device-inventory"));
    assert.equal(green.deltaText, "+7");
    assert.equal(green.deltaColor, "#64748b");
    // Group Ownership is unchanged at 26 and reads ±0 in slate.
    const flat = govAreaGeometry(byKey("governance-group-owners"));
    assert.equal(flat.deltaText, "±0");
    assert.equal(flat.deltaColor, "#64748b");
  });

  it("always draws four sparkbars, the last one at full opacity and none empty", () => {
    GOV_AREA_LINKS.forEach((a) => {
      const { sparkBars } = govAreaGeometry(a);
      assert.equal(sparkBars.length, 4);
      assert.equal(sparkBars[3].opacity, 1);
      assert.equal(sparkBars[0].opacity, 0.4);
      sparkBars.forEach((b) => assert.ok(b.height >= 3, `${a.key} has a zero-height bar`));
    });
  });
});

function byKey(k: string) {
  const a = GOV_AREA_LINKS.find((x) => x.key === k);
  assert.ok(a, `no governance tile keyed ${k}`);
  return a;
}
