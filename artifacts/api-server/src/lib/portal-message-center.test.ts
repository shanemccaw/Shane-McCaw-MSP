/**
 * portal-message-center.test.ts — the derivation behind the Customer Portal's
 * Microsoft Changes page.
 *
 * The route itself is a scoped SELECT and a call into this module, so the value
 * of a test lives here: the axis has to stay eleven buckets with a fixed
 * five-band shape whatever the clock says, every post has to land in exactly one
 * kind, and no post may be silently dropped from the totals.
 */

import { describe, it, expect } from "vitest";

import {
  buildBuckets,
  buildDensity,
  buildStats,
  bucketForDate,
  capPerWave,
  DATE_UNCLEAR,
  dateUnclearRows,
  effectiveDate,
  formatCountdown,
  formatScanAt,
  formatWhen,
  hasStructuralDate,
  htmlToText,
  impactForPost,
  kindForPost,
  kindLabel,
  placementForPost,
  scoreForPost,
  waveShort,
  workloadForPost,
  workloadForService,
  workloadFound,
  WORKLOAD_ORDER,
  type MessageCenterRow,
} from "./portal-message-center";

/** 20 August 2026 — the date the design's own fixture is written against. */
const NOW = new Date("2026-08-20T09:00:00.000Z");

function row(over: Partial<MessageCenterRow> = {}): MessageCenterRow {
  return {
    graphMessageId: "MC1000001",
    title: "A change",
    category: "stayInformed",
    isMajorChange: false,
    services: ["Microsoft Teams"],
    tags: [],
    bodyContent: "<p>Body</p>",
    startDateTime: new Date("2026-08-01T00:00:00.000Z"),
    endDateTime: new Date("2026-09-15T00:00:00.000Z"),
    actionRequiredByDateTime: null,
    lastModifiedDateTime: new Date("2026-08-10T00:00:00.000Z"),
    lastSeenAt: new Date("2026-08-21T00:45:00.000Z"),
    advisoryDateText: null,
    ...over,
  };
}

describe("workload folding", () => {
  it("folds Microsoft's real service names onto the design's rows", () => {
    expect(workloadForService("Exchange Online")).toBe("Exchange");
    expect(workloadForService("Microsoft Teams")).toBe("Teams");
    expect(workloadForService("SharePoint Online")).toBe("SharePoint");
    expect(workloadForService("Microsoft OneDrive")).toBe("SharePoint");
    expect(workloadForService("Microsoft Entra")).toBe("Entra");
    expect(workloadForService("Microsoft Purview")).toBe("Purview");
  });

  it("reaches Copilot before the Microsoft 365 residual claims it", () => {
    // "Microsoft 365 Copilot Chat" contains both tokens; matcher order decides.
    expect(workloadForService("Microsoft 365 Copilot Chat")).toBe("Copilot");
    expect(workloadForService("Microsoft 365 apps")).toBe("M365");
  });

  it("sends genuinely unmapped services to the residual row rather than dropping them", () => {
    expect(workloadForService("Dynamics 365 Apps")).toBe("M365");
    expect(workloadForService("Microsoft Defender XDR")).toBe("M365");
    expect(workloadForService("Power BI")).toBe("M365");
  });

  it("takes the first NAMED row when Microsoft lists several services", () => {
    expect(workloadForPost(["Microsoft 365 suite", "Microsoft Teams"])).toBe("Teams");
    expect(workloadForPost(["Microsoft 365 suite", "Power BI"])).toBe("M365");
    expect(workloadForPost([])).toBe("M365");
  });
});

