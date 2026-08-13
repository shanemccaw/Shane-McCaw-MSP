/**
 * /copilot — Copilot Readiness topic page, wired to REAL data end to end
 * (formerly a mock structure-only page: invented executive metrics, a fake
 * per-entity permissions heatmap, mock enablement toggles, and simulated
 * automation runs).
 *
 * Real sources (all pre-existing endpoints — see
 * health-suite/useTopicHealthLive.ts):
 *   • GET  /api/portal/assessment/status        — the real Copilot Readiness
 *     pillar score + the real copilot-readiness block (three weighted
 *     indicators with real backing counts — the page's primary data source).
 *   • GET  /api/portal/mission-control/overview — real findings + linked
 *     remediation offers, topic-scoped by transparent keyword filter.
 *   • POST /api/dashboard/resolve               — copilot.overshareExposureCount
 *     (with real history), the compliance label/DLP/sharing checks, and the
 *     Copilot license-readiness signal.
 *
 * Content-loss note (HeaderHero removal): HeaderHero displayed real-looking
 * executive metrics that were mock data. Per the decision already made in the
 * prior session's content-loss review, that display content is restored as a
 * real content section — the TopicHero below, showing the same class of
 * numbers from genuinely real sources (pillar score, real readiness %, real
 * exposure count). FooterBar's live-feed toggle/export were mock-interactive
 * only.
 *
 * HONEST GAPS: per-user Copilot usage telemetry (registry: not_collected) and
 * per-site/team permission drill-down (needs a new Graph check) — both stated
 * in the UI, never simulated.
 */
import React, { useState } from 'react';
import { useLocation } from 'wouter';
import { AppShell } from '@/components/app-shell';
import { PermissionsHeatmap } from '@/components/copilot/PermissionsHeatmap';
import { LabelAndDlpSection } from '@/components/copilot/LabelAndDlpSection';
import { SafetyRadarChart } from '@/components/copilot/SafetyRadarChart';
import { EnablementControls } from '@/components/copilot/EnablementControls';
import { ReadinessBlockers } from '@/components/copilot/ReadinessBlockers';
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
  'copilot.overshareExposureCount',
  'copilot.usagePerUser',
  'licensing.copilotLicenseBreakdown',
  'compliance.missingLabelCount',
  'compliance.labelErrorCount',
  'compliance.weakDlpPolicyCount',
  'compliance.dlpIncidentCount',
  'compliance.oversharedSiteCount',
  'compliance.sharePointSiteCount',
  'compliance.oneDriveExternalCount',
  'compliance.publicChannelCount',
];

const HISTORY_KEYS = [
  'copilot.overshareExposureCount',
  'compliance.missingLabelCount',
  'compliance.oversharedSiteCount',
];

const TOPIC_KEYWORDS = [
  'copilot',
  'overshar',
  'label',
  'dlp',
  'sensitiv',
  'sharing',
  'sharepoint',
  'onedrive',
  'public channel',
];

export default function CopilotPage() {
  const [, navigate] = useLocation();
  const live = useTopicHealthLive({
    pillar: 'copilot',
    metricKeys: METRIC_KEYS,
    historyKeys: HISTORY_KEYS,
  });
  const [remediationFinding, setRemediationFinding] = useState<TopicFinding | null>(null);

  const allFindings = live.overview?.findings ?? [];
  const topicFindings = filterFindingsByTopic(allFindings, TOPIC_KEYWORDS);
  const otherCount = allFindings.length - topicFindings.length;

  const readiness = live.status?.copilotReadiness ?? null;
  const overall = readiness?.overall.score ?? null;
  const exposure = resolvedValue(live.metrics['copilot.overshareExposureCount']);
  const licenseSignal = resolvedValue(live.metrics['licensing.copilotLicenseBreakdown']);

  const heroStats: HeroStat[] = [
    {
      label: 'Overall Readiness',
      value: overall != null ? `${overall}%` : null,
      caption: 'Weighted across data-governance checks',
      emptyCaption: 'No readiness data yet',
      accent: 'violet',
    },
    {
      label: 'Overshare Exposure',
      value: exposure != null ? exposure.toLocaleString() : null,
      caption: 'Items Copilot could surface today',
      emptyCaption: 'No exposure data yet',
      accent: exposure != null && exposure > 0 ? 'amber' : 'green',
    },
    {
      label: 'License Signal',
      value: licenseSignal != null ? licenseSignal.toLocaleString() : null,
      caption: 'Copilot license-readiness check',
      emptyCaption: 'No license data yet',
      accent: 'blue',
    },
    {
      label: 'Topic Findings',
      value: live.overview ? String(topicFindings.length) : null,
      caption: 'Copilot-related scan findings',
      emptyCaption: 'Appears after your first scan',
      accent: 'teal',
    },
  ];

  return (
    <AppShell title="Copilot">
      <div className="min-h-screen relative">
        <main className="relative max-w-[1440px] mx-auto px-4 sm:px-6 py-6 md:py-8 space-y-6">
          {/* 1. Hero — restored HeaderHero content, now from real sources */}
          <TopicHero
            title="Copilot Readiness"
            pillarScore={live.pillarScore}
            everScanned={Boolean(live.status?.scan.everScanned)}
            scoreCaption="Copilot Readiness pillar score from your latest scan"
            stats={heroStats}
          />

          {/* 2. Oversharing exposure — the real permission surface */}
          <PermissionsHeatmap metrics={live.metrics} copilotReadiness={readiness} />

          {/* 3. Safety radar + blockers + enablement checklist */}
          <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <SafetyRadarChart copilotReadiness={readiness} />
            <ReadinessBlockers copilotReadiness={readiness} />
            <EnablementControls copilotReadiness={readiness} />
          </section>

          {/* 4. Labels & DLP gates + real exposure trend */}
          <LabelAndDlpSection metrics={live.metrics} copilotReadiness={readiness} />

          <section className="grid grid-cols-1 gap-6">
            <DailyTrendPanel
              title="EXPOSURE TREND"
              seriesDefs={[
                { key: 'copilot.overshareExposureCount', label: 'Overshare Exposure', color: 'var(--color-status-amber)' },
                { key: 'compliance.missingLabelCount', label: 'Missing Labels', color: 'var(--color-status-red)' },
                { key: 'compliance.oversharedSiteCount', label: 'Overshared Sites', color: 'var(--color-status-violet)' },
              ]}
              metrics={live.metrics}
            />
          </section>

          {/* 5. Real topic findings */}
          <TopicFindings
            title="Copilot Readiness Risks"
            subtitle={
              otherCount > 0
                ? `Copilot-related findings from your latest scan · ${otherCount} further finding${otherCount === 1 ? '' : 's'} from other pillars on M365 Health`
                : 'Copilot-related findings from your latest scan'
            }
            findings={topicFindings}
            loaded={live.loaded}
            emptyCopy="No Copilot-related findings — they appear after your first completed scan."
            onRemediateFinding={setRemediationFinding}
          />

          {/* 6. Automation — real linked offers only, honest execution-blocked state */}
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
