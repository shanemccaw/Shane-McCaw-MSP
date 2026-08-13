/**
 * /adoption — Adoption topic page, wired to REAL data end to end (formerly a
 * mock structure-only page: fabricated department heatmap, invented 12-month
 * collaboration trend, fake Copilot usage split, and fake automation toasts).
 *
 * Real sources (all pre-existing endpoints — see
 * health-suite/useTopicHealthLive.ts):
 *   • GET  /api/portal/assessment/status        — the real Adoption pillar
 *     score + the real Copilot-readiness block.
 *   • GET  /api/portal/mission-control/overview — real findings + linked
 *     remediation offers, topic-scoped by transparent keyword filter.
 *   • POST /api/dashboard/resolve               — the real usage.* active-user
 *     and adoption-score checks, collaboration/mailbox posture checks, and the
 *     real file-activity day×hour heatmap.
 *
 * HONEST GAPS (stated in the UI, reported in PLATFORM_BUILD.md):
 *   • Per-workload adoption HISTORY — usage.* checks aren't history-enabled
 *     in the registry (smartEligible=false), so the mock 12-month trend is
 *     replaced by real current scores with the gap stated.
 *   • Per-department activity + per-user Copilot usage — not collected by any
 *     check; never fabricated.
 *
 * Content-loss note (mockup Header removal): the removed Header held
 * timeframe/department filters, search, and refresh/export controls — all
 * driving mock data only (the department dimension doesn't exist in real
 * data). No real display content to restore.
 */
import React, { useState } from 'react';
import { useLocation } from 'wouter';
import { AppShell } from '@/components/app-shell';
import { TeamsHeatMap } from '@/components/adoption/TeamsHeatMap';
import { CollaborationTrend } from '@/components/adoption/CollaborationTrend';
import { EmailProductivity } from '@/components/adoption/EmailProductivity';
import { CopilotUsage } from '@/components/adoption/CopilotUsage';
import { TopicHero, HeroStat } from '@/components/health-suite/TopicHero';
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

const METRIC_KEYS = [
  // Active users per workload
  'usage.teamsActiveCount',
  'usage.exchangeActiveCount',
  'usage.sharePointActiveCount',
  'usage.oneDriveActiveCount',
  // Adoption scores per workload
  'usage.teamsUsageCount',
  'usage.exchangeUsageCount',
  'usage.sharePointUsageCount',
  'usage.oneDriveUsageCount',
  // Mailbox / collaboration posture
  'collaboration.mailboxCount',
  'collaboration.activeEmailUserCount',
  'collaboration.forwardingMailboxCount',
  'collaboration.sharedMailboxSigninEnabledCount',
  'collaboration.inboxRuleCount',
  'collaboration.delegationGrantCount',
  'collaboration.teamsChannelCount',
  // File activity heatmap (real day×hour aggregation)
  'collaboration.fileActivity',
  // Copilot
  'licensing.copilotLicenseBreakdown',
  'copilot.usagePerUser',
];

const TOPIC_KEYWORDS = [
  'adoption',
  'usage',
  'active user',
  'teams',
  'exchange',
  'sharepoint',
  'onedrive',
  'mailbox',
  'email',
  'copilot',
  'collaboration',
];

export default function AdoptionPage() {
  const [, navigate] = useLocation();
  const live = useTopicHealthLive({ pillar: 'adoption', metricKeys: METRIC_KEYS });
  const [remediationFinding, setRemediationFinding] = useState<TopicFinding | null>(null);

  const allFindings = live.overview?.findings ?? [];
  const topicFindings = filterFindingsByTopic(allFindings, TOPIC_KEYWORDS);
  const otherCount = allFindings.length - topicFindings.length;

  const teamsActive = resolvedValue(live.metrics['usage.teamsActiveCount']);
  const emailActive = resolvedValue(live.metrics['collaboration.activeEmailUserCount']);
  const oneDriveActive = resolvedValue(live.metrics['usage.oneDriveActiveCount']);

  const heroStats: HeroStat[] = [
    {
      label: 'Teams Active Users',
      value: teamsActive != null ? teamsActive.toLocaleString() : null,
      caption: 'From the Teams usage check',
      emptyCaption: 'No usage data yet',
      accent: 'blue',
    },
    {
      label: 'Active Email Users',
      value: emailActive != null ? emailActive.toLocaleString() : null,
      caption: 'From the email activity check',
      emptyCaption: 'No usage data yet',
      accent: 'teal',
    },
    {
      label: 'OneDrive Active Users',
      value: oneDriveActive != null ? oneDriveActive.toLocaleString() : null,
      caption: 'From the OneDrive usage check',
      emptyCaption: 'No usage data yet',
      accent: 'violet',
    },
    {
      label: 'Topic Findings',
      value: live.overview ? String(topicFindings.length) : null,
      caption: 'Adoption-related scan findings',
      emptyCaption: 'Appears after your first scan',
      accent: 'amber',
    },
  ];

  return (
    <AppShell title="Adoption">
      <div className="min-h-screen relative">
        <main className="relative max-w-[1440px] mx-auto px-4 sm:px-6 py-6 md:py-8 space-y-6">
          {/* 1. Hero — real Adoption pillar score + real usage stats */}
          <TopicHero
            title="Adoption Health"
            pillarScore={live.pillarScore}
            everScanned={Boolean(live.status?.scan.everScanned)}
            scoreCaption="Adoption pillar score from your latest scan"
            stats={heroStats}
          />

          {/* 2. Workload activity + real file-activity heatmap */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <TeamsHeatMap metrics={live.metrics} />
            <ActivityHeatmapPanel
              title="FILE ACTIVITY HEATMAP"
              subtitle="Real OneDrive/SharePoint events"
              metricKey="collaboration.fileActivity"
              metrics={live.metrics}
              emptyCopy="The file-activity heatmap appears once the usage checks have collected raw activity events for your tenant."
            />
          </section>

          {/* 3. Adoption scores, email posture, Copilot readiness */}
          <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <CollaborationTrend metrics={live.metrics} />
            <EmailProductivity metrics={live.metrics} />
            <CopilotUsage
              metrics={live.metrics}
              copilotReadiness={live.status?.copilotReadiness ?? null}
            />
          </section>

          {/* 4. Real topic findings ("Top Opportunities") */}
          <TopicFindings
            title="Top Adoption Opportunities"
            subtitle={
              otherCount > 0
                ? `Adoption-related findings from your latest scan · ${otherCount} further finding${otherCount === 1 ? '' : 's'} from other pillars on M365 Health`
                : 'Adoption-related findings from your latest scan'
            }
            findings={topicFindings}
            loaded={live.loaded}
            emptyCopy="No adoption-related findings — they appear after your first completed scan."
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
