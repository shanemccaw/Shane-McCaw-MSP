import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
} from "recharts";

type Range = "today" | "7d" | "30d" | "90d";

interface KPIs {
  visitors: number;
  pageviews: number;
  avgTimeOnPage: number;
  bounceRate: number;
}

interface Series { date: string; views: number }
interface TopPage { page: string; views: number; avgDuration: number | null; bounceRate: number }
interface TopEvent { eventType: string; label: string; page: string; count: number }
interface TopReferrer { source: string; sessions: number; pct: number }
interface TopLink { href: string; label: string; count: number }

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toString();
}

function fmtTime(seconds: number): string {
  if (!seconds) return "—";
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function SkeletonCard({ h = "h-24" }: { h?: string }) {
  return <div className={`${h} bg-white border border-gray-100 rounded-xl animate-pulse`} />;
}

function SectionError({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-100 rounded-xl text-xs text-red-600">
      <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      {message}
    </div>
  );
}

const RANGE_LABELS: Record<Range, string> = { today: "Today", "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days" };

const EVENT_TYPE_LABELS: Record<string, string> = {
  cta_click: "CTA Click",
  outbound_click: "Outbound",
  click: "Click",
  form_submit: "Form Submit",
  scroll_milestone: "Scroll",
};

export default function AnalyticsPage() {
  const { fetchWithAuth } = useAuth();
  const [range, setRange] = useState<Range>("30d");

  const [kpis, setKpis] = useState<KPIs | null>(null);
  const [kpisLoading, setKpisLoading] = useState(true);
  const [kpisError, setKpisError] = useState<string | null>(null);

  const [series, setSeries] = useState<Series[] | null>(null);
  const [seriesLoading, setSeriesLoading] = useState(true);

  const [topPages, setTopPages] = useState<TopPage[] | null>(null);
  const [topPagesLoading, setTopPagesLoading] = useState(true);

  const [topEvents, setTopEvents] = useState<TopEvent[] | null>(null);
  const [topEventsLoading, setTopEventsLoading] = useState(true);

  const [topReferrers, setTopReferrers] = useState<TopReferrer[] | null>(null);
  const [topReferrersLoading, setTopReferrersLoading] = useState(true);

  const [topLinks, setTopLinks] = useState<TopLink[] | null>(null);
  const [topLinksLoading, setTopLinksLoading] = useState(true);

  const [live, setLive] = useState<number | null>(null);

  const load = useCallback(async (r: Range) => {
    setKpisLoading(true); setKpisError(null);
    setSeriesLoading(true); setTopPagesLoading(true);
    setTopEventsLoading(true); setTopReferrersLoading(true);
    setTopLinksLoading(true);

    await Promise.allSettled([
      fetchWithAuth(`/api/admin/analytics/kpis?range=${r}`)
        .then(res => res.json() as Promise<KPIs>)
        .then(d => { setKpis(d); setKpisLoading(false); })
        .catch(() => { setKpisError("Could not load KPIs"); setKpisLoading(false); }),

      fetchWithAuth(`/api/admin/analytics/pageviews-series?range=${r}`)
        .then(res => res.json() as Promise<Series[]>)
        .then(d => { setSeries(d); setSeriesLoading(false); })
        .catch(() => setSeriesLoading(false)),

      fetchWithAuth(`/api/admin/analytics/top-pages?range=${r}`)
        .then(res => res.json() as Promise<TopPage[]>)
        .then(d => { setTopPages(d); setTopPagesLoading(false); })
        .catch(() => setTopPagesLoading(false)),

      fetchWithAuth(`/api/admin/analytics/top-events?range=${r}`)
        .then(res => res.json() as Promise<TopEvent[]>)
        .then(d => { setTopEvents(d); setTopEventsLoading(false); })
        .catch(() => setTopEventsLoading(false)),

      fetchWithAuth(`/api/admin/analytics/top-referrers?range=${r}`)
        .then(res => res.json() as Promise<TopReferrer[]>)
        .then(d => { setTopReferrers(d); setTopReferrersLoading(false); })
        .catch(() => setTopReferrersLoading(false)),

      fetchWithAuth(`/api/admin/analytics/top-links?range=${r}`)
        .then(res => res.json() as Promise<TopLink[]>)
        .then(d => { setTopLinks(d); setTopLinksLoading(false); })
        .catch(() => setTopLinksLoading(false)),
    ]);
  }, [fetchWithAuth]);

  useEffect(() => { void load(range); }, [range, load]);

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetchWithAuth("/api/admin/analytics/live");
        if (res.ok) { const d = await res.json() as { live: number }; setLive(d.live); }
      } catch { /* silent */ }
    };
    void poll();
    const id = setInterval(poll, 30_000);
    return () => clearInterval(id);
  }, [fetchWithAuth]);

  const topEventsByType = topEvents
    ? Object.entries(
        topEvents.reduce<Record<string, TopEvent[]>>((acc, e) => {
          const bucket = acc[e.eventType] ?? [];
          bucket.push(e);
          acc[e.eventType] = bucket;
          return acc;
        }, {}),
      ).sort((a, b) => {
        const sumA = a[1].reduce((s, e) => s + e.count, 0);
        const sumB = b[1].reduce((s, e) => s + e.count, 0);
        return sumB - sumA;
      })
    : [];

  return (
    <div className="p-6 max-w-[1280px] space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-[#0A2540]">Site Analytics</h1>
          <p className="text-sm text-gray-500 mt-0.5">First-party traffic data for Shane McCaw Consulting.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Live badge */}
          {live !== null && (
            <div className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold px-3 py-1.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              {live} live now
            </div>
          )}
          {/* Range selector */}
          <div className="flex items-center bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
            {(["today", "7d", "30d", "90d"] as Range[]).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-3 py-1.5 text-xs font-semibold transition-colors ${range === r ? "bg-[#0078D4] text-white" : "text-gray-600 hover:bg-gray-50"}`}
              >
                {RANGE_LABELS[r]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* KPI Ribbon */}
      {kpisLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} h="h-28" />)}
        </div>
      ) : kpisError ? (
        <SectionError message={kpisError} />
      ) : kpis && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            {
              label: "Unique Visitors",
              value: fmt(kpis.visitors),
              icon: "M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z",
              color: "text-[#0078D4] bg-[#0078D4]/10",
            },
            {
              label: "Page Views",
              value: fmt(kpis.pageviews),
              icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
              color: "text-purple-600 bg-purple-100",
            },
            {
              label: "Avg. Time on Page",
              value: fmtTime(kpis.avgTimeOnPage),
              icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
              color: "text-teal-600 bg-teal-100",
            },
            {
              label: "Bounce Rate",
              value: `${kpis.bounceRate}%`,
              icon: "M13 7h8m0 0v8m0-8l-8 8-4-4-6 6",
              color: kpis.bounceRate > 70 ? "text-red-600 bg-red-100" : "text-emerald-600 bg-emerald-100",
            },
          ].map(card => (
            <div key={card.label} className="bg-white border border-gray-100 rounded-xl p-5 flex items-start gap-4 shadow-sm">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${card.color}`}>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={card.icon} />
                </svg>
              </div>
              <div>
                <p className="text-2xl font-bold text-[#0A2540]">{card.value}</p>
                <p className="text-xs text-gray-500 font-medium mt-0.5">{card.label}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pageviews Chart */}
      <section className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
        <h2 className="text-sm font-bold text-[#0A2540] uppercase tracking-widest mb-4">Page Views Over Time</h2>
        {seriesLoading ? (
          <div className="h-56 bg-gray-50 rounded-lg animate-pulse" />
        ) : !series || series.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-16">No data yet — traffic will appear here once visitors arrive.</p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={series} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false}
                tickFormatter={d => { const [, m, day] = d.split("-"); return `${m}/${day}`; }}
              />
              <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false} allowDecimals={false} />
              <RechartsTooltip
                contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
                formatter={(v: number) => [v, "Views"]}
              />
              <Line type="monotone" dataKey="views" stroke="#0078D4" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </section>

      {/* Two-column: Top Pages + Traffic Sources */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Pages */}
        <section className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
          <h2 className="text-sm font-bold text-[#0A2540] uppercase tracking-widest mb-4">Top Pages</h2>
          {topPagesLoading ? (
            <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-8 bg-gray-50 rounded-lg animate-pulse" />)}</div>
          ) : !topPages || topPages.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-8">No page view data yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-2 pr-3 font-semibold text-gray-400 uppercase tracking-widest text-[10px]">Page</th>
                    <th className="text-right py-2 pr-3 font-semibold text-gray-400 uppercase tracking-widest text-[10px]">Views</th>
                    <th className="text-right py-2 pr-3 font-semibold text-gray-400 uppercase tracking-widest text-[10px]">Avg Time</th>
                    <th className="text-right py-2 font-semibold text-gray-400 uppercase tracking-widest text-[10px]">Bounce</th>
                  </tr>
                </thead>
                <tbody>
                  {topPages.map((row, i) => (
                    <tr key={i} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                      <td className="py-2 pr-3 text-[#0A2540] font-medium truncate max-w-[180px]" title={row.page}>{row.page || "/"}</td>
                      <td className="py-2 pr-3 text-right text-gray-600 font-semibold">{fmt(row.views)}</td>
                      <td className="py-2 pr-3 text-right text-gray-500">{row.avgDuration ? fmtTime(row.avgDuration) : "—"}</td>
                      <td className="py-2 text-right">
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${row.bounceRate > 70 ? "bg-red-100 text-red-600" : "bg-gray-100 text-gray-600"}`}>
                          {row.bounceRate}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Traffic Sources */}
        <section className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
          <h2 className="text-sm font-bold text-[#0A2540] uppercase tracking-widest mb-4">Traffic Sources</h2>
          {topReferrersLoading ? (
            <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-8 bg-gray-50 rounded-lg animate-pulse" />)}</div>
          ) : !topReferrers || topReferrers.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-8">No referrer data yet.</p>
          ) : (
            <div className="space-y-2.5">
              {topReferrers.map((row, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-[#0A2540] truncate">{row.source}</span>
                      <span className="text-xs text-gray-500 ml-2 shrink-0">{fmt(row.sessions)} ({row.pct}%)</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                      <div className="h-full rounded-full bg-[#0078D4]" style={{ width: `${row.pct}%` }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Two-column: CTA Events + Outbound Links */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* CTA Events */}
        <section className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
          <h2 className="text-sm font-bold text-[#0A2540] uppercase tracking-widest mb-4">CTA &amp; Click Events</h2>
          {topEventsLoading ? (
            <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-8 bg-gray-50 rounded-lg animate-pulse" />)}</div>
          ) : !topEvents || topEvents.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-8">No click events recorded yet.</p>
          ) : (
            <div className="space-y-4">
              {topEventsByType.slice(0, 4).map(([eventType, events]) => (
                <div key={eventType}>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">
                    {EVENT_TYPE_LABELS[eventType] ?? eventType}
                  </p>
                  <div className="space-y-1">
                    {events.slice(0, 5).map((ev, i) => (
                      <div key={i} className="flex items-center gap-2 py-1">
                        <div className="flex-1 min-w-0">
                          <span className="text-xs text-[#0A2540] font-medium truncate block">{ev.label}</span>
                          <span className="text-[10px] text-gray-400 truncate block">{ev.page}</span>
                        </div>
                        <span className="text-xs font-bold text-gray-600 shrink-0">{fmt(ev.count)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Outbound Links */}
        <section className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
          <h2 className="text-sm font-bold text-[#0A2540] uppercase tracking-widest mb-4">Outbound Link Clicks</h2>
          {topLinksLoading ? (
            <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-8 bg-gray-50 rounded-lg animate-pulse" />)}</div>
          ) : !topLinks || topLinks.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-8">No outbound clicks recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-2 pr-3 font-semibold text-gray-400 uppercase tracking-widest text-[10px]">Label</th>
                    <th className="text-left py-2 pr-3 font-semibold text-gray-400 uppercase tracking-widest text-[10px]">Destination</th>
                    <th className="text-right py-2 font-semibold text-gray-400 uppercase tracking-widest text-[10px]">Clicks</th>
                  </tr>
                </thead>
                <tbody>
                  {topLinks.map((row, i) => (
                    <tr key={i} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                      <td className="py-2 pr-3 text-[#0A2540] font-medium truncate max-w-[140px]">{row.label || "—"}</td>
                      <td className="py-2 pr-3 text-gray-400 truncate max-w-[200px]">
                        <a href={row.href} target="_blank" rel="noopener noreferrer" className="hover:text-[#0078D4] transition-colors">{row.href}</a>
                      </td>
                      <td className="py-2 text-right font-bold text-gray-600">{fmt(row.count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
