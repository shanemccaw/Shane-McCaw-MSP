/**
 * /licensing — Licensing topic page, wired to REAL data end to end (formerly
 * a mock structure-only page: invented SKU table, per-department hygiene
 * grid, fake waste pie chart, mock Copilot engagement gauge, and fake
 * patch/auto-assign automation).
 *
 * Real sources (all pre-existing endpoints — see
 * health-suite/useTopicHealthLive.ts):
 *   • GET  /api/portal/assessment/status        — the real Licensing pillar
 *     score + the Cost Engine's real license-waste summary (monthly/annual
 *     cents, seat/SKU counts, top waste SKU) + the Copilot readiness block.
 *   • GET  /api/portal/mission-control/overview — real findings + linked
 *     remediation offers, topic-scoped by transparent keyword filter.
 *   • POST /api/dashboard/resolve               — licensing.wasteEstimateBreakdown
 *     (real per-SKU waste dollars), inactive/duplicate license checks (with
 *     real history), and the Copilot license-readiness signal.
 *
 * Content-loss note (mockup Header removal): the removed Header held
 * time-range/department filters and refresh/export controls driving mock data
 * only — no real display content to restore.
 *
 * HONEST GAPS (stated in the UI): full per-SKU assigned-vs-purchased
 * inventory (the check collects it; needs a small resolver transform on
 * existing infrastructure), per-department hygiene, per-user Copilot
 * engagement telemetry (not collected), and licensing.costTrend
 * (not_collected in the registry).
 */
import React, { useState } from 'react';
import { useLocation } from 'wouter';
import { AppShell } from '@/components/app-shell';
import { SkuInventory } from '@/components/licensing/SkuInventory';
import { AssignmentHygiene } from '@/components/licensing/AssignmentHygiene';
import { WasteDistribution } from '@/components/licensing/WasteDistribution';
import { CopilotEngagement } from '@/components/licensing/CopilotEngagement';
import { TopicHero, HeroStat } from '@/components/health-suite/TopicHero';
import { DailyTrendPanel } from '@/components/health-suite/DailyTrendPanel';
import { TopicFindings } from '@/components/health-suite/TopicFindings';
import { AutomationOpportunities } from '@/components/health-suite/AutomationOpportunities';
import { TopicRemediationModal } from '@/components/health-suite/TopicRemediationModal';
import {
  useTopicHealthLive,
  filterFindingsByTopic,
  resolvedValue,
  TopicFinding,
} from '@/components/health-suite/useTopicHealthLive';

const METRIC_KEYS = [
  'licensing.wasteEstimateBreakdown',
  'licensing.inactiveLicenseCount',
  'licensing.duplicateLicenseCount',
  'licensing.skuBreakdown',
  'licensing.copilotLicenseBreakdown',
  'copilot.usagePerUser',
  'drift.licenseAssignmentDriftCount',
];

const HISTORY_KEYS = ['licensing.inactiveLicenseCount', 'licensing.duplicateLicenseCount'];

const TOPIC_KEYWORDS = [
  'licens',
  'sku',
  'seat',
  'waste',
  'cost',
  'inactive',
  'duplicate',
  'copilot',
  'subscription',
];

export default function LicensingPage() {
  const [, navigate] = useLocation();
  const live = useTopicHealthLive({
    pillar: 'licensing',
    metricKeys: METRIC_KEYS,
    historyKeys: HISTORY_KEYS,
  });
  const [remediationFinding, setRemediationFinding] = useState<TopicFinding | null>(null);

  const allFindings = live.overview?.findings ?? [];
  const topicFindings = filterFindingsByTopic(allFindings, TOPIC_KEYWORDS);
  const otherCount = allFindings.length - topicFindings.length;

  const licenseWaste = live.status?.stats.licenseWaste ?? null;
  const inactiveLicenses = resolvedValue(live.metrics['licensing.inactiveLicenseCount']);
  const duplicateLicenses = resolvedValue(live.metrics['licensing.duplicateLicenseCount']);

  const heroStats: HeroStat[] = [
    {
      label: 'Annual Waste Identified',
      value:
        licenseWaste != null
          ? `$${Math.round(licenseWaste.annualCents / 100).toLocaleString()}`
          : null,
      caption: 'Real seat counts × real list prices',
      emptyCaption: 'No waste data yet',
      accent: 'amber',
    },
    {
      label: 'Inactive Licenses',
      value: inactiveLicenses != null ? inactiveLicenses.toLocaleString() : null,
      caption: 'Paid seats on inactive users',
      emptyCaption: 'No licensing data yet',
      accent: inactiveLicenses != null && inactiveLicenses > 0 ? 'red' : 'green',
    },
    {
      label: 'Duplicate Licenses',
      value: duplicateLicenses != null ? duplicateLicenses.toLocaleString() : null,
      caption: 'Overlapping assignments',
      emptyCaption: 'No licensing data yet',
      accent: duplicateLicenses != null && duplicateLicenses > 0 ? 'amber' : 'green',
    },
    {
      label: 'Topic Findings',
      value: live.overview ? String(topicFindings.length) : null,
      caption: 'Licensing-related scan findings',
      emptyCaption: 'Appears after your first scan',
      accent: 'violet',
    },
  ];

  return (
    <AppShell title="Licensing">
      <div className="min-h-screen relative">
        <main className="relative max-w-[1440px] mx-auto px-4 sm:px-6 py-6 md:py-8 space-y-6">
          {/* 1. Hero — real Licensing pillar score + real Cost Engine stats */}
          <TopicHero
            title="Licensing Efficiency"
            pillarScore={live.pillarScore}
            everScanned={Boolean(live.status?.scan.everScanned)}
            scoreCaption="Licensing pillar score from your latest scan"
            stats={heroStats}
          />

          {/* 2. SKU inventory + waste distribution — real Cost Engine data */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <SkuInventory metrics={live.metrics} licenseWaste={licenseWaste} />
            <WasteDistribution metrics={live.metrics} licenseWaste={licenseWaste} />
          </section>

          {/* 3. Hygiene + hygiene trend + Copilot licensing */}
          <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <AssignmentHygiene metrics={live.metrics} />
            <DailyTrendPanel
              title="HYGIENE TREND"
              seriesDefs={[
                { key: 'licensing.inactiveLicenseCount', label: 'Inactive Licenses', color: 'var(--color-status-red)' },
                { key: 'licensing.duplicateLicenseCount', label: 'Duplicate Licenses', color: 'var(--color-status-amber)' },
              ]}
              metrics={live.metrics}
            />
            <CopilotEngagement
              metrics={live.metrics}
              copilotReadiness={live.status?.copilotReadiness ?? null}
            />
          </section>

          {/* 4. Real topic findings ("Priority Insights") */}
          <TopicFindings
            title="Priority Licensing Insights"
            subtitle={
              otherCount > 0
                ? `Licensing-related findings from your latest scan · ${otherCount} further finding${otherCount === 1 ? '' : 's'} from other pillars on M365 Health`
                : 'Licensing-related findings from your latest scan'
            }
            findings={topicFindings}
            loaded={live.loaded}
            emptyCopy="No licensing-related findings — they appear after your first completed scan."
            onRemediateFinding={setRemediationFinding}
          />

          {/* 5. Automation — real linked offers only, honest execution-blocked state */}
          <AutomationOpportunities
            findings={topicFindings}
            loaded={live.loaded}
            onOpenOffers={() => navigate('/customer-offers')}
            onRemediateFinding={setRemediationFinding}
          />
        </main>

        <TopicRemediationModal
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
