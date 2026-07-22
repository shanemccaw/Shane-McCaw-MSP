/**
 * Now served at /assessment (promoted in place; the file/component name and
 * its internal "/assessment-test" references are historical, from when this
 * was the candidate replacement). Wired to the REAL assessment backend: the
 * same GET /api/portal/assessment/status poll + diagnostics-run SSE +
 * doc-workflow SSE infrastructure already proven correct in
 * AssessmentGeneratingScreen / AssessmentWizard, via useAssessmentLiveStatus
 * (a direct mirror of that proven wiring — see that file's header for the
 * combined-progress rationale). The prior /assessment experience
 * (AssessmentShellPage / AssessmentWizard) is preserved at /assessment-legacy.
 *
 * REAL: hero progress bar + live status text (+ the wizard's same testbed-gated
 * debug scan trigger), Assessment Pipeline document stages, all SEVEN pillar
 * score gauges + the full-universe tenant-health radar, Overall M365 Health,
 * the License Optimization card (Cost Engine dollars via
 * status.stats.licenseWaste), the Copilot Readiness card (three real
 * sub-indicators + weighted overall via status.copilotReadiness), and the
 * per-finding recommended offers (real Sales Offer Engine candidates via
 * GET /portal/assessment/recommended-offers). Anything without real signal
 * coverage renders an honest "not covered"/"no data" state — never fabricated.
 *
 * STILL MOCK (deliberately — "wire everything first, then scope what actually
 * displays" is a separate follow-up step): the TelemetryBriefing item list
 * itself (titles/counts/narratives) and the modals' mock-only detail content.
 * Each mock item's `determinedBy` does reference the real check keys behind
 * that class of finding, and the offers attached to items are real.
 */