describe("kind classification", () => {
  it("reads preventOrFixIssue and Retirement as breaking", () => {
    expect(kindForPost(row({ category: "preventOrFixIssue" }))).toBe("b");
    expect(kindForPost(row({ category: "stayInformed", tags: ["Retirement"] }))).toBe("b");
  });

  it("reads a plan-for-change post with a published deadline as a decision", () => {
    expect(
      kindForPost(row({ category: "planForChange", actionRequiredByDateTime: new Date("2026-10-01T00:00:00.000Z") })),
    ).toBe("d");
  });

  it("reads a major plan-for-change with admin impact as a decision", () => {
    expect(kindForPost(row({ category: "planForChange", isMajorChange: true, tags: ["Admin impact"] }))).toBe("d");
  });

  it("reads Microsoft's own User impact tag as user-visible", () => {
    expect(kindForPost(row({ category: "stayInformed", tags: ["User impact"] }))).toBe("v");
  });

  it("falls through to silent, which is most of the corpus", () => {
    expect(kindForPost(row({ category: "stayInformed", tags: ["New feature"] }))).toBe("s");
  });

  it("assigns exactly one kind — the ladder never returns two", () => {
    // preventOrFixIssue AND User impact AND a deadline: breaking wins outright.
    const r = row({
      category: "preventOrFixIssue",
      tags: ["User impact", "Admin impact"],
      actionRequiredByDateTime: new Date("2026-09-01T00:00:00.000Z"),
      isMajorChange: true,
    });
    expect(kindForPost(r)).toBe("b");
  });

  it("prefers Microsoft's tag over its category for the readable label", () => {
    expect(kindLabel(row({ category: "preventOrFixIssue", tags: ["Retirement"] }))).toBe("Retirement");
    expect(kindLabel(row({ category: "preventOrFixIssue", tags: ["Admin impact"] }))).toBe("Action required");
    expect(kindLabel(row({ category: "planForChange", tags: [] }))).toBe("Plan for change");
    expect(kindLabel(row({ category: "stayInformed", tags: [] }))).toBe("Stay informed");
  });
});

describe("the time axis", () => {
  const buckets = buildBuckets(NOW);

  it("is eleven buckets: three fortnights, six months, two quarters", () => {
    expect(buckets).toHaveLength(11);
    for (let i = 0; i < 3; i++) {
      const span = Date.parse(buckets[i].to) - Date.parse(buckets[i].from);
      expect(span).toBe(14 * 86_400_000);
    }
    expect(buckets[3].label).toBe("Oct");
    expect(buckets[8].label).toBe("Mar");
    expect(buckets[9].label).toContain("–");
  });

  it("keeps the fixed five-band shape the wave URLs depend on", () => {
    // WAVE_SLUGS is positional in the page; a sixth band would break every
    // bookmarked /portal-v2/ms-changes/<wave> URL.
    const bands: string[] = [];
    for (const b of buckets) if (bands[bands.length - 1] !== b.wave) bands.push(b.wave);
    expect(bands).toHaveLength(5);
    const spans = bands.map((w) => buckets.filter((b) => b.wave === w).length);
    expect(spans).toEqual([1, 2, 3, 3, 2]);
  });

  it("reproduces the design's own wave names when run on the design's date", () => {
    const bands: string[] = [];
    for (const b of buckets) if (bands[bands.length - 1] !== b.wave) bands.push(b.wave);
    expect(bands[0]).toBe("Late August wave");
    expect(bands[1]).toBe("September wave");
    expect(bands[2]).toBe("Q2 · Oct – Dec");
    expect(bands[3]).toBe("Q3 · Jan – Mar");
    expect(bands[4]).toBe("Q4 and beyond");
  });

  it("leaves no gap and no overlap between adjacent buckets", () => {
    for (let i = 1; i < buckets.length; i++) {
      expect(buckets[i].from).toBe(buckets[i - 1].to);
    }
  });

  it("abbreviates the single-bucket band for its narrow header", () => {
    expect(waveShort(buckets)[buckets[0].wave]).toBe("Late Aug");
    expect(waveShort(buckets)[buckets[9].wave]).toBe("Q4 +");
  });

  it("still yields eleven buckets and five bands on an unrelated date", () => {
    const b2 = buildBuckets(new Date("2027-03-02T23:30:00.000Z"));
    expect(b2).toHaveLength(11);
    const bands: string[] = [];
    for (const b of b2) if (bands[bands.length - 1] !== b.wave) bands.push(b.wave);
    expect(bands).toHaveLength(5);
    expect(bands[0]).toBe("Early March wave");
  });

  it("places a date in exactly one bucket, and past dates in none", () => {
    expect(bucketForDate(new Date("2026-08-25T00:00:00.000Z"), buckets)).toBe(0);
    expect(bucketForDate(new Date("2026-09-10T00:00:00.000Z"), buckets)).toBe(1);
    expect(bucketForDate(new Date("2026-10-15T00:00:00.000Z"), buckets)).toBe(3);
    // Before the axis starts — a rollout that already completed.
    expect(bucketForDate(new Date("2026-06-01T00:00:00.000Z"), buckets)).toBe(-1);
  });

  it("lets the final bucket swallow everything announced beyond the axis", () => {
    // The live corpus really does hold a 2037 post; it must land somewhere.
    expect(bucketForDate(new Date("2037-03-01T00:00:00.000Z"), buckets)).toBe(10);
    expect(bucketForDate(new Date("2028-10-01T00:00:00.000Z"), buckets)).toBe(10);
  });
});

