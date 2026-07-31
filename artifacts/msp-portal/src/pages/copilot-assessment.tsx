import React, { useState } from 'react';
import {
  AssessmentStep,
  AssessmentState,
  PersonaStory,
  DocumentDeliverable,
  GovernanceState,
  RoiState,
  EngineStatus,
  QuizProfile
} from '@/components/copilot-assessment/types';
import {
  INITIAL_ENGINES,
  PERSONA_STORIES,
  USE_CASE_TILES,
  DOCUMENT_DELIVERABLES
} from '@/components/copilot-assessment/assessmentData';

import { TopToolbar } from '@/components/copilot-assessment/TopToolbar';
import { LeftPanel } from '@/components/copilot-assessment/LeftPanel';
import { RightPanel } from '@/components/copilot-assessment/RightPanel';

import { HomeScreen } from '@/components/copilot-assessment/screens/HomeScreen';
import { QuizScreen } from '@/components/copilot-assessment/screens/QuizScreen';
import { TelemetryScreen } from '@/components/copilot-assessment/screens/TelemetryScreen';
import { PersonasScreen } from '@/components/copilot-assessment/screens/PersonasScreen';
import { UseCasesScreen } from '@/components/copilot-assessment/screens/UseCasesScreen';
import { SecurityScreen } from '@/components/copilot-assessment/screens/SecurityScreen';
import { Security2Screen } from '@/components/copilot-assessment/screens/Security2Screen';
import { GovernanceScreen } from '@/components/copilot-assessment/screens/GovernanceScreen';
import { RoiScreen } from '@/components/copilot-assessment/screens/RoiScreen';
import { FinalReportScreen } from '@/components/copilot-assessment/screens/FinalReportScreen';
import { DocumentsScreen } from '@/components/copilot-assessment/screens/DocumentsScreen';
import { SowScreen } from '@/components/copilot-assessment/screens/SowScreen';

import { PersonaModal } from '@/components/copilot-assessment/PersonaModal';
import { DocumentModal } from '@/components/copilot-assessment/DocumentModal';
import { ArchitectureDocModal } from '@/components/copilot-assessment/ArchitectureDocModal';

const STEP_ORDER: AssessmentStep[] = [
  'home',
  'quiz',
  'telemetry',
  'personas',
  'use-cases',
  'security',
  'security2',
  'governance',
  'roi',
  'report',
  'documents',
  'sow'
];

