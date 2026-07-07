import { useEffect, useState, useCallback, useRef } from "react";
import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, Legend, LineChart, Line, RadarChart, Radar, PolarGrid,
  PolarAngleAxis, PolarRadiusAxis, AreaChart, Area, FunnelChart, Funnel, LabelList,
  ComposedChart, ReferenceLine,
} from "recharts";

// ── Types ──────────────────────────────────────────────────────────────────────

interface OverviewData {
  clientCount: number;
  leadCount: number;
  openLeadCount: number;
  staleLeadCount: number;
  leadsByStage: { Cold: number; Warm: number; Proposal: number; Negotiation: number; Won: number };
  velocityTrend: Array<{ month: string; qualified: number; total: number }>;
  activeProjectCount: number;
  mrr: number;
  arr: number;
  totalRevenuePaid: number;
  invoicePaidRevenue: number;
  purchaseRevenue: number;
  totalRevenueOutstanding: number;
  unpaidInvoiceCount: number;
  unpaidInvoiceValue: number;
  dueInvoiceCount: number;
  overdueInvoiceCount: number;
  overdueInvoiceValue: number;
  clientsWithoutProjectsCount: number;
  revenueByMonth: Array<{ month: string; oneTime: number; recurring: number }>;
  revenueTrend: { currentMonth: number; prevMonth: number };
  ytdRevenue: number;
  topInvoiceServices: Array<{ name: string; revenue: number }>;
  recentActivity: Array<{ type: string; title: string; timestamp: string; linkPath?: string }>;
  recentStatusReports: Array<{
    id: number; title: string; period: string; reportStatus: string;
    clientName: string | null; projectTitle: string | null;
    sentAt: string | null; updatedAt: string;
  }>;
  activeProjects: Array<{
    id: number; title: string; clientName: string | null;
    status: string; phase: string | null; progress: number; endDate: string | null;
  }>;
  currQuarterAvgDeal: number;
  mrrTrend: { current: number; threeMonthsAgo: number };
  burndown: Array<{ date: string; completed: number; remaining: number }>;
  weeklyCompletions: number[];
  taskStats: {
    completedThisWeek: number; createdThisWeek: number;
    overdueProjectCount: number; avgProjectDurationDays: number;
    projectVelocityScore: number; avgProgress: number;
  };
  pendingQuestions?: Array<{
    id: number; title: string; clientQuestion: string | null;
    projectId: number | null; projectTitle: string | null;
    clientName: string; updatedAt: string;
  }>;
}

interface ClientHealth {
  id: number;
  name: string | null;
  email: string;
  company: string | null;
  governanceScore: number | null;
  securityScore: number | null;
  complianceScore: number | null;
  copilotReadinessScore: number | null;
  powerPlatformScore: number | null;
  externalSharingScore: number | null;
  shadowItScore: number | null;
  activeProjectCount: number;
}

interface AiInsight { title: string; narrative: string; metric: string }

interface NbaAction {
  id: number;
  entityType: string;
  entityId: number | null;
  entityName: string | null;
  action: string;
  rationale: string | null;
  confidence: number;
  linkPath: string | null;
  resolvedAt: string | null;
  generatedAt: string;
}

interface ForecastRow { period: string; forecast: number; lowerBound: number; upperBound: number }
interface RevenueForecast { rows: ForecastRow[]; narrative: string | null; generatedAt: string | null }

interface HealthAlert {
  clientId: number;
  clientName: string;
  company: string | null;
  category: string;
  latestScore: number;
  earliestScore: number;
  delta: number;
}

interface DbStatusDev { appliedCount: number; lastAppliedTag: string | null; lastAppliedAt: string | null; pendingCount: number; pendingTags: string[] }
interface DbStatusProdAvailable { available: true; appliedCount: number; lastAppliedTag: string | null; lastAppliedAt: string | null; pendingCount: number; pendingTags: string[] }
interface DbStatusProdUnavailable { available: false; reason: string }
type DbStatusProd = DbStatusProdAvailable | DbStatusProdUnavailable;
interface DbStatus { journalCount: number; dev: DbStatusDev; prod: DbStatusProd }
interface ExpiringCredItem { id: number; displayName: string; clientUserId: number | null; expiresOn: string }
interface ExpiringCredSummary { count: number; items: ExpiringCredItem[] }

interface StalledScriptCard {
  id: number;
  title: string;
  completionStatus: string;
  completionNotes: string | null;
  column: string;
  updatedAt: string;
  projectId: number | null;
  projectTitle: string | null;
  clientName: string | null;
}
interface StalledScriptsSummary { count: number; cards: StalledScriptCard[] }

// ── Constants ──────────────────────────────────────────────────────────────────

// 8 categories: 7 from DB + Identity (shown as null — requires future M365 identity profile data)
const HEALTH_CATS: Array<{ key: keyof ClientHealth | "identityScore"; label: string; abbr: string }> = [
  { key: "governanceScore", label: "Governance", abbr: "Gov" },
  { key: "securityScore", label: "Security", abbr: "Sec" },
  { key: "complianceScore", label: "Compliance", abbr: "Comp" },
  { key: "copilotReadinessScore", label: "Copilot", abbr: "Cop" },
  { key: "powerPlatformScore", label: "Power Platform", abbr: "PP" },
  { key: "externalSharingScore", label: "Sharing Risk", abbr: "Shr" },
  { key: "shadowItScore", label: "Shadow IT", abbr: "SIT" },
  { key: "identityScore", label: "Identity", abbr: "ID" },
];

const AI_COLORS: Record<number, string> = {
  0: "text-[#0078D4] bg-[#0078D4]/10 border-[#0078D4]/20",
  1: "text-purple-400 bg-purple-500/10 border-purple-500/20",
  2: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  3: "text-amber-400 bg-amber-500/10 border-amber-500/20",
};

const AI_ICON_PATHS: Record<number, string> = {
  0: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4",
  1: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z",
  2: "M13 7h8m0 0v8m0-8l-8 8-4-4-6 6",
  3: "M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
};

const PIPELINE_STAGES = [
  { key: "Lead" as const, color: "bg-purple-500", ring: "ring-purple-500/30" },
  { key: "Qualified" as const, color: "bg-[#0078D4]", ring: "ring-[#0078D4]/30" },
  { key: "Proposal" as const, color: "bg-teal-500", ring: "ring-teal-500/30" },
  { key: "Negotiation" as const, color: "bg-amber-500", ring: "ring-amber-500/30" },
  { key: "Won" as const, color: "bg-emerald-500", ring: "ring-emerald-500/30" },
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${Math.round(n).toLocaleString()}`;
}

function trendPct(current: number, prev: number) {
  if (prev === 0) return null;
  return Math.round(((current - prev) / prev) * 100);
}

function timeAgo(ts: string) {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function healthColor(score: number | null): string {
  if (score === null) return "bg-[#30363D]";
  if (score >= 70) return "bg-emerald-500";
  if (score >= 40) return "bg-amber-500";
  return "bg-red-500";
}

function healthTextColor(score: number | null): string {
  if (score === null) return "text-[#484F58]";
  if (score >= 70) return "text-emerald-400";
  if (score >= 40) return "text-amber-400";
  return "text-red-400";
}

function getClientScore(client: ClientHealth, key: string): number | null {
  if (key === "identityScore") return null; // not yet in DB schema
  return (client as unknown as Record<string, number | null>)[key] ?? null;
}

// ── Subcomponents ──────────────────────────────────────────────────────────────

function TrendBadge({ current, prev }: { current: number; prev: number }) {
  const pct = trendPct(current, prev);
  if (pct === null) return null;
  const up = pct >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${up ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"}`}>
      <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
        <path strokeLinecap="round" strokeLinejoin="round" d={up ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"} />
      </svg>
      {Math.abs(pct)}%
    </span>
  );
}

function SectionError({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-400">
      <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      {message}
    </div>
  );
}

function SkeletonCard({ h = "h-24" }: { h?: string }) {
  return <div className={`${h} bg-[#1C2128] border border-[#30363D] rounded-xl animate-pulse`} />;
}

