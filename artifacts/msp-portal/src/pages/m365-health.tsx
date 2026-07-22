import React, { useState, useEffect } from 'react';
import { AppShell } from '@/components/app-shell';
import { HeroHealthScore } from '@/components/m365-health/HeroHealthScore';
import { IntelligenceCore } from '@/components/m365-health/IntelligenceCore';
import { PillarGrid } from '@/components/m365-health/PillarGrid';
import { CostAndRiskRow } from '@/components/m365-health/CostAndRiskRow';
import { TrendsRow } from '@/components/m365-health/TrendsRow';
import { IntelligenceSignals } from '@/components/m365-health/IntelligenceSignals';
import { ExecutiveCtaBar } from '@/components/m365-health/ExecutiveCtaBar';
import { PillarDetailModal } from '@/components/m365-health/PillarDetailModal';
import { RemediationModal } from '@/components/m365-health/RemediationModal';

import {
  INITIAL_PILLARS,
  INITIAL_SIGNALS,
  RISK_HEATMAP_GRID,
  COST_EFFICIENCY_ITEMS,
  SECURITY_TRENDS,
  ADOPTION_METRICS,
} from '@/components/m365-health/mockData';
import { PillarData, IntelligenceSignal, RiskHeatmapCell, TimeFrame } from '@/components/m365-health/types';
import { CheckCircle2, Info, Sparkles } from 'lucide-react';

