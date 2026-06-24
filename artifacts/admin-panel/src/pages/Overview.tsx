import { useEffect, useState, useCallback, useRef } from "react";
import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend,
} from "recharts";

interface OverviewData {
  clientCount: number;
  leadCount: number;
  openLeadCount: number;
  staleLeadCount: number;
  leadAgeBuckets: { fresh: number; stale: number; total: number };
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
  recentActivity: Array<{ type: string; title: string; timestamp: string; linkPath?: string }>;
  activeProjects: Array<{
    id: number; title: string; clientName: string | null;
    status: string; phase: string | null; progress: number; endDate: string | null;
  }>;
  topService: { name: string; revenue: number } | null;
  currQuarterAvgDeal: number;
  prevQuarterAvgDeal: number;
  leadFunnel: { leads: number; clients: number; activeProjects: number };
  mrrTrend: { current: number; threeMonthsAgo: number };
  pendingQuestions?: Array<{
    id: number;
    title: string;
    clientQuestion: string | null;
    projectId: number | null;
    projectTitle: string | null;
    clientName: string;
    updatedAt: string;
  }>;
}

interface Insight {
  icon: string;
  label: string;
  body: string;
  trend: "up" | "down" | "neutral";
  cta?: { label: string; path: string };
}

interface AiInsight {
  title: string;
  narrative: string;
  metric: string;
}

interface DbStatusDev {
  appliedCount: number;
  lastAppliedTag: string | null;
  lastAppliedAt: string | null;
  pendingCount: number;
  pendingTags: string[];
}

interface DbStatusProdAvailable {
  available: true;
  appliedCount: number;
  lastAppliedTag: string | null;
  lastAppliedAt: string | null;
  pendingCount: number;
  pendingTags: string[];
}

interface DbStatusProdUnavailable {
  available: false;
  reason: string;
}

type DbStatusProd = DbStatusProdAvailable | DbStatusProdUnavailable;

interface DbStatus {
  journalCount: number;
  dev: DbStatusDev;
  prod: DbStatusProd;
}

interface ExpiringCredItem {
  id: number;
  displayName: string;
  clientUserId: number | null;
  expiresOn: string;
}

interface ExpiringCredSummary {
  count: number;
  items: ExpiringCredItem[];
}

