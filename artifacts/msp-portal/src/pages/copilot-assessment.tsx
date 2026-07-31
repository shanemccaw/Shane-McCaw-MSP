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
 *
 * One piece of that state is NOT session-local any more (#237): the
 * completed quizProfile is persisted server-side on the customer's own
 * tenant row (tenants.copilot_assessment) and restored on mount, so a
 * customer who finished the 13-step quiz, left, and logged back in is
 * carried past it instead of made to redo it. Everything else here stays
 * exactly as described above -- in-memory, per session.
 */
import React, { useEffect, useState } from 'react';
import { useParams, useLocation } from 'wouter';
import { Loader2 } from 'lucide-react';
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
import { fetchFinalReportNarrative } from '@/components/copilot-assessment/finalReportClient';
import {
  fetchSavedQuizProfile,
  saveQuizProfile,
  shouldAwaitQuizRestore,
  shouldSkipQuizStep,
  type QuizProfileRestoreStatus
} from '@/components/copilot-assessment/quizProfileClient';

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

/** Single place this route's URLs are built, so a rename can't leave one caller stale. */
const stepPath = (step: AssessmentStep): string => `/copilot-assessment/${step}`;

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
    },
    finalReportNarrative: null,
    finalReportRoiScore: null,
    finalReportStatus: 'idle'
  });
  const [personasError, setPersonasError] = useState<string | null>(null);
  const [finalReportError, setFinalReportError] = useState<string | null>(null);

  const [isSpecModalOpen, setIsSpecModalOpen] = useState(false);

  // ⚠️ TEMPORARY DEBUG CODE — DELETE BEFORE PRODUCTION ⚠️
  // isTestbed gates QuizScreen's [DEBUG] auto-fill button (#231). Resolved
  // server-side from the real tenants.isTestbed flag (GET
  // /portal/assessment/testbed-status), never from a client-only heuristic.
  // Defaults false so the button is genuinely absent until a testbed account
  // is confirmed, not just hidden while this fetch is in flight.
  const [isTestbed, setIsTestbed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetchWithAuth("/api/portal/assessment/testbed-status", undefined, { silent: true })
      .then(async (res) => {
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { isTestbed: boolean };
        if (!cancelled) setIsTestbed(data.isTestbed === true);
      })
      .catch(() => {
        // best-effort — stays false (button stays hidden) on any failure
      });
    return () => { cancelled = true; };
  }, [fetchWithAuth]);

  // Completed-quiz restore (#237). The finished QuizProfile is now persisted
  // server-side on the customer's own tenant row, so consent -> pay -> login ->
  // complete quiz -> [gap] -> log back in no longer means redoing all 13 steps.
  // Runs once on mount (this page does not remount on :step changes — see the
  // file header), and never overwrites a profile completed in this session.
  const [restoreStatus, setRestoreStatus] = useState<QuizProfileRestoreStatus>('idle');
  useEffect(() => {
    let cancelled = false;
    fetchSavedQuizProfile(fetchWithAuth).then(profile => {
      if (cancelled) return;
      if (!profile) {
        setRestoreStatus('absent');
        return;
      }
      setState(prev => (prev.quizProfile ? prev : { ...prev, quizProfile: profile }));
      setRestoreStatus('restored');
    });
    return () => { cancelled = true; };
  }, [fetchWithAuth]);

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
    // state.personasStatus is intentionally excluded: this effect sets it
    // (idle -> loading) inside its own body, so including it here creates a
    // self-cancelling loop -- React tears down and re-runs the effect on
    // that status change, flipping `cancelled` to true before the in-flight
    // fetch's .then()/.catch() ever run. The `!== 'idle'` guard above still
    // prevents duplicate fetches; currentStep/quizProfile changing is what
    // legitimately re-triggers this effect for a fresh quiz/step visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep, state.quizProfile, fetchWithAuth]);

  // Real Final Report narrative generation (#191) — fires once per fresh
  // quizProfile/persona set, the first time the report step is reached.
  // Requires real personas to already be ready (#186); a quiz retake resets
  // finalReportStatus back to 'idle' (see handleCompleteQuiz) so the report
  // regenerates rather than serving a stale narrative for a different quiz.
  useEffect(() => {
    if (currentStep !== 'report' || !state.quizProfile || state.personasStatus !== 'ready' || state.personas.length === 0) return;
    if (state.finalReportStatus !== 'idle') return;
    let cancelled = false;
    setState(prev => ({ ...prev, finalReportStatus: 'loading' }));
    setFinalReportError(null);
    fetchFinalReportNarrative(fetchWithAuth, state.quizProfile, state.personas, state.governance)
      .then(result => {
        if (cancelled) return;
        setState(prev => ({
          ...prev,
          finalReportNarrative: result.narrativeHtml,
          finalReportRoiScore: result.roiScore,
          finalReportStatus: 'ready'
        }));
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setFinalReportError(err.message);
        setState(prev => ({ ...prev, finalReportStatus: 'error' }));
      });
    return () => { cancelled = true; };
    // state.finalReportStatus is intentionally excluded, same reason as the
    // persona effect above: this effect sets it (idle -> loading) inside its
    // own body, so including it here self-cancels the in-flight fetch before
    // it can resolve. The `!== 'idle'` guard above still prevents duplicate
    // fetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep, state.quizProfile, state.personas, state.personasStatus, state.governance, fetchWithAuth]);

  const currentStepIndex = STEP_ORDER.indexOf(currentStep);
  const progressPercent = Math.round((currentStepIndex / (STEP_ORDER.length - 1)) * 100);

  // Real navigation -- changes the URL, so Back/Forward/refresh/sharing a
  // link all behave correctly. Every screen already only calls this same
  // onNavigate/onContinue callback contract, so none of them needed to
  // change.
  const handleNavigate = (step: AssessmentStep) => {
    setLocation(stepPath(step));
  };

  // Carry a returning customer past the quiz step (#237). This is not new
  // routing: it makes the exact same forward move handleCompleteQuiz already
  // makes once quizProfile is populated, so everything downstream (personas,
  // report, …) keeps working off the same single source of truth. One-shot —
  // see shouldSkipQuizStep for why 'restored' -> 'applied' rather than a
  // standing redirect.
  useEffect(() => {
    if (!shouldSkipQuizStep({ currentStep, quizProfile: state.quizProfile, restoreStatus })) return;
    setRestoreStatus('applied');
    setLocation(stepPath('telemetry'));
  }, [currentStep, state.quizProfile, restoreStatus, setLocation]);

  // Quiz Handler — receives the completed structured profile (#183/#184)
  const handleCompleteQuiz = (profile: QuizProfile) => {
    setFinalReportError(null);
    // Persist server-side so this profile survives logout/login (#237). Fire
    // and forget on purpose: saveQuizProfile never throws, and the customer
    // moves on to telemetry either way — a failed save costs a redo next
    // session, it must not strand someone who just finished the quiz.
    void saveQuizProfile(fetchWithAuth, profile);
    // A profile completed here supersedes anything restored, and the skip above
    // must not then fire on top of it.
    setRestoreStatus('applied');
    setState(prev => ({
      ...prev,
      quizProfile: profile,
      personas: [],
      personasStatus: 'idle',
      finalReportNarrative: null,
      finalReportRoiScore: null,
      finalReportStatus: 'idle',
      currentStep: 'telemetry'
    }));
    handleNavigate('telemetry');
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
    setFinalReportError(null);
    // Explicit "start over" — the customer gets the quiz back rather than being
    // carried past it by the restored profile they just discarded (#237). The
    // saved profile stays on the tenant row until the retake overwrites it.
    setRestoreStatus('absent');
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
      },
      finalReportNarrative: null,
      finalReportRoiScore: null,
      finalReportStatus: 'idle'
    });
    handleNavigate('home');
  };

  // Hold the quiz step back both while the saved-profile lookup is outstanding
  // and during the frame between "profile restored" and the skip effect above
  // changing the URL — otherwise question 1 flashes up in either window.
  const awaitingQuizRestore =
    shouldAwaitQuizRestore({ currentStep, quizProfile: state.quizProfile, restoreStatus }) ||
    shouldSkipQuizStep({ currentStep, quizProfile: state.quizProfile, restoreStatus });

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

        {/* Held back until the saved-profile lookup answers (#237), so a
            returning customer never sees question 1 flash up before being
            carried past the quiz they already completed. */}
        {currentStep === 'quiz' && awaitingQuizRestore && (
          <div className="h-full w-full flex items-center justify-center">
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking for a saved assessment…
            </div>
          </div>
        )}

        {currentStep === 'quiz' && !awaitingQuizRestore && (
          <QuizScreen
            initialProfile={state.quizProfile ?? undefined}
            userName={user?.name}
            isTestbed={isTestbed}
            onCompleteQuiz={handleCompleteQuiz}
            onHelpClick={() => setIsSpecModalOpen(true)}
            onExitClick={() => handleNavigate('home')}
          />
        )}

        {currentStep === 'telemetry' && (
          <TelemetryScreen
            quizAnswers={state.quizAnswers}
            onContinue={() => handleNavigate('personas')}
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
            personas={state.personas}
            narrativeStatus={state.finalReportStatus}
            narrativeHtml={state.finalReportNarrative}
            narrativeError={finalReportError}
            roiScore={state.finalReportRoiScore}
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
