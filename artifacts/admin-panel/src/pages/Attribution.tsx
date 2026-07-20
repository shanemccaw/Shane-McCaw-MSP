import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

// First-touch / last-touch / multi-touch attribution reporting.
//
// Grain note: a "touch" here is a distinct identified browser/device for a lead,
// not every individual page visit — see admin-analytics-attribution.ts for why
// (analytics_sessions is one row per durable visitor cookie, UTM frozen at that
// browser's first-ever visit). Leads who've only ever used one browser will show
// touchCount: 1, which is a real answer, not a bug.

type Preset = "today" | "7d" | "30d" | "90d";
const PRESET_LABELS: Record<Preset, string> = { today: "Today", "7d": "7d", "30d": "30d", "90d": "90d" };

interface TouchSummary {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  referrer: string | null;
  entryPage: string | null;
  at: string;
}

interface LeadRow {
  email: string;
  leadName: string | null;
  leadStatus: string | null;
  touchCount: number;
  firstTouch: TouchSummary;
  lastTouch: TouchSummary;
}

interface TouchDetail {
  sessionId: string;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  referrer: string | null;
  entryPage: string;
  deviceType: string | null;
  browser: string | null;
  country: string | null;
  startedAt: string;
  lastSeenAt: string;
  totalSeconds: number;
}

interface LeadDetail {
  email: string;
  touchCount: number;
  firstTouch: TouchDetail;
  lastTouch: TouchDetail;
  path: TouchDetail[];
}

