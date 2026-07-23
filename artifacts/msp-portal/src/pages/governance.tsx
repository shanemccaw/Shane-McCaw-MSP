/**
 * /governance — Identity Governance topic page, wired to REAL data end to end
 * (formerly a mock structure-only page: fabricated health data, a hardcoded
 * radar polygon, a 60-cell fake heatmap, and fake automation execution).
 *
 * Real sources (all pre-existing endpoints — see
 * health-suite/useTopicHealthLive.ts):
 *   • GET  /api/portal/assessment/status        — the real Governance pillar
 *     score from the package-aware radar (pillar-coverage.ts).
 *   • GET  /api/portal/mission-control/overview — real findings + linked
 *     remediation offers, topic-scoped by transparent keyword filter.
 *   • POST /api/dashboard/resolve               — real governance.* /
 *     identity.* / compliance.* monitor-check metrics, real drift/audit event
 *     timelines, and real history series (engine.driftScore +
 *     smart-eligible governance scalars) for the trend panel.
 *
 * Content-loss note (mockup Header removal): the removed Header carried only a
 * fake latency figure, a hardcoded "SECURE_OPERATIONAL" status and a
 * simulated-audit refresh button — no real display content to restore.
 * Automation execution is deliberately NOT wired (blocked pending the real
 * Azure app registration) — see health-suite/AutomationOpportunities.
 */
import React, { useState } from 'react';
import { useLocation } from 'wouter';
import { AppShell } from '@/components/app-shell';
import { AdminExposureMatrix } from '@/components/governance/AdminExposureMatrix';
import { GroupSprawl } from '@/components/governance/GroupSprawl';
import { TopicHero, HeroStat } from '@/components/health-suite/TopicHero';
import { MetricGrid } from '@/components/health-suite/MetricGrid';
import { DailyTrendPanel } from '@/components/health-suite/DailyTrendPanel';
import { EventTimelinePanel } from '@/components/health-suite/EventTimelinePanel';
import { TopicFindings } from '@/components/health-suite/TopicFindings';
import { AutomationOpportunities } from '@/components/health-suite/AutomationOpportunities';
import { TopicRemediationModal } from '@/components/health-suite/TopicRemediationModal';
import {
  useTopicHealthLive,
  filterFindingsByTopic,
  resolvedValue,
  TopicFinding,
} from '@/components/health-suite/useTopicHealthLive';
import { ClipboardCheck } from 'lucide-react';

/** Registry metric keys this page resolves (strings — an unknown/unavailable
 * key degrades to the honest per-tile empty state server-side). */
const METRIC_KEYS = [
  // Admin exposure
  'identity.globalAdminCount',
  'identity.pimPermanentRoleCount',
  'identity.riskyUserCount',
  'identity.staleAccountCount',
  'identity.caFailureCount',
  'identity.highRiskSigninCount',
  // Group / collaboration sprawl
  'compliance.orphanedTeamCount',
  'compliance.orphanedSiteCount',
  'compliance.guestUserCount',
  'compliance.externalInviteCount',
  'compliance.publicChannelCount',
  'governance.orphanedAccessPackageCount',
  'collaboration.teamsChannelCount',
  // Governance operations
  'governance.overdueAccessReviewCount',
  'governance.accessReviewDriftCount',
  'governance.workflowFailureCount',
  'governance.activeEntitlementAssignmentCount',
  // Trend (engine snapshot with real history) + timelines
  'engine.driftScore',
  'identity.privilegedRoleChangeCount',
  'drift.roleAssignmentDriftCount',
  'governance.entitlementPolicyDriftCount',
  'governance.workflowDriftCount',
];

/** History opt-in — smart-eligible customer scalars with genuine per-point
 * history (tenant_engine_snapshots / tenant_monitor_profiles). */
const HISTORY_KEYS = [
  'engine.driftScore',
  'governance.overdueAccessReviewCount',
  'governance.orphanedAccessPackageCount',
];

const TOPIC_KEYWORDS = [
  'governance',
  'role',
  'admin',
  'access review',
  'entitlement',
  'lifecycle',
  'group',
  'guest',
  'owner',
  'orphan',
  'external',
  'privileg',
];

