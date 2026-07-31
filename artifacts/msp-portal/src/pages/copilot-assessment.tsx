/**
 * copilot-assessment.tsx
 *
 * Route: /copilot-assessment/:step
 *
 * Each step of the guided Copilot assessment flow (home, quiz, telemetry,
 * personas, use-cases, security, security2, governance, roi, report,
 * documents, sow) now has its own real, deep-linkable URL under this
 * dynamic route, instead of a single fixed /copilot-assessment URL with
 * an in-memory currentStep. wouter does not remount this component when
 * only the :step param changes (confirmed by the existing analogous
 * pattern in assessment-dashboard.tsx's :serviceSlug usage), so quiz
 * answers / telemetry progress / selected persona / governance / roi
 * state can safely stay in local useState across step navigation without
 * a separate Context provider.
 *
 * Navigating between steps now does a real setLocation() (URL change),
 * not a local setState -- Back/Forward, refresh, and sharing a link to a
 * specific step all work correctly as a result.
 */
import React, { useEffect, useState } from 'react';
import { useParams, useLocation } from 'wouter';
import { useAuth } from '@/lib/auth-context';
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
  USE_CASE_TILES,
  DOCUMENT_DELIVERABLES
} from '@/components/copilot-assessment/assessmentData';
import { fetchPersonaStories } from '@/components/copilot-assessment/personaGenerationClient';

import { TopToolbar } from '@/components/copilot-assessment/TopToolbar';

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

const VALID_STEPS = new Set<string>(STEP_ORDER);

type SharedState = Omit<AssessmentState, 'currentStep'>;