function fmt(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function trendPct(current: number, prev: number): number | null {
  if (prev === 0) return null;
  return Math.round(((current - prev) / prev) * 100);
}

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

function computeInsights(data: OverviewData): Insight[] {
  const insights: Insight[] = [];

  if (data.currQuarterAvgDeal > 0 || data.prevQuarterAvgDeal > 0) {
    const pct = trendPct(data.currQuarterAvgDeal, data.prevQuarterAvgDeal);
    insights.push({
      icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
      label: "Average deal size this quarter",
      body: `${fmt(data.currQuarterAvgDeal)}${pct !== null ? ` — ${pct >= 0 ? "up" : "down"} ${Math.abs(pct)}% vs last quarter` : " (no prior quarter data)"}`,
      trend: pct === null ? "neutral" : pct >= 0 ? "up" : "down",
    });
  }

  if (data.staleLeadCount > 0) {
    insights.push({
      icon: "M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
      label: `${data.staleLeadCount} lead${data.staleLeadCount !== 1 ? "s" : ""} need follow-up`,
      body: `${data.staleLeadCount} open lead${data.staleLeadCount !== 1 ? "s" : ""} older than 14 days with no activity. Reach out to keep the pipeline warm.`,
      trend: "down",
      cta: { label: "View leads", path: "/crm/leads" },
    });
  }

  if (data.mrrTrend.current > 0 || data.mrrTrend.threeMonthsAgo > 0) {
    const mrrPct = trendPct(data.mrrTrend.current, data.mrrTrend.threeMonthsAgo);
    insights.push({
      icon: "M13 7h8m0 0v8m0-8l-8 8-4-4-6 6",
      label: "MRR trend (3 months)",
      body: `Monthly recurring revenue is ${fmt(data.mrrTrend.current)}${mrrPct !== null ? ` — ${mrrPct >= 0 ? "up" : "down"} ${Math.abs(mrrPct)}% over 3 months` : ""}`,
      trend: mrrPct === null ? "neutral" : mrrPct >= 0 ? "up" : "down",
    });
  }

  if (data.clientsWithoutProjectsCount > 0) {
    insights.push({
      icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z",
      label: "Potential upsell opportunity",
      body: `${data.clientsWithoutProjectsCount} client${data.clientsWithoutProjectsCount !== 1 ? "s" : ""} currently ${data.clientsWithoutProjectsCount === 1 ? "has" : "have"} no active project — prime candidates for a new engagement.`,
      trend: "neutral",
      cta: { label: "View clients", path: "/crm/clients" },
    });
  }

  if (data.topService && data.topService.revenue > 0) {
    insights.push({
      icon: "M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z",
      label: "Top revenue service",
      body: `"${data.topService.name}" is your top service by purchase volume at ${fmt(data.topService.revenue)}.`,
      trend: "up",
    });
  }

  return insights;
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

function ActivityIcon({ type }: { type: string }) {
  const cls = "w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0";
  if (type === "lead") return (
    <div className={`${cls} bg-purple-500/15`}>
      <svg className="w-3.5 h-3.5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    </div>
  );
  if (type === "purchase") return (
    <div className={`${cls} bg-emerald-500/15`}>
      <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
      </svg>
    </div>
  );
  if (type === "message") return (
    <div className={`${cls} bg-[#0078D4]/15`}>
      <svg className="w-3.5 h-3.5 text-[#58A6FF]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
    </div>
  );
  return (
    <div className={`${cls} bg-amber-500/100/15`}>
      <svg className="w-3.5 h-3.5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
      </svg>
    </div>
  );
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

export default function OverviewPage() {
  const { fetchWithAuth } = useAuth();
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aiInsights, setAiInsights] = useState<AiInsight[] | null>(null);
  const [aiLoading, setAiLoading] = useState(true);
  const [aiError, setAiError] = useState<string | null>(null);
  const [expiringCreds, setExpiringCreds] = useState<ExpiringCredSummary | null>(null);
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
    void fetchWithAuth("/api/admin/azure-credentials/expiring-summary")
      .then(async res => {
        if (!res.ok) return;
        setExpiringCreds(await res.json() as ExpiringCredSummary);
      })
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
      if (body.ok) {
        setMigrateOutput(body.output ?? []);
        void fetchDbStatus();
      } else {
        setMigrateError(body.error ?? `Exit code ${body.code ?? "?"}`);
        setMigrateOutput(body.output ?? []);
      }
    } catch (e) {
      if ((e as { name?: string }).name !== "AbortError") {
        setMigrateError(e instanceof Error ? e.message : "Migration failed");
      }
    } finally {
      setMigrating(false);
    }
  }, [fetchWithAuth, fetchDbStatus]);

  const fetchAiInsights = useCallback(async () => {
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await fetchWithAuth("/api/admin/insights", { method: "POST" });
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const body = await res.json() as { insights: AiInsight[] };
      setAiInsights(body.insights);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "Failed to generate insights");
    } finally {
      setAiLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => { void fetchAiInsights(); }, [fetchAiInsights]);

  const insights = data ? computeInsights(data) : [];

  return (
    <div className="p-6 max-w-[1280px] space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-bold text-[#E6EDF3]">Overview</h1>
        <p className="text-sm text-[#7D8590] mt-0.5">Your business at a glance — live data across all areas.</p>
      </div>

      {/* ── KPI Ribbon ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} h="h-28" />)
        ) : error ? (
          <div className="col-span-4"><SectionError message={`Could not load KPIs: ${error}`} /></div>
        ) : data && [
          {
            label: "Active Clients", value: data.clientCount,
            icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z",
            iconBg: "bg-[#0078D4]/15", iconColor: "text-[#58A6FF]",
          },
          {
            label: "Open Leads", value: data.openLeadCount,
            sub: data.staleLeadCount > 0 ? `${data.staleLeadCount} stale` : undefined,
            icon: "M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z",
            iconBg: "bg-purple-500/15", iconColor: "text-purple-400",
          },
          {
            label: "Active Projects", value: data.activeProjectCount,
            icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2",
            iconBg: "bg-teal-500/15", iconColor: "text-teal-400",
          },
          {
            label: "MRR", value: fmt(data.mrr),
            icon: "M13 7h8m0 0v8m0-8l-8 8-4-4-6 6",
            iconBg: "bg-emerald-500/15", iconColor: "text-emerald-400",
            trend: data.mrrTrend,
          },
        ].map(card => (
          <div key={card.label} className="bg-[#161B22] border border-[#30363D] rounded-xl p-5 flex items-start gap-4">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${card.iconBg}`}>
              <svg className={`w-5 h-5 ${card.iconColor}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d={card.icon} />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-2xl font-bold text-[#E6EDF3]">{card.value}</p>
                {"trend" in card && card.trend && (
                  <TrendBadge current={card.trend.current} prev={card.trend.threeMonthsAgo} />
                )}
              </div>
              <p className="text-xs text-[#7D8590] font-medium mt-0.5">{card.label}</p>
              {"sub" in card && card.sub && (
                <p className="text-[10px] text-amber-400 font-semibold mt-0.5">{card.sub}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* ── Customer Questions Alert ── */}
      {!loading && !error && data && (data.pendingQuestions?.length ?? 0) > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            <h2 className="text-sm font-bold text-[#7D8590] uppercase tracking-widest">Customer Questions</h2>
            <span className="text-xs font-bold bg-amber-500/100/15 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-full">
              {data.pendingQuestions?.length ?? 0} pending
            </span>
          </div>
          <div className="space-y-2">
            {data.pendingQuestions?.map(q => (
              <div key={q.id} className="bg-amber-500/100/10 border border-amber-500/20 rounded-xl px-4 py-3.5 flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-amber-500/100/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <svg className="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                    <span className="text-xs font-bold text-amber-300">{q.clientName}</span>
                    {q.projectTitle && (
                      <>
                        <span className="text-amber-500/50">·</span>
                        <span className="text-xs text-amber-400">{q.projectTitle}</span>
                      </>
                    )}
                    <span className="text-amber-500/50">·</span>
                    <span className="text-[10px] text-amber-400/70">{q.title}</span>
                  </div>
                  {q.clientQuestion && (
                    <p className="text-xs text-amber-300/80 leading-relaxed line-clamp-2">{q.clientQuestion}</p>
                  )}
                </div>
                {q.projectId && (
                  <Link href={`/crm/projects/${q.projectId}`}>
                    <span className="flex-shrink-0 text-xs font-semibold text-amber-400 border border-amber-500/30 bg-amber-500/100/10 hover:bg-amber-500/100/20 px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap cursor-pointer">
                      Go to Project →
                    </span>
                  </Link>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Financial Snapshot ── */}
      <section>
        <h2 className="text-sm font-bold text-[#7D8590] uppercase tracking-widest mb-3">Financial Snapshot</h2>
        {loading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : error ? (
          <SectionError message="Could not load financial data." />
        ) : data && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              {
                label: "Total Revenue",
                value: fmt(data.totalRevenuePaid),
                sub: `${fmt(data.invoicePaidRevenue)} invoices + ${fmt(data.purchaseRevenue)} purchases`,
                accent: "border-l-emerald-500",
                trend: data.revenueTrend,
              },
              {
                label: "Outstanding",
                value: fmt(data.totalRevenueOutstanding),
                sub: data.overdueInvoiceCount > 0 ? `${data.overdueInvoiceCount} overdue` : "None overdue",
                accent: data.overdueInvoiceCount > 0 ? "border-l-red-500" : "border-l-amber-500",
              },
              {
                label: "MRR",
                value: fmt(data.mrr),
                sub: "Monthly recurring revenue",
                accent: "border-l-[#0078D4]",
                trend: data.mrrTrend,
              },
              {
                label: "Projected ARR",
                value: fmt(data.arr),
                sub: "MRR × 12",
                accent: "border-l-teal-500",
              },
            ].map(card => (
              <div key={card.label} className={`bg-[#161B22] border border-[#30363D] border-l-4 ${card.accent} rounded-xl p-5`}>
                <p className="text-[10px] text-[#7D8590] font-bold uppercase tracking-widest mb-1">{card.label}</p>
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-2xl font-bold text-[#E6EDF3]">{card.value}</p>
                  {"trend" in card && card.trend && (
                    <TrendBadge
                      current={"current" in card.trend ? card.trend.current : card.trend.currentMonth}
                      prev={"threeMonthsAgo" in card.trend ? card.trend.threeMonthsAgo : card.trend.prevMonth}
                    />
                  )}
                </div>
                <p className="text-xs text-[#7D8590]">{card.sub}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Main 2-col grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Revenue Chart */}
        <section className="lg:col-span-2 bg-[#161B22] border border-[#30363D] rounded-xl p-5">
          <h2 className="text-sm font-bold text-[#7D8590] uppercase tracking-widest mb-4">Revenue — Trailing 12 Months</h2>
          {loading ? (
            <div className="h-56 bg-[#1C2128] rounded-lg animate-pulse" />
          ) : error ? (
            <SectionError message="Could not load revenue chart." />
          ) : data && (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.revenueByMonth} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#30363D" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: "#7D8590" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#7D8590" }} axisLine={false} tickLine={false} tickFormatter={v => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`} />
                <RechartsTooltip
                  formatter={(value: number, name: string) => [fmt(value), name === "oneTime" ? "One-time" : "Recurring"]}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #30363D", backgroundColor: "#1C2128", color: "#E6EDF3" }}
                />
                <Legend formatter={(v: string) => <span style={{ color: "#7D8590", fontSize: 11 }}>{v === "oneTime" ? "One-time" : "Recurring"}</span>} />
                <Bar dataKey="oneTime" stackId="a" fill="#0078D4" />
                <Bar dataKey="recurring" stackId="a" fill="#00B4D8" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </section>

        {/* Recent Activity */}
        <section className="bg-[#161B22] border border-[#30363D] rounded-xl p-5 flex flex-col">
          <h2 className="text-sm font-bold text-[#7D8590] uppercase tracking-widest mb-4">Recent Activity</h2>
          {loading ? (
            <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-10 bg-[#1C2128] rounded-lg animate-pulse" />)}</div>
          ) : error ? (
            <SectionError message="Could not load activity." />
          ) : data && data.recentActivity.length === 0 ? (
            <p className="text-xs text-[#7D8590] text-center py-8">No recent activity yet.</p>
          ) : data && (
            <div className="flex flex-col gap-3 flex-1">
              {data.recentActivity.map((event, i) => (
                <div key={i} className="flex items-start gap-3">
                  <ActivityIcon type={event.type} />
                  <div className="flex-1 min-w-0">
                    {event.linkPath ? (
                      <Link href={event.linkPath} className="text-xs font-medium text-[#E6EDF3] hover:text-[#58A6FF] transition-colors line-clamp-2 leading-relaxed">
                        {event.title}
                      </Link>
                    ) : (
                      <p className="text-xs font-medium text-[#E6EDF3] line-clamp-2 leading-relaxed">{event.title}</p>
                    )}
                    <p className="text-[10px] text-[#7D8590] mt-0.5">{timeAgo(event.timestamp)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* ── Pipeline Funnel + Projects At a Glance ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Pipeline Funnel */}
        <section className="bg-[#161B22] border border-[#30363D] rounded-xl p-5">
          <h2 className="text-sm font-bold text-[#7D8590] uppercase tracking-widest mb-4">Pipeline Funnel</h2>
          {loading ? (
            <div className="h-40 bg-[#1C2128] rounded-lg animate-pulse" />
          ) : error ? (
            <SectionError message="Could not load pipeline." />
          ) : data && (() => {
            const max = Math.max(data.leadFunnel.leads, data.leadFunnel.clients, data.leadFunnel.activeProjects, 1);
            return (
              <div className="flex flex-col gap-3">
                {[
                  { label: "Open Leads", value: data.leadFunnel.leads, color: "bg-purple-500", link: "/crm/leads" },
                  { label: "Clients", value: data.leadFunnel.clients, color: "bg-[#0078D4]", link: "/crm/clients" },
                  { label: "Active Projects", value: data.leadFunnel.activeProjects, color: "bg-teal-500", link: "/crm/projects" },
                ].map((item, idx) => (
                  <div key={item.label}>
                    <div className="flex justify-between items-center mb-1">
                      <Link href={item.link} className="text-xs font-medium text-[#7D8590] hover:text-[#58A6FF] transition-colors">{item.label}</Link>
                      <span className="text-sm font-bold text-[#E6EDF3]">{item.value}</span>
                    </div>
                    <div className="h-2.5 bg-[#30363D] rounded-full overflow-hidden">
                      <div
                        className={`h-full ${item.color} rounded-full transition-all duration-700`}
                        style={{ width: `${Math.round((item.value / max) * 100)}%` }}
                      />
                    </div>
                    {idx === 1 && data.leadFunnel.leads > 0 && (
                      <p className="text-[10px] text-[#7D8590] mt-0.5">
                        {Math.round((data.leadFunnel.clients / data.leadFunnel.leads) * 100)}% conversion from leads
                      </p>
                    )}
                  </div>
                ))}
              </div>
            );
          })()}
        </section>

        {/* Projects at a Glance */}
        <section className="lg:col-span-2 bg-[#161B22] border border-[#30363D] rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-[#7D8590] uppercase tracking-widest">Active Projects</h2>
            <Link href="/crm/projects" className="text-xs text-[#58A6FF] hover:text-[#0078D4] font-semibold transition-colors">View all →</Link>
          </div>
          {loading ? (
            <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-10 bg-[#1C2128] rounded-lg animate-pulse" />)}</div>
          ) : error ? (
            <SectionError message="Could not load projects." />
          ) : data && data.activeProjects.length === 0 ? (
            <p className="text-xs text-[#7D8590] text-center py-8">No active projects.</p>
          ) : data && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[#30363D]">
                    {["Project", "Client", "Progress", "Due"].map(h => (
                      <th key={h} className="text-left text-[10px] font-bold text-[#484F58] uppercase tracking-widest pb-2 pr-4">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#30363D]">
                  {data.activeProjects.map(proj => (
                    <tr key={proj.id} className="hover:bg-[#1C2128] transition-colors">
                      <td className="py-2.5 pr-4">
                        <Link href={`/crm/projects/${proj.id}`} className="font-semibold text-[#E6EDF3] hover:text-[#58A6FF] transition-colors line-clamp-1">
                          {proj.title}
                        </Link>
                        {proj.phase && <span className="text-[10px] text-[#7D8590] block">{proj.phase}</span>}
                      </td>
                      <td className="py-2.5 pr-4 text-[#7D8590] max-w-[100px] truncate">{proj.clientName ?? "—"}</td>
                      <td className="py-2.5 pr-4">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 bg-[#30363D] rounded-full overflow-hidden">
                            <div className="h-full bg-[#0078D4] rounded-full" style={{ width: `${proj.progress}%` }} />
                          </div>
                          <span className="text-[#7D8590] tabular-nums">{proj.progress}%</span>
                        </div>
                      </td>
                      <td className="py-2.5 text-[#7D8590]">
                        {proj.endDate ? new Date(proj.endDate).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* ── Expiring Azure Credentials Alert ── */}
      {expiringCreds && expiringCreds.count > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <h2 className="text-sm font-bold text-[#7D8590] uppercase tracking-widest">Expiring Credentials</h2>
            <span className="text-xs font-bold bg-red-500/15 text-red-400 border border-red-500/20 px-2 py-0.5 rounded-full">
              {expiringCreds.count} expiring soon
            </span>
          </div>
          <div className="space-y-2">
            {expiringCreds.items.map(cred => {
              const days = Math.ceil((new Date(cred.expiresOn).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
              const expired = days <= 0;
              const critical = days > 0 && days <= 14;
              const isUrgent = expired || critical;
              return (
                <div key={cred.id} className={`border rounded-xl px-4 py-3.5 flex items-center gap-3 ${isUrgent ? "bg-red-500/10 border-red-500/20" : "bg-amber-500/100/10 border-amber-500/20"}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${isUrgent ? "bg-red-500/20" : "bg-amber-500/100/20"}`}>
                    <svg className={`w-4 h-4 ${isUrgent ? "text-red-400" : "text-amber-400"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className={`text-xs font-bold ${isUrgent ? "text-red-300" : "text-amber-300"}`}>
                      {cred.displayName}
                    </span>
                    <p className={`text-[11px] mt-0.5 ${isUrgent ? "text-red-400" : "text-amber-400"}`}>
                      {expired
                        ? `Expired on ${new Date(cred.expiresOn).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} — Script Runner will fail`
                        : `Expires in ${days} day${days !== 1 ? "s" : ""} — ${new Date(cred.expiresOn).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`}
                    </p>
                  </div>
                  {cred.clientUserId && (
                    <Link href={`/crm/clients/${cred.clientUserId}`}>
                      <span className={`flex-shrink-0 text-xs font-semibold border px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap cursor-pointer ${isUrgent ? "text-red-400 border-red-500/30 bg-red-500/10 hover:bg-red-500/100/20" : "text-amber-400 border-amber-500/30 bg-amber-500/100/10 hover:bg-amber-500/100/20"}`}>
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

      {/* ── Outstanding Actions ── */}
      {(loading || (data && (data.unpaidInvoiceCount > 0 || data.staleLeadCount > 0 || data.clientsWithoutProjectsCount > 0))) && (
        <section>
          <h2 className="text-sm font-bold text-[#7D8590] uppercase tracking-widest mb-3">Outstanding Actions</h2>
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} h="h-24" />)}
            </div>
          ) : error ? (
            <SectionError message="Could not load outstanding actions." />
          ) : data && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {data.unpaidInvoiceCount > 0 && (
                <div className={`border rounded-xl p-4 flex items-start gap-3 ${data.overdueInvoiceCount > 0 ? "bg-red-500/10 border-red-500/20" : "bg-amber-500/100/10 border-amber-500/20"}`}>
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${data.overdueInvoiceCount > 0 ? "bg-red-500/20" : "bg-amber-500/100/20"}`}>
                    <svg className={`w-5 h-5 ${data.overdueInvoiceCount > 0 ? "text-red-400" : "text-amber-400"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <p className={`text-sm font-bold ${data.overdueInvoiceCount > 0 ? "text-red-300" : "text-amber-300"}`}>
                      {data.unpaidInvoiceCount} invoice{data.unpaidInvoiceCount !== 1 ? "s" : ""} need payment
                    </p>
                    <p className={`text-xs mt-0.5 ${data.overdueInvoiceCount > 0 ? "text-red-400" : "text-amber-400"}`}>
                      {fmt(data.unpaidInvoiceValue)} total
                      {data.overdueInvoiceCount > 0 && ` · ${data.overdueInvoiceCount} overdue`}
                      {data.dueInvoiceCount > 0 && ` · ${data.dueInvoiceCount} due`}
                    </p>
                    <Link href="/crm/invoices" className={`text-xs font-semibold mt-2 inline-block ${data.overdueInvoiceCount > 0 ? "text-red-400 hover:text-red-300" : "text-amber-400 hover:text-amber-300"}`}>View invoices →</Link>
                  </div>
                </div>
              )}
              {data.staleLeadCount > 0 && (
                <div className="bg-amber-500/100/10 border border-amber-500/20 rounded-xl p-4 flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-amber-500/100/20 flex items-center justify-center flex-shrink-0">
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
          )}
        </section>
      )}

      {/* ── Database Status ── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-[#7D8590] uppercase tracking-widest">Database Status</h2>
            {dbStatus && dbStatus.prod.available && dbStatus.prod.pendingCount > 0 && (
              <span className="text-xs font-bold bg-amber-500/15 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-full">
                {dbStatus.prod.pendingCount} pending
              </span>
            )}
            {dbStatus && dbStatus.prod.available && dbStatus.prod.pendingCount === 0 && (
              <span className="text-xs font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                In sync
              </span>
            )}
          </div>
          <button
            onClick={() => void fetchDbStatus()}
            disabled={dbStatusLoading}
            className="flex items-center gap-1.5 text-xs font-semibold text-[#58A6FF] hover:text-[#0078D4] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
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
            {/* Two-column: Dev + Prod */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Dev DB */}
              <div className="bg-[#1C2128] rounded-xl p-4 space-y-2">
                <div className="flex items-center gap-2 mb-1">
                  <svg className="w-3.5 h-3.5 text-[#58A6FF]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582 4 8 4s8 1.79 8 4" />
                  </svg>
                  <span className="text-xs font-bold text-[#E6EDF3]">Dev Database</span>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-bold text-[#E6EDF3]">{dbStatus.dev.appliedCount}</span>
                  <span className="text-xs text-[#7D8590]">/ {dbStatus.journalCount} migrations applied</span>
                </div>
                {dbStatus.dev.pendingCount > 0 && (
                  <p className="text-xs text-amber-400">{dbStatus.dev.pendingCount} pending in dev</p>
                )}
                {dbStatus.dev.lastAppliedTag && (
                  <p className="text-[10px] text-[#484F58] truncate" title={dbStatus.dev.lastAppliedTag}>
                    Last: <span className="text-[#7D8590] font-mono">{dbStatus.dev.lastAppliedTag}</span>
                    {dbStatus.dev.lastAppliedAt && (
                      <span className="text-[#484F58]"> · {timeAgo(dbStatus.dev.lastAppliedAt)}</span>
                    )}
                  </p>
                )}
                {!dbStatus.dev.lastAppliedTag && (
                  <p className="text-[10px] text-[#484F58]">No migrations tracked yet</p>
                )}
              </div>

              {/* Prod DB */}
              <div className={`bg-[#1C2128] rounded-xl p-4 space-y-2 ${dbStatus.prod.available && dbStatus.prod.pendingCount > 0 ? "ring-1 ring-amber-500/30" : ""}`}>
                <div className="flex items-center gap-2 mb-1">
                  <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582 4 8 4s8 1.79 8 4" />
                  </svg>
                  <span className="text-xs font-bold text-[#E6EDF3]">Production Database</span>
                </div>
                {dbStatus.prod.available ? (
                  <>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-2xl font-bold text-[#E6EDF3]">{dbStatus.prod.appliedCount}</span>
                      <span className="text-xs text-[#7D8590]">/ {dbStatus.journalCount} migrations applied</span>
                    </div>
                    {dbStatus.prod.pendingCount > 0 ? (
                      <p className="text-xs font-semibold text-amber-400">{dbStatus.prod.pendingCount} migration{dbStatus.prod.pendingCount !== 1 ? "s" : ""} pending</p>
                    ) : (
                      <p className="text-xs text-emerald-400 font-semibold">Up to date ✓</p>
                    )}
                    {dbStatus.prod.lastAppliedTag && (
                      <p className="text-[10px] text-[#484F58] truncate" title={dbStatus.prod.lastAppliedTag}>
                        Last: <span className="text-[#7D8590] font-mono">{dbStatus.prod.lastAppliedTag}</span>
                        {dbStatus.prod.lastAppliedAt && (
                          <span className="text-[#484F58]"> · {timeAgo(dbStatus.prod.lastAppliedAt)}</span>
                        )}
                      </p>
                    )}
                  </>
                ) : (
                  <div className="flex flex-col gap-1">
                    <p className="text-xs text-[#7D8590]">Not connected</p>
                    <p className="text-[10px] text-[#484F58]">{dbStatus.prod.reason}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Pending tags toggle */}
            {dbStatus.prod.available && dbStatus.prod.pendingCount > 0 && (
              <div>
                <button
                  onClick={() => setShowPending(p => !p)}
                  className="text-xs text-amber-400 hover:text-amber-300 font-semibold flex items-center gap-1 transition-colors"
                >
                  <svg className={`w-3 h-3 transition-transform ${showPending ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                  {showPending ? "Hide" : "Show"} pending migrations
                </button>
                {showPending && (
                  <div className="mt-2 space-y-1 max-h-40 overflow-y-auto pr-1">
                    {dbStatus.prod.pendingTags.map(tag => (
                      <div key={tag} className="text-[11px] font-mono bg-amber-500/10 text-amber-300 border border-amber-500/20 px-2 py-1 rounded">
                        {tag}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Run migrations */}
            {dbStatus.prod.available && (
              <div className="flex items-center gap-3 pt-1 border-t border-[#30363D]">
                <button
                  onClick={() => void runMigration()}
                  disabled={migrating}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-[#0078D4] hover:bg-[#0078D4]/80 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {migrating ? (
                    <>
                      <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Running migrations…
                    </>
                  ) : (
                    <>
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                      </svg>
                      Run Migrations on Prod
                    </>
                  )}
                </button>
                <p className="text-[10px] text-[#484F58]">Runs migrate-prod against PROD_DATABASE_URL</p>
              </div>
            )}

            {/* Migration output */}
            {migrateError && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-xs text-red-400 font-semibold">
                Migration failed: {migrateError}
              </div>
            )}
            {migrateOutput && migrateOutput.length > 0 && (
              <div className="bg-[#0D1117] border border-[#30363D] rounded-lg p-3 max-h-48 overflow-y-auto">
                {migrateOutput.map((line, i) => (
                  <div key={i} className={`text-[10px] font-mono leading-relaxed ${line.includes("ERROR") || line.includes("failed") ? "text-red-400" : line.includes("done") || line.includes("success") ? "text-emerald-400" : "text-[#7D8590]"}`}>
                    {line}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── AI Insights ── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-[#7D8590] uppercase tracking-widest">AI Insights</h2>
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#58A6FF] bg-[#0078D4]/10 px-2 py-0.5 rounded-full">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Claude
            </span>
          </div>
          <button
            onClick={() => void fetchAiInsights()}
            disabled={aiLoading}
            className="flex items-center gap-1.5 text-xs font-semibold text-[#58A6FF] hover:text-[#0078D4] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <svg className={`w-3.5 h-3.5 ${aiLoading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {aiLoading ? "Generating…" : "Regenerate"}
          </button>
        </div>
        {aiLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} h="h-36" />)}
          </div>
        ) : aiError ? (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-5 flex items-start gap-3">
            <svg className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="flex-1">
              <p className="text-sm font-semibold text-red-300">Could not generate AI insights</p>
              <p className="text-xs text-red-400 mt-0.5">{aiError}</p>
              <button onClick={() => void fetchAiInsights()} className="text-xs font-semibold text-red-400 hover:text-red-300 mt-2 underline">Retry</button>
            </div>
          </div>
        ) : aiInsights && aiInsights.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {aiInsights.map((insight, i) => (
              <div key={i} className="bg-[#161B22] border border-[#30363D] rounded-xl p-5 flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0">
                    <svg className="w-5 h-5 text-[#58A6FF]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d={[
                        "M13 7h8m0 0v8m0-8l-8 8-4-4-6 6",
                        "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
                        "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z",
                        "M13 10V3L4 14h7v7l9-11h-7z",
                      ][i % 4]} />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-[#E6EDF3] leading-tight">{insight.title}</p>
                    <span className="inline-block mt-1.5 text-[10px] font-bold text-[#58A6FF] bg-[#0078D4]/10 px-2 py-0.5 rounded-full">{insight.metric}</span>
                  </div>
                </div>
                <p className="text-xs text-[#7D8590] leading-relaxed">{insight.narrative}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-6 text-center">
            <p className="text-xs text-[#7D8590]">No insights available. Add clients, projects, and invoices then click Regenerate.</p>
          </div>
        )}
      </section>

      {/* ── Business Insights (rule-based) ── */}
      {insights.length > 0 && (
        <section>
          <h2 className="text-sm font-bold text-[#7D8590] uppercase tracking-widest mb-3">Quick Signals</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {insights.map((insight, i) => (
              <div key={i} className="bg-[#161B22] border border-[#30363D] rounded-xl p-5 flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                    insight.trend === "up" ? "bg-emerald-500/15" : insight.trend === "down" ? "bg-red-500/15" : "bg-[#0078D4]/15"
                  }`}>
                    <svg className={`w-5 h-5 ${
                      insight.trend === "up" ? "text-emerald-400" : insight.trend === "down" ? "text-red-400" : "text-[#58A6FF]"
                    }`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d={insight.icon} />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <p className="text-xs font-bold text-[#E6EDF3] leading-tight">{insight.label}</p>
                    <p className="text-xs text-[#7D8590] mt-1 leading-relaxed">{insight.body}</p>
                  </div>
                </div>
                {insight.cta && (
                  <Link href={insight.cta.path} className="text-xs font-semibold text-[#58A6FF] hover:text-[#0078D4] transition-colors">
                    {insight.cta.label} →
                  </Link>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
