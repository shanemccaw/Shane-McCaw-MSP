import { useEffect, useState } from "react";
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
}

interface Insight {
  icon: string;
  label: string;
  body: string;
  trend: "up" | "down" | "neutral";
  cta?: { label: string; path: string };
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
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${up ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"}`}>
      <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
        <path strokeLinecap="round" strokeLinejoin="round" d={up ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"} />
      </svg>
      {Math.abs(pct)}%
    </span>
  );
}

function computeInsights(data: OverviewData): Insight[] {
  const insights: Insight[] = [];

  // Deal size vs prior quarter
  if (data.currQuarterAvgDeal > 0 || data.prevQuarterAvgDeal > 0) {
    const pct = trendPct(data.currQuarterAvgDeal, data.prevQuarterAvgDeal);
    insights.push({
      icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
      label: "Average deal size this quarter",
      body: `${fmt(data.currQuarterAvgDeal)}${pct !== null ? ` — ${pct >= 0 ? "up" : "down"} ${Math.abs(pct)}% vs last quarter` : " (no prior quarter data)"}`,
      trend: pct === null ? "neutral" : pct >= 0 ? "up" : "down",
    });
  }

  // Stale leads
  if (data.staleLeadCount > 0) {
    insights.push({
      icon: "M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
      label: `${data.staleLeadCount} lead${data.staleLeadCount !== 1 ? "s" : ""} need follow-up`,
      body: `${data.staleLeadCount} open lead${data.staleLeadCount !== 1 ? "s" : ""} older than 14 days with no activity. Reach out to keep the pipeline warm.`,
      trend: "down",
      cta: { label: "View leads", path: "/crm/leads" },
    });
  }

  // MRR trend
  if (data.mrrTrend.current > 0 || data.mrrTrend.threeMonthsAgo > 0) {
    const mrrPct = trendPct(data.mrrTrend.current, data.mrrTrend.threeMonthsAgo);
    insights.push({
      icon: "M13 7h8m0 0v8m0-8l-8 8-4-4-6 6",
      label: "MRR trend (3 months)",
      body: `Monthly recurring revenue is ${fmt(data.mrrTrend.current)}${mrrPct !== null ? ` — ${mrrPct >= 0 ? "up" : "down"} ${Math.abs(mrrPct)}% over 3 months` : ""}`,
      trend: mrrPct === null ? "neutral" : mrrPct >= 0 ? "up" : "down",
    });
  }

  // Clients without projects
  if (data.clientsWithoutProjectsCount > 0) {
    insights.push({
      icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z",
      label: "Potential upsell opportunity",
      body: `${data.clientsWithoutProjectsCount} client${data.clientsWithoutProjectsCount !== 1 ? "s" : ""} currently ${data.clientsWithoutProjectsCount === 1 ? "has" : "have"} no active project — prime candidates for a new engagement.`,
      trend: "neutral",
      cta: { label: "View clients", path: "/crm/clients" },
    });
  }

  // Top service
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
    <div className="flex items-center gap-2 p-4 bg-red-50 border border-red-100 rounded-xl text-xs text-red-600">
      <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      {message}
    </div>
  );
}

function SkeletonCard({ h = "h-24" }: { h?: string }) {
  return <div className={`${h} bg-white border border-gray-100 rounded-xl animate-pulse`} />;
}

