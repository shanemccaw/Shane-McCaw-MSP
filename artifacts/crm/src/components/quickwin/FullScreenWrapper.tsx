import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useQuickWinMode } from "@/context/QuickWinModeContext";
import type { KanbanTaskSummary } from "@/context/QuickWinModeContext";
import TransitionLayer from "./TransitionLayer";

export default function FullScreenWrapper() {
  const { state, dispatch, escalateToProject } = useQuickWinMode();
  const { mode, quickWin, openProjectOnExit, projectId } = state;
  const [, navigate] = useLocation();
  const { fetchWithAuth } = useAuth();

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

  // EscalatingToProject: fire the API, then fetch the new project's kanban tasks
  // so the overlay can show real task statuses instead of navigating away.
  // The overlay stays open throughout — the card content transitions to the
  // ProjectTasksView once the tasks are loaded.
  useEffect(() => {
    if (mode !== "EscalatingToProject") return undefined;
    if (!quickWin || escalationInFlight.current) return undefined;

    escalationInFlight.current = true;

    const run = async () => {
      try {
        const newProjectId = await escalateToProject(quickWin);

        if (!newProjectId) {
          // Escalation returned nothing — navigate to the projects list
          dispatch({ type: "ESCALATION_COMPLETE" });
          navigate("/portal/projects");
          return;
        }

        // Fetch the project's kanban tasks so we can show them in the overlay
        const res = await fetchWithAuth(`/api/portal/projects/${newProjectId}`);
        if (res.ok) {
          const data = await res.json() as {
            tasks?: Array<{
              id: number;
              title: string;
              column: string;
              groupName?: string | null;
              description?: string | null;
            }>;
          };
          const tasks: KanbanTaskSummary[] = (data.tasks ?? []).map(t => ({
            id: t.id,
            title: t.title,
            column: (["backlog", "in_progress", "waiting_on_customer", "completed"].includes(t.column)
              ? t.column
              : "backlog") as KanbanTaskSummary["column"],
            groupName: t.groupName ?? null,
            description: t.description ?? null,
          }));
          dispatch({ type: "SET_PROJECT_TASKS", payload: { projectId: newProjectId, tasks } });
        } else {
          // Couldn't load tasks — go straight to the project page
          dispatch({ type: "ESCALATION_COMPLETE" });
          navigate(`/portal/projects/${newProjectId}`);
        }
      } catch {
        dispatch({ type: "ESCALATION_COMPLETE" });
        navigate("/portal/projects");
      } finally {
        escalationInFlight.current = false;
      }
    };

    run();
    return undefined;
  }, [mode, quickWin, escalateToProject, fetchWithAuth, dispatch, navigate]);

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
