import React, { useState } from 'react';
import { Header } from './components/Header';
import { HeroSnapshot } from './components/HeroSnapshot';
import { CriticalFindings } from './components/CriticalFindings';
import { ScoreDrivers } from './components/ScoreDrivers';
import { LicenseIntelligence } from './components/LicenseIntelligence';
import { IdentityAccess } from './components/IdentityAccess';
import { ComplianceDistribution } from './components/ComplianceDistribution';
import { AutomationOrchestration } from './components/AutomationOrchestration';
import { FindingDetailModal } from './components/FindingDetailModal';
import { SOWModal } from './components/SOWModal';
import { ReportModal } from './components/ReportModal';
import { DriftScheduleModal } from './components/DriftScheduleModal';
import { PortfolioView } from './components/PortfolioView';
import { AnalyticsView } from './components/AnalyticsView';
import { ComplianceView } from './components/ComplianceView';
import { Footer } from './components/Footer';
import { ToastContainer, ToastMessage } from './components/Toast';

import {
  initialTenantConfig,
  initialScoreCards,
  initialCriticalFindings,
  scoreDriverCategories,
  licenseMetrics,
  identityMetrics,
  complianceData,
  automationTasks,
} from './data/mockData';
import { CriticalFinding, AutomationTask, ScoreCardData } from './types';

export default function App() {
  const [tenantConfig, setTenantConfig] = useState(initialTenantConfig);
  const [scoreCards, setScoreCards] = useState<ScoreCardData[]>(initialScoreCards);
  const [criticalFindings, setCriticalFindings] = useState<CriticalFinding[]>(
    initialCriticalFindings
  );
  const [activeTab, setActiveTab] = useState('Overview');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const [selectedFinding, setSelectedFinding] = useState<CriticalFinding | null>(null);
  const [showSOWModal, setShowSOWModal] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [showDriftModal, setShowDriftModal] = useState(false);

  const [isScanning, setIsScanning] = useState(false);
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

  // Trigger Instant Live Tenant Scan
  const handleRefreshScan = () => {
    setIsScanning(true);
    addToast('Initiating real-time Graph API & Intune tenant scan...', 'info');

    setTimeout(() => {
      setIsScanning(false);
      setTenantConfig((prev) => ({ ...prev, lastScanMinutesAgo: 0 }));
      setScoreCards((prev) =>
        prev.map((card) => {
          if (card.category === 'health') return { ...card, score: 94, change: '+4.4%' };
          if (card.category === 'copilot') return { ...card, score: 68, change: '+16%' };
          return card;
        })
      );
      addToast('Tenant scan completed! Posture scores updated.', 'success');
    }, 2500);
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
    <div className="min-h-screen bg-[#101419] text-[#e0e2ea] font-sans selection:bg-[#479ef5]/30 selection:text-[#479ef5] flex flex-col justify-between">
      
      <div>
        {/* Top Header */}
        <Header
          tenantConfig={tenantConfig}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onRefreshScan={handleRefreshScan}
          isScanning={isScanning}
          addToast={addToast}
        />

        {/* Main Content Area */}
        <main className="px-4 sm:px-6 lg:px-8">
          
          {activeTab === 'Overview' && (
            <div className="animate-in fade-in duration-300">
              
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
          )}

          {activeTab === 'Portfolio' && (
            <PortfolioView
              onSelectTenant={(name) => {
                setTenantConfig((prev) => ({ ...prev, name }));
                setActiveTab('Overview');
                addToast(`Switched active context to ${name}`, 'info');
              }}
            />
          )}

          {activeTab === 'Analytics' && <AnalyticsView />}

          {activeTab === 'Compliance' && <ComplianceView />}

        </main>
      </div>

      {/* Footer */}
      <Footer />

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
  );
}
