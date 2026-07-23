/**
 * /architecture — Architecture topic page, wired to REAL data end to end
 * (formerly a mock structure-only page: invented tenant score composite, a
 * fabricated node-graph topology, fake per-policy CA map, mock app/OAuth
 * inventories, and simulated scan/remediation flows).
 *
 * Real sources (all pre-existing endpoints — see
 * health-suite/useTopicHealthLive.ts):
 *   • GET  /api/portal/assessment/status        — the real Architecture pillar
 *     score from the package-aware radar.
 *   • GET  /api/portal/mission-control/overview — real findings + linked
 *     remediation offers, topic-scoped by transparent keyword filter.
 *   • POST /api/dashboard/resolve               — real engine snapshot scores
 *     (health/security/drift, with real history for the trend), the CA and
 *     app-registration/OAuth drift watchers' real events, identity/role
 *     density checks, and the real workload inventory counts.
 *
 * Content-loss note (mockup Header removal): the removed Header held a mock
 * environment selector ("TENANT-01 PRODUCTION"), a hardcoded last-analysis
 * time, and simulated scan/reset controls — no real display content to
 * restore.
 *
 * HONEST GAPS (stated in the UI): per-policy CA inventory, per-app
 * registration inventory (owners/credential expiry), per-grant OAuth consent
 * inventory, and a cross-workload relationship graph — all need new Graph
 * checks on the existing app registration.
 */
import React, { useState } from 'react';
import { useLocation } from 'wouter';
import { AppShell } from '@/components/app-shell';
import { ScoreOverview } from '@/components/architecture/ScoreOverview';
import { TenantTopology } from '@/components/architecture/TenantTopology';
import { ConditionalAccessMap } from '@/components/architecture/ConditionalAccessMap';
import { AppRegistrationInventory } from '@/components/architecture/AppRegistrationInventory';
import { OAuthPermissionRisk } from '@/components/architecture/OAuthPermissionRisk';
import { TopicHero, HeroStat } from '@/components/health-suite/TopicHero';
import { MetricGrid } from '@/components/health-suite/MetricGrid';
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
import { Users } from 'lucide-react';

const METRIC_KEYS = [
  // Engine scores (real snapshots, history-capable)
  'engine.healthScore',
  'engine.securityScore',
  'engine.driftScore',
  // Conditional Access
  'identity.caFailureCount',
  'drift.caPolicyDriftCount',
  'drift.securityDefaultsDriftCount',
  // Identity & role density
  'identity.globalAdminCount',
  'identity.pimPermanentRoleCount',
  'identity.staleAccountCount',
  'identity.disabledAccountCount',
  'identity.mfaRegisteredCount',
  'identity.passwordlessUserCount',
  // App registrations + OAuth
  'drift.appConfigDriftCount',
  'drift.redirectUriDriftCount',
  'drift.secretDriftCount',
  'drift.certificateDriftCount',
  'drift.permissionDriftCount',
  'dynamics.permissionGrantCount',
  'dynamics.orphanedSpCount',
  'dynamics.appPermissionCount',
  'dynamics.consentChangeCount',
  // Tenant surface inventory
  'compliance.sharePointSiteCount',
  'collaboration.teamsChannelCount',
  'collaboration.mailboxCount',
  'compliance.guestUserCount',
  'powerPlatform.appCount',
  'powerPlatform.flowCount',
];

const HISTORY_KEYS = ['engine.healthScore', 'engine.securityScore', 'engine.driftScore'];

const TOPIC_KEYWORDS = [
  'architect',
  'conditional access',
  'app registration',
  'oauth',
  'permission',
  'consent',
  'service principal',
  'secret',
  'certificate',
  'mfa',
  'passwordless',
  'security defaults',
  'drift',
  'legacy auth',
];

