import { useState, useEffect, useCallback, useRef } from "react";

const TOUR_KEY = "portal_tour_seen";

export interface TourStep {
  target: string;
  title: string;
  description: string;
}

const TOUR_STEPS: TourStep[] = [
  {
    target: "dashboard",
    title: "Dashboard",
    description:
      "Your home base. See your active project health, what's waiting on you, and recent activity all in one place.",
  },
  {
    target: "projects",
    title: "Projects",
    description:
      "Track every milestone and task for your active engagements. Provide feedback directly on tasks that need your input.",
  },
  {
    target: "services",
    title: "Services",
    description:
      "Browse and order additional services whenever you're ready to expand your engagement.",
  },
  {
    target: "billing",
    title: "Billing",
    description:
      "View invoices, download receipts, and pay outstanding balances securely.",
  },
  {
    target: "messages",
    title: "Messages",
    description:
      "Send and receive messages directly with Shane. All communication is logged here for easy reference.",
  },
  {
    target: "documents",
    title: "Documents & Reports",
    description:
      "Access deliverables, download reports, and review any files shared during your project.",
  },
];

const POPOVER_WIDTH = 280;
const POPOVER_HEIGHT = 160;
const HIGHLIGHT_PADDING = 6;

interface HighlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function getElementRect(target: string): HighlightRect | null {
  const els = document.querySelectorAll(`[data-tour="${target}"]`);
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") continue;
    return { top: r.top, left: r.left, width: r.width, height: r.height };
  }
  return null;
}

function isMobileLayout(): boolean {
  return window.innerWidth < 768;
}

function computePopoverPos(
  rect: HighlightRect,
  mobile: boolean,
  viewW: number,
  viewH: number
): { top: number; left: number } {
  const pad = HIGHLIGHT_PADDING;

  if (mobile) {
    let top = rect.top - POPOVER_HEIGHT - 16;
    if (top < 8) top = rect.top + rect.height + 16;
    top = Math.max(8, Math.min(top, viewH - POPOVER_HEIGHT - 8));
    let left = rect.left + rect.width / 2 - POPOVER_WIDTH / 2;
    if (left < 8) left = 8;
    if (left + POPOVER_WIDTH > viewW - 8) left = viewW - POPOVER_WIDTH - 8;
    return { top, left };
  }

  const rightOf = rect.left + rect.width + 12 + pad;
  const centeredY = rect.top + rect.height / 2 - POPOVER_HEIGHT / 2;

  if (rightOf + POPOVER_WIDTH <= viewW - 8) {
    const top = Math.max(8, Math.min(centeredY, viewH - POPOVER_HEIGHT - 8));
    return { top, left: rightOf };
  }

  const leftOf = rect.left - POPOVER_WIDTH - 12 - pad;
  if (leftOf >= 8) {
    const top = Math.max(8, Math.min(centeredY, viewH - POPOVER_HEIGHT - 8));
    return { top, left: leftOf };
  }

  let top = rect.top + rect.height + 12 + pad;
  if (top + POPOVER_HEIGHT > viewH - 8) top = rect.top - POPOVER_HEIGHT - 12 - pad;
  let left = rect.left + rect.width / 2 - POPOVER_WIDTH / 2;
  if (left < 8) left = 8;
  if (left + POPOVER_WIDTH > viewW - 8) left = viewW - POPOVER_WIDTH - 8;
  return { top, left };
}

interface WelcomeModalProps {
  onStart: () => void;
  onSkip: () => void;
}

