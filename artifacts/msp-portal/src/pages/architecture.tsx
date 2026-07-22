import React, { useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { Header } from '@/components/architecture/Header';
import { ScoreOverview } from '@/components/architecture/ScoreOverview';
import { TenantTopology } from '@/components/architecture/TenantTopology';
import { IdentityRoleDensity } from '@/components/architecture/IdentityRoleDensity';
import { ConditionalAccessMap } from '@/components/architecture/ConditionalAccessMap';
import { AppRegistrationInventory } from '@/components/architecture/AppRegistrationInventory';
import { OAuthPermissionRisk } from '@/components/architecture/OAuthPermissionRisk';
import { CollaborationMap } from '@/components/architecture/CollaborationMap';
import { TopRisks } from '@/components/architecture/TopRisks';
import { AutomationPotential } from '@/components/architecture/AutomationPotential';
import { ScanModal } from '@/components/architecture/ScanModal';
import { DetailModal } from '@/components/architecture/DetailModal';

import {
  initialTenantScore,
  initialRoleDensity,
  initialRoleMatrix,
  initialCAPolicies,
  initialAppInventory,
  initialOAuthRisk,
  initialCollabItems,
  initialRisks,
  initialAutomationTargets,
} from '@/components/architecture/mockData';

import {
  TenantScore,
  AutomationTarget,
  ArchitectureRisk,
  CAPolicy,
  CollabItem,
} from '@/components/architecture/types';

export default function ArchitecturePage() {
  const [environment, setEnvironment] = useState('TENANT-01 PRODUCTION');
  const [lastAnalysis, setLastAnalysis] = useState('Today, 04:12 AM');
  const [isScanning, setIsScanning] = useState(false);
  const [isScanModalOpen, setIsScanModalOpen] = useState(false);

  const [score, setScore] = useState<TenantScore>(initialTenantScore);
  const [targets, setTargets] = useState<AutomationTarget[]>(
    initialAutomationTargets
  );
  const [caPolicies, setCaPolicies] = useState<CAPolicy[]>(initialCAPolicies);

  // Modals state
  const [modalConfig, setModalConfig] = useState<{
    isOpen: boolean;
    title: string;
    subtitle?: string;
    type: 'anomaly' | 'risk' | 'policy' | 'generic';
    content?: React.ReactNode;
  }>({
    isOpen: false,
    title: '',
    type: 'generic',
  });

  // Notification Toast
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  const handleRunScan = () => {
    setIsScanning(true);
    setIsScanModalOpen(true);
  };

  const handleCloseScanModal = () => {
    setIsScanModalOpen(false);
    setIsScanning(false);
    setLastAnalysis('Just now');
    showToast('Full tenant scan completed successfully.');
  };

  // Target automations
  const handleApplyTarget = (targetId: string) => {
    setTargets((prev) =>
      prev.map((t) => (t.id === targetId ? { ...t, status: 'executed' } : t))
    );

    // Update score
    setScore((prev) => {
      const target = targets.find((t) => t.id === targetId);
      const impact = target ? target.scoreImpact : 2;
      const newOverall = Math.min(100, prev.overall + impact);

      let newCA = prev.caArchitecture;
      let newOAuth = prev.oauthGovernance;
      let newCollab = prev.collabStructure;

      if (targetId === 'auto-1') {
        newCA = 92;
        // Update CA policy status
        setCaPolicies((pPrev) =>
          pPrev.map((p) => ({ ...p, device: 'aligned', risk: 'aligned', enforcement: 'ACTIVE' }))
        );
      } else if (targetId === 'auto-2') {
        newOAuth = 88;
      } else if (targetId === 'auto-3') {
        newCollab = 94;
      }

      return {
        ...prev,
        overall: newOverall,
        caArchitecture: newCA,
        oauthGovernance: newOAuth,
        collabStructure: newCollab,
        trend: `+${((newOverall - 88) + 3.2).toFixed(1)}% from last week`,
        summary:
          newOverall >= 94
            ? 'Optimal alignment achieved across all CA policies, OAuth consent, and site structures.'
            : 'Automation applied. Tenant security posture improved.',
      };
    });

    const tgtName = targets.find((t) => t.id === targetId)?.title || 'Target';
    showToast(`Successfully executed automation target: ${tgtName}`);
  };

  const handleApplyAll = () => {
    setTargets((prev) => prev.map((t) => ({ ...t, status: 'executed' })));
    setCaPolicies((pPrev) =>
      pPrev.map((p) => ({
        ...p,
        device: 'aligned',
        location: 'aligned',
        risk: 'aligned',
        app: 'aligned',
        enforcement: 'ACTIVE',
      }))
    );

    setScore({
      overall: 94,
      projected: 94,
      trend: '+9.2% from last week',
      summary:
        'Optimal tenant alignment achieved across CA, OAuth, and Collaboration structures.',
      directoryHygiene: 92,
      caArchitecture: 94,
      oauthGovernance: 90,
      collabStructure: 94,
    });

    showToast('Automated all 3 targets! Architecture score increased to 94/100.');
  };

  const handleReset = () => {
    setScore(initialTenantScore);
    setTargets(initialAutomationTargets);
    setCaPolicies(initialCAPolicies);
    showToast('Reset dashboard to original state.');
  };

  // Modal Openers
  const handleOpenAnomalies = () => {
    setModalConfig({
      isOpen: true,
      title: 'Structural Anomalies Detected (12)',
      subtitle: 'Tenant-01 Topology Integrity Engine',
      type: 'anomaly',
      content: (
        <div className="space-y-3">
          <div className="rounded border border-[#f59e0b]/30 bg-[#f59e0b]/10 p-3">
            <div className="font-bold text-[#f59e0b]">
              Orphaned Security Groups (8)
            </div>
            <p className="mt-1 text-[#c0c7d3]">
              8 security groups have no active owners or members assigned following
              recent OU migration.
            </p>
          </div>
          <div className="rounded border border-[#f59e0b]/30 bg-[#f59e0b]/10 p-3">
            <div className="font-bold text-[#f59e0b]">
              Circular Nested Group Dependencies (4)
            </div>
            <p className="mt-1 text-[#c0c7d3]">
              Group &quot;Sec-Dev-Admins&quot; contains circular nested references with
              &quot;Sec-Cloud-Ops&quot; creating token evaluation loops.
            </p>
          </div>
        </div>
      ),
    });
  };

  const handleSelectRisk = (risk: ArchitectureRisk) => {
    setModalConfig({
      isOpen: true,
      title: risk.title,
      subtitle: `Data endpoint: ${risk.dataPath}`,
      type: 'risk',
      content: (
        <div className="space-y-3">
          <div className="rounded bg-[#121414] p-3 border border-[#282a2b]">
            <div className="font-bold text-[#e2e2e2] mb-1">Impact Analysis</div>
            <p className="text-[#c0c7d3]">{risk.description}</p>
          </div>
          <div className="rounded bg-[#001c37] p-3 border border-[#479ef5]/30">
            <div className="font-bold text-[#a0c9ff] mb-1">Recommended Remediation</div>
            <p className="text-[#c0c7d3]">{risk.remediation}</p>
          </div>
        </div>
      ),
    });
  };

  const handleSelectPolicy = (pol: CAPolicy) => {
    setModalConfig({
      isOpen: true,
      title: `Policy: ${pol.name}`,
      subtitle: `Enforcement Mode: ${pol.enforcement}`,
      type: 'policy',
      content: (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 text-center my-2">
            <div className="p-2 border border-[#282a2b] bg-[#121414] rounded">
              <span className="text-[#8a919d]">Device Rule:</span>{' '}
              <strong className="text-[#a0c9ff] uppercase">{pol.device}</strong>
            </div>
            <div className="p-2 border border-[#282a2b] bg-[#121414] rounded">
              <span className="text-[#8a919d]">Location Rule:</span>{' '}
              <strong className="text-[#a0c9ff] uppercase">{pol.location}</strong>
            </div>
            <div className="p-2 border border-[#282a2b] bg-[#121414] rounded">
              <span className="text-[#8a919d]">Risk Rule:</span>{' '}
              <strong className="text-[#a0c9ff] uppercase">{pol.risk}</strong>
            </div>
            <div className="p-2 border border-[#282a2b] bg-[#121414] rounded">
              <span className="text-[#8a919d]">App Scope:</span>{' '}
              <strong className="text-[#a0c9ff] uppercase">{pol.app}</strong>
            </div>
          </div>
        </div>
      ),
    });
  };

  const isAllExecuted = targets.every((t) => t.status === 'executed');
  const isRemediated = score.overall > initialTenantScore.overall;

  return (
    <AppShell title="Architecture">
    <div className="min-h-screen bg-[#121414] text-[#e2e2e2] antialiased selection:bg-[#479ef5] selection:text-[#001c37] p-4 sm:p-6 lg:p-8 max-w-[1440px] mx-auto">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 rounded-md border border-[#479ef5]/40 bg-[#001c37] px-4 py-3 font-mono text-xs font-semibold text-[#a0c9ff] shadow-2xl transition-all animate-bounce">
          {toastMessage}
        </div>
      )}

      <Header
        currentEnvironment={environment}
        onSelectEnvironment={setEnvironment}
        lastAnalysisTime={lastAnalysis}
        isScanning={isScanning}
        onRunScan={handleRunScan}
        isRemediated={isRemediated}
        onReset={handleReset}
      />

      {/* Top Score Row */}
      <ScoreOverview
        score={score}
        onCardClick={(title) => showToast(`Selected metric: ${title}`)}
      />

      {/* Section 1: Topology & Identity Density */}
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <TenantTopology
          tenantName={environment.split(' ')[0]}
          onOpenAnomalies={handleOpenAnomalies}
        />
        <IdentityRoleDensity
          roles={initialRoleDensity}
          matrix={initialRoleMatrix}
        />
      </div>

      {/* Section 2: Conditional Access Architecture Map */}
      <ConditionalAccessMap
        policies={caPolicies}
        onSelectPolicy={handleSelectPolicy}
      />

      {/* Section 3: App Inventory & OAuth Risk */}
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <AppRegistrationInventory inventory={initialAppInventory} />
        <OAuthPermissionRisk oauthRisk={initialOAuthRisk} />
      </div>

      {/* Section 4: Collaboration Structure Map */}
      <CollaborationMap
        items={initialCollabItems}
        onItemClick={(item: CollabItem) =>
          showToast(`Inspecting ${item.title}: ${item.value}`)
        }
      />

      {/* Section 5: Top Risks & Automation Potential */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <TopRisks risks={initialRisks} onSelectRisk={handleSelectRisk} />
        <AutomationPotential
          targets={targets}
          onApplyTarget={handleApplyTarget}
          onApplyAll={handleApplyAll}
          isAllExecuted={isAllExecuted}
        />
      </div>

      {/* Analysis Scan Modal */}
      <ScanModal
        isOpen={isScanModalOpen}
        onClose={handleCloseScanModal}
        environmentName={environment}
      />

      {/* Detail Inspection Modal */}
      <DetailModal
        isOpen={modalConfig.isOpen}
        onClose={() => setModalConfig({ ...modalConfig, isOpen: false })}
        title={modalConfig.title}
        subtitle={modalConfig.subtitle}
        type={modalConfig.type}
        content={modalConfig.content}
      />
    </div>
    </AppShell>
  );
}