export default function CopilotAssessmentPage() {
  const { step: rawStep } = useParams<{ step?: string }>();
  const [, setLocation] = useLocation();
  const { fetchWithAuth, user } = useAuth();

  // Falls back to 'home' for a missing/invalid :step (e.g. a stale or
  // hand-typed link) rather than crashing on an unrecognized step.
  const currentStep: AssessmentStep = (rawStep && VALID_STEPS.has(rawStep) ? rawStep : 'home') as AssessmentStep;

  const [state, setState] = useState<SharedState>({
    currentQuestionIndex: 0,
    quizAnswers: {},
    quizProfile: null,
    isLeftPanelCollapsed: false,
    isRightPanelCollapsed: false,
    engines: INITIAL_ENGINES,
    isTelemetryRunning: false,
    telemetryProgress: 0,
    personas: [],
    personasStatus: 'idle',
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
  const [personasError, setPersonasError] = useState<string | null>(null);

  const [isSpecModalOpen, setIsSpecModalOpen] = useState(false);

  // Real persona generation (#186) — fires once per fresh quizProfile, the
  // first time the personas step is reached. Re-completing the quiz resets
  // personasStatus back to 'idle' (see handleCompleteQuiz), so a retake
  // regenerates rather than serving stale personas.
  useEffect(() => {
    if (currentStep !== 'personas' || !state.quizProfile || state.personasStatus !== 'idle') return;
    let cancelled = false;
    setState(prev => ({ ...prev, personasStatus: 'loading' }));
    setPersonasError(null);
    fetchPersonaStories(fetchWithAuth, state.quizProfile)
      .then(personas => {
        if (cancelled) return;
        setState(prev => ({ ...prev, personas, personasStatus: 'ready' }));
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setPersonasError(err.message);
        setState(prev => ({ ...prev, personasStatus: 'error' }));
      });
    return () => { cancelled = true; };
  }, [currentStep, state.quizProfile, state.personasStatus, fetchWithAuth]);

  const currentStepIndex = STEP_ORDER.indexOf(currentStep);
  const progressPercent = Math.round((currentStepIndex / (STEP_ORDER.length - 1)) * 100);

  // Real navigation -- changes the URL, so Back/Forward/refresh/sharing a
  // link all behave correctly. Every screen already only calls this same
  // onNavigate/onContinue callback contract, so none of them needed to
  // change.
  const handleNavigate = (step: AssessmentStep) => {
    setLocation(`/copilot-assessment/${step}`);
  };

  // Quiz Handler — receives the completed structured profile (#183/#184)
  const handleCompleteQuiz = (profile: QuizProfile) => {
    setState(prev => ({
      ...prev,
      quizProfile: profile,
      personas: [],
      personasStatus: 'idle',
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

  const handleUpdateGovernance = (updated: Partial<GovernanceState>) => {
    setState(prev => ({ ...prev, governance: { ...prev.governance, ...updated } }));
  };

  const handleUpdateRoi = (updated: Partial<RoiState>) => {
    setState(prev => ({ ...prev, roi: { ...prev.roi, ...updated } }));
  };

  const handleReset = () => {
    setPersonasError(null);
    setState({
      currentQuestionIndex: 0,
      quizAnswers: {},
      quizProfile: null,
      isLeftPanelCollapsed: false,
      isRightPanelCollapsed: false,
      engines: INITIAL_ENGINES,
      isTelemetryRunning: false,
      telemetryProgress: 0,
      personas: [],
      personasStatus: 'idle',
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
    handleNavigate('home');
  };

  const commonScreenProps = {
    onHelpClick: () => setIsSpecModalOpen(true),
    onExitClick: () => handleNavigate('home'),
    onNavigate: handleNavigate,
  };

  return (
    <div className="h-screen w-screen bg-background text-foreground flex flex-col font-sans overflow-hidden antialiased select-none">
      <TopToolbar
        currentStep={currentStep}
        progressPercent={progressPercent}
        onNavigate={handleNavigate}
        onOpenArchitectureSpec={() => setIsSpecModalOpen(true)}
        onReset={handleReset}
      />

      <div className="fixed inset-0 z-40 bg-background">
        {currentStep === 'home' && (
          <HomeScreen
            onStart={() => handleNavigate('quiz')}
            onOpenSpec={() => setIsSpecModalOpen(true)}
          />
        )}

        {currentStep === 'quiz' && (
          <QuizScreen
            initialProfile={state.quizProfile ?? undefined}
            userName={user?.name}
            onCompleteQuiz={handleCompleteQuiz}
            onHelpClick={() => setIsSpecModalOpen(true)}
            onExitClick={() => handleNavigate('home')}
          />
        )}

        {currentStep === 'telemetry' && (
          <TelemetryScreen
            quizAnswers={state.quizAnswers}
            onContinue={() => handleNavigate('personas')}
            onHelpClick={() => setIsSpecModalOpen(true)}
            onExitClick={() => handleNavigate('home')}
          />
        )}

        {currentStep === 'personas' && (
          <PersonasScreen
            quizProfile={state.quizProfile}
            personas={state.personas}
            personasStatus={state.personasStatus}
            personasError={personasError}
            onSelectPersona={(persona) => setState(prev => ({ ...prev, selectedPersona: persona }))}
            onContinue={() => handleNavigate('use-cases')}
            {...commonScreenProps}
          />
        )}

        {currentStep === 'use-cases' && (
          <UseCasesScreen
            quizAnswers={state.quizAnswers}
            useCases={USE_CASE_TILES}
            onContinue={() => handleNavigate('security')}
            {...commonScreenProps}
          />
        )}

        {currentStep === 'security' && (
          <SecurityScreen
            governance={state.governance}
            onUpdateGovernance={handleUpdateGovernance}
            onContinue={() => handleNavigate('security2')}
            {...commonScreenProps}
          />
        )}

        {currentStep === 'security2' && (
          <Security2Screen
            governance={state.governance}
            onUpdateGovernance={handleUpdateGovernance}
            onContinue={() => handleNavigate('governance')}
            {...commonScreenProps}
          />
        )}

        {currentStep === 'governance' && (
          <GovernanceScreen
            governance={state.governance}
            onUpdateGovernance={handleUpdateGovernance}
            onContinue={() => handleNavigate('roi')}
            {...commonScreenProps}
          />
        )}

        {currentStep === 'roi' && (
          <RoiScreen
            roi={state.roi}
            onUpdateRoi={handleUpdateRoi}
            onContinue={() => handleNavigate('report')}
            {...commonScreenProps}
          />
        )}

        {currentStep === 'report' && (
          <FinalReportScreen
            governance={state.governance}
            roi={state.roi}
            onContinue={() => handleNavigate('documents')}
            {...commonScreenProps}
          />
        )}

        {currentStep === 'documents' && (
          <DocumentsScreen
            documents={DOCUMENT_DELIVERABLES}
            onSelectDocument={(doc) => setState(prev => ({ ...prev, selectedDocument: doc }))}
            onOpenArchitectureSpec={() => setIsSpecModalOpen(true)}
            onContinue={() => handleNavigate('sow')}
            {...commonScreenProps}
          />
        )}

        {currentStep === 'sow' && (
          <SowScreen
            onContinue={() => handleNavigate('home')}
            {...commonScreenProps}
          />
        )}
      </div>

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
