/**
 * telemetryComparison.test.ts — #245 (Copilot Assessment epic #183).
 *
 * The server half — that the real engine produces genuinely different numbers
 * for two different real scans — is covered by api-server's
 * telemetry-comparison.test.ts. What this file pins down is the other half of
 * what Shane asked for: the right panel MOVES WHILE THE SCAN IS RUNNING, off
 * real per-check results, and is not a final-state snapshot.
 *
 * The mid-scan claim is not free. A run's `msp_diagnostic_findings` rows are all
 * written in one batch after its last check finishes (diagnostics-runner.ts step
 * 4), so during the run the only real, this-run view of findings is the run's
 * own per-check SSE stream. These tests replay a real stream event-by-event and
 * assert the card genuinely changes as each check lands — and that the severity
 * it shows mid-scan is the same one the persisted finding will carry.
 *
 * Run with Node's own test runner (msp-portal has no vitest):
 *   pnpm --filter @workspace/msp-portal test
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  actualGaugeScore,
  classifyLiveCheckSeverity,
  deriveLiveDiscrepancies,
  selectDiscrepancies,
  toGapBars,
  toPillarViews,
  type LiveCheckResult,
  type TelemetryComparisonPayload,
} from './telemetryComparison.ts';

// ── Two real payload shapes, as the endpoint returns them for two real scans ───
//
// Scan A: a healthier tenant. Scan B: the same estate after MFA was switched off
// and legacy auth left on — more signals fired, so several pillars drop. These
// are the shapes api-server's buildTelemetryComparison produces; the numbers
// there are asserted against the real engine in its own test.

function payload(
  overallDisplay: number | null,
  pillarScores: Partial<Record<string, number | null>>,
  findings: TelemetryComparisonPayload['findings'] = [],
  extra: Partial<TelemetryComparisonPayload> = {},
): TelemetryComparisonPayload {
  const order = [
    ['governance', 'Governance'],
    ['compliance', 'Compliance'],
    ['adoption', 'Adoption'],
    ['copilot', 'Copilot Readiness'],
    ['architecture', 'Architecture'],
    ['licensing', 'Licensing'],
    ['security', 'Security'],
  ] as const;

  return {
    overall: { rawRiskScore: 0, displayScore: overallDisplay },
    pillars: order.map(([pillar, label]) => ({
      pillar,
      label,
      displayScore: pillarScores[pillar] ?? null,
      rawRiskScore: 0,
    })),
    findings,
    findingsRunId: 'run-a',
    findingsRunStatus: 'completed',
    activeRunId: null,
    selfAssessment: null,
    generatedAt: '2026-07-31T10:00:00.000Z',
    ...extra,
  };
}

const SCAN_A = payload(78, {
  governance: 90,
  compliance: 84,
  adoption: 61,
  copilot: 72,
  architecture: 88,
  licensing: 55,
  security: 95,
});

const SCAN_B = payload(52, {
  governance: 60,
  compliance: 51,
  adoption: 61,
  copilot: 40,
  architecture: 47,
  licensing: 55,
  security: 30,
});

describe('two different real scans render genuinely different panels', () => {
  it('the Actual Telemetry gauge differs', () => {
    assert.equal(actualGaugeScore(SCAN_A), 78);
    assert.equal(actualGaugeScore(SCAN_B), 52);
    assert.notEqual(actualGaugeScore(SCAN_A), actualGaugeScore(SCAN_B));
  });

  it('the radar plots the seven REAL pillars, and their axes move between scans', () => {
    const a = toPillarViews(SCAN_A);
    const b = toPillarViews(SCAN_B);

    assert.deepEqual(
      a.map((p) => p.pillar),
      ['governance', 'compliance', 'adoption', 'copilot', 'architecture', 'licensing', 'security'],
    );

    const byPillarA = new Map(a.map((p) => [p.pillar, p.actual]));
    const byPillarB = new Map(b.map((p) => [p.pillar, p.actual]));
    for (const pillar of ['governance', 'compliance', 'copilot', 'architecture', 'security'] as const) {
      assert.notEqual(byPillarB.get(pillar), byPillarA.get(pillar), `${pillar} should differ between scans`);
    }
    // Pillars whose real signals didn't change must NOT move.
    assert.equal(byPillarB.get('adoption'), byPillarA.get('adoption'));
    assert.equal(byPillarB.get('licensing'), byPillarA.get('licensing'));
  });

  it('gap bars are the same real numbers as the radar, worst exposure first', () => {
    const radar = new Map(toPillarViews(SCAN_B).map((p) => [p.pillar, p.actual]));
    const bars = toGapBars(SCAN_B);

    for (const bar of bars) {
      assert.equal(bar.actual, radar.get(bar.pillar), 'a gap bar must read the same pillar score as its radar axis');
      assert.equal(bar.gap, 100 - bar.actual);
    }
    // Security (30) is the worst real pillar in scan B, so it leads.
    assert.equal(bars[0]?.pillar, 'security');
    assert.deepEqual(
      bars.map((b) => b.gap),
      [...bars.map((b) => b.gap)].sort((x, y) => y - x),
    );
  });

  it('never zero-fills a pillar the engine has no real data for', () => {
    const partial = payload(70, { governance: 70, security: 66 });
    const views = toPillarViews(partial);
    assert.deepEqual(
      views.map((v) => v.pillar),
      ['governance', 'security'],
      'pillars with a null displayScore are omitted, not rendered as 0',
    );
  });

  it('reports "no data" rather than a number when the engine genuinely has none', () => {
    assert.equal(actualGaugeScore(payload(null, {})), null);
    assert.equal(actualGaugeScore(null), null);
  });
});

// ── The mid-scan claim ────────────────────────────────────────────────────────

/** A real run's per-check stream, in the order diagnostics-runner emits it. */
const REAL_STREAM: LiveCheckResult[] = [
  { checkKey: 'identity:mfa-enforced', checkLabel: 'MFA enforcement', status: 'ok', severityMatched: null, index: 0, total: 6 },
  { checkKey: 'identity:ca-policy-count', checkLabel: 'Conditional Access policies', status: 'ok', severityMatched: 'critical', index: 1, total: 6 },
  { checkKey: 'security:secure-score', checkLabel: 'Microsoft Secure Score', status: 'error', errorMessage: 'Graph returned 403 for this check.', index: 2, total: 6 },
  { checkKey: 'copilot:prereqs', checkLabel: 'Copilot prerequisites', status: 'license_gap', index: 3, total: 6 },
  { checkKey: 'governance:label-coverage', checkLabel: 'Sensitivity label coverage', status: 'ok', severityMatched: 'medium', index: 4, total: 6 },
  { checkKey: 'adoption:teams-usage', checkLabel: 'Teams usage', status: 'ok', severityMatched: null, index: 5, total: 6 },
];

