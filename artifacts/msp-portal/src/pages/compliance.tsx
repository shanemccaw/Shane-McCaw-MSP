/**
 * /compliance — Compliance topic page, wired to REAL data end to end
 * (formerly a mock structure-only page: fabricated label/retention/DLP
 * percentages, an invented audit matrix, and fake "apply patch" automation).
 *
 * Real sources (all pre-existing endpoints — see
 * health-suite/useTopicHealthLive.ts):
 *   • GET  /api/portal/assessment/status        — the real Compliance pillar
 *     score + the real labeling/DLP indicators (copilotReadiness block, whose
 *     sensitivity-label and DLP indicators are exactly the real backing data
 *     for label coverage and DLP effectiveness).
 *   • GET  /api/portal/mission-control/overview — real findings + linked
 *     remediation offers, topic-scoped by transparent keyword filter.
 *   • POST /api/dashboard/resolve               — real compliance.* monitor
 *     checks (DLP incidents/weak policies, labels, retention, sharing),
 *     the real sign-in day×hour audit heatmap (aggregateSigninHeatmap over
 *     raw collected events), real directory-audit event timelines, and real
 *     history series for the sensitivity trend panel.
 *
 * Content-loss note (mockup Header removal): the removed Header carried only a
 * local search box and an unread-count bell with no real backend — no real
 * display content to restore. Automation execution is deliberately NOT wired
 * (blocked pending the real Azure app registration).
 */
import React, { useState } from 'react';
import { useLocation } from 'wouter';
import { AppShell } from '@/components/app-shell';
import { LabelCoverageCard } from '@/components/compliance/LabelCoverageCard';
import { RetentionCoverageCard } from '@/components/compliance/RetentionCoverageCard';
import { DlpEffectivenessCard } from '@/components/compliance/DlpEffectivenessCard';
import { TopicHero, HeroStat } from '@/components/health-suite/TopicHero';
import { MetricGrid } from '@/components/health-suite/MetricGrid';
import { DailyTrendPanel } from '@/components/health-suite/DailyTrendPanel';
import { EventTimelinePanel } from '@/components/health-suite/EventTimelinePanel';
import { ActivityHeatmapPanel } from '@/components/health-suite/ActivityHeatmapPanel';
import { TopicFindings } from '@/components/health-suite/TopicFindings';
import { AutomationOpportunities } from '@/components/health-suite/AutomationOpportunities';
import { TopicRemediationModal } from '@/components/health-suite/TopicRemediationModal';
import {
  useTopicHealthLive,
  filterFindingsByTopic,
  resolvedValue,
  TopicFinding,
} from '@/components/health-suite/useTopicHealthLive';
import { Share2 } from 'lucide-react';

const METRIC_KEYS = [
  // Labels
  'compliance.missingLabelCount',
  'compliance.labelErrorCount',
  'compliance.labelPolicyDriftCount',
  // Retention
  'compliance.retentionDriftCount',
  'compliance.missingRetentionTagCount',
  'compliance.activeEdiscoveryCount',
  // DLP
  'compliance.dlpIncidentCount',
  'compliance.weakDlpPolicyCount',
  // Sharing / exposure
  'compliance.oversharedSiteCount',
  'compliance.sharePointSiteCount',
  'compliance.oneDriveExternalCount',
  'compliance.publicChannelCount',
  'compliance.guestUserCount',
  'compliance.externalInviteCount',
  // Audit surfaces
  'identity.signinActivity',
  'identity.changeEventCount',
  'identity.provisioningEventCount',
];

const HISTORY_KEYS = [
  'compliance.missingLabelCount',
  'compliance.labelErrorCount',
  'compliance.missingRetentionTagCount',
  'compliance.weakDlpPolicyCount',
];

const TOPIC_KEYWORDS = [
  'compliance',
  'dlp',
  'label',
  'retention',
  'ediscovery',
  'audit',
  'shar',
  'guest',
  'external',
  'public channel',
  'onedrive',
];

