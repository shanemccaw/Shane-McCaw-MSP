import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

type Preset = "today" | "7d" | "30d" | "90d";
type DeviceFilter = "all" | "desktop" | "tablet" | "mobile";

interface PageOption {
  page: string;
  positionedEvents: number;
  pageviews: number;
}

interface Cell { col: number; row: number; count: number }

interface HeatmapResponse {
  page: string;
  deviceTypeFilter: DeviceFilter;
  grid: { cols: number; rows: number };
  referenceWidthsPx: Record<string, number>;
  maxYPx: number;
  totals: { clicks: number; friction: number; pageviews: number };
  clickCells: Cell[];
  frictionCells: Cell[];
  scrollDepth: { bandPct: number; reachedPct: number }[];
}

const PRESET_LABELS: Record<Preset, string> = { today: "Today", "7d": "7d", "30d": "30d", "90d": "90d" };
const DEVICE_LABELS: Record<DeviceFilter, string> = { all: "All devices", desktop: "Desktop", tablet: "Tablet", mobile: "Mobile" };

const PRIMARY_RGB = "47, 111, 237"; // --primary #2F6FED
const FRICTION_RGB = "239, 68, 68"; // --destructive #EF4444

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toString();
}

// Human-readable zone label from grid position — the accessible "table" fallback
// for the color-encoded grid (a reader who can't distinguish the heat colors can
// still read "upper-left", "middle", etc.)
function zoneLabel(col: number, row: number, cols: number, rows: number): string {
  const colPct = (col / cols) * 100;
  const rowPct = (row / rows) * 100;
  const h = colPct < 33 ? "left" : colPct < 66 ? "center" : "right";
  const v = rowPct < 20 ? "very top" : rowPct < 40 ? "upper" : rowPct < 60 ? "middle" : rowPct < 80 ? "lower" : "bottom";
  return `${v}, ${h}`;
}

function SkeletonCard({ h = "h-24" }: { h?: string }) {
  return <div className={`${h} bg-card border border-border rounded-xl animate-pulse`} />;
}

function SectionError({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-xl text-xs text-destructive">
      <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      {message}
    </div>
  );
}

