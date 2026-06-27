import { useState, useEffect } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

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
  if (score >= 70) return "#10B981";
  if (score >= 40) return "#F59E0B";
  return "#EF4444";
}

function ScoreRing({ score, size = 64 }: { score: number; size?: number }) {
  const radius = (size - 8) / 2;
  const circ = 2 * Math.PI * radius;
  const fill = (score / 100) * circ;
  const color = scoreColor(score);
  return (
    <svg width={size} height={size} className="flex-shrink-0">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#30363D" strokeWidth={6} />
      <circle
        cx={size / 2} cy={size / 2} r={radius}
        fill="none"
        stroke={color}
        strokeWidth={6}
        strokeDasharray={`${fill} ${circ}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text
        x="50%" y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={size >= 64 ? 13 : 10}
        fontWeight="700"
        fill={color}
      >
        {score}%
      </text>
    </svg>
  );
}

function DeltaBadge({ delta }: { delta: number }) {
  if (delta === 0) return <span className="text-xs text-[#7D8590]">no change</span>;
  const positive = delta > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs font-bold ${positive ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"}`}>
      {positive ? "▲" : "▼"} {Math.abs(delta)}pts
    </span>
  );
}

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  security: <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>,
  compliance: <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>,
  copilot: <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>,
  governance: <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" /></svg>,
  productivity: <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>,
  identity: <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c0 1.306.835 2.417 2 2.83M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2" /></svg>,
  collaboration: <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>,
  data: <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" /></svg>,
};

interface Props {
  clientId: number;
  fetchWithAuth: (url: string, init?: RequestInit) => Promise<Response>;
}

export default function ClientM365HealthTab({ clientId, fetchWithAuth }: Props) {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchWithAuth(`/api/admin/clients/${clientId}/health/summary`)
      .then(r => r.ok ? r.json() as Promise<HealthResponse> : ({ hasData: false } as HealthResponse))
      .then(setData)
      .catch(() => setData({ hasData: false }))
      .finally(() => setLoading(false));
  }, [clientId, fetchWithAuth]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-7 h-7 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!data || !data.hasData) {
    return (
      <div className="text-center py-12 px-6">
        <svg className="w-12 h-12 mx-auto mb-4 text-[#30363D]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
        <p className="text-sm font-semibold text-[#7D8590] mb-1">No health data yet</p>
        <p className="text-xs text-[#484F58] max-w-xs mx-auto">
          Health snapshots are recorded each time the client saves their M365 profile. Open M365 Intelligence to complete or update the profile.
        </p>
      </div>
    );
  }

  const d = data as HealthSummaryData;
  const alerts = d.categories.filter(c => c.hasAlert);
  const hasHistory = d.overallDelta !== 0 || d.timeSeries.length > 1;
  const overallColor = scoreColor(d.overallLatest);

  return (
    <div className="p-5 space-y-5">
      {/* Overall headline */}
      <div className="bg-[#0D1117] border border-[#30363D] rounded-xl p-5">
        <div className="flex flex-col sm:flex-row sm:items-center gap-5">
          <ScoreRing score={d.overallLatest} size={80} />
          <div className="flex-1">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#7D8590] mb-1">Overall Health Score</p>
                <p className="text-3xl font-extrabold" style={{ color: overallColor }}>
                  {d.overallLatest}<span className="text-lg font-semibold text-[#484F58]">%</span>
                </p>
                {hasHistory && d.overallFirst > 0 && d.overallDelta !== 0 && (
                  <p className="text-xs text-[#7D8590] mt-1">
                    {d.overallDelta > 0 ? "+" : ""}{Math.round((d.overallDelta / d.overallFirst) * 100)}% from baseline
                  </p>
                )}
              </div>
              {hasHistory && (
                <div className="text-right flex-shrink-0">
                  <p className="text-[10px] text-[#7D8590] mb-1">Since baseline</p>
                  <DeltaBadge delta={d.overallDelta} />
                  <p className="text-[10px] text-[#7D8590] mt-1">from {d.overallFirst}%</p>
                </div>
              )}
            </div>
            <p className="text-[10px] text-[#484F58] mt-3">
              Last updated {new Date(d.lastUpdated).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
            </p>
          </div>
        </div>

        {d.timeSeries.length >= 2 && (
          <div className="mt-5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#7D8590] mb-3">Score Trend</p>
            <ResponsiveContainer width="100%" height={100}>
              <LineChart data={d.timeSeries} margin={{ top: 4, right: 8, left: -28, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#21262D" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 9, fill: "#484F58" }}
                  tickFormatter={v => new Date(v + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                />
                <YAxis domain={[0, 100]} tick={{ fontSize: 9, fill: "#484F58" }} />
                <Tooltip
                  formatter={(v: number) => [`${v}%`, "Overall"]}
                  labelFormatter={l => new Date(l + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                  contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #30363D", background: "#161B22", color: "#E6EDF3" }}
                />
                <Line
                  type="monotone"
                  dataKey="score"
                  stroke="#0078D4"
                  strokeWidth={2}
                  dot={{ fill: "#0078D4", r: 3, strokeWidth: 0 }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Category breakdown */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wider text-[#7D8590] mb-3">Category Breakdown</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {d.categories.map(cat => (
            <div
              key={cat.key}
              className={`bg-[#0D1117] rounded-xl border p-4 ${cat.hasAlert ? "border-amber-500/40" : "border-[#30363D]"}`}
            >
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[#0078D4]">{CATEGORY_ICONS[cat.key]}</span>
                <span className="text-xs font-semibold text-[#E6EDF3]">{cat.label}</span>
                {cat.hasAlert && (
                  <span className="ml-auto text-[9px] font-bold uppercase bg-amber-500/15 text-amber-400 px-1.5 py-0.5 rounded-full border border-amber-500/30">Alert</span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <ScoreRing score={cat.latestScore} size={52} />
                <div className="flex-1 min-w-0">
                  {hasHistory && cat.firstScore !== cat.latestScore ? (
                    <>
                      <p className="text-[10px] text-[#7D8590]">Start → Now</p>
                      <p className="text-xs font-bold text-[#E6EDF3]">{cat.firstScore}% → {cat.latestScore}%</p>
                      <div className="mt-1">
                        <DeltaBadge delta={cat.delta} />
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="text-[10px] text-[#7D8590]">Current score</p>
                      <p className="text-xs font-bold text-[#E6EDF3]">{cat.latestScore}%</p>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 30-day alerts */}
      {alerts.length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-[#7D8590] mb-3">30-Day Alerts</p>
          <div className="bg-amber-500/8 border border-amber-500/30 rounded-xl p-4 space-y-2">
            <p className="text-[10px] text-amber-400 font-medium mb-2">
              {alerts.length} {alerts.length === 1 ? "category has" : "categories have"} moved ≥10 points in the last 30 days.
            </p>
            {alerts.map(cat => (
              <div key={cat.key} className="flex items-center gap-3 bg-[#161B22] rounded-lg px-3 py-2 border border-amber-500/20">
                <span className="text-amber-500">{CATEGORY_ICONS[cat.key]}</span>
                <span className="text-xs font-semibold text-[#E6EDF3] flex-1">{cat.label}</span>
                <DeltaBadge delta={cat.delta} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
