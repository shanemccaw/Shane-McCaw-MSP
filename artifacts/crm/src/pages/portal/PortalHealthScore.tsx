import { useState, useEffect } from "react";
import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import PortalLayout from "@/components/PortalLayout";
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

interface HealthSummary {
  hasData: false;
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

type HealthResponse = HealthSummary | HealthSummaryData;

function scoreColor(score: number) {
  if (score >= 70) return "#22c55e";
  if (score >= 40) return "#f59e0b";
  return "#ef4444";
}

function ScoreRing({ score, size = 64 }: { score: number; size?: number }) {
  const radius = (size - 8) / 2;
  const circ = 2 * Math.PI * radius;
  const fill = (score / 100) * circ;
  const color = scoreColor(score);
  return (
    <svg width={size} height={size} className="flex-shrink-0">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#e5e7eb" strokeWidth={6} />
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
        fontSize={size >= 64 ? 14 : 11}
        fontWeight="700"
        fill={color}
      >
        {score}%
      </text>
    </svg>
  );
}

function DeltaBadge({ delta }: { delta: number }) {
  if (delta === 0) return <span className="text-xs text-gray-400">no change</span>;
  const positive = delta > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs font-bold ${positive ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
      {positive ? "▲" : "▼"} {Math.abs(delta)}pts
    </span>
  );
}

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  security: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>,
  compliance: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>,
  copilot: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>,
  governance: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" /></svg>,
  productivity: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>,
  identity: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c0 1.306.835 2.417 2 2.83M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2" /></svg>,
  collaboration: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>,
  data: <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" /></svg>,
};

