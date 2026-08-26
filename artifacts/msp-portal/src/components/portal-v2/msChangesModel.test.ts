/**
 * msChangesModel.test.ts — pins the wave banding and the density arithmetic.
 *
 * The wave is the module's spine: it decides which columns light, which posts
 * list, and what the header counts. It is DERIVED from the bucket list rather
 * than declared, so a change to the buckets silently re-bands the whole page —
 * which is what these cases are here to catch.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  MSC_BUCKETS,
  MSC_DENSITY,
  MSC_ITEM_BUCKET,
  MS_POSTS,
} from "./msChangesData";
import {
  breakMeta,
  breakingInWave,
  bucketSums,
  bucketTotals,
  bucketWave,
  bucketsInWave,
  cellDots,
  cellTitle,
  clampWave,
  decideMeta,
  freezeInWave,
  groupStrip,
  impactTone,
  isFreezeBucket,
  nameInitials,
  pastWave,
  postsInWave,
  raciOwner,
  rangeOf,
  rowTotal,
  scoreTone,
  seenInWave,
  seenMeta,
  servicesLabel,
  waveBands,
  waveBreaks,
  waveCount,
  waveLabel,
  waveNotice,
  waveQueue,
  waveQuiet,
  waveStatus,
  waveTiles,
  waveTitle,
} from "./msChangesModel";

describe("waveBands", () => {
  it("merges adjacent buckets that share a wave name", () => {
    const bands = waveBands();
    assert.deepEqual(
      bands.map((b) => [b.wave, b.start, b.span]),
      [
        ["Late August wave", 0, 1],
        ["September wave", 1, 2],
        ["Q2 · Oct – Dec", 3, 3],
        ["Q3 · Jan – Mar", 6, 3],
        ["Q4 and beyond", 9, 2],
      ],
    );
  });

  it("covers every bucket exactly once", () => {
    const covered = waveBands().flatMap((b) => Array.from({ length: b.span }, (_, k) => b.start + k));
    assert.deepEqual(covered, MSC_BUCKETS.map((_, i) => i));
  });

  it("does NOT merge non-adjacent runs of the same name", () => {
    const bands = waveBands([{ wave: "A" }, { wave: "B" }, { wave: "A" }]);
    assert.equal(bands.length, 3);
  });
});

describe("bucketWave", () => {
  it("maps each bucket to its band", () => {
    assert.equal(bucketWave(0), 0);
    assert.equal(bucketWave(1), 1);
    assert.equal(bucketWave(2), 1);
    assert.equal(bucketWave(3), 2);
    assert.equal(bucketWave(10), 4);
  });
});

describe("clampWave", () => {
  it("defaults to the first wave when nothing is asked for", () => {
    assert.equal(clampWave(null), 0);
    assert.equal(clampWave(Number.NaN), 0);
  });

  it("clamps rather than throwing on an out-of-range request", () => {
    // The value arrives from the URL, so it is untrusted; indexing past the
    // band list would throw during render.
    assert.equal(clampWave(99), 4);
    assert.equal(clampWave(-3), 0);
  });

  it("passes a valid index straight through", () => {
    assert.equal(clampWave(2), 2);
  });
});

describe("bucketsInWave", () => {
  it("expands a band into its bucket indices", () => {
    assert.deepEqual(bucketsInWave(0), [0]);
    assert.deepEqual(bucketsInWave(1), [1, 2]);
    assert.deepEqual(bucketsInWave(2), [3, 4, 5]);
  });

  it("returns nothing for a band that does not exist", () => {
    assert.deepEqual(bucketsInWave(99), []);
  });
});

describe("density arithmetic", () => {
  it("sums the four kinds across all six workloads per bucket", () => {
    const totals = bucketTotals();
    assert.equal(totals.length, MSC_BUCKETS.length);
    // Bucket 0, column by column across the six seeded rows.
    assert.deepEqual(totals[0], [0, 1, 5, 29]);
  });

  it("counts the two breaking buckets the design draws in red", () => {
    const totals = bucketTotals();
    const breaking = totals.map((t, i) => [i, t[0]]).filter(([, b]) => b > 0);
    assert.deepEqual(breaking, [
      [2, 2],
      [4, 1],
    ]);
  });

  it("gives every row eleven cells, matching the axis", () => {
    for (const row of MSC_DENSITY) {
      assert.equal(row.cells.length, MSC_BUCKETS.length, `${row.wl} must have one cell per bucket`);
    }
  });

  it("totals a row across the whole axis", () => {
    const exchange = MSC_DENSITY.find((r) => r.wl === "Exchange");
    assert.ok(exchange);
    assert.equal(rowTotal(exchange), 72);
  });

  it("sums a wave from its buckets", () => {
    const sums = bucketSums();
    assert.equal(waveCount(0), sums[0]);
    assert.equal(waveCount(1), sums[1] + sums[2]);
  });
});

describe("wave headers", () => {
  it("abbreviates only a single-column band", () => {
    const bands = waveBands();
    // Late August spans one bucket -> short form.
    assert.equal(waveLabel(bands[0]), "Late Aug");
    // September spans two -> full name.
    assert.equal(waveLabel(bands[1]), "September wave");
    assert.equal(waveLabel(bands[2]), "Q2 · Oct – Dec");
  });

  it("states the wave and its count in the tooltip", () => {
    const bands = waveBands();
    assert.equal(waveTitle(bands[0], 35), "Late August wave · 35 changes");
  });
});

describe("freeze buckets", () => {
  it("marks the two the tenant's own freeze windows cover", () => {
    assert.equal(isFreezeBucket(2), true);
    assert.equal(isFreezeBucket(5), true);
    assert.equal(isFreezeBucket(0), false);
  });
});

describe("postsInWave", () => {
  it("reads the bucket map, NOT the post's own month index", () => {
    // MC1042318 is month 1 but bucket 2 — the two axes are different lengths,
    // so deriving one from the other would put it in the wrong column.
    const post = MS_POSTS.find((p) => p.id === "MC1042318");
    assert.ok(post);
    assert.equal(post.month, 1);
    assert.equal(MSC_ITEM_BUCKET["MC1042318"], 2);
    assert.ok(postsInWave(1).some((p) => p.id === "MC1042318"));
    assert.ok(!postsInWave(0).some((p) => p.id === "MC1042318"));
  });

  it("groups the three September-wave posts together", () => {
    assert.deepEqual(
      postsInWave(1).map((p) => p.id).sort(),
      ["MC1042318", "MC1049877", "MC1051144"],
    );
  });

  it("orders by bucket, then by descending impact within a bucket", () => {
    const ids = postsInWave(1).map((p) => p.id);
    // All three are bucket 2, so the order is score-descending: 92, 88, 74.
    const scores = ids.map((id) => MS_POSTS.find((p) => p.id === id)!.score);
    assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
  });

  it("returns nothing for a wave with no named posts", () => {
    // Bucket map has no entry inside the Late August band.
    assert.deepEqual(postsInWave(0), []);
  });
});

describe("breakingInWave", () => {
  it("counts a hard retirement AND a soft change that still hits people", () => {
    const ids = breakingInWave(1).map((p) => p.id).sort();
    // MC1042318 is hard; MC1049877 is not hard but its impact is "Hits you".
    const hard = MS_POSTS.find((p) => p.id === "MC1042318");
    const soft = MS_POSTS.find((p) => p.id === "MC1049877");
    assert.equal(hard?.hard, true);
    assert.equal(soft?.hard, false);
    assert.equal(soft?.impact, "Hits you");
    assert.ok(ids.includes("MC1042318"));
    assert.ok(ids.includes("MC1049877"));
  });
});

describe("cellDots", () => {
  it("draws one dot per item, breaking-first", () => {
    assert.deepEqual(cellDots([1, 1, 1, 2]), ["b", "d", "v", "s", "s"]);
  });

  it("draws nothing for an empty cell", () => {
    assert.deepEqual(cellDots([0, 0, 0, 0]), []);
  });
});

describe("cellTitle", () => {
  it("names the break when there is one", () => {
    assert.equal(
      cellTitle("Exchange Online & Apps", 2, [1, 1, 1, 8]),
      "Exchange Online & Apps · 21 Sep – 4 Oct · 11 items, one breaks something",
    );
  });

  it("falls back to the decision count when nothing breaks", () => {
    assert.equal(
      cellTitle("Microsoft Teams", 1, [0, 1, 1, 8]),
      "Microsoft Teams · 7 Sep – 20 Sep · 10 items, one breaks something".replace(
        ", one breaks something",
        ", 1 need a decision",
      ),
    );
  });

  it("says neither when a bucket is quiet", () => {
    assert.equal(cellTitle("Purview", 0, [0, 0, 0, 3]), "Purview · 24 Aug – 6 Sep · 3 items");
  });
});

/* ── Part 10: the wave page, retrospective, seen list and groups ─────────── */

