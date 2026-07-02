import { useEffect, useRef, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useQuickWinMode } from "@/context/QuickWinModeContext";
import { QW_COPY, DEFAULT_QUICK_WIN_STEPS } from "@/lib/quickWinCopy";
import AnimatedBackground from "./AnimatedBackground";
import PhaseStepperBar from "./PhaseStepperBar";
import HealthPanel from "./HealthPanel";
import CompletedColumn from "./CompletedColumn";
import QueueColumn from "./QueueColumn";
import ProcessingHeroCard from "./ProcessingHeroCard";
import ActionRequiredCard from "./ActionRequiredCard";
import QuickWinFooter from "./QuickWinFooter";
import ProjectTasksLayer from "./ProjectTasksLayer";
import ScoreRing from "@/components/ScoreRing";
import type { DownloadState } from "./ActionRequiredCard";
import type { QuickWinStep } from "@/context/QuickWinModeContext";

// ── Types ──────────────────────────────────────────────────────────────────────

interface Scorecard {
  hasProfile: boolean;
  scores: Record<string, number>;
  telemetry: Record<string, string[]>;
  subsystemsChecked: string[];
}

type SubState = "queued" | "starting" | "running" | "done";

// ── Component ─────────────────────────────────────────────────────────────────

export default function FullScreenWrapper() {
  const { state, dispatch, runAutoStep, escalateToProject } = useQuickWinMode();
  const { mode, quickWin, currentStepIndex, score } = state;
  const { user, fetchWithAuth } = useAuth();
  const [, navigate] = useLocation();

  const isVisible = mode !== "Idle";
  const [mounted, setMounted] = useState(false);
  const [backdropOpacity, setBackdropOpacity] = useState(0);

  // ── Step logic state ──────────────────────────────────────────────────────
  const [progress, setProgress] = useState(0);
  const [subState, setSubState] = useState<SubState>("queued");
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);
  const [cardExiting, setCardExiting] = useState(false);
  const [downloadState, setDownloadState] = useState<DownloadState>("idle");
  const runnerActive = useRef(false);
  const escalationInFlight = useRef(false);

  // ── Scorecard state ───────────────────────────────────────────────────────
  const [categoryScores, setCategoryScores] = useState<Record<string, number>>({});
  const scorecardRef = useRef<Scorecard | null>(null);

  const addTelemetry = useCallback((_line: string) => {
    // Telemetry is no longer shown in the full-screen view — no-op kept
    // for API compatibility with runAutoStep
  }, []);

  const fetchScorecard = useCallback(async () => {
    if (scorecardRef.current) return;
    try {
      const res = await fetchWithAuth("/api/portal/quick-win/scorecard");
      if (res.ok) {
        const sc = (await res.json()) as Scorecard;
        scorecardRef.current = sc;
        if (sc.scores) setCategoryScores(sc.scores);
      }
    } catch { /* non-fatal */ }
  }, [fetchWithAuth]);

  // Reset step state whenever a new quick win starts
  useEffect(() => {
    if (mode === "EnteringQuickWin") {
      setProgress(0);
      setSubState("queued");
      setCompletedSteps([]);
      setCardExiting(false);
      setDownloadState("idle");
      scorecardRef.current = null;
      setCategoryScores({});
    }
  }, [mode]);

  // Reset downloadState when a manual step begins (WaitingForUser)
  useEffect(() => {
    if (mode === "WaitingForUser") setDownloadState("idle");
  }, [mode, currentStepIndex]);

  // ── Mount / unmount fade ──────────────────────────────────────────────────

  useEffect(() => {
    if (isVisible && !mounted) {
      setMounted(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setBackdropOpacity(1));
      });
      return;
    }
    if (!isVisible && mounted) {
      setBackdropOpacity(0);
      const t = setTimeout(() => setMounted(false), 240);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [isVisible, mounted]);

  // ── EnteringQuickWin: brief entry → Ready ─────────────────────────────────

  useEffect(() => {
    if (mode !== "EnteringQuickWin") return undefined;
    const t = setTimeout(() => dispatch({ type: "ENTRY_COMPLETE" }), 400);
    return () => clearTimeout(t);
  }, [mode, dispatch]);

  // ── Ready: dispatch auto or manual step ───────────────────────────────────

  useEffect(() => {
    if (mode !== "Ready") return;
    setProgress(0);
    setSubState("queued");
    const steps: QuickWinStep[] = quickWin?.steps ?? DEFAULT_QUICK_WIN_STEPS;
    const currentStep = steps[currentStepIndex];
    if (!currentStep) return;
    if (currentStep.type === "auto") {
      dispatch({ type: "START_AUTO_STEP" });
    } else {
      dispatch({ type: "WAIT_FOR_USER" });
    }
  }, [mode, quickWin, currentStepIndex, dispatch]);

  // ── RunningAutoStep: sub-state animation + actual async runner ────────────

  useEffect(() => {
    if (mode !== "RunningAutoStep" || runnerActive.current) return;
    runnerActive.current = true;

    void fetchScorecard();

    // Animate sub-states with slight delays to match telemetry pacing
    const t1 = setTimeout(() => setSubState("starting"), 350);
    const t2 = setTimeout(() => setSubState("running"), 700);

    runAutoStep(
      quickWin!,
      currentStepIndex,
      (pct) => setProgress(pct),
      (s) => dispatch({ type: "SET_SCORE", payload: s }),
      addTelemetry,
    ).then(() => {
      setSubState("done");
      dispatch({ type: "AUTO_STEP_COMPLETE" });
      runnerActive.current = false;
    }).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : "An unexpected error occurred.";
      dispatch({ type: "AUTO_STEP_ERROR", payload: message });
      runnerActive.current = false;
    });

    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [mode, quickWin, currentStepIndex, runAutoStep, dispatch, addTelemetry, fetchScorecard]);

  // ── StepComplete: card exit animation → prepend completed chip → next step ─

  useEffect(() => {
    if (mode !== "StepComplete") return undefined;

    const steps: QuickWinStep[] = quickWin?.steps ?? DEFAULT_QUICK_WIN_STEPS;
    const completedStep = steps[currentStepIndex];

    // Animate card exit
    setCardExiting(true);

    const t = setTimeout(() => {
      // Prepend completed chip
      if (completedStep) {
        setCompletedSteps((prev) => [completedStep.title, ...prev]);
      }
      setCardExiting(false);
      setSubState("queued");

      const nextIndex = currentStepIndex + 1;
      if (nextIndex >= steps.length) {
        dispatch({ type: "ALL_STEPS_DONE" });
      } else {
        dispatch({ type: "INCREMENT_STEP" });
        setTimeout(() => dispatch({ type: "NEXT_STEP" }), 24);
      }
    }, 500);

    return () => clearTimeout(t);
  }, [mode, quickWin, currentStepIndex, dispatch]);

  // ── EscalatingToProject ───────────────────────────────────────────────────

  useEffect(() => {
    if (mode !== "EscalatingToProject") return undefined;
    if (!quickWin || escalationInFlight.current) return undefined;

    escalationInFlight.current = true;
    escalateToProject(quickWin)
      .then((newProjectId) => {
        if (newProjectId) {
          dispatch({ type: "SET_PROJECT", payload: { projectId: newProjectId } });
        } else {
          dispatch({ type: "ESCALATION_COMPLETE" });
          navigate("/portal/projects");
        }
      })
      .catch(() => {
        dispatch({ type: "ESCALATION_COMPLETE" });
        navigate("/portal/projects");
      })
      .finally(() => { escalationInFlight.current = false; });

    return undefined;
  }, [mode, quickWin, escalateToProject, dispatch, navigate]);

  // ── ExitQuickWin: fade out then reset ────────────────────────────────────

  useEffect(() => {
    if (mode !== "ExitQuickWin") return undefined;
    setBackdropOpacity(0);
    const t = setTimeout(() => {
      dispatch({ type: "ESCALATION_COMPLETE" });
      if (state.openProjectOnExit && state.projectId) {
        navigate(`/portal/projects/${state.projectId}`);
      }
    }, 240);
    return () => clearTimeout(t);
  }, [mode, dispatch, navigate, state.openProjectOnExit, state.projectId]);

  if (!mounted) return null;

  // ── Derived data ──────────────────────────────────────────────────────────

  const steps: QuickWinStep[] = quickWin?.steps ?? DEFAULT_QUICK_WIN_STEPS;
  const totalSteps = steps.length;
  const currentStep = steps[currentStepIndex] ?? steps[0];
  const stepTitles = steps.map((s) => s.title);
  const progressPct = totalSteps > 0 ? Math.round((completedSteps.length / totalSteps) * 100) : 0;
  const pendingSteps = steps.slice(currentStepIndex + 1).map((s) => s.title);
  const clientName = user?.name ?? user?.email ?? "Client";

  // Compute overall score from the consolidated scorecard (average of all 5 category scores).
  // Falls back to state.score (per-step score from the state machine) when no scorecard yet.
  const overallScore = (() => {
    const vals = Object.values(categoryScores);
    if (vals.length > 0) return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    return score;
  })();

  // Derive category from the Quick Win item (not the step — QuickWinStep has no category field)
  const currentCategory = quickWin?.category ?? "";

  const isProjectView = mode === "ProjectTasksView";

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-[10000] flex flex-col"
      style={{
        opacity: backdropOpacity,
        transition: "opacity 240ms cubic-bezier(0.42,0,0.58,1)",
        backgroundColor: "rgba(248,249,251,0.95)",
      }}
    >
      {/* 3D Torus Knot Background Aura */}
      <AnimatedBackground />

      {/* Close button */}
      <button
        onClick={() => dispatch({ type: "EXIT" })}
        className="fixed top-10 right-10 z-[10001] w-10 h-10 flex items-center justify-center rounded-full bg-white/80 border border-black/5 text-black/50 hover:bg-white hover:text-black/80 shadow-sm"
        style={{ backdropFilter: "blur(8px)", transition: "all 200ms" }}
        aria-label="Close"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {/* ── Project Tasks View ── */}
      {isProjectView && (
        <div className="flex-1 relative z-10 flex items-center justify-center p-6">
          <div className="bg-white rounded-2xl shadow-2xl ring-1 ring-black/5 max-w-2xl w-full overflow-hidden">
            <div className="bg-[#0A2540] px-6 py-4 flex items-center justify-between">
              <div>
                <p className="text-[9px] font-bold tracking-[0.25em] uppercase text-white/40">Project Created</p>
                <h2 className="text-sm font-black text-white leading-tight">{quickWin?.title ?? "Your Project"}</h2>
              </div>
              <span className="text-[10px] font-bold text-green-400 flex items-center gap-1">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Ready
              </span>
            </div>
            <div className="px-6 py-5">
              <ProjectTasksLayer />
            </div>
          </div>
        </div>
      )}

      {/* ── Main Full-Screen Layout ── */}
      {!isProjectView && (
        <main className="flex-1 relative z-10 flex flex-col items-center justify-start px-6 sm:px-12 pt-4 pb-4 overflow-y-auto">

          {/* ── EnteringQuickWin: loading pulse ── */}
          {mode === "EnteringQuickWin" && (
            <div className="flex-1 flex flex-col items-center justify-center gap-4">
              <div className="w-12 h-12 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
              <p className="text-sm font-bold text-[#0A2540]">{QW_COPY.entering}</p>
            </div>
          )}

          {/* ── QuickWinComplete: summary ── */}
          {mode === "QuickWinComplete" && (
            <div className="flex-1 flex flex-col items-center justify-center gap-6 max-w-md mx-auto text-center">
              <ScoreRing score={score} size={140} />
              <div>
                <h2 className="text-2xl font-black text-[#0A2540]">{QW_COPY.complete.heading}</h2>
                <p className="text-sm text-black/50 mt-1">{QW_COPY.complete.subtext}</p>
              </div>
              <div className="flex flex-col sm:flex-row gap-3 w-full">
                <button
                  onClick={() => dispatch({ type: "ESCALATE_TO_PROJECT" })}
                  className="flex-1 px-5 py-3 rounded-xl bg-[#0078D4] text-white font-bold text-sm hover:bg-[#0078D4]/90 active:scale-[0.98] shadow-lg shadow-[#0078D4]/20"
                  style={{ transition: "all 240ms cubic-bezier(0.42,0,0.58,1)" }}
                >
                  {QW_COPY.complete.escalateBtn}
                </button>
                <button
                  onClick={() => dispatch({ type: "EXIT" })}
                  className="flex-1 px-5 py-3 rounded-xl border border-black/10 text-[#0A2540] font-bold text-sm hover:bg-black/5 active:scale-[0.98]"
                  style={{ transition: "all 240ms cubic-bezier(0.42,0,0.58,1)" }}
                >
                  {QW_COPY.complete.exitBtn}
                </button>
              </div>
            </div>
          )}

          {/* ── EscalatingToProject ── */}
          {mode === "EscalatingToProject" && (
            <div className="flex-1 flex flex-col items-center justify-center gap-4">
              <div className="w-10 h-10 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
              <p className="text-sm font-bold text-[#0A2540]">Creating your project…</p>
            </div>
          )}

          {/* ── Error ── */}
          {mode === "Error" && (
            <div className="flex-1 flex flex-col items-center justify-center gap-6 max-w-md mx-auto text-center">
              <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center">
                <svg className="w-8 h-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
              </div>
              <div>
                <p className="text-lg font-black text-[#0A2540]">Step failed</p>
                <p className="text-sm text-black/50 mt-1 max-w-xs mx-auto break-words">
                  {state.errorMessage ?? "An unexpected error occurred during the automated step."}
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => dispatch({ type: "RETRY_STEP" })}
                  className="px-5 py-3 rounded-xl bg-[#0078D4] text-white font-bold text-sm hover:bg-[#0078D4]/90"
                  style={{ transition: "all 240ms cubic-bezier(0.42,0,0.58,1)" }}
                >
                  Retry step
                </button>
                <button
                  onClick={() => dispatch({ type: "EXIT" })}
                  className="px-5 py-3 rounded-xl border border-black/10 text-[#0A2540] font-bold text-sm hover:bg-black/5"
                  style={{ transition: "all 240ms cubic-bezier(0.42,0,0.58,1)" }}
                >
                  Exit
                </button>
              </div>
            </div>
          )}

          {/* ── Main diagnostic layout (Running / WaitingForUser / StepComplete / Ready) ── */}
          {(mode === "RunningAutoStep" ||
            mode === "WaitingForUser" ||
            mode === "StepComplete" ||
            mode === "Ready") && (
            <>
              {/* Header */}
              <div className="w-full max-w-4xl text-center space-y-6 mb-6">
                <div className="flex flex-col items-center gap-6 mb-2 relative">
                  {/* Badge */}
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#0078D4]/10 border border-[#0078D4]/20 text-[#0078D4] text-[11px] font-bold backdrop-blur-md">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#0078D4] animate-pulse" />
                    ACTIVE DIAGNOSTIC SESSION
                  </div>

                  <h1 className="text-[28px] font-bold text-[#191c1e] tracking-tight leading-tight">
                    Microsoft 365 &amp; Copilot Health &amp; Diagnostics
                  </h1>

                  {/* Phase stepper */}
                  <PhaseStepperBar
                    steps={stepTitles}
                    activeIndex={currentStepIndex}
                    completedCount={completedSteps.length}
                  />

                  {/* Velocity progress bar */}
                  <div className="w-full space-y-3">
                    <div className="flex justify-between items-end">
                      <span className="text-[11px] font-bold text-[#0078D4] uppercase tracking-widest">
                        Diagnostic Pipeline Velocity
                      </span>
                      <span className="text-xl font-semibold text-[#0078D4]">{progress}%</span>
                    </div>
                    <div className="h-3 w-full bg-[#0078D4]/10 rounded-full overflow-hidden relative border border-[#0078D4]/5">
                      <div
                        className="absolute inset-y-0 left-0 bg-[#0078D4] shadow-[0_0_12px_rgba(0,95,170,0.4)] rounded-full"
                        style={{
                          width: `${progress}%`,
                          transition: "width 800ms cubic-bezier(0.42,0,0.58,1)",
                        }}
                      >
                        <div className="absolute inset-0 bg-white/20 animate-[shimmer_2s_infinite]" />
                      </div>
                    </div>
                    <p className="text-[14px] text-black/50 mt-1">
                      Scanning M365 endpoints. Currently analyzing{" "}
                      <span className="text-[#0078D4] font-semibold">{currentStep?.title ?? "subsystems"}</span>.
                    </p>
                  </div>
                </div>
              </div>

              {/* Consolidated Health Panel */}
              <HealthPanel
                overallScore={overallScore}
                categoryScores={categoryScores}
              />

              {/* Kanban 12-col grid */}
              <div className="w-full max-w-7xl grid grid-cols-12 gap-8 relative flex-1 mb-4">

                {/* Left: Completed */}
                <CompletedColumn completedSteps={completedSteps} />

                {/* Centre (col-span-7): Active cards */}
                <div className="col-span-12 lg:col-span-7 relative flex justify-center items-start gap-6">
                  {mode === "RunningAutoStep" && (
                    <ProcessingHeroCard
                      title={currentStep?.title ?? "Running Diagnostic"}
                      description={currentStep?.description}
                      category={currentCategory}
                      subState={subState}
                      isExiting={cardExiting}
                    />
                  )}
                  {mode === "WaitingForUser" && (
                    <ActionRequiredCard
                      stepTitle={currentStep?.title ?? "Manual Step"}
                      procedureNumber={currentStepIndex + 1}
                      isExiting={cardExiting}
                      downloadState={downloadState}
                      onDownloadClick={() => setDownloadState("waiting")}
                    />
                  )}
                  {mode === "StepComplete" && (
                    <ProcessingHeroCard
                      title={currentStep?.title ?? "Step Complete"}
                      description={currentStep?.description}
                      category={currentCategory}
                      subState="done"
                      isExiting={cardExiting}
                    />
                  )}
                  {mode === "Ready" && (
                    <div className="flex items-center gap-3 py-8">
                      <div className="w-6 h-6 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin flex-shrink-0" />
                      <p className="text-sm text-black/50">Preparing next step…</p>
                    </div>
                  )}
                </div>

                {/* Right: Queue */}
                <QueueColumn pendingSteps={pendingSteps} />
              </div>
            </>
          )}
        </main>
      )}

      {/* Pinned footer */}
      {!isProjectView && mode !== "EnteringQuickWin" && (
        <QuickWinFooter
          progressPct={progressPct}
          completedCount={completedSteps.length}
          clientName={clientName}
          clientAvatarUrl={undefined}
        />
      )}
    </div>
  );
}