describe("effective date", () => {
  it("prefers the published deadline, then rollout end, then publication", () => {
    const deadline = new Date("2026-10-01T00:00:00.000Z");
    expect(effectiveDate(row({ actionRequiredByDateTime: deadline }))).toBe(deadline);

    const end = new Date("2026-09-15T00:00:00.000Z");
    expect(effectiveDate(row({ actionRequiredByDateTime: null, endDateTime: end }))).toBe(end);

    const start = new Date("2026-08-01T00:00:00.000Z");
    expect(effectiveDate(row({ actionRequiredByDateTime: null, endDateTime: null, startDateTime: start }))).toBe(start);
  });

  it("always returns a date — lastModifiedDateTime is not nullable", () => {
    const lm = new Date("2026-08-10T00:00:00.000Z");
    const r = row({ actionRequiredByDateTime: null, endDateTime: null, startDateTime: null, lastModifiedDateTime: lm });
    expect(effectiveDate(r)).toBe(lm);
  });
});

describe("#1536 — date confidence and the date-unclear bucket", () => {
  const buckets = buildBuckets(NOW);

  it("has a structural date once either actionRequiredByDateTime or endDateTime is set", () => {
    expect(hasStructuralDate(row({ actionRequiredByDateTime: new Date("2026-10-01T00:00:00.000Z"), endDateTime: null }))).toBe(true);
    expect(hasStructuralDate(row({ actionRequiredByDateTime: null, endDateTime: new Date("2026-10-01T00:00:00.000Z") }))).toBe(true);
  });

  it("does NOT count startDateTime alone as a structural date — publish date is not a landing date", () => {
    const r = row({ actionRequiredByDateTime: null, endDateTime: null, startDateTime: new Date("2026-08-01T00:00:00.000Z") });
    expect(hasStructuralDate(r)).toBe(false);
  });

  it("placementForPost returns DATE_UNCLEAR for a post with no structural date, never a fallback bucket", () => {
    const r = row({ actionRequiredByDateTime: null, endDateTime: null, startDateTime: new Date("2026-08-01T00:00:00.000Z") });
    expect(placementForPost(r, buckets)).toBe(DATE_UNCLEAR);
  });

  it("placementForPost matches bucketForDate(effectiveDate()) once a structural date exists", () => {
    const r = row({ endDateTime: new Date("2026-08-25T00:00:00.000Z") });
    expect(placementForPost(r, buckets)).toBe(bucketForDate(effectiveDate(r), buckets));
  });

  it("DATE_UNCLEAR and the behind-the-axis -1 are both < 0 but are distinct values", () => {
    expect(DATE_UNCLEAR).toBeLessThan(0);
    expect(DATE_UNCLEAR).not.toBe(-1);
  });

  it("dateUnclearRows collects only posts with no structural date, most-recently-modified first", () => {
    const clear = row({ graphMessageId: "CLEAR", endDateTime: new Date("2026-08-25T00:00:00.000Z") });
    const unclearOld = row({
      graphMessageId: "UNCLEAR-OLD",
      actionRequiredByDateTime: null,
      endDateTime: null,
      lastModifiedDateTime: new Date("2026-08-01T00:00:00.000Z"),
    });
    const unclearNew = row({
      graphMessageId: "UNCLEAR-NEW",
      actionRequiredByDateTime: null,
      endDateTime: null,
      lastModifiedDateTime: new Date("2026-08-15T00:00:00.000Z"),
    });
    const result = dateUnclearRows([clear, unclearOld, unclearNew]);
    expect(result.map((r) => r.graphMessageId)).toEqual(["UNCLEAR-NEW", "UNCLEAR-OLD"]);
  });

  it("buildDensity and buildStats exclude date-unclear posts from the dated grid, not just before-axis ones", () => {
    const unclear = row({
      graphMessageId: "UNCLEAR",
      actionRequiredByDateTime: null,
      endDateTime: null,
      startDateTime: new Date("2026-08-01T00:00:00.000Z"),
    });
    const density = buildDensity([unclear], buckets);
    expect(density).toEqual([]);
    const stats = buildStats([unclear], buckets, NOW);
    const byKey = Object.fromEntries(stats.map((s) => [s.key, Number(s.value)]));
    expect(byKey.decisions + byKey.hits + byKey.seen + byKey.none).toBe(0);
  });
});