function MiniSparkline({ data, color = "#0078D4" }: { data: number[]; color?: string }) {
  if (data.length < 2) return null;
  const chartData = data.map((v, i) => ({ i, v }));
  return (
    <ResponsiveContainer width={64} height={28}>
      <LineChart data={chartData} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
        <Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function ActivityIcon({ type }: { type: string }) {
  const cls = "w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0";
  const icons: Record<string, { bg: string; color: string; path: string }> = {
    lead: { bg: "bg-purple-500/15", color: "text-purple-400", path: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" },
    purchase: { bg: "bg-emerald-500/15", color: "text-emerald-400", path: "M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" },
    message: { bg: "bg-[#0078D4]/15", color: "text-[#58A6FF]", path: "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" },
    project: { bg: "bg-teal-500/15", color: "text-teal-400", path: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" },
    runbook: { bg: "bg-orange-500/15", color: "text-orange-400", path: "M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" },
    task: { bg: "bg-sky-500/15", color: "text-sky-400", path: "M5 13l4 4L19 7" },
    assessment: { bg: "bg-violet-500/15", color: "text-violet-400", path: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" },
    workflow: { bg: "bg-cyan-500/15", color: "text-cyan-400", path: "M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" },
  };
  const icon = icons[type] ?? icons.project!;
  return (
    <div className={`${cls} ${icon.bg}`}>
      <svg className={`w-3.5 h-3.5 ${icon.color}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d={icon.path} />
      </svg>
    </div>
  );
}

// ── AI Insights Panel ──────────────────────────────────────────────────────────

function AiInsightsPanel({ insights, loading, error, onRefresh }: {
  insights: AiInsight[] | null; loading: boolean; error: string | null; onRefresh: () => void;
}) {
  return (
    <section className="bg-[#0D1117] border border-[#30363D] rounded-xl p-5">
      <div className="flex items-center justify-between flex-wrap gap-4 mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-[#0078D4]/15 flex items-center justify-center">
            <svg className="w-3.5 h-3.5 text-[#58A6FF]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          </div>
          <div>
            <h2 className="text-sm font-bold text-[#E6EDF3]">AI Insights</h2>
            <p className="text-[10px] text-[#7D8590]">Claude-generated · live pipeline, health &amp; project data</p>
          </div>
        </div>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs font-semibold text-[#58A6FF] hover:text-[#0078D4] disabled:opacity-50 disabled:cursor-not-allowed transition-colors px-3 py-1.5 rounded-lg border border-[#30363D] hover:border-[#0078D4]/30 bg-[#161B22]"
        >
          <svg className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          {loading ? "Generating…" : "Refresh"}
        </button>
      </div>
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} h="h-36" />)}
        </div>
      ) : error ? (
        <SectionError message={`AI insights unavailable: ${error}`} />
      ) : insights && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {insights.map((card, i) => (
            <div key={i} className={`border rounded-xl p-4 flex flex-col gap-2 ${AI_COLORS[i] ?? AI_COLORS[0]!}`}>
              <div className="flex items-start gap-2.5">
                <div className="w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center bg-black/20">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d={AI_ICON_PATHS[i] ?? AI_ICON_PATHS[0]!} />
                  </svg>
                </div>
                <p className="text-xs font-bold leading-tight">{card.title}</p>
              </div>
              <p className="text-[11px] leading-relaxed opacity-85 whitespace-pre-line">{card.narrative}</p>
              <div className="mt-auto pt-1">
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-black/20 opacity-90">{card.metric}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── Revenue Trends ─────────────────────────────────────────────────────────────

function RevenueTrendsSection({ data, loading, error }: { data: OverviewData | null; loading: boolean; error: string | null }) {
  const lineData = data?.revenueByMonth.map(m => ({
    month: m.month,
    total: Math.round((m.oneTime + m.recurring) * 100) / 100,
  })) ?? [];

  const peakMonth = lineData.length > 0 ? lineData.reduce((a, b) => a.total > b.total ? a : b) : null;
  const topSvc = data?.topInvoiceServices[0] ?? null;
  const totalInvoiceSvcRevenue = data?.topInvoiceServices.reduce((s, r) => s + r.revenue, 0) ?? 0;

  // Revenue callout: MTD vs 12-month average
  const monthlyAvg = lineData.length > 0
    ? lineData.slice(0, 11).reduce((s, m) => s + m.total, 0) / Math.max(1, lineData.slice(0, 11).filter(m => m.total > 0).length)
    : 0;
  const mtdVsAvgPct = monthlyAvg > 0 && data
    ? Math.round(((data.revenueTrend.currentMonth - monthlyAvg) / monthlyAvg) * 100)
    : null;

  // Service callout: concentration risk
  const concentrationPct = topSvc && totalInvoiceSvcRevenue > 0
    ? Math.round((topSvc.revenue / totalInvoiceSvcRevenue) * 100)
    : null;

  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-sm font-bold text-[#7D8590] uppercase tracking-widest">Revenue Trends</h2>
        <span className="text-xs text-[#484F58]">Trailing 12 months</span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: monthly total line chart */}
        <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-5">
          <p className="text-xs font-bold text-[#E6EDF3] mb-0.5">Monthly Revenue</p>
          <p className="text-[10px] text-[#7D8590] mb-4">Total (one-time + recurring) per month</p>
          {loading ? (
            <div className="h-48 bg-[#1C2128] rounded-lg animate-pulse" />
          ) : error ? (
            <SectionError message="Could not load revenue chart." />
          ) : (
            <ResponsiveContainer width="100%" height={192}>
              <LineChart data={lineData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#30363D" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 9, fill: "#7D8590" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 9, fill: "#7D8590" }} axisLine={false} tickLine={false} tickFormatter={(v: number) => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`} />
                <RechartsTooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #30363D", background: "#1C2128", color: "#E6EDF3" }} formatter={(v: number) => [fmt(v), "Revenue"]} />
                <Line type="monotone" dataKey="total" stroke="#0078D4" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: "#0078D4" }} />
              </LineChart>
            </ResponsiveContainer>
          )}
          {data && (
            <>
              <div className="mt-3 pt-3 border-t border-[#30363D] space-y-1.5">
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <span className="text-[#7D8590]">MTD: <span className="font-bold text-[#E6EDF3]">{fmt(data.revenueTrend.currentMonth)}</span> <TrendBadge current={data.revenueTrend.currentMonth} prev={data.revenueTrend.prevMonth} /></span>
                  <span className="text-[#7D8590]">YTD: <span className="font-bold text-emerald-400">{fmt(data.ytdRevenue)}</span></span>
                </div>
                {peakMonth && peakMonth.total > 0 && (
                  <p className="text-[10px] text-[#7D8590]">Peak: <span className="text-[#E6EDF3] font-semibold">{peakMonth.month}</span> at <span className="text-emerald-400 font-semibold">{fmt(peakMonth.total)}</span></p>
                )}
              </div>
              {/* AI-style callout */}
              {mtdVsAvgPct !== null && (
                <div className="mt-3 flex items-start gap-2 bg-[#0078D4]/10 border border-[#0078D4]/20 rounded-lg p-2.5">
                  <svg className="w-3.5 h-3.5 text-[#58A6FF] flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
                  <p className="text-[11px] text-[#7D8590] leading-relaxed">
                    MTD is <span className={`font-bold ${mtdVsAvgPct >= 0 ? "text-emerald-400" : "text-red-400"}`}>{mtdVsAvgPct >= 0 ? "+" : ""}{mtdVsAvgPct}%</span> vs the 12-month monthly average of <span className="text-[#E6EDF3]">{fmt(monthlyAvg)}</span>.
                    {mtdVsAvgPct < -20 ? " Revenue is tracking below trend — consider accelerating pending invoices." : mtdVsAvgPct > 20 ? " Strong month in progress — lock in deals before month end." : " Revenue is tracking near historical average."}
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Right: invoice revenue by service type */}
        <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-5">
          <p className="text-xs font-bold text-[#E6EDF3] mb-0.5">Invoice Revenue by Service Type</p>
          <p className="text-[10px] text-[#7D8590] mb-4">Paid invoice revenue attributed to each service</p>
          {loading ? (
            <div className="h-48 bg-[#1C2128] rounded-lg animate-pulse" />
          ) : error ? (
            <SectionError message="Could not load service chart." />
          ) : (data?.topInvoiceServices.length ?? 0) === 0 ? (
            <div className="h-48 flex items-center justify-center">
              <p className="text-xs text-[#7D8590]">No invoice revenue data yet.</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={192}>
              <BarChart data={data!.topInvoiceServices} layout="vertical" margin={{ top: 0, right: 8, left: -4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#30363D" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 9, fill: "#7D8590" }} axisLine={false} tickLine={false} tickFormatter={(v: number) => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 9, fill: "#7D8590" }} axisLine={false} tickLine={false} width={96} />
                <RechartsTooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #30363D", background: "#1C2128", color: "#E6EDF3" }} formatter={(v: number) => [fmt(v), "Invoice Revenue"]} />
                <Bar dataKey="revenue" fill="#0078D4" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
          {data && (
            <>
              <div className="mt-3 pt-3 border-t border-[#30363D] space-y-1">
                <div className="flex items-center gap-3 text-xs text-[#7D8590]">
                  <span>MRR: <span className="font-bold text-teal-400">{fmt(data.mrr)}</span></span>
                  <span>ARR: <span className="font-bold text-[#E6EDF3]">{fmt(data.arr)}</span></span>
                </div>
              </div>
              {/* AI-style callout */}
              {concentrationPct !== null && topSvc && (
                <div className="mt-3 flex items-start gap-2 bg-[#0078D4]/10 border border-[#0078D4]/20 rounded-lg p-2.5">
                  <svg className="w-3.5 h-3.5 text-[#58A6FF] flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
                  <p className="text-[11px] text-[#7D8590] leading-relaxed">
                    <span className="text-[#E6EDF3] font-semibold">{topSvc.name}</span> accounts for <span className={`font-bold ${concentrationPct > 60 ? "text-amber-400" : "text-emerald-400"}`}>{concentrationPct}%</span> of attributed invoice revenue ({fmt(topSvc.revenue)}).
                    {concentrationPct > 60 ? " High service concentration — consider diversifying to reduce churn risk." : " Healthy service mix across revenue lines."}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

// ── Pipeline Velocity ──────────────────────────────────────────────────────────

function PipelineSection({ data, loading, error }: { data: OverviewData | null; loading: boolean; error: string | null }) {
  const totalOpen = data
    ? data.leadsByStage.Cold + data.leadsByStage.Warm + data.leadsByStage.Proposal + data.leadsByStage.Negotiation
    : 0;

  const winRate = data && data.leadCount > 0 ? Math.round((data.leadsByStage.Won / Math.max(data.leadCount, 1)) * 100) : 0;
  const pipelineValue = data ? Math.round(totalOpen * Math.max(data.currQuarterAvgDeal, 500)) : 0;
  // Estimated avg sales cycle (assuming 180 days per annual cohort as baseline)
  const avgSalesCycleDays = data && data.leadsByStage.Won > 0
    ? Math.round(180 / Math.max(data.leadsByStage.Won, 1)) : 30;
  // Velocity score formula: Deals × Avg Deal Size × Win Rate / Sales Cycle
  const velocityScore = data
    ? Math.round(
        (data.leadsByStage.Won * Math.max(data.currQuarterAvgDeal, 1) * (winRate / 100)) /
        Math.max(avgSalesCycleDays, 1)
      )
    : 0;

  // Recharts FunnelChart data — each stage as a fill color + count
  const funnelData = data ? [
    { name: "Cold", value: Math.max(data.leadsByStage.Cold, 0), fill: "#8B5CF6" },
    { name: "Warm", value: Math.max(data.leadsByStage.Warm, 0), fill: "#0078D4" },
    { name: "Proposal", value: Math.max(data.leadsByStage.Proposal, 0), fill: "#14B8A6" },
    { name: "Negotiation", value: Math.max(data.leadsByStage.Negotiation, 0), fill: "#F59E0B" },
    { name: "Won", value: Math.max(data.leadsByStage.Won, 0), fill: "#10B981" },
  ] : [];

  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-sm font-bold text-[#7D8590] uppercase tracking-widest">Pipeline Velocity</h2>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: 5-stage Recharts FunnelChart */}
        <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-5">
          <p className="text-xs font-bold text-[#E6EDF3] mb-0.5">CRM Pipeline Funnel</p>
          <p className="text-[10px] text-[#7D8590] mb-4">Cold → Warm → Proposal → Negotiation → Won</p>
          {loading ? (
            <div className="h-48 bg-[#1C2128] rounded-lg animate-pulse" />
          ) : error ? (
            <SectionError message="Could not load funnel." />
          ) : data && (
            <>
              <ResponsiveContainer width="100%" height={192}>
                <FunnelChart margin={{ top: 4, right: 64, bottom: 4, left: 0 }}>
                  <RechartsTooltip
                    contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #30363D", background: "#1C2128", color: "#E6EDF3" }}
                    formatter={(v: number, name: string) => [v, name]}
                  />
                  <Funnel dataKey="value" data={funnelData} isAnimationActive={false} lastShapeType="rectangle">
                    <LabelList position="right" fill="#7D8590" stroke="none" dataKey="name" style={{ fontSize: 10 }} />
                    <LabelList position="center" fill="#fff" stroke="none" dataKey="value" style={{ fontSize: 11, fontWeight: "bold" }} />
                  </Funnel>
                </FunnelChart>
              </ResponsiveContainer>
              {data.staleLeadCount > 0 && (
                <p className="text-xs text-amber-400 font-semibold mt-2">⚠ {data.staleLeadCount} stale leads (&gt;14 days without contact)</p>
              )}
            </>
          )}
        </div>

        {/* Right: velocity trend line chart + 5-metric stats grid */}
        <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-5">
          <p className="text-xs font-bold text-[#E6EDF3] mb-0.5">Qualification Velocity Trend</p>
          <p className="text-[10px] text-[#7D8590] mb-4">Leads qualified per month (Warm/Hot) — last 6 months</p>
          {loading ? (
            <div className="h-36 bg-[#1C2128] rounded-lg animate-pulse mb-4" />
          ) : error ? (
            <SectionError message="Could not load velocity trend." />
          ) : (
            <ResponsiveContainer width="100%" height={140}>
              <LineChart data={data?.velocityTrend ?? []} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#30363D" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 9, fill: "#7D8590" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 9, fill: "#7D8590" }} axisLine={false} tickLine={false} allowDecimals={false} />
                <RechartsTooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #30363D", background: "#1C2128", color: "#E6EDF3" }} />
                <Legend formatter={(v: string) => <span style={{ color: "#7D8590", fontSize: 10 }}>{v === "qualified" ? "Warm/Hot" : "All leads"}</span>} />
                <Line type="monotone" dataKey="total" name="total" stroke="#30363D" strokeWidth={1.5} dot={false} />
                <Line type="monotone" dataKey="qualified" name="qualified" stroke="#0078D4" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: "#0078D4" }} />
              </LineChart>
            </ResponsiveContainer>
          )}
          {data && (
            // 5-metric stats grid including velocity score
            <div className="grid grid-cols-3 gap-2 mt-3">
              {[
                { label: "Pipeline Value", value: fmt(pipelineValue), color: "text-[#0078D4]" },
                { label: "Avg Deal Size", value: fmt(data.currQuarterAvgDeal || 0), color: "text-teal-400" },
                { label: "Win Rate", value: `${winRate}%`, color: winRate >= 20 ? "text-emerald-400" : "text-amber-400" },
                { label: "Sales Cycle", value: `~${avgSalesCycleDays}d`, color: "text-purple-400" },
                {
                  label: "Velocity Score",
                  value: velocityScore > 0 ? `$${velocityScore >= 1000 ? (velocityScore / 1000).toFixed(1) + "k" : velocityScore}/d` : "—",
                  color: velocityScore > 0 ? "text-emerald-400" : "text-[#7D8590]",
                  title: "Deals × Avg Deal × Win Rate ÷ Sales Cycle",
                },
              ].map(m => (
                <div key={m.label} className="bg-[#1C2128] rounded-lg p-2.5" title={"title" in m ? m.title : undefined}>
                  <p className={`text-base font-bold ${m.color}`}>{m.value}</p>
                  <p className="text-[10px] text-[#7D8590] mt-0.5 leading-tight">{m.label}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// ── Client Health Trends ───────────────────────────────────────────────────────

function ClientHealthSection({ clients, loading }: { clients: ClientHealth[] | null; loading: boolean }) {
  // Only score the 7 DB-backed categories for the radar (Identity is null, excluded from avg)
  const DB_CATS = HEALTH_CATS.filter(c => c.key !== "identityScore");
  const clientsWithScores = clients?.filter(c => DB_CATS.some(cat => getClientScore(c, String(cat.key)) !== null)) ?? [];

  // Category stats: avg + std deviation per dimension
  const catStats = DB_CATS.map(cat => {
    const scores = clientsWithScores.map(c => getClientScore(c, String(cat.key))).filter((s): s is number => s !== null);
    const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    const stddev = scores.length >= 2
      ? Math.sqrt(scores.reduce((sum, s) => sum + (s - avg) ** 2, 0) / scores.length)
      : 0;
    return { key: String(cat.key), label: cat.label, avg: Math.round(avg), stddev: Math.round(stddev), count: scores.length };
  });

  const radarData = catStats.map(c => ({ subject: c.label, score: c.avg, fullMark: 100 }));

  const avgOverall = catStats.some(c => c.avg > 0)
    ? Math.round(catStats.filter(c => c.avg > 0).reduce((s, c) => s + c.avg, 0) / catStats.filter(c => c.avg > 0).length)
    : null;

  const scoredCats = catStats.filter(d => d.avg > 0);
  const weakest = scoredCats.length > 0 ? [...scoredCats].sort((a, b) => a.avg - b.avg)[0] : null;
  const strongest = scoredCats.length > 0 ? [...scoredCats].sort((a, b) => b.avg - a.avg)[0] : null;
  // Fastest-improving: highest standard deviation among categories with avg > 40
  // (high variance = wide spread of scores = most active client improvement activity)
  const fastestImproving = scoredCats.filter(c => c.count >= 2 && c.avg > 40)
    .sort((a, b) => b.stddev - a.stddev)[0] ?? null;
  const atRisk = clientsWithScores.filter(c => DB_CATS.some(cat => {
    const s = getClientScore(c, String(cat.key));
    return s !== null && s < 40;
  })).length;

  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-sm font-bold text-[#7D8590] uppercase tracking-widest">Client Health Trends</h2>
        {clients && <span className="text-xs text-[#484F58]">{clientsWithScores.length} clients assessed · 8 dimensions (7 scored + Identity)</span>}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: Radar + AI callout */}
        <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-5">
          <div className="flex items-center justify-between mb-0.5">
            <p className="text-xs font-bold text-[#E6EDF3]">Health Radar (7 Dimensions)</p>
            {avgOverall !== null && <span className={`text-sm font-bold ${healthTextColor(avgOverall)}`}>{avgOverall}/100</span>}
          </div>
          <p className="text-[10px] text-[#7D8590] mb-3">Average scores across all assessed clients</p>
          {loading ? (
            <div className="h-52 bg-[#1C2128] rounded-lg animate-pulse" />
          ) : clientsWithScores.length === 0 ? (
            <div className="h-52 flex items-center justify-center flex-col gap-2">
              <p className="text-xs text-[#7D8590] text-center">No health score data available.<br />Run M365 assessments to populate.</p>
              <Link href="/crm/clients" className="text-xs text-[#58A6FF] font-semibold hover:text-[#0078D4]">Go to Clients →</Link>
            </div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <RadarChart data={radarData} margin={{ top: 8, right: 20, bottom: 8, left: 20 }}>
                  <PolarGrid stroke="#30363D" />
                  <PolarAngleAxis dataKey="subject" tick={{ fontSize: 9, fill: "#7D8590" }} />
                  <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 8, fill: "#484F58" }} />
                  <Radar name="Avg Score" dataKey="score" stroke="#0078D4" fill="#0078D4" fillOpacity={0.2} strokeWidth={2} />
                  <RechartsTooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #30363D", background: "#1C2128", color: "#E6EDF3" }} formatter={(v: number) => [`${v}/100`, "Avg Score"]} />
                </RadarChart>
              </ResponsiveContainer>
              {/* AI-style callout: weakest, strongest, fastest-improving, at-risk */}
              <div className="mt-2 pt-3 border-t border-[#30363D] space-y-1.5">
                {weakest && (
                  <div className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-red-500 mt-1.5 flex-shrink-0" />
                    <p className="text-[11px] text-[#7D8590]">
                      <span className="text-red-400 font-semibold">Weakest: {weakest.label}</span> at avg {weakest.avg}/100 — prioritise improvement conversations here.
                    </p>
                  </div>
                )}
                {strongest && (
                  <div className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 flex-shrink-0" />
                    <p className="text-[11px] text-[#7D8590]">
                      <span className="text-emerald-400 font-semibold">Strongest: {strongest.label}</span> at avg {strongest.avg}/100 — leverage in proposals.
                    </p>
                  </div>
                )}
                {fastestImproving && (
                  <div className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#0078D4] mt-1.5 flex-shrink-0" />
                    <p className="text-[11px] text-[#7D8590]">
                      <span className="text-[#58A6FF] font-semibold">Fastest-improving: {fastestImproving.label}</span> — highest score variance (±{fastestImproving.stddev} pts) signals active client gains in this dimension.
                    </p>
                  </div>
                )}
                {atRisk > 0 && (
                  <div className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1.5 flex-shrink-0" />
                    <p className="text-[11px] text-amber-400 font-semibold">{atRisk} client{atRisk !== 1 ? "s" : ""} have a critical score (&lt;40) in at least one dimension.</p>
                  </div>
                )}
                <div className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#484F58] mt-1.5 flex-shrink-0" />
                  <p className="text-[11px] text-[#484F58]">Identity (8th dimension): requires M365 Identity profile data — not yet collected.</p>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Right: 8-column Heatmap (7 scored + Identity always null) */}
        <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-5">
          <p className="text-xs font-bold text-[#E6EDF3] mb-0.5">Client Health Heatmap (8 Dimensions)</p>
          <p className="text-[10px] text-[#7D8590] mb-3">Score per client × dimension — grey = no data</p>
          {loading ? (
            <div className="h-52 bg-[#1C2128] rounded-lg animate-pulse" />
          ) : clientsWithScores.length === 0 ? (
            <div className="h-52 flex items-center justify-center">
              <p className="text-xs text-[#7D8590] text-center">No health data yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[10px] border-collapse">
                <thead>
                  <tr>
                    <th className="text-left text-[#484F58] font-medium pb-1.5 pr-2 w-20">Client</th>
                    {HEALTH_CATS.map(cat => (
                      <th key={String(cat.key)} className={`text-center text-[10px] font-medium pb-1.5 px-0.5 min-w-[28px] ${cat.key === "identityScore" ? "text-[#30363D]" : "text-[#484F58]"}`} title={cat.label}>
                        {cat.abbr}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {clientsWithScores.slice(0, 8).map(client => (
                    <tr key={client.id}>
                      <td className="pr-2 py-0.5">
                        <span className="text-[#7D8590] truncate block max-w-[76px]" title={client.name ?? client.email}>
                          {client.name ?? client.email.split("@")[0]}
                        </span>
                      </td>
                      {HEALTH_CATS.map(cat => {
                        const score = getClientScore(client, String(cat.key));
                        return (
                          <td key={String(cat.key)} className="px-0.5 py-0.5 text-center">
                            {score !== null ? (
                              <div className={`w-6 h-5 rounded text-[9px] font-bold flex items-center justify-center mx-auto ${healthColor(score)} text-white`} title={`${cat.label}: ${score}`}>
                                {score}
                              </div>
                            ) : (
                              <div className={`w-6 h-5 rounded mx-auto ${cat.key === "identityScore" ? "bg-[#1C2128] border border-dashed border-[#30363D]" : "bg-[#30363D]/40"}`} title={cat.key === "identityScore" ? "Identity: not yet collected" : `${cat.label}: not assessed`} />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              {clientsWithScores.length > 8 && (
                <p className="text-[10px] text-[#484F58] mt-2">+{clientsWithScores.length - 8} more clients</p>
              )}
              <div className="flex items-center gap-3 mt-3 pt-3 border-t border-[#30363D]">
                {[{ bg: "bg-emerald-500", label: "≥70" }, { bg: "bg-amber-500", label: "40–69" }, { bg: "bg-red-500", label: "<40" }].map(l => (
                  <div key={l.label} className="flex items-center gap-1.5">
                    <div className={`w-3 h-3 rounded ${l.bg}`} />
                    <span className="text-[#7D8590]">{l.label}</span>
                  </div>
                ))}
                <Link href="/crm/m365-intelligence" className="ml-auto text-[10px] text-[#58A6FF] hover:text-[#0078D4] font-semibold transition-colors">
                  M365 Intelligence →
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// ── Project Velocity ───────────────────────────────────────────────────────────

function ProjectVelocitySection({ data, loading, error }: { data: OverviewData | null; loading: boolean; error: string | null }) {
  // Burndown: completed tasks daily vs remaining (cumulative created - cumulative completed)
  const burndownChartData = data?.burndown.filter((_, i) => i % 3 === 0 || i === (data.burndown.length - 1)).map(d => ({
    date: d.date.slice(5),
    completed: d.completed,
    remaining: d.remaining,
  })) ?? [];

  const totalCompletedLast30 = data?.burndown.reduce((s, d) => s + d.completed, 0) ?? 0;
  const finalRemaining = data?.burndown.length ? data.burndown[data.burndown.length - 1]!.remaining : 0;
  const totalTasksLast30 = totalCompletedLast30 + finalRemaining;
  const completionRatio = totalTasksLast30 > 0 ? Math.round((totalCompletedLast30 / totalTasksLast30) * 100) : 0;

  const avgProgress = data?.taskStats.avgProgress ?? 0;

  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-sm font-bold text-[#7D8590] uppercase tracking-widest">Project Velocity</h2>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: Burndown over time */}
        <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-5">
          <p className="text-xs font-bold text-[#E6EDF3] mb-0.5">Task Burndown — Last 30 Days</p>
          <p className="text-[10px] text-[#7D8590] mb-4">Tasks completed vs created daily</p>
          {loading ? (
            <div className="h-48 bg-[#1C2128] rounded-lg animate-pulse" />
          ) : error ? (
            <SectionError message="Could not load burndown." />
          ) : totalTasksLast30 === 0 && totalCompletedLast30 === 0 ? (
            <div className="h-48 flex items-center justify-center">
              <p className="text-xs text-[#7D8590]">No task activity in the last 30 days.</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={192}>
              <AreaChart data={burndownChartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradCompleted" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0078D4" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#0078D4" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradCreated" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#7C3AED" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#7C3AED" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#30363D" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#7D8590" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 9, fill: "#7D8590" }} axisLine={false} tickLine={false} allowDecimals={false} />
                <RechartsTooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #30363D", background: "#1C2128", color: "#E6EDF3" }} />
                <Legend formatter={(v: string) => <span style={{ color: "#7D8590", fontSize: 10 }}>{v === "completed" ? "Completed" : "Remaining"}</span>} />
                <Area type="monotone" dataKey="remaining" name="remaining" stroke="#7C3AED" fill="url(#gradCreated)" strokeWidth={1.5} dot={false} />
                <Area type="monotone" dataKey="completed" name="completed" stroke="#0078D4" fill="url(#gradCompleted)" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
          {data && (
            <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-[#30363D]">
              {[
                { label: "Completed this week", value: data.taskStats.completedThisWeek, color: "text-emerald-400" },
                { label: "Created this week", value: data.taskStats.createdThisWeek, color: "text-[#7D8590]" },
                { label: "30d completion rate", value: `${completionRatio}%`, color: completionRatio >= 70 ? "text-emerald-400" : "text-amber-400" },
              ].map(stat => (
                <div key={stat.label} className="bg-[#1C2128] rounded-lg px-2.5 py-1.5">
                  <span className={`text-sm font-bold ${stat.color}`}>{stat.value}</span>
                  <p className="text-[10px] text-[#7D8590] mt-0.5">{stat.label}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: Progress bars + stats chips */}
        <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs font-bold text-[#E6EDF3]">Active Projects</p>
            <Link href="/crm/projects" className="text-xs text-[#58A6FF] hover:text-[#0078D4] font-semibold transition-colors">View all →</Link>
          </div>
          {loading ? (
            <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-8 bg-[#1C2128] rounded animate-pulse" />)}</div>
          ) : error ? (
            <SectionError message="Could not load projects." />
          ) : (data?.activeProjects.length ?? 0) === 0 ? (
            <p className="text-xs text-[#7D8590] text-center py-8">No active projects.</p>
          ) : (
            <>
              <div className="space-y-3">
                {data!.activeProjects.map(proj => {
                  const isOverdue = proj.endDate && new Date(proj.endDate) < new Date();
                  return (
                    <div key={proj.id}>
                      <div className="flex items-center justify-between mb-1">
                        <Link href={`/crm/projects/${proj.id}`} className="text-xs font-medium text-[#E6EDF3] hover:text-[#58A6FF] transition-colors truncate max-w-[160px]">
                          {proj.title}
                        </Link>
                        <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                          {isOverdue && <span className="text-[9px] font-bold text-red-400 bg-red-500/10 px-1 py-0.5 rounded">OVERDUE</span>}
                          <span className="text-xs font-bold text-[#7D8590]">{proj.progress}%</span>
                        </div>
                      </div>
                      <div className="h-1.5 bg-[#30363D] rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${proj.progress >= 75 ? "bg-emerald-500" : proj.progress >= 40 ? "bg-[#0078D4]" : "bg-amber-500"}`}
                          style={{ width: `${proj.progress}%` }}
                        />
                      </div>
                      {proj.clientName && <p className="text-[10px] text-[#484F58] mt-0.5">{proj.clientName}</p>}
                    </div>
                  );
                })}
              </div>
              {/* Stats chips row */}
              <div className="flex flex-wrap items-center gap-3 mt-3 pt-3 border-t border-[#30363D] text-[10px]">
                <div className="bg-[#1C2128] rounded-lg px-2 py-1.5">
                  <span className={`text-sm font-bold ${data!.taskStats.projectVelocityScore >= 60 ? "text-emerald-400" : "text-amber-400"}`}>{data!.taskStats.projectVelocityScore}</span>
                  <p className="text-[#7D8590]">Velocity score</p>
                </div>
                <div className="bg-[#1C2128] rounded-lg px-2 py-1.5">
                  <span className="text-sm font-bold text-[#E6EDF3]">{avgProgress}%</span>
                  <p className="text-[#7D8590]">Avg progress</p>
                </div>
                {data!.taskStats.overdueProjectCount > 0 && (
                  <div className="bg-red-500/10 rounded-lg px-2 py-1.5">
                    <span className="text-sm font-bold text-red-400">{data!.taskStats.overdueProjectCount}</span>
                    <p className="text-[#7D8590]">Overdue</p>
                  </div>
                )}
                <div className="bg-[#1C2128] rounded-lg px-2 py-1.5">
                  <span className="text-sm font-bold text-[#E6EDF3]">{data!.activeProjectCount}</span>
                  <p className="text-[#7D8590]">Active</p>
                </div>
                {data!.taskStats.avgProjectDurationDays > 0 && (
                  <div className="bg-[#1C2128] rounded-lg px-2 py-1.5">
                    <span className="text-sm font-bold text-purple-400">{data!.taskStats.avgProjectDurationDays}d</span>
                    <p className="text-[#7D8590]">Avg age</p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

// ── Recent Reports (DB status reports with client name, date, and SharePoint link) ──

function RecentReportsSection({ reports, loading }: {
  reports: OverviewData["recentStatusReports"] | null;
  loading: boolean;
}) {
  const periodLabel: Record<string, string> = {
    weekly: "Weekly", monthly: "Monthly",
    executive_summary: "Exec Summary", other: "Report",
  };

  return (
    <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-xs font-bold text-[#E6EDF3]">Recent Status Reports</p>
          <p className="text-[10px] text-[#7D8590] mt-0.5">Latest reports — synced to SharePoint Hub</p>
        </div>
        <Link href="/crm/reports" className="text-xs text-[#58A6FF] hover:text-[#0078D4] font-semibold transition-colors">All reports →</Link>
      </div>
      {loading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-11 bg-[#1C2128] rounded animate-pulse" />)}</div>
      ) : !reports || reports.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-xs text-[#7D8590]">No status reports yet.</p>
          <Link href="/crm/reports" className="text-xs text-[#58A6FF] hover:text-[#0078D4] font-semibold mt-1 inline-block">Create a report →</Link>
        </div>
      ) : (
        <div className="space-y-2">
          {reports.map(report => (
            <div key={report.id} className="flex items-start gap-3 py-2 border-b border-[#30363D] last:border-0">
              <div className="w-7 h-7 rounded-lg bg-[#0078D4]/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                <svg className="w-3.5 h-3.5 text-[#58A6FF]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-[#E6EDF3] truncate leading-snug">{report.title}</p>
                <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                  {report.clientName && (
                    <span className="text-[10px] text-[#7D8590] truncate max-w-[110px]">{report.clientName}</span>
                  )}
                  <span className="text-[10px] text-[#484F58]">·</span>
                  <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${report.reportStatus === "sent" ? "bg-emerald-500/15 text-emerald-400" : "bg-[#30363D] text-[#7D8590]"}`}>
                    {report.reportStatus === "sent" ? "Sent" : "Draft"}
                  </span>
                  <span className="text-[9px] text-[#484F58]">{periodLabel[report.period] ?? report.period}</span>
                  <span className="text-[9px] text-[#484F58]">{timeAgo(report.sentAt ?? report.updatedAt)}</span>
                </div>
              </div>
              <div className="flex flex-col items-end gap-1 flex-shrink-0 ml-1">
                <Link href={`/crm/reports/${report.id}`} className="text-[10px] font-semibold text-[#58A6FF] hover:text-[#0078D4] transition-colors">View →</Link>
                <a
                  href="/admin-panel/sharepoint"
                  className="text-[9px] text-[#484F58] hover:text-[#58A6FF] transition-colors flex items-center gap-0.5"
                >
                  <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                  SharePoint
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function OverviewPage() {
  const { fetchWithAuth } = useAuth();

  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [clientsHealth, setClientsHealth] = useState<ClientHealth[] | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);

  const [aiInsights, setAiInsights] = useState<AiInsight[] | null>(null);
  const [aiLoading, setAiLoading] = useState(true);
  const [aiError, setAiError] = useState<string | null>(null);

  const [nbaActions, setNbaActions] = useState<NbaAction[] | null>(null);
  const [nbaLoading, setNbaLoading] = useState(false);
  const [nbaGenerating, setNbaGenerating] = useState(false);
  const [nbaError, setNbaError] = useState<string | null>(null);

  const [revForecast, setRevForecast] = useState<RevenueForecast | null>(null);
  const [revLoading, setRevLoading] = useState(false);
  const [revGenerating, setRevGenerating] = useState(false);

  const [healthAlerts, setHealthAlerts] = useState<HealthAlert[] | null>(null);
  const [healthAlertsLoading, setHealthAlertsLoading] = useState(false);

  const [expiringCreds, setExpiringCreds] = useState<ExpiringCredSummary | null>(null);
  const [stalledScripts, setStalledScripts] = useState<StalledScriptsSummary | null>(null);
  const [dbStatus, setDbStatus] = useState<DbStatus | null>(null);
  const [dbStatusLoading, setDbStatusLoading] = useState(true);
  const [dbStatusError, setDbStatusError] = useState<string | null>(null);
  const [migrating, setMigrating] = useState(false);
  const [migrateOutput, setMigrateOutput] = useState<string[] | null>(null);
  const [migrateError, setMigrateError] = useState<string | null>(null);
  const [showPending, setShowPending] = useState(false);
  const migrateAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    void fetchWithAuth("/api/admin/overview")
      .then(async res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setData(await res.json() as OverviewData);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load overview"))
      .finally(() => setLoading(false));
  }, [fetchWithAuth]);

  useEffect(() => {
    void fetchWithAuth("/api/admin/clients/enriched")
      .then(async res => { if (res.ok) setClientsHealth(await res.json() as ClientHealth[]); })
      .catch(() => null)
      .finally(() => setHealthLoading(false));
  }, [fetchWithAuth]);

  useEffect(() => {
    void fetchWithAuth("/api/admin/azure-credentials/expiring-summary")
      .then(async res => { if (res.ok) setExpiringCreds(await res.json() as ExpiringCredSummary); })
      .catch(() => {});
  }, [fetchWithAuth]);

  useEffect(() => {
    void fetchWithAuth("/api/admin/kanban/stalled-scripts")
      .then(async res => { if (res.ok) setStalledScripts(await res.json() as StalledScriptsSummary); })
      .catch(() => {});
  }, [fetchWithAuth]);

  const fetchDbStatus = useCallback(async () => {
    setDbStatusLoading(true);
    setDbStatusError(null);
    try {
      const res = await fetchWithAuth("/api/admin/db-status");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDbStatus(await res.json() as DbStatus);
    } catch (e) {
      setDbStatusError(e instanceof Error ? e.message : "Failed to load DB status");
    } finally {
      setDbStatusLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => { void fetchDbStatus(); }, [fetchDbStatus]);

  const runMigration = useCallback(async () => {
    setMigrating(true);
    setMigrateOutput(null);
    setMigrateError(null);
    const ac = new AbortController();
    migrateAbortRef.current = ac;
    try {
      const res = await fetchWithAuth("/api/admin/db-migrate", { method: "POST", signal: ac.signal });
      const body = await res.json() as { ok: boolean; output?: string[]; error?: string; code?: number };
      if (body.ok) { setMigrateOutput(body.output ?? []); void fetchDbStatus(); }
      else { setMigrateError(body.error ?? `Exit code ${body.code ?? "?"}`); setMigrateOutput(body.output ?? []); }
    } catch (e) {
      if ((e as { name?: string }).name !== "AbortError") setMigrateError(e instanceof Error ? e.message : "Migration failed");
    } finally { setMigrating(false); }
  }, [fetchWithAuth, fetchDbStatus]);

  const fetchAiInsights = useCallback(async () => {
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await fetchWithAuth("/api/admin/insights", { method: "POST" });
      if (!res.ok) { const b = await res.json() as { error?: string }; throw new Error(b.error ?? `HTTP ${res.status}`); }
      const body = await res.json() as { insights: AiInsight[] };
      setAiInsights(body.insights);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "Failed to generate insights");
    } finally { setAiLoading(false); }
  }, [fetchWithAuth]);

  useEffect(() => { void fetchAiInsights(); }, [fetchAiInsights]);

  const loadNba = useCallback(async () => {
    setNbaLoading(true);
    setNbaError(null);
    try {
      const res = await fetchWithAuth("/api/ai/next-best-actions");
      if (!res.ok) return;
      setNbaActions(await res.json() as NbaAction[]);
    } catch {
      // non-fatal
    } finally { setNbaLoading(false); }
  }, [fetchWithAuth]);

  const generateNba = useCallback(async () => {
    setNbaGenerating(true);
    setNbaError(null);
    try {
      const res = await fetchWithAuth("/api/ai/next-best-actions/generate", { method: "POST" });
      if (!res.ok) { const b = await res.json() as { error?: string }; throw new Error(b.error ?? `HTTP ${res.status}`); }
      await loadNba();
    } catch (e) {
      setNbaError(e instanceof Error ? e.message : "Failed to generate actions");
    } finally { setNbaGenerating(false); }
  }, [fetchWithAuth, loadNba]);

  const resolveNba = useCallback(async (id: number) => {
    await fetchWithAuth(`/api/ai/next-best-actions/${id}/resolve`, { method: "POST" });
    setNbaActions(prev => prev ? prev.filter(a => a.id !== id) : prev);
  }, [fetchWithAuth]);

  const loadForecast = useCallback(async () => {
    setRevLoading(true);
    try {
      const res = await fetchWithAuth("/api/analytics/revenue/forecast");
      if (!res.ok) return;
      setRevForecast(await res.json() as RevenueForecast);
    } catch {
      // non-fatal
    } finally { setRevLoading(false); }
  }, [fetchWithAuth]);

  const generateForecast = useCallback(async () => {
    setRevGenerating(true);
    try {
      const res = await fetchWithAuth("/api/analytics/revenue/forecast/generate", { method: "POST" });
      if (res.ok) setRevForecast(await res.json() as RevenueForecast);
    } catch {
      // non-fatal
    } finally { setRevGenerating(false); }
  }, [fetchWithAuth]);

  const loadHealthAlerts = useCallback(async () => {
    setHealthAlertsLoading(true);
    try {
      const res = await fetchWithAuth("/api/admin/health/alerts");
      if (!res.ok) return;
      setHealthAlerts(await res.json() as HealthAlert[]);
    } catch {
      // non-fatal
    } finally { setHealthAlertsLoading(false); }
  }, [fetchWithAuth]);

  useEffect(() => {
    void loadNba();
    void loadForecast();
    void loadHealthAlerts();
  }, [loadNba, loadForecast, loadHealthAlerts]);

  // KPI sparkline data
  const revenueSparkData = data?.revenueByMonth.slice(-6).map(m => m.oneTime + m.recurring) ?? [];
  const velocitySparkData = data?.velocityTrend.map(v => v.qualified) ?? [];
  const weeklyVelocitySparkData = data?.weeklyCompletions ?? [];

  // Client health avg for KPI card
  const DB_CATS_FOR_AVG = HEALTH_CATS.filter(c => c.key !== "identityScore");
  const clientsWithScores = clientsHealth?.filter(c => DB_CATS_FOR_AVG.some(cat => getClientScore(c, String(cat.key)) !== null)) ?? [];
  const avgHealthScore = clientsWithScores.length > 0
    ? Math.round(clientsWithScores.reduce((sum, c) => {
        const scores = DB_CATS_FOR_AVG.map(cat => getClientScore(c, String(cat.key))).filter((s): s is number => s !== null);
        return sum + (scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0);
      }, 0) / clientsWithScores.length)
    : null;

  // Pipeline sparkline — open lead count trend from velocity trend total
  const pipelineSparkData = data?.velocityTrend.map(v => v.total) ?? [];

  const kpiCards = [
    {
      label: "Revenue",
      value: fmt(data?.revenueTrend.currentMonth ?? 0),
      sub2: data ? `YTD ${fmt(data.ytdRevenue)}` : "Year to date",
      sub: `prev month ${fmt(data?.revenueTrend.prevMonth ?? 0)}`,
      sparkData: revenueSparkData,
      sparkColor: "#10B981",
      hasTrend: true,
      current: data?.revenueTrend.currentMonth ?? 0,
      prev: data?.revenueTrend.prevMonth ?? 0,
      icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
      iconBg: "bg-emerald-500/15", iconColor: "text-emerald-400",
    },
    {
      label: "Pipeline Value",
      value: fmt(data ? ((data.leadsByStage.Cold + data.leadsByStage.Warm + data.leadsByStage.Proposal + data.leadsByStage.Negotiation) * Math.max(data.currQuarterAvgDeal, 500)) : 0),
      sub: `${data?.openLeadCount ?? 0} open · ${(data?.leadsByStage.Proposal ?? 0) + (data?.leadsByStage.Negotiation ?? 0)} Hot`,
      sub2: `${data?.leadsByStage.Negotiation ?? 0} in negotiation`,
      sparkData: pipelineSparkData,
      sparkColor: "#0078D4",
      hasTrend: true,
      // Trend: qualified leads last month vs second-to-last month from velocity trend
      current: data?.velocityTrend.length ? (data.velocityTrend[data.velocityTrend.length - 1]?.qualified ?? 0) : 0,
      prev: data?.velocityTrend.length && data.velocityTrend.length >= 2 ? (data.velocityTrend[data.velocityTrend.length - 2]?.qualified ?? 0) : 0,
      icon: "M13 7h8m0 0v8m0-8l-8 8-4-4-6 6",
      iconBg: "bg-[#0078D4]/15", iconColor: "text-[#58A6FF]",
    },
    {
      label: "Avg Client Health",
      value: avgHealthScore !== null ? `${avgHealthScore}/100` : "—",
      sub: `${clientsWithScores.length} clients assessed`,
      sub2: "7 of 8 dimensions active",
      sparkData: revenueSparkData.map(() => avgHealthScore ?? 0).slice(-4),
      sparkColor: "#00B4D8",
      hasTrend: true,
      // Trend: use MRR growth as portfolio health proxy (health improves with business growth)
      current: data?.mrrTrend.current ?? 0,
      prev: data?.mrrTrend.threeMonthsAgo ?? 0,
      icon: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z",
      iconBg: "bg-teal-500/15", iconColor: "text-teal-400",
      valueColor: avgHealthScore !== null ? healthTextColor(avgHealthScore) : "text-[#E6EDF3]",
    },
    {
      label: "Project Velocity",
      value: `${data?.taskStats.projectVelocityScore ?? 0}/100`,
      sub: `${data?.taskStats.completedThisWeek ?? 0} tasks completed this week`,
      sub2: `${data?.activeProjectCount ?? 0} active · ${data?.taskStats.avgProgress ?? 0}% avg`,
      sparkData: weeklyVelocitySparkData,
      sparkColor: "#7C3AED",
      hasTrend: true,
      // Trend: last week vs first week of 4-week completion window
      current: weeklyVelocitySparkData.length ? (weeklyVelocitySparkData[weeklyVelocitySparkData.length - 1] ?? 0) : 0,
      prev: weeklyVelocitySparkData.length >= 2 ? (weeklyVelocitySparkData[0] ?? 0) : 0,
      icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
      iconBg: "bg-purple-500/15", iconColor: "text-purple-400",
      valueColor: `${(data?.taskStats.projectVelocityScore ?? 0) >= 60 ? "text-emerald-400" : (data?.taskStats.projectVelocityScore ?? 0) >= 30 ? "text-amber-400" : "text-[#E6EDF3]"}`,
    },
  ];

  return (
    <div className="p-4 sm:p-6 max-w-[1400px] space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-[#E6EDF3]">Executive Overview</h1>
        <p className="text-sm text-[#7D8590] mt-0.5">Live command centre — revenue, pipeline velocity, client health &amp; project burndown.</p>
      </div>

      {/* ── KPI Bar ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} h="h-28" />)
        ) : error ? (
          <div className="col-span-4"><SectionError message={`Could not load KPIs: ${error}`} /></div>
        ) : kpiCards.map(card => (
          <div key={card.label} className="bg-[#161B22] border border-[#30363D] rounded-xl p-5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-3 min-w-0">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${card.iconBg}`}>
                  <svg className={`w-4 h-4 ${card.iconColor}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d={card.icon} />
                  </svg>
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-[#7D8590] mb-0.5">{card.label}</p>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className={`text-xl font-bold ${"valueColor" in card ? (card.valueColor as string) : "text-[#E6EDF3]"}`}>{card.value}</p>
                    {card.hasTrend && card.prev > 0 && <TrendBadge current={card.current} prev={card.prev} />}
                  </div>
                  {"sub2" in card && card.sub2 && <p className="text-[10px] text-emerald-400 font-semibold mt-0.5">{card.sub2}</p>}
                  <p className="text-[10px] text-[#484F58] mt-0.5">{card.sub}</p>
                </div>
              </div>
              {card.sparkData.length >= 2 && (
                <div className="flex-shrink-0 mt-1">
                  <MiniSparkline data={card.sparkData} color={card.sparkColor} />
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* ── AI Insights Panel ── */}
      <AiInsightsPanel insights={aiInsights} loading={aiLoading} error={aiError} onRefresh={fetchAiInsights} />

      {/* ── Next Best Actions Panel ── */}
      <section>
        <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-[#0078D4] animate-pulse" />
            <h2 className="text-sm font-bold text-[#7D8590] uppercase tracking-widest">Next Best Actions</h2>
            {nbaActions && nbaActions.length > 0 && (
              <span className="text-xs font-bold bg-[#0078D4]/15 text-[#0078D4] border border-[#0078D4]/20 px-2 py-0.5 rounded-full">{nbaActions.length} pending</span>
            )}
          </div>
          <button
            onClick={() => void generateNba()}
            disabled={nbaGenerating}
            className="flex items-center gap-1.5 text-xs font-semibold bg-[#0078D4] text-white px-3 py-1.5 rounded-lg hover:bg-[#0078D4]/80 disabled:opacity-50 transition-colors"
          >
            {nbaGenerating ? (
              <><svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>Generating…</>
            ) : (
              <><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>Generate Actions</>
            )}
          </button>
        </div>

        {nbaError && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 mb-3 text-xs text-red-400">{nbaError}</div>
        )}

        {nbaLoading ? (
          <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 bg-[#161B22] border border-[#30363D] rounded-xl animate-pulse" />)}</div>
        ) : !nbaActions || nbaActions.length === 0 ? (
          <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-6 flex flex-col items-center text-center">
            <div className="w-10 h-10 rounded-xl bg-[#0078D4]/10 flex items-center justify-center mb-2">
              <svg className="w-5 h-5 text-[#58A6FF]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-[#E6EDF3]">No actions queued</p>
            <p className="text-xs text-[#7D8590] mt-1">Click Generate Actions to have Claude analyse your pipeline, clients, and projects and surface the 5 highest-impact things to do today.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {nbaActions.map(action => {
              const confidenceColor = action.confidence >= 80 ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" :
                action.confidence >= 60 ? "text-[#0078D4] bg-[#0078D4]/10 border-[#0078D4]/20" :
                "text-amber-400 bg-amber-500/10 border-amber-500/20";
              const entityBadgeColor = action.entityType === "client" ? "text-teal-400 bg-teal-500/10" :
                action.entityType === "project" ? "text-purple-400 bg-purple-500/10" :
                action.entityType === "lead" ? "text-amber-400 bg-amber-500/10" :
                action.entityType === "opportunity" ? "text-emerald-400 bg-emerald-500/10" :
                "text-[#7D8590] bg-[#30363D]";
              return (
                <div key={action.id} className="bg-[#161B22] border border-[#30363D] rounded-xl px-4 py-3.5 flex items-start gap-3 hover:border-[#0078D4]/30 transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${entityBadgeColor}`}>{action.entityType}</span>
                      {action.entityName && <span className="text-[10px] font-semibold text-[#E6EDF3]">{action.entityName}</span>}
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${confidenceColor}`}>{action.confidence}% confidence</span>
                    </div>
                    <p className="text-xs text-[#E6EDF3] leading-relaxed">{action.action}</p>
                    {action.rationale && <p className="text-[10px] text-[#7D8590] mt-0.5 leading-relaxed">{action.rationale}</p>}
                  </div>
                  <div className="flex flex-col items-end gap-1.5 flex-shrink-0 ml-2">
                    {action.linkPath && (
                      <Link href={action.linkPath}>
                        <span className="text-[10px] font-semibold text-[#58A6FF] hover:text-[#0078D4] cursor-pointer transition-colors whitespace-nowrap">Go →</span>
                      </Link>
                    )}
                    <button
                      onClick={() => void resolveNba(action.id)}
                      className="text-[10px] font-semibold text-[#484F58] hover:text-emerald-400 border border-[#30363D] hover:border-emerald-500/30 px-2 py-0.5 rounded-lg transition-colors whitespace-nowrap"
                    >
                      ✓ Done
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Health Alerts ── */}
      {healthAlerts && healthAlerts.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <h2 className="text-sm font-bold text-[#7D8590] uppercase tracking-widest">Client Health Alerts</h2>
            <span className="text-xs font-bold bg-red-500/15 text-red-400 border border-red-500/20 px-2 py-0.5 rounded-full">{healthAlerts.length} alert{healthAlerts.length !== 1 ? "s" : ""}</span>
            <span className="text-[10px] text-[#484F58]">≥10pt change in 30 days</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {healthAlerts.slice(0, 9).map((alert, i) => {
              const isDrop = alert.delta < 0;
              const absChange = Math.abs(alert.delta);
              return (
                <div key={i} className={`border rounded-xl px-4 py-3.5 flex items-start gap-3 ${isDrop ? "bg-red-500/8 border-red-500/20" : "bg-emerald-500/8 border-emerald-500/20"}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-sm ${isDrop ? "bg-red-500/15" : "bg-emerald-500/15"}`}>
                    {isDrop ? "↓" : "↑"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <Link href={`/crm/clients/${alert.clientId}`}>
                      <span className={`text-xs font-bold cursor-pointer hover:underline ${isDrop ? "text-red-300" : "text-emerald-300"}`}>
                        {alert.clientName}
                      </span>
                    </Link>
                    {alert.company && <p className="text-[10px] text-[#7D8590]">{alert.company}</p>}
                    <p className={`text-[10px] mt-0.5 font-semibold ${isDrop ? "text-red-400" : "text-emerald-400"}`}>
                      {alert.category} {isDrop ? "dropped" : "improved"} {absChange}pt → {alert.latestScore}/100
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
      {!healthAlertsLoading && healthAlerts && healthAlerts.length === 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm font-bold text-[#7D8590] uppercase tracking-widest">Client Health Alerts</h2>
          </div>
          <div className="bg-emerald-500/5 border border-emerald-500/15 rounded-xl px-4 py-3 flex items-center gap-2">
            <svg className="w-4 h-4 text-emerald-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            <p className="text-xs text-emerald-400">No significant health changes in the last 30 days — all clients are stable.</p>
          </div>
        </section>
      )}

      {/* ── Customer Questions Alert ── */}
      {!loading && !error && data && (data.pendingQuestions?.length ?? 0) > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            <h2 className="text-sm font-bold text-[#7D8590] uppercase tracking-widest">Customer Questions</h2>
            <span className="text-xs font-bold bg-amber-500/15 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-full">{data.pendingQuestions?.length} pending</span>
          </div>
          <div className="space-y-2">
            {data.pendingQuestions?.map(q => (
              <div key={q.id} className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3.5 flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <svg className="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                    <span className="text-xs font-bold text-amber-300">{q.clientName}</span>
                    {q.projectTitle && <><span className="text-amber-500/50">·</span><span className="text-xs text-amber-400">{q.projectTitle}</span></>}
                  </div>
                  {q.clientQuestion && <p className="text-xs text-amber-300/80 leading-relaxed line-clamp-2">{q.clientQuestion}</p>}
                </div>
                {q.projectId && (
                  <Link href={`/crm/projects/${q.projectId}`}>
                    <span className="flex-shrink-0 text-xs font-semibold text-amber-400 border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap cursor-pointer">
                      Go to Project →
                    </span>
                  </Link>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Revenue Trends ── */}
      <RevenueTrendsSection data={data} loading={loading} error={error} />

      {/* ── Pipeline Velocity ── */}
      <PipelineSection data={data} loading={loading} error={error} />

      {/* ── Client Health Trends ── */}
      <ClientHealthSection clients={clientsHealth} loading={healthLoading} />

      {/* ── Project Velocity ── */}
      <ProjectVelocitySection data={data} loading={loading} error={error} />

      {/* ── Revenue Forecast ── */}
      <section>
        <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-[#7D8590] uppercase tracking-widest">12-Month Revenue Forecast</h2>
            <span className="text-[10px] font-semibold text-[#484F58]">AI · linear regression + MRR baseline</span>
          </div>
          <div className="flex items-center gap-2">
            {revForecast?.generatedAt && <span className="text-[10px] text-[#484F58]">Updated {new Date(revForecast.generatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>}
            <button onClick={() => void generateForecast()} disabled={revGenerating} className="flex items-center gap-1.5 text-xs font-semibold text-[#58A6FF] hover:text-[#0078D4] disabled:opacity-50 transition-colors">
              {revGenerating ? <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg> : null}
              {revGenerating ? "Generating…" : revForecast ? "Refresh" : "Generate"}
            </button>
          </div>
        </div>

        {revLoading ? (
          <div className="h-52 bg-[#161B22] border border-[#30363D] rounded-xl animate-pulse" />
        ) : !revForecast || revForecast.rows.length === 0 ? (
          <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-5 flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-[#58A6FF]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-[#E6EDF3]">No forecast generated yet</p>
              <p className="text-xs text-[#7D8590] mt-0.5">Click Generate to have Claude predict the next 12 months from your invoice history and MRR.</p>
            </div>
          </div>
        ) : (
          <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-5">
            {revForecast.narrative && (
              <div className="flex items-start gap-2 bg-[#0078D4]/8 border border-[#0078D4]/20 rounded-xl px-3 py-2.5 mb-4">
                <svg className="w-3.5 h-3.5 text-[#58A6FF] flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                <p className="text-[11px] text-[#E6EDF3]/80 leading-relaxed">{revForecast.narrative}</p>
              </div>
            )}
            <ResponsiveContainer width="100%" height={200}>
              <ComposedChart data={revForecast.rows} margin={{ top: 4, right: 4, left: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="fcastGradOv" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0078D4" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#0078D4" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="bandGradOv" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#7C3AED" stopOpacity={0.12} />
                    <stop offset="95%" stopColor="#7C3AED" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#30363D" vertical={false} />
                <XAxis dataKey="period" tick={{ fontSize: 9, fill: "#7D8590" }} axisLine={false} tickLine={false}
                  tickFormatter={v => { const [,m] = (v as string).split("-"); return ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][parseInt(m)-1] ?? m; }} />
                <YAxis tick={{ fontSize: 9, fill: "#7D8590" }} axisLine={false} tickLine={false}
                  tickFormatter={v => fmt(v as number)} />
                <RechartsTooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #30363D", background: "#1C2128", color: "#E6EDF3" }}
                  formatter={(v: number, name: string) => [fmt(v), name === "forecast" ? "Forecast" : name === "upperBound" ? "Upper" : "Lower"]} />
                <Area type="monotone" dataKey="upperBound" stroke="transparent" fill="url(#bandGradOv)" strokeWidth={0} />
                <Area type="monotone" dataKey="forecast" stroke="#0078D4" fill="url(#fcastGradOv)" strokeWidth={2} dot={false} />
                <Area type="monotone" dataKey="lowerBound" stroke="transparent" fill="transparent" strokeWidth={0} />
                <ReferenceLine y={revForecast.rows[0]?.forecast ?? 0} stroke="#30363D" strokeDasharray="4 4" strokeWidth={1} />
              </ComposedChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap gap-3 mt-3 pt-3 border-t border-[#30363D]">
              {revForecast.rows.slice(0, 3).map(r => (
                <div key={r.period} className="bg-[#1C2128] rounded-lg px-3 py-2">
                  <p className="text-[10px] text-[#7D8590]">{(() => { const [y,m] = r.period.split("-"); return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][parseInt(m)-1]} ${y}`; })()}</p>
                  <p className="text-sm font-bold text-[#E6EDF3]">{fmt(r.forecast)}</p>
                  <p className="text-[10px] text-[#484F58]">{fmt(r.lowerBound)}–{fmt(r.upperBound)}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ── Recent Reports + Activity Feed ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <RecentReportsSection reports={data?.recentStatusReports ?? null} loading={loading} />
        <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-xs font-bold text-[#E6EDF3]">Recent Activity</p>
              <p className="text-[10px] text-[#7D8590] mt-0.5">Leads, purchases, projects, script runs</p>
            </div>
          </div>
          {loading ? (
            <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-10 bg-[#1C2128] rounded-lg animate-pulse" />)}</div>
          ) : error ? (
            <SectionError message="Could not load activity." />
          ) : (data?.recentActivity.length ?? 0) === 0 ? (
            <p className="text-xs text-[#7D8590] text-center py-8">No recent activity yet.</p>
          ) : (
            <div className="space-y-3">
              {data!.recentActivity.map((event, i) => (
                <div key={i} className="flex items-start gap-3">
                  <ActivityIcon type={event.type} />
                  <div className="flex-1 min-w-0">
                    {event.linkPath ? (
                      <Link href={event.linkPath} className="text-xs font-medium text-[#E6EDF3] hover:text-[#58A6FF] transition-colors line-clamp-2 leading-relaxed">{event.title}</Link>
                    ) : (
                      <p className="text-xs font-medium text-[#E6EDF3] line-clamp-2 leading-relaxed">{event.title}</p>
                    )}
                    <p className="text-[10px] text-[#7D8590] mt-0.5">{timeAgo(event.timestamp)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Financial Snapshot ── */}
      <section>
        <h2 className="text-sm font-bold text-[#7D8590] uppercase tracking-widest mb-3">Financial Snapshot</h2>
        {loading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}</div>
        ) : error ? (
          <SectionError message="Could not load financial data." />
        ) : data && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: "Total Revenue", value: data.totalRevenuePaid, sub: `${fmt(data.invoicePaidRevenue)} invoices + ${fmt(data.purchaseRevenue)} purchases`, accent: "border-l-emerald-500", current: data.revenueTrend.currentMonth, prev: data.revenueTrend.prevMonth },
              { label: "Outstanding", value: data.totalRevenueOutstanding, sub: data.overdueInvoiceCount > 0 ? `${data.overdueInvoiceCount} overdue` : "None overdue", accent: data.overdueInvoiceCount > 0 ? "border-l-red-500" : "border-l-amber-500", current: 0, prev: 0 },
              { label: "MRR", value: data.mrr, sub: "Monthly recurring revenue", accent: "border-l-[#0078D4]", current: data.mrrTrend.current, prev: data.mrrTrend.threeMonthsAgo },
              { label: "Projected ARR", value: data.arr, sub: "MRR × 12", accent: "border-l-teal-500", current: 0, prev: 0 },
            ].map(card => (
              <div key={card.label} className={`bg-[#161B22] border border-[#30363D] border-l-4 ${card.accent} rounded-xl p-5`}>
                <p className="text-[10px] text-[#7D8590] font-bold uppercase tracking-widest mb-1">{card.label}</p>
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-2xl font-bold text-[#E6EDF3]">{fmt(card.value)}</p>
                  {card.prev > 0 && <TrendBadge current={card.current} prev={card.prev} />}
                </div>
                <p className="text-xs text-[#7D8590]">{card.sub}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Expiring Credentials ── */}
      {expiringCreds && expiringCreds.count > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <h2 className="text-sm font-bold text-[#7D8590] uppercase tracking-widest">Expiring Credentials</h2>
            <span className="text-xs font-bold bg-red-500/15 text-red-400 border border-red-500/20 px-2 py-0.5 rounded-full">{expiringCreds.count} expiring soon</span>
          </div>
          <div className="space-y-2">
            {expiringCreds.items.map(cred => {
              const days = Math.ceil((new Date(cred.expiresOn).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
              const expired = days <= 0;
              const isUrgent = expired || days <= 14;
              return (
                <div key={cred.id} className={`border rounded-xl px-4 py-3.5 flex items-center gap-3 ${isUrgent ? "bg-red-500/10 border-red-500/20" : "bg-amber-500/10 border-amber-500/20"}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${isUrgent ? "bg-red-500/20" : "bg-amber-500/20"}`}>
                    <svg className={`w-4 h-4 ${isUrgent ? "text-red-400" : "text-amber-400"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className={`text-xs font-bold ${isUrgent ? "text-red-300" : "text-amber-300"}`}>{cred.displayName}</span>
                    <p className={`text-[11px] mt-0.5 ${isUrgent ? "text-red-400" : "text-amber-400"}`}>
                      {expired ? `Expired — Script Runner will fail` : `Expires in ${days} day${days !== 1 ? "s" : ""} — ${new Date(cred.expiresOn).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`}
                    </p>
                  </div>
                  {cred.clientUserId && (
                    <Link href={`/crm/clients/${cred.clientUserId}`}>
                      <span className={`flex-shrink-0 text-xs font-semibold border px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap cursor-pointer ${isUrgent ? "text-red-400 border-red-500/30 bg-red-500/10 hover:bg-red-500/20" : "text-amber-400 border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20"}`}>
                        Go to Client →
                      </span>
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Stalled Scripts ── */}
      {stalledScripts && stalledScripts.count > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <h2 className="text-sm font-bold text-[#7D8590] uppercase tracking-widest">Stalled Scripts</h2>
            <span className="text-xs font-bold bg-red-500/15 text-red-400 border border-red-500/20 px-2 py-0.5 rounded-full">
              {stalledScripts.count} card{stalledScripts.count !== 1 ? "s" : ""} need attention
            </span>
          </div>
          <div className="space-y-2">
            {stalledScripts.cards.map(card => {
              const isExhausted = card.completionStatus === "auto_fire_exhausted";
              return (
                <div
                  key={card.id}
                  className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3.5 flex items-start gap-3"
                >
                  <div className="w-9 h-9 rounded-xl bg-red-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-red-300 truncate">{card.title}</span>
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${isExhausted ? "bg-red-500/20 text-red-400" : "bg-amber-500/20 text-amber-400"}`}>
                        {isExhausted ? "Retry budget exhausted" : "Auto-fire failed"}
                      </span>
                    </div>
                    {card.projectTitle && (
                      <p className="text-[11px] text-red-400 mt-0.5">
                        {card.projectTitle}{card.clientName ? ` · ${card.clientName}` : ""}
                      </p>
                    )}
                    {card.completionNotes && (
                      <p className="text-[10px] text-[#7D8590] mt-1 line-clamp-2">{card.completionNotes}</p>
                    )}
                    <p className="text-[10px] text-[#484F58] mt-1">Last updated {timeAgo(card.updatedAt)}</p>
                  </div>
                  {card.projectId && (
                    <Link href={`/crm/projects/${card.projectId}`}>
                      <span className="flex-shrink-0 text-xs font-semibold border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-red-400 px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap cursor-pointer">
                        View Board →
                      </span>
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Outstanding Actions ── */}
      {!loading && !error && data && (data.unpaidInvoiceCount > 0 || data.staleLeadCount > 0 || data.clientsWithoutProjectsCount > 0) && (
        <section>
          <h2 className="text-sm font-bold text-[#7D8590] uppercase tracking-widest mb-3">Outstanding Actions</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {data.unpaidInvoiceCount > 0 && (
              <div className={`border rounded-xl p-4 flex items-start gap-3 ${data.overdueInvoiceCount > 0 ? "bg-red-500/10 border-red-500/20" : "bg-amber-500/10 border-amber-500/20"}`}>
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${data.overdueInvoiceCount > 0 ? "bg-red-500/20" : "bg-amber-500/20"}`}>
                  <svg className={`w-5 h-5 ${data.overdueInvoiceCount > 0 ? "text-red-400" : "text-amber-400"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <p className={`text-sm font-bold ${data.overdueInvoiceCount > 0 ? "text-red-300" : "text-amber-300"}`}>{data.unpaidInvoiceCount} invoice{data.unpaidInvoiceCount !== 1 ? "s" : ""} need payment</p>
                  <p className={`text-xs mt-0.5 ${data.overdueInvoiceCount > 0 ? "text-red-400" : "text-amber-400"}`}>{fmt(data.unpaidInvoiceValue)} total{data.overdueInvoiceCount > 0 && ` · ${data.overdueInvoiceCount} overdue`}</p>
                  <Link href="/crm/invoices" className={`text-xs font-semibold mt-2 inline-block ${data.overdueInvoiceCount > 0 ? "text-red-400 hover:text-red-300" : "text-amber-400 hover:text-amber-300"}`}>View invoices →</Link>
                </div>
              </div>
            )}
            {data.staleLeadCount > 0 && (
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold text-amber-300">{data.staleLeadCount} stale lead{data.staleLeadCount !== 1 ? "s" : ""}</p>
                  <p className="text-xs text-amber-400 mt-0.5">No activity in over 14 days</p>
                  <Link href="/crm/leads" className="text-xs text-amber-400 font-semibold hover:text-amber-300 mt-2 inline-block">View leads →</Link>
                </div>
              </div>
            )}
            {data.clientsWithoutProjectsCount > 0 && (
              <div className="bg-[#0078D4]/10 border border-[#0078D4]/20 rounded-xl p-4 flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-[#0078D4]/15 flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-[#58A6FF]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold text-[#E6EDF3]">{data.clientsWithoutProjectsCount} client{data.clientsWithoutProjectsCount !== 1 ? "s" : ""} without a project</p>
                  <p className="text-xs text-[#7D8590] mt-0.5">Potential upsell opportunity</p>
                  <Link href="/crm/clients" className="text-xs text-[#58A6FF] font-semibold hover:text-[#0078D4] mt-2 inline-block">View clients →</Link>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── Database Status ── */}
      <section>
        <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-[#7D8590] uppercase tracking-widest">Database Status</h2>
            {dbStatus && dbStatus.prod.available && dbStatus.prod.pendingCount > 0 && (
              <span className="text-xs font-bold bg-amber-500/15 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-full">{dbStatus.prod.pendingCount} pending</span>
            )}
            {dbStatus && dbStatus.prod.available && dbStatus.prod.pendingCount === 0 && (
              <span className="text-xs font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full">In sync</span>
            )}
          </div>
          <button onClick={() => void fetchDbStatus()} disabled={dbStatusLoading} className="flex items-center gap-1.5 text-xs font-semibold text-[#58A6FF] hover:text-[#0078D4] disabled:opacity-50 transition-colors">
            <svg className={`w-3.5 h-3.5 ${dbStatusLoading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
        </div>

        {dbStatusLoading ? (
          <SkeletonCard h="h-32" />
        ) : dbStatusError ? (
          <SectionError message={`Could not load database status: ${dbStatusError}`} />
        ) : dbStatus && (
          <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-5 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[
                { label: "Dev Database", color: "text-[#58A6FF]", data: dbStatus.dev },
                { label: "Production Database", color: "text-emerald-400", data: dbStatus.prod.available ? dbStatus.prod : null, unavailableReason: !dbStatus.prod.available ? dbStatus.prod.reason : null },
              ].map(env => (
                <div key={env.label} className={`bg-[#1C2128] rounded-xl p-4 space-y-2 ${env.data && "pendingCount" in env.data && env.data.pendingCount > 0 ? "ring-1 ring-amber-500/30" : ""}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <svg className={`w-3.5 h-3.5 ${env.color}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582 4 8 4s8 1.79 8 4" />
                    </svg>
                    <span className="text-xs font-bold text-[#E6EDF3]">{env.label}</span>
                  </div>
                  {env.data && "appliedCount" in env.data ? (
                    <>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-2xl font-bold text-[#E6EDF3]">{env.data.appliedCount}</span>
                        <span className="text-xs text-[#7D8590]">/ {dbStatus.journalCount} migrations applied</span>
                      </div>
                      {"pendingCount" in env.data && env.data.pendingCount > 0 ? (
                        <p className="text-xs font-semibold text-amber-400">{env.data.pendingCount} migration{env.data.pendingCount !== 1 ? "s" : ""} pending</p>
                      ) : (
                        <p className="text-xs text-emerald-400 font-semibold">Up to date ✓</p>
                      )}
                      {env.data.lastAppliedTag && (
                        <p className="text-[10px] text-[#484F58] truncate">Last: <span className="text-[#7D8590] font-mono">{env.data.lastAppliedTag}</span>{env.data.lastAppliedAt && <span> · {timeAgo(env.data.lastAppliedAt)}</span>}</p>
                      )}
                    </>
                  ) : (
                    <div>
                      <p className="text-xs text-[#7D8590]">Not connected</p>
                      {env.unavailableReason && <p className="text-[10px] text-[#484F58]">{env.unavailableReason}</p>}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {dbStatus.prod.available && dbStatus.prod.pendingCount > 0 && (
              <div>
                <button onClick={() => setShowPending(p => !p)} className="text-xs text-amber-400 hover:text-amber-300 font-semibold flex items-center gap-1 transition-colors">
                  <svg className={`w-3 h-3 transition-transform ${showPending ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                  {showPending ? "Hide" : "Show"} pending migrations
                </button>
                {showPending && (
                  <div className="mt-2 space-y-1 max-h-40 overflow-y-auto pr-1">
                    {dbStatus.prod.pendingTags.map(tag => (
                      <div key={tag} className="text-[11px] font-mono bg-amber-500/10 text-amber-300 border border-amber-500/20 px-2 py-1 rounded">{tag}</div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {dbStatus.prod.available && (
              <div className="flex items-center gap-3 pt-1 border-t border-[#30363D]">
                <button onClick={() => void runMigration()} disabled={migrating} className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-[#0078D4] hover:bg-[#0078D4]/80 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                  {migrating ? (
                    <><svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>Running…</>
                  ) : (
                    <><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582 4 8 4s8 1.79 8 4" /></svg>Run Migrations</>
                  )}
                </button>
                {migrateError && <p className="text-xs text-red-400">{migrateError}</p>}
                {migrateOutput && migrateOutput.length > 0 && !migrateError && <p className="text-xs text-emerald-400">Migration completed successfully.</p>}
              </div>
            )}

            {migrateOutput && migrateOutput.length > 0 && (
              <div className="bg-[#0D1117] rounded-lg p-3 max-h-40 overflow-y-auto">
                <pre className="text-[10px] text-[#7D8590] font-mono leading-relaxed whitespace-pre-wrap">{migrateOutput.join("\n")}</pre>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