export default function App() {
  const [state, setState] = useState<AssessmentState>({
    currentStep: 'home',
    currentQuestionIndex: 0,
    quizAnswers: {},
    quizProfile: null,
    isLeftPanelCollapsed: false,
    isRightPanelCollapsed: false,
    engines: INITIAL_ENGINES,
    isTelemetryRunning: false,
    telemetryProgress: 0,
    selectedPersona: null,
    selectedDocument: null,
    governance: {
      ca01: true,
      pim: true,
      sensitivityLabels: false,
      dlp: 'moderate'
    },
    roi: {
      adoptionRate: 80,
      personaCoverage: 75,
      useCaseIntensity: 70
    }
  });

  const [isSpecModalOpen, setIsSpecModalOpen] = useState(false);

  // Calculate Overall Progress
  const currentStepIndex = STEP_ORDER.indexOf(state.currentStep);
  const progressPercent = Math.round((currentStepIndex / (STEP_ORDER.length - 1)) * 100);

  // Navigation handlers
  const handleNavigate = (step: AssessmentStep) => {
    setState(prev => ({ ...prev, currentStep: step }));
  };

  const handleNextStep = () => {
    const nextIndex = currentStepIndex + 1;
    if (nextIndex < STEP_ORDER.length) {
      setState(prev => ({ ...prev, currentStep: STEP_ORDER[nextIndex] }));
    }
  };

  // Quiz Handler — receives the completed structured profile (#183/#184)
  const handleCompleteQuiz = (profile: QuizProfile) => {
    setState(prev => ({
      ...prev,
      quizProfile: profile,
      currentStep: 'telemetry'
    }));
  };

  // Telemetry Engine Simulation Handler
  const handleRunTelemetry = () => {
    setState(prev => ({
      ...prev,
      isTelemetryRunning: true,
      telemetryProgress: 0,
      engines: prev.engines.map(e => ({ ...e, status: 'pending', progress: 0 }))
    }));

    // Simulate progressive running of 5 engines
    let stepCount = 0;
    const interval = setInterval(() => {
      stepCount++;
      setState(prev => {
        const updatedEngines: EngineStatus[] = prev.engines.map((e, idx) => {
          if (idx < Math.floor(stepCount / 2)) {
            return { ...e, status: 'complete', progress: 100 };
          } else if (idx === Math.floor(stepCount / 2)) {
            return { ...e, status: 'running', progress: (stepCount % 2) * 50 + 50 };
          }
          return e;
        });

        const completedCount = updatedEngines.filter(e => e.status === 'complete').length;
        const progress = Math.min(100, Math.round((completedCount / updatedEngines.length) * 100));

        if (progress >= 100) {
          clearInterval(interval);
          return {
            ...prev,
            isTelemetryRunning: false,
            telemetryProgress: 100,
            engines: updatedEngines.map(e => ({ ...e, status: 'complete', progress: 100 }))
          };
        }

        return {
          ...prev,
          telemetryProgress: progress,
          engines: updatedEngines
        };
      });
    }, 600);
  };

  // Governance Handler
  const handleUpdateGovernance = (updated: Partial<GovernanceState>) => {
    setState(prev => ({ ...prev, governance: { ...prev.governance, ...updated } }));
  };

  // ROI Handler
  const handleUpdateRoi = (updated: Partial<RoiState>) => {
    setState(prev => ({ ...prev, roi: { ...prev.roi, ...updated } }));
  };

  // Reset Assessment
  const handleReset = () => {
    setState({
      currentStep: 'home',
      currentQuestionIndex: 0,
      quizAnswers: {},
      quizProfile: null,
      isLeftPanelCollapsed: false,
      isRightPanelCollapsed: false,
      engines: INITIAL_ENGINES,
      isTelemetryRunning: false,
      telemetryProgress: 0,
      selectedPersona: null,
      selectedDocument: null,
      governance: {
        ca01: true,
        pim: true,
        sensitivityLabels: false,
        dlp: 'moderate'
      },
      roi: {
        adoptionRate: 80,
        personaCoverage: 75,
        useCaseIntensity: 70
      }
    });
  };

  return (
    <div className="h-screen w-screen bg-[#0A0A0A] text-[#E1E1E1] flex flex-col font-sans overflow-hidden antialiased select-none">
      {/* 1. Top Toolbar */}
      <TopToolbar
        currentStep={state.currentStep}
        progressPercent={progressPercent}
        onNavigate={handleNavigate}
        onOpenArchitectureSpec={() => setIsSpecModalOpen(true)}
        onReset={handleReset}
      />

      {state.currentStep === 'quiz' ? (
        <div className="fixed inset-0 z-40 bg-[#0A0A0A]">
          <QuizScreen
            initialProfile={state.quizProfile ?? undefined}
            onCompleteQuiz={handleCompleteQuiz}
            onHelpClick={() => setIsSpecModalOpen(true)}
            onExitClick={() => handleNavigate('home')}
          />
        </div>
      ) : state.currentStep === 'telemetry' ? (
        <div className="fixed inset-0 z-40 bg-[#0A0A0A]">
          <TelemetryScreen
            quizAnswers={state.quizAnswers}
            onContinue={() => handleNavigate('personas')}
            onHelpClick={() => setIsSpecModalOpen(true)}
            onExitClick={() => handleNavigate('home')}
          />
        </div>
      ) : state.currentStep === 'personas' ? (
        <div className="fixed inset-0 z-40 bg-[#0A0A0A]">
          <PersonasScreen
            quizAnswers={state.quizAnswers}
            personas={PERSONA_STORIES}
            onSelectPersona={(persona) => setState(prev => ({ ...prev, selectedPersona: persona }))}
            onContinue={() => handleNavigate('use-cases')}
            onHelpClick={() => setIsSpecModalOpen(true)}
            onExitClick={() => handleNavigate('home')}
            onNavigate={(step) => handleNavigate(step)}
          />
        </div>
      ) : state.currentStep === 'use-cases' ? (
        <div className="fixed inset-0 z-40 bg-[#0A0A0A]">
          <UseCasesScreen
            quizAnswers={state.quizAnswers}
            useCases={USE_CASE_TILES}
            onContinue={() => handleNavigate('security')}
            onHelpClick={() => setIsSpecModalOpen(true)}
            onExitClick={() => handleNavigate('home')}
            onNavigate={(step) => handleNavigate(step)}
          />
        </div>
      ) : state.currentStep === 'security' ? (
        <div className="fixed inset-0 z-40 bg-[#0A0A0A]">
          <SecurityScreen
            governance={state.governance}
            onUpdateGovernance={handleUpdateGovernance}
            onContinue={() => handleNavigate('security2')}
            onHelpClick={() => setIsSpecModalOpen(true)}
            onExitClick={() => handleNavigate('home')}
            onNavigate={(step) => handleNavigate(step)}
          />
        </div>
      ) : state.currentStep === 'security2' ? (
        <div className="fixed inset-0 z-40 bg-[#0A0A0A]">
          <Security2Screen
            governance={state.governance}
            onUpdateGovernance={handleUpdateGovernance}
            onContinue={() => handleNavigate('governance')}
            onHelpClick={() => setIsSpecModalOpen(true)}
            onExitClick={() => handleNavigate('home')}
            onNavigate={(step) => handleNavigate(step)}
          />
        </div>
      ) : state.currentStep === 'governance' ? (
        <div className="fixed inset-0 z-40 bg-[#0A0A0A]">
          <GovernanceScreen
            governance={state.governance}
            onUpdateGovernance={handleUpdateGovernance}
            onContinue={() => handleNavigate('roi')}
            onHelpClick={() => setIsSpecModalOpen(true)}
            onExitClick={() => handleNavigate('home')}
            onNavigate={(step) => handleNavigate(step)}
          />
        </div>
      ) : state.currentStep === 'roi' ? (
        <div className="fixed inset-0 z-40 bg-[#0A0A0A]">
          <RoiScreen
            roi={state.roi}
            onUpdateRoi={handleUpdateRoi}
            onContinue={() => handleNavigate('report')}
            onHelpClick={() => setIsSpecModalOpen(true)}
            onExitClick={() => handleNavigate('home')}
            onNavigate={(step) => handleNavigate(step)}
          />
        </div>
      ) : state.currentStep === 'report' ? (
        <div className="fixed inset-0 z-40 bg-[#0A0A0A]">
          <FinalReportScreen
            governance={state.governance}
            roi={state.roi}
            onContinue={() => handleNavigate('documents')}
            onHelpClick={() => setIsSpecModalOpen(true)}
            onExitClick={() => handleNavigate('home')}
            onNavigate={(step) => handleNavigate(step)}
          />
        </div>
      ) : state.currentStep === 'documents' ? (
        <div className="fixed inset-0 z-40 bg-[#0A0A0A]">
          <DocumentsScreen
            documents={DOCUMENT_DELIVERABLES}
            onSelectDocument={(doc) => setState(prev => ({ ...prev, selectedDocument: doc }))}
            onOpenArchitectureSpec={() => setIsSpecModalOpen(true)}
            onContinue={() => handleNavigate('sow')}
            onHelpClick={() => setIsSpecModalOpen(true)}
            onExitClick={() => handleNavigate('home')}
            onNavigate={(step) => handleNavigate(step)}
          />
        </div>
      ) : state.currentStep === 'sow' ? (
        <div className="fixed inset-0 z-40 bg-[#0A0A0A]">
          <SowScreen
            onContinue={() => handleNavigate('home')}
            onHelpClick={() => setIsSpecModalOpen(true)}
            onExitClick={() => handleNavigate('home')}
            onNavigate={(step) => handleNavigate(step)}
          />
        </div>
      ) : (
        /* Main Body (Left Panel + Center Stage + Right Context Panel) */
        <div className="flex-1 flex overflow-hidden relative">
        {/* 2. Left Panel (Collapsible Vertical Navigation) */}
        <LeftPanel
          currentStep={state.currentStep}
          isCollapsed={state.isLeftPanelCollapsed}
          onToggleCollapse={() => setState(prev => ({ ...prev, isLeftPanelCollapsed: !prev.isLeftPanelCollapsed }))}
          onNavigate={handleNavigate}
          quizProgress={Object.keys(state.quizAnswers).length}
        />

        {/* 3. Center Panel (Primary Content Stage) */}
        <main className="flex-1 overflow-y-auto bg-[#0F0F0F] relative scrollbar-thin">
          {state.currentStep === 'home' && (
            <HomeScreen
              onStart={() => handleNavigate('quiz')}
              onOpenSpec={() => setIsSpecModalOpen(true)}
            />
          )}

          {state.currentStep === 'telemetry' && (
            <TelemetryScreen
              engines={state.engines}
              isRunning={state.isTelemetryRunning}
              overallProgress={state.telemetryProgress}
              onRunTelemetry={handleRunTelemetry}
              onContinue={() => handleNavigate('personas')}
            />
          )}

          {state.currentStep === 'personas' && (
            <PersonasScreen
              personas={PERSONA_STORIES}
              onSelectPersona={(persona) => setState(prev => ({ ...prev, selectedPersona: persona }))}
              onContinue={() => handleNavigate('use-cases')}
            />
          )}

          {state.currentStep === 'use-cases' && (
            <UseCasesScreen
              useCases={USE_CASE_TILES}
              onContinue={() => handleNavigate('security')}
            />
          )}

          {state.currentStep === 'security' && (
            <SecurityScreen
              governance={state.governance}
              onUpdateGovernance={handleUpdateGovernance}
              onContinue={() => handleNavigate('security2')}
            />
          )}

          {state.currentStep === 'security2' && (
            <Security2Screen
              governance={state.governance}
              onUpdateGovernance={handleUpdateGovernance}
              onContinue={() => handleNavigate('governance')}
            />
          )}

          {state.currentStep === 'governance' && (
            <GovernanceScreen
              governance={state.governance}
              onUpdateGovernance={handleUpdateGovernance}
              onContinue={() => handleNavigate('roi')}
            />
          )}

          {state.currentStep === 'roi' && (
            <RoiScreen
              roi={state.roi}
              onUpdateRoi={handleUpdateRoi}
              onContinue={() => handleNavigate('report')}
            />
          )}

          {state.currentStep === 'report' && (
            <FinalReportScreen
              governance={state.governance}
              roi={state.roi}
              onContinue={() => handleNavigate('documents')}
            />
          )}

          {state.currentStep === 'documents' && (
            <DocumentsScreen
              documents={DOCUMENT_DELIVERABLES}
              onSelectDocument={(doc) => setState(prev => ({ ...prev, selectedDocument: doc }))}
              onOpenArchitectureSpec={() => setIsSpecModalOpen(true)}
              onContinue={() => handleNavigate('sow')}
            />
          )}

          {state.currentStep === 'sow' && (
            <SowScreen
              onContinue={() => handleNavigate('home')}
            />
          )}
        </main>

        {/* 4. Right Panel (Contextual Insights Panel) */}
        <RightPanel
          currentStep={state.currentStep}
          isCollapsed={state.isRightPanelCollapsed}
          onToggleCollapse={() => setState(prev => ({ ...prev, isRightPanelCollapsed: !prev.isRightPanelCollapsed }))}
          quizAnswers={state.quizAnswers}
          governance={state.governance}
          roi={state.roi}
        />
      </div>
      )}

      {/* Modals */}
      <PersonaModal
        persona={state.selectedPersona}
        onClose={() => setState(prev => ({ ...prev, selectedPersona: null }))}
      />

      <DocumentModal
        document={state.selectedDocument}
        onClose={() => setState(prev => ({ ...prev, selectedDocument: null }))}
      />

      <ArchitectureDocModal
        isOpen={isSpecModalOpen}
        onClose={() => setIsSpecModalOpen(false)}
      />
    </div>
  );
}
