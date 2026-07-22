import React, { useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { Header } from '@/components/governance/Header';
import { HeroMetrics } from '@/components/governance/HeroMetrics';
import { RoleInventory } from '@/components/governance/RoleInventory';
import { AdminExposureMatrix } from '@/components/governance/AdminExposureMatrix';
import { GroupSprawl } from '@/components/governance/GroupSprawl';
import { PolicyDriftTrend } from '@/components/governance/PolicyDriftTrend';
import { TopGovernanceRisks } from '@/components/governance/TopGovernanceRisks';
import { AutomationPotential } from '@/components/governance/AutomationPotential';
import { RiskDetailModal } from '@/components/governance/RiskDetailModal';

import {
  initialHealthData,
  initialRoleInventory,
  initialAdminExposure,
  initialGroupStats,
  generateHeatmapCells,
  initialPolicyDriftTrend,
  initialGovernanceRisks,
  initialAutomations,
  threatLandscapeInfo
} from '@/components/governance/governanceData';

import { GovernanceRisk, HeatmapCell, GovernanceAutomation } from '@/components/governance/types';
import { CheckCircle2 } from 'lucide-react';

export default function GovernancePage() {
  const [healthData, setHealthData] = useState(initialHealthData);
  const [roles] = useState(initialRoleInventory);
  const [exposureMetrics] = useState(initialAdminExposure);
  const [groupStats] = useState(initialGroupStats);
  const [heatmapCells] = useState(generateHeatmapCells);
  const [driftTrend] = useState(initialPolicyDriftTrend);
  const [risks, setRisks] = useState(initialGovernanceRisks);
  const [automations, setAutomations] = useState<GovernanceAutomation[]>(initialAutomations);

  const [isScanning, setIsScanning] = useState(false);
  const [latency, setLatency] = useState(12);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const [selectedRisk, setSelectedRisk] = useState<GovernanceRisk | null>(null);
  const [selectedCell, setSelectedCell] = useState<HeatmapCell | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 3500);
  };

  const handleRunAudit = () => {
    setIsScanning(true);
    setLatency(Math.floor(Math.random() * 8) + 8);
    setTimeout(() => {
      setIsScanning(false);
      showToast('System Level 4 policy audit completed successfully.');
    }, 1800);
  };

  const handleExecuteAutomation = (id: string) => {
    setAutomations((prev) =>
      prev.map((auto) => (auto.id === id ? { ...auto, status: 'EXECUTING' } : auto))
    );

    setTimeout(() => {
      setAutomations((prev) =>
        prev.map((auto) => (auto.id === id ? { ...auto, status: 'EXECUTED' } : auto))
      );
      setHealthData((prev) => ({
        ...prev,
        score: Math.min(100, prev.score + 4),
        driftEvents30D: Math.max(0, prev.driftEvents30D - 12)
      }));
      showToast('Automation batch policy successfully executed.');
    }, 1400);
  };

  const handleRemediateSuccess = () => {
    setHealthData((prev) => ({
      ...prev,
      score: Math.min(100, prev.score + 3)
    }));

    if (selectedRisk) {
      setRisks((prev) => prev.filter((r) => r.id !== selectedRisk.id));
    }

    showToast('Risk remediated. Governance health score updated.');
  };

  return (
    <AppShell title="Governance">
    <div className="technical-grid min-h-screen text-[#e2e2e2] relative font-body selection:bg-[#479ef5]/30 selection:text-white">
      {/* Scanner Animation Line when auditing */}
      {isScanning && <div className="scanner-line"></div>}

      {/* Atmospheric Radial Glows */}
      <div className="fixed top-0 right-0 w-[500px] h-[500px] bg-[#479ef5]/5 rounded-full blur-[120px] pointer-events-none z-0"></div>
      <div className="fixed bottom-0 left-0 w-[300px] h-[300px] bg-[#c084fc]/5 rounded-full blur-[100px] pointer-events-none z-0"></div>

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#1e2020] border border-[#22c55e]/50 text-[#e2e2e2] px-4 py-3 rounded-lg shadow-2xl flex items-center gap-3 font-mono text-xs animate-in slide-in-from-bottom-5">
          <CheckCircle2 className="w-4 h-4 text-[#22c55e]" />
          <span>{toastMessage}</span>
        </div>
      )}

      <main className="max-w-[1440px] mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6 relative z-10">
        {/* Section 0: Header */}
        <Header
          latency={latency}
          status="SECURE_OPERATIONAL"
          isScanning={isScanning}
          onRefresh={handleRunAudit}
        />

        {/* Section 1: Hero Metrics */}
        <HeroMetrics
          data={healthData}
          onCardClick={(key) => {
            showToast(`Filtering metrics by ${key.toUpperCase()}`);
          }}
        />

        {/* Section 2: Role Inventory & Admin Exposure Matrix */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <RoleInventory
            roles={roles}
            onSelectRole={(r) => showToast(`Selected Role: ${r.roleName}`)}
          />
          <AdminExposureMatrix metrics={exposureMetrics} />
        </section>

        {/* Section 3: Group Sprawl & Heat Map */}
        <GroupSprawl
          stats={groupStats}
          cells={heatmapCells}
          onCellClick={(cell) => setSelectedCell(cell)}
        />

        {/* Section 4: Audit & Policy Drift Trend */}
        <PolicyDriftTrend data={driftTrend} />

        {/* Section 5: Top 5 Governance Risks & Threat Landscape */}
        <TopGovernanceRisks
          risks={risks}
          threatInfo={threatLandscapeInfo}
          onSelectRisk={(risk) => setSelectedRisk(risk)}
        />

        {/* Section 6: Governance Automation Potential */}
        <AutomationPotential
          automations={automations}
          onExecute={handleExecuteAutomation}
        />
      </main>

      {/* Risk Detail / Cell Detail Modal */}
      <RiskDetailModal
        risk={selectedRisk}
        cell={selectedCell}
        onClose={() => {
          setSelectedRisk(null);
          setSelectedCell(null);
        }}
        onRemediateSuccess={handleRemediateSuccess}
      />
    </div>
    </AppShell>
  );
}
