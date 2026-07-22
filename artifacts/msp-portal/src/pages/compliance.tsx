import React, { useState, useMemo } from 'react';
import { Header } from './components/Header';
import { HeroBand } from './components/HeroBand';
import { LabelCoverageCard } from './components/LabelCoverageCard';
import { SensitivityTrendCard } from './components/SensitivityTrendCard';
import { RetentionCoverageCard } from './components/RetentionCoverageCard';
import { DlpEffectivenessCard } from './components/DlpEffectivenessCard';
import { AuditHeatmapCard } from './components/AuditHeatmapCard';
import { TopRisksCard } from './components/TopRisksCard';
import { AutomationPotentialSection } from './components/AutomationPotentialSection';
import { RiskDetailModal } from './components/RiskDetailModal';
import { PatchModal } from './components/PatchModal';
import { Footer } from './components/Footer';

import {
  initialMetricSummary,
  initialLabelBreakdown,
  initialTrendData,
  initialWorkloads,
  initialDlpBreakdown,
  initialAuditMatrix,
  initialRisks,
  initialPatches
} from './data/initialData';

import { ComplianceRisk, AutomationPatch } from './types';

export default function App() {
  const [searchQuery, setSearchQuery] = useState('');
  const [metrics, setMetrics] = useState(initialMetricSummary);
  const [labelBreakdown, setLabelBreakdown] = useState(initialLabelBreakdown);
  const [workloads, setWorkloads] = useState(initialWorkloads);
  const [dlpBreakdown] = useState(initialDlpBreakdown);
  const [riskScore, setRiskScore] = useState(42);
  const [auditMatrix] = useState(initialAuditMatrix);
  const [risks, setRisks] = useState<ComplianceRisk[]>(initialRisks);
  const [patches, setPatches] = useState<AutomationPatch[]>(initialPatches);

  const [selectedRisk, setSelectedRisk] = useState<ComplianceRisk | null>(null);
  const [selectedPatch, setSelectedPatch] = useState<AutomationPatch | null>(null);

  // Filter risks based on search query
  const filteredRisks = useMemo(() => {
    if (!searchQuery.trim()) return risks;
    const q = searchQuery.toLowerCase();
    return risks.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        r.affectedWorkloads.some((w) => w.toLowerCase().includes(q))
    );
  }, [risks, searchQuery]);

  // Handle risk resolution
  const handleResolveRisk = (riskId: string) => {
    setRisks((prev) => prev.filter((r) => r.id !== riskId));
    setMetrics((prev) => ({
      ...prev,
      healthScore: Math.min(100, prev.healthScore + 2),
      healthChange: +(prev.healthChange + 0.5).toFixed(1)
    }));
  };

  // Handle patch application
  const handleApplyPatch = (patchId: string) => {
    setPatches((prev) =>
      prev.map((p) => (p.id === patchId ? { ...p, applied: true } : p))
    );

    const targetPatch = patches.find((p) => p.id === patchId);

    if (patchId === 'patch-01') {
      // Auto-apply sensitivity labels
      setLabelBreakdown((prev) => ({
        ...prev,
        labeledPercentage: 80,
        unlabeledPercentage: 14,
        mislabeledPercentage: 6
      }));
      setMetrics((prev) => ({
        ...prev,
        labeledRatio: 80,
        healthScore: Math.min(100, prev.healthScore + 5)
      }));
    } else if (patchId === 'patch-02') {
      // Tighten DLP rules
      setRiskScore(28);
      setMetrics((prev) => ({
        ...prev,
        healthScore: Math.min(100, prev.healthScore + 6)
      }));
    } else if (patchId === 'patch-03') {
      // Enforce retention baseline
      setWorkloads((prev) =>
        prev.map((w) =>
          w.id === 'teams'
            ? {
                ...w,
                percentage: 92,
                statusText: '92% Covered',
                statusType: 'covered',
                segments: { covered: 92, gaps: 0, unprotected: 8 }
              }
            : w
        )
      );
      setMetrics((prev) => ({
        ...prev,
        retentionCoverageRatio: 98,
        healthScore: Math.min(100, prev.healthScore + 5)
      }));
    }

    if (targetPatch) {
      setSelectedPatch(null);
    }
  };

  return (
    <div className="font-['Inter'] text-[#e2e2e2] technical-grid min-h-screen flex flex-col justify-between">
      {/* Header Bar */}
      <Header
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        unreadCount={risks.length}
      />

      {/* Main Container */}
      <main className="max-w-[1440px] mx-auto px-6 py-6 space-y-6 w-full flex-1">
        {/* SECTION 1: HERO BAND */}
        <HeroBand metrics={metrics} />

        {/* SECTION 2: LABEL COVERAGE & SENSITIVITY TREND */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <LabelCoverageCard data={labelBreakdown} />
          <SensitivityTrendCard trendData={initialTrendData} />
        </section>

        {/* SECTION 3: RETENTION COVERAGE BY WORKLOAD */}
        <section>
          <RetentionCoverageCard workloads={workloads} />
        </section>

        {/* SECTION 4 & 5: DLP EFFECTIVENESS & AUDIT LOG HEATMAP */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <DlpEffectivenessCard dlpData={dlpBreakdown} riskScore={riskScore} />
          <AuditHeatmapCard matrix={auditMatrix} />
        </section>

        {/* SECTION 6: TOP 5 COMPLIANCE RISKS */}
        <section>
          <TopRisksCard
            risks={filteredRisks}
            onRiskSelect={(risk) => setSelectedRisk(risk)}
          />
        </section>

        {/* SECTION 7: COMPLIANCE AUTOMATION POTENTIAL */}
        <section>
          <AutomationPotentialSection
            patches={patches}
            onPatchAction={(patch) => setSelectedPatch(patch)}
          />
        </section>
      </main>

      {/* Modals */}
      <RiskDetailModal
        risk={selectedRisk}
        onClose={() => setSelectedRisk(null)}
        onResolve={handleResolveRisk}
      />

      <PatchModal
        patch={selectedPatch}
        onClose={() => setSelectedPatch(null)}
        onApply={handleApplyPatch}
      />

      {/* Footer */}
      <Footer />
    </div>
  );
}