describe("density", () => {
  const buckets = buildBuckets(NOW);

  it("counts every on-axis post exactly once, across all rows and cells", () => {
    const rows = [
      row({ graphMessageId: "A", services: ["Microsoft Teams"], endDateTime: new Date("2026-08-25T00:00:00.000Z") }),
      row({ graphMessageId: "B", services: ["Exchange Online"], endDateTime: new Date("2026-09-10T00:00:00.000Z"), category: "preventOrFixIssue" }),
      row({ graphMessageId: "C", services: ["Power BI"], endDateTime: new Date("2026-10-15T00:00:00.000Z"), tags: ["User impact"] }),
      row({ graphMessageId: "D", services: ["Microsoft Purview"], endDateTime: new Date("2027-02-01T00:00:00.000Z") }),
    ];
    const density = buildDensity(rows, buckets);
    const total = density.reduce((a, r) => a + r.cells.reduce((b, c) => b + c[0] + c[1] + c[2] + c[3], 0), 0);
    expect(total).toBe(4);
  });

  it("drops posts whose date is behind the axis rather than pinning them to bucket 0", () => {
    const rows = [
      row({ graphMessageId: "OLD", endDateTime: new Date("2026-05-01T00:00:00.000Z") }),
      row({ graphMessageId: "NEW", endDateTime: new Date("2026-08-25T00:00:00.000Z") }),
    ];
    const density = buildDensity(rows, buckets);
    const total = density.reduce((a, r) => a + r.cells.reduce((b, c) => b + c[0] + c[1] + c[2] + c[3], 0), 0);
    expect(total).toBe(1);
  });

  it("emits a row only for workloads Microsoft actually posted about", () => {
    const density = buildDensity([row({ services: ["Microsoft Teams"] })], buckets);
    expect(density.map((d) => d.wl)).toEqual(["Teams"]);
  });

  it("keeps rows in the design's workload order", () => {
    const rows = WORKLOAD_ORDER.map((wl, i) =>
      row({
        graphMessageId: `MC${i}`,
        services: [{ Exchange: "Exchange Online", Teams: "Microsoft Teams", SharePoint: "SharePoint Online", Entra: "Microsoft Entra", Purview: "Microsoft Purview", Copilot: "Microsoft 365 Copilot Chat", M365: "Power BI" }[wl]],
        endDateTime: new Date("2026-08-25T00:00:00.000Z"),
      }),
    );
    expect(buildDensity(rows, buckets).map((d) => d.wl)).toEqual([...WORKLOAD_ORDER]);
  });

  it("gives every row one cell per bucket", () => {
    const density = buildDensity([row()], buckets);
    expect(density[0].cells).toHaveLength(buckets.length);
  });
});

