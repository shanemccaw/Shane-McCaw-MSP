import { useEffect, useState, useRef, useCallback } from "react";
import { useQuickWinMode } from "@/context/QuickWinModeContext";
import { QW_COPY, DEFAULT_QUICK_WIN_STEPS } from "@/lib/quickWinCopy";
import ScoreRing from "@/components/ScoreRing";
import ProgressLayer from "./ProgressLayer";
import ManualActionLayer from "./ManualActionLayer";
import TelemetryFeed from "./TelemetryFeed";
import type { QuickWinStep } from "@/context/QuickWinModeContext";

function BoltIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

export default function QuickWinCard() {
  const { state, dispatch, runAutoStep } = useQuickWinMode();
  const { mode, quickWin, currentStepIndex, score } = state;

  const steps: QuickWinStep[] = quickWin?.steps ?? DEFAULT_QUICK_WIN_STEPS;
  const totalSteps = steps.length;
  const currentStep = steps[currentStepIndex] ?? steps[0];

  const [progress, setProgress] = useState(0);
  const [telemetryLines, setTelemetryLines] = useState<string[]>([]);
  const [cardScale, setCardScale] = useState(0.96);
  const [cardOpacity, setCardOpacity] = useState(1);
  const runnerActive = useRef(false);

  const addTelemetry = useCallback((line: string) => {
    setTelemetryLines(prev => [line, ...prev]);
  }, []);

  // EnteringQuickWin: scale 0.96 → 1.0 over 240ms
  useEffect(() => {
    if (mode === "EnteringQuickWin") {
      requestAnimationFrame(() => setCardScale(1.0));
      const t = setTimeout(() => dispatch({ type: "ENTRY_COMPLETE" }), 240);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [mode, dispatch]);

  // Ready → dispatch auto or manual
  useEffect(() => {
    if (mode !== "Ready") return;
    setProgress(0);
    setTelemetryLines([]);
    if (!currentStep) return;
    if (currentStep.type === "auto") {
      dispatch({ type: "START_AUTO_STEP" });
    } else {
      dispatch({ type: "WAIT_FOR_USER" });
      QW_COPY.manualStep.telemetry.forEach((line, i) => {
        setTimeout(() => addTelemetry(line), i * 240);
      });
    }
  }, [mode, currentStep, dispatch, addTelemetry]);

  // RunningAutoStep: invoke stub async runner
  useEffect(() => {
    if (mode !== "RunningAutoStep" || runnerActive.current) return;
    runnerActive.current = true;
    runAutoStep(
      quickWin!,
      currentStepIndex,
      (pct) => setProgress(pct),
      (s) => dispatch({ type: "SET_SCORE", payload: s }),
      (line) => addTelemetry(line),
    ).then(() => {
      dispatch({ type: "AUTO_STEP_COMPLETE" });
      runnerActive.current = false;
    }).catch(() => {
      runnerActive.current = false;
    });
  }, [mode, quickWin, currentStepIndex, runAutoStep, dispatch, addTelemetry]);

  // StepComplete: brief 240ms pause then advance
  useEffect(() => {
    if (mode !== "StepComplete") return undefined;
    addTelemetry(QW_COPY.stepComplete.line);
    const t = setTimeout(() => {
      const nextIndex = currentStepIndex + 1;
      if (nextIndex >= totalSteps) {
        dispatch({ type: "ALL_STEPS_DONE" });
      } else {
        dispatch({ type: "INCREMENT_STEP" });
        setTimeout(() => dispatch({ type: "NEXT_STEP" }), 24);
      }
    }, 240);
    return () => clearTimeout(t);
  }, [mode, currentStepIndex, totalSteps, dispatch, addTelemetry]);

  // EscalatingToProject phase 1: card fades+scales over 240ms, show telemetry
  useEffect(() => {
    if (mode !== "EscalatingToProject") return undefined;
    addTelemetry(QW_COPY.escalating.telemetry);
    requestAnimationFrame(() => {
      setCardScale(0.9);
      setCardOpacity(0);
    });
    return undefined;
  }, [mode, addTelemetry]);

  // ExitQuickWin: card fades to 0
  useEffect(() => {
    if (mode !== "ExitQuickWin") return undefined;
    requestAnimationFrame(() => {
      setCardScale(0.96);
      setCardOpacity(0);
    });
    return undefined;
  }, [mode]);

  const handleExit = () => dispatch({ type: "EXIT" });

  const isEscalating = mode === "EscalatingToProject" || mode === "ExitQuickWin";

  return (
    <div
      className="relative bg-white rounded-2xl shadow-2xl ring-1 ring-black/5 max-w-2xl w-full mx-auto overflow-hidden"
      style={{
        transform: `scale(${cardScale})`,
        opacity: cardOpacity,
        transition: "transform 240ms cubic-bezier(0.42,0,0.58,1), opacity 240ms cubic-bezier(0.42,0,0.58,1)",
      }}
    >
      {/* Header */}
      <div className="bg-[#0A2540] px-6 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-[#0078D4] flex items-center justify-center text-white flex-shrink-0">
            <BoltIcon />
          </div>
          <div>
            <p className="text-[9px] font-bold tracking-[0.25em] uppercase text-white/40">Quick Win Mode</p>
            <h2 className="text-sm font-black text-white leading-tight">
              {quickWin?.title ?? "Diagnostic Sequence"}
            </h2>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {mode !== "QuickWinComplete" && mode !== "EscalatingToProject" && (
            <span className="text-[10px] font-bold text-white/50">
              Step {Math.min(currentStepIndex + 1, totalSteps)} of {totalSteps}
            </span>
          )}
          <button
            onClick={handleExit}
            className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/60 hover:text-white"
            style={{ transition: "all 240ms cubic-bezier(0.42,0,0.58,1)" }}
            title="Exit Quick Win Mode"
          >
            <XIcon />
          </button>
        </div>
      </div>

      {/* Step progress bar */}
      {mode !== "QuickWinComplete" && (
        <div className="flex gap-1 px-6 pt-3">
          {steps.map((s, i) => (
            <div key={s.id} className="h-1 flex-1 rounded-full overflow-hidden bg-[#F7F9FC]">
              <div
                className={`h-full rounded-full ${i < currentStepIndex ? "bg-green-500" : i === currentStepIndex && (mode === "RunningAutoStep") ? "bg-[#0078D4]" : "bg-transparent"}`}
                style={{
                  width: i === currentStepIndex && mode === "RunningAutoStep" ? `${progress}%` : i < currentStepIndex ? "100%" : "0%",
                  transition: "width 240ms cubic-bezier(0.42,0,0.58,1)",
                }}
              />
            </div>
          ))}
        </div>
      )}

      {/* Body */}
      <div className="px-6 py-5">

        {/* EnteringQuickWin */}
        {mode === "EnteringQuickWin" && (
          <div className="flex flex-col items-center py-6 gap-3">
            <div className="w-12 h-12 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
            <p className="text-sm font-bold text-[#0A2540]">{QW_COPY.entering}</p>
          </div>
        )}

        {/* Ready (brief transition state) */}
        {mode === "Ready" && (
          <div className="flex items-center gap-3 py-4">
            <div className="w-5 h-5 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin flex-shrink-0" />
            <p className="text-sm text-muted-foreground">{QW_COPY.ready}</p>
          </div>
        )}

        {/* Running auto step */}
        {mode === "RunningAutoStep" && (
          <ProgressLayer
            progress={progress}
            score={state.score}
            prevScore={state.prevScore}
            telemetryLines={telemetryLines}
          />
        )}

        {/* Waiting for user */}
        {mode === "WaitingForUser" && (
          <ManualActionLayer telemetryLines={telemetryLines} />
        )}

        {/* Step complete */}
        {mode === "StepComplete" && (
          <div className="flex items-center gap-3 py-4">
            <div className="w-7 h-7 rounded-full bg-green-500 flex items-center justify-center text-white flex-shrink-0">
              <CheckIcon />
            </div>
            <div>
              <p className="text-sm font-bold text-[#0A2540]">{QW_COPY.stepComplete.line}</p>
              <p className="text-xs text-muted-foreground">{QW_COPY.stepComplete.continueLine}</p>
            </div>
          </div>
        )}

        {/* All complete */}
        {mode === "QuickWinComplete" && (
          <div className="flex flex-col items-center gap-5 py-4">
            <ScoreRing score={score} size={128} />
            <div className="text-center">
              <h3 className="text-lg font-black text-[#0A2540]">{QW_COPY.complete.heading}</h3>
              <p className="text-sm text-muted-foreground mt-1">{QW_COPY.complete.subtext}</p>
              {score >= 70 && (
                <p className="text-xs font-semibold text-[#0078D4] mt-0.5">{QW_COPY.complete.escalateRecommended}</p>
              )}
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
                onClick={handleExit}
                className="flex-1 px-5 py-3 rounded-xl border border-border text-[#0A2540] font-bold text-sm hover:bg-[#F7F9FC] active:scale-[0.98]"
                style={{ transition: "all 240ms cubic-bezier(0.42,0,0.58,1)" }}
              >
                {QW_COPY.complete.exitBtn}
              </button>
            </div>
          </div>
        )}

        {/* Escalating — phase 1: show telemetry while card fades */}
        {(mode === "EscalatingToProject" || mode === "ExitQuickWin") && (
          <div className="flex flex-col gap-3 py-2">
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin flex-shrink-0" />
              <p className="text-sm font-bold text-[#0A2540]">{QW_COPY.exit}</p>
            </div>
            <TelemetryFeed lines={telemetryLines} />
          </div>
        )}
      </div>

      {/* Step label footer */}
      {mode !== "QuickWinComplete" && !isEscalating && currentStep && (
        <div className="px-6 pb-5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Current: {currentStep.title}
          </p>
        </div>
      )}
    </div>
  );
}