export default function ArchitecturePage() {
  const [, navigate] = useLocation();
  const live = useTopicHealthLive({
    pillar: 'architecture',
    metricKeys: METRIC_KEYS,
    historyKeys: HISTORY_KEYS,
  });
  const [remediationFinding, setRemediationFinding] = useState<TopicFinding | null>(null);

  const allFindings = live.overview?.findings ?? [];
  const topicFindings = filterFindingsByTopic(allFindings, TOPIC_KEYWORDS);
  const otherCount = allFindings.length - topicFindings.length;

  const caFailures = resolvedValue(live.metrics['identity.caFailureCount']);
  const globalAdmins = resolvedValue(live.metrics['identity.globalAdminCount']);
  const driftScore = resolvedValue(live.metrics['engine.driftScore']);

  const heroStats: HeroStat[] = [
    {
      label: 'Drift Engine Score',
      value: driftScore != null ? String(Math.round(driftScore)) : null,
      caption: 'Configuration drift posture',
      emptyCaption: 'No drift snapshot yet',
      accent: 'blue',
    },
    {
      label: 'CA Failures',
      value: caFailures != null ? caFailures.toLocaleString() : null,
      caption: 'Conditional Access failures in window',
      emptyCaption: 'No CA data yet',
      accent: caFailures != null && caFailures > 0 ? 'amber' : 'green',
    },
    {
      label: 'Global Administrators',
      value: globalAdmins != null ? globalAdmins.toLocaleString() : null,
      caption: '2–4 with break-glass is healthy',
      emptyCaption: 'No identity data yet',
      accent: 'violet',
    },
    {
      label: 'Topic Findings',
      value: live.overview ? String(topicFindings.length) : null,
      caption: 'Architecture-related scan findings',
      emptyCaption: 'Appears after your first scan',
      accent: 'teal',
    },
  ];

  return (
    <AppShell title="Architecture">
      <div className="min-h-screen relative">
        <main className="relative max-w-[1440px] mx-auto px-4 sm:px-6 py-6 md:py-8 space-y-6">
          {/* 1. Hero — real Architecture pillar score */}
          <TopicHero
            title="Architecture Health"
            pillarScore={live.pillarScore}
            everScanned={Boolean(live.status?.scan.everScanned)}
            scoreCaption="Architecture pillar score from your latest scan"
            stats={heroStats}
          />

          {/* 2. Real engine scores */}
          <ScoreOverview metrics={live.metrics} pillarScore={live.pillarScore} />

          {/* 3. Tenant surface inventory */}
          <TenantTopology metrics={live.metrics} />

          {/* 4. CA posture + identity density + score trend */}
          <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <ConditionalAccessMap metrics={live.metrics} />
            <MetricGrid
              title="IDENTITY & ROLE DENSITY"
              subtitle="Real identity posture checks"
              icon={Users}
              columns={2}
              tiles={[
                { key: 'identity.globalAdminCount', label: 'Global Admins', caption: 'Role holders' },
                { key: 'identity.pimPermanentRoleCount', label: 'Standing Priv. Roles', caption: 'Permanent assignments' },
                { key: 'identity.mfaRegisteredCount', label: 'MFA Registered', caption: 'Users with MFA methods' },
                { key: 'identity.passwordlessUserCount', label: 'Passwordless Users', caption: 'Phishing-resistant auth' },
                { key: 'identity.staleAccountCount', label: 'Stale Accounts', caption: 'No recent sign-in' },
                { key: 'identity.disabledAccountCount', label: 'Disabled Accounts', caption: 'Blocked from sign-in' },
              ]}
              metrics={live.metrics}
            />
            <DailyTrendPanel
              title="ENGINE SCORE TREND"
              seriesDefs={[
                { key: 'engine.healthScore', label: 'Health', color: 'var(--color-primary)' },
                { key: 'engine.securityScore', label: 'Security', color: 'var(--color-status-red)' },
                { key: 'engine.driftScore', label: 'Drift', color: 'var(--color-status-amber)' },
              ]}
              metrics={live.metrics}
            />
          </section>

          {/* 5. App registrations + OAuth risk */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <AppRegistrationInventory metrics={live.metrics} />
            <OAuthPermissionRisk metrics={live.metrics} />
          </section>

          {/* 6. Real topic findings */}
          <TopicFindings
            title="Top Architecture Risks"
            subtitle={
              otherCount > 0
                ? `Architecture-related findings from your latest scan · ${otherCount} further finding${otherCount === 1 ? '' : 's'} from other pillars on M365 Health`
                : 'Architecture-related findings from your latest scan'
            }
            findings={topicFindings}
            loaded={live.loaded}
            emptyCopy="No architecture-related findings — they appear after your first completed scan."
            onRemediateFinding={setRemediationFinding}
          />

          {/* 7. Automation — real linked offers only, honest execution-blocked state */}
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