describe("wave range and status", () => {
  it("reads a single-bucket, an open-dash and a multi-month range", () => {
    const bands = waveBands();
    assert.equal(rangeOf(bands[0]), "24 Aug – 6 Sep");
    assert.equal(rangeOf(bands[1]), "7 Sep – 4 Oct");
    assert.equal(rangeOf(bands[2]), "Oct – Dec 2026");
    assert.equal(rangeOf(bands[4]), "Apr – Sep 2027");
  });

  it("labels the status, falling back to the range past the list", () => {
    assert.equal(waveStatus(0), "Landing now");
    assert.equal(waveStatus(4), "From April 2027");
  });

  it("finds the tenant freeze a wave lands inside", () => {
    assert.deepEqual(freezeInWave(1), { i: 2, label: "Quarter close" });
    assert.deepEqual(freezeInWave(2), { i: 5, label: "Year end" });
    assert.equal(freezeInWave(0), null);
  });

  it("builds the notice bar, clamped between 4 and 96 percent", () => {
    assert.deepEqual(waveNotice(0), { given: 138, left: 4, pct: 4 });
    assert.equal(waveNotice(2).given, 150);
  });
});

describe("ownership and services", () => {
  it("reports an honest Unassigned owner — no tenant has a RACI table (Git #1342)", () => {
    // The fictional Halden roster was purged from MSC_RACI; every workload's
    // Responsible is now empty, so raciOwner degrades to the honest gap state.
    assert.deepEqual(raciOwner("Exchange"), { name: "Unassigned", initials: "—", accountable: "" });
    assert.equal(raciOwner("Copilot").name, "Unassigned");
  });

  it("initials a name from its leading capitals", () => {
    assert.equal(nameInitials("Priya Raman"), "PR");
    assert.equal(nameInitials("Marcus Lee"), "ML");
    // Only the first two capitalised tokens, so a "·"-joined role reads its first two.
    assert.equal(nameInitials("Comms · Jo Feltham"), "CJ");
  });

  it("counts the services still in use", () => {
    assert.equal(servicesLabel({}), "Services · 6 of 6");
    assert.equal(servicesLabel({ Teams: false, Copilot: false }), "Services · 4 of 6");
  });
});