export default function CompliancePage() {
  const [, navigate] = useLocation();
  const live = useTopicHealthLive({
    pillar: 'compliance',
    metricKeys: METRIC_KEYS,
    historyKeys: HISTORY_KEYS,
  });
  const [remediationFinding, setRemediationFinding] = useState<TopicFinding | null>(null);

  const allFindings = live.overview?.findings ?? [];
  const topicFindings = filterFindingsByTopic(allFindings, TOPIC_KEYWORDS);
  const otherCount = allFindings.length - topicFindings.length;

  const dlpIncidents = resolvedValue(live.metrics['compliance.dlpIncidentCount']);
  const missingLabels = resolvedValue(live.metrics['compliance.missingLabelCount']);
  const retentionDrift = resolvedValue(live.metrics['compliance.retentionDriftCount']);

  const heroStats: HeroStat[] = [
    {
      label: 'DLP Incidents',
      value: dlpIncidents != null ? dlpIncidents.toLocaleString() : null,
      caption: 'In the look-back window',
      emptyCaption: 'No DLP data yet',
      accent: dlpIncidents != null && dlpIncidents > 0 ? 'red' : 'green',
    },
    {
      label: 'Missing Labels',
      value: missingLabels != null ? missingLabels.toLocaleString() : null,
      caption: 'Items without a sensitivity label',
      emptyCaption: 'No labeling data yet',
      accent: missingLabels != null && missingLabels > 0 ? 'amber' : 'green',
    },
    {
      label: 'Retention Drift',
      value: retentionDrift != null ? retentionDrift.toLocaleString() : null,
      caption: 'Policies drifted from baseline',
      emptyCaption: 'No retention data yet',
      accent: retentionDrift != null && retentionDrift > 0 ? 'amber' : 'green',
    },
    {
      label: 'Topic Findings',
      value: live.overview ? String(topicFindings.length) : null,
      caption: 'Compliance-related scan findings',
      emptyCaption: 'Appears after your first scan',
      accent: 'violet',
    },
  ];

  return (
    <AppShell title="Compliance">
      <div className="min-h-screen relative">
        <main className="relative max-w-[1440px] mx-auto px-4 sm:px-6 py-6 md:py-8 space-y-6">
          {/* 1. Hero — real Compliance pillar score + real check stats */}
          <TopicHero
            title="Compliance Health"
            pillarScore={live.pillarScore}
            everScanned={Boolean(live.status?.scan.everScanned)}
            scoreCaption="Compliance pillar score from your latest scan"
            stats={heroStats}
          />

          {/* 2. Labels / retention / DLP — real check + indicator data */}
          <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <LabelCoverageCard
              metrics={live.metrics}
              copilotReadiness={live.status?.copilotReadiness ?? null}
            />
            <RetentionCoverageCard metrics={live.metrics} />
            <DlpEffectivenessCard
              metrics={live.metrics}
              copilotReadiness={live.status?.copilotReadiness ?? null}
            />
          </section>

          {/* 3. Sensitivity trend + sharing exposure */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <DailyTrendPanel
              title="SENSITIVITY & DLP TREND"
              seriesDefs={[
                { key: 'compliance.missingLabelCount', label: 'Missing Labels', color: 'var(--color-status-amber)' },
                { key: 'compliance.labelErrorCount', label: 'Label Errors', color: 'var(--color-status-red)' },
                { key: 'compliance.weakDlpPolicyCount', label: 'Weak DLP Policies', color: 'var(--color-status-violet)' },
              ]}
              metrics={live.metrics}
            />
            <MetricGrid
              title="SHARING & EXPOSURE"
              subtitle="Real external-sharing checks"
              icon={Share2}
              columns={3}
              tiles={[
                { key: 'compliance.oversharedSiteCount', label: 'Overshared Sites', caption: 'Broad-access SharePoint sites' },
                { key: 'compliance.oneDriveExternalCount', label: 'OneDrive External Shares', caption: 'Externally shared content' },
                { key: 'compliance.publicChannelCount', label: 'Public Channels', caption: 'Org-wide visible channels' },
                { key: 'compliance.guestUserCount', label: 'Guest Users', caption: 'External identities' },
                { key: 'compliance.externalInviteCount', label: 'External Invites', caption: 'Pending/recent invitations' },
                { key: 'compliance.activeEdiscoveryCount', label: 'eDiscovery Cases', caption: 'Open cases' },
              ]}
              metrics={live.metrics}
            />
          </section>

          {/* 4. Audit activity — real sign-in heatmap + real audit event feed */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ActivityHeatmapPanel
              title="SIGN-IN AUDIT HEATMAP"
              subtitle="Real sign-in events"
              metricKey="identity.signinActivity"
              metrics={live.metrics}
              emptyCopy="The sign-in heatmap appears once the audit checks have collected raw sign-in events for your tenant."
            />
            <EventTimelinePanel
              title="DIRECTORY AUDIT TRAIL"
              subtitle="Real audit events"
              sources={[
                { key: 'identity.changeEventCount', tag: 'CHANGE', tagClass: 'bg-status-blue/15 text-status-blue border-status-blue/30' },
                { key: 'identity.provisioningEventCount', tag: 'PROVISION', tagClass: 'bg-status-teal/15 text-status-teal border-status-teal/30' },
              ]}
              metrics={live.metrics}
              emptyCopy="Directory audit events appear once the audit checks have collected data for your tenant."
            />
          </section>

          {/* 5. Real topic findings */}
          <TopicFindings
            title="Top Compliance Risks"
            subtitle={
              otherCount > 0
                ? `Compliance-related findings from your latest scan · ${otherCount} further finding${otherCount === 1 ? '' : 's'} from other pillars on M365 Health`
                : 'Compliance-related findings from your latest scan'
            }
            findings={topicFindings}
            loaded={live.loaded}
            emptyCopy="No compliance-related findings — they appear after your first completed scan."
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
