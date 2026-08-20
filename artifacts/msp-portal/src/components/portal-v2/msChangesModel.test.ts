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
  breakingInWave,
  bucketSums,
  bucketTotals,
  bucketWave,
  bucketsInWave,
  cellDots,
  cellTitle,
  clampWave,
  isFreezeBucket,
  postsInWave,
  rowTotal,
  waveBands,
  waveCount,
  waveLabel,
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