function WelcomeModal({ onStart, onSkip }: WelcomeModalProps) {
  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4"
      style={{ background: "rgba(10,37,64,0.75)" }}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8 flex flex-col items-center text-center"
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-title"
      >
        <div className="w-14 h-14 rounded-2xl bg-[#0078D4] flex items-center justify-center mb-5 shadow-lg shadow-[#0078D4]/30">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            className="w-7 h-7 text-white"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7"
            />
          </svg>
        </div>
        <h2
          id="welcome-title"
          className="text-xl font-bold text-[#0A2540] mb-2"
        >
          Welcome to your client portal
        </h2>
        <p className="text-sm text-gray-500 mb-7 leading-relaxed">
          Here's a quick overview of everything available to you — it only
          takes about a minute.
        </p>
        <button
          onClick={onStart}
          className="w-full py-3 rounded-xl bg-[#0078D4] text-white font-semibold text-sm hover:bg-[#0078D4]/90 transition-colors mb-3 shadow-md shadow-[#0078D4]/20 focus:outline-none focus:ring-2 focus:ring-[#0078D4] focus:ring-offset-2"
        >
          Start Tour
        </button>
        <button
          onClick={onSkip}
          className="w-full py-2.5 rounded-xl text-sm font-medium text-gray-400 hover:text-gray-600 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-300 focus:ring-offset-2"
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}

interface TourOverlayProps {
  step: number;
  totalSteps: number;
  onNext: () => void;
  onPrev: () => void;
  onFinish: () => void;
  onSkip: () => void;
}