describe('Top Discrepancies moves DURING the scan, off real per-check results', () => {
  it('grows check by check as the real stream arrives — not one jump at the end', () => {
    const countsAfterEachCheck = REAL_STREAM.map((_, i) =>
      deriveLiveDiscrepancies(REAL_STREAM.slice(0, i + 1)).length,
    );

    // 1 ok → 0; +critical-matched → 1; +error → still 1 (a check-execution
    // failure is not a finding to fix, #522); +license_gap → still 1 (a missing
    // SKU is not a finding to fix either); +medium-matched → 2; +ok → 2.
    assert.deepEqual(countsAfterEachCheck, [0, 1, 1, 1, 2, 2]);

    // The panel genuinely changed several times mid-run, well before the run
    // ended — which is the whole point of #245's live requirement.
    const distinctStates = new Set(countsAfterEachCheck).size;
    assert.ok(distinctStates >= 3, `expected the card to move mid-scan, saw ${distinctStates} distinct states`);
  });

  it('classifies a live check exactly as the server will when it persists the finding', () => {
    // Mirrors diagnostics-runner.ts's classifyCheckSeverity, branch for branch.
    assert.equal(classifyLiveCheckSeverity({ ...REAL_STREAM[0]!, status: 'consent_revoked' }), 'critical');
    assert.equal(classifyLiveCheckSeverity({ ...REAL_STREAM[0]!, status: 'error' }), null);
    assert.equal(classifyLiveCheckSeverity({ ...REAL_STREAM[0]!, status: 'requires_script' }), null);
    assert.equal(classifyLiveCheckSeverity({ ...REAL_STREAM[0]!, status: 'license_gap' }), null);
    assert.equal(classifyLiveCheckSeverity({ ...REAL_STREAM[0]!, status: 'ok', severityMatched: 'high' }), 'critical');
    assert.equal(classifyLiveCheckSeverity({ ...REAL_STREAM[0]!, status: 'ok', severityMatched: 'medium' }), 'warning');
    assert.equal(classifyLiveCheckSeverity({ ...REAL_STREAM[0]!, status: 'ok', severityMatched: 'low' }), null);
    assert.equal(classifyLiveCheckSeverity({ ...REAL_STREAM[0]!, status: 'ok', severityMatched: null }), null);
  });

  it('shows critical first, and carries each real check’s own detail — no scripted text', () => {
    const items = deriveLiveDiscrepancies(REAL_STREAM);
    assert.deepEqual(
      items.map((i) => i.severity),
      ['critical', 'warning'],
    );
    assert.equal(items[0]?.checkKey, 'identity:ca-policy-count');
    // A check-execution error is a technical failure, not a customer-facing
    // finding (#522) — it must never appear in the discrepancies list.
    assert.ok(
      !items.some((i) => i.checkKey === 'security:secure-score'),
      'a check-execution error must not surface as a discrepancy',
    );
    // The strings the old hardcoded generator always emitted are gone.
    for (const item of items) {
      assert.ok(!item.detail.includes('62%'), 'no hardcoded "Unlabeled files (62%)" text');
      assert.ok(!item.detail.includes('14 SharePoint sites'), 'no hardcoded oversharing text');
    }
  });

  it('does not count a redelivered check twice (the stream replays cached state on connect)', () => {
    const withReplay = [...REAL_STREAM, REAL_STREAM[2]!];
    assert.equal(
      deriveLiveDiscrepancies(withReplay).length,
      deriveLiveDiscrepancies(REAL_STREAM).length,
    );
  });
});

