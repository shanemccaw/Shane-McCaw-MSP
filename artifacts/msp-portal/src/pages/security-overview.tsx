/**
 * /security-overview — the Security Intelligence page, wired to REAL data end
 * to end (formerly the mock "obsidian" structure-only page).
 *
 * Real sources (see useSecurityOverviewLive.ts for the full contract):
 *   • POST /api/dashboard/resolve                 — identity/security monitor
 *     check metrics (global admins, PIM standing roles, risky users, high-risk
 *     sign-ins, failed sign-ins, impossible travel, active alerts) + the
 *     high-risk sign-in collection history for the Sign-In Risk Trend.
 *   • GET  /api/portal/mission-control/overview   — real findings feed with
 *     server-linked remediation offers (Top Security Risks + Automation).
 *   • GET  /api/portal/mission-control/engines    — security engine severity
 *     badge for the hero.
 *   • GET  /api/portal/engines/security/history   — real score history +
 *     per-day signal fired/resolved deltas (tenant_engine_snapshots +
 *     engine_score_daily_rollup) for the hero Risk Index and Daily Alert
 *     Volume, with honest "not enough history yet" states for new tenants.
 *
 * The timeframe selector genuinely re-scopes both historical charts
 * (windowDays on the resolver + start on the history route); refresh
 * genuinely re-fetches. The mock local-state mutations (fake score bumps,
 * fake policy execution, fake mitigation) are gone — automated execution is
 * honestly blocked pending the tenant's Azure app registration, matching
 * m365-health's RemediationModal treatment.
 */
import React, { useState } from 'react';
import { useLocation } from 'wouter';
import { AppShell } from '@/components/app-shell';
import { HeaderHeroBand } from '@/components/security-overview/HeaderHeroBand';
import { IdentityRiskDistribution } from '@/components/security-overview/IdentityRiskDistribution';
import { PrivilegedExposureCard } from '@/components/security-overview/PrivilegedExposureCard';
import { AlertVolumeCard } from '@/components/security-overview/AlertVolumeCard';
import { TopSecurityRisks } from '@/components/security-overview/TopSecurityRisks';
import { SecurityAutomation } from '@/components/security-overview/SecurityAutomation';
import { RiskDetailDrawer } from '@/components/security-overview/RiskDetailDrawer';
import { useSecurityOverviewLive } from '@/components/security-overview/useSecurityOverviewLive';
import type { LiveFinding } from '@/components/m365-health/useM365HealthLive';

export default function SecurityOverviewPage() {
  const [, navigate] = useLocation();
  const live = useSecurityOverviewLive();

  const [selectedFinding, setSelectedFinding] = useState<LiveFinding | null>(null);

  const openOffers = () => {
    setSelectedFinding(null);
    navigate('/customer-offers');
  };

  return (
    <AppShell title="Security Intelligence">
      <div className="min-h-screen p-4 md:p-6 lg:p-8">
        <main className="max-w-[1440px] mx-auto space-y-4 md:space-y-6">
          {/* Row 1: Hero band + Identity Risk Distribution */}
          <section className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6">
            <div className="lg:col-span-8">
              <HeaderHeroBand
                riskIndex={live.riskIndex}
                securityStatus={live.securityStatus}
                riskyUsers={live.riskyUsers}
                summary={live.summary}
                lastScanAt={live.lastScanAt}
                scanActive={live.scanActive}
                timeframe={live.timeframe}
                onTimeframeChange={live.setTimeframe}
                onRefresh={live.refresh}
                isRefreshing={live.refreshing}
              />
            </div>
            <div className="lg:col-span-4">
              <IdentityRiskDistribution
                distribution={live.identityRisk}
                trend={live.signInTrend}
                timeframe={live.timeframe}
              />
            </div>
          </section>

          {/* Row 2: Privileged Exposure + Daily Alert Volume */}
          <section className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6">
            <div className="lg:col-span-5">
              <PrivilegedExposureCard
                globalAdmins={live.globalAdmins}
                pimStandingRoles={live.pimStandingRoles}
                riskyUsers={live.riskyUsers}
                highRiskSignins={live.highRiskSignins}
              />
            </div>
            <div className="lg:col-span-7">
              <AlertVolumeCard volume={live.alertVolume} activeAlerts={live.activeAlerts} />
            </div>
          </section>

          {/* Row 3: Top Security Risks + Security Automation */}
          <section className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6">
            <div className="lg:col-span-6">
              <TopSecurityRisks
                findings={live.findings}
                everScanned={live.everScanned}
                loaded={live.loaded}
                onSelectFinding={setSelectedFinding}
              />
            </div>
            <div className="lg:col-span-6">
              <SecurityAutomation
                offers={live.automationOffers}
                loaded={live.loaded}
                lastScanAt={live.lastScanAt}
                onOpenOffers={openOffers}
              />
            </div>
          </section>
        </main>

        {/* Real finding detail drawer */}
        <RiskDetailDrawer
          finding={selectedFinding}
          onClose={() => setSelectedFinding(null)}
          onOpenOffers={openOffers}
        />
      </div>
    </AppShell>
  );
}