describe("stats", () => {
  const buckets = buildBuckets(NOW);

  it("partitions the on-axis corpus — the four kind counts sum to it", () => {
    const rows = [
      row({ graphMessageId: "A", category: "preventOrFixIssue", endDateTime: new Date("2026-08-25T00:00:00.000Z") }),
      row({ graphMessageId: "B", category: "planForChange", actionRequiredByDateTime: new Date("2026-09-05T00:00:00.000Z") }),
      row({ graphMessageId: "C", tags: ["User impact"], endDateTime: new Date("2026-10-10T00:00:00.000Z") }),
      row({ graphMessageId: "D", endDateTime: new Date("2026-11-10T00:00:00.000Z") }),
      row({ graphMessageId: "E", endDateTime: new Date("2026-05-10T00:00:00.000Z") }), // off-axis
    ];
    const stats = buildStats(rows, buckets, NOW);
    const byKey = Object.fromEntries(stats.map((s) => [s.key, Number(s.value)]));
    expect(byKey.hits + byKey.decisions + byKey.seen + byKey.none).toBe(4);
  });

  it("counts an edited post from either the tag or a moved lastModified", () => {
    const rows = [
      row({ graphMessageId: "A", tags: ["Updated message"], endDateTime: new Date("2026-08-25T00:00:00.000Z") }),
      row({
        graphMessageId: "B",
        tags: [],
        startDateTime: new Date("2026-08-01T00:00:00.000Z"),
        lastModifiedDateTime: new Date("2026-08-12T00:00:00.000Z"),
        endDateTime: new Date("2026-08-26T00:00:00.000Z"),
      }),
      row({
        graphMessageId: "C",
        tags: [],
        startDateTime: new Date("2026-08-01T00:00:00.000Z"),
        lastModifiedDateTime: new Date("2026-08-01T00:30:00.000Z"),
        endDateTime: new Date("2026-08-27T00:00:00.000Z"),
      }),
    ];
    const edited = Number(buildStats(rows, buckets, NOW).find((s) => s.key === "reversed")!.value);
    expect(edited).toBe(2);
  });

  it("emits the six cards the page draws, all with real string values", () => {
    const stats = buildStats([row()], buckets, NOW);
    expect(stats.map((s) => s.key)).toEqual(["decisions", "hits", "soon", "reversed", "seen", "none"]);
    for (const s of stats) expect(s.value).toMatch(/^\d+$/);
  });
});

describe("post shaping helpers", () => {
  it("flattens Microsoft's HTML to readable text", () => {
    const html = "<p>[What and Why:]</p><p>Devices must be updated to <strong>1.0.9107</strong> or later.&nbsp;</p>";
    expect(htmlToText(html)).toBe("[What and Why:]\nDevices must be updated to 1.0.9107 or later.");
  });

  it("decodes the entities that appear in real posts", () => {
    expect(htmlToText("<p>Word &amp; Excel &lt;tags&gt; &quot;quoted&quot;</p>")).toBe('Word & Excel <tags> "quoted"');
  });

  it("survives a post with no body", () => {
    expect(htmlToText("")).toBe("");
  });

  it("formats the landing date the way the design does", () => {
    expect(formatWhen(new Date("2026-10-01T00:00:00.000Z"))).toBe("1 October 2026");
  });

  it("counts down in the unit that reads naturally at that distance", () => {
    expect(formatCountdown(new Date("2026-08-20T18:00:00.000Z"), NOW)).toBe("today");
    expect(formatCountdown(new Date("2026-08-21T09:00:00.000Z"), NOW)).toBe("in 1 day");
    expect(formatCountdown(new Date("2026-08-27T09:00:00.000Z"), NOW)).toBe("in 7 days");
    expect(formatCountdown(new Date("2026-10-01T09:00:00.000Z"), NOW)).toBe("in 6 weeks");
    expect(formatCountdown(new Date("2027-02-01T09:00:00.000Z"), NOW)).toBe("in 5 months");
    expect(formatCountdown(new Date("2026-08-06T09:00:00.000Z"), NOW)).toBe("2 weeks ago");
  });

  it("formats the sync time in the design's scan-time form", () => {
    expect(formatScanAt(new Date("2026-08-21T00:45:28.860Z"))).toBe("21 August, 00:45");
  });

  it("maps impact off the same ladder as the kind, so the two never disagree", () => {
    expect(impactForPost(row({ category: "preventOrFixIssue" }))).toBe("Hits you");
    expect(impactForPost(row({ category: "planForChange", actionRequiredByDateTime: new Date("2026-10-01T00:00:00.000Z") }))).toBe("Might hit you");
    expect(impactForPost(row({ category: "stayInformed", tags: ["User impact"] }))).toBe("No impact");
  });

  it("scores within 0-100 and ranks a near breaking change above a distant quiet one", () => {
    const urgent = scoreForPost(
      row({ category: "preventOrFixIssue", isMajorChange: true, actionRequiredByDateTime: new Date("2026-09-01T00:00:00.000Z") }),
      NOW,
    );
    const quiet = scoreForPost(row({ category: "stayInformed", endDateTime: new Date("2027-06-01T00:00:00.000Z") }), NOW);
    expect(urgent).toBeGreaterThan(quiet);
    for (const s of [urgent, quiet]) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(100);
    }
  });
});

