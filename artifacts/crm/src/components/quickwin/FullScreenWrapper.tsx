import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQuickWinMode } from "@/context/QuickWinModeContext";
import TransitionLayer from "./TransitionLayer";

export default function FullScreenWrapper() {
  const { state, dispatch, escalateToProject } = useQuickWinMode();
  const { mode, quickWin, openProjectOnExit, projectId } = state;
  const [, navigate] = useLocation();

  const isVisible = mode !== "Idle";
  const [mounted, setMounted] = useState(false);
  const [backdropOpacity, setBackdropOpacity] = useState(0);

  // Guard against double-firing the escalation API call
  const escalationInFlight = useRef(false);

  // Mount / unmount: double-rAF ensures the element is in the DOM before the
  // opacity transition starts (single rAF fires before React commits the paint).
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

  // ExitQuickWin: fade backdrop out, then reset state machine.
  // If openProjectOnExit is true (user clicked "Open Project" from the task view),
  // navigate to the created project once the animation finishes.
  useEffect(() => {
    if (mode !== "ExitQuickWin") return undefined;
    setBackdropOpacity(0);
    const t = setTimeout(() => {
      dispatch({ type: "ESCALATION_COMPLETE" });
      if (openProjectOnExit && projectId) {
        navigate(`/portal/projects/${projectId}`);
      }
    }, 240);
    return () => clearTimeout(t);
  }, [mode, dispatch, navigate, openProjectOnExit, projectId]);

  // EscalatingToProject: fire the escalation API. On success, dispatch SET_PROJECT
  // with the new project ID so the overlay transitions to ProjectTasksView.
  // Live Kanban task data is fetched by ProjectTasksLayer independently via
  // react-query, so it stays in sync with the board without duplication here.
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
      .finally(() => {
        escalationInFlight.current = false;
      });

    return undefined;
  }, [mode, quickWin, escalateToProject, dispatch, navigate]);

  if (!mounted) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{
        opacity: backdropOpacity,
        transition: "opacity 240ms cubic-bezier(0.42,0,0.58,1)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        backgroundColor: `rgba(255, 255, 255, ${backdropOpacity * 0.80})`,
      }}
    >
      <TransitionLayer />
    </div>
  );
}
