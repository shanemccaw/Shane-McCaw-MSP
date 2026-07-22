import { useState, useEffect } from 'react';
import {
  initialMetrics,
  initialHeatmapEntities,
  initialLabelCoverage,
  initialDlpMetrics,
  initialRadarData,
  initialEnablementControls,
  initialBlockers,
  initialAutomationTasks
} from './data/initialData';
import {
  ExecutiveMetrics,
  HeatmapEntity,
  ReadinessBlocker,
  AutomationTask
} from './types';

import { HeaderHero } from './components/HeaderHero';
import { PermissionsHeatmap } from './components/PermissionsHeatmap';
import { LabelAndDlpSection } from './components/LabelAndDlpSection';
import { SafetyRadarChart } from './components/SafetyRadarChart';
import { EnablementControls } from './components/EnablementControls';
import { ReadinessBlockers } from './components/ReadinessBlockers';
import { AutomationPotential } from './components/AutomationPotential';
import { FooterBar } from './components/FooterBar';
import { EntityDetailModal } from './components/EntityDetailModal';
import { ExportReportModal } from './components/ExportReportModal';

export default function App() {
  const [metrics, setMetrics] = useState<ExecutiveMetrics>(initialMetrics);
  const [entities, setEntities] = useState<HeatmapEntity[]>(
    initialHeatmapEntities
  );
  const [labelCoverage, setLabelCoverage] = useState(initialLabelCoverage);
  const [dlpMetrics] = useState(initialDlpMetrics);
  const [radarData, setRadarData] = useState(initialRadarData);
  const [enablementControls, setEnablementControls] = useState(
    initialEnablementControls
  );
  const [blockers, setBlockers] = useState<ReadinessBlocker[]>(initialBlockers);
  const [automationTasks, setAutomationTasks] = useState<AutomationTask[]>(
    initialAutomationTasks
  );

  // Modals & Drawers
  const [selectedEntity, setSelectedEntity] = useState<HeatmapEntity | null>(
    null
  );
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Mouse Follower Atmospheric Glow Position
  const [mousePos, setMousePos] = useState({ x: -200, y: -200 });

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY });
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  // Live Data Feed simulated subtle updates
  useEffect(() => {
    if (!metrics.liveDataFeedActive) return;

    const interval = setInterval(() => {
      const now = new Date();
      const timeStr = `${now.toISOString().replace('T', ' ').substring(0, 19)} UTC`;
      setMetrics((prev) => ({
        ...prev,
        lastUpdated: timeStr
      }));
    }, 15000);

    return () => clearInterval(interval);
  }, [metrics.liveDataFeedActive]);

  // Recalculate Aggregate Readiness score based on current state
  const recalculateReadiness = (scoreBoost: number) => {
    setMetrics((prev) => {
      const newScore = Math.min(99, prev.aggregateReadiness + scoreBoost);
      const newHygiene = Math.min(100, prev.permissionsHygiene + Math.round(scoreBoost * 0.8));
      const newRisk = Math.max(2, prev.copilotRiskScore - Math.round(scoreBoost * 0.5));
      let status = 'Ready for Scale';
      if (newScore >= 90) status = 'Optimal Security Alignment';
      else if (newScore < 75) status = 'Action Required';

      return {
        ...prev,
        aggregateReadiness: newScore,
        permissionsHygiene: newHygiene,
        copilotRiskScore: newRisk,
        readinessStatus: status
      };
    });
  };

  // Remediate Blocker
  const handleRemediateBlocker = (blockerId: string) => {
    const blocker = blockers.find((b) => b.id === blockerId);
    if (!blocker || blocker.remediated) return;

    setBlockers((prev) =>
      prev.map((b) => (b.id === blockerId ? { ...b, remediated: true } : b))
    );

    recalculateReadiness(3);
    showToast(`Resolved "${blocker.title}". Aggregate Readiness score updated (+3)!`);
  };

  // Remediate Entity (Revoke anonymous links)
  const handleRemediateEntity = (entityId: string) => {
    setEntities((prev) =>
      prev.map((e) =>
        e.id === entityId ? { ...e, anonymousLinks: 0, riskLevel: 'low' } : e
      )
    );

    recalculateReadiness(2);
    showToast(`Revoked anonymous links on target entity. Permissions hygiene improved!`);
  };

  // Execute Automation Task
  const handleExecuteAutomation = (taskId: string) => {
    setAutomationTasks((prev) =>
      prev.map((t) =>
        t.id === taskId ? { ...t, status: 'running', progress: 10 } : t
      )
    );

    let currentProgress = 10;
    const interval = setInterval(() => {
      currentProgress += 25;
      if (currentProgress >= 100) {
        clearInterval(interval);
        setAutomationTasks((prev) =>
          prev.map((t) =>
            t.id === taskId ? { ...t, status: 'completed', progress: 100 } : t
          )
        );

        if (taskId === 'auto-1') {
          // Auto-tighten permissions
          setEntities((prev) =>
            prev.map((e) => ({
              ...e,
              anonymousLinks: Math.max(0, e.anonymousLinks - 10),
              broadInternal: Math.max(2, Math.round(e.broadInternal * 0.5))
            }))
          );
          recalculateReadiness(5);
          showToast('Automation Deployed: Inactive sharing links purged across enterprise sites.');
        } else if (taskId === 'auto-2') {
          // Auto-label sensitive data
          setLabelCoverage({
            labeledPercent: 92,
            labeledCount: '1.48M files',
            unlabeledPercent: 6,
            unlabeledCount: '96K files',
            mislabeledPercent: 2,
            mislabeledCount: '32K files'
          });
          setEnablementControls((prev) =>
            prev.map((c) =>
              c.id === 'ctrl-3'
                ? { ...c, statusText: '92%', statusType: 'percent' }
                : c
            )
          );
          setRadarData((prev) =>
            prev.map((r) =>
              r.axis === 'Label Coverage' ? { ...r, score: 92 } : r
            )
          );
          recalculateReadiness(4);
          showToast('Automation Complete: AI auto-classified 20% of unlabeled sensitive files.');
        } else if (taskId === 'auto-3') {
          // Enforce CA baseline
          setEnablementControls((prev) =>
            prev.map((c) =>
              c.id === 'ctrl-5'
                ? { ...c, statusText: 'CLEARED', statusType: 'ready' }
                : c
            )
          );
          recalculateReadiness(6);
          showToast('Tenant Hardened: Legacy guest access purged and strict MFA enforced.');
        }
      } else {
        setAutomationTasks((prev) =>
          prev.map((t) =>
            t.id === taskId ? { ...t, progress: currentProgress } : t
          )
        );
      }
    }, 400);
  };

  const handleToggleLiveFeed = () => {
    setMetrics((prev) => ({
      ...prev,
      liveDataFeedActive: !prev.liveDataFeedActive
    }));
    showToast(
      metrics.liveDataFeedActive
        ? 'Live Data Feed Paused.'
        : 'Live Data Feed Activated. Real-time telemetry streaming.'
    );
  };

  return (
    <div className="min-h-screen bg-[#1a1a1a] text-[#f0f0f0] relative selection:bg-[#479ef5]/30 selection:text-sky-200">
      {/* Technical Grid Overlay */}
      <div className="fixed inset-0 technical-grid pointer-events-none z-0" />

      {/* Atmospheric Mouse Glow */}
      <div
        className="fixed w-[400px] h-[400px] pointer-events-none rounded-full blur-[120px] opacity-15 bg-[#479ef5] z-0 transition-transform duration-100 ease-out"
        style={{
          transform: `translate3d(${mousePos.x - 200}px, ${mousePos.y - 200}px, 0)`
        }}
      />

      {/* Toast Notification Floating Banner */}
      {toastMessage && (
        <div className="fixed top-6 right-6 z-50 glass-card border border-[#479ef5]/40 text-white px-5 py-3 rounded-xl shadow-2xl flex items-center gap-3 animate-fadeIn">
          <span className="material-symbols-outlined text-[#479ef5] text-xl">
            verified
          </span>
          <span className="font-mono text-xs font-medium">{toastMessage}</span>
        </div>
      )}

      {/* Main Container */}
      <main className="relative z-10 max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* SECTION 1: HERO BAND */}
        <HeaderHero metrics={metrics} />

        {/* SECTION 2: HEAT MAP TABLE */}
        <PermissionsHeatmap
          entities={entities}
          onSelectEntity={(entity) => setSelectedEntity(entity)}
        />

        {/* SECTION 3: LABEL COVERAGE & DLP */}
        <LabelAndDlpSection
          labelCoverage={labelCoverage}
          dlpMetrics={dlpMetrics}
        />

        {/* SECTION 4: RISK SPIDER CHART */}
        <SafetyRadarChart data={radarData} />

        {/* SECTION 5: ENABLEMENT CONTROLS */}
        <EnablementControls controls={enablementControls} />

        {/* SECTION 6: READINESS BLOCKERS */}
        <ReadinessBlockers
          blockers={blockers}
          onRemediateBlocker={handleRemediateBlocker}
        />

        {/* SECTION 7: AUTOMATION POTENTIAL */}
        <AutomationPotential
          tasks={automationTasks}
          onExecuteAutomation={handleExecuteAutomation}
        />

        {/* FOOTER */}
        <FooterBar
          metrics={metrics}
          onToggleLiveFeed={handleToggleLiveFeed}
          onOpenExportReport={() => setIsExportOpen(true)}
        />
      </main>

      {/* Modals */}
      <EntityDetailModal
        entity={selectedEntity}
        onClose={() => setSelectedEntity(null)}
        onRemediateEntity={handleRemediateEntity}
      />

      <ExportReportModal
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
        metrics={metrics}
        entities={entities}
        blockers={blockers}
      />
    </div>
  );
}
