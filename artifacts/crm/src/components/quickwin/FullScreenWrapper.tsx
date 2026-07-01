import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQuickWinMode } from "@/context/QuickWinModeContext";
import TransitionLayer from "./TransitionLayer";

export default function FullScreenWrapper() {
  const { state, dispatch } = useQuickWinMode();
  const { mode } = state;
  const [, navigate] = useLocation();

  const isVisible = mode !== "Idle";
  const [mounted, setMounted] = useState(false);
  const [backdropOpacity, setBackdropOpacity] = useState(0);
  const escalationTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Mount / unmount the overlay
  useEffect(() => {
    if (isVisible && !mounted) {
      setMounted(true);
      requestAnimationFrame(() => setBackdropOpacity(1));
      return;
    }
    if (!isVisible && mounted) {
      setBackdropOpacity(0);
      const t = setTimeout(() => setMounted(false), 240);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [isVisible, mounted]);

  // ExitQuickWin: fade backdrop → unmount
  useEffect(() => {
    if (mode !== "ExitQuickWin") return undefined;
    setBackdropOpacity(0);
    const t = setTimeout(() => dispatch({ type: "ESCALATION_COMPLETE" }), 240);
    return () => clearTimeout(t);
  }, [mode, dispatch]);

  // EscalatingToProject: 3-phase 240ms choreography
  // Phase 1 (0–240ms):   card scales to 0.9 + fades — managed by QuickWinCard
  // Phase 2 (240–480ms): backdrop fades out
  // Phase 3 (480ms):     unmount + navigate
  useEffect(() => {
    if (mode !== "EscalatingToProject") return undefined;

    // Phase 2: after card has faded (240ms), fade out backdrop
    const t2 = setTimeout(() => setBackdropOpacity(0), 240);

    // Phase 3: after backdrop fades (another 240ms), navigate and reset
    const t3 = setTimeout(() => {
      dispatch({ type: "ESCALATION_COMPLETE" });
      navigate("/portal/projects");
    }, 480);

    escalationTimers.current = [t2, t3];
    return () => escalationTimers.current.forEach(clearTimeout);
  }, [mode, dispatch, navigate]);

  if (!mounted) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{
        opacity: backdropOpacity,
        transition: "opacity 240ms cubic-bezier(0.42,0,0.58,1)",
        backdropFilter: `blur(12px)`,
        WebkitBackdropFilter: `blur(12px)`,
        backgroundColor: `rgba(255, 255, 255, ${backdropOpacity * 0.80})`,
      }}
    >
      <TransitionLayer />
    </div>
  );
}
