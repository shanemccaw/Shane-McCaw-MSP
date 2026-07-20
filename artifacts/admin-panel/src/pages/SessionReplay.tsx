import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

// Recorded, reviewable-after-the-fact session reconstruction — NOT a live viewer.
// Every session here already happened; "play" just steps a local clock through
// the stored timeline at variable speed. See docs/website-rebuild-reference-v2.md §4.

type Preset = "today" | "7d" | "30d" | "90d";
const PRESET_LABELS: Record<Preset, string> = { today: "Today", "7d": "7d", "30d": "30d", "90d": "90d" };

interface SessionRow {
  sessionId: string;
  identifiedEmail: string | null;
  entryPage: string;
  deviceType: string | null;
  browser: string | null;
  country: string | null;
  startedAt: string;
  lastSeenAt: string;
  totalSeconds: number;
  isBounce: boolean;
  pageviewCount: number;
  eventCount: number;
}

interface PageviewRow {
  id: number;
  page: string;
  title: string | null;
  enteredAt: string;
  exitedAt: string | null;
  durationSeconds: number | null;
  maxScrollPct: number;
}

interface TimelineEntry {
  ts: string;
  kind: string;
  page: string;
  label?: string | null;
  href?: string | null;
  metadata?: Record<string, unknown> | null;
  durationSeconds?: number | null;
  maxScrollPct?: number;
  title?: string | null;
}

interface SessionDetail {
  session: {
    sessionId: string;
    identifiedEmail: string | null;
    entryPage: string;
    referrer: string | null;
    utmSource: string | null;
    utmMedium: string | null;
    utmCampaign: string | null;
    deviceType: string | null;
    browser: string | null;
    country: string | null;
    startedAt: string;
    lastSeenAt: string;
    totalSeconds: number;
    isBounce: boolean;
  };
  pageviews: PageviewRow[];
  timeline: TimelineEntry[];
}

const KIND_LABELS: Record<string, string> = {
  pageview_enter: "Page view",
  pageview_exit: "Page exit",
  click: "Click",
  nav_click: "Nav click",
  cta_click: "CTA click",
  outbound_click: "Outbound click",
  form_submit: "Form submit",
  scroll_milestone: "Scroll",
  form_viewed: "Form viewed",
  form_started: "Form started",
  form_abandoned: "Form abandoned",
  field_focus: "Field focus",
  field_blur: "Field blur",
  field_error: "Field error",
  field_autofill_detected: "Autofill detected",
  error_404: "404 error",
  error_js: "JS error",
  error_api: "API error",
  broken_link_click: "Broken link click",
  slow_page_load: "Slow page load",
  form_submission_failed: "Form submission failed",
  rage_click: "Rage click",
  dead_click: "Dead click",
  idle_timeout: "Idle timeout",
};

const KIND_COLORS: Record<string, string> = {
  pageview_enter: "bg-primary",
  pageview_exit: "bg-primary/40",
  click: "bg-slate-400",
  nav_click: "bg-sky-400",
  cta_click: "bg-emerald-400",
  outbound_click: "bg-teal-400",
  form_submit: "bg-emerald-500",
  scroll_milestone: "bg-indigo-400",
  form_viewed: "bg-indigo-300",
  form_started: "bg-indigo-300",
  form_abandoned: "bg-amber-400",
  field_focus: "bg-slate-300",
  field_blur: "bg-slate-300",
  field_error: "bg-red-400",
  field_autofill_detected: "bg-slate-300",
  error_404: "bg-red-500",
  error_js: "bg-red-500",
  error_api: "bg-red-500",
  broken_link_click: "bg-red-400",
  slow_page_load: "bg-amber-400",
  form_submission_failed: "bg-red-400",
  rage_click: "bg-red-500",
  dead_click: "bg-amber-500",
  idle_timeout: "bg-slate-400",
};

function fmtClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysAgoIso(n: number): string {
  return isoDate(new Date(Date.now() - n * 86_400_000));
}

// ─── Player — reconstructs one session as a scrubbable timeline ────────────────
type RelTimelineEntry = TimelineEntry & { relMs: number };

