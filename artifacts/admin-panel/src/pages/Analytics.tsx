import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
  ComposedChart, Area, ReferenceLine,
  BarChart, Bar, Cell,
} from "recharts";

type Preset = "today" | "7d" | "30d" | "90d";

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
interface TopCta { page: string; label: string; clicks: number; pageViews: number; ctr: number }

interface ForecastRow { period: string; forecast: number; lowerBound: number; upperBound: number }
interface RevenueForecast { rows: ForecastRow[]; narrative: string | null; generatedAt: string | null }

interface CardClickRow { cardName: string; firstClicks: number; pct: number }

type SortDir = "asc" | "desc";

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

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function safeHref(raw: string): string {
  return /^https?:\/\//i.test(raw) ? raw : "";
}

function SkeletonCard({ h = "h-24" }: { h?: string }) {
  return <div className={`${h} bg-[#161B22] border border-[#30363D] rounded-xl animate-pulse`} />;
}

function SectionError({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-400">
      <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      {message}
    </div>
  );
}

function SortBtn({ col, sortCol, sortDir, onSort }: { col: string; sortCol: string; sortDir: SortDir; onSort: (c: string) => void }) {
  const active = sortCol === col;
  return (
    <button onClick={() => onSort(col)} className="inline-flex items-center gap-0.5 group">
      <span className={active ? "text-[#0078D4]" : ""}>{col}</span>
      <svg className={`w-3 h-3 ml-0.5 transition-transform ${active && sortDir === "asc" ? "rotate-180" : ""} ${active ? "text-[#0078D4]" : "text-[#484F58] group-hover:text-[#7D8590]"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
    </button>
  );
}

const PRESET_LABELS: Record<Preset, string> = { today: "Today", "7d": "7d", "30d": "30d", "90d": "90d" };

const EVENT_TYPE_LABELS: Record<string, string> = {
  cta_click: "CTA Click",
  nav_click: "Nav Click",
  outbound_click: "Outbound",
  click: "Click",
  form_submit: "Form Submit",
  scroll_milestone: "Scroll",
};

function fmtUsd(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${Math.round(n).toLocaleString()}`;
}

export default function AnalyticsPage() {
  const { fetchWithAuth } = useAuth();

  const [preset, setPreset] = useState<Preset>("30d");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [isCustom, setIsCustom] = useState(false);

  const [kpis, setKpis] = useState<KPIs | null>(null);
  const [kpisLoading, setKpisLoading] = useState(true);
  const [kpisError, setKpisError] = useState<string | null>(null);

  const [series, setSeries] = useState<Series[] | null>(null);
  const [seriesLoading, setSeriesLoading] = useState(true);

  const [revForecast, setRevForecast] = useState<RevenueForecast | null>(null);
  const [revLoading, setRevLoading] = useState(false);
  const [revGenerating, setRevGenerating] = useState(false);

  const [topPages, setTopPages] = useState<TopPage[] | null>(null);
  const [topPagesLoading, setTopPagesLoading] = useState(true);
  const [topPagesSort, setTopPagesSort] = useState<{ col: string; dir: SortDir }>({ col: "Views", dir: "desc" });

  const [topEvents, setTopEvents] = useState<TopEvent[] | null>(null);
  const [topEventsLoading, setTopEventsLoading] = useState(true);

  const [topReferrers, setTopReferrers] = useState<TopReferrer[] | null>(null);
  const [topReferrersLoading, setTopReferrersLoading] = useState(true);

  const [topLinks, setTopLinks] = useState<TopLink[] | null>(null);
  const [topLinksLoading, setTopLinksLoading] = useState(true);

  const [topCtas, setTopCtas] = useState<TopCta[] | null>(null);
  const [topCtasLoading, setTopCtasLoading] = useState(true);
  const [topCtasSort, setTopCtasSort] = useState<{ col: string; dir: SortDir }>({ col: "Clicks", dir: "desc" });

  const [live, setLive] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<"analytics" | "forecasting" | "engagement">("analytics");

  const [cardClicks, setCardClicks] = useState<CardClickRow[] | null>(null);
  const [cardClicksLoading, setCardClicksLoading] = useState(true);
  const [cardClicksError, setCardClicksError] = useState<string | null>(null);

  function buildQs(extra?: Record<string, string>): string {
    const params = new URLSearchParams(extra ?? {});
    if (isCustom && customStart && customEnd) {
      params.set("start", customStart);
      params.set("end", customEnd);
    } else {
      params.set("range", preset);
    }
    return params.toString();
  }

  const load = useCallback(async (p: Preset, custom: boolean, cStart: string, cEnd: string) => {
    setKpisLoading(true); setKpisError(null);
    setSeriesLoading(true); setTopPagesLoading(true);
    setTopEventsLoading(true); setTopReferrersLoading(true);
    setTopLinksLoading(true); setTopCtasLoading(true);
    setCardClicksLoading(true); setCardClicksError(null);

    function qs(): string {
      const params = new URLSearchParams();
      if (custom && cStart && cEnd) { params.set("start", cStart); params.set("end", cEnd); }
      else { params.set("range", p); }
      return params.toString();
    }

    await Promise.allSettled([
      fetchWithAuth(`/api/admin/analytics/kpis?${qs()}`)
        .then(async res => { const d = await res.json(); if (d && typeof d === "object" && !("error" in d)) { setKpis(d as KPIs); } else { setKpisError("Could not load KPIs"); } setKpisLoading(false); })
        .catch(() => { setKpisError("Could not load KPIs"); setKpisLoading(false); }),

      fetchWithAuth(`/api/admin/analytics/pageviews-series?${qs()}`)
        .then(async res => { const d = await res.json(); setSeries(Array.isArray(d) ? d as Series[] : []); setSeriesLoading(false); })
        .catch(() => { setSeries([]); setSeriesLoading(false); }),

      fetchWithAuth(`/api/admin/analytics/top-pages?${qs()}`)
        .then(async res => { const d = await res.json(); setTopPages(Array.isArray(d) ? d as TopPage[] : []); setTopPagesLoading(false); })
        .catch(() => { setTopPages([]); setTopPagesLoading(false); }),

      fetchWithAuth(`/api/admin/analytics/top-events?${qs()}`)
        .then(async res => { const d = await res.json(); setTopEvents(Array.isArray(d) ? d as TopEvent[] : []); setTopEventsLoading(false); })
        .catch(() => { setTopEvents([]); setTopEventsLoading(false); }),

      fetchWithAuth(`/api/admin/analytics/top-referrers?${qs()}`)
        .then(async res => { const d = await res.json(); setTopReferrers(Array.isArray(d) ? d as TopReferrer[] : []); setTopReferrersLoading(false); })
        .catch(() => { setTopReferrers([]); setTopReferrersLoading(false); }),

      fetchWithAuth(`/api/admin/analytics/top-links?${qs()}`)
        .then(async res => { const d = await res.json(); setTopLinks(Array.isArray(d) ? d as TopLink[] : []); setTopLinksLoading(false); })
        .catch(() => { setTopLinks([]); setTopLinksLoading(false); }),

      fetchWithAuth(`/api/admin/analytics/top-ctas?${qs()}`)
        .then(async res => { const d = await res.json(); setTopCtas(Array.isArray(d) ? d as TopCta[] : []); setTopCtasLoading(false); })
        .catch(() => { setTopCtas([]); setTopCtasLoading(false); }),

      fetchWithAuth(`/api/admin/analytics/card-clicks?${qs()}`)
        .then(async res => { const d = await res.json(); if (Array.isArray(d)) { setCardClicks(d as CardClickRow[]); } else { setCardClicksError("Could not load card click data"); } setCardClicksLoading(false); })
        .catch(() => { setCardClicksError("Could not load card click data"); setCardClicksLoading(false); }),
    ]);
  }, [fetchWithAuth]);

  useEffect(() => {
    if (!isCustom) void load(preset, false, "", "");
  }, [preset, isCustom, load]);

  const loadForecast = useCallback(async () => {
    setRevLoading(true);
    try {
      const res = await fetchWithAuth("/api/analytics/revenue/forecast");
      if (res.ok) setRevForecast(await res.json() as RevenueForecast);
    } catch { /* non-fatal */ }
    finally { setRevLoading(false); }
  }, [fetchWithAuth]);

  const generateForecast = useCallback(async () => {
    setRevGenerating(true);
    try {
      const res = await fetchWithAuth("/api/analytics/revenue/forecast/generate", { method: "POST" });
      if (res.ok) setRevForecast(await res.json() as RevenueForecast);
    } catch { /* non-fatal */ }
    finally { setRevGenerating(false); }
  }, [fetchWithAuth]);

  useEffect(() => { void loadForecast(); }, [loadForecast]);

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

  function sortedPages(): TopPage[] {
    if (!topPages) return [];
    const { col, dir } = topPagesSort;
    return [...topPages].sort((a, b) => {
      let av = 0, bv = 0;
      if (col === "Views") { av = a.views; bv = b.views; }
      else if (col === "Avg Time") { av = a.avgDuration ?? 0; bv = b.avgDuration ?? 0; }
      else if (col === "Bounce") { av = a.bounceRate; bv = b.bounceRate; }
      return dir === "desc" ? bv - av : av - bv;
    });
  }

  function sortedCtas(): TopCta[] {
    if (!topCtas) return [];
    const { col, dir } = topCtasSort;
    return [...topCtas].sort((a, b) => {
      let av = 0, bv = 0;
      if (col === "Clicks") { av = a.clicks; bv = b.clicks; }
      else if (col === "Views") { av = a.pageViews; bv = b.pageViews; }
      else if (col === "CTR") { av = a.ctr; bv = b.ctr; }
      return dir === "desc" ? bv - av : av - bv;
    });
  }

  function toggleSort(state: { col: string; dir: SortDir }, col: string): { col: string; dir: SortDir } {
    if (state.col === col) return { col, dir: state.dir === "desc" ? "asc" : "desc" };
    return { col, dir: "desc" };
  }

  return (
    <div className="p-4 sm:p-6 max-w-[1280px] space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-[#E6EDF3]">Site Analytics</h1>
          <p className="text-sm text-[#7D8590] mt-0.5">First-party traffic data for Shane McCaw Consulting.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Live badge */}
          {live !== null && (
            <div className="flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold px-3 py-1.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              {live} live now
            </div>
          )}
          {/* Range selector — presets + custom */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center bg-[#161B22] border border-[#30363D] rounded-lg overflow-hidden shadow-sm">
              {(["today", "7d", "30d", "90d"] as Preset[]).map((r) => (
                <button
                  key={r}
                  onClick={() => { setPreset(r); setIsCustom(false); }}
                  className={`px-3 py-1.5 text-xs font-semibold transition-colors ${!isCustom && preset === r ? "bg-[#0078D4] text-white" : "text-[#7D8590] hover:bg-[#1C2128]"}`}
                >
                  {PRESET_LABELS[r]}
                </button>
              ))}
              <button
                onClick={() => {
                  if (!customStart) setCustomStart(isoDate(new Date(Date.now() - 30 * 86400_000)));
                  if (!customEnd) setCustomEnd(isoDate(new Date()));
                  setIsCustom(true);
                }}
                className={`px-3 py-1.5 text-xs font-semibold transition-colors border-l border-[#30363D] ${isCustom ? "bg-[#0078D4] text-white" : "text-[#7D8590] hover:bg-[#1C2128]"}`}
              >
                Custom
              </button>
            </div>
            {isCustom && (
              <div className="flex items-center gap-1.5 bg-[#161B22] border border-[#30363D] rounded-lg px-2 py-1 shadow-sm">
                <input type="date" value={customStart} max={customEnd || isoDate(new Date())}
                  onChange={e => setCustomStart(e.target.value)}
                  className="text-xs text-[#C9D1D9] border-0 outline-none bg-transparent cursor-pointer"
                />
                <span className="text-[#7D8590] text-xs">→</span>
                <input type="date" value={customEnd} min={customStart} max={isoDate(new Date())}
                  onChange={e => setCustomEnd(e.target.value)}
                  className="text-xs text-[#C9D1D9] border-0 outline-none bg-transparent cursor-pointer"
                />
                <button
                  onClick={() => { if (customStart && customEnd) void load(preset, true, customStart, customEnd); }}
                  disabled={!customStart || !customEnd}
                  className="ml-1 px-2 py-0.5 text-[10px] font-bold bg-[#0078D4] text-white rounded hover:bg-[#005A9E] disabled:opacity-40 transition-colors"
                >
                  Apply
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="flex items-center border-b border-[#30363D] -mt-2 mb-2">
        {([
          { id: "analytics", label: "Site Analytics" },
          { id: "engagement", label: "Portal Engagement" },
          { id: "forecasting", label: "Revenue Forecasting" },
        ] as const).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-xs font-semibold transition-colors border-b-2 -mb-px ${
              activeTab === tab.id
                ? "border-[#0078D4] text-[#58A6FF]"
                : "border-transparent text-[#7D8590] hover:text-[#E6EDF3]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "analytics" && (<>
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
              color: "text-purple-400 bg-purple-500/15",
            },
            {
              label: "Avg. Time on Page",
              value: fmtTime(kpis.avgTimeOnPage),
              icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
              color: "text-teal-400 bg-teal-500/15",
            },
            {
              label: "Bounce Rate",
              value: `${kpis.bounceRate}%`,
              icon: "M13 7h8m0 0v8m0-8l-8 8-4-4-6 6",
              color: kpis.bounceRate > 70 ? "text-red-400 bg-red-500/15" : "text-emerald-400 bg-emerald-500/15",
            },
          ].map(card => (
            <div key={card.label} className="bg-[#161B22] border border-[#30363D] rounded-xl p-5 flex items-start gap-4 shadow-sm">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${card.color}`}>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={card.icon} />
                </svg>
              </div>
              <div>
                <p className="text-2xl font-bold text-[#E6EDF3]">{card.value}</p>
                <p className="text-xs text-[#7D8590] font-medium mt-0.5">{card.label}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pageviews Chart */}
      <section className="bg-[#161B22] border border-[#30363D] rounded-xl p-5 shadow-sm">
        <h2 className="text-sm font-bold text-[#E6EDF3] uppercase tracking-widest mb-4">Page Views Over Time</h2>
        {seriesLoading ? (
          <div className="h-56 bg-[#161B22] rounded-lg animate-pulse" />
        ) : !series || series.length === 0 ? (
          <p className="text-sm text-[#7D8590] text-center py-16">No data yet — traffic will appear here once visitors arrive.</p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={series} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#30363D" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#7D8590" }} axisLine={false} tickLine={false}
                tickFormatter={(d: string) => { const [, m, day] = d.split("-"); return `${m}/${day}`; }}
              />
              <YAxis tick={{ fontSize: 10, fill: "#7D8590" }} axisLine={false} tickLine={false} allowDecimals={false} />
              <RechartsTooltip
                contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #30363D", background: "#1C2128", color: "#E6EDF3" }}
                formatter={(v: number) => [v, "Views"]}
              />
              <Line type="monotone" dataKey="views" stroke="#0078D4" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </section>

      {/* Two-column: Top Pages + Traffic Sources */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Pages — sortable */}
        <section className="bg-[#161B22] border border-[#30363D] rounded-xl p-5 shadow-sm">
          <h2 className="text-sm font-bold text-[#E6EDF3] uppercase tracking-widest mb-4">Top Pages</h2>
          {topPagesLoading ? (
            <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-8 bg-[#161B22] rounded-lg animate-pulse" />)}</div>
          ) : !topPages || topPages.length === 0 ? (
            <p className="text-xs text-[#7D8590] text-center py-8">No page view data yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[#30363D]">
                    <th className="text-left py-2 pr-3 font-semibold text-[#7D8590] uppercase tracking-widest text-[10px]">Page</th>
                    {(["Views", "Avg Time", "Bounce"] as const).map(col => (
                      <th key={col} className="text-right py-2 pr-3 font-semibold text-[#7D8590] uppercase tracking-widest text-[10px] cursor-pointer select-none">
                        <SortBtn col={col} sortCol={topPagesSort.col} sortDir={topPagesSort.dir}
                          onSort={c => setTopPagesSort(s => toggleSort(s, c))} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedPages().map((row, i) => (
                    <tr key={i} className="border-b border-[#30363D] hover:bg-[#1C2128] transition-colors">
                      <td className="py-2 pr-3 text-[#E6EDF3] font-medium truncate max-w-[180px]" title={row.page}>{row.page || "/"}</td>
                      <td className="py-2 pr-3 text-right text-[#7D8590] font-semibold">{fmt(row.views)}</td>
                      <td className="py-2 pr-3 text-right text-[#7D8590]">{row.avgDuration ? fmtTime(row.avgDuration) : "—"}</td>
                      <td className="py-2 text-right">
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${row.bounceRate > 70 ? "bg-red-500/15 text-red-400" : "bg-[#30363D]/50 text-[#7D8590]"}`}>
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
        <section className="bg-[#161B22] border border-[#30363D] rounded-xl p-5 shadow-sm">
          <h2 className="text-sm font-bold text-[#E6EDF3] uppercase tracking-widest mb-4">Traffic Sources</h2>
          {topReferrersLoading ? (
            <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-8 bg-[#161B22] rounded-lg animate-pulse" />)}</div>
          ) : !topReferrers || topReferrers.length === 0 ? (
            <p className="text-xs text-[#7D8590] text-center py-8">No referrer data yet.</p>
          ) : (
            <div className="space-y-2.5">
              {topReferrers.map((row, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-[#E6EDF3] truncate">{row.source}</span>
                      <span className="text-xs text-[#7D8590] ml-2 shrink-0">{fmt(row.sessions)} ({row.pct}%)</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-[#30363D] overflow-hidden">
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
        <section className="bg-[#161B22] border border-[#30363D] rounded-xl p-5 shadow-sm">
          <h2 className="text-sm font-bold text-[#E6EDF3] uppercase tracking-widest mb-4">CTA &amp; Click Events</h2>
          {topEventsLoading ? (
            <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-8 bg-[#161B22] rounded-lg animate-pulse" />)}</div>
          ) : !topEvents || topEvents.length === 0 ? (
            <p className="text-xs text-[#7D8590] text-center py-8">No click events recorded yet.</p>
          ) : (
            <div className="space-y-4">
              {topEventsByType.slice(0, 4).map(([eventType, events]) => (
                <div key={eventType}>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#7D8590] mb-2">
                    {EVENT_TYPE_LABELS[eventType] ?? eventType}
                  </p>
                  <div className="space-y-1">
                    {events.slice(0, 5).map((ev, i) => (
                      <div key={i} className="flex items-center gap-2 py-1">
                        <div className="flex-1 min-w-0">
                          <span className="text-xs text-[#E6EDF3] font-medium truncate block">{ev.label}</span>
                          <span className="text-[10px] text-[#7D8590] truncate block">{ev.page}</span>
                        </div>
                        <span className="text-xs font-bold text-[#7D8590] shrink-0">{fmt(ev.count)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Outbound Links — sanitized hrefs */}
        <section className="bg-[#161B22] border border-[#30363D] rounded-xl p-5 shadow-sm">
          <h2 className="text-sm font-bold text-[#E6EDF3] uppercase tracking-widest mb-4">Outbound Link Clicks</h2>
          {topLinksLoading ? (
            <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-8 bg-[#161B22] rounded-lg animate-pulse" />)}</div>
          ) : !topLinks || topLinks.length === 0 ? (
            <p className="text-xs text-[#7D8590] text-center py-8">No outbound clicks recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[#30363D]">
                    <th className="text-left py-2 pr-3 font-semibold text-[#7D8590] uppercase tracking-widest text-[10px]">Label</th>
                    <th className="text-left py-2 pr-3 font-semibold text-[#7D8590] uppercase tracking-widest text-[10px]">Destination</th>
                    <th className="text-right py-2 font-semibold text-[#7D8590] uppercase tracking-widest text-[10px]">Clicks</th>
                  </tr>
                </thead>
                <tbody>
                  {topLinks.map((row, i) => {
                    const href = safeHref(row.href);
                    return (
                      <tr key={i} className="border-b border-[#30363D] hover:bg-[#1C2128] transition-colors">
                        <td className="py-2 pr-3 text-[#E6EDF3] font-medium truncate max-w-[140px]">{row.label || "—"}</td>
                        <td className="py-2 pr-3 text-[#7D8590] truncate max-w-[200px]">
                          {href
                            ? <a href={href} target="_blank" rel="noopener noreferrer" className="hover:text-[#0078D4] transition-colors">{href}</a>
                            : <span className="text-[#484F58] italic text-[10px]">{row.href ? "(non-http url)" : "—"}</span>
                          }
                        </td>
                        <td className="py-2 text-right font-bold text-[#7D8590]">{fmt(row.count)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      </>)}

      {/* ── Forecasting Tab ── */}
      {activeTab === "forecasting" && (
      <section className="bg-[#161B22] border border-[#30363D] rounded-xl p-5 shadow-sm">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <div>
            <h2 className="text-sm font-bold text-[#E6EDF3] uppercase tracking-widest">12-Month Revenue Forecast</h2>
            <p className="text-[10px] text-[#7D8590] mt-0.5">AI-powered forecast with confidence bands based on historical invoices &amp; MRR</p>
          </div>
          <div className="flex items-center gap-2">
            {revForecast?.generatedAt && (
              <span className="text-[10px] text-[#484F58]">Updated {new Date(revForecast.generatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
            )}
            <button
              onClick={() => void generateForecast()}
              disabled={revGenerating}
              className="flex items-center gap-1.5 text-xs font-semibold bg-[#0078D4] text-white px-3 py-1.5 rounded-lg hover:bg-[#0078D4]/80 disabled:opacity-50 transition-colors"
            >
              {revGenerating ? (
                <><svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>Generating…</>
              ) : (
                <><svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>Generate Forecast</>
              )}
            </button>
          </div>
        </div>

        {revLoading ? (
          <div className="h-64 bg-[#1C2128] rounded-xl animate-pulse" />
        ) : !revForecast || revForecast.rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-12 h-12 rounded-xl bg-[#0078D4]/15 flex items-center justify-center mb-3">
              <svg className="w-6 h-6 text-[#58A6FF]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-[#E6EDF3]">No forecast yet</p>
            <p className="text-xs text-[#7D8590] mt-1 max-w-[260px]">Click Generate Forecast to have Claude analyze your revenue history and predict the next 12 months.</p>
          </div>
        ) : (
          <>
            {revForecast.narrative && (
              <div className="bg-[#0078D4]/10 border border-[#0078D4]/20 rounded-xl px-4 py-3 mb-5 flex items-start gap-2">
                <svg className="w-4 h-4 text-[#58A6FF] flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                <p className="text-xs text-[#E6EDF3]/90 leading-relaxed">{revForecast.narrative}</p>
              </div>
            )}

            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={revForecast.rows} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="forecastGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0078D4" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#0078D4" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="bandGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#7C3AED" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#7C3AED" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#30363D" vertical={false} />
                <XAxis dataKey="period" tick={{ fontSize: 9, fill: "#7D8590" }} axisLine={false} tickLine={false}
                  tickFormatter={v => { const [y, m] = (v as string).split("-"); return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][parseInt(m)-1]} ${String(y).slice(2)}`; }} />
                <YAxis tick={{ fontSize: 9, fill: "#7D8590" }} axisLine={false} tickLine={false}
                  tickFormatter={v => fmtUsd(v as number)} />
                <RechartsTooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #30363D", background: "#1C2128", color: "#E6EDF3" }}
                  formatter={(v: number, name: string) => [fmtUsd(v), name === "forecast" ? "Forecast" : name === "upperBound" ? "Upper Band" : "Lower Band"]} />
                <Area type="monotone" dataKey="upperBound" stroke="transparent" fill="url(#bandGrad)" strokeWidth={0} name="upperBound" />
                <Area type="monotone" dataKey="forecast" stroke="#0078D4" fill="url(#forecastGrad)" strokeWidth={2} name="forecast" dot={false} />
                <Area type="monotone" dataKey="lowerBound" stroke="transparent" fill="transparent" strokeWidth={0} name="lowerBound" />
                <ReferenceLine y={revForecast.rows[0]?.forecast ?? 0} stroke="#7D8590" strokeDasharray="4 4" strokeWidth={1} />
              </ComposedChart>
            </ResponsiveContainer>

            {/* Full 12-month table */}
            <div className="mt-6 pt-5 border-t border-[#30363D]">
              <h3 className="text-xs font-bold text-[#7D8590] uppercase tracking-widest mb-3">Monthly Breakdown — All 12 Months</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[#30363D]">
                      <th className="text-left py-2 pr-4 font-semibold text-[#7D8590] uppercase tracking-widest text-[10px]">Month</th>
                      <th className="text-right py-2 pr-4 font-semibold text-[#7D8590] uppercase tracking-widest text-[10px]">Forecast</th>
                      <th className="text-right py-2 pr-4 font-semibold text-[#7D8590] uppercase tracking-widest text-[10px]">Lower Bound</th>
                      <th className="text-right py-2 pr-4 font-semibold text-[#7D8590] uppercase tracking-widest text-[10px]">Upper Bound</th>
                      <th className="text-right py-2 font-semibold text-[#7D8590] uppercase tracking-widest text-[10px]">Range</th>
                    </tr>
                  </thead>
                  <tbody>
                    {revForecast.rows.map((r, i) => {
                      const [y, m] = r.period.split("-");
                      const label = `${["January","February","March","April","May","June","July","August","September","October","November","December"][parseInt(m)-1]} ${y}`;
                      const range = r.upperBound - r.lowerBound;
                      const isFirst = i === 0;
                      return (
                        <tr key={r.period} className={`border-b border-[#30363D] hover:bg-[#1C2128] transition-colors ${isFirst ? "bg-[#0078D4]/5" : ""}`}>
                          <td className="py-2.5 pr-4 font-medium text-[#E6EDF3]">
                            {isFirst && <span className="text-[9px] font-bold text-[#0078D4] bg-[#0078D4]/10 px-1 py-0.5 rounded mr-1.5">Next</span>}
                            {label}
                          </td>
                          <td className="py-2.5 pr-4 text-right font-bold text-[#E6EDF3]">{fmtUsd(r.forecast)}</td>
                          <td className="py-2.5 pr-4 text-right text-[#7D8590]">{fmtUsd(r.lowerBound)}</td>
                          <td className="py-2.5 pr-4 text-right text-[#7D8590]">{fmtUsd(r.upperBound)}</td>
                          <td className="py-2.5 text-right text-[#484F58] text-[10px]">±{fmtUsd(range / 2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-[#30363D]">
                      <td className="pt-3 pr-4 text-[10px] font-bold text-[#7D8590] uppercase tracking-widest">12-Month Total</td>
                      <td className="pt-3 pr-4 text-right font-bold text-[#E6EDF3]">{fmtUsd(revForecast.rows.reduce((s, r) => s + r.forecast, 0))}</td>
                      <td className="pt-3 pr-4 text-right text-[#7D8590]">{fmtUsd(revForecast.rows.reduce((s, r) => s + r.lowerBound, 0))}</td>
                      <td className="pt-3 pr-4 text-right text-[#7D8590]">{fmtUsd(revForecast.rows.reduce((s, r) => s + r.upperBound, 0))}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </>
        )}
      </section>
      )}

      {/* ── Portal Engagement Tab ── */}
      {activeTab === "engagement" && (
      <div className="space-y-6">
        <section className="bg-[#161B22] border border-[#30363D] rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between flex-wrap gap-3 mb-1">
            <div>
              <h2 className="text-sm font-bold text-[#E6EDF3] uppercase tracking-widest">Overview Card Engagement</h2>
              <p className="text-[10px] text-[#7D8590] mt-0.5">
                Which overview card did each client click <em>first</em> — aggregated across all Quick Win presentations.
              </p>
            </div>
          </div>

          {cardClicksLoading ? (
            <div className="space-y-3 mt-5">
              {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-10 bg-[#1C2128] rounded-lg animate-pulse" />)}
            </div>
          ) : cardClicksError ? (
            <SectionError message={cardClicksError} />
          ) : !cardClicks || cardClicks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <div className="w-12 h-12 rounded-xl bg-[#0078D4]/15 flex items-center justify-center mb-3">
                <svg className="w-6 h-6 text-[#58A6FF]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5" />
                </svg>
              </div>
              <p className="text-sm font-semibold text-[#E6EDF3]">No card-click data yet</p>
              <p className="text-xs text-[#7D8590] mt-1 max-w-[280px]">
                First-click events will appear here once clients interact with the Quick Win overview cards.
              </p>
            </div>
          ) : (
            <>
              {/* Summary KPI strip */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 mb-6">
                {cardClicks.map((row, i) => {
                  const COLORS = ["#0078D4", "#00B4D8", "#7C3AED", "#10B981"];
                  const color = COLORS[i % COLORS.length];
                  return (
                    <div key={row.cardName} className="bg-[#1C2128] border border-[#30363D] rounded-xl p-4 flex flex-col gap-1">
                      <p className="text-2xl font-bold text-[#E6EDF3]">{row.pct}%</p>
                      <p className="text-xs font-semibold truncate" style={{ color }}>{row.cardName}</p>
                      <p className="text-[10px] text-[#7D8590]">{row.firstClicks} first {row.firstClicks === 1 ? "click" : "clicks"}</p>
                    </div>
                  );
                })}
              </div>

              {/* Horizontal bar chart */}
              <div className="mb-2">
                <h3 className="text-[10px] font-bold text-[#7D8590] uppercase tracking-widest mb-3">First-Click Distribution</h3>
                <ResponsiveContainer width="100%" height={Math.max(120, cardClicks.length * 48)}>
                  <BarChart
                    data={cardClicks}
                    layout="vertical"
                    margin={{ top: 0, right: 60, left: 0, bottom: 0 }}
                  >
                    <XAxis type="number" hide domain={[0, 100]} />
                    <YAxis
                      type="category"
                      dataKey="cardName"
                      tick={{ fontSize: 11, fill: "#C9D1D9" }}
                      axisLine={false}
                      tickLine={false}
                      width={110}
                    />
                    <RechartsTooltip
                      contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #30363D", background: "#1C2128", color: "#E6EDF3" }}
                      formatter={(v: number, _name: string, props: { payload?: CardClickRow }) => [
                        `${v}% (${props.payload?.firstClicks ?? 0} first ${(props.payload?.firstClicks ?? 0) === 1 ? "click" : "clicks"})`,
                        "First Click",
                      ]}
                    />
                    <Bar dataKey="pct" radius={[0, 4, 4, 0]} label={{ position: "right", fontSize: 11, fill: "#7D8590", formatter: (v: number) => `${v}%` }}>
                      {cardClicks.map((_row, i) => {
                        const COLORS = ["#0078D4", "#00B4D8", "#7C3AED", "#10B981"];
                        return <Cell key={i} fill={COLORS[i % COLORS.length]} />;
                      })}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Table breakdown */}
              <div className="mt-4 pt-4 border-t border-[#30363D]">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[#30363D]">
                      <th className="text-left py-2 pr-4 font-semibold text-[#7D8590] uppercase tracking-widest text-[10px]">Card</th>
                      <th className="text-right py-2 pr-4 font-semibold text-[#7D8590] uppercase tracking-widest text-[10px]">First Clicks</th>
                      <th className="text-right py-2 font-semibold text-[#7D8590] uppercase tracking-widest text-[10px]">Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cardClicks.map((row, i) => {
                      const COLORS = ["#0078D4", "#00B4D8", "#7C3AED", "#10B981"];
                      const color = COLORS[i % COLORS.length];
                      return (
                        <tr key={row.cardName} className="border-b border-[#30363D] hover:bg-[#1C2128] transition-colors">
                          <td className="py-2.5 pr-4 font-medium text-[#E6EDF3] flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full inline-block shrink-0" style={{ backgroundColor: color }} />
                            {row.cardName}
                          </td>
                          <td className="py-2.5 pr-4 text-right font-bold text-[#C9D1D9]">{row.firstClicks}</td>
                          <td className="py-2.5 text-right">
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${row.pct >= 40 ? "bg-[#0078D4]/15 text-[#58A6FF]" : "bg-[#30363D]/50 text-[#7D8590]"}`}>
                              {row.pct}%
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-[#30363D]">
                      <td className="pt-3 pr-4 text-[10px] font-bold text-[#7D8590] uppercase tracking-widest">Total</td>
                      <td className="pt-3 pr-4 text-right font-bold text-[#E6EDF3]">{cardClicks.reduce((s, r) => s + r.firstClicks, 0)}</td>
                      <td className="pt-3 text-right text-[10px] text-[#7D8590]">100%</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </section>
      </div>
      )}

      {activeTab === "analytics" && (
      <>{/* Top CTAs with CTR — sortable */}
      <section className="bg-[#161B22] border border-[#30363D] rounded-xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-[#E6EDF3] uppercase tracking-widest">Top CTAs — Click-Through Rates</h2>
          <span className="text-[10px] text-[#7D8590]">CTR = clicks ÷ page views</span>
        </div>
        {topCtasLoading ? (
          <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-8 bg-[#161B22] rounded-lg animate-pulse" />)}</div>
        ) : !topCtas || topCtas.length === 0 ? (
          <p className="text-xs text-[#7D8590] text-center py-8">No CTA click data yet — CTAs and nav links will appear here once visitors click them.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[#30363D]">
                  <th className="text-left py-2 pr-3 font-semibold text-[#7D8590] uppercase tracking-widest text-[10px]">CTA Label</th>
                  <th className="text-left py-2 pr-3 font-semibold text-[#7D8590] uppercase tracking-widest text-[10px]">Page</th>
                  {(["Clicks", "Views", "CTR"] as const).map(col => (
                    <th key={col} className="text-right py-2 pr-3 font-semibold text-[#7D8590] uppercase tracking-widest text-[10px] cursor-pointer select-none">
                      <SortBtn col={col} sortCol={topCtasSort.col} sortDir={topCtasSort.dir}
                        onSort={c => setTopCtasSort(s => toggleSort(s, c))} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedCtas().map((row, i) => (
                  <tr key={i} className="border-b border-[#30363D] hover:bg-[#1C2128] transition-colors">
                    <td className="py-2 pr-3 text-[#E6EDF3] font-medium truncate max-w-[180px]">{row.label}</td>
                    <td className="py-2 pr-3 text-[#7D8590] truncate max-w-[160px]">{row.page || "/"}</td>
                    <td className="py-2 pr-3 text-right font-semibold text-[#C9D1D9]">{fmt(row.clicks)}</td>
                    <td className="py-2 pr-3 text-right text-[#7D8590]">{fmt(row.pageViews)}</td>
                    <td className="py-2 text-right">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${row.ctr >= 5 ? "bg-emerald-500/15 text-emerald-400" : row.ctr >= 2 ? "bg-blue-500/15 text-[#0078D4]" : "bg-[#30363D]/50 text-[#7D8590]"}`}>
                        {row.ctr}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      </>)}
    </div>
  );
}
