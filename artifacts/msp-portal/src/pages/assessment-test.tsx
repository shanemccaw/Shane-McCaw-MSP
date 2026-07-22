/**
 * /assessment-test — the candidate replacement for /assessment's generating
 * experience, wired to the REAL assessment backend (this task): the same
 * GET /api/portal/assessment/status poll + diagnostics-run SSE + doc-workflow
 * SSE infrastructure already proven correct in AssessmentGeneratingScreen /
 * AssessmentWizard, via useAssessmentLiveStatus (a direct mirror of that
 * proven wiring — see that file's header for the combined-progress rationale).
 *
 * REAL (this task): hero progress bar + live status text, Assessment Pipeline
 * document stages, the four pillar score gauges, and the Overall M365 Health
 * card. Uncovered pillars render an honest "not covered" state — never a
 * fabricated score.
 *
 * STILL MOCK (deliberately — "wire everything first, then scope what actually
 * displays" is a separate follow-up step): TelemetryBriefing items, the
 * SneakPeekInsights panel, and the modals' mock-only detail content.
 */
import React, { useState } from 'react';
import { AppShell } from '@/components/app-shell';
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

import {
  initialTelemetryItems,
  mockTenantHealth,
  mockLicenseOptimization,
  mockCopilotReadiness,
} from '@/components/assessment-test/mockData';
import {
  MetricGauge,
  TelemetryItem,
  AssessmentStage,
  AssessmentStageStatus,
} from '@/components/assessment-test/types';

// The four pillar gauges this page shows, in display order. Keys match the
// backend's real HealthPillar keys (pillar-coverage.ts / health-engine.ts).
// NOTE: "security" is not part of the backend's HEALTH_PILLARS today (the
// radar's pillar universe is governance/compliance/adoption/copilot/
// architecture/licensing), so the Security gauge renders the honest
// "not covered by this scan" state until the backend adds a security pillar —
// per the no-fabrication rule, never a made-up score.
const GAUGE_PILLARS: { key: string; fallbackTitle: string }[] = [
  { key: 'security', fallbackTitle: 'Security Score' },
  { key: 'governance', fallbackTitle: 'Governance' },
  { key: 'compliance', fallbackTitle: 'Compliance' },
  { key: 'copilot', fallbackTitle: 'Copilot Readiness' },
];

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

  const [telemetryItems, setTelemetryItems] = useState<TelemetryItem[]>(initialTelemetryItems);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');

  const [selectedTelemetryItem, setSelectedTelemetryItem] = useState<TelemetryItem | null>(null);
  const [selectedGauge, setSelectedGauge] = useState<MetricGauge | null>(null);
  const [selectedPipelineStage, setSelectedPipelineStage] = useState<AssessmentStage | null>(null);
  const [isExportOpen, setIsExportOpen] = useState(false);

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
        }))
      : docItems.map((d) => ({
          id: d.docType,
          title: d.title,
          status: docStageStatus(d.status),
        }));
  const activeStageId = stages.find((s) => s.status === 'in_progress')?.id ?? '';

  // ── REAL pillar gauges — status.radar.pillars, package-aware ───────────────
  // Only pillars the customer's actual scanned package genuinely covers carry
  // a score; the rest render the honest notCovered state.
  const pillars = status?.radar.pillars ?? [];
  const gauges: MetricGauge[] = GAUGE_PILLARS.map(({ key, fallbackTitle }) => {
    const p = pillars.find((pl) => pl.pillar === key);
    return p
      ? { id: `pillar-${key}`, title: p.label, score: p.score }
      : { id: `pillar-${key}`, title: fallbackTitle, score: 0, notCovered: true };
  });

  // ── REAL Overall M365 Health — same derivation as AssessmentGeneratingScreen
  // (avgScore: average of ALL covered pillars' real scores, not just the four
  // shown as gauges). Null (honest em-dash card) when nothing is covered yet.
  const overallScore =
    pillars.length > 0
      ? Math.round(pillars.reduce((sum, p) => sum + p.score, 0) / pillars.length)
      : null;

  // Filter telemetry items by search query and category (STILL MOCK)
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
      // No real license gauge exists on this page (licensing is a radar pillar
      // but not one of the four shown) — use the category filter instead.
      setSelectedCategory('licenses');
    } else {
      setSelectedCategory(cardName);
    }
  };

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
            />

            {/* 2. Score Gauges (4 real pillar cards). Overall M365 Health
                lives in the right-column SneakPeekInsights panel, not here. */}
            <ScoreGaugeGrid
              gauges={gauges}
              onSelectGauge={(gauge) => {
                if (!gauge.notCovered) setSelectedGauge(gauge);
              }}
            />

            {/* 3. Telemetry Briefing (STILL MOCK — scoped in a later step) */}
            <TelemetryBriefing
              items={filteredTelemetry}
              onSelectItem={(item) => setSelectedTelemetryItem(item)}
              selectedCategory={selectedCategory}
              setSelectedCategory={setSelectedCategory}
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

            {/* Sneak Peek Insights (STILL MOCK — scoped in a later step) */}
            <SneakPeekInsights
              overallScore={overallScore}
              pillarCount={pillars.length}
              tenantHealth={mockTenantHealth}
              licenseOpt={mockLicenseOptimization}
              copilotReadiness={mockCopilotReadiness}
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
          mutation no longer applies, so no onAcceptPlan is passed. */}
      <PipelineDocumentModal
        stage={selectedPipelineStage}
        onClose={() => setSelectedPipelineStage(null)}
      />

    </div>
    </AppShell>
  );
}