import React, { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { useAuth } from '@/lib/auth-context';
import { AssessmentHero } from '@/components/assessment-test/AssessmentHero';
import { ScoreGaugeGrid } from '@/components/assessment-test/ScoreGaugeGrid';
import { TelemetryBriefing } from '@/components/assessment-test/TelemetryBriefing';
import { AssessmentPipeline } from '@/components/assessment-test/AssessmentPipeline';
import { SneakPeekInsights } from '@/components/assessment-test/SneakPeekInsights';
import { TelemetryDetailModal } from '@/components/assessment-test/TelemetryDetailModal';
import { MetricGaugeModal } from '@/components/assessment-test/MetricGaugeModal';
import { ExportReportModal } from '@/components/assessment-test/ExportReportModal';
import { PipelineDocumentModal } from '@/components/assessment-test/PipelineDocumentModal';
import { useAssessmentLiveStatus } from '@/components/assessment-test/useAssessmentLiveStatus';

import { initialTelemetryItems } from '@/components/assessment-test/mockData';
import {
  MetricGauge,
  TelemetryItem,
  AssessmentStage,
  AssessmentStageStatus,
  RadarPillarEntry,
  RecommendedOffer,
} from '@/components/assessment-test/types';

// The full, confirmed 7-pillar universe this page shows — gauge row AND radar —
// in canonical display order. Keys match the backend's real HealthPillar keys
// (pillar-coverage.ts / health-engine.ts) plus "security".
// NOTE: "security" is not part of the backend's HEALTH_PILLARS today (the
// radar's pillar universe is governance/compliance/adoption/copilot/
// architecture/licensing), so the Security gauge/axis renders the honest
// "not covered by this scan" state until the backend adds a security pillar —
// per the no-fabrication rule, never a made-up score. The same rule applies
// uniformly: ANY pillar the customer's scanned package doesn't genuinely cover
// renders as not-covered, driven entirely by status.radar.pillars.
const GAUGE_PILLARS: { key: string; fallbackTitle: string }[] = [
  { key: 'security', fallbackTitle: 'Security Score' },
  { key: 'governance', fallbackTitle: 'Governance' },
  { key: 'compliance', fallbackTitle: 'Compliance' },
  { key: 'adoption', fallbackTitle: 'Adoption' },
  { key: 'copilot', fallbackTitle: 'Copilot Readiness' },
  { key: 'architecture', fallbackTitle: 'Architecture' },
  { key: 'licensing', fallbackTitle: 'Licensing' },
];

/** Telemetry finding category → the signal pillars whose offers address it.
 * Used to attach each real Sales Offer Engine candidate (which carries the
 * pillars of its fired signals) to the finding it remediates. */
const TELEMETRY_TYPE_PILLARS: Record<TelemetryItem['type'], string[]> = {
  security: ['security'],
  identity: ['security', 'governance'],
  groups: ['governance', 'compliance'],
  licenses: ['licensing', 'adoption'],
  copilot: ['copilot'],
};

/** Real backend document status → pipeline stage status. Same real status
 * values AssessmentGeneratingScreen maps (pending/generating/approved/
 * delivered/failed); a missing item row means generation hasn't reached that
 * document yet → honest greyed-out "pending" waiting state. */
function docStageStatus(itemStatus: string | undefined): AssessmentStageStatus {
  if (!itemStatus || itemStatus === 'pending') return 'pending';
  if (itemStatus === 'failed') return 'failed';
  if (itemStatus === 'approved' || itemStatus === 'delivered') return 'done';
  return 'in_progress'; // "generating" and any unknown-but-live status
}

export default function AssessmentTestPage() {
  const live = useAssessmentLiveStatus();
  const status = live.status;
  const { fetchWithAuth } = useAuth();

  const [telemetryItems, setTelemetryItems] = useState<TelemetryItem[]>(initialTelemetryItems);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');

  const [selectedTelemetryItem, setSelectedTelemetryItem] = useState<TelemetryItem | null>(null);
  const [selectedGauge, setSelectedGauge] = useState<MetricGauge | null>(null);
  const [selectedPipelineStage, setSelectedPipelineStage] = useState<AssessmentStage | null>(null);
  const [isExportOpen, setIsExportOpen] = useState(false);

  // ── REAL recommended offers — Sales Offer Engine candidates for this tenant.
  // Fetched once (the engine walks the full tenant profile; far too heavy for
  // the 4s status poll). Empty array = honestly no live offers.
  const [offers, setOffers] = useState<RecommendedOffer[]>([]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchWithAuth('/api/portal/assessment/recommended-offers', undefined, {
          silent: true,
        });
        if (!res.ok) return;
        const data = (await res.json()) as { offers?: RecommendedOffer[] };
        if (!cancelled && Array.isArray(data.offers)) setOffers(data.offers);
      } catch {
        // best-effort — findings simply show the honest "no offer" state
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchWithAuth]);

  /** Best real offer for a finding: engine candidates arrive score-ranked, so
   * the first whose signal pillars intersect the finding's category wins. */
  const offerForItem = (item: TelemetryItem): RecommendedOffer | null => {
    const pillars = TELEMETRY_TYPE_PILLARS[item.type] ?? [];
    return offers.find((o) => o.pillars.some((p) => pillars.includes(p))) ?? null;
  };

  // ── REAL pipeline stages — documents.expected × documents.items ────────────
  // `expected` carries every real document title up front (before any items
  // row exists), so the pipeline renders the full checklist by real name from
  // the start, each row in its real live status. Falls back to items-only when
  // an older-but-still-live backend doesn't send `expected` (same wire
  // boundary the wizard normalizes).
  const expectedDocs = status?.documents.expected ?? [];
  const docItems = status?.documents.items ?? [];
  const stages: AssessmentStage[] =
    expectedDocs.length > 0
      ? expectedDocs.map((d) => ({
          id: d.docType,
          title: d.title,
          status: docStageStatus(docItems.find((i) => i.docType === d.docType)?.status),
          documentId: docItems.find((i) => i.docType === d.docType)?.id,
        }))
      : docItems.map((d) => ({
          id: d.docType,
          title: d.title,
          status: docStageStatus(d.status),
          documentId: d.id,
        }));
  const activeStageId = stages.find((s) => s.status === 'in_progress')?.id ?? '';

  // ── REAL pillar gauges + radar axes — status.radar.pillars, package-aware ──
  // Only pillars the customer's actual scanned package genuinely covers carry
  // a score; the rest render the honest notCovered state (gauge) / no axis
  // (radar). Both surfaces read the same source so they can never disagree.
  const pillars = status?.radar.pillars ?? [];
  const gauges: MetricGauge[] = GAUGE_PILLARS.map(({ key, fallbackTitle }) => {
    const p = pillars.find((pl) => pl.pillar === key);
    return p
      ? { id: `pillar-${key}`, title: p.label, score: p.score }
      : { id: `pillar-${key}`, title: fallbackTitle, score: 0, notCovered: true };
  });
  const radarPillars: RadarPillarEntry[] = GAUGE_PILLARS.map(({ key, fallbackTitle }) => {
    const p = pillars.find((pl) => pl.pillar === key);
    return { key, label: p?.label ?? fallbackTitle, score: p ? p.score : null };
  });

  // ── REAL Overall M365 Health — same derivation as AssessmentGeneratingScreen
  // (avgScore: average of ALL covered pillars' real scores). Null (honest
  // em-dash card) when nothing is covered yet.
  const overallScore =
    pillars.length > 0
      ? Math.round(pillars.reduce((sum, p) => sum + p.score, 0) / pillars.length)
      : null;

  // Filter telemetry items by search query and category (item list STILL MOCK)
  const filteredTelemetry = telemetryItems.filter((item) => {
    const matchesCategory = selectedCategory === 'all' || item.type === selectedCategory;
    const matchesQuery =
      searchQuery.trim() === '' ||
      item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.architectSays.toLowerCase().includes(searchQuery.toLowerCase());

    return matchesCategory && matchesQuery;
  });

  const handleRemediateItem = (remediatedItem: TelemetryItem) => {
    setTelemetryItems((prev) => prev.filter((item) => item.id !== remediatedItem.id));
  };

  const handleOpenSneakPeekDetail = (cardName: string) => {
    if (cardName === 'security') {
      // Open the real security pillar gauge only if this scan actually covers
      // it — otherwise fall through to the telemetry category filter.
      const g = gauges.find((item) => item.id === 'pillar-security');
      if (g && !g.notCovered) setSelectedGauge(g);
      else setSelectedCategory('security');
    } else if (cardName === 'licenses') {
      // Licensing is now one of the seven gauges — open it when covered.
      const g = gauges.find((item) => item.id === 'pillar-licensing');
      if (g && !g.notCovered) setSelectedGauge(g);
      else setSelectedCategory('licenses');
    } else {
      setSelectedCategory(cardName);
    }
  };

  // ⚠️ TEMPORARY DEBUG — same render condition as AssessmentWizard's [DEBUG]
  // button (testbed customers only; server-side gate is the real enforcement).
  const showDebugTrigger = Boolean(
    status && !live.reportsComplete && status.isTestbed && !status.scan.active,
  );

  return (
    <AppShell title="Assessment Test">
    <div className="min-h-screen flex flex-col bg-[#101419] text-[#e0e2ea] antialiased">

      {/* Main Content Layout */}
      <main className="flex-grow pb-12 px-4 md:px-8 w-full max-w-[1440px] mx-auto py-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">

          {/* Left/Main Column (8 of 12 cols) */}
          <div className="lg:col-span-8 flex flex-col gap-4">

            {/* 1. Hero / Progress Section — REAL combined progress (scan 0–50%,
                documents 50–100%) + live phase-derived status text, both from
                the real SSE streams + status poll. The scan trigger is the
                wizard's same testbed-gated debug endpoint. */}
            <AssessmentHero
              progressPercentage={live.progressPercentage}
              activeStageTitle={live.activeStageTitle}
              isScanning={Boolean(status?.scan.active) || live.debugTriggering}
              onTriggerScan={() => void live.debugTriggerScan()}
              showDebugTrigger={showDebugTrigger}
              debugTriggering={live.debugTriggering}
              everScanned={Boolean(status?.scan.everScanned)}
            />

            {/* 1b. Honest failure/blocked callouts — same reassurance pattern
                as AssessmentWizard's scan/document failure banner: a real,
                calm "this part didn't work" state that never blanks the rest
                of the page. Everything below (gauges/pipeline/telemetry)
                keeps rendering whatever real data it already has. */}
            {(live.scanFailed || live.reportsFailed) && (
              <div className="rounded-xl border border-[#f87171]/30 bg-[#f87171]/5 p-4 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-[#f87171] flex-shrink-0 mt-0.5" />
                <div className="text-xs leading-relaxed text-[#c0c7d3]">
                  <p className="font-semibold text-[#f87171] mb-1">
                    {live.scanFailed
                      ? "We couldn't finish reading your Microsoft 365 environment."
                      : "We couldn't finish preparing your assessment documents."}
                  </p>
                  <p>
                    This is on us — nothing you did caused it
                    {live.scanFailed ? '' : ', and your scan data is safe'}. Our team has
                    been notified and this page keeps checking automatically, so anything
                    already completed below is real and safe to use.
                  </p>
                </div>
              </div>
            )}

            {!live.scanFailed && !live.reportsFailed && status?.docGeneration?.blocked && (
              <div className="rounded-xl border border-[#f59e0b]/30 bg-[#f59e0b]/5 p-4 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-[#f59e0b] flex-shrink-0 mt-0.5" />
                <div className="text-xs leading-relaxed text-[#c0c7d3]">
                  <p className="font-semibold text-[#f59e0b] mb-1">
                    Not enough of your tenant scanned to safely generate documents yet.
                  </p>
                  <p>
                    Your scan finished, but too few checks came back with real data to
                    write an accurate report. The gauges and findings below show exactly
                    what we do have — nothing fabricated to fill the gap.
                  </p>
                </div>
              </div>
            )}

            {/* 2. Score Gauges — all 7 real pillar cards. Overall M365 Health
                lives in the right-column SneakPeekInsights panel, not here. */}
            <ScoreGaugeGrid
              gauges={gauges}
              onSelectGauge={(gauge) => {
                if (!gauge.notCovered) setSelectedGauge(gauge);
              }}
            />

            {/* 3. Telemetry Briefing (item list STILL MOCK — scoped in a later
                step; the attached recommended offers are REAL) */}
            <TelemetryBriefing
              items={filteredTelemetry}
              onSelectItem={(item) => setSelectedTelemetryItem(item)}
              selectedCategory={selectedCategory}
              setSelectedCategory={setSelectedCategory}
              offerFor={offerForItem}
            />

          </div>

          {/* Right Column (4 of 12 cols) Sticky Sidebar */}
          <div className="lg:col-span-4 sticky top-20 flex flex-col gap-4">

            {/* Assessment Pipeline Progress — REAL document stages */}
            <AssessmentPipeline
              stages={stages}
              activeStageId={activeStageId}
              onSelectStage={(stage) => setSelectedPipelineStage(stage)}
            />

            {/* Sneak Peek Insights — REAL: overall health, 7-pillar radar,
                Cost Engine license savings, Copilot readiness sub-indicators */}
            <SneakPeekInsights
              overallScore={overallScore}
              pillarCount={pillars.length}
              radarPillars={radarPillars}
              licenseWaste={status?.stats.licenseWaste ?? null}
              copilotReadiness={status?.copilotReadiness ?? null}
              onOpenCardDetail={handleOpenSneakPeekDetail}
            />

          </div>

        </div>
      </main>

      {/* Modals & Dialogs */}
      <TelemetryDetailModal
        item={selectedTelemetryItem}
        onClose={() => setSelectedTelemetryItem(null)}
        onRemediate={handleRemediateItem}
        offer={selectedTelemetryItem ? offerForItem(selectedTelemetryItem) : null}
      />

      <MetricGaugeModal
        gauge={selectedGauge}
        onClose={() => setSelectedGauge(null)}
      />

      <ExportReportModal
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
      />

      {/* Real stages are server-derived — the mock "accept plan" local
          mutation no longer applies, so no onAcceptPlan is passed. `stages`
          is passed through so the modal's document navigator can move
          between every real generated document for this assessment. */}
      <PipelineDocumentModal
        stage={selectedPipelineStage}
        stages={stages}
        onClose={() => setSelectedPipelineStage(null)}
        onSelectStage={(stage) => setSelectedPipelineStage(stage)}
        fetchWithAuth={fetchWithAuth}
      />

    </div>
    </AppShell>
  );
}