function TourOverlay({
  step,
  totalSteps,
  onNext,
  onPrev,
  onFinish,
  onSkip,
}: TourOverlayProps) {
  const [rect, setRect] = useState<HighlightRect | null>(null);
  const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0 });
  const [viewSize, setViewSize] = useState({
    w: window.innerWidth,
    h: window.innerHeight,
  });
  const rafRef = useRef<number | null>(null);

  const currentStep = TOUR_STEPS[step];

  const updatePositions = useCallback(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    setViewSize({ w: vw, h: vh });
    const r = getElementRect(currentStep.target);
    setRect(r);
    if (r) {
      setPopoverPos(computePopoverPos(r, isMobileLayout(), vw, vh));
    } else {
      setPopoverPos({
        top: Math.max(8, vh / 2 - POPOVER_HEIGHT / 2),
        left: Math.max(8, vw / 2 - POPOVER_WIDTH / 2),
      });
    }
  }, [currentStep.target]);

  useEffect(() => {
    updatePositions();
    const onResize = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(updatePositions);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [updatePositions]);

  useEffect(() => {
    if (rect !== null) return;
    const timer = setTimeout(() => {
      const r = getElementRect(currentStep.target);
      if (!r) {
        if (step < totalSteps - 1) onNext();
        else onFinish();
      }
    }, 120);
    return () => clearTimeout(timer);
  }, [rect, step, totalSteps, currentStep.target, onNext, onFinish]);

  const p = HIGHLIGHT_PADDING;
  const hRect = rect
    ? {
        x: rect.left - p,
        y: rect.top - p,
        w: rect.width + p * 2,
        h: rect.height + p * 2,
      }
    : null;

  const isFirst = step === 0;
  const isLast = step === totalSteps - 1;

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "Enter") {
        isLast ? onFinish() : onNext();
      } else if (e.key === "ArrowLeft") {
        if (!isFirst) onPrev();
      } else if (e.key === "Escape") {
        onSkip();
      }
    },
    [isFirst, isLast, onFinish, onNext, onPrev, onSkip]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <>
      <svg
        style={{
          position: "fixed",
          inset: 0,
          width: "100vw",
          height: "100vh",
          zIndex: 9998,
          pointerEvents: "all",
        }}
        aria-hidden="true"
        onClick={onSkip}
      >
        <defs>
          <mask id="portal-tour-mask">
            <rect width="100%" height="100%" fill="white" />
            {hRect && (
              <rect
                x={hRect.x}
                y={hRect.y}
                width={hRect.w}
                height={hRect.h}
                rx={8}
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(10,37,64,0.72)"
          mask="url(#portal-tour-mask)"
        />
      </svg>

      {hRect && (
        <div
          style={{
            position: "fixed",
            top: hRect.y,
            left: hRect.x,
            width: hRect.w,
            height: hRect.h,
            zIndex: 9999,
            borderRadius: 8,
            pointerEvents: "none",
            boxShadow: "0 0 0 2px #0078D4, 0 0 0 4px rgba(0,120,212,0.3)",
          }}
          aria-hidden="true"
        />
      )}

      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Tour step ${step + 1} of ${totalSteps}: ${currentStep.title}`}
        style={{
          position: "fixed",
          top: popoverPos.top,
          left: popoverPos.left,
          width: POPOVER_WIDTH,
          zIndex: 10000,
          pointerEvents: "all",
        }}
        className="bg-white rounded-2xl shadow-2xl p-5 flex flex-col gap-3"
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-bold tracking-widest uppercase text-[#0078D4]">
                {step + 1} / {totalSteps}
              </span>
            </div>
            <h3 className="text-base font-bold text-[#0A2540] leading-tight">
              {currentStep.title}
            </h3>
          </div>
          <button
            onClick={onSkip}
            aria-label="Skip tour"
            className="flex-shrink-0 text-gray-300 hover:text-gray-500 transition-colors mt-0.5 focus:outline-none focus:ring-2 focus:ring-gray-300 rounded"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <p className="text-sm text-gray-500 leading-relaxed">
          {currentStep.description}
        </p>

        <div className="flex items-center gap-2 pt-1">
          {!isFirst && (
            <button
              onClick={onPrev}
              className="px-3 py-1.5 rounded-lg text-sm font-semibold text-gray-400 hover:text-gray-600 border border-gray-200 hover:border-gray-300 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-300"
            >
              ← Prev
            </button>
          )}
          <div className="flex items-center gap-1 flex-1 justify-center">
            {TOUR_STEPS.map((_, i) => (
              <div
                key={i}
                className={`rounded-full transition-all duration-200 ${
                  i === step
                    ? "w-4 h-1.5 bg-[#0078D4]"
                    : "w-1.5 h-1.5 bg-gray-200"
                }`}
              />
            ))}
          </div>
          {isLast ? (
            <button
              onClick={onFinish}
              className="px-4 py-1.5 rounded-lg text-sm font-semibold bg-[#0078D4] text-white hover:bg-[#0078D4]/90 transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] focus:ring-offset-1"
            >
              Finish
            </button>
          ) : (
            <button
              onClick={onNext}
              className="px-4 py-1.5 rounded-lg text-sm font-semibold bg-[#0078D4] text-white hover:bg-[#0078D4]/90 transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] focus:ring-offset-1"
            >
              Next →
            </button>
          )}
        </div>
      </div>
    </>
  );
}

export function useTour() {
  const startTour = useCallback(() => {
    localStorage.removeItem(TOUR_KEY);
    window.dispatchEvent(new CustomEvent("portal-tour-replay"));
  }, []);
  return { startTour };
}

export default function PortalTour() {
  const [phase, setPhase] = useState<"idle" | "welcome" | "tour">("idle");
  const [step, setStep] = useState(0);

  useEffect(() => {
    const seen = localStorage.getItem(TOUR_KEY);
    if (!seen) {
      setPhase("welcome");
    }
  }, []);

  useEffect(() => {
    const onReplay = () => {
      setStep(0);
      setPhase("tour");
    };
    window.addEventListener("portal-tour-replay", onReplay);
    return () => window.removeEventListener("portal-tour-replay", onReplay);
  }, []);

  const markSeen = useCallback(() => {
    localStorage.setItem(TOUR_KEY, "1");
  }, []);

  const handleSkipWelcome = useCallback(() => {
    markSeen();
    setPhase("idle");
  }, [markSeen]);

  const handleStartTour = useCallback(() => {
    setStep(0);
    setPhase("tour");
  }, []);

  const handleNext = useCallback(() => {
    setStep((s) => s + 1);
  }, []);

  const handlePrev = useCallback(() => {
    setStep((s) => Math.max(0, s - 1));
  }, []);

  const handleFinish = useCallback(() => {
    markSeen();
    setPhase("idle");
  }, [markSeen]);

  const handleSkipTour = useCallback(() => {
    markSeen();
    setPhase("idle");
  }, [markSeen]);

  if (phase === "idle") return null;

  if (phase === "welcome") {
    return (
      <WelcomeModal onStart={handleStartTour} onSkip={handleSkipWelcome} />
    );
  }

  return (
    <TourOverlay
      step={step}
      totalSteps={TOUR_STEPS.length}
      onNext={handleNext}
      onPrev={handlePrev}
      onFinish={handleFinish}
      onSkip={handleSkipTour}
    />
  );
}
