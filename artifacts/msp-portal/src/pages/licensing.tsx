import React, { useState } from 'react';
import { Header } from './components/Header';
import { HeroBand } from './components/HeroBand';
import { SkuInventory } from './components/SkuInventory';
import { AssignmentHygiene } from './components/AssignmentHygiene';
import { WasteDistribution } from './components/WasteDistribution';
import { CopilotEngagement } from './components/CopilotEngagement';
import { PriorityInsights } from './components/PriorityInsights';
import { AutomationCandidates } from './components/AutomationCandidates';
import { PatchModal } from './components/PatchModal';
import { UserInspectModal } from './components/UserInspectModal';
import { ToastContainer, ToastMessage } from './components/Toast';
import { Footer } from './components/Footer';

import {
  INITIAL_SKUS,
  INITIAL_HYGIENE_MATRIX,
  INITIAL_PRIORITY_INSIGHTS,
  INITIAL_AUTOMATION_CANDIDATES,
  SAMPLE_AFFECTED_USERS,
} from './data/mockData';

import {
  FilterState,
  AutomationCandidate,
  PriorityInsight,
  AffectedUser,
  SkuItem,
} from './types';

export default function App() {
  const [filter, setFilter] = useState<FilterState>({
    timeRange: '30d',
    department: 'All',
    instance: 'ARC-INTEL-09X',
  });

  const [efficiencyScore, setEfficiencyScore] = useState(84);
  const [monthlyWaste, setMonthlyWaste] = useState(12450);
  const [savingsPotential, setSavingsPotential] = useState('$149.2K');
  const [underLicensedUsers, setUnderLicensedUsers] = useState(428);
  const [copilotReadiness, setCopilotReadiness] = useState(62.8);

  const [skus, setSkus] = useState<SkuItem[]>(INITIAL_SKUS);
  const [hygieneMatrix, setHygieneMatrix] = useState(INITIAL_HYGIENE_MATRIX);
  const [insights, setInsights] = useState<PriorityInsight[]>(INITIAL_PRIORITY_INSIGHTS);
  const [candidates, setCandidates] = useState<AutomationCandidate[]>(INITIAL_AUTOMATION_CANDIDATES);
  const [users, setUsers] = useState<AffectedUser[]>(SAMPLE_AFFECTED_USERS);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedPatch, setSelectedPatch] = useState<AutomationCandidate | null>(null);

  const [inspectModal, setInspectModal] = useState<{
    open: boolean;
    title: string;
    subtitle: string;
    users: AffectedUser[];
  }>({
    open: false,
    title: '',
    subtitle: '',
    users: [],
  });

  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);
  };

  const handleDismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const handleFilterChange = (newFilter: Partial<FilterState>) => {
    setFilter((prev) => ({ ...prev, ...newFilter }));
    addToast(`Filter updated: ${Object.keys(newFilter)[0]}`, 'info');
  };

  const handleRefresh = () => {
    setIsRefreshing(true);
    addToast('Synchronizing Microsoft Graph API telemetry...', 'info');
    setTimeout(() => {
      setIsRefreshing(false);
      addToast('Tenant metrics updated from live telemetry', 'success');
    }, 1200);
  };

  const handleExport = () => {
    const reportData = `ArchIntel Systems - Tenant Licensing Report (${filter.instance})\nDate: ${new Date().toLocaleDateString()}\nEfficiency Score: ${efficiencyScore}/100\nMonthly Waste: $${monthlyWaste}\nUnder-Licensed: ${underLicensedUsers} users`;
    const blob = new Blob([reportData], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Licensing-Intelligence-${filter.instance}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    addToast('Licensing intelligence report exported', 'success');
  };

  const handleInitializePatch = (candidate: AutomationCandidate) => {
    setSelectedPatch(candidate);
  };

  const handleApplyPatch = (candidateId: string) => {
    setCandidates((prev) =>
      prev.map((c) => (c.id === candidateId ? { ...c, status: 'applied' } : c))
    );

    setEfficiencyScore((prev) => Math.min(100, prev + 4));
    setMonthlyWaste((prev) => Math.max(2000, prev - 4200));

    addToast(`Patch executed: ${candidates.find((c) => c.id === candidateId)?.title}`, 'success');
  };

  const handleHygieneCellClick = (
    department: string,
    category: 'inactive' | 'disabled' | 'overlap',
    count: number
  ) => {
    const filtered = users.filter((u) => {
      if (category === 'inactive') return u.issue.includes('Inactive') || u.issue.includes('Zero Login');
      if (category === 'disabled') return u.issue.includes('Disabled');
      if (category === 'overlap') return u.issue.includes('Overlap');
      return true;
    });

    setInspectModal({
      open: true,
      title: `${department} Department - ${category.toUpperCase()} Licenses`,
      subtitle: `Inspecting ${count} flagged accounts in ${department}`,
      users: filtered.length > 0 ? filtered : users,
    });
  };

  const handleSelectInsight = (insight: PriorityInsight) => {
    setInspectModal({
      open: true,
      title: `Priority Insight: ${insight.title}`,
      subtitle: insight.description,
      users: users,
    });
  };

  const handleInspectRiskUsers = () => {
    setInspectModal({
      open: true,
      title: 'Under-Licensing Risk - Purview Audit',
      subtitle: '128 users performing Microsoft Purview actions on M365 E3 licenses without compliance add-on.',
      users: users.filter((u) => u.issue.includes('Purview') || u.sku.includes('E3')),
    });
  };

  const handleFixUser = (userId: string) => {
    setUsers((prev) => prev.filter((u) => u.id !== userId));
    addToast('License action applied to target user account', 'success');
  };

  const handleHeroCardClick = (type: string) => {
    switch (type) {
      case 'efficiency':
        addToast(`Efficiency Score: ${efficiencyScore}/100 based on SKU assignment density`, 'info');
        break;
      case 'waste':
        addToast(`Monthly Waste: $${monthlyWaste.toLocaleString()} across unused seats`, 'info');
        break;
      case 'savings':
        addToast(`Annual Potential Savings: ${savingsPotential}`, 'info');
        break;
      case 'underlicensed':
        handleInspectRiskUsers();
        break;
      case 'copilot':
        setSelectedPatch(candidates[2] || null);
        break;
    }
  };

  return (
    <div className="min-h-screen technical-grid pb-12 pt-8 text-[#e2e2e2]">
      {/* Atmosphere radial background light */}
      <div className="fixed inset-0 pointer-events-none z-[-1] overflow-hidden">
        <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-[#479ef5]/5 blur-[120px]" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-[#5a3289]/5 blur-[120px]" />
      </div>

      <main className="max-w-[1440px] mx-auto px-6 space-y-6">
        {/* Header */}
        <Header
          filter={filter}
          onFilterChange={handleFilterChange}
          onRefresh={handleRefresh}
          onExport={handleExport}
          isRefreshing={isRefreshing}
        />

        {/* Section 1: Hero Band */}
        <HeroBand
          efficiencyScore={efficiencyScore}
          monthlyWaste={monthlyWaste}
          monthlyWasteChange="2.4%"
          savingsPotential={savingsPotential}
          underLicensedUsers={underLicensedUsers}
          copilotReadiness={copilotReadiness}
          onCardClick={handleHeroCardClick}
        />

        {/* Section 2 & 3: SKU Inventory & Hygiene */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8">
            <SkuInventory
              skus={skus}
              onSelectSku={(sku) =>
                addToast(`Inspecting ${sku.name} (${sku.assignedCount} assigned)`, 'info')
              }
            />
          </div>
          <div className="lg:col-span-4">
            <AssignmentHygiene
              data={hygieneMatrix}
              onCellClick={handleHygieneCellClick}
            />
          </div>
        </section>

        {/* Section 4, 5 & 6: Waste, Copilot & Priority Insights */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <WasteDistribution onInspectRiskUsers={handleInspectRiskUsers} />
          <CopilotEngagement
            onAutoAssignTrigger={() => setSelectedPatch(candidates[2] || null)}
          />
          <PriorityInsights
            insights={insights}
            onSelectInsight={handleSelectInsight}
          />
        </section>

        {/* Section 7: Automation Candidates */}
        <AutomationCandidates
          candidates={candidates}
          onInitializePatch={handleInitializePatch}
        />
      </main>

      {/* Footer */}
      <Footer />

      {/* Interactive Modals */}
      {selectedPatch && (
        <PatchModal
          candidate={selectedPatch}
          onClose={() => setSelectedPatch(null)}
          onApplyPatch={handleApplyPatch}
        />
      )}

      {inspectModal.open && (
        <UserInspectModal
          title={inspectModal.title}
          subtitle={inspectModal.subtitle}
          users={inspectModal.users}
          onClose={() =>
            setInspectModal((prev) => ({ ...prev, open: false }))
          }
          onFixUser={handleFixUser}
        />
      )}

      {/* Toast System */}
      <ToastContainer toasts={toasts} onDismiss={handleDismissToast} />
    </div>
  );
}