export default function M365HealthPage() {
  const [timeFrame, setTimeFrame] = useState<TimeFrame>('24h');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [liveSync, setLiveSync] = useState<boolean>(true);
  const [lastUpdated, setLastUpdated] = useState<string>('Just now');

  // Core Data State
  const [pillars, setPillars] = useState<PillarData[]>(INITIAL_PILLARS);
  const [signals, setSignals] = useState<IntelligenceSignal[]>(INITIAL_SIGNALS);
  const [heatmapGrid, setHeatmapGrid] = useState<RiskHeatmapCell[]>(RISK_HEATMAP_GRID);

  // Modal / Detail States
  const [selectedPillar, setSelectedPillar] = useState<PillarData | null>(null);
  const [selectedRiskCell, setSelectedRiskCell] = useState<RiskHeatmapCell | null>(null);

  // Remediation Modal State
  const [remediationState, setRemediationState] = useState<{
    isOpen: boolean;
    title: string;
    description: string;
    pillarIdToUpgrade?: string;
    signalIdToSolve?: string;
  }>({
    isOpen: false,
    title: '',
    description: '',
  });

  // Toast Notification
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  // Compute Overall Health Score from pillars average
  const healthScore = Math.round(
    pillars.reduce((acc, p) => acc + p.score, 0) / pillars.length
  );

  // Periodic Live Sync effect
  useEffect(() => {
    if (!liveSync) return;
    const interval = setInterval(() => {
      setLastUpdated(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    }, 15000);

    return () => clearInterval(interval);
  }, [liveSync]);

  // Handle Manual Refresh
  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => {
      setIsRefreshing(false);
      setLastUpdated('Just now');
      showToast('Telemetry refreshed across all 7 pillars.');
    }, 800);
  };

  // Handle Export Report
  const handleExport = () => {
    const report = {
      tenant: 'Contoso Global Tenant',
      timestamp: new Date().toISOString(),
      healthScore,
      pillars: pillars.map((p) => ({ name: p.name, score: p.score })),
      activeSignalsCount: signals.filter((s) => !s.remediated).length,
    };

    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tenant-intelligence-report-${Date.now()}.json`;
    a.click();
    showToast('Executive report exported as JSON file.');
  };

  // Handle Pillar Selection for Modal
  const handleSelectPillar = (pillarId: string) => {
    const found = pillars.find((p) => p.id === pillarId);
    if (found) {
      setSelectedPillar(found);
    }
  };

  // Handle Signal Actions
  const handleAcknowledgeSignal = (id: string) => {
    setSignals((prev) =>
      prev.map((s) => (s.id === id ? { ...s, acknowledged: true } : s))
    );
    showToast('Signal acknowledged by tenant admin.');
  };

  const handleRemediateSignal = (id: string) => {
    const targetSignal = signals.find((s) => s.id === id);
    if (!targetSignal) return;

    setRemediationState({
      isOpen: true,
      title: `Auto-Remediate: ${targetSignal.title}`,
      description: targetSignal.description,
      signalIdToSolve: id,
      pillarIdToUpgrade: targetSignal.pillar.toLowerCase(),
    });
  };

  // Handle Recommendation execution from modal
  const handleRunRecommendation = (pillarId: string, recommendationText: string) => {
    setRemediationState({
      isOpen: true,
      title: `Apply Fix: ${pillarId.toUpperCase()}`,
      description: recommendationText,
      pillarIdToUpgrade: pillarId,
    });
  };

  // Handle Remediation Completion
  const handleRemediationComplete = () => {
    const { pillarIdToUpgrade, signalIdToSolve } = remediationState;

    if (signalIdToSolve) {
      setSignals((prev) =>
        prev.map((s) => (s.id === signalIdToSolve ? { ...s, remediated: true, acknowledged: true } : s))
      );
    }

    if (pillarIdToUpgrade) {
      setPillars((prev) =>
        prev.map((p) => {
          if (p.id === pillarIdToUpgrade || p.shortCode.toLowerCase() === pillarIdToUpgrade.toLowerCase()) {
            const newScore = Math.min(100, p.score + 3);
            return {
              ...p,
              score: newScore,
              change: p.change + 1,
              trend: 'up',
            };
          }
          return p;
        })
      );
    }

    showToast('Automated workflow executed. Metrics re-indexed.');
  };

  // Filter signals by search query
  const searchedSignals = signals.filter((s) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      s.title.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.pillar.toLowerCase().includes(q)
    );
  });

  return (
    <AppShell title="M365 Health">
    <div className="min-h-screen relative selection:bg-[#479ef5]/30 selection:text-[#a0c9ff]">
      {/* Background Grid Pattern Overlay */}
      <div className="fixed inset-0 grid-overlay pointer-events-none z-0" />

      {/* Main Container */}
      <main className="relative z-10 max-w-[1440px] mx-auto px-4 sm:px-6 py-6 md:py-8 space-y-6">
        {/* Section 1: Hero Band */}
        <HeroHealthScore
          pillars={pillars}
          healthScore={healthScore}
          scoreDelta={4}
          annualSavings={174000}
          riskReduction={63}
          copilotReadiness={71}
          onSelectPillar={handleSelectPillar}
        />

        {/* Section 2: Intelligence Core Row */}
        <IntelligenceCore
          pillars={pillars}
          heatmapGrid={heatmapGrid}
          costItems={COST_EFFICIENCY_ITEMS}
          onSelectPillar={handleSelectPillar}
          onSelectRiskCell={(cell) => setSelectedRiskCell(cell)}
        />

        {/* Section 3: 7-Pillar Score Grid */}
        <PillarGrid
          pillars={pillars}
          onSelectPillar={handleSelectPillar}
          selectedPillarId={selectedPillar?.id}
        />

        {/* Section 4: Cost & Risk Row */}
        <CostAndRiskRow
          onTriggerRiskMitigation={() =>
            setRemediationState({
              isOpen: true,
              title: 'Remediate Privileged Identity Drift',
              description: 'Automated token expiration & admin MFA re-verification policy enforcement.',
              pillarIdToUpgrade: 'security',
            })
          }
        />

        {/* Section 5: Trend Lines Row */}
        <TrendsRow
          securityTrends={SECURITY_TRENDS}
          adoptionMetrics={ADOPTION_METRICS}
        />

        {/* Section 6: Cross-Pillar Highlights / Intelligence Signals */}
        <IntelligenceSignals
          signals={searchedSignals}
          onAcknowledgeSignal={handleAcknowledgeSignal}
          onRemediateSignal={handleRemediateSignal}
          onSelectSignal={(sig) => handleRemediateSignal(sig.id)}
        />

        {/* Section 7: Executive CTA Bar */}
        <ExecutiveCtaBar
          onOpenDashboards={() => handleSelectPillar('security')}
          onEnableAutomation={() =>
            setRemediationState({
              isOpen: true,
              title: 'Enable Premium Automation Suite',
              description: 'Activating continuous policy self-healing and zero-trust auto-remediation triggers.',
              pillarIdToUpgrade: 'copilot',
            })
          }
        />
      </main>

      {/* Modals & Dialogs */}
      {selectedPillar && (
        <PillarDetailModal
          pillar={selectedPillar}
          onClose={() => setSelectedPillar(null)}
          onRunRecommendation={(pId, rec) => {
            setSelectedPillar(null);
            handleRunRecommendation(pId, rec);
          }}
        />
      )}

      <RemediationModal
        isOpen={remediationState.isOpen}
        title={remediationState.title}
        description={remediationState.description}
        onClose={() => setRemediationState({ isOpen: false, title: '', description: '' })}
        onComplete={handleRemediationComplete}
      />

      {/* Floating Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#1e2020] border border-[#479ef5] px-4 py-3 rounded-xl text-xs font-mono text-[#a0c9ff] shadow-2xl flex items-center space-x-2 animate-bounce">
          <Sparkles className="w-4 h-4 text-[#479ef5]" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
    </AppShell>
  );
}