describe("the workload filter line", () => {
  const buckets = buildBuckets(NOW);

  it("reports what the Message Center holds, not a configuration scan", () => {
    const rows = [
      row({ graphMessageId: "A", services: ["Microsoft Teams"], category: "preventOrFixIssue", endDateTime: new Date("2026-08-25T00:00:00.000Z") }),
      row({ graphMessageId: "B", services: ["Microsoft Teams"], endDateTime: new Date("2026-09-25T00:00:00.000Z") }),
    ];
    expect(workloadFound(rows, "Teams", buckets)).toBe("2 Microsoft posts ahead · 1 act-now, 0 needing a decision");
  });

  it("says so plainly when a workload has nothing ahead", () => {
    expect(workloadFound([], "Copilot", buckets)).toBe("No posts on the next twelve months");
  });

  it("singularises a lone post", () => {
    const rows = [row({ services: ["Microsoft Purview"], endDateTime: new Date("2026-08-25T00:00:00.000Z") })];
    expect(workloadFound(rows, "Purview", buckets)).toContain("1 Microsoft post ahead");
  });
});

describe("the post budget is spent per wave, not as one global cap", () => {
  const buckets = buildBuckets(NOW);

  /** One post per bucket, repeated `n` times, in the route's own emit order. */
  const spread = (n: number) =>
    buckets.flatMap((_, bucket) => Array.from({ length: n }, (_, i) => ({ bucket, id: `b${bucket}-${i}` })));

  it("keeps posts for EVERY wave, which a flat top-N did not", () => {
    // The real regression: 449 on-axis posts and a flat top-240 filled up
    // inside the first four buckets, leaving Q3 and Q4 with nothing.
    const capped = capPerWave(spread(40), buckets, 60);
    const wavesIn = new Set(buckets.map((b) => b.wave));
    const wavesOut = new Set(capped.map((p) => buckets[p.bucket].wave));
    expect(wavesOut.size).toBe(wavesIn.size);
    for (const w of wavesIn) expect(wavesOut.has(w)).toBe(true);
  });

  it("holds each wave to its own budget", () => {
    const capped = capPerWave(spread(40), buckets, 60);
    const perWave = new Map<string, number>();
    for (const p of capped) {
      const w = buckets[p.bucket].wave;
      perWave.set(w, (perWave.get(w) ?? 0) + 1);
    }
    for (const n of perWave.values()) expect(n).toBeLessThanOrEqual(60);
  });

  it("keeps the earliest, highest-scoring posts of a wave — the head of its own order", () => {
    const capped = capPerWave(spread(40), buckets, 60);
    const q4 = capped.filter((p) => buckets[p.bucket].wave === "Q4 and beyond");
    // Two buckets make up that wave at 40 each; the budget takes bucket 9 whole
    // and the first 20 of bucket 10, never a tail-first sample.
    expect(q4[0].id).toBe("b9-0");
    expect(q4.length).toBe(60);
  });

  it("passes everything through when the corpus is under budget", () => {
    const few = spread(1);
    expect(capPerWave(few, buckets, 60).length).toBe(few.length);
  });

  it("drops a post whose bucket is off the axis rather than counting it against a wave", () => {
    const off = [{ bucket: -1, id: "past" }, { bucket: 999, id: "far" }, { bucket: 0, id: "ok" }];
    const capped = capPerWave(off, buckets, 60);
    expect(capped.map((p) => p.id)).toEqual(["ok"]);
  });
});