function sourceLabel(t: { utmSource: string | null; utmMedium: string | null; referrer: string | null }): string {
  if (t.utmSource) return t.utmMedium ? `${t.utmSource} / ${t.utmMedium}` : t.utmSource;
  if (t.referrer) {
    try { return new URL(t.referrer).hostname; } catch { return t.referrer; }
  }
  return "Direct / none";
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

// ─── Detail — one lead's full ordered touch path ───────────────────────────────
function AttributionPathView({ detail, onBack }: { detail: LeadDetail; onBack: () => void }) {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button onClick={onBack} className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
          Back to leads
        </button>
        <span className="text-xs font-semibold text-foreground">{detail.email}</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">First touch</p>
          <p className="text-sm font-bold text-foreground">{sourceLabel(detail.firstTouch)}</p>
          <p className="text-xs text-muted-foreground mt-1">{fmtDate(detail.firstTouch.startedAt)} · {detail.firstTouch.entryPage}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Last touch</p>
          <p className="text-sm font-bold text-foreground">{sourceLabel(detail.lastTouch)}</p>
          <p className="text-xs text-muted-foreground mt-1">{fmtDate(detail.lastTouch.startedAt)} · {detail.lastTouch.entryPage}</p>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
        <h2 className="text-sm font-bold text-foreground uppercase tracking-widest mb-3">
          Full path ({detail.touchCount} touch{detail.touchCount === 1 ? "" : "es"})
        </h2>
        <div className="space-y-2">
          {detail.path.map((t, i) => (
            <div key={t.sessionId} className="flex items-start gap-3 px-3 py-2.5 rounded-lg border border-border bg-accent/30">
              <span className="w-5 h-5 rounded-full bg-primary/15 text-primary text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-foreground">{sourceLabel(t)}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {fmtDate(t.startedAt)} · {t.entryPage} · {t.deviceType ?? "unknown device"} · {t.browser ?? "unknown browser"}
                  {t.utmCampaign ? ` · campaign: ${t.utmCampaign}` : ""}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Page — per-lead first/last-touch rollup, drills into full path ───────────
export default function AttributionPage() {
  const { fetchWithAuth } = useAuth();

  const [preset, setPreset] = useState<Preset>("30d");
  const [emailFilter, setEmailFilter] = useState("");
  const [leads, setLeads] = useState<LeadRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  const [selectedEmail, setSelectedEmail] = useState<string | null>(null);
  const [detail, setDetail] = useState<LeadDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const load = useCallback(async (p: number) => {
    setLoading(true); setError(null);
    const params = new URLSearchParams();
    params.set("range", preset);
    if (emailFilter.trim()) params.set("email", emailFilter.trim());
    params.set("page", String(p));
    try {
      const res = await fetchWithAuth(`/api/admin/analytics/attribution/leads?${params.toString()}`);
      if (!res.ok) throw new Error("request failed");
      const d = await res.json() as { leads: LeadRow[]; total: number };
      setLeads(d.leads);
      setTotal(d.total);
    } catch {
      setError("Could not load attribution report");
      setLeads([]);
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, preset, emailFilter]);

  useEffect(() => { void load(page); }, [load, page]);

  const openLead = useCallback(async (email: string) => {
    setSelectedEmail(email);
    setDetail(null);
    setDetailLoading(true); setDetailError(null);
    try {
      const res = await fetchWithAuth(`/api/admin/analytics/attribution/leads/${encodeURIComponent(email)}`);
      if (!res.ok) throw new Error("request failed");
      setDetail(await res.json() as LeadDetail);
    } catch {
      setDetailError("Could not load this lead's attribution path");
    } finally {
      setDetailLoading(false);
    }
  }, [fetchWithAuth]);

  if (selectedEmail) {
    return (
      <div className="p-4 sm:p-6 max-w-[1280px]">
        {detailLoading ? (
          <div className="h-96 bg-card border border-border rounded-xl animate-pulse" />
        ) : detailError ? (
          <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-400">{detailError}</div>
        ) : detail ? (
          <AttributionPathView detail={detail} onBack={() => { setSelectedEmail(null); setDetail(null); }} />
        ) : null}
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-[1280px] space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-foreground">Attribution</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            First-touch and last-touch source per lead, with the full multi-touch path behind each one.
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
                onClick={() => { setPreset(r); setPage(1); }}
                className={`px-3 py-1.5 text-xs font-semibold transition-colors ${preset === r ? "bg-primary text-white" : "text-muted-foreground hover:bg-accent"}`}
              >
                {PRESET_LABELS[r]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <section className="bg-card border border-border rounded-xl p-5 shadow-sm">
        {loading ? (
          <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-9 bg-accent rounded-lg animate-pulse" />)}</div>
        ) : error ? (
          <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-400">{error}</div>
        ) : !leads || leads.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-16">No identified leads with recorded touches in this window yet.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 pr-3 font-semibold text-muted-foreground uppercase tracking-widest text-[10px]">Lead</th>
                    <th className="text-left py-2 pr-3 font-semibold text-muted-foreground uppercase tracking-widest text-[10px]">Status</th>
                    <th className="text-left py-2 pr-3 font-semibold text-muted-foreground uppercase tracking-widest text-[10px]">First touch</th>
                    <th className="text-left py-2 pr-3 font-semibold text-muted-foreground uppercase tracking-widest text-[10px]">Last touch</th>
                    <th className="text-right py-2 pr-3 font-semibold text-muted-foreground uppercase tracking-widest text-[10px]">Touches</th>
                    <th className="text-right py-2 font-semibold text-muted-foreground uppercase tracking-widest text-[10px]"></th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map(l => (
                    <tr key={l.email} className="border-b border-border hover:bg-accent transition-colors cursor-pointer" onClick={() => void openLead(l.email)}>
                      <td className="py-2.5 pr-3 text-foreground/90 truncate max-w-[200px]">
                        <div className="font-medium text-foreground truncate">{l.leadName ?? l.email}</div>
                        {l.leadName ? <div className="text-[10px] text-muted-foreground truncate">{l.email}</div> : null}
                      </td>
                      <td className="py-2.5 pr-3 text-muted-foreground">{l.leadStatus ?? "—"}</td>
                      <td className="py-2.5 pr-3 text-muted-foreground truncate max-w-[180px]" title={sourceLabel(l.firstTouch)}>{sourceLabel(l.firstTouch)}</td>
                      <td className="py-2.5 pr-3 text-muted-foreground truncate max-w-[180px]" title={sourceLabel(l.lastTouch)}>{sourceLabel(l.lastTouch)}</td>
                      <td className="py-2.5 pr-3 text-right text-muted-foreground">{l.touchCount}</td>
                      <td className="py-2.5 text-right">
                        <span className="text-[10px] font-bold text-primary">View path →</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-border">
              <span className="text-[10px] text-muted-foreground">{total} lead{total === 1 ? "" : "s"} total</span>
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
