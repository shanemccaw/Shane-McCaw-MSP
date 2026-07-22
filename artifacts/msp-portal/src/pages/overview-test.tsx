import React, { useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { HeroSnapshot } from '@/components/overview-test/HeroSnapshot';
import { CriticalFindings } from '@/components/overview-test/CriticalFindings';
import { ScoreDrivers } from '@/components/overview-test/ScoreDrivers';
import { LicenseIntelligence } from '@/components/overview-test/LicenseIntelligence';
import { IdentityAccess } from '@/components/overview-test/IdentityAccess';
import { ComplianceDistribution } from '@/components/overview-test/ComplianceDistribution';
import { AutomationOrchestration } from '@/components/overview-test/AutomationOrchestration';
import { FindingDetailModal } from '@/components/overview-test/FindingDetailModal';
import { SOWModal } from '@/components/overview-test/SOWModal';
import { ReportModal } from '@/components/overview-test/ReportModal';
import { DriftScheduleModal } from '@/components/overview-test/DriftScheduleModal';
import { ToastContainer, ToastMessage } from '@/components/overview-test/Toast';

import {
  initialScoreCards,
  initialCriticalFindings,
  scoreDriverCategories,
  licenseMetrics,
  identityMetrics,
  complianceData,
  automationTasks,
} from '@/components/overview-test/mockData';
import { CriticalFinding, AutomationTask, ScoreCardData } from '@/components/overview-test/types';

export default function OverviewTestPage() {
  const [scoreCards, setScoreCards] = useState<ScoreCardData[]>(initialScoreCards);
  const [criticalFindings, setCriticalFindings] = useState<CriticalFinding[]>(
    initialCriticalFindings
  );
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const [selectedFinding, setSelectedFinding] = useState<CriticalFinding | null>(null);
  const [showSOWModal, setShowSOWModal] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [showDriftModal, setShowDriftModal] = useState(false);

  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Toast Helper
  const addToast = (text: string, type: 'success' | 'info' = 'success') => {
    const id = Date.now().toString();
    setToasts((prev) => [...prev, { id, text, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Handle Finding Remediation
  const handleRemediateFinding = (id: string) => {
    setCriticalFindings((prev) =>
      prev.map((f) => (f.id === id ? { ...f, status: 'remediated' } : f))
    );
    // Upgrade security score
    setScoreCards((prev) =>
      prev.map((c) => (c.category === 'security' ? { ...c, score: 82, change: '+2.5%' } : c))
    );
    addToast('Finding remediated! Tenant Security score increased to 82%.', 'success');
  };

  // Handle Automation Action Cards
  const handleTaskAction = (task: AutomationTask) => {
    switch (task.actionType) {
      case 'pdf':
        setShowReportModal(true);
        break;
      case 'sow':
        setShowSOWModal(true);
        break;
      case 'plan':
        if (criticalFindings.length > 0) {
          setSelectedFinding(criticalFindings[0]);
        } else {
          addToast('No active critical finding plans to review', 'info');
        }
        break;
      case 'alerts':
        setShowDriftModal(true);
        break;
    }
  };

  // Smooth scroll to findings section
  const handleScrollToFindings = () => {
    const el = document.getElementById('critical-findings');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <AppShell title="Overview Test">
    <div className="min-h-screen bg-background text-foreground font-sans selection:bg-primary/30 selection:text-primary">
      <div className="px-4 sm:px-6 lg:px-8 animate-in fade-in duration-300">

        {/* Hero Snapshot */}
        <HeroSnapshot
          scoreCards={scoreCards}
          onViewFindings={handleScrollToFindings}
          selectedCategory={selectedCategory}
          setSelectedCategory={setSelectedCategory}
        />

        {/* Critical Findings Panel */}
        <CriticalFindings
          findings={criticalFindings}
          onSelectFinding={(f) => setSelectedFinding(f)}
          selectedCategory={selectedCategory}
        />

        {/* Score Drivers */}
        <ScoreDrivers
          categories={scoreDriverCategories}
          onOpenDriverDetail={(title) => {
            addToast(`Inspecting ${title} health drivers`, 'info');
            handleScrollToFindings();
          }}
        />

        {/* License & Cost Intelligence */}
        <LicenseIntelligence
          metrics={licenseMetrics}
          onOptimizeClick={() => setShowSOWModal(true)}
        />

        {/* Identity & Access */}
        <IdentityAccess
          metrics={identityMetrics}
          onViewIdentityDetails={() => {
            if (criticalFindings.length > 0) {
              setSelectedFinding(criticalFindings[0]);
            }
          }}
        />

        {/* Compliance Distribution */}
        <ComplianceDistribution
          compliance={complianceData}
          onFixDriftClick={() => {
            addToast('Pushed automated Intune compliance sync to 12 iOS devices', 'success');
          }}
        />

        {/* Automation & Orchestration */}
        <AutomationOrchestration
          tasks={automationTasks}
          onTriggerTaskAction={handleTaskAction}
        />

      </div>

      {/* Modals */}
      {selectedFinding && (
        <FindingDetailModal
          finding={selectedFinding}
          onClose={() => setSelectedFinding(null)}
          onRemediate={handleRemediateFinding}
        />
      )}

      {showSOWModal && (
        <SOWModal onClose={() => setShowSOWModal(false)} addToast={addToast} />
      )}

      {showReportModal && (
        <ReportModal onClose={() => setShowReportModal(false)} addToast={addToast} />
      )}

      {showDriftModal && (
        <DriftScheduleModal onClose={() => setShowDriftModal(false)} addToast={addToast} />
      )}

      {/* Toast Notifications */}
      <ToastContainer toasts={toasts} onRemove={removeToast} />

    </div>
    </AppShell>
  );
}