describe('which real source the card shows, and when', () => {
  const persisted = payload(52, { security: 30 }, [
    {
      findingId: 'f-1',
      checkKey: 'identity:legacy-auth',
      checkLabel: 'Legacy authentication',
      severity: 'critical',
      title: 'Legacy auth enabled',
      description: 'Legacy authentication protocols are still enabled on this tenant.',
      category: 'security',
    },
  ]);

  it('a running scan shows ITS OWN live results, never the previous run’s findings', () => {
    const shown = selectDiscrepancies({
      payload: { ...persisted, activeRunId: 'run-b' },
      liveCheckResults: REAL_STREAM.slice(0, 3),
      streaming: true,
    });
    assert.equal(shown.source, 'live');
    assert.equal(shown.runId, 'run-b');
    assert.ok(
      !shown.items.some((i) => i.checkKey === 'identity:legacy-auth'),
      'the previous run’s persisted finding must not be presented as this run’s',
    );
  });

  it('falls back to the persisted findings once no run is streaming', () => {
    const shown = selectDiscrepancies({ payload: persisted, liveCheckResults: [], streaming: false });
    assert.equal(shown.source, 'persisted');
    assert.equal(shown.runId, 'run-a');
    assert.equal(shown.items[0]?.checkKey, 'identity:legacy-auth');
    assert.equal(shown.items[0]?.live, false);
  });

  it('reports "none" honestly rather than inventing a discrepancy', () => {
    const shown = selectDiscrepancies({ payload: payload(90, {}), liveCheckResults: [], streaming: false });
    assert.equal(shown.source, 'none');
    assert.deepEqual(shown.items, []);
  });

  it('a run that has streamed nothing yet still shows the last real findings, labelled as theirs', () => {
    const shown = selectDiscrepancies({ payload: persisted, liveCheckResults: [], streaming: true });
    assert.equal(shown.source, 'persisted');
    assert.equal(shown.runId, 'run-a', 'labelled with the run the findings actually belong to');
  });
});
