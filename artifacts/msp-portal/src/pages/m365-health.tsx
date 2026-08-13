/**
 * /m365-health — the M365 Health overview page, wired to REAL data end to end
 * (formerly the mock "Tenant Health Score" structure-only page).
 *
 * Real sources (all pre-existing endpoints — see useM365HealthLive.ts):
 *   • GET  /api/portal/assessment/status          — package-aware pillar radar
 *     (the primary M365 Health score = average of genuinely covered pillars,
 *     same derivation as /assessment), Cost Engine license-waste summary
 *     (Annual Cost Savings = real annualCents), Copilot readiness.
 *   • GET  /api/portal/mission-control/overview   — real findings feed with
 *     server-linked remediation offers (Intelligence Signals).
 *   • POST /api/dashboard/resolve                 — the 14 drift.* metrics +
 *     identity/policy risk counts (Risk Heat Map), usage.* adoption counts,
 *     licensing.wasteEstimateBreakdown (per-SKU cost breakdown), and — via
 *     includeHistory — the real Security Trends series (tenant_engine_snapshots
 *     / tenant_monitor_profiles history; see SECURITY_TREND_METRICS).
 *
 * Security Trends renders REAL history with an honest "not enough history yet"
 * empty state for brand-new tenants — the seeded Live Activity Monitor
 * workflow (5-minute cadence per consented tenant) fills it in genuinely over
 * the customer's first day; nothing is fabricated to bridge the gap.
 *
 * DELIBERATELY HIDDEN (v2 backlog, code preserved — do not delete):
 *   • Risk Reduction (CostAndRiskRow.tsx) — not rendered; its savings-split
 *     percentages and "84% risk reduction" figure have no real data source,
 *     and no real, defensible formula exists for it regardless of data volume.
 */
import React, { useState } from 'react';
import { useLocation } from 'wouter';
import { AppShell } from '@/components/app-shell';
import { HeroHealthScore } from '@/components/m365-health/HeroHealthScore';
import { IntelligenceCore } from '@/components/m365-health/IntelligenceCore';
import { PillarGrid } from '@/components/m365-health/PillarGrid';
import { TrendsRow } from '@/components/m365-health/TrendsRow';
import { IntelligenceSignals } from '@/components/m365-health/IntelligenceSignals';
import { ExecutiveCtaBar } from '@/components/m365-health/ExecutiveCtaBar';
import { PillarDetailModal } from '@/components/m365-health/PillarDetailModal';
import { RemediationModal } from '@/components/m365-health/RemediationModal';
import { useM365HealthLive, LiveFinding } from '@/components/m365-health/useM365HealthLive';

export default function M365HealthPage() {
  const [, navigate] = useLocation();
  const live = useM365HealthLive();

  const [selectedPillarKey, setSelectedPillarKey] = useState<string | null>(null);
  const [remediationFinding, setRemediationFinding] = useState<LiveFinding | null>(null);

  const pillars = live.status?.radar.pillars ?? [];
  const licenseWaste = live.status?.stats.licenseWaste ?? null;

  const handleRemediateFinding = (finding: LiveFinding) => {
    setRemediationFinding(finding);
  };

  return (
    <AppShell title="M365 Health">
      <div className="min-h-screen relative">
        <main className="relative max-w-[1440px] mx-auto px-4 sm:px-6 py-6 md:py-8 space-y-6">
          {/* 1. Hero — real M365 Health score + real cost/findings/readiness stats */}
          <HeroHealthScore
            pillars={pillars}
            healthScore={live.healthScore}
            annualSavingsCents={licenseWaste?.annualCents ?? null}
            genuineFindings={live.status?.stats.genuineFindings ?? null}
            copilotReadiness={live.status?.copilotReadiness?.overall.score ?? null}
            everScanned={Boolean(live.status?.scan.everScanned)}
            onSelectPillar={setSelectedPillarKey}
          />

          {/* 2. Pillar cards — directly below the hero (all 7, honest coverage) */}
          <PillarGrid
            pillars={pillars}
            onSelectPillar={setSelectedPillarKey}
            selectedPillarKey={selectedPillarKey ?? undefined}
          />

          {/* 3. Intelligence Core — real radar, risk heatmap, per-SKU cost */}
          <IntelligenceCore
            pillars={pillars}
            metrics={live.metrics}
            onSelectPillar={setSelectedPillarKey}
          />

          {/* 4. Trends — real Security Trends history (honest empty state until
              monitoring history accumulates), real Copilot-readiness breakdown,
              and real adoption counts. */}
          <TrendsRow
            copilotReadiness={live.status?.copilotReadiness ?? null}
            metrics={live.metrics}
          />

          {/* CostAndRiskRow deliberately not rendered — Risk Reduction is
              backlogged for v2 (no real data source yet; code preserved). */}

          {/* 5. Intelligence Signals — real findings + linked offers */}
          <IntelligenceSignals
            findings={live.overview?.findings ?? []}
            loaded={live.loaded}
            onRemediateFinding={handleRemediateFinding}
          />

          {/* 6. Executive CTA — real navigation only */}
          <ExecutiveCtaBar
            onOpenOffers={() => navigate('/customer-offers')}
          />
        </main>

        {/* Modals */}
        <PillarDetailModal
          pillarKey={selectedPillarKey}
          pillars={pillars}
          onClose={() => setSelectedPillarKey(null)}
          onNavigate={(route) => {
            setSelectedPillarKey(null);
            navigate(route);
          }}
        />

        <RemediationModal
          finding={remediationFinding}
          onClose={() => setRemediationFinding(null)}
          onOpenOffers={() => {
            setRemediationFinding(null);
            navigate('/customer-offers');
          }}
        />
      </div>
    </AppShell>
  );
}