function ActivityIcon({ type }: { type: string }) {
  const cls = "w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0";
  if (type === "lead") return (
    <div className={`${cls} bg-purple-100`}>
      <svg className="w-3.5 h-3.5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    </div>
  );
  if (type === "purchase") return (
    <div className={`${cls} bg-emerald-100`}>
      <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
      </svg>
    </div>
  );
  if (type === "message") return (
    <div className={`${cls} bg-blue-100`}>
      <svg className="w-3.5 h-3.5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
    </div>
  );
  return (
    <div className={`${cls} bg-amber-100`}>
      <svg className="w-3.5 h-3.5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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

  useEffect(() => {
    void fetchWithAuth("/api/admin/overview")
      .then(async res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setData(await res.json() as OverviewData);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load overview"))
      .finally(() => setLoading(false));
  }, [fetchWithAuth]);

  const insights = data ? computeInsights(data) : [];

  return (
    <div className="p-6 max-w-[1280px] space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-bold text-[#0A2540]">Overview</h1>
        <p className="text-sm text-gray-500 mt-0.5">Your business at a glance — live data across all areas.</p>
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
            color: "text-[#0078D4] bg-[#0078D4]/10",
          },
          {
            label: "Open Leads", value: data.openLeadCount,
            sub: data.staleLeadCount > 0 ? `${data.staleLeadCount} stale` : undefined,
            icon: "M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z",
            color: "text-purple-600 bg-purple-100",
          },
          {
            label: "Active Projects", value: data.activeProjectCount,
            icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2",
            color: "text-teal-600 bg-teal-100",
          },
          {
            label: "MRR", value: fmt(data.mrr),
            icon: "M13 7h8m0 0v8m0-8l-8 8-4-4-6 6",
            color: "text-emerald-600 bg-emerald-100",
            trend: data.mrrTrend,
          },
        ].map(card => (
          <div key={card.label} className="bg-white border border-gray-100 rounded-xl p-5 flex items-start gap-4 shadow-sm">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${card.color}`}>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d={card.icon} />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-2xl font-bold text-[#0A2540]">{card.value}</p>
                {"trend" in card && card.trend && (
                  <TrendBadge current={card.trend.current} prev={card.trend.threeMonthsAgo} />
                )}
              </div>
              <p className="text-xs text-gray-500 font-medium mt-0.5">{card.label}</p>
              {"sub" in card && card.sub && (
                <p className="text-[10px] text-amber-600 font-semibold mt-0.5">{card.sub}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* ── Financial Snapshot ── */}
      <section>
        <h2 className="text-sm font-bold text-[#0A2540] uppercase tracking-widest mb-3">Financial Snapshot</h2>
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
                border: "border-l-emerald-400",
                trend: data.revenueTrend,
              },
              {
                label: "Outstanding",
                value: fmt(data.totalRevenueOutstanding),
                sub: data.overdueInvoiceCount > 0 ? `${data.overdueInvoiceCount} overdue` : "None overdue",
                border: data.overdueInvoiceCount > 0 ? "border-l-red-400" : "border-l-amber-400",
              },
              {
                label: "MRR",
                value: fmt(data.mrr),
                sub: "Monthly recurring revenue",
                border: "border-l-[#0078D4]",
                trend: data.mrrTrend,
              },
              {
                label: "Projected ARR",
                value: fmt(data.arr),
                sub: "MRR × 12",
                border: "border-l-teal-400",
              },
            ].map(card => (
              <div key={card.label} className={`bg-white border border-gray-100 border-l-4 ${card.border} rounded-xl p-5 shadow-sm`}>
                <p className="text-xs text-gray-400 font-bold uppercase tracking-widest mb-1">{card.label}</p>
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-2xl font-bold text-[#0A2540]">{card.value}</p>
                  {"trend" in card && card.trend && (
                    <TrendBadge
                      current={"current" in card.trend ? card.trend.current : card.trend.currentMonth}
                      prev={"threeMonthsAgo" in card.trend ? card.trend.threeMonthsAgo : card.trend.prevMonth}
                    />
                  )}
                </div>
                <p className="text-xs text-gray-400">{card.sub}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Main 2-col grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Revenue Chart */}
        <section className="lg:col-span-2 bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
          <h2 className="text-sm font-bold text-[#0A2540] uppercase tracking-widest mb-4">Revenue — Trailing 12 Months</h2>
          {loading ? (
            <div className="h-56 bg-gray-50 rounded-lg animate-pulse" />
          ) : error ? (
            <SectionError message="Could not load revenue chart." />
          ) : data && (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.revenueByMonth} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false} tickFormatter={v => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`} />
                <RechartsTooltip
                  formatter={(value: number, name: string) => [fmt(value), name === "oneTime" ? "One-time" : "Recurring"]}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
                />
                <Legend formatter={(v: string) => v === "oneTime" ? "One-time" : "Recurring"} wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="oneTime" stackId="a" fill="#0078D4" />
                <Bar dataKey="recurring" stackId="a" fill="#00B4D8" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </section>

        {/* Recent Activity */}
        <section className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm flex flex-col">
          <h2 className="text-sm font-bold text-[#0A2540] uppercase tracking-widest mb-4">Recent Activity</h2>
          {loading ? (
            <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-10 bg-gray-50 rounded-lg animate-pulse" />)}</div>
          ) : error ? (
            <SectionError message="Could not load activity." />
          ) : data && data.recentActivity.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-8">No recent activity yet.</p>
          ) : data && (
            <div className="flex flex-col gap-3 flex-1">
              {data.recentActivity.map((event, i) => (
                <div key={i} className="flex items-start gap-3">
                  <ActivityIcon type={event.type} />
                  <div className="flex-1 min-w-0">
                    {event.linkPath ? (
                      <Link href={event.linkPath} className="text-xs font-medium text-[#0A2540] hover:text-[#0078D4] transition-colors line-clamp-2 leading-relaxed">
                        {event.title}
                      </Link>
                    ) : (
                      <p className="text-xs font-medium text-[#0A2540] line-clamp-2 leading-relaxed">{event.title}</p>
                    )}
                    <p className="text-[10px] text-gray-400 mt-0.5">{timeAgo(event.timestamp)}</p>
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
        <section className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
          <h2 className="text-sm font-bold text-[#0A2540] uppercase tracking-widest mb-4">Pipeline Funnel</h2>
          {loading ? (
            <div className="h-40 bg-gray-50 rounded-lg animate-pulse" />
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
                      <Link href={item.link} className="text-xs font-medium text-gray-600 hover:text-[#0078D4] transition-colors">{item.label}</Link>
                      <span className="text-sm font-bold text-[#0A2540]">{item.value}</span>
                    </div>
                    <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${item.color} rounded-full transition-all duration-700`}
                        style={{ width: `${Math.round((item.value / max) * 100)}%` }}
                      />
                    </div>
                    {idx === 1 && data.leadFunnel.leads > 0 && (
                      <p className="text-[10px] text-gray-400 mt-0.5">
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
        <section className="lg:col-span-2 bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-[#0A2540] uppercase tracking-widest">Active Projects</h2>
            <Link href="/crm/projects" className="text-xs text-[#0078D4] hover:text-[#0078D4]/80 font-semibold transition-colors">View all →</Link>
          </div>
          {loading ? (
            <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-10 bg-gray-50 rounded-lg animate-pulse" />)}</div>
          ) : error ? (
            <SectionError message="Could not load projects." />
          ) : data && data.activeProjects.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-8">No active projects.</p>
          ) : data && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-100">
                    {["Project", "Client", "Progress", "Due"].map(h => (
                      <th key={h} className="text-left text-[10px] font-bold text-gray-400 uppercase tracking-widest pb-2 pr-4">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {data.activeProjects.map(proj => (
                    <tr key={proj.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="py-2.5 pr-4">
                        <Link href={`/crm/projects/${proj.id}`} className="font-semibold text-[#0A2540] hover:text-[#0078D4] transition-colors line-clamp-1">
                          {proj.title}
                        </Link>
                        {proj.phase && <span className="text-[10px] text-gray-400 block">{proj.phase}</span>}
                      </td>
                      <td className="py-2.5 pr-4 text-gray-500 max-w-[100px] truncate">{proj.clientName ?? "—"}</td>
                      <td className="py-2.5 pr-4">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full bg-[#0078D4] rounded-full" style={{ width: `${proj.progress}%` }} />
                          </div>
                          <span className="text-gray-500 tabular-nums">{proj.progress}%</span>
                        </div>
                      </td>
                      <td className="py-2.5 text-gray-500">
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

      {/* ── Outstanding Actions ── */}
      {(loading || (data && (data.overdueInvoiceCount > 0 || data.staleLeadCount > 0 || data.clientsWithoutProjectsCount > 0))) && (
        <section>
          <h2 className="text-sm font-bold text-[#0A2540] uppercase tracking-widest mb-3">Outstanding Actions</h2>
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} h="h-24" />)}
            </div>
          ) : error ? (
            <SectionError message="Could not load outstanding actions." />
          ) : data && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {data.overdueInvoiceCount > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-red-100 flex items-center justify-center flex-shrink-0">
                    <svg className="w-4.5 h-4.5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-bold text-red-800">{data.overdueInvoiceCount} overdue invoice{data.overdueInvoiceCount !== 1 ? "s" : ""}</p>
                    <p className="text-xs text-red-600 mt-0.5">{fmt(data.overdueInvoiceValue)} outstanding</p>
                    <Link href="/crm/invoices" className="text-xs text-red-700 font-semibold hover:text-red-900 mt-2 inline-block">View invoices →</Link>
                  </div>
                </div>
              )}
              {data.staleLeadCount > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
                    <svg className="w-4.5 h-4.5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-bold text-amber-800">{data.staleLeadCount} stale lead{data.staleLeadCount !== 1 ? "s" : ""}</p>
                    <p className="text-xs text-amber-600 mt-0.5">No activity in over 14 days</p>
                    <Link href="/crm/leads" className="text-xs text-amber-700 font-semibold hover:text-amber-900 mt-2 inline-block">View leads →</Link>
                  </div>
                </div>
              )}
              {data.clientsWithoutProjectsCount > 0 && (
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
                    <svg className="w-4.5 h-4.5 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-bold text-blue-800">{data.clientsWithoutProjectsCount} client{data.clientsWithoutProjectsCount !== 1 ? "s" : ""} without a project</p>
                    <p className="text-xs text-blue-600 mt-0.5">Potential upsell opportunity</p>
                    <Link href="/crm/clients" className="text-xs text-[#0078D4] font-semibold hover:text-[#0078D4]/80 mt-2 inline-block">View clients →</Link>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* ── Business Insights ── */}
      <section>
        <h2 className="text-sm font-bold text-[#0A2540] uppercase tracking-widest mb-3">Business Insights</h2>
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} h="h-24" />)}
          </div>
        ) : error ? (
          <SectionError message="Could not generate insights." />
        ) : insights.length === 0 ? (
          <div className="bg-white border border-gray-100 rounded-xl p-6 text-center">
            <p className="text-xs text-gray-400">Add some clients, projects, and invoices to generate business insights.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {insights.map((insight, i) => (
              <div key={i} className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                    insight.trend === "up" ? "bg-emerald-100" : insight.trend === "down" ? "bg-red-100" : "bg-blue-100"
                  }`}>
                    <svg className={`w-4.5 h-4.5 ${
                      insight.trend === "up" ? "text-emerald-600" : insight.trend === "down" ? "text-red-500" : "text-[#0078D4]"
                    }`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d={insight.icon} />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <p className="text-xs font-bold text-[#0A2540] leading-tight">{insight.label}</p>
                    <p className="text-xs text-gray-500 mt-1 leading-relaxed">{insight.body}</p>
                  </div>
                </div>
                {insight.cta && (
                  <Link href={insight.cta.path} className="text-xs font-semibold text-[#0078D4] hover:text-[#0078D4]/80 transition-colors">
                    {insight.cta.label} →
                  </Link>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
