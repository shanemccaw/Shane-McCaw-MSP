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
      dispatch({ type: "SELECT_QUICK_WIN", payload: SIM_QUICK_WIN });
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