function SessionPlayer({ detail, onBack }: { detail: SessionDetail; onBack: () => void }) {
  const entries = useMemo(() => [...detail.timeline].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()), [detail.timeline]);
  const baseTs = entries.length > 0 ? new Date(entries[0]!.ts).getTime() : new Date(detail.session.startedAt).getTime();
  const totalMs = entries.length > 0
    ? Math.max(1000, new Date(entries[entries.length - 1]!.ts).getTime() - baseTs)
    : 1000;

  const relEntries = useMemo(
    () => entries.map(e => ({ ...e, relMs: new Date(e.ts).getTime() - baseTs })),
    [entries, baseTs],
  );

  const [playheadMs, setPlayheadMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(4);
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(0);
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!playing) return;
    lastTickRef.current = performance.now();
    const tick = (now: number) => {
      const deltaMs = (now - lastTickRef.current) * speed;
      lastTickRef.current = now;
      setPlayheadMs(prev => {
        const next = prev + deltaMs;
        if (next >= totalMs) { setPlaying(false); return totalMs; }
        return next;
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [playing, speed, totalMs]);

  // Which page is "on screen" at the current playhead — the last pageview_enter at or before it.
  const activePage = useMemo(() => {
    let current: RelTimelineEntry | null = null;
    for (const e of relEntries) {
      if (e.kind !== "pageview_enter") continue;
      if (e.relMs <= playheadMs) current = e; else break;
    }
    return current;
  }, [relEntries, playheadMs]);

  // Most recent scroll_milestone on the active page, at or before the playhead.
  const scrollPct = useMemo(() => {
    if (!activePage) return 0;
    let pct = 0;
    for (const e of relEntries) {
      if (e.relMs > playheadMs) break;
      if (e.kind === "scroll_milestone" && e.page === activePage.page && e.relMs >= activePage.relMs) {
        const raw = e.metadata?.["pct"];
        if (typeof raw === "number") pct = raw;
      }
    }
    return pct;
  }, [relEntries, playheadMs, activePage]);

  const activeIndex = useMemo(() => {
    let idx = -1;
    relEntries.forEach((e, i) => { if (e.relMs <= playheadMs) idx = i; });
    return idx;
  }, [relEntries, playheadMs]);

  useEffect(() => {
    const row = logRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIndex}"]`);
    row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeIndex]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button onClick={onBack} className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
          Back to sessions
        </button>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">{detail.session.identifiedEmail ?? "Anonymous visitor"}</span>
          <span>·</span>
          <span>{detail.session.deviceType ?? "unknown device"}</span>
          <span>·</span>
          <span>{detail.session.browser ?? "unknown browser"}</span>
          <span>·</span>
          <span>{detail.session.country ?? "unknown location"}</span>
        </div>
      </div>

      {/* "Screen" — current page + scroll gauge */}
      <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-accent/40">
          <span className="w-2.5 h-2.5 rounded-full bg-red-400/70" />
          <span className="w-2.5 h-2.5 rounded-full bg-amber-400/70" />
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/70" />
          <span className="ml-2 text-[11px] font-mono text-muted-foreground truncate">{activePage?.page ?? detail.session.entryPage}</span>
        </div>
        <div className="p-6 flex items-center gap-6">
          <div className="flex-1 min-w-0">
            <p className="text-lg font-bold text-foreground truncate">{activePage?.title || activePage?.page || detail.session.entryPage}</p>
            <p className="text-xs text-muted-foreground mt-1">
              Entered at {fmtClock(activePage?.relMs ?? 0)} into the session
            </p>
          </div>
          <div className="w-40 shrink-0">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Scroll depth</span>
              <span className="text-xs font-bold text-foreground">{scrollPct}%</span>
            </div>
            <div className="h-2 rounded-full bg-border overflow-hidden">
              <div className="h-full rounded-full bg-indigo-400 transition-all" style={{ width: `${scrollPct}%` }} />
            </div>
          </div>
        </div>
      </div>

      {/* Transport controls */}
      <div className="bg-card border border-border rounded-xl p-4 shadow-sm space-y-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setPlaying(p => !p)}
            className="w-9 h-9 rounded-full bg-primary text-white flex items-center justify-center shrink-0 hover:bg-primary/80 transition-colors"
          >
            {playing ? (
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" /><rect x="14" y="5" width="4" height="14" /></svg>
            ) : (
              <svg className="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
            )}
          </button>
          <span className="text-xs font-mono text-muted-foreground w-24 shrink-0">{fmtClock(playheadMs)} / {fmtClock(totalMs)}</span>
          <input
            type="range" min={0} max={totalMs} step={100} value={playheadMs}
            onChange={e => { setPlaying(false); setPlayheadMs(Number(e.target.value)); }}
            className="flex-1 accent-primary"
          />
          <div className="flex items-center bg-accent border border-border rounded-lg overflow-hidden shrink-0">
            {[1, 2, 4, 8].map(s => (
              <button
                key={s}
                onClick={() => setSpeed(s)}
                className={`px-2 py-1 text-[10px] font-bold transition-colors ${speed === s ? "bg-primary text-white" : "text-muted-foreground hover:bg-border/50"}`}
              >
                {s}x
              </button>
            ))}
          </div>
        </div>

        {/* Timeline bar — page segments + event tick marks */}
        <div className="relative h-8 rounded-lg bg-accent overflow-hidden">
          {detail.pageviews.map(pv => {
            const start = new Date(pv.enteredAt).getTime() - baseTs;
            const end = pv.exitedAt ? new Date(pv.exitedAt).getTime() - baseTs : totalMs;
            const left = (start / totalMs) * 100;
            const width = Math.max(0.5, ((end - start) / totalMs) * 100);
            return (
              <div
                key={pv.id}
                title={pv.page}
                className="absolute top-0 h-full border-r border-background/60 bg-primary/10"
                style={{ left: `${left}%`, width: `${width}%` }}
              />
            );
          })}
          {relEntries.filter(e => e.kind !== "pageview_enter" && e.kind !== "pageview_exit").map((e, i) => (
            <div
              key={i}
              title={`${KIND_LABELS[e.kind] ?? e.kind} — ${e.label ?? e.page}`}
              className={`absolute top-1 w-1 h-6 rounded-full ${KIND_COLORS[e.kind] ?? "bg-slate-400"} cursor-pointer`}
              style={{ left: `${(e.relMs / totalMs) * 100}%` }}
              onClick={() => { setPlaying(false); setPlayheadMs(e.relMs); }}
            />
          ))}
          <div
            className="absolute top-0 w-0.5 h-full bg-foreground"
            style={{ left: `${(playheadMs / totalMs) * 100}%` }}
          />
        </div>
      </div>

      {/* Event log */}
      <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
        <h2 className="text-sm font-bold text-foreground uppercase tracking-widest mb-3">Event Log</h2>
        <div ref={logRef} className="max-h-96 overflow-y-auto space-y-1">
          {relEntries.map((e, i) => {
            const active = i === activeIndex;
            const past = e.relMs <= playheadMs;
            return (
              <button
                key={i}
                data-idx={i}
                onClick={() => { setPlaying(false); setPlayheadMs(e.relMs); }}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
                  active ? "bg-primary/10 border border-primary/30" : "hover:bg-accent border border-transparent"
                } ${past ? "" : "opacity-40"}`}
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${KIND_COLORS[e.kind] ?? "bg-slate-400"}`} />
                <span className="text-[10px] font-mono text-muted-foreground w-12 shrink-0">{fmtClock(e.relMs)}</span>
                <span className="text-xs font-semibold text-foreground shrink-0">{KIND_LABELS[e.kind] ?? e.kind}</span>
                <span className="text-xs text-muted-foreground truncate">
                  {e.label || e.title || e.page}
                  {e.kind === "pageview_exit" && e.durationSeconds != null ? ` — ${e.durationSeconds}s, ${e.maxScrollPct ?? 0}% scrolled` : ""}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Page — session list + search, drills into the player above ───────────────
export default function SessionReplayPage() {
  const { fetchWithAuth } = useAuth();

  const [preset, setPreset] = useState<Preset>("30d");
  const [isCustom, setIsCustom] = useState(false);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [emailFilter, setEmailFilter] = useState("");

  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const load = useCallback(async (p: number) => {
    setLoading(true); setError(null);
    const params = new URLSearchParams();
    if (isCustom && customStart && customEnd) { params.set("start", customStart); params.set("end", customEnd); }
    else { params.set("range", preset); }
    if (emailFilter.trim()) params.set("email", emailFilter.trim());
    params.set("page", String(p));
    try {
      const res = await fetchWithAuth(`/api/admin/analytics/session-replay/sessions?${params.toString()}`);
      if (!res.ok) throw new Error("request failed");
      const d = await res.json() as { sessions: SessionRow[]; total: number };
      setSessions(d.sessions);
      setTotal(d.total);
    } catch {
      setError("Could not load sessions");
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, preset, isCustom, customStart, customEnd, emailFilter]);

  useEffect(() => { void load(page); }, [load, page]);

  const openSession = useCallback(async (sessionId: string) => {
    setSelectedId(sessionId);
    setDetail(null);
    setDetailLoading(true); setDetailError(null);
    try {
      const res = await fetchWithAuth(`/api/admin/analytics/session-replay/sessions/${sessionId}`);
      if (!res.ok) throw new Error("request failed");
      setDetail(await res.json() as SessionDetail);
    } catch {
      setDetailError("Could not load this session's timeline");
    } finally {
      setDetailLoading(false);
    }
  }, [fetchWithAuth]);

  if (selectedId) {
    return (
      <div className="p-4 sm:p-6 max-w-[1280px]">
        {detailLoading ? (
          <div className="h-96 bg-card border border-border rounded-xl animate-pulse" />
        ) : detailError ? (
          <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-400">{detailError}</div>
        ) : detail ? (
          <SessionPlayer detail={detail} onBack={() => { setSelectedId(null); setDetail(null); }} />
        ) : null}
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-[1280px] space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-foreground">Session Replay</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Reconstructed, after-the-fact playback of a visitor's path — page views, clicks, and scroll, in order. Not a live view.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="text"
            value={emailFilter}
            onChange={e => { setEmailFilter(e.target.value); setPage(1); }}
            placeholder="Filter by lead email…"
            className="text-xs bg-background border border-border text-foreground/90 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary w-48"
          />
          <div className="flex items-center bg-card border border-border rounded-lg overflow-hidden shadow-sm">
            {(["today", "7d", "30d", "90d"] as Preset[]).map(r => (
              <button
                key={r}
                onClick={() => { setPreset(r); setIsCustom(false); setPage(1); }}
                className={`px-3 py-1.5 text-xs font-semibold transition-colors ${!isCustom && preset === r ? "bg-primary text-white" : "text-muted-foreground hover:bg-accent"}`}
              >
                {PRESET_LABELS[r]}
              </button>
            ))}
            <button
              onClick={() => {
                if (!customStart) setCustomStart(daysAgoIso(30));
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
              <input type="date" value={customStart} max={customEnd || isoDate(new Date())} onChange={e => setCustomStart(e.target.value)} className="text-xs text-foreground/90 border-0 outline-none bg-transparent cursor-pointer" />
              <span className="text-muted-foreground text-xs">→</span>
              <input type="date" value={customEnd} min={customStart} max={isoDate(new Date())} onChange={e => setCustomEnd(e.target.value)} className="text-xs text-foreground/90 border-0 outline-none bg-transparent cursor-pointer" />
              <button onClick={() => { setPage(1); void load(1); }} disabled={!customStart || !customEnd} className="ml-1 px-2 py-0.5 text-[10px] font-bold bg-primary text-white rounded hover:bg-[#005A9E] disabled:opacity-40 transition-colors">Apply</button>
            </div>
          )}
        </div>
      </div>

      <section className="bg-card border border-border rounded-xl p-5 shadow-sm">
        {loading ? (
          <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-9 bg-accent rounded-lg animate-pulse" />)}</div>
        ) : error ? (
          <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-400">{error}</div>
        ) : !sessions || sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-16">No recorded sessions in this window yet.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 pr-3 font-semibold text-muted-foreground uppercase tracking-widest text-[10px]">Started</th>
                    <th className="text-left py-2 pr-3 font-semibold text-muted-foreground uppercase tracking-widest text-[10px]">Lead</th>
                    <th className="text-left py-2 pr-3 font-semibold text-muted-foreground uppercase tracking-widest text-[10px]">Entry Page</th>
                    <th className="text-left py-2 pr-3 font-semibold text-muted-foreground uppercase tracking-widest text-[10px]">Device</th>
                    <th className="text-right py-2 pr-3 font-semibold text-muted-foreground uppercase tracking-widest text-[10px]">Pages</th>
                    <th className="text-right py-2 pr-3 font-semibold text-muted-foreground uppercase tracking-widest text-[10px]">Events</th>
                    <th className="text-right py-2 pr-3 font-semibold text-muted-foreground uppercase tracking-widest text-[10px]">Duration</th>
                    <th className="text-right py-2 font-semibold text-muted-foreground uppercase tracking-widest text-[10px]"></th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map(s => (
                    <tr key={s.sessionId} className="border-b border-border hover:bg-accent transition-colors cursor-pointer" onClick={() => void openSession(s.sessionId)}>
                      <td className="py-2.5 pr-3 text-foreground font-medium whitespace-nowrap">{new Date(s.startedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</td>
                      <td className="py-2.5 pr-3 text-foreground/90 truncate max-w-[160px]">{s.identifiedEmail ?? <span className="text-muted-foreground italic">anonymous</span>}</td>
                      <td className="py-2.5 pr-3 text-muted-foreground truncate max-w-[200px]" title={s.entryPage}>{s.entryPage}</td>
                      <td className="py-2.5 pr-3 text-muted-foreground">{s.deviceType ?? "—"}</td>
                      <td className="py-2.5 pr-3 text-right text-muted-foreground">{s.pageviewCount}</td>
                      <td className="py-2.5 pr-3 text-right text-muted-foreground">{s.eventCount}</td>
                      <td className="py-2.5 pr-3 text-right text-muted-foreground">{fmtClock(s.totalSeconds * 1000)}</td>
                      <td className="py-2.5 text-right">
                        <span className="text-[10px] font-bold text-primary">Replay →</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-border">
              <span className="text-[10px] text-muted-foreground">{total} session{total === 1 ? "" : "s"} total</span>
              <div className="flex items-center gap-2">
                <button disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} className="text-xs font-semibold text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors px-2 py-1">Prev</button>
                <span className="text-[10px] text-muted-foreground">Page {page}</span>
                <button disabled={page * 50 >= total} onClick={() => setPage(p => p + 1)} className="text-xs font-semibold text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors px-2 py-1">Next</button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
