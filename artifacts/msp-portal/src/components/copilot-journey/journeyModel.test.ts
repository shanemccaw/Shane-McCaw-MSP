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
  CLEAN_PILLAR_HEADLINE,
  documentPillar,
  formatJourneyDate,
  gapSentence,
  INSUFFICIENT_PILLAR_CHIP,
  isGenerationUnknown,
  orderPillarFindings,
  pillarTrend,
  SCANNING_PILLAR_CHIP,
  UNEVALUATED_PILLAR_CHIP,
  remediatedScore,
  scoredPillarCount,
  tenantStrip,
  withLiveDocuments,
  verdictLabel,
  verdictSentence,
  type JourneyDocumentView,
  type WireAssessmentStatus,
  type WirePillarFinding,
  type WirePillarStatsPayload,
} from "./journeyModel.ts";
import {
  COPILOT_GATE_TARGET,
  JOURNEY_LIVE_DOCUMENTS,
  JOURNEY_READINESS_DOC_TYPE,
  JOURNEY_READINESS_DOCUMENT,
  PILLAR_KEYS,
  gateLabel,
  isLiveRenderedDocument,
  liveDocumentFor,
  severityForScore,
  severityColor,
} from "./journeyTokens.ts";

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
      // #503: a wedge is never silently empty. An empty payload means nothing
      // was evaluated, and the chip says exactly that — `chipsAreReal` is what
      // callers testing for genuine content read instead of `chips.length`.
      assert.deepEqual(v.chips, [UNEVALUATED_PILLAR_CHIP]);
      assert.equal(v.chipsAreReal, false);
      assert.equal(v.evaluation.status, "not_evaluated");
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

  // #399: a pillar the scan genuinely evaluated (real score) with zero
  // critical/warning findings is a real clean result, not a data gap — it must
  // not render the same bare "—" as a pillar nothing ever ran for.
  it("gives a pillar with a real score and no findings an honest clean headline, not null", () => {
    const payload: WirePillarStatsPayload = {
      pillars: [{ pillar: "security", score: 91, findings: [] }],
    };
    const view = buildPillarViews(payload).find((v) => v.key === "security");
    assert.equal(view?.score, 91);
    assert.equal(view?.headline, CLEAN_PILLAR_HEADLINE);
    assert.equal(view?.satelliteFinding, CLEAN_PILLAR_HEADLINE);
  });

  it("keeps a genuinely-unscored pillar's headline null even with no findings — not the clean message", () => {
    const payload: WirePillarStatsPayload = {
      pillars: [{ pillar: "security", score: null, findings: [] }],
    };
    const view = buildPillarViews(payload).find((v) => v.key === "security");
    assert.equal(view?.score, null);
    assert.equal(view?.headline, null);
    assert.equal(view?.satelliteFinding, null);
  });

  /* ---------------------------------------------------------------- *
   * #503 / #517 — chips are never a silent empty
   * ---------------------------------------------------------------- */

  it("#503: a scored, genuinely-clean pillar with no stat readouts gets the clean chip, not an empty wedge", () => {
    // The live case #503 was filed on: Compliance came back with a real score,
    // zero critical/warning findings, and all four of its stats unavailable.
    // `headline` said "No critical or warning findings."; `chips` said nothing
    // at all, which in the Reveal wheel is indistinguishable from broken.
    const payload: WirePillarStatsPayload = {
      pillars: [
        {
          pillar: "compliance",
          score: 88,
          evaluation: {
            status: "scored",
            evaluableSignalCount: 4,
            minRequiredSignals: 2,
            reason: "scored from 4 evaluable compliance signals",
          },
          stats: [
            { id: "compliance.missingLabels", label: "missing labels", unit: "count", value: null, unavailableReason: "no_data", checkKey: "compliance:missing-labels" },
          ],
          findings: [],
        },
      ],
    };
    const view = buildPillarViews(payload).find((v) => v.key === "compliance");
    assert.deepEqual(view?.chips, [CLEAN_PILLAR_HEADLINE]);
    assert.equal(view?.chipsAreReal, false);
  });

  it("#517: a pillar below the server's coverage floor says so, and carries no score", () => {
    // `governance`, not `copilot`: the Copilot pillar is the CENTRE of this
    // composition, not one of the six satellites, so it is deliberately absent
    // from `PILLAR_KEYS` and `buildPillarViews` never returns a card for it.
    const payload: WirePillarStatsPayload = {
      pillars: [
        {
          pillar: "governance",
          score: null,
          evaluation: {
            status: "insufficient_data",
            evaluableSignalCount: 1,
            minRequiredSignals: 2,
            reason: "only 1 evaluable signal carries a governance impact (minimum 2)",
          },
          stats: [],
          findings: [],
        },
      ],
    };
    const view = buildPillarViews(payload).find((v) => v.key === "governance");
    assert.equal(view?.score, null);
    assert.equal(view?.evaluation.status, "insufficient_data");
    assert.deepEqual(view?.chips, [INSUFFICIENT_PILLAR_CHIP]);
    assert.equal(view?.chipsAreReal, false);
    // "not enough data" must never be dressed up as a clean result.
    assert.notEqual(view?.chips[0], CLEAN_PILLAR_HEADLINE);
    assert.equal(view?.headline, null);
  });

  /* ---------------------------------------------------------------- *
   * #518 — insufficient_data while a scan is genuinely running is a
   * different fact from a complete-but-thin scan
   * ---------------------------------------------------------------- */

  it("#518: insufficient_data + scan.running renders still-scanning copy, not the insufficient-data fallback", () => {
    const payload: WirePillarStatsPayload = {
      pillars: [
        {
          pillar: "governance",
          score: null,
          evaluation: {
            status: "insufficient_data",
            evaluableSignalCount: 1,
            minRequiredSignals: 2,
            reason: "only 1 evaluable signal carries a governance impact (minimum 2)",
          },
          stats: [],
          findings: [],
        },
      ],
    };
    const view = buildPillarViews(payload, true).find((v) => v.key === "governance");
    // The wire's own verdict is untouched — only presentation changes.
    assert.equal(view?.evaluation.status, "insufficient_data");
    assert.deepEqual(view?.chips, [SCANNING_PILLAR_CHIP]);
    assert.equal(view?.chipsAreReal, false);
    assert.equal(view?.headline, SCANNING_PILLAR_CHIP);
    assert.notEqual(view?.chips[0], INSUFFICIENT_PILLAR_CHIP);
  });

  it("#518: the same insufficient_data pillar falls through to #517's copy once scan.running is false", () => {
    const payload: WirePillarStatsPayload = {
      pillars: [
        {
          pillar: "governance",
          score: null,
          evaluation: {
            status: "insufficient_data",
            evaluableSignalCount: 1,
            minRequiredSignals: 2,
            reason: "only 1 evaluable signal carries a governance impact (minimum 2)",
          },
          stats: [],
          findings: [],
        },
      ],
    };
    // Explicit `false`, and the default (omitted) argument, both prove this is
    // a scan-state-gated override, not a blanket rewrite of #517's behaviour.
    for (const view of [
      buildPillarViews(payload, false).find((v) => v.key === "governance"),
      buildPillarViews(payload).find((v) => v.key === "governance"),
    ]) {
      assert.deepEqual(view?.chips, [INSUFFICIENT_PILLAR_CHIP]);
      assert.equal(view?.headline, null);
    }
  });

  it("#518: not_evaluated is left completely untouched by scan.running — it is a structural gap, not a timing one", () => {
    const payload: WirePillarStatsPayload = {
      pillars: [{ pillar: "adoption", score: null, stats: [], findings: [] }],
    };
    const view = buildPillarViews(payload, true).find((v) => v.key === "adoption");
    assert.equal(view?.evaluation.status, "not_evaluated");
    assert.deepEqual(view?.chips, [UNEVALUATED_PILLAR_CHIP]);
    assert.notEqual(view?.chips[0], SCANNING_PILLAR_CHIP);
  });

  it("#518: a scored, genuinely-clean pillar keeps its earned clean state regardless of scan.running", () => {
    const payload: WirePillarStatsPayload = {
      pillars: [
        {
          pillar: "compliance",
          score: 88,
          evaluation: {
            status: "scored",
            evaluableSignalCount: 4,
            minRequiredSignals: 2,
            reason: "scored from 4 evaluable compliance signals",
          },
          stats: [],
          findings: [],
        },
      ],
    };
    const view = buildPillarViews(payload, true).find((v) => v.key === "compliance");
    assert.deepEqual(view?.chips, [CLEAN_PILLAR_HEADLINE]);
    assert.equal(view?.headline, CLEAN_PILLAR_HEADLINE);
  });

  it("#518: buildJourneyView threads scan.running through to its pillars", () => {
    const status: WireAssessmentStatus = {
      copilotGate: { score: null, threshold: 82, status: null },
    };
    const payload: WirePillarStatsPayload = {
      pillars: [
        {
          pillar: "governance",
          score: null,
          evaluation: {
            status: "insufficient_data",
            evaluableSignalCount: 1,
            minRequiredSignals: 2,
            reason: "only 1 evaluable signal carries a governance impact (minimum 2)",
          },
          stats: [],
          findings: [],
        },
      ],
    };
    const running = buildJourneyView({
      tenant: TENANT,
      pillarStats: payload,
      status,
      scanRunning: true,
    });
    const idle = buildJourneyView({ tenant: TENANT, pillarStats: payload, status });
    assert.deepEqual(
      running.pillars.find((p) => p.key === "governance")?.chips,
      [SCANNING_PILLAR_CHIP],
    );
    assert.deepEqual(
      idle.pillars.find((p) => p.key === "governance")?.chips,
      [INSUFFICIENT_PILLAR_CHIP],
    );
  });

  it("#517: real stat readouts and real findings still win over the explanatory fallback", () => {
    const payload: WirePillarStatsPayload = {
      pillars: [
        {
          pillar: "security",
          score: 38,
          stats: [
            { id: "security.mfa", label: "accounts without MFA", unit: "count", value: 14, checkKey: "identity:mfa" },
          ],
          findings: [{ severity: "critical", checkKey: "identity:mfa", title: "14 accounts have no MFA" }],
        },
      ],
    };
    const view = buildPillarViews(payload).find((v) => v.key === "security");
    assert.deepEqual(view?.chips, ["14 accounts without mfa"]);
    assert.equal(view?.chipsAreReal, true);
  });

  it("#517: a payload from before the evaluation field degrades to today's behaviour, never inventing 'insufficient'", () => {
    const payload: WirePillarStatsPayload = {
      pillars: [
        { pillar: "security", score: 38, stats: [], findings: [] },
        { pillar: "adoption", score: null, stats: [], findings: [] },
      ],
    };
    const views = buildPillarViews(payload);
    assert.equal(views.find((v) => v.key === "security")?.evaluation.status, "scored");
    assert.equal(views.find((v) => v.key === "adoption")?.evaluation.status, "not_evaluated");
    // A client counts no signals, so it may never claim the middle state.
    assert.ok(views.every((v) => v.evaluation.status !== "insufficient_data"));
    assert.deepEqual(views.find((v) => v.key === "adoption")?.chips, [UNEVALUATED_PILLAR_CHIP]);
  });

  it("still leads with the real finding when a scored pillar has critical/warning findings", () => {
    const payload: WirePillarStatsPayload = {
      pillars: [
        {
          pillar: "security",
          score: 38,
          findings: [{ severity: "warning", checkKey: "identity:guests", title: "31 dormant guest accounts" }],
        },
      ],
    };
    const view = buildPillarViews(payload).find((v) => v.key === "security");
    assert.equal(view?.headline, "31 dormant guest accounts");
    assert.equal(view?.satelliteFinding, "31 dormant guest accounts");
  });

  it("builds radar chips from real stat readouts, formatted per unit", () => {
    const payload: WirePillarStatsPayload = {
      pillars: [
        {
          pillar: "licensing",
          score: 57,
          stats: [
            { id: "a", label: "Unassigned spend", unit: "currency", value: 18400, checkKey: "c" },
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
  it("is null with no card at all", () => {
    assert.equal(pillarTrend(undefined), null);
  });

  it("is null when the card carries no trend (server found insufficient history)", () => {
    assert.equal(pillarTrend({ pillar: "governance", score: 34, trend: null }), null);
  });

  it("means every pillar view is null from an empty payload", () => {
    buildPillarViews(null).forEach((v) => assert.equal(v.trend, null));
  });

  it("passes through a real series that clears the floor", () => {
    const series = [40, 42, 41, 45, 48, 51];
    assert.deepEqual(pillarTrend({ pillar: "licensing", score: 51, trend: { series, window: "30d" } }), {
      series,
      window: "30d",
    });
  });

  it("re-floors a too-short series rather than trusting the wire blind", () => {
    // Defense in depth: the server already applies PILLAR_TREND_MIN_POINTS, but
    // a malformed/truncated payload must still degrade to no sparkline rather
    // than a two-dot line pretending to be a trend.
    assert.equal(
      pillarTrend({ pillar: "licensing", score: 51, trend: { series: [40, 42], window: "30d" } }),
      null,
    );
  });

  it("flows a real trend all the way into the pillar view", () => {
    const series = [30, 33, 35, 34, 38, 41];
    const payload: WirePillarStatsPayload = {
      pillars: [{ pillar: "security", score: 41, trend: { series, window: "30d" } }],
    };
    const view = buildPillarViews(payload).find((v) => v.key === "security");
    assert.deepEqual(view?.trend, { series, window: "30d" });
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

describe("withLiveDocuments (#424 — a live report depends on no generation row)", () => {
  const readiness = (docs: readonly JourneyDocumentView[]) =>
    docs.filter((d) => d.docType === JOURNEY_READINESS_DOC_TYPE || d.title === JOURNEY_READINESS_DOCUMENT);

  /**
   * Counts are expressed against the registry's own length rather than written
   * out (#343). Hardcoding "1" here is what turned every one of these into a
   * failing test the moment a second document was registered — and the
   * behaviour under test never mentioned a count in the first place.
   */
  const LIVE = JOURNEY_LIVE_DOCUMENTS.length;

  it("constructs every live report for a tenant with ZERO document rows — the real current state", () => {
    // `buildGeneration({})` is what a tenant with no assessment service row, or
    // a failed status fetch, genuinely produces: an empty set. Before #424 that
    // left the documents the platform can always render unresolvable.
    const g = withLiveDocuments(buildGeneration({}));
    assert.equal(g.total, LIVE);
    assert.equal(g.ready, LIVE);
    assert.equal(g.documents[0].title, JOURNEY_READINESS_DOCUMENT);
    assert.equal(g.documents[0].docType, JOURNEY_READINESS_DOC_TYPE);
    for (const doc of g.documents.slice(0, LIVE)) {
      assert.equal(doc.status, "ready");
      assert.equal(doc.id, null, "no row exists, so no id may be claimed");
    }
  });

  it("leaves every other document exactly as the platform reported it", () => {
    const base = buildGeneration({
      documents: {
        expected: [
          { docType: "exec", title: "Executive Summary" },
          { docType: "sec", title: "Security Posture Report" },
        ],
        items: [{ id: 1, docType: "exec", title: "Executive Summary", status: "delivered" }],
      },
    });
    const g = withLiveDocuments(base);
    assert.equal(g.total, LIVE + 2);
    assert.deepEqual(
      g.documents.map((d) => d.docType),
      [...JOURNEY_LIVE_DOCUMENTS.map((d) => d.docType), "exec", "sec"],
      "the live reports lead, in registry order; the reported set follows in its own",
    );
    // The reported two are the SAME objects, not rebuilt ones.
    assert.equal(g.documents[LIVE], base.documents[0]);
    assert.equal(g.documents[LIVE + 1], base.documents[1]);
    assert.equal(g.documents[LIVE + 1].status, "pending", "the un-generated report is still pending");
  });

  it("recomputes ready/total off the list, so the counter cannot disagree with the rows", () => {
    const base = buildGeneration({
      documents: { expected: [{ docType: "sec", title: "Security Posture Report" }], items: [] },
    });
    assert.equal(base.ready, 0);
    const g = withLiveDocuments(base);
    assert.equal(g.ready, LIVE);
    assert.equal(g.total, LIVE + 1);
    assert.equal(g.allReady, false);
  });

  it("marks a listed-but-never-generated live row ready — nothing is outstanding for it", () => {
    const base = buildGeneration({
      documents: {
        expected: [{ docType: JOURNEY_READINESS_DOC_TYPE, title: "Copilot Readiness Assessment" }],
        items: [],
      },
    });
    assert.equal(base.documents[0].status, "pending");
    const g = withLiveDocuments(base);
    assert.equal(g.total, LIVE, "the existing entry is replaced, never duplicated");
    const row = readiness(g.documents)[0];
    assert.equal(row.status, "ready");
    assert.equal(row.title, "Copilot Readiness Assessment", "the platform's own title for it is kept");
  });

  it("leaves a genuinely generated live row completely alone", () => {
    // Every registered document has a real generated row here, so there is
    // nothing at all to add and the input object is returned unchanged.
    const base = buildGeneration({
      documents: {
        expected: JOURNEY_LIVE_DOCUMENTS.map((d, i) => ({ docType: d.docType, title: `Catalogue label ${i}` })),
        items: JOURNEY_LIVE_DOCUMENTS.map((d, i) => ({
          id: 42 + i,
          docType: d.docType,
          title: `Catalogue label ${i}`,
          status: "draft",
        })),
      },
    });
    const g = withLiveDocuments(base);
    assert.equal(g, base, "an existing row owns its own state, including a failed one");
    assert.ok(g.documents.every((d) => d.status === "generating"));
  });

  it("never lists a report twice, whichever key it was matched on", () => {
    // The design's own title with a different docType — the second key
    // `liveDocumentFor` accepts.
    const base = buildGeneration({
      documents: {
        expected: [{ docType: "some_other_key", title: JOURNEY_READINESS_DOCUMENT }],
        items: [],
      },
    });
    const g = withLiveDocuments(base);
    assert.equal(readiness(g.documents).length, 1);
    assert.equal(g.total, LIVE, "the title match resolved it; nothing was added for it");
    const row = readiness(g.documents)[0];
    assert.equal(row.docType, "some_other_key", "the platform's own key is kept");
    assert.equal(row.status, "ready");
  });

  it("is idempotent — applying it twice changes nothing", () => {
    const once = withLiveDocuments(buildGeneration({}));
    const twice = withLiveDocuments(once);
    assert.deepEqual(twice, once);
  });
});

describe("isGenerationUnknown (#409, #416 — DocumentBody's 'nothing to show' gate)", () => {
  const READINESS_DOC: JourneyDocumentView = {
    title: JOURNEY_READINESS_DOCUMENT,
    docType: JOURNEY_READINESS_DOC_TYPE,
    id: null,
    status: "pending",
  };
  const OLD_PATTERN_DOC: JourneyDocumentView = {
    title: "Full Remediation Guide — Copilot Gate Clearance Plan",
    docType: "remediation_guide",
    id: null,
    status: "pending",
  };

  it("is unavailable when there is no document at all, regardless of gen.known", () => {
    assert.equal(isGenerationUnknown(null, { known: false }), true);
    assert.equal(isGenerationUnknown(null, { known: true }), true);
  });

  it("keeps the old-pattern document's honest gate untouched", () => {
    assert.equal(isGenerationUnknown(OLD_PATTERN_DOC, { known: false }), true);
    assert.equal(isGenerationUnknown(OLD_PATTERN_DOC, { known: true }), false);
  });

  it("renders the readiness report even when the old pipeline's counter is unknown", () => {
    assert.equal(isGenerationUnknown(READINESS_DOC, { known: false }), false);
  });

  it("readiness report stays renderable when gen.known happens to be true too", () => {
    assert.equal(isGenerationUnknown(READINESS_DOC, { known: true }), false);
  });

  it("matches on title as well as docType, same as liveDocumentFor", () => {
    const titleOnly: JourneyDocumentView = { ...READINESS_DOC, docType: "some_other_key" };
    assert.equal(isGenerationUnknown(titleOnly, { known: false }), false);
  });
});

describe("the live-document registry (#343 — the gate is general, not per-report)", () => {
  it("every entry is reachable by its own docType AND by its own design title", () => {
    // The whole promise of the registry: registering a document is the only
    // thing a port has to do to the gate. If either key stopped resolving, the
    // document would fall back to the old pipeline's gates and show a spinner
    // over a report that is complete.
    for (const live of JOURNEY_LIVE_DOCUMENTS) {
      assert.equal(
        liveDocumentFor({ title: "renamed by an admin", docType: live.docType })?.key,
        live.key,
      );
      assert.equal(
        liveDocumentFor({ title: live.title, docType: "some_other_key" })?.key,
        live.key,
      );
    }
  });

  it("keys are unique, so a document can never resolve to two bodies", () => {
    const keys = JOURNEY_LIVE_DOCUMENTS.map((d) => d.key);
    assert.equal(new Set(keys).size, keys.length);
    const docTypes = JOURNEY_LIVE_DOCUMENTS.map((d) => d.docType);
    assert.equal(new Set(docTypes).size, docTypes.length);
  });

  it("matching is exact, never a substring — a near-miss title stays on the old pattern", () => {
    // A loose match here would hijack the live rendering of some other report
    // that happens to share a word with a registered one.
    for (const live of JOURNEY_LIVE_DOCUMENTS) {
      assert.equal(isLiveRenderedDocument({ title: `${live.title} (draft)`, docType: "x" }), false);
      assert.equal(isLiveRenderedDocument({ title: "x", docType: `${live.docType}_v2` }), false);
    }
  });

  it("an unregistered document is not live-rendered, and null is not one either", () => {
    assert.equal(isLiveRenderedDocument({ title: "Executive Summary", docType: "exec" }), false);
    assert.equal(isLiveRenderedDocument(null), false);
    assert.equal(liveDocumentFor(undefined), null);
  });

  it("withLiveDocuments guarantees EVERY registered entry, not a named one", () => {
    const g = withLiveDocuments(buildGeneration({}));
    assert.equal(g.total, JOURNEY_LIVE_DOCUMENTS.length);
    assert.deepEqual(
      g.documents.map((d) => d.docType),
      JOURNEY_LIVE_DOCUMENTS.map((d) => d.docType),
      "added entries lead, in registry order",
    );
    assert.ok(
      g.documents.every((d) => d.status === "ready" && d.id === null),
      "nothing is outstanding for a live-rendered document, and no row id may be claimed",
    );
  });

  it("isGenerationUnknown exempts every registered entry, on either key", () => {
    for (const live of JOURNEY_LIVE_DOCUMENTS) {
      const byType: JourneyDocumentView = { title: "renamed", docType: live.docType, id: null, status: "pending" };
      const byTitle: JourneyDocumentView = { title: live.title, docType: "renamed", id: null, status: "pending" };
      assert.equal(isGenerationUnknown(byType, { known: false }), false);
      assert.equal(isGenerationUnknown(byTitle, { known: false }), false);
    }
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
      status: { copilotGate: { score: 41, threshold: 82, status: "no_go" } },
      projectedByPillar: { governance: 61 },
    });
    assert.equal(view.readinessScore, 41);
    assert.equal(view.remediatedScore, 61);
    assert.equal(view.isPreview, false);
  });

  it("reads the engine's Copilot pillar, never the superseded 3-indicator rollup", () => {
    // #358: the Reveal's headline used to come from copilot-readiness.ts's
    // narrow 50/30/20 formula while the six pillar scenes beside it came from
    // the unified engine — two unrelated calculations sharing one screen. The
    // narrow number still rides along as `indicatorScore`; if it is ever read as
    // the headline again, this goes red.
    const view = buildJourneyView({
      tenant: TENANT,
      pillarStats: null,
      status: {
        copilotGate: { score: 70, threshold: 82, status: "no_go" },
        copilotReadiness: { overall: { score: 70, indicatorScore: 41 } },
      },
    });
    assert.equal(view.readinessScore, 70);
  });

  it("falls back to copilotReadiness.overall only when no gate block is present", () => {
    const view = buildJourneyView({
      tenant: TENANT,
      pillarStats: null,
      status: { copilotReadiness: { overall: { score: 55 } } },
    });
    assert.equal(view.readinessScore, 55);
  });

  it("leaves the headline null when the engine has no Copilot score", () => {
    const view = buildJourneyView({
      tenant: TENANT,
      pillarStats: null,
      status: { copilotGate: { score: null, threshold: 82, status: null } },
    });
    assert.equal(view.readinessScore, null);
  });

  it("survives a completely absent status payload without inventing a document set", () => {
    const view = buildJourneyView({ tenant: TENANT, pillarStats: null, status: null });
    assert.equal(view.readinessScore, null);
    assert.equal(view.generation.total, 0);
    assert.equal(view.pillars.length, 6);
  });

  it("#517: carries the gate's own real-coverage verdict so Scene 1 can say WHY there is no number", () => {
    const view = buildJourneyView({
      tenant: TENANT,
      pillarStats: null,
      status: {
        copilotGate: {
          score: null,
          threshold: 82,
          status: null,
          evaluation: {
            status: "insufficient_data",
            evaluableSignalCount: 1,
            minRequiredSignals: 2,
            reason: "only 1 evaluable signal carries a copilot impact (minimum 2)",
          },
        },
      },
    });
    assert.equal(view.readinessScore, null);
    assert.equal(view.readinessEvaluation.status, "insufficient_data");
    assert.equal(view.readinessEvaluation.evaluableSignalCount, 1);
  });

  it("#517: a status payload without the evaluation block still reports an honest state", () => {
    const scored = buildJourneyView({
      tenant: TENANT,
      pillarStats: null,
      status: { copilotGate: { score: 70, threshold: 82, status: "no_go" } },
    });
    assert.equal(scored.readinessEvaluation.status, "scored");

    const none = buildJourneyView({ tenant: TENANT, pillarStats: null, status: null });
    assert.equal(none.readinessEvaluation.status, "not_evaluated");
    // Never the middle state — a client that counted no signals cannot claim it.
    assert.notEqual(none.readinessEvaluation.status, "insufficient_data");
  });
});

describe("copy that depends on the numbers", () => {
  it("switches the verdict at the real 82 Copilot Gate, and 82 itself is a Go", () => {
    // #359's own verify bar: a tenant scoring exactly 82 shows Go, 81 shows
    // No-Go. The boundary case was raised explicitly on #358 and answered
    // explicitly, so it is asserted rather than left to the reader.
    assert.equal(COPILOT_GATE_TARGET, 82);
    assert.equal(verdictLabel(41), "Not flight-ready");
    assert.equal(verdictLabel(81), "Not flight-ready");
    assert.equal(verdictLabel(82), "Cleared for rollout");
    assert.equal(verdictLabel(100), "Cleared for rollout");
  });

  it("says the same thing as the Document Viewer's gate chip for every score", () => {
    // The bug #359 closes was two thresholds on one number — `gateLabel` at 60
    // in the viewer's chrome while `verdictLabel` said something else on the
    // Reveal. Swept rather than spot-checked: no score may disagree.
    for (let score = 0; score <= 100; score += 1) {
      const cleared = verdictLabel(score) === "Cleared for rollout";
      const safe = gateLabel(score) === "Safe to deploy";
      assert.equal(cleared, safe, `verdict and gate disagree at ${score}`);
      assert.equal(cleared, score >= COPILOT_GATE_TARGET, `wrong side of the gate at ${score}`);
    }
  });

  it("keeps severity colour banding separate from the Gate, deliberately", () => {
    // A 70 is a green number that has not cleared the Gate. These are two
    // different statements about one score and both are true; conflating them
    // is what produced the old 60 threshold.
    assert.equal(severityForScore(70), "healthy");
    assert.equal(verdictLabel(70), "Not flight-ready");
  });

  it("writes the verdict sentence in Shane's voice", () => {
    assert.equal(
      verdictSentence("Halden Materials", 41),
      "Halden Materials is not flight-ready for Copilot. Here is exactly why — and what it takes to get there.",
    );
  });

  it("measures the gap to the 82 Gate, not to the scope's projection", () => {
    // A tenant at 41 whose scope projects 68 is 41 points from flight-ready and
    // the scope closes 27 of them. Quoting 27 as the distance to flight-ready —
    // which is what this did while the gate sat at 60 — would tell the customer
    // the work on offer finishes the job when it does not.
    const s = gapSentence("Halden Materials", 41, 68, 6) ?? "";
    assert.match(s, /41 points from flight-ready/);
    assert.match(s, /This scope closes 27 of them\./);
    assert.doesNotMatch(s, /27 points from flight-ready/);
  });

  it("keeps the original claim when the scope genuinely clears the Gate", () => {
    const s = gapSentence("Halden Materials", 41, 84, 6) ?? "";
    assert.match(s, /41 points from flight-ready — and every point is a known, fixable gap\./);
    assert.doesNotMatch(s, /closes/);
  });

  it("still states the distance when the scope buys nothing", () => {
    const s = gapSentence("X", 41, 41, 6) ?? "";
    assert.match(s, /41 points from flight-ready/);
    assert.doesNotMatch(s, /closes/);
  });

  it("counts the findings it actually has, not the design's six", () => {
    // The sentence's rhetorical job is that the number in front of you is those
    // findings added up. Quoting six when four contributed breaks that claim.
    assert.match(gapSentence("X", 41, 68, 6) ?? "", /^Six findings, one number\./);
    assert.match(gapSentence("X", 41, 68, 4) ?? "", /^Four findings, one number\./);
    assert.doesNotMatch(gapSentence("X", 41, 68, 4) ?? "", /Six findings/);
  });

  it("drops the findings clause entirely when nothing was scored", () => {
    assert.match(gapSentence("X", 41, 68, 0) ?? "", /^X is 41 points/);
  });

  it("does not invent a gap when either end is unknown", () => {
    assert.equal(gapSentence("X", null, 68, 6), null);
    assert.equal(gapSentence("X", 41, null, 6), null);
  });

  it("does not claim a gap when the tenant is already through the Gate", () => {
    assert.match(gapSentence("X", 82, 82, 6) ?? "", /already cleared for Copilot at 82/);
    // 72 is a green number that has NOT cleared the Gate, so it still has a gap.
    assert.match(gapSentence("X", 72, 72, 6) ?? "", /10 points from flight-ready/);
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

describe("a report's accent pillar", () => {
  const doc = (title: string, docType = "") => ({ title, docType });

  it("reads the pillar out of each of the design's seven report names", () => {
    assert.equal(documentPillar(doc("Microsoft 365 Governance Posture Report")), "governance");
    assert.equal(documentPillar(doc("Microsoft 365 Security Posture & Blast Radius Report")), "security");
    assert.equal(
      documentPillar(doc("Microsoft 365 Compliance & Regulatory Alignment Report")),
      "compliance",
    );
    assert.equal(documentPillar(doc("Copilot Licensing Alignment Report")), "licensing");
    assert.equal(documentPillar(doc("Copilot Adoption & Workflow Readiness Report")), "adoption");
    assert.equal(
      documentPillar(doc("Microsoft 365 Operational Health & Service Integrity Report")),
      "health",
    );
  });

  it("returns null for the reports that belong to no single pillar", () => {
    // The roll-up and the remediation guide cover all six, so neither may take
    // one pillar's colour — they fall back to the journey's own accent.
    assert.equal(documentPillar(doc("Copilot Readiness, Safety & Enablement Report")), null);
    assert.equal(documentPillar(doc("Full Remediation Guide — Copilot Gate Clearance Plan")), null);
    assert.equal(documentPillar(null), null);
  });

  it("falls back to the catalogue key when the title says nothing", () => {
    assert.equal(documentPillar(doc("Quarterly Review", "m365_security_posture")), "security");
  });
});

/* ------------------------------------------------------------------ *
 * #414 — real signal weight ranks a pillar's headline within its tier
 * ------------------------------------------------------------------ */

describe("orderPillarFindings", () => {
  /**
   * The reported regression, on the real check keys. `identity:break-glass-health`
   * used to lead purely because it sorts before `identity:ca-mfa-coverage`
   * alphabetically; the real weights are 20 for CA-MFA coverage against 18 for
   * break-glass health.
   *
   * Since 2026-08-06 those are `securityImpact` values — api-server narrows a
   * finding to its own card's impact column before serialising, so what arrives
   * here is already the right number for the pillar it is filed under. The
   * client is deliberately blind to WHICH column produced it; see the
   * pillar-agnostic test at the end of this block.
   */
  const SECURITY_CRITICALS: WirePillarFinding[] = [
    {
      severity: "critical",
      checkKey: "identity:break-glass-health",
      title: "No enabled break-glass account",
      rankWeight: 18,
    },
    {
      severity: "critical",
      checkKey: "identity:ca-mfa-coverage",
      title: "No Conditional Access policies exist",
      rankWeight: 20,
    },
  ];

  it("makes the heavier finding the pillar's headline and satellite", () => {
    const view = buildPillarViews({
      pillars: [{ pillar: "security", score: 38, findings: SECURITY_CRITICALS }],
    }).find((v) => v.key === "security");

    assert.equal(view?.headline, "No Conditional Access policies exist");
    assert.equal(view?.satelliteFinding, "No Conditional Access policies exist");
    // The projection the scenes read must agree with the headline, not just
    // the headline string — they are separate fields off the same order.
    assert.equal(view?.findings[0]?.title, "No Conditional Access policies exist");
  });

  it("never lets a heavier warning displace a lighter critical", () => {
    const ordered = orderPillarFindings([
      { severity: "warning", checkKey: "a:heavy", title: "heavy warning", rankWeight: 90 },
      { severity: "critical", checkKey: "b:light", title: "light critical", rankWeight: 1 },
    ]);
    assert.deepEqual(
      ordered.map((f) => f.severity),
      ["critical", "warning"],
    );
    assert.equal(ordered[0]?.title, "light critical");
  });

  it("ranks within both tiers without mixing them", () => {
    const ordered = orderPillarFindings([
      { severity: "warning", checkKey: "a", title: "w-light", rankWeight: 2 },
      { severity: "critical", checkKey: "b", title: "c-light", rankWeight: 3 },
      { severity: "warning", checkKey: "c", title: "w-heavy", rankWeight: 40 },
      { severity: "critical", checkKey: "d", title: "c-heavy", rankWeight: 50 },
    ]);
    assert.deepEqual(
      ordered.map((f) => f.title),
      ["c-heavy", "c-light", "w-heavy", "w-light"],
    );
  });

  it("keeps the server's order when weights tie", () => {
    // The honest-degradation case: if the ranking column turns out flat on live
    // data, this must behave exactly as it did before #414, not arbitrarily.
    const tied: WirePillarFinding[] = [
      { severity: "critical", checkKey: "identity:break-glass-health", title: "first", rankWeight: 1 },
      { severity: "critical", checkKey: "identity:ca-mfa-coverage", title: "second", rankWeight: 1 },
    ];
    assert.deepEqual(
      orderPillarFindings(tied).map((f) => f.title),
      ["first", "second"],
    );
  });

  it("treats a payload with no weights at all as ties, not as zero-ranked noise", () => {
    // A payload predating #414, or the design fixture: `rankWeight` is absent,
    // read as 0 for every finding, so array order survives intact.
    const legacy: WirePillarFinding[] = [
      { severity: "critical", checkKey: "z:last-alphabetically", title: "first" },
      { severity: "warning", checkKey: "a:first-alphabetically", title: "third" },
      { severity: "critical", checkKey: "m:middle", title: "second" },
    ];
    assert.deepEqual(
      orderPillarFindings(legacy).map((f) => f.title),
      ["first", "second", "third"],
    );
  });

  it("does not disturb a pillar with a single critical finding", () => {
    const one: WirePillarFinding[] = [
      { severity: "critical", checkKey: "identity:ca-policy-count", title: "the only one", rankWeight: 12 },
    ];
    assert.deepEqual(orderPillarFindings(one), one);

    const view = buildPillarViews({ pillars: [{ pillar: "security", score: 38, findings: one }] }).find(
      (v) => v.key === "security",
    );
    assert.equal(view?.headline, "the only one");
    assert.equal(view?.criticalCount, 0); // findingCounts absent — unchanged by #414
  });

  it("leaves an empty pillar empty rather than inventing an order", () => {
    assert.deepEqual(orderPillarFindings([]), []);
  });

  it("does not mutate the payload it was handed", () => {
    const input = [...SECURITY_CRITICALS];
    orderPillarFindings(input);
    assert.equal(input[0]?.checkKey, "identity:break-glass-health");
  });

  /**
   * The 2026-08-06 correction moved api-server from ranking every pillar by
   * `copilot_impact` to ranking each by its own impact column. This file did not
   * change, and these two tests are why: `rankWeight` stays a flat number whose
   * meaning is "rank within THIS card", so the correction is invisible here.
   */
  it("ranks identically whichever pillar's column the server drew the weight from", () => {
    const rows = (a: number, b: number): WirePillarFinding[] => [
      { severity: "critical", checkKey: "x:lighter", title: "lighter", rankWeight: a },
      { severity: "critical", checkKey: "y:heavier", title: "heavier", rankWeight: b },
    ];
    // Security's securityImpact spread and Licensing's licensingImpact spread
    // are different columns and different magnitudes; the client sees numbers.
    for (const [lo, hi] of [
      [18, 20], // securityImpact, the reported case
      [3, 7], // licensingImpact, a much narrower real spread
      [0, 1], // the barest possible discrimination
    ]) {
      assert.deepEqual(
        orderPillarFindings(rows(lo!, hi!)).map((f) => f.title),
        ["heavier", "lighter"],
        `weights ${lo}/${hi}`,
      );
    }
  });

  it("would have kept the pre-correction bug had the server sent flat weights", () => {
    // What api-server actually shipped on 2026-08-05: copilot_impact is 0 for
    // every Security signal, so every finding arrived weighted 0, tied, and this
    // fell through to the server's alphabetical order. Pinned so the client's
    // half of that failure stays legible rather than looking like a bug here.
    const flat: WirePillarFinding[] = SECURITY_CRITICALS.map((f) => ({ ...f, rankWeight: 0 }));
    assert.deepEqual(
      orderPillarFindings(flat).map((f) => f.title),
      ["No enabled break-glass account", "No Conditional Access policies exist"],
    );
  });
});
