import { useEffect, useState } from "react";
import { useQuickWinMode } from "@/context/QuickWinModeContext";
import { useAuth } from "@/contexts/AuthContext";
import PortalLayout from "@/components/PortalLayout";
import type { QuickWinItem } from "@/context/QuickWinModeContext";

// Fallback shown while loading or if the API call fails
const FALLBACK_QUICK_WINS: QuickWinItem[] = [
  {
    id: "qw-security",
    title: "Security Baseline Diagnostic",
    description: "Automated scan of your M365 security posture with actionable findings.",
    category: "Security",
    steps: [
      { id: "sec-1", title: "Identity & access scan", type: "auto" },
      { id: "sec-2", title: "Threat protection review", type: "auto" },
      { id: "sec-3", title: "Data protection check", type: "manual" },
    ],
  },
  {
    id: "qw-copilot",
    title: "Copilot Readiness Assessment",
    description: "Evaluate your environment's readiness for Microsoft 365 Copilot deployment.",
    category: "Copilot AI",
    steps: [
      { id: "cop-1", title: "License & seat check", type: "auto" },
      { id: "cop-2", title: "Security prerequisite scan", type: "auto" },
      { id: "cop-3", title: "Data sensitivity review", type: "manual" },
    ],
  },
  {
    id: "qw-governance",
    title: "Governance Health Check",
    description: "Rapid governance maturity scan across your Microsoft 365 tenant.",
    category: "Governance",
    steps: [
      { id: "gov-1", title: "Policy & retention scan", type: "auto" },
      { id: "gov-2", title: "Identity governance review", type: "auto" },
      { id: "gov-3", title: "Compliance report upload", type: "manual" },
    ],
  },
];

function RocketIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  );
}

export default function QuickWinResultsPage() {
  const { dispatch } = useQuickWinMode();
  const { fetchWithAuth } = useAuth();

  const [quickWins, setQuickWins] = useState<QuickWinItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchWithAuth("/api/portal/quick-win/catalog")
      .then((res) => {
        if (!res.ok) throw new Error("Catalog fetch failed");
        return res.json() as Promise<QuickWinItem[]>;
      })
      .then((data) => {
        if (!cancelled) setQuickWins(data);
      })
      .catch(() => {
        if (!cancelled) setQuickWins(FALLBACK_QUICK_WINS);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [fetchWithAuth]);

  const activate = (qw: QuickWinItem) => {
    dispatch({ type: "SELECT_QUICK_WIN", payload: qw });
  };

  const CATEGORY_COLORS: Record<string, string> = {
    Security:     "bg-[#0078D4]/10 text-[#0078D4]",
    "Copilot AI": "bg-purple-100 text-purple-700",
    Governance:   "bg-teal-100 text-teal-700",
  };

  const items = loading ? FALLBACK_QUICK_WINS : quickWins;

  return (
    <PortalLayout>
      <div className="px-4 sm:px-6 py-6 sm:py-8 max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-2.5 mb-2">
            <div className="w-8 h-8 rounded-lg bg-[#0078D4] flex items-center justify-center text-white">
              <RocketIcon />
            </div>
            <h1 className="text-2xl font-extrabold text-[#0A2540]">Quick Win Diagnostics</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Select a diagnostic package to launch an immersive, guided Quick Win sequence.
          </p>
        </div>

        {/* Quick Win Cards grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {items.map((qw) => (
            <div
              key={qw.id}
              className="bg-white border border-border rounded-2xl p-5 flex flex-col gap-4 shadow-sm hover:border-[#0078D4]/40 hover:shadow-md"
              style={{ transition: "all 240ms cubic-bezier(0.42,0,0.58,1)" }}
            >
              {/* Category pill */}
              {qw.category && (
                <span className={`self-start text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full ${CATEGORY_COLORS[qw.category] ?? "bg-gray-100 text-gray-600"}`}>
                  {qw.category}
                </span>
              )}

              <div className="flex-1">
                <h3 className="text-sm font-black text-[#0A2540] mb-1.5">{qw.title}</h3>
                {qw.description && (
                  <p className="text-xs text-muted-foreground leading-relaxed">{qw.description}</p>
                )}
              </div>

              {/* Steps preview */}
              {qw.steps && (
                <div className="space-y-1">
                  {qw.steps.map((step, i) => (
                    <div key={step.id} className="flex items-center gap-2">
                      <span className="text-[9px] font-bold text-muted-foreground w-4 text-right">{i + 1}.</span>
                      <span className="text-[11px] text-[#0A2540]/70">{step.title}</span>
                      <span className={`ml-auto text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${step.type === "auto" ? "bg-[#0078D4]/10 text-[#0078D4]" : "bg-amber-100 text-amber-700"}`}>
                        {step.type === "auto" ? "Auto" : "Manual"}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Activate button */}
              <button
                onClick={() => activate(qw)}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#0A2540] text-white text-xs font-bold hover:bg-[#0A2540]/90 active:scale-[0.98]"
                style={{ transition: "all 240ms cubic-bezier(0.42,0,0.58,1)" }}
              >
                <RocketIcon />
                Activate Quick Win
              </button>
            </div>
          ))}
        </div>

        {/* Info footer */}
        <p className="text-xs text-muted-foreground text-center mt-8">
          Automated steps read your Microsoft 365 tenant profile and return live scores. Results reflect your actual environment.
        </p>
      </div>
    </PortalLayout>
  );
}