export default function PortalHealthScore() {
  const { fetchWithAuth } = useAuth();
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchWithAuth("/api/portal/health/summary")
      .then(r => r.ok ? r.json() as Promise<HealthResponse> : { hasData: false as const })
      .then(setData)
      .catch(() => setData({ hasData: false }))
      .finally(() => setLoading(false));
  }, [fetchWithAuth]);

  return (
    <PortalLayout>
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
        <div>
          <Link href="/portal" className="text-sm text-[#0078D4] hover:underline">← Dashboard</Link>
          <h1 className="text-2xl font-bold text-[#0A2540] mt-2">M365 Environment Health</h1>
          <p className="text-gray-500 text-sm mt-1">Track your Microsoft 365 security and readiness over time.</p>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && (!data || !data.hasData) && (
          <div className="bg-white rounded-2xl border border-border p-10 text-center">
            <svg className="w-12 h-12 mx-auto mb-4 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            <h2 className="text-lg font-semibold text-[#0A2540] mb-2">No health data yet</h2>
            <p className="text-gray-500 text-sm mb-6 max-w-sm mx-auto">
              Complete your M365 profile and save it to generate your first health snapshot.
            </p>
            <Link href="/portal/m365-profile">
              <button className="px-5 py-2.5 bg-[#0078D4] text-white rounded-xl text-sm font-semibold hover:bg-[#005fa3] transition-colors">
                Go to M365 Profile →
              </button>
            </Link>
          </div>
        )}

        {!loading && data && data.hasData && (() => {
          const d = data as HealthSummaryData;
          const alerts = d.categories.filter(c => c.hasAlert);
          const hasHistory = d.overallDelta !== 0 || d.timeSeries.length > 1;
          const overallColor = scoreColor(d.overallLatest);

          return (
            <div className="space-y-6">
              {/* Overall headline */}
              <div className="bg-white rounded-2xl border border-border p-6">
                <div className="flex flex-col sm:flex-row sm:items-center gap-6">
                  <ScoreRing score={d.overallLatest} size={88} />
                  <div className="flex-1">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium text-gray-500 mb-1">Overall Health Score</p>
                        <p className="text-4xl font-extrabold" style={{ color: overallColor }}>
                          {d.overallLatest}<span className="text-xl font-semibold text-gray-400">%</span>
                        </p>
                        {hasHistory && d.overallFirst > 0 && d.overallDelta !== 0 && (
                          <p className="text-sm text-gray-500 mt-1">
                            {d.overallDelta > 0 ? "+" : ""}{Math.round((d.overallDelta / d.overallFirst) * 100)}% from baseline
                          </p>
                        )}
                      </div>
                      {hasHistory && (
                        <div className="text-right flex-shrink-0">
                          <p className="text-xs text-gray-400 mb-1">Since baseline</p>
                          <DeltaBadge delta={d.overallDelta} />
                          <p className="text-xs text-gray-400 mt-1">from {d.overallFirst}%</p>
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 mt-3">
                      Last updated {new Date(d.lastUpdated).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                    </p>
                  </div>
                </div>

                {d.timeSeries.length >= 2 && (
                  <div className="mt-6">
                    <p className="text-xs font-medium text-gray-500 mb-3">Score trend</p>
                    <ResponsiveContainer width="100%" height={120}>
                      <LineChart data={d.timeSeries} margin={{ top: 4, right: 8, left: -24, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis
                          dataKey="date"
                          tick={{ fontSize: 10, fill: "#9ca3af" }}
                          tickFormatter={v => new Date(v + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        />
                        <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "#9ca3af" }} />
                        <Tooltip
                          formatter={(v: number) => [`${v}%`, "Overall"]}
                          labelFormatter={l => new Date(l + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                          contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
                        />
                        <Line
                          type="monotone"
                          dataKey="score"
                          stroke="#0078D4"
                          strokeWidth={2.5}
                          dot={{ fill: "#0078D4", r: 4, strokeWidth: 0 }}
                          activeDot={{ r: 6 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              {/* Category breakdown */}
              <div>
                <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Category Breakdown</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {d.categories.map(cat => (
                    <div
                      key={cat.key}
                      className={`bg-white rounded-2xl border p-5 ${cat.hasAlert ? "border-amber-300" : "border-border"}`}
                    >
                      <div className="flex items-center gap-2 mb-4">
                        <span className="text-[#0078D4]">{CATEGORY_ICONS[cat.key]}</span>
                        <span className="text-sm font-semibold text-[#0A2540]">{cat.label}</span>
                        {cat.hasAlert && (
                          <span className="ml-auto text-[10px] font-bold uppercase bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">Alert</span>
                        )}
                      </div>
                      <div className="flex items-center gap-4">
                        <ScoreRing score={cat.latestScore} size={56} />
                        <div className="flex-1 min-w-0">
                          {hasHistory && cat.firstScore !== cat.latestScore ? (
                            <>
                              <p className="text-xs text-gray-400">Start → Now</p>
                              <p className="text-sm font-bold text-[#0A2540]">{cat.firstScore}% → {cat.latestScore}%</p>
                              <div className="mt-1">
                                <DeltaBadge delta={cat.delta} />
                              </div>
                            </>
                          ) : (
                            <>
                              <p className="text-xs text-gray-400">Current score</p>
                              <p className="text-sm font-bold text-[#0A2540]">{cat.latestScore}%</p>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Alerts section */}
              {alerts.length > 0 && (
                <div>
                  <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">30-Day Alerts</h2>
                  <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 space-y-3">
                    <p className="text-xs text-amber-700 font-medium mb-2">
                      {alerts.length} {alerts.length === 1 ? "category has" : "categories have"} moved ≥10 points in the last 30 days.
                    </p>
                    {alerts.map(cat => (
                      <div key={cat.key} className="flex items-center gap-3 bg-white rounded-xl px-4 py-3 border border-amber-100">
                        <span className="text-amber-600">{CATEGORY_ICONS[cat.key]}</span>
                        <span className="text-sm font-semibold text-[#0A2540] flex-1">{cat.label}</span>
                        <DeltaBadge delta={cat.delta} />
                      </div>
                    ))}
                    <p className="text-xs text-amber-600 mt-2 pt-2 border-t border-amber-200">
                      Review your M365 profile to understand what changed.{" "}
                      <Link href="/portal/m365-profile" className="underline font-medium">Update profile →</Link>
                    </p>
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </div>
    </PortalLayout>
  );
}
