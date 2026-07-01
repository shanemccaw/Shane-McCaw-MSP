import { useEffect, useRef, useState } from "react";
import { useQuickWinMode } from "@/context/QuickWinModeContext";
import QuickWinCard from "./QuickWinCard";

function FrozenStepCard({ stepLabel }: { stepLabel: string }) {
  return (
    <div className="bg-white rounded-2xl shadow-2xl ring-1 ring-black/5 max-w-2xl w-full mx-auto overflow-hidden pointer-events-none select-none">
      <div className="bg-[#0A2540] px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-[#0078D4] flex items-center justify-center text-white flex-shrink-0">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div>
            <p className="text-[9px] font-bold tracking-[0.25em] uppercase text-white/40">Quick Win Mode</p>
            <h2 className="text-sm font-black text-white leading-tight">{stepLabel}</h2>
          </div>
        </div>
      </div>
      <div className="px-6 py-5">
        <div className="flex items-center gap-3 py-4">
          <div className="w-7 h-7 rounded-full bg-green-500 flex items-center justify-center text-white flex-shrink-0">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-bold text-[#0A2540]">Telemetry received.</p>
            <p className="text-xs text-muted-foreground">Continuing sequence…</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TransitionLayer() {
  const { state } = useQuickWinMode();
  const { mode, currentStepIndex, quickWin } = state;

  const steps = quickWin?.steps ?? [];
  const prevStepIndexRef = useRef(currentStepIndex);

  // showDual: whether to render two cards; animated: whether CSS transition targets are active
  const [showDual, setShowDual] = useState(false);
  const [animated, setAnimated] = useState(false);
  const [exitingStepIndex, setExitingStepIndex] = useState(0);

  useEffect(() => {
    if (mode === "Ready" && currentStepIndex !== prevStepIndexRef.current) {
      const exiting = prevStepIndexRef.current;
      prevStepIndexRef.current = currentStepIndex;

      // Step 1: render both cards at START positions (outgoing=0%, incoming=100%)
      setExitingStepIndex(exiting);
      setShowDual(true);
      setAnimated(false);

      // Step 2: on next two frames, trigger CSS transition to END positions
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setAnimated(true);
        });
      });

      // Step 3: after 240ms, tear down the dual-card layout
      const t = setTimeout(() => {
        setShowDual(false);
        setAnimated(false);
      }, 240);

      return () => clearTimeout(t);
    }
    return undefined;
  }, [mode, currentStepIndex]);

  const exitingStep = steps[exitingStepIndex];
  const exitingLabel = quickWin?.title ?? exitingStep?.title ?? "Diagnostic Sequence";

  if (showDual) {
    return (
      // Clip overflow so cards don't show outside the wrapper during slide
      <div className="relative w-full max-w-2xl mx-auto" style={{ overflow: "hidden" }}>
        {/* Outgoing card: starts at translateX(0) → animates to translateX(-100%) */}
        <div
          style={{
            transform: animated ? "translateX(-100%)" : "translateX(0%)",
            transition: animated ? "transform 240ms cubic-bezier(0.42,0,0.58,1)" : "none",
            width: "100%",
          }}
        >
          <FrozenStepCard stepLabel={exitingLabel} />
        </div>

        {/* Incoming card: starts at translateX(100%) → animates to translateX(0%) */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            transform: animated ? "translateX(0%)" : "translateX(100%)",
            transition: animated ? "transform 240ms cubic-bezier(0.42,0,0.58,1)" : "none",
          }}
        >
          <QuickWinCard />
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl mx-auto">
      <QuickWinCard />
    </div>
  );
}
