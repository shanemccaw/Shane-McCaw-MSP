/**
 * journeyModel.test.ts — the mapping from real payloads to the four screens.
 *
 * The properties worth pinning here are all honesty properties: an uncovered
 * pillar must stay `null` rather than becoming a red 0, an expected-but-absent
 * document must render as pending rather than vanish, and no pillar may acquire
 * a sparkline the platform cannot back with real history.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildGeneration,
  buildJourneyView,
  buildPillarViews,
  formatJourneyDate,
  gapSentence,
  pillarTrend,
  remediatedScore,
  scoredPillarCount,
  tenantStrip,
  verdictLabel,
  verdictSentence,
  type WireAssessmentStatus,
  type WirePillarStatsPayload,
} from "./journeyModel.ts";
import { PILLAR_KEYS, severityForScore, severityColor } from "./journeyTokens.ts";

const TENANT = { name: "Halden Materials", seatCount: 1240, scannedOn: "3 August 2026" };

describe("pillar views", () => {
  it("returns all six pillars in fixed order even from an empty payload", () => {
    const views = buildPillarViews(null);
    assert.deepEqual(
      views.map((v) => v.key),
      [...PILLAR_KEYS],
    );
    views.forEach((v) => {
      assert.equal(v.score, null);
      assert.equal(v.headline, null);
      assert.deepEqual(v.chips, []);
    });
  });

  it("keeps an uncovered pillar null rather than scoring it 0", () => {
    const payload: WirePillarStatsPayload = {
      pillars: [
        { pillar: "governance", score: null, stats: [], findings: [] },
        { pillar: "security", score: 38, stats: [], findings: [] },
      ],
    };
    const views = buildPillarViews(payload);
    assert.equal(views.find((v) => v.key === "governance")?.score, null);
    assert.equal(views.find((v) => v.key === "security")?.score, 38);
  });

  it("leads with a critical finding even when a warning came first on the wire", () => {
    const payload: WirePillarStatsPayload = {
      pillars: [
        {
          pillar: "security",
          score: 38,
          findings: [
            { severity: "warning", checkKey: "identity:guests", title: "31 dormant guest accounts" },
            { severity: "critical", checkKey: "identity:mfa", title: "14 accounts have no MFA" },
          ],
        },
      ],
    };
    const view = buildPillarViews(payload)[1];
    assert.equal(view.headline, "14 accounts have no MFA");
    assert.equal(view.satelliteFinding, "14 accounts have no MFA");
  });

  it("builds radar chips from real stat readouts, formatted per unit", () => {
    const payload: WirePillarStatsPayload = {
      pillars: [
        {
          pillar: "licensing",
          score: 57,
          stats: [
            { id: "a", label: "Unassigned spend", unit: "currency", value: 1840000, checkKey: "c" },
            { id: "b", label: "seats need E5", unit: "count", value: 96, checkKey: "c" },
            { id: "c", label: "Dormant", unit: "percent", value: 31, checkKey: "c" },
          ],
        },
      ],
    };
    const view = buildPillarViews(payload).find((v) => v.key === "licensing");
    assert.deepEqual(view?.chips, ["Unassigned spend $18,400", "96 seats need e5", "Dormant 31%"]);
  });

  it("skips a stat the scan could not evaluate rather than printing a zero", () => {
    const payload: WirePillarStatsPayload = {
      pillars: [
        {
          pillar: "adoption",
          score: 46,
          stats: [
            { id: "a", label: "Dormant users", unit: "count", value: 412, checkKey: "c" },
            { id: "b", label: "Never", unit: "count", value: null, checkKey: null },
            {
              id: "c",
              label: "Blocked",
              unit: "count",
              value: 5,
              unavailableReason: "license_gap",
              checkKey: "c",
            },
          ],
        },
      ],
    };
    const chips = buildPillarViews(payload).find((v) => v.key === "adoption")?.chips;
    assert.deepEqual(chips, ["412 dormant users"]);
  });

  it("falls back to finding titles when every stat is unavailable", () => {
    const payload: WirePillarStatsPayload = {
      pillars: [
        {
          pillar: "health",
          score: 44,
          stats: [{ id: "a", label: "Drift", unit: "count", value: null, checkKey: null }],
          findings: [{ severity: "warning", checkKey: "k", title: "37 unreviewed changes" }],
        },
      ],
    };
    assert.deepEqual(
      buildPillarViews(payload).find((v) => v.key === "health")?.chips,
      ["37 unreviewed changes"],
    );
  });

  it("caps the radar at three chips per wedge", () => {
    const payload: WirePillarStatsPayload = {
      pillars: [
        {
          pillar: "governance",
          score: 34,
          stats: Array.from({ length: 6 }, (_, i) => ({
            id: `s${i}`,
            label: "sites",
            unit: "count" as const,
            value: i + 1,
            checkKey: "k",
          })),
        },
      ],
    };
    assert.equal(buildPillarViews(payload)[0].chips.length, 3);
  });

  it("carries the real finding counts through", () => {
    const payload: WirePillarStatsPayload = {
      pillars: [
        { pillar: "compliance", score: 29, findingCounts: { critical: 2, warning: 4 } },
      ],
    };
    const v = buildPillarViews(payload).find((p) => p.key === "compliance");
    assert.equal(v?.criticalCount, 2);
    assert.equal(v?.warningCount, 4);
  });
});

describe("sparkline history", () => {
  it("is null for every pillar — the codebase check found no per-pillar series", () => {
    // tenant_engine_snapshots is keyed by ENGINE, not pillar, and
    // resolveMetricHistory rejects every key outside SNAPSHOT_ENGINE_KEYS.
    // Synthesising one would be a fabricated statistic wearing a chart's
    // credibility, so the honest render is nothing at all.
    PILLAR_KEYS.forEach((k) => assert.equal(pillarTrend(k), null));
  });

  it("means no pillar view ships a trend", () => {
    buildPillarViews(null).forEach((v) => assert.equal(v.trend, null));
  });
});

describe("document generation", () => {
  const expected = [
    { docType: "exec", title: "Executive Summary" },
    { docType: "full", title: "Full Readiness Report" },
    { docType: "sec", title: "Security Posture Report" },
  ];

  it("renders the expected spine so the list does not grow as it runs", () => {
    const status: WireAssessmentStatus = {
      documents: {
        expected,
        items: [{ id: 1, docType: "exec", title: "Executive Summary", status: "delivered" }],
      },
    };
    const g = buildGeneration(status);
    assert.equal(g.total, 3);
    assert.equal(g.ready, 1);
    assert.equal(g.allReady, false);
    assert.deepEqual(
      g.documents.map((d) => d.status),
      ["ready", "pending", "pending"],
    );
  });

  it("joins on docType, not on title — the two titles come from different columns", () => {
    // `expected[].title` is admin free text on the service; `items[].title` is
    // the document_types label. A title-keyed join would leave this pending
    // forever and the Executive Summary CTA would never appear.
    const status: WireAssessmentStatus = {
      documents: {
        expected: [{ docType: "exec", title: "Executive Summary" }],
        items: [
          { id: 9, docType: "exec", title: "Executive Summary — Copilot Readiness", status: "delivered" },
        ],
      },
    };
    const g = buildGeneration(status);
    assert.equal(g.documents[0].status, "ready");
    assert.equal(g.documents[0].id, 9);
    assert.equal(
      g.documents[0].title,
      "Executive Summary — Copilot Readiness",
      "the generated row's own title wins, so the switcher matches the report header",
    );
    assert.equal(g.allReady, true);
  });

  it("treats approved and delivered as ready, everything else as generating", () => {
    const status: WireAssessmentStatus = {
      documents: {
        expected,
        items: [
          { id: 1, docType: "exec", title: "Executive Summary", status: "approved" },
          { id: 2, docType: "full", title: "Full Readiness Report", status: "draft" },
          { id: 3, docType: "sec", title: "Security Posture Report", status: "failed" },
        ],
      },
    };
    const g = buildGeneration(status);
    assert.deepEqual(
      g.documents.map((d) => d.status),
      ["ready", "generating", "failed"],
    );
    assert.equal(g.ready, 1);
  });

  it("carries the real document id so a ready report can be opened", () => {
    const status: WireAssessmentStatus = {
      documents: {
        expected,
        items: [{ id: 77, docType: "exec", title: "Executive Summary", status: "delivered" }],
      },
    };
    const g = buildGeneration(status);
    assert.equal(g.documents[0].id, 77);
    assert.equal(g.documents[1].id, null);
  });

  it("NEVER falls back to the design's nine titles — it reports nothing instead", () => {
    // `expected` is empty on a status fetch failure and on any tenant without an
    // assessment service row. A fallback list would print three deliverable
    // names (Compliance Framework Mapping, Drift & Change History, Cyber
    // Insurance Readiness) that no seeded document_type produces — a fabricated
    // deliverable on a live, un-badged render.
    const g = buildGeneration({});
    assert.equal(g.total, 0);
    assert.equal(g.ready, 0);
    assert.equal(g.allReady, false);
    assert.deepEqual(g.documents, []);
  });

  it("uses the generated rows as the spine when nothing declared an expected set", () => {
    const g = buildGeneration({
      documents: {
        items: [{ id: 4, docType: "exec", title: "Executive Summary", status: "draft" }],
      },
    });
    assert.equal(g.total, 1);
    assert.equal(g.documents[0].status, "generating");
  });

  it("is only allReady when the whole set has landed", () => {
    const all: WireAssessmentStatus = {
      documents: {
        expected,
        items: expected.map((e, i) => ({
          id: i + 1,
          docType: e.docType,
          title: e.title,
          status: "delivered",
        })),
      },
    };
    assert.equal(buildGeneration(all).allReady, true);
  });
});

describe("remediated score", () => {
  it("averages only the pillars that have a real score", () => {
    const pillars = buildPillarViews({
      pillars: [
        { pillar: "governance", score: 34 },
        { pillar: "security", score: 38 },
      ],
    });
    // The other four are null and must not be counted as zero.
    assert.equal(remediatedScore(pillars, { governance: 61, security: 72 }), 67);
  });

  it("is null when nothing is scored", () => {
    assert.equal(remediatedScore(buildPillarViews(null), {}), null);
  });

  it("holds a pillar at today's score when no projection is supplied", () => {
    const pillars = buildPillarViews({ pillars: [{ pillar: "health", score: 44 }] });
    assert.equal(remediatedScore(pillars, {}), 44);
  });
});

describe("journey view", () => {
  it("takes the readiness headline from the platform's own overall score", () => {
    const view = buildJourneyView({
      tenant: TENANT,
      pillarStats: { pillars: [{ pillar: "governance", score: 34 }] },
      status: { copilotReadiness: { overall: { score: 41 } } },
      projectedByPillar: { governance: 61 },
    });
    assert.equal(view.readinessScore, 41);
    assert.equal(view.remediatedScore, 61);
    assert.equal(view.isPreview, false);
  });

  it("leaves the headline null when no indicator is covered", () => {
    const view = buildJourneyView({
      tenant: TENANT,
      pillarStats: null,
      status: { copilotReadiness: { overall: { score: null } } },
    });
    assert.equal(view.readinessScore, null);
  });

  it("survives a completely absent status payload without inventing a document set", () => {
    const view = buildJourneyView({ tenant: TENANT, pillarStats: null, status: null });
    assert.equal(view.readinessScore, null);
    assert.equal(view.generation.total, 0);
    assert.equal(view.pillars.length, 6);
  });
});

describe("copy that depends on the numbers", () => {
  it("switches the verdict at the healthy threshold", () => {
    assert.equal(verdictLabel(41), "Not flight-ready");
    assert.equal(verdictLabel(59), "Not flight-ready");
    assert.equal(verdictLabel(60), "Cleared for rollout");
  });

  it("writes the verdict sentence in Shane's voice", () => {
    assert.equal(
      verdictSentence("Halden Materials", 41),
      "Halden Materials is not flight-ready for Copilot. Here is exactly why — and what it takes to get there.",
    );
  });

  it("states the gap in points", () => {
    assert.match(gapSentence("Halden Materials", 41, 68, 6) ?? "", /27 points from flight-ready/);
  });

  it("counts the findings it actually has, not the design's six", () => {
    // The sentence's rhetorical job is that the number in front of you is those
    // findings added up. Quoting six when four contributed breaks that claim.
    assert.match(gapSentence("X", 41, 68, 6) ?? "", /^Six findings, one number\./);
    assert.match(gapSentence("X", 41, 68, 4) ?? "", /^Four findings, one number\./);
    assert.doesNotMatch(gapSentence("X", 41, 68, 4) ?? "", /Six findings/);
  });

  it("drops the findings clause entirely when nothing was scored", () => {
    assert.match(gapSentence("X", 41, 68, 0) ?? "", /^X is 27 points/);
  });

  it("does not invent a gap when either end is unknown", () => {
    assert.equal(gapSentence("X", null, 68, 6), null);
    assert.equal(gapSentence("X", 41, null, 6), null);
  });

  it("does not claim a gap when there is none", () => {
    assert.match(gapSentence("X", 72, 72, 6) ?? "", /already at 72/);
  });

  it("scoredPillarCount counts only pillars with a real score", () => {
    const pillars = buildPillarViews({
      pillars: [
        { pillar: "governance", score: 34 },
        { pillar: "security", score: 38 },
        { pillar: "health", score: null },
      ],
    });
    assert.equal(scoredPillarCount(pillars), 2);
  });

  it("formats the tenant strip and degrades without a seat count", () => {
    assert.equal(tenantStrip(TENANT), "Halden Materials · 1,240 seats");
    assert.equal(tenantStrip({ ...TENANT, seatCount: null }), "Halden Materials");
  });

  it("formats the scan date the way the reports do", () => {
    assert.equal(formatJourneyDate("2026-08-03T09:14:00.000Z"), "3 August 2026");
    assert.equal(formatJourneyDate(null), null);
    assert.equal(formatJourneyDate("not a date"), null);
  });
});

describe("severity is universal, never pillar-driven", () => {
  it("bands on the same thresholds the summary rail uses", () => {
    assert.equal(severityForScore(29), "critical");
    assert.equal(severityForScore(49), "critical");
    assert.equal(severityForScore(50), "attention");
    assert.equal(severityForScore(59), "attention");
    assert.equal(severityForScore(60), "healthy");
  });

  it("gives one score the same band on every surface", () => {
    assert.equal(severityColor(29, "dark"), "#f87171");
    assert.equal(severityColor(29, "light"), "#dc2626");
    assert.equal(severityColor(90, "dark"), "#34d399");
    assert.equal(severityColor(90, "light"), "#15803d");
  });
});
