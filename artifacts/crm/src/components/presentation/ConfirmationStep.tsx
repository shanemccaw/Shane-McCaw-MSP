import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";

interface CategoryBreakdown {
  key: string;
  label: string;
  firstScore: number;
  latestScore: number;
  delta: number;
  hasAlert: boolean;
}

interface HealthSummaryData {
  hasData: true;
  overallFirst: number;
  overallLatest: number;
  overallDelta: number;
  lastUpdated: string;
  timeSeries: Array<{ date: string; score: number }>;
  categories: CategoryBreakdown[];
}

type HealthResponse = { hasData: false } | HealthSummaryData;

function scoreColor(score: number) {
  if (score >= 70) return "#22c55e";
  if (score >= 40) return "#f59e0b";
  return "#ef4444";
}

function ScoreRing({ score, size = 52 }: { score: number; size?: number }) {
  const radius = (size - 8) / 2;
  const circ = 2 * Math.PI * radius;
  const fill = (score / 100) * circ;
  const color = scoreColor(score);
  return (
    <svg width={size} height={size} className="flex-shrink-0">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#e5e7eb" strokeWidth={5} />
      <circle
        cx={size / 2} cy={size / 2} r={radius}
        fill="none"
        stroke={color}
        strokeWidth={5}
        strokeDasharray={`${fill} ${circ}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dasharray 0.8s ease" }}
      />
      <text
        x="50%" y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={11}
        fontWeight="700"
        fill={color}
      >
        {score}%
      </text>
    </svg>
  );
}

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  security: (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
  ),
  compliance: (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    </svg>
  ),
  copilot: (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  ),
  governance: (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
    </svg>
  ),
  productivity: (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  ),
  identity: (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c0 1.306.835 2.417 2 2.83M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2" />
    </svg>
  ),
  collaboration: (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  ),
  data: (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
    </svg>
  ),
};

const BG_TASKS = [
  {
    label: "Payment confirmed & recorded",
    detail: "Your invoice has been updated in your billing portal.",
    delay: 0,
    done: true,
  },
  {
    label: "Setting up your client workspace",
    detail: "Provisioning your dedicated SharePoint environment and Teams channel.",
    delay: 800,
    done: false,
  },
  {
    label: "Scheduling your kickoff session",
    detail: "Shane will reach out within one business day to confirm a time.",
    delay: 1800,
    done: false,
  },
  {
    label: "Sending your welcome package",
    detail: "Onboarding materials and next-steps guide are on their way.",
    delay: 2800,
    done: false,
  },
];

interface Props {
  clientName: string | null;
  projectTitle: string | null;
  onClose: () => void;
}

export default function ConfirmationStep({ clientName, projectTitle, onClose }: Props) {
  const { fetchWithAuth } = useAuth();
  const [visibleTasks, setVisibleTasks] = useState<number>(1);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    BG_TASKS.forEach((task, i) => {
      if (i === 0) return;
      setTimeout(() => {
        if (!cancelled) setVisibleTasks(v => Math.max(v, i + 1));
      }, task.delay);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    fetchWithAuth("/api/portal/health/summary")
      .then(r => r.ok ? (r.json() as Promise<HealthResponse>) : ({ hasData: false as const }))
      .then(d => setHealth(d))
      .catch(() => setHealth({ hasData: false }))
      .finally(() => setHealthLoading(false));
  }, [fetchWithAuth]);

  const healthData = health && health.hasData ? (health as HealthSummaryData) : null;

  return (
    <div className="flex-1 flex flex-col items-center overflow-y-auto px-4 py-8 gap-8" style={{ backgroundColor: "rgb(248,249,251)" }}>

      {/* ── Header ── */}
      <div className="flex flex-col items-center text-center gap-3 max-w-md">
        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center shadow-sm">
          <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div>
          <h2 className="text-2xl font-extrabold text-[#0A2540]">You're All Set!</h2>
          {(clientName || projectTitle) && (
            <p className="text-sm text-muted-foreground mt-0.5">
              {clientName && <span className="font-medium text-[#0A2540]">{clientName}</span>}
              {clientName && projectTitle && <span className="text-gray-400"> · </span>}
              {projectTitle}
            </p>
          )}
          <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
            Your agreement is signed and payment is confirmed. Shane is now setting things up — you'll hear from him within one business day.
          </p>
        </div>
      </div>

      {/* ── Background activity feed ── */}
      <div className="w-full max-w-md bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-[#0078D4] animate-pulse" />
          <span className="text-sm font-semibold text-[#0A2540]">What's happening now</span>
        </div>
        <ul className="divide-y divide-border">
          {BG_TASKS.slice(0, visibleTasks).map((task, i) => (
            <li
              key={i}
              className="px-5 py-3.5 flex items-start gap-3"
              style={{ animation: "fadeSlideIn 0.35s ease both" }}
            >
              <div className="mt-0.5 flex-shrink-0">
                {task.done ? (
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-green-100">
                    <svg className="w-3 h-3 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                ) : (
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#0078D4]/10">
                    <svg className="w-3 h-3 text-[#0078D4] animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  </span>
                )}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#0A2540]">{task.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{task.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* ── Tenant health scores ── */}
      <div className="w-full max-w-md bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <p className="text-sm font-semibold text-[#0A2540]">Your M365 Health Snapshot</p>
          <p className="text-xs text-muted-foreground mt-0.5">Scores from your most recent environment scan</p>
        </div>

        {healthLoading && (
          <div className="flex items-center justify-center py-10">
            <div className="w-6 h-6 border-[3px] border-[#0078D4] border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!healthLoading && !healthData && (
          <div className="px-5 py-8 text-center">
            <svg className="w-8 h-8 mx-auto mb-2 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            <p className="text-sm text-gray-500">Your baseline scan will run as part of onboarding.</p>
          </div>
        )}

        {!healthLoading && healthData && (
          <>
            {/* Overall score bar */}
            <div className="px-5 py-4 flex items-center gap-4 border-b border-border">
              <ScoreRing score={healthData.overallLatest} size={60} />
              <div>
                <p className="text-xs text-gray-500">Overall Health Score</p>
                <p className="text-2xl font-extrabold" style={{ color: scoreColor(healthData.overallLatest) }}>
                  {healthData.overallLatest}<span className="text-sm font-semibold text-gray-400">%</span>
                </p>
                {healthData.overallDelta !== 0 && (
                  <p className="text-xs mt-0.5" style={{ color: healthData.overallDelta > 0 ? "#22c55e" : "#ef4444" }}>
                    {healthData.overallDelta > 0 ? "▲" : "▼"} {Math.abs(healthData.overallDelta)} pts since baseline
                  </p>
                )}
              </div>
            </div>

            {/* Category grid */}
            <div className="grid grid-cols-2 divide-x divide-y divide-border">
              {healthData.categories.map((cat) => (
                <div key={cat.key} className="px-4 py-3 flex items-center gap-3">
                  <ScoreRing score={cat.latestScore} size={44} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1 text-[#0A2540]">
                      {CATEGORY_ICONS[cat.key] ?? null}
                      <span className="text-xs font-semibold truncate">{cat.label}</span>
                    </div>
                    {cat.delta !== 0 && (
                      <p className="text-[10px] mt-0.5" style={{ color: cat.delta > 0 ? "#22c55e" : "#ef4444" }}>
                        {cat.delta > 0 ? "▲" : "▼"} {Math.abs(cat.delta)} pts
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── CTA ── */}
      <button
        onClick={onClose}
        className="px-8 py-3 rounded-xl bg-[#0078D4] text-white font-bold text-sm hover:bg-[#0078D4]/90 shadow-lg shadow-[#0078D4]/20 transition-all"
      >
        Return to Portal
      </button>

      {/* animation keyframes */}
      <style>{`
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
