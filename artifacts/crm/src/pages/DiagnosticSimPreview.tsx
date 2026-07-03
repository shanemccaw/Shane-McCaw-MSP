import { useEffect } from "react";
import { useQuickWinMode } from "@/context/QuickWinModeContext";

const SIM_QUICK_WIN = {
  id: "__sim",
  title: "Security Baseline Diagnostic",
  description: "Automated security hardening and compliance assessment for your Microsoft 365 tenant.",
  category: "security",
};

export default function DiagnosticSimPreview() {
  const { dispatch, state } = useQuickWinMode();

  useEffect(() => {
    if (state.mode === "Idle") {
      // First set the quickWin metadata (title, category, etc.)
      dispatch({ type: "SELECT_QUICK_WIN", payload: SIM_QUICK_WIN });
    }
  }, [dispatch, state.mode]);

  // Once SELECT_QUICK_WIN has been processed (mode leaves Idle), immediately
  // bind the mock "__sim" project so the overlay jumps to ProjectTasksView,
  // which shows the full three-column diagnostic layout with mock data.
  useEffect(() => {
    if (state.mode !== "Idle" && state.mode !== "ProjectTasksView") {
      dispatch({ type: "BIND_PROJECT", payload: { projectId: "__sim" } });
    }
  }, [dispatch, state.mode]);

  return (
    <div className="min-h-screen bg-[#F7F9FC] flex items-center justify-center">
      <div className="text-center space-y-3">
        <div className="w-8 h-8 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-sm text-muted-foreground">Loading simulation…</p>
      </div>
    </div>
  );
}
