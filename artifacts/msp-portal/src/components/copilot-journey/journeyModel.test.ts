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
  JOURNEY_LIVE_DOCUMENT_SPINE,
  liveFindingsByPillar,
  mergeLiveFindings,
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
  type JourneyGeneration,
  type WireAssessmentStatus,
  type WirePillarFinding,
  type WirePillarStatsPayload,
} from "./journeyModel.ts";
import {
  COPILOT_GATE_TARGET,
  JOURNEY_DESIGN_DOCUMENTS,
  JOURNEY_LIVE_DOCUMENTS,
  JOURNEY_READINESS_DOC_TYPE,
  JOURNEY_READINESS_DOCUMENT,
  JOURNEY_REMEDIATION_DOC_TYPE,
  JOURNEY_REMEDIATION_DOCUMENT,
  JOURNEY_SOW_DOCUMENT,
  PILLAR_KEYS,
  gateLabel,
  isLiveRenderedDocument,
  liveDocumentFor,
  severityForScore,
  severityColor,
} from "./journeyTokens.ts";
import { SOW_DOC_TYPE } from "./sowLiveScope.ts";

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
    // #535: `satelliteFinding` now sources off `chips[0]`, which — unlike
    // `headline`'s `leadTitle` — always carries pillarChips()'s own honest
    // explanation of what's missing rather than a bare null.
    assert.equal(view?.satelliteFinding, UNEVALUATED_PILLAR_CHIP);
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

  it("#518/#524: a scored, genuinely-clean pillar keeps its earned clean state regardless of scan.running, once a real run backs the empty result", () => {
    const payload: WirePillarStatsPayload = {
      // #524: `findingsRunId` is the evidence a "scored" pillar's empty finding
      // list is real — a completed run (this one, or a borrowed older one)
      // actually reported nothing critical/warning, not just that nobody has
      // looked yet.
      findingsRunId: "run-a",
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

  /* ---------------------------------------------------------------- *
   * #524 — a live scan with no fallback run to borrow from must never
   * print "clean" for a pillar whose score raced ahead of its findings
   * ---------------------------------------------------------------- */

  it("#524: a scored pillar with no findings run at all (fresh tenant / deleted history) reads as still-scanning, never clean", () => {
    const payload: WirePillarStatsPayload = {
      // The confirmed root cause: no run has EVER persisted findings for this
      // tenant, so `findings: []` below means nothing yet, not "measured clean".
      findingsRunId: null,
      pillars: [
        {
          pillar: "security",
          score: 22,
          evaluation: {
            status: "scored",
            evaluableSignalCount: 6,
            minRequiredSignals: 2,
            reason: "scored from 6 evaluable security signals",
          },
          stats: [],
          findings: [],
        },
      ],
    };
    const view = buildPillarViews(payload, true).find((v) => v.key === "security");
    assert.deepEqual(view?.chips, [SCANNING_PILLAR_CHIP]);
    assert.equal(view?.headline, SCANNING_PILLAR_CHIP);
    assert.notEqual(view?.chips[0], CLEAN_PILLAR_HEADLINE);
    // The wire's own score and verdict are untouched — only presentation changes.
    assert.equal(view?.score, 22);
    assert.equal(view?.evaluation.status, "scored");
  });

  it("#524: the same no-fallback-run pillar shows its earned clean state once the scan is no longer running", () => {
    const payload: WirePillarStatsPayload = {
      findingsRunId: null,
      pillars: [
        {
          pillar: "security",
          score: 22,
          evaluation: {
            status: "scored",
            evaluableSignalCount: 6,
            minRequiredSignals: 2,
            reason: "scored from 6 evaluable security signals",
          },
          stats: [],
          findings: [],
        },
      ],
    };
    // Once the run completes, `fetchPillarFindings` writes this run's own
    // findings and `findingsRunId` stops being null server-side — but even
    // before that round-trip, `scanRunning: false` alone must not still say
    // "still scanning" for a run that's no longer live.
    const view = buildPillarViews(payload, false).find((v) => v.key === "security");
    assert.deepEqual(view?.chips, [CLEAN_PILLAR_HEADLINE]);
    assert.equal(view?.headline, CLEAN_PILLAR_HEADLINE);
  });

  it("#524: a scored pillar with real stat readouts but no findings run still shows those real numbers, not a fabricated verdict", () => {
    const payload: WirePillarStatsPayload = {
      findingsRunId: null,
      pillars: [
        {
          pillar: "security",
          score: 22,
          evaluation: {
            status: "scored",
            evaluableSignalCount: 6,
            minRequiredSignals: 2,
            reason: "scored from 6 evaluable security signals",
          },
          stats: [
            {
              id: "security.globalAdmins",
              label: "global administrators",
              unit: "count",
              value: 14,
              checkKey: "identity:global-admin-count",
            },
          ],
          findings: [],
        },
      ],
    };
    const view = buildPillarViews(payload, true).find((v) => v.key === "security");
    // A stat is a real, already-measured number — independent of the findings
    // batch write — so it is shown, not suppressed behind "still scanning".
    assert.deepEqual(view?.chips, ["14 global administrators"]);
    assert.equal(view?.chipsAreReal, true);
    // But the headline is a VERDICT, not a number, and this run has not proven
    // one yet — it must still read as still-scanning.
    assert.equal(view?.headline, SCANNING_PILLAR_CHIP);
    assert.notEqual(view?.headline, CLEAN_PILLAR_HEADLINE);
  });

  it("#524: insufficient_data with no findings run is unaffected — that branch already reads still-scanning off evaluation.status alone", () => {
    const payload: WirePillarStatsPayload = {
      findingsRunId: null,
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
    assert.deepEqual(view?.chips, [SCANNING_PILLAR_CHIP]);
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

  // #524: the full reproduction case — a fresh tenant / deleted scan history
  // (no findings run at all), an active run in progress, and a pillar whose
  // score already came back from partial live signals. Threaded through the
  // whole `buildJourneyView` pipeline, not just `buildPillarViews`, since that
  // is what the live page actually calls.
  it("#524: buildJourneyView never reports a scored-but-unproven pillar as clean while a scan with no fallback run is live", () => {
    const status: WireAssessmentStatus = {
      copilotGate: { score: null, threshold: 82, status: null },
    };
    const payload: WirePillarStatsPayload = {
      findingsRunId: null,
      pillars: [
        {
          pillar: "security",
          score: 18,
          evaluation: {
            status: "scored",
            evaluableSignalCount: 5,
            minRequiredSignals: 2,
            reason: "scored from 5 evaluable security signals",
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
    const security = running.pillars.find((p) => p.key === "security");
    assert.equal(security?.headline, SCANNING_PILLAR_CHIP);
    assert.notEqual(security?.headline, CLEAN_PILLAR_HEADLINE);
    assert.deepEqual(security?.chips, [SCANNING_PILLAR_CHIP]);

    // The same payload, once the scan is no longer running, reverts to its
    // earned clean state — the wire's findings genuinely haven't changed, only
    // the client's own knowledge that no run is left to write them.
    const idle = buildJourneyView({ tenant: TENANT, pillarStats: payload, status });
    const idleSecurity = idle.pillars.find((p) => p.key === "security");
    assert.equal(idleSecurity?.headline, CLEAN_PILLAR_HEADLINE);
  });

  /* ---------------------------------------------------------------- *
   * #526 — this run's own live scanCheckResults surface as real pillar
   * chips/headline while the scan is still in flight, using the same
   * checkKey -> pillar resolution (#521) the persisted findings above use.
   * ---------------------------------------------------------------- */

  it("#526: a live critical result replaces the still-scanning placeholder the instant it streams in", () => {
    // The confirmed reproduction case: no fallback findings run exists
    // (#524's exact gap) and the pillar's checks are still mid-run — before
    // this fix, that combination could only ever render SCANNING_PILLAR_CHIP.
    const payload: WirePillarStatsPayload = {
      findingsRunId: null,
      pillars: [
        {
          pillar: "security",
          score: null,
          evaluation: {
            status: "insufficient_data",
            evaluableSignalCount: 1,
            minRequiredSignals: 2,
            reason: "only 1 evaluable signal carries a security impact (minimum 2)",
          },
          stats: [],
          findings: [],
        },
      ],
      checkKeyPillars: { "identity:ca-policy-count": "security" },
    };
    const liveCheckResults = [
      {
        checkKey: "identity:ca-policy-count",
        checkLabel: "No enabled Conditional Access policies",
        status: "failed",
        severityMatched: "critical",
        index: 3,
        total: 40,
      },
    ];
    const view = buildPillarViews(payload, true, liveCheckResults).find((v) => v.key === "security");
    assert.equal(view?.headline, "No enabled Conditional Access policies");
    assert.deepEqual(view?.chips, ["No enabled Conditional Access policies"]);
    assert.equal(view?.chipsAreReal, true);
    assert.equal(view?.findings[0]?.checkKey, "identity:ca-policy-count");
    assert.equal(view?.findings[0]?.severity, "critical");
    // The wire's own (pre-run) evaluation verdict is untouched — only the
    // presentation surfaces the live evidence ahead of it.
    assert.equal(view?.evaluation.status, "insufficient_data");
  });

  it("#526: live results merge ahead of persisted findings, ranked critical-first like any other findings set", () => {
    const payload: WirePillarStatsPayload = {
      findingsRunId: "run-older",
      pillars: [
        {
          pillar: "security",
          score: 55,
          evaluation: { status: "scored", evaluableSignalCount: 4, minRequiredSignals: 2, reason: "scored" },
          stats: [],
          findings: [
            { severity: "warning", checkKey: "identity:legacy-auth", title: "Legacy auth sign-ins detected" },
          ],
        },
      ],
      checkKeyPillars: {
        "identity:ca-policy-count": "security",
        "identity:legacy-auth": "security",
      },
    };
    const liveCheckResults = [
      {
        checkKey: "identity:ca-policy-count",
        checkLabel: "No enabled Conditional Access policies",
        status: "failed",
        severityMatched: "critical",
        index: 3,
        total: 40,
      },
    ];
    const view = buildPillarViews(payload, true, liveCheckResults).find((v) => v.key === "security");
    // Both findings survive — one from this run's live stream, one from the
    // older persisted run — and criticals lead regardless of which source.
    assert.deepEqual(
      view?.findings.map((f) => f.checkKey),
      ["identity:ca-policy-count", "identity:legacy-auth"],
    );
    assert.equal(view?.headline, "No enabled Conditional Access policies");
  });

  it("#526: a live result supersedes a persisted finding for the SAME checkKey rather than duplicating it", () => {
    const payload: WirePillarStatsPayload = {
      findingsRunId: "run-older",
      pillars: [
        {
          pillar: "security",
          score: 55,
          evaluation: { status: "scored", evaluableSignalCount: 4, minRequiredSignals: 2, reason: "scored" },
          stats: [],
          // The older run's title for this check — stale text a live re-run
          // should override, not sit beside.
          findings: [{ severity: "warning", checkKey: "identity:ca-policy-count", title: "stale title" }],
        },
      ],
      checkKeyPillars: { "identity:ca-policy-count": "security" },
    };
    const liveCheckResults = [
      {
        checkKey: "identity:ca-policy-count",
        checkLabel: "No enabled Conditional Access policies",
        status: "failed",
        severityMatched: "critical",
        index: 3,
        total: 40,
      },
    ];
    const view = buildPillarViews(payload, true, liveCheckResults).find((v) => v.key === "security");
    assert.equal(view?.findings.length, 1);
    assert.equal(view?.findings[0]?.title, "No enabled Conditional Access policies");
    assert.equal(view?.findings[0]?.severity, "critical");
  });

  it("#526: a live result for a checkKey absent from checkKeyPillars resolves to no pillar rather than a guessed one", () => {
    const payload: WirePillarStatsPayload = {
      findingsRunId: null,
      pillars: [
        {
          pillar: "security",
          score: null,
          evaluation: { status: "insufficient_data", evaluableSignalCount: 1, minRequiredSignals: 2, reason: "x" },
          stats: [],
          findings: [],
        },
      ],
      // No checkKeyPillars at all — an older payload, or a genuinely
      // unresolved check. Nothing here is client-side guessed from the
      // checkKey's own domain prefix.
    };
    const liveCheckResults = [
      {
        checkKey: "identity:ca-policy-count",
        checkLabel: "No enabled Conditional Access policies",
        status: "failed",
        severityMatched: "critical",
        index: 3,
        total: 40,
      },
    ];
    const view = buildPillarViews(payload, true, liveCheckResults).find((v) => v.key === "security");
    assert.deepEqual(view?.findings, []);
    assert.equal(view?.headline, SCANNING_PILLAR_CHIP);
  });

  it("#526: a live result classified as non-actionable (license_gap/error/requires_script) never becomes a chip", () => {
    const payload: WirePillarStatsPayload = {
      findingsRunId: null,
      pillars: [
        {
          pillar: "licensing",
          score: null,
          evaluation: { status: "insufficient_data", evaluableSignalCount: 1, minRequiredSignals: 2, reason: "x" },
          stats: [],
          findings: [],
        },
      ],
      checkKeyPillars: { "licensing:seat-check": "licensing" },
    };
    const liveCheckResults = [
      { checkKey: "licensing:seat-check", checkLabel: "Seat check", status: "license_gap", index: 1, total: 10 },
    ];
    const view = buildPillarViews(payload, true, liveCheckResults).find((v) => v.key === "licensing");
    assert.deepEqual(view?.findings, []);
    assert.equal(view?.headline, SCANNING_PILLAR_CHIP);
  });

  it("#526: buildJourneyView threads liveCheckResults through to its pillars", () => {
    const status: WireAssessmentStatus = { copilotGate: { score: null, threshold: 82, status: null } };
    const payload: WirePillarStatsPayload = {
      findingsRunId: null,
      pillars: [
        {
          pillar: "security",
          score: null,
          evaluation: { status: "insufficient_data", evaluableSignalCount: 1, minRequiredSignals: 2, reason: "x" },
          stats: [],
          findings: [],
        },
      ],
      checkKeyPillars: { "identity:ca-policy-count": "security" },
    };
    const view = buildJourneyView({
      tenant: TENANT,
      pillarStats: payload,
      status,
      scanRunning: true,
      liveCheckResults: [
        {
          checkKey: "identity:ca-policy-count",
          checkLabel: "No enabled Conditional Access policies",
          status: "failed",
          severityMatched: "critical",
          index: 3,
          total: 40,
        },
      ],
    });
    const security = view.pillars.find((p) => p.key === "security");
    assert.equal(security?.headline, "No enabled Conditional Access policies");
    assert.equal(security?.chipsAreReal, true);
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
    assert.deepEqual(view?.chips, ["14 accounts have no MFA", "14 accounts without mfa"]);
    assert.equal(view?.chipsAreReal, true);
  });

  // #520: this is the confirmed live bug — a resolvable stat used to suppress
  // every finding for its pillar outright. Security had 6 real findings (5
  // critical) this run and rendered only its "14 global administrators" stat
  // chip; none of the findings showed anywhere on the wedge.
  it("#520: a critical finding is never hidden just because a stat also resolved", () => {
    const payload: WirePillarStatsPayload = {
      pillars: [
        {
          pillar: "security",
          score: 22,
          stats: [
            { id: "security.globalAdmins", label: "global administrators", unit: "count", value: 14, checkKey: "identity:global-admin-count" },
          ],
          findings: [
            { severity: "critical", checkKey: "identity:ca-policy-count", title: "No Conditional Access policies configured" },
            { severity: "critical", checkKey: "identity:ca-mfa-coverage", title: "MFA not enforced by any policy" },
            { severity: "warning", checkKey: "identity:legacy-auth", title: "Legacy authentication protocols unblocked" },
          ],
        },
      ],
    };
    const view = buildPillarViews(payload).find((v) => v.key === "security");
    assert.deepEqual(view?.chips, [
      "No Conditional Access policies configured",
      "MFA not enforced by any policy",
      "Legacy authentication protocols unblocked",
      "14 global administrators",
    ]);
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

  // #534: #529 removed every cap so no real finding is ever hidden. The
  // always-visible presentation still needs one, but the underlying data must
  // stay fully uncapped so a caller (the "+N more" expand, the pillar header's
  // total-count badge) can recover the true count and the full list.
  it("#534: caps the finding chips at 3 while `findings` stays fully uncapped", () => {
    const findings: WirePillarFinding[] = Array.from({ length: 9 }, (_, i) => ({
      severity: "critical" as const,
      checkKey: `identity:check-${i}`,
      title: `Finding ${i}`,
      rankWeight: 9 - i,
    }));
    const payload: WirePillarStatsPayload = {
      pillars: [{ pillar: "security", score: 22, findings }],
    };
    const view = buildPillarViews(payload).find((v) => v.key === "security");
    assert.equal(view?.chips.length, 3);
    assert.deepEqual(view?.chips, ["Finding 0", "Finding 1", "Finding 2"]);
    // The real total a badge or "+N more" affordance reads — never truncated.
    assert.equal(view?.findings.length, 9);
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

describe("document generation (#643 — a fully hardcoded spine, matching the design preview exactly)", () => {
  /**
   * `buildGeneration` used to build its spine from `status.documents.expected`/
   * `.items` — the wire's own rows from `insightsGeneratedDocumentsTable`, the
   * abandoned Document Engine's bookkeeping — and deliberately refused a
   * hardcoded fallback (see this describe block's own git history for the test
   * that used to assert exactly that refusal). That was the right call while
   * these nine documents were genuinely generated by that pipeline; they no
   * longer are — every one of them renders live from the tenant's own scan data
   * (`DocumentBody`'s three live-render branches). Confirmed root cause of the
   * Full Remediation Guide going missing from the real customer nav: it had no
   * row on that old spine and no `withLiveDocuments`-style guarantee the other
   * eight already had. The fix is not another guarantee bolted on top — it is
   * this function no longer reading the wire's document bookkeeping at all, so
   * `buildGeneration` now takes no argument.
   */
  it("lists exactly the real nine documents, in the design's own order", () => {
    const g = buildGeneration();
    assert.equal(g.total, 9);
    assert.deepEqual(
      g.documents.map((d) => d.title),
      [...JOURNEY_LIVE_DOCUMENTS.map((d) => d.title), JOURNEY_REMEDIATION_DOCUMENT, JOURNEY_SOW_DOCUMENT],
    );
  });

  it("#643: the Full Remediation Guide is always listed — the confirmed live bug this closes", () => {
    const g = buildGeneration();
    assert.ok(
      g.documents.some((d) => d.title === JOURNEY_REMEDIATION_DOCUMENT && d.docType === JOURNEY_REMEDIATION_DOC_TYPE),
    );
  });

  it("matches the design preview's own nine-title list byte for byte", () => {
    const g = buildGeneration();
    assert.deepEqual(
      g.documents.map((d) => d.title),
      [...JOURNEY_DESIGN_DOCUMENTS],
    );
  });

  it("carries the real catalogue docType for every document, never a design-only slug", () => {
    const g = buildGeneration();
    assert.deepEqual(
      g.documents.map((d) => d.docType),
      [...JOURNEY_LIVE_DOCUMENTS.map((d) => d.docType), JOURNEY_REMEDIATION_DOC_TYPE, SOW_DOC_TYPE],
    );
  });

  it("every document is ready with no row id — nothing is generated, nothing is outstanding", () => {
    const g = buildGeneration();
    for (const doc of g.documents) {
      assert.equal(doc.status, "ready");
      assert.equal(doc.id, null, "no insights_generated_documents row backs a live-rendered document");
    }
    assert.equal(g.ready, g.total);
    assert.equal(g.allReady, true);
  });

  it("JOURNEY_LIVE_DOCUMENT_SPINE is the same nine entries buildGeneration renders from", () => {
    assert.deepEqual(
      buildGeneration().documents.map((d) => ({ docType: d.docType, title: d.title })),
      JOURNEY_LIVE_DOCUMENT_SPINE,
    );
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
  /**
   * Everything `withLiveDocuments` constructs: the registry's reports, PLUS the
   * Statement of Work. The SOW is deliberately not a registry member — it is an
   * interactive contract rather than a `(props: { view }) => ReactElement` — but
   * its content is computed live from the Sales Offer Engine with no stored
   * document row either, so it is listed on exactly the same basis.
   */
  const CONSTRUCTED = LIVE + 1;

  /**
   * `withLiveDocuments` is unchanged by #643 — it is still what
   * `RevealFullPicture` and the real page compose `buildGeneration()`'s own
   * (now always-full) output through. These fixtures are built by hand rather
   * than through `buildGeneration`, which after #643 takes no argument and
   * always returns the same fully-ready nine: `withLiveDocuments`'s own merge
   * behaviour — constructing a missing live report, leaving a real generated
   * row alone, never duplicating — is still real and still worth guarding on
   * inputs `buildGeneration` itself can no longer produce.
   */
  const EMPTY: JourneyGeneration = { ready: 0, total: 0, allReady: false, documents: [] };

  it("constructs every live report from a genuinely empty document set", () => {
    const g = withLiveDocuments(EMPTY);
    assert.equal(g.total, CONSTRUCTED);
    assert.equal(g.ready, CONSTRUCTED);
    assert.equal(g.documents[0].title, JOURNEY_READINESS_DOCUMENT);
    assert.equal(g.documents[0].docType, JOURNEY_READINESS_DOC_TYPE);
    for (const doc of g.documents.slice(0, LIVE)) {
      assert.equal(doc.status, "ready");
      assert.equal(doc.id, null, "no row exists, so no id may be claimed");
    }
  });

  /* ---------------------------------------------------------------- *
   * The Statement of Work — listed without any document-engine-sow.ts run
   * ---------------------------------------------------------------- */

  it("constructs the SOW from a genuinely empty document set, and puts it LAST", () => {
    const g = withLiveDocuments(EMPTY);
    const sow = g.documents[g.documents.length - 1];
    assert.equal(sow.title, JOURNEY_SOW_DOCUMENT);
    assert.equal(sow.docType, SOW_DOC_TYPE);
    assert.equal(sow.status, "ready", "nothing is outstanding — its scope is computed on demand");
    assert.equal(sow.id, null, "no insights_generated_documents row exists, so no id may be claimed");
  });

  it("the SOW closes the set even when some other document was already reported", () => {
    const base: JourneyGeneration = {
      ready: 0,
      total: 1,
      allReady: false,
      documents: [{ title: "Full Remediation Guide", docType: "remediation_plan", id: null, status: "pending" }],
    };
    const g = withLiveDocuments(base);
    assert.equal(g.documents[g.documents.length - 1].docType, SOW_DOC_TYPE);
    assert.equal(g.documents.filter((d) => d.docType === SOW_DOC_TYPE).length, 1);
  });

  it("marks a listed-but-never-generated SOW row ready rather than adding a second one", () => {
    const base: JourneyGeneration = {
      ready: 0,
      total: 1,
      allReady: false,
      documents: [{ title: "Your Statement of Work", docType: SOW_DOC_TYPE, id: null, status: "pending" }],
    };
    const g = withLiveDocuments(base);
    assert.equal(g.total, CONSTRUCTED, "the existing entry is replaced, never duplicated");
    const sow = g.documents.filter((d) => d.docType === SOW_DOC_TYPE);
    assert.equal(sow.length, 1);
    assert.equal(sow[0].status, "ready");
    assert.equal(sow[0].title, "Your Statement of Work", "the platform's own title for it is kept");
  });

  it("resolves the SOW on the design's title too, so a renamed docType cannot duplicate it", () => {
    const base: JourneyGeneration = {
      ready: 0,
      total: 1,
      allReady: false,
      documents: [{ title: JOURNEY_SOW_DOCUMENT, docType: "consolidated_sow", id: null, status: "pending" }],
    };
    const g = withLiveDocuments(base);
    assert.equal(g.documents.filter((d) => d.title === JOURNEY_SOW_DOCUMENT).length, 1);
    assert.equal(g.total, CONSTRUCTED);
  });

  it("leaves a genuinely generated SOW row alone, so its stored HTML and PDF keep working", () => {
    const base: JourneyGeneration = {
      ready: 1,
      total: 1,
      allReady: true,
      documents: [{ title: JOURNEY_SOW_DOCUMENT, docType: SOW_DOC_TYPE, id: 77, status: "ready" }],
    };
    const g = withLiveDocuments(base);
    const sow = g.documents.filter((d) => d.docType === SOW_DOC_TYPE);
    assert.equal(sow.length, 1);
    assert.equal(sow[0].id, 77, "the real row's id survives — it is what the PDF export needs");
  });

  it("leaves every other document exactly as it was reported", () => {
    const base: JourneyGeneration = {
      ready: 0,
      total: 1,
      allReady: false,
      documents: [{ title: "Full Remediation Guide", docType: "remediation_plan", id: null, status: "pending" }],
    };
    const g = withLiveDocuments(base);
    assert.equal(g.total, CONSTRUCTED + 1);
    assert.deepEqual(
      g.documents.map((d) => d.docType),
      [...JOURNEY_LIVE_DOCUMENTS.map((d) => d.docType), "remediation_plan", SOW_DOC_TYPE],
      "the live reports lead, in registry order; the reported set follows in its own; the SOW closes it",
    );
    // The reported one is the SAME object, not a rebuilt one.
    assert.equal(g.documents[LIVE], base.documents[0]);
    assert.equal(g.documents[LIVE].status, "pending", "the un-generated report is still pending");
  });

  it("recomputes ready/total off the list, so the counter cannot disagree with the rows", () => {
    const base: JourneyGeneration = {
      ready: 0,
      total: 1,
      allReady: false,
      documents: [{ title: "Full Remediation Guide", docType: "remediation_plan", id: null, status: "pending" }],
    };
    const g = withLiveDocuments(base);
    assert.equal(g.ready, CONSTRUCTED);
    assert.equal(g.total, CONSTRUCTED + 1);
    assert.equal(g.allReady, false);
  });

  it("marks a listed-but-never-generated live row ready — nothing is outstanding for it", () => {
    const base: JourneyGeneration = {
      ready: 0,
      total: 1,
      allReady: false,
      documents: [
        { title: "Copilot Readiness Assessment", docType: JOURNEY_READINESS_DOC_TYPE, id: null, status: "pending" },
      ],
    };
    const g = withLiveDocuments(base);
    assert.equal(g.total, CONSTRUCTED, "the existing entry is replaced, never duplicated");
    const row = readiness(g.documents)[0];
    assert.equal(row.status, "ready");
    assert.equal(row.title, "Copilot Readiness Assessment", "the platform's own title for it is kept");
  });

  it("leaves a genuinely generated live row completely alone", () => {
    // Every constructed document has a real generated row here — the registry's
    // reports AND the SOW — so there is nothing at all to add and the input
    // object is returned unchanged.
    const base: JourneyGeneration = {
      ready: 0,
      total: CONSTRUCTED,
      allReady: false,
      documents: [
        ...JOURNEY_LIVE_DOCUMENTS.map((d, i) => ({
          title: `Catalogue label ${i}`,
          docType: d.docType,
          id: 42 + i,
          status: "generating" as const,
        })),
        { title: "Catalogue label sow", docType: SOW_DOC_TYPE, id: 99, status: "generating" as const },
      ],
    };
    const g = withLiveDocuments(base);
    assert.equal(g, base, "an existing row owns its own state, including a failed one");
    assert.ok(g.documents.every((d) => d.status === "generating"));
  });

  it("never lists a report twice, whichever key it was matched on", () => {
    // The design's own title with a different docType — the second key
    // `liveDocumentFor` accepts.
    const base: JourneyGeneration = {
      ready: 0,
      total: 1,
      allReady: false,
      documents: [
        { title: JOURNEY_READINESS_DOCUMENT, docType: "some_other_key", id: null, status: "pending" },
      ],
    };
    const g = withLiveDocuments(base);
    assert.equal(readiness(g.documents).length, 1);
    assert.equal(g.total, CONSTRUCTED, "the title match resolved it; nothing was added for it");
    const row = readiness(g.documents)[0];
    assert.equal(row.docType, "some_other_key", "the platform's own key is kept");
    assert.equal(row.status, "ready");
  });

  it("is idempotent — applying it twice changes nothing", () => {
    const once = withLiveDocuments(buildGeneration());
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
    const empty: JourneyGeneration = { ready: 0, total: 0, allReady: false, documents: [] };
    const g = withLiveDocuments(empty);
    assert.equal(g.total, JOURNEY_LIVE_DOCUMENTS.length + 1);
    assert.deepEqual(
      g.documents.map((d) => d.docType),
      [...JOURNEY_LIVE_DOCUMENTS.map((d) => d.docType), SOW_DOC_TYPE],
      "added entries lead, in registry order; the SOW closes the set",
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

  it("#643: still lists the real nine documents with a completely absent status payload — the spine no longer depends on it", () => {
    const view = buildJourneyView({ tenant: TENANT, pillarStats: null, status: null });
    assert.equal(view.readinessScore, null);
    assert.equal(view.generation.total, 9);
    assert.equal(view.generation.ready, 9);
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

/* ------------------------------------------------------------------ *
 * #526 — this run's own live scanCheckResults, reshaped into pillar-
 * scoped findings using the server's own checkKey -> pillar resolution
 * ------------------------------------------------------------------ */

describe("liveFindingsByPillar", () => {
  it("classifies severity exactly like the persisted findings will (mirrors classifyCheckSeverity)", () => {
    const byPillar = liveFindingsByPillar(
      [
        { checkKey: "identity:ca-policy-count", checkLabel: "No CA policies", status: "failed", severityMatched: "critical", index: 1, total: 5 },
        { checkKey: "identity:legacy-auth", checkLabel: "Legacy auth", status: "failed", severityMatched: "medium", index: 2, total: 5 },
      ],
      { "identity:ca-policy-count": "security", "identity:legacy-auth": "security" },
    );
    const security = byPillar.get("security") ?? [];
    assert.deepEqual(
      security.map((f) => [f.checkKey, f.severity]),
      [
        ["identity:ca-policy-count", "critical"],
        ["identity:legacy-auth", "warning"],
      ],
    );
  });

  it("drops results that will never become a critical/warning finding — license_gap, error, requires_script, ok", () => {
    const byPillar = liveFindingsByPillar(
      [
        { checkKey: "a:1", checkLabel: "a1", status: "license_gap", index: 1, total: 4 },
        { checkKey: "a:2", checkLabel: "a2", status: "error", index: 2, total: 4 },
        { checkKey: "a:3", checkLabel: "a3", status: "requires_script", index: 3, total: 4 },
        { checkKey: "a:4", checkLabel: "a4", status: "ok", index: 4, total: 4 },
      ],
      { "a:1": "adoption", "a:2": "adoption", "a:3": "adoption", "a:4": "adoption" },
    );
    assert.equal(byPillar.size, 0);
  });

  it("skips a checkKey the server's own table has no pillar for, rather than guessing from its domain prefix", () => {
    const byPillar = liveFindingsByPillar(
      [{ checkKey: "identity:ca-policy-count", checkLabel: "No CA policies", status: "failed", severityMatched: "critical", index: 1, total: 5 }],
      {},
    );
    assert.equal(byPillar.size, 0);
  });

  it("returns nothing at all when the payload predates checkKeyPillars (undefined map)", () => {
    const byPillar = liveFindingsByPillar(
      [{ checkKey: "identity:ca-policy-count", checkLabel: "No CA policies", status: "failed", severityMatched: "critical", index: 1, total: 5 }],
      undefined,
    );
    assert.equal(byPillar.size, 0);
  });

  it("drops a checkKey resolving to `copilot` — not one of the six satellite pillars this journey renders", () => {
    const byPillar = liveFindingsByPillar(
      [{ checkKey: "copilot:overshare-exposure", checkLabel: "Overshare exposure", status: "failed", severityMatched: "critical", index: 1, total: 5 }],
      { "copilot:overshare-exposure": "copilot" },
    );
    assert.equal(byPillar.size, 0);
  });
});

describe("mergeLiveFindings", () => {
  it("prepends live findings ahead of persisted ones for distinct checkKeys", () => {
    const persisted: WirePillarFinding[] = [{ severity: "warning", checkKey: "b", title: "persisted" }];
    const live: WirePillarFinding[] = [{ severity: "critical", checkKey: "a", title: "live" }];
    assert.deepEqual(
      mergeLiveFindings(persisted, live).map((f) => f.checkKey),
      ["a", "b"],
    );
  });

  it("a live finding for the same checkKey as a persisted one replaces it, never duplicates it", () => {
    const persisted: WirePillarFinding[] = [{ severity: "warning", checkKey: "a", title: "stale" }];
    const live: WirePillarFinding[] = [{ severity: "critical", checkKey: "a", title: "fresh" }];
    const merged = mergeLiveFindings(persisted, live);
    assert.equal(merged.length, 1);
    assert.equal(merged[0]?.title, "fresh");
  });

  it("returns the persisted array untouched when there are no live findings", () => {
    const persisted: WirePillarFinding[] = [{ severity: "warning", checkKey: "a", title: "persisted" }];
    assert.deepEqual(mergeLiveFindings(persisted, []), persisted);
  });
});