export default function AnalyticsHeatmapPage() {
  const { fetchWithAuth } = useAuth();

  const [preset, setPreset] = useState<Preset>("30d");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [isCustom, setIsCustom] = useState(false);

  const [deviceType, setDeviceType] = useState<DeviceFilter>("all");

  const [pageOptions, setPageOptions] = useState<PageOption[] | null>(null);
  const [pageOptionsLoading, setPageOptionsLoading] = useState(true);
  const [selectedPage, setSelectedPage] = useState<string | null>(null);

  const [data, setData] = useState<HeatmapResponse | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);

  const [hover, setHover] = useState<{ x: number; y: number; col: number; row: number; clicks: number; friction: number } | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);

  function rangeQs(): string {
    const params = new URLSearchParams();
    if (isCustom && customStart && customEnd) { params.set("start", customStart); params.set("end", customEnd); }
    else { params.set("range", preset); }
    return params.toString();
  }

  // Load the page picker (which pages actually have positioned click data in this window)
  useEffect(() => {
    setPageOptionsLoading(true);
    fetchWithAuth(`/api/admin/analytics/heatmap/pages?${rangeQs()}`)
      .then(async res => {
        const d = await res.json();
        const list = Array.isArray(d) ? d as PageOption[] : [];
        setPageOptions(list);
        setSelectedPage(prev => {
          if (prev && list.some(p => p.page === prev)) return prev;
          return list[0]?.page ?? null;
        });
      })
      .catch(() => { setPageOptions([]); })
      .finally(() => setPageOptionsLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, isCustom, customStart, customEnd, fetchWithAuth]);

  const loadHeatmap = useCallback(async (page: string) => {
    setDataLoading(true); setDataError(null);
    try {
      const params = new URLSearchParams(rangeQs());
      params.set("page", page);
      params.set("deviceType", deviceType);
      const res = await fetchWithAuth(`/api/admin/analytics/heatmap?${params.toString()}`);
      if (!res.ok) { setDataError("Could not load heatmap data"); setData(null); return; }
      setData(await res.json() as HeatmapResponse);
    } catch {
      setDataError("Could not load heatmap data");
      setData(null);
    } finally {
      setDataLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchWithAuth, deviceType, preset, isCustom, customStart, customEnd]);

  useEffect(() => {
    if (selectedPage) void loadHeatmap(selectedPage);
  }, [selectedPage, loadHeatmap]);

  const cellLookup = useMemo(() => {
    const map = new Map<string, { clicks: number; friction: number }>();
    if (!data) return map;
    for (const c of data.clickCells) {
      const key = `${c.col},${c.row}`;
      const existing = map.get(key) ?? { clicks: 0, friction: 0 };
      existing.clicks += c.count;
      map.set(key, existing);
    }
    for (const c of data.frictionCells) {
      const key = `${c.col},${c.row}`;
      const existing = map.get(key) ?? { clicks: 0, friction: 0 };
      existing.friction += c.count;
      map.set(key, existing);
    }
    return map;
  }, [data]);

  const maxClickCount = useMemo(() => Math.max(1, ...(data?.clickCells.map(c => c.count) ?? [1])), [data]);
  const maxFrictionCount = useMemo(() => Math.max(1, ...(data?.frictionCells.map(c => c.count) ?? [1])), [data]);

  const topHotspots = useMemo(() => {
    if (!data) return [];
    return [...cellLookup.entries()]
      .map(([key, v]) => {
        const [col, row] = key.split(",").map(Number);
        return { col, row, ...v };
      })
      .sort((a, b) => (b.clicks + b.friction) - (a.clicks + a.friction))
      .slice(0, 8);
  }, [cellLookup, data]);

  const cols = data?.grid.cols ?? 24;
  const rows = data?.grid.rows ?? 32;

  return (
    <div className="p-4 sm:p-6 max-w-[1280px] space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-foreground">Heatmap Visualization</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Click density and scroll attention, aggregated from the raw capture already live on the public site.
        </p>
      </div>

      {/* Filter row — page, range, device (one row above the content, per convention) */}
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={selectedPage ?? ""}
          onChange={e => setSelectedPage(e.target.value || null)}
          disabled={pageOptionsLoading || !pageOptions || pageOptions.length === 0}
          className="text-xs bg-card border border-border text-foreground/90 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary max-w-[260px] disabled:opacity-50"
        >
          {pageOptionsLoading && <option>Loading pages…</option>}
          {!pageOptionsLoading && (!pageOptions || pageOptions.length === 0) && <option>No pages with click data yet</option>}
          {pageOptions?.map(p => (
            <option key={p.page} value={p.page}>{p.page || "/"} ({fmt(p.positionedEvents)} events)</option>
          ))}
        </select>

        <div className="flex items-center bg-card border border-border rounded-lg overflow-hidden shadow-sm">
          {(["today", "7d", "30d", "90d"] as Preset[]).map(r => (
            <button
              key={r}
              onClick={() => { setPreset(r); setIsCustom(false); }}
              className={`px-3 py-1.5 text-xs font-semibold transition-colors ${!isCustom && preset === r ? "bg-primary text-white" : "text-muted-foreground hover:bg-accent"}`}
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
            className={`px-3 py-1.5 text-xs font-semibold transition-colors border-l border-border ${isCustom ? "bg-primary text-white" : "text-muted-foreground hover:bg-accent"}`}
          >
            Custom
          </button>
        </div>
        {isCustom && (
          <div className="flex items-center gap-1.5 bg-card border border-border rounded-lg px-2 py-1 shadow-sm">
            <input type="date" value={customStart} max={customEnd || isoDate(new Date())}
              onChange={e => setCustomStart(e.target.value)}
              className="text-xs text-foreground/90 border-0 outline-none bg-transparent cursor-pointer" />
            <span className="text-muted-foreground text-xs">→</span>
            <input type="date" value={customEnd} min={customStart} max={isoDate(new Date())}
              onChange={e => setCustomEnd(e.target.value)}
              className="text-xs text-foreground/90 border-0 outline-none bg-transparent cursor-pointer" />
          </div>
        )}

        <div className="flex items-center bg-card border border-border rounded-lg overflow-hidden shadow-sm ml-auto">
          {(["all", "desktop", "tablet", "mobile"] as DeviceFilter[]).map(d => (
            <button
              key={d}
              onClick={() => setDeviceType(d)}
              className={`px-3 py-1.5 text-xs font-semibold transition-colors ${deviceType === d ? "bg-primary text-white" : "text-muted-foreground hover:bg-accent"}`}
            >
              {DEVICE_LABELS[d]}
            </button>
          ))}
        </div>
      </div>

      {/* Stat tiles */}
      {dataLoading && !data ? (
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} h="h-20" />)}
        </div>
      ) : dataError ? (
        <SectionError message={dataError} />
      ) : data && (
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-card border border-border rounded-xl p-4">
            <p className="text-2xl font-bold text-foreground">{fmt(data.totals.pageviews)}</p>
            <p className="text-xs text-muted-foreground font-medium mt-0.5">Pageviews in range</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <p className="text-2xl font-bold text-foreground">{fmt(data.totals.clicks)}</p>
            <p className="text-xs text-muted-foreground font-medium mt-0.5">Clicks tracked</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <p className="text-2xl font-bold" style={{ color: data.totals.friction > 0 ? `rgb(${FRICTION_RGB})` : undefined }}>
              {fmt(data.totals.friction)}
            </p>
            <p className="text-xs text-muted-foreground font-medium mt-0.5">Rage / dead clicks (friction)</p>
          </div>
        </div>
      )}

      {/* Heatmap grid */}
      <section className="bg-card border border-border rounded-xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div>
            <h2 className="text-sm font-bold text-foreground uppercase tracking-widest">Click Density</h2>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {selectedPage ? `${selectedPage || "/"} — approximate page layout, top to bottom` : "Select a page"}
            </p>
          </div>
          {/* Legend */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <div className="w-16 h-2.5 rounded-full" style={{
                background: `linear-gradient(90deg, rgba(${PRIMARY_RGB},0.06), rgba(${PRIMARY_RGB},0.95))`,
              }} />
              <span className="text-[10px] text-muted-foreground">Fewer → More clicks</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full border-2" style={{ borderColor: `rgb(${FRICTION_RGB})` }} />
              <span className="text-[10px] text-muted-foreground">Friction (rage/dead click)</span>
            </div>
          </div>
        </div>

        {dataLoading && !data ? (
          <div className="h-96 bg-accent rounded-xl animate-pulse" />
        ) : !data || (data.totals.clicks === 0 && data.totals.friction === 0) ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-12 h-12 rounded-xl bg-primary/15 flex items-center justify-center mb-3">
              <svg className="w-6 h-6 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-foreground">No click data yet for this page</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-[280px]">Click positions will appear here once visitors interact with this page in the selected range.</p>
          </div>
        ) : (
          <div className="relative">
            <div
              ref={gridRef}
              className="relative w-full rounded-lg overflow-hidden border border-border bg-background"
              style={{ aspectRatio: `${cols} / ${rows}`, display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)`, gap: "1px" }}
              onMouseLeave={() => setHover(null)}
            >
              {Array.from({ length: rows }).flatMap((_, row) =>
                Array.from({ length: cols }).map((_, col) => {
                  const cell = cellLookup.get(`${col},${row}`);
                  const clicks = cell?.clicks ?? 0;
                  const friction = cell?.friction ?? 0;
                  const intensity = clicks > 0 ? Math.sqrt(clicks / maxClickCount) : 0;
                  const frictionIntensity = friction > 0 ? Math.sqrt(friction / maxFrictionCount) : 0;
                  const bg = intensity > 0 ? `rgba(${PRIMARY_RGB}, ${(0.06 + intensity * 0.89).toFixed(3)})` : "transparent";
                  return (
                    <div
                      key={`${col}-${row}`}
                      className="relative"
                      style={{ backgroundColor: bg }}
                      onMouseEnter={(e) => {
                        const rect = gridRef.current?.getBoundingClientRect();
                        if (!rect) return;
                        setHover({
                          x: e.clientX - rect.left, y: e.clientY - rect.top,
                          col, row, clicks, friction,
                        });
                      }}
                    >
                      {friction > 0 && (
                        <span
                          className="absolute inset-0 m-auto rounded-full border-2"
                          style={{
                            borderColor: `rgba(${FRICTION_RGB}, ${(0.4 + frictionIntensity * 0.6).toFixed(3)})`,
                            width: `${Math.max(30, frictionIntensity * 100)}%`,
                            height: `${Math.max(30, frictionIntensity * 100)}%`,
                          }}
                        />
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {hover && (hover.clicks > 0 || hover.friction > 0) && (
              <div
                className="pointer-events-none absolute z-10 bg-popover border border-border rounded-lg px-2.5 py-1.5 text-[11px] shadow-lg"
                style={{ left: Math.min(hover.x + 10, (gridRef.current?.clientWidth ?? 0) - 140), top: Math.max(0, hover.y - 40) }}
              >
                <p className="font-semibold text-foreground capitalize">{zoneLabel(hover.col, hover.row, cols, rows)}</p>
                {hover.clicks > 0 && <p className="text-muted-foreground">{fmt(hover.clicks)} click{hover.clicks === 1 ? "" : "s"}</p>}
                {hover.friction > 0 && <p style={{ color: `rgb(${FRICTION_RGB})` }}>{fmt(hover.friction)} friction click{hover.friction === 1 ? "" : "s"}</p>}
              </div>
            )}
          </div>
        )}

        {data && (data.totals.clicks > 0 || data.totals.friction > 0) && (
          <p className="text-[10px] text-muted-foreground/70 mt-3">
            Horizontal position is normalized to an assumed {data.referenceWidthsPx[deviceType === "all" ? "desktop" : deviceType] ?? data.referenceWidthsPx["desktop"]}px-wide layout per device class (viewport width isn't captured, only click coordinates) — treat column position as approximate.
          </p>
        )}

        {/* Accessible fallback — top hotspots as a plain table, not color-only */}
        {topHotspots.length > 0 && (
          <div className="mt-5 pt-4 border-t border-border">
            <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3">Top Hotspots</h3>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-1.5 pr-3 font-semibold text-muted-foreground uppercase tracking-widest text-[10px]">Area</th>
                  <th className="text-right py-1.5 pr-3 font-semibold text-muted-foreground uppercase tracking-widest text-[10px]">Clicks</th>
                  <th className="text-right py-1.5 font-semibold text-muted-foreground uppercase tracking-widest text-[10px]">Friction</th>
                </tr>
              </thead>
              <tbody>
                {topHotspots.map((h, i) => (
                  <tr key={i} className="border-b border-border">
                    <td className="py-1.5 pr-3 text-foreground font-medium capitalize">{zoneLabel(h.col, h.row, cols, rows)}</td>
                    <td className="py-1.5 pr-3 text-right text-muted-foreground">{h.clicks > 0 ? fmt(h.clicks) : "—"}</td>
                    <td className="py-1.5 text-right" style={{ color: h.friction > 0 ? `rgb(${FRICTION_RGB})` : undefined }}>{h.friction > 0 ? fmt(h.friction) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Scroll depth */}
      <section className="bg-card border border-border rounded-xl p-5 shadow-sm">
        <h2 className="text-sm font-bold text-foreground uppercase tracking-widest mb-1">Scroll Depth</h2>
        <p className="text-[10px] text-muted-foreground mb-4">% of pageviews that scrolled at least this far down the page</p>
        {dataLoading && !data ? (
          <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-6 bg-accent rounded-lg animate-pulse" />)}</div>
        ) : !data || data.totals.pageviews === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-8">No pageview data yet for this page.</p>
        ) : (
          <div className="space-y-2">
            {data.scrollDepth.map((band, i) => {
              const lightness = 0.15 + (i / Math.max(1, data.scrollDepth.length - 1)) * 0.8;
              return (
                <div key={band.bandPct} className="flex items-center gap-3">
                  <span className="text-[10px] text-muted-foreground w-16 shrink-0 tabular-nums">{band.bandPct}%–{band.bandPct + 10}%</span>
                  <div className="flex-1 h-4 rounded-full bg-background overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${band.reachedPct}%`, backgroundColor: `rgba(${PRIMARY_RGB}, ${lightness.toFixed(2)})` }} />
                  </div>
                  <span className="text-[10px] text-foreground font-semibold w-10 text-right tabular-nums">{band.reachedPct}%</span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