export default function GovernancePage() {
  const [, navigate] = useLocation();
  const live = useTopicHealthLive({
    pillar: 'governance',
    metricKeys: METRIC_KEYS,
    historyKeys: HISTORY_KEYS,
  });
  const [remediationFinding, setRemediationFinding] = useState<TopicFinding | null>(null);

  const allFindings = live.overview?.findings ?? [];
  const topicFindings = filterFindingsByTopic(allFindings, TOPIC_KEYWORDS);
  const otherCount = allFindings.length - topicFindings.length;

  const overdueReviews = resolvedValue(live.metrics['governance.overdueAccessReviewCount']);
  const globalAdmins = resolvedValue(live.metrics['identity.globalAdminCount']);
  const workflowFailures = resolvedValue(live.metrics['governance.workflowFailureCount']);

  const heroStats: HeroStat[] = [
    {
      label: 'Overdue Access Reviews',
      value: overdueReviews != null ? overdueReviews.toLocaleString() : null,
      caption: 'Past their review deadline',
      emptyCaption: 'No review data yet',
      accent: overdueReviews != null && overdueReviews > 0 ? 'amber' : 'green',
    },
    {
      label: 'Global Administrators',
      value: globalAdmins != null ? globalAdmins.toLocaleString() : null,
      caption: '2–4 with break-glass is healthy',
      emptyCaption: 'No identity data yet',
      accent: 'blue',
    },
    {
      label: 'Lifecycle Failures',
      value: workflowFailures != null ? workflowFailures.toLocaleString() : null,
      caption: 'Failed lifecycle workflows',
      emptyCaption: 'No workflow data yet',
      accent: workflowFailures != null && workflowFailures > 0 ? 'red' : 'green',
    },
    {
      label: 'Topic Findings',
      value: live.overview ? String(topicFindings.length) : null,
      caption: 'Governance-related scan findings',
      emptyCaption: 'Appears after your first scan',
      accent: 'violet',
    },
  ];

  return (
    <AppShell title="Governance">
      <div className="min-h-screen relative">
        <main className="relative max-w-[1440px] mx-auto px-4 sm:px-6 py-6 md:py-8 space-y-6">
          {/* 1. Hero — real Governance pillar score + real ops stats */}
          <TopicHero
            title="Governance Health"
            pillarScore={live.pillarScore}
            everScanned={Boolean(live.status?.scan.everScanned)}
            scoreCaption="Governance pillar score from your latest scan"
            stats={heroStats}
          />

          {/* 2. Admin exposure + group sprawl — real check counts */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <AdminExposureMatrix metrics={live.metrics} />
            <GroupSprawl metrics={live.metrics} />
          </section>

          {/* 3. Governance operations + drift trend + role-change audit */}
          <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <MetricGrid
              title="GOVERNANCE OPERATIONS"
              subtitle="Entitlement & access-review checks"
              icon={ClipboardCheck}
              columns={2}
              tiles={[
                { key: 'governance.overdueAccessReviewCount', label: 'Overdue Access Reviews', caption: 'Past their review deadline' },
                { key: 'governance.accessReviewDriftCount', label: 'Access Review Drift', caption: 'Reviews drifting from baseline' },
                { key: 'governance.workflowFailureCount', label: 'Lifecycle Failures', caption: 'Failed lifecycle workflows' },
                { key: 'governance.activeEntitlementAssignmentCount', label: 'Entitlement Assignments', caption: 'Active access-package grants' },
              ]}
              metrics={live.metrics}
            />
            <DailyTrendPanel
              title="POLICY & DRIFT TREND"
              seriesDefs={[
                { key: 'engine.driftScore', label: 'Drift Engine Score', color: 'var(--color-primary)' },
                { key: 'governance.overdueAccessReviewCount', label: 'Overdue Reviews', color: 'var(--color-status-amber)' },
                { key: 'governance.orphanedAccessPackageCount', label: 'Orphaned Packages', color: 'var(--color-status-red)' },
              ]}
              metrics={live.metrics}
            />
            <EventTimelinePanel
              title="PRIVILEGED ROLE ACTIVITY"
              subtitle="Real audit events"
              sources={[
                { key: 'identity.privilegedRoleChangeCount', tag: 'ROLE', tagClass: 'bg-status-red/15 text-status-red border-status-red/30' },
                { key: 'drift.roleAssignmentDriftCount', tag: 'DRIFT', tagClass: 'bg-status-amber/15 text-status-amber border-status-amber/30' },
                { key: 'governance.entitlementPolicyDriftCount', tag: 'ENTITLE', tagClass: 'bg-status-violet/15 text-status-violet border-status-violet/30' },
                { key: 'governance.workflowDriftCount', tag: 'LIFECYCLE', tagClass: 'bg-status-blue/15 text-status-blue border-status-blue/30' },
              ]}
              metrics={live.metrics}
              emptyCopy="Role and entitlement audit events appear once the audit checks have collected data for your tenant."
            />
          </section>

          {/* 4. Real topic findings */}
          <TopicFindings
            title="Top Governance Risks"
            subtitle={
              otherCount > 0
                ? `Governance-related findings from your latest scan · ${otherCount} further finding${otherCount === 1 ? '' : 's'} from other pillars on M365 Health`
                : 'Governance-related findings from your latest scan'
            }
            findings={topicFindings}
            loaded={live.loaded}
            emptyCopy="No governance-related findings — they appear after your first completed scan."
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