describe("what stops working / decide / quiet", () => {
  it("names the three breaks in the September wave, with evidence and owner", () => {
    const breaks = waveBreaks(1, {});
    assert.deepEqual(breaks.map((b) => b.id).sort(), ["MC1042318", "MC1049877", "MC1051144"]);
    const basic = breaks.find((b) => b.id === "MC1042318")!;
    assert.equal(basic.owner, "Unassigned");
    assert.equal(basic.state, "CR-0142 · Awaiting approval");
    assert.equal(basic.hasCr, true);
    assert.equal(basic.evidence, "GET /reports/getEmailActivityUserDetail → 1,412 events across 11 accounts");
  });

  it("drops a break when its service is switched off", () => {
    assert.ok(!waveBreaks(1, { Exchange: false }).some((b) => b.id === "MC1042318"));
    assert.equal(waveBreaks(1, { Exchange: false }).length, 2);
  });

  it("queues the wave's decisions with an owner line", () => {
    const q = waveQueue(1, {});
    assert.deepEqual(q.map((x) => x.item.id).sort(), ["MC1042318", "MC1049877", "MC1051144"]);
    assert.equal(q.find((x) => x.item.id === "MC1049877")!.ownerLine, "Unassigned");
  });

  it("leaves the September wave with nothing quiet, since all three act", () => {
    assert.deepEqual(waveQuiet(1, {}), []);
  });

  it("writes the break and decide meta lines", () => {
    assert.equal(breakMeta(1, {}), "3 named, read against your own configuration");
    assert.equal(decideMeta(1, {}), "3 with a date after which it is decided for you");
  });
});

describe("the seen-in-the-wild list", () => {
  it("lists the two seen items landing in the September wave", () => {
    assert.deepEqual(seenInWave(1, {}).map((v) => v.id).sort(), ["MC1049877", "MC1059440"]);
  });

  it("drops a Teams seen item when Teams is off, keeping the OneDrive one", () => {
    const seen = seenInWave(1, { Teams: false });
    assert.deepEqual(seen.map((v) => v.id), ["MC1049877"]);
  });

  it("writes the seen meta against the wave's visible count", () => {
    assert.match(seenMeta(1, {}), /^2 of \d+ written up, with the announcement drafted$/);
  });
});

describe("wave tiles", () => {
  it("gives four tiles, singularising a label at one", () => {
    const tiles = waveTiles(1, {});
    assert.deepEqual(tiles.map((t) => t.key), ["changes", "breaks", "decide", "seen"]);
    // Force a single break by turning every service off but SharePoint's one hit.
    const one = waveTiles(1, { Exchange: false, Teams: false });
    assert.equal(one.find((t) => t.key === "breaks")!.label, "stops something working");
  });
});

describe("groups and the retrospective", () => {
  it("draws a per-bucket hit strip for a group", () => {
    const strip = groupStrip(["MC1042318", "MC1066402"]);
    assert.equal(strip.length, MSC_BUCKETS.length);
    assert.equal(strip[2], 1);
    assert.equal(strip[7], 1);
    assert.equal(strip[0], 0);
  });

  it("builds the past wave's tiles, pluralising against the numbers", () => {
    const past = pastWave(0)!;
    assert.equal(past.name, "August wave");
    assert.deepEqual(
      past.tiles.map((t) => [t.label, t.value]),
      [
        ["changes landed", "31"],
        ["dates Microsoft moved", "2"],
        ["tickets raised", "6"],
        ["incidents", "0"],
      ],
    );
    const july = pastWave(1)!;
    // July moved once and had one incident — both singularise, distinctly.
    assert.equal(july.tiles[1].label, "date Microsoft moved");
    assert.equal(july.tiles[3].label, "incident");
    assert.equal(pastWave(2), null);
  });
});

describe("tones", () => {
  it("maps impact and score to the design's three-step ramp", () => {
    assert.equal(impactTone("Hits you"), "#f87171");
    assert.equal(impactTone("Might hit you"), "#fbbf24");
    assert.equal(impactTone("No impact"), "#64748b");
    assert.equal(scoreTone(92), "#f87171");
    assert.equal(scoreTone(46), "#fbbf24");
    assert.equal(scoreTone(12), "#34d399");
  });
});
