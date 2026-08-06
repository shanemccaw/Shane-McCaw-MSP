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
  isGenerationUnknown,
  pillarTrend,
  remediatedScore,
  scoredPillarCount,
  tenantStrip,
  withLiveDocuments,
  verdictLabel,
  verdictSentence,
  type JourneyDocumentView,
  type WireAssessmentStatus,
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

describe("withLiveDocuments (#424 — the report depends on no generation row)", () => {
  const readiness = (docs: readonly JourneyDocumentView[]) =>
    docs.filter((d) => d.docType === JOURNEY_READINESS_DOC_TYPE || d.title === JOURNEY_READINESS_DOCUMENT);

  it("constructs the report for a tenant with ZERO document rows — the real current state", () => {
    // `buildGeneration({})` is what a tenant with no assessment service row, or
    // a failed status fetch, genuinely produces: an empty set. Before #424 that
    // left the one document the platform can always render unresolvable.
    const g = withLiveDocuments(buildGeneration({}));
    assert.equal(g.total, 1);
    assert.equal(g.ready, 1);
    assert.equal(g.documents[0].title, JOURNEY_READINESS_DOCUMENT);
    assert.equal(g.documents[0].docType, JOURNEY_READINESS_DOC_TYPE);
    assert.equal(g.documents[0].status, "ready");
    assert.equal(g.documents[0].id, null, "no row exists, so no id may be claimed");
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
    assert.equal(g.total, 3);
    assert.deepEqual(
      g.documents.map((d) => d.docType),
      [JOURNEY_READINESS_DOC_TYPE, "exec", "sec"],
      "the roll-up leads; the reported set follows in its own order",
    );
    // The other two are the SAME objects, not rebuilt ones.
    assert.equal(g.documents[1], base.documents[0]);
    assert.equal(g.documents[2], base.documents[1]);
    assert.equal(g.documents[2].status, "pending", "the un-generated report is still pending");
  });

  it("recomputes ready/total off the list, so the counter cannot disagree with the rows", () => {
    const base = buildGeneration({
      documents: { expected: [{ docType: "sec", title: "Security Posture Report" }], items: [] },
    });
    assert.equal(base.ready, 0);
    const g = withLiveDocuments(base);
    assert.equal(g.ready, 1);
    assert.equal(g.total, 2);
    assert.equal(g.allReady, false);
  });

  it("marks a listed-but-never-generated readiness row ready — nothing is outstanding for it", () => {
    const base = buildGeneration({
      documents: {
        expected: [{ docType: JOURNEY_READINESS_DOC_TYPE, title: "Copilot Readiness Assessment" }],
        items: [],
      },
    });
    assert.equal(base.documents[0].status, "pending");
    const g = withLiveDocuments(base);
    assert.equal(g.total, 1, "the existing entry is replaced, never duplicated");
    assert.equal(g.documents[0].status, "ready");
    assert.equal(
      g.documents[0].title,
      "Copilot Readiness Assessment",
      "the platform's own title for it is kept",
    );
  });

  it("leaves a genuinely generated readiness row completely alone", () => {
    const base = buildGeneration({
      documents: {
        expected: [{ docType: JOURNEY_READINESS_DOC_TYPE, title: "Copilot Readiness Assessment" }],
        items: [
          { id: 42, docType: JOURNEY_READINESS_DOC_TYPE, title: "Copilot Readiness Assessment", status: "draft" },
        ],
      },
    });
    const g = withLiveDocuments(base);
    assert.equal(g, base, "an existing row owns its own state, including a failed one");
    assert.equal(g.documents[0].status, "generating");
  });

  it("never lists the report twice, whichever key it was matched on", () => {
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
    assert.equal(g.documents[0].docType, "some_other_key", "the platform's own key is kept");
    assert.equal(g.documents[0].status, "ready");
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
