import React, { useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { IdentityRiskDistribution } from '@/components/security-overview/IdentityRiskDistribution';
import { PrivilegedExposureCard } from '@/components/security-overview/PrivilegedExposureCard';
import { AlertVolumeCard } from '@/components/security-overview/AlertVolumeCard';
import { TopSecurityRisks } from '@/components/security-overview/TopSecurityRisks';
import { SecurityAutomation } from '@/components/security-overview/SecurityAutomation';
import { RiskDetailDrawer } from '@/components/security-overview/RiskDetailDrawer';
import { ToastContainer } from '@/components/security-overview/ToastContainer';

import {
  initialMetrics,
  initialRiskDistribution,
  initialSignInTrend,
  initialPrivilegedMetrics,
  initialAlertVolume,
  initialSecurityRisks,
  initialAutomationPolicies,
} from '@/components/security-overview/mockData';

import {
  SecurityMetrics,
  RiskDistribution,
  TimeFrame,
  SecurityRiskItem,
  AutomationPolicy,
  ToastMessage,
} from '@/components/security-overview/types';

export default function SecurityOverviewPage() {
  const [metrics, setMetrics] = useState<SecurityMetrics>(initialMetrics);
  const [riskDistribution, setRiskDistribution] = useState<RiskDistribution>(initialRiskDistribution);
  const [signInTrend, setSignInTrend] = useState(initialSignInTrend);
  const [privilegedMetrics, setPrivilegedMetrics] = useState(initialPrivilegedMetrics);
  const [alertVolume, setAlertVolume] = useState(initialAlertVolume);
  const [risks, setRisks] = useState<SecurityRiskItem[]>(initialSecurityRisks);
  const [policies, setPolicies] = useState<AutomationPolicy[]>(initialAutomationPolicies);

  const [timeframe, setTimeframe] = useState<TimeFrame>('24h');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedRisk, setSelectedRisk] = useState<SecurityRiskItem | null>(null);
  const [activeProcessingPolicyId, setActiveProcessingPolicyId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Add toast helper
  const addToast = (title: string, description: string, type: 'info' | 'success' = 'info') => {
    const id = Date.now().toString();
    setToasts((prev) => [...prev, { id, title, description, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Handle Timeframe Switch
  const handleTimeframeChange = (newTf: TimeFrame) => {
    setTimeframe(newTf);
    if (newTf === '24h') {
      setMetrics((m) => ({ ...m, criticalAlerts24h: 5 }));
    } else if (newTf === '7d') {
      setMetrics((m) => ({ ...m, criticalAlerts24h: 24 }));
    } else {
      setMetrics((m) => ({ ...m, criticalAlerts24h: 89 }));
    }
    addToast('Timeframe Updated', `Telemetry scope switched to ${newTf.toUpperCase()}.`, 'info');
  };

  // Refresh Telemetry Stream
  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => {
      setIsRefreshing(false);
      setMetrics((m) => ({
        ...m,
        healthScore: Math.min(100, m.healthScore + 1),
      }));
      addToast('Telemetry Stream Synced', 'Graph API streaming connection re-established with latest claims.', 'success');
    }, 800);
  };

  // Trigger Automation Policy Action
  const handleTriggerPolicy = (policy: AutomationPolicy) => {
    setActiveProcessingPolicyId(policy.id);
    setTimeout(() => {
      setActiveProcessingPolicyId(null);

      setPolicies((prev) =>
        prev.map((p) => {
          if (p.id === policy.id) {
            const nextStatus =
              p.actionType === 'ENFORCE'
                ? 'enforced'
                : p.actionType === 'SYNC'
                ? 'synced'
                : 'reviewed';
            return { ...p, status: nextStatus };
          }
          return p;
        })
      );

      setMetrics((m) => ({
        ...m,
        healthScore: Math.min(100, m.healthScore + 4),
        potentialRiskReduction: Math.max(0, m.potentialRiskReduction - 8),
      }));

      addToast(
        `Policy ${policy.actionType} Executed`,
        `${policy.title} policy applied across tenant directory.`,
        'success'
      );
    }, 1000);
  };

  // Mitigate / Remediate Selected Risk
  const handleMitigateRisk = (riskId: string, actionName: string) => {
    setRisks((prev) =>
      prev.map((r) => (r.id === riskId ? { ...r, status: 'mitigated' } : r))
    );

    setMetrics((m) => ({
      ...m,
      highRiskIdentities: Math.max(0, m.highRiskIdentities - 1),
      healthScore: Math.min(100, m.healthScore + 3),
    }));

    addToast(
      'Risk Remediation Ingested',
      `Action "${actionName}" deployed to conditional access rule engine.`,
      'success'
    );
  };

  return (
    <AppShell title="Security Intelligence">
    <div className="tech-grid min-h-screen p-4 md:p-6 lg:p-8 font-body">
      <main className="max-w-[1440px] mx-auto space-y-4 md:space-y-6">
        {/* Row 1: Header Hero Band + Identity Risk Distribution */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6">
          <div className="lg:col-span-8"></div>
          <div className="lg:col-span-4">
            <IdentityRiskDistribution
              distribution={riskDistribution}
              trend={signInTrend}
            />
          </div>
        </section>

        {/* Row 2: Privileged Exposure & Alert Volume */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6">
          <div className="lg:col-span-5">
            <PrivilegedExposureCard metrics={privilegedMetrics} />
          </div>
          <div className="lg:col-span-7">
            <AlertVolumeCard volumeData={alertVolume} mtta={metrics.mtta} />
          </div>
        </section>

        {/* Row 3: Top Security Risks & Security Automation Potential */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6">
          <div className="lg:col-span-6">
            <TopSecurityRisks
              risks={risks}
              onSelectRisk={(r) => setSelectedRisk(r)}
            />
          </div>
          <div className="lg:col-span-6">
            <SecurityAutomation
              policies={policies}
              onTriggerPolicy={handleTriggerPolicy}
              activeProcessingId={activeProcessingPolicyId}
            />
          </div>
        </section>
      </main>

      {/* Side Drawer for Risk Details */}
      <RiskDetailDrawer
        risk={selectedRisk}
        onClose={() => setSelectedRisk(null)}
        onMitigate={handleMitigateRisk}
      />

      {/* Action Feedback Toast Messages */}
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </div>
    </AppShell>
  );
}
