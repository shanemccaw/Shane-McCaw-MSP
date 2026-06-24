import { useEffect, useState, useCallback } from "react";
import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import PortalLayout from "@/components/PortalLayout";
import ActivityFeed from "@/components/ActivityFeed";
import M365ProfileSummaryCard from "@/components/M365ProfileSummaryCard";
import { type AuditLogEntry } from "@/lib/auditFormatter";

type M365ScoreCategory = "security" | "compliance" | "copilot" | "governance" | "productivity";

interface ScorecardHistory {
  hasData: boolean;
  firstDate?: string;
  latestDate?: string;
  first?: Partial<Record<M365ScoreCategory, number>>;
  latest?: Partial<Record<M365ScoreCategory, number>>;
}

const SCORECARD_DEFS: { key: M365ScoreCategory; label: string }[] = [
  { key: "security",     label: "Security Posture" },
  { key: "compliance",   label: "Compliance Coverage" },
  { key: "copilot",      label: "Copilot Readiness" },
  { key: "governance",   label: "Governance Maturity" },
  { key: "productivity", label: "Adoption Score" },
];

function ringColor(s: number) { return s >= 70 ? "#22c55e" : s >= 40 ? "#f59e0b" : "#ef4444"; }
function ringTopBar(s: number) { return s >= 70 ? "bg-green-500" : s >= 40 ? "bg-amber-400" : "bg-red-500"; }
function statusLabel(s: number) { return s >= 70 ? "Healthy" : s >= 40 ? "Attention" : "Critical"; }
function statusBadge(s: number) { return s >= 70 ? "bg-green-500/20 text-green-300 border-green-500/30" : s >= 40 ? "bg-amber-400/20 text-amber-300 border-amber-400/30" : "bg-red-500/20 text-red-300 border-red-500/30"; }

function ScoreRing({ score, size = 80 }: { score: number; size?: number }) {
  const r = (size / 2) - 7;
  const circ = 2 * Math.PI * r;
  const cx = size / 2;
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="6" />
        <circle
          cx={cx} cy={cx} r={r} fill="none"
          stroke={ringColor(score)} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={`${(score / 100) * circ} ${circ}`}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-sm font-black text-white">{score}%</span>
      </div>
    </div>
  );
}

function OverallRing({ score }: { score: number }) {
  const size = 96;
  const r = (size / 2) - 8;
  const circ = 2 * Math.PI * r;
  const cx = size / 2;
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="7" />
        <circle
          cx={cx} cy={cx} r={r} fill="none"
          stroke={ringColor(score)} strokeWidth="7" strokeLinecap="round"
          strokeDasharray={`${(score / 100) * circ} ${circ}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-black text-white leading-none">{score}%</span>
        <span className="text-[9px] font-bold text-white/50 uppercase tracking-widest mt-0.5">Overall</span>
      </div>
    </div>
  );
}

interface Project {
  id: number;
  title: string;
  status: string;
  phase: string | null;
  progress: number;
  endDate: string | null;
}

interface ClientService {
  cs: { id: number; progress: number; status: string; nextMilestone: string | null; nextMilestoneDate: string | null };
  service: { id: number; name: string; category: string | null };
}

interface Invoice {
  id: number;
  invoiceNumber: string;
  amount: string;
  status: string;
  dueDate: string | null;
}

interface Report {
  id: number;
  title: string;
  period: string;
  createdAt: string;
}

interface DashboardData {
  projects: Project[];
  clientServices: ClientService[];
  invoices: Invoice[];
  reports: Report[];
  unreadNotifications: number;
  unreadMessages: number;
}

interface AuditResponse {
  entries: AuditLogEntry[];
  total: number;
  page: number;
  pageSize: number;
}

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-700",
  on_hold: "bg-yellow-100 text-yellow-700",
  completed: "bg-blue-100 text-blue-700",
};

const INVOICE_STATUS: Record<string, string> = {
  paid: "bg-green-100 text-green-700",
  due: "bg-yellow-100 text-yellow-700",
  overdue: "bg-red-100 text-red-700",
  draft: "bg-gray-100 text-gray-600",
};

const PERIOD_LABELS: Record<string, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  executive_summary: "Executive Summary",
  other: "Report",
};

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="w-full bg-[#F7F9FC] rounded-full h-2 mt-2">
      <div
        className="h-2 rounded-full bg-[#0078D4] transition-all duration-500"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-8 h-8 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

export default function PortalDashboard() {
  const { fetchWithAuth, user } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activityEntries, setActivityEntries] = useState<AuditLogEntry[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [scorecardHistory, setScorecardHistory] = useState<ScorecardHistory | null>(null);

  useEffect(() => {
    fetchWithAuth("/api/portal/dashboard")
      .then(r => r.json())
      .then(d => setData(d as DashboardData))
      .catch(() => null)
      .finally(() => setLoading(false));

    fetchWithAuth("/api/portal/m365-scorecard-history")
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setScorecardHistory(d as ScorecardHistory); })
      .catch(() => null);
  }, [fetchWithAuth]);

  const fetchActivity = useCallback(() => {
    setActivityLoading(true);
    fetchWithAuth("/api/audit-logs/me?page=1&pageSize=10")
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setActivityEntries((d as AuditResponse).entries ?? []); })
      .catch(() => null)
      .finally(() => setActivityLoading(false));
  }, [fetchWithAuth]);

  useEffect(() => {
    fetchActivity();
  }, [fetchActivity]);

  useEffect(() => {
    const id = setInterval(() => { fetchActivity(); }, 60000);
    return () => clearInterval(id);
  }, [fetchActivity]);

  const invoiceSummary = data?.invoices ?? [];
  const overdueCount = invoiceSummary.filter(i => i.status === "overdue").length;
  const dueCount = invoiceSummary.filter(i => i.status === "due").length;

  return (
    <PortalLayout unreadNotifications={data?.unreadNotifications} unreadMessages={data?.unreadMessages}>
      <div className="px-4 sm:px-6 py-6 sm:py-8 max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-extrabold text-[#0A2540]">
              Welcome back{user?.email ? `, ${user.email.split("@")[0]}` : ""}
            </h1>
            <p className="text-muted-foreground text-sm mt-1">Here's your project overview.</p>
          </div>
          {(data?.unreadNotifications ?? 0) > 0 && (
            <div className="flex items-center gap-2 bg-[#0078D4]/10 border border-[#0078D4]/20 text-[#0078D4] text-sm font-medium px-4 py-2 rounded-xl">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
              {data!.unreadNotifications} new notification{data!.unreadNotifications !== 1 ? "s" : ""}
            </div>
          )}
        </div>

        {/* Two-column layout: main content + activity sidebar */}
        <div className="flex gap-6 items-start">
          {/* Main content column */}
          <div className="flex-1 min-w-0">
            {loading ? <Spinner /> : (
              <div className="space-y-8">
                {/* Invoice Alert */}
                {(overdueCount > 0 || dueCount > 0) && (
                  <div className={`rounded-xl border p-4 flex items-center gap-4 ${overdueCount > 0 ? "bg-red-50 border-red-200" : "bg-yellow-50 border-yellow-200"}`}>
                    <svg className={`w-5 h-5 flex-shrink-0 ${overdueCount > 0 ? "text-red-600" : "text-yellow-600"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <div className="flex-1">
                      <p className={`text-sm font-semibold ${overdueCount > 0 ? "text-red-700" : "text-yellow-700"}`}>
                        {overdueCount > 0 ? `${overdueCount} overdue invoice${overdueCount > 1 ? "s" : ""}` : `${dueCount} invoice${dueCount > 1 ? "s" : ""} due soon`}
                      </p>
                    </div>
                    <Link href="/portal/billing">
                      <span className={`text-xs font-semibold underline cursor-pointer ${overdueCount > 0 ? "text-red-600" : "text-yellow-600"}`}>View Billing →</span>
                    </Link>
                  </div>
                )}

                {/* M365 Environment Health Scorecards */}
                <section>
                  {!scorecardHistory?.hasData ? (
                    /* ── Empty state: dark command panel with CTA ── */
                    <div className="rounded-2xl overflow-hidden">
                      <div className="bg-[#0A2540] px-6 py-5 flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                          <div>
                            <p className="text-[10px] font-bold tracking-[0.2em] uppercase text-white/40">Mission Status</p>
                            <h2 className="text-base font-black text-white tracking-tight">M365 Environment Health</h2>
                          </div>
                        </div>
                        <span className="text-xs font-bold text-[#0078D4] whitespace-nowrap">Set up profile →</span>
                      </div>
                      <div className="bg-[#0d2d4a] border border-[#0A2540] rounded-b-2xl px-6 py-8 flex items-center gap-5">
                        <div className="w-12 h-12 rounded-xl bg-[#0078D4]/20 border border-[#0078D4]/30 flex items-center justify-center flex-shrink-0">
                          <svg className="w-6 h-6 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                          </svg>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-white">Awaiting baseline scan</p>
                          <p className="text-xs text-white/40 mt-0.5">Complete your M365 profile and save it — we'll generate your first environment health scores immediately.</p>
                        </div>
                        <span className="inline-flex items-center gap-1.5 bg-[#0078D4] text-white text-xs font-bold px-4 py-2.5 rounded-lg whitespace-nowrap">
                          Run baseline scan
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                          </svg>
                        </span>
                      </div>
                    </div>
                  ) : (() => {
                    const scores = SCORECARD_DEFS.map(d => scorecardHistory.latest?.[d.key] ?? 0);
                    const overall = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
                    const isFirstSameAsLatest = scorecardHistory.firstDate === scorecardHistory.latestDate;
                    return (
                      <div className="rounded-2xl overflow-hidden shadow-lg">
                        {/* ── Command header ── */}
                        <div className="bg-[#0A2540] px-6 py-5">
                          <div className="flex items-center justify-between gap-4 flex-wrap">
                            <div className="flex items-center gap-4">
                              <OverallRing score={overall} />
                              <div>
                                <p className="text-[10px] font-bold tracking-[0.2em] uppercase text-white/40">Mission Status</p>
                                <h2 className="text-xl font-black text-white tracking-tight leading-tight">M365 Environment Health</h2>
                                <div className="flex items-center gap-2 mt-1.5">
                                  <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-md border ${statusBadge(overall)}`}>
                                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: ringColor(overall) }} />
                                    {statusLabel(overall)}
                                  </span>
                                  {scorecardHistory.firstDate && (
                                    <span className="text-[10px] text-white/30 font-medium">
                                      Tracking since {new Date(scorecardHistory.firstDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <span className="text-xs font-bold text-[#0078D4] whitespace-nowrap">Update profile →</span>
                          </div>
                        </div>

                        {/* ── Score cards ── */}
                        <div className="bg-[#0d2d4a] border-x border-b border-[#0A2540]/80 rounded-b-2xl p-4">
                          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                            {SCORECARD_DEFS.map(({ key, label }) => {
                              const current = scorecardHistory.latest?.[key] ?? 0;
                              const baseline = scorecardHistory.first?.[key] ?? null;
                              const delta = baseline !== null ? current - baseline : null;
                              const showHistory = baseline !== null && !isFirstSameAsLatest;
                              return (
                                <div key={key} className="bg-[#0A2540] border border-white/5 rounded-xl overflow-hidden">
                                    {/* colored top bar */}
                                    <div className={`h-1 w-full ${ringTopBar(current)}`} />
                                    <div className="p-4 flex flex-col items-center gap-3">
                                      <ScoreRing score={current} size={72} />
                                      <div className="text-center">
                                        <p className="text-[11px] font-bold text-white/80 leading-snug uppercase tracking-wide">{label}</p>
                                      </div>
                                      {showHistory && baseline !== null ? (
                                        <div className="w-full bg-white/5 rounded-lg px-3 py-2 flex flex-col items-center gap-1">
                                          <div className="flex items-center gap-1.5 text-[11px] text-white/50">
                                            <span>{baseline}%</span>
                                            <svg className="w-3 h-3 flex-shrink-0 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                                            </svg>
                                            <span className="font-black text-white">{current}%</span>
                                          </div>
                                          {delta !== null && delta !== 0 && (
                                            <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${delta > 0 ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
                                              {delta > 0 ? "+" : ""}{delta} pts
                                            </span>
                                          )}
                                        </div>
                                      ) : (
                                        <div className="w-full bg-white/5 rounded-lg px-3 py-2 text-center">
                                          <span className="text-[10px] text-white/30 font-medium">Baseline set</span>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </section>

                {/* M365 Profile Summary */}
                <M365ProfileSummaryCard />

                {/* Active Projects */}
                <section>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-base font-bold text-[#0A2540]">Active Projects</h2>
                    <Link href="/portal/projects">
                      <span className="text-sm text-[#0078D4] font-semibold hover:underline cursor-pointer">View all →</span>
                    </Link>
                  </div>
                  {(data?.projects?.filter(p => p.status !== "completed").length ?? 0) === 0 ? (
                    <div className="bg-white border border-border rounded-xl p-8 text-center text-muted-foreground text-sm">
                      No active projects — Shane will set them up shortly.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {data!.projects.filter(p => p.status !== "completed").map(p => (
                        <Link key={p.id} href={`/portal/projects/${p.id}`}>
                          <div className="bg-white border border-border rounded-xl p-5 hover:border-[#0078D4]/40 hover:shadow-md transition-all cursor-pointer group">
                            <div className="flex items-start justify-between gap-2 mb-3">
                              <h3 className="text-sm font-bold text-[#0A2540] group-hover:text-[#0078D4] transition-colors leading-snug">{p.title}</h3>
                              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full flex-shrink-0 capitalize ${STATUS_COLORS[p.status] ?? "bg-gray-100 text-gray-600"}`}>
                                {p.status.replace("_", " ")}
                              </span>
                            </div>
                            {p.phase && <p className="text-xs text-muted-foreground mb-2">{p.phase}</p>}
                            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                              <span>Progress</span>
                              <span className="font-semibold text-[#0078D4]">{p.progress}%</span>
                            </div>
                            <ProgressBar value={p.progress} />
                            {p.endDate && (
                              <p className="text-xs text-muted-foreground mt-2.5">
                                Target: {new Date(p.endDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                              </p>
                            )}
                          </div>
                        </Link>
                      ))}
                    </div>
                  )}
                </section>

                {/* Purchased Services */}
                {(data?.clientServices?.length ?? 0) > 0 && (
                  <section>
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-base font-bold text-[#0A2540]">Your Services</h2>
                      <Link href="/portal/services">
                        <span className="text-sm text-[#0078D4] font-semibold hover:underline cursor-pointer">View all →</span>
                      </Link>
                    </div>
                    <div className="flex flex-wrap gap-3">
                      {data!.clientServices.map(({ cs, service }) => (
                        <Link key={cs.id} href="/portal/services">
                          <div className="bg-white border border-border rounded-xl px-4 py-3 hover:border-[#0078D4]/40 transition-all cursor-pointer">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-sm font-semibold text-[#0A2540]">{service.name}</span>
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cs.status === "completed" ? "bg-green-100 text-green-700" : cs.status === "active" ? "bg-blue-100 text-blue-700" : "bg-yellow-100 text-yellow-700"}`}>
                                {cs.status}
                              </span>
                            </div>
                            {service.category && <p className="text-xs text-muted-foreground">{service.category}</p>}
                            <div className="mt-2">
                              <ProgressBar value={cs.progress} />
                              <p className="text-xs text-muted-foreground mt-1">{cs.progress}% complete</p>
                            </div>
                          </div>
                        </Link>
                      ))}
                    </div>
                  </section>
                )}

                {/* Bottom row: Reports + Invoice Status */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Recent Reports */}
                  <section>
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-base font-bold text-[#0A2540]">Recent Reports</h2>
                    </div>
                    <div className="bg-white border border-border rounded-xl divide-y divide-border">
                      {(data?.reports?.length ?? 0) === 0 ? (
                        <div className="p-6 text-center text-muted-foreground text-sm">No reports yet.</div>
                      ) : data!.reports.map(r => (
                        <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                          <div className="w-8 h-8 rounded-lg bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0">
                            <svg className="w-4 h-4 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                            </svg>
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-[#0A2540] truncate">{r.title}</p>
                            <p className="text-xs text-muted-foreground">{PERIOD_LABELS[r.period] ?? r.period} · {new Date(r.createdAt).toLocaleDateString()}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>

                  {/* Invoice status summary */}
                  <section>
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-base font-bold text-[#0A2540]">Invoices</h2>
                      <Link href="/portal/billing">
                        <span className="text-sm text-[#0078D4] font-semibold hover:underline cursor-pointer">View all →</span>
                      </Link>
                    </div>
                    <div className="bg-white border border-border rounded-xl divide-y divide-border">
                      {(data?.invoices?.length ?? 0) === 0 ? (
                        <div className="p-6 text-center text-muted-foreground text-sm">No invoices yet.</div>
                      ) : data!.invoices.map(inv => (
                        <div key={inv.id} className="flex items-center gap-3 px-4 py-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-[#0A2540]">{inv.invoiceNumber}</p>
                            <p className="text-xs text-muted-foreground">
                              {inv.dueDate ? `Due ${new Date(inv.dueDate).toLocaleDateString()}` : ""}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-bold text-[#0A2540]">${parseFloat(inv.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}</p>
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${INVOICE_STATUS[inv.status] ?? "bg-gray-100 text-gray-600"}`}>
                              {inv.status}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>
              </div>
            )}
          </div>

          {/* Activity feed sidebar — sticky, hidden on small screens */}
          <div className="hidden xl:block w-80 flex-shrink-0 sticky top-8 self-start" style={{ maxHeight: "calc(100vh - 5rem)" }}>
            <ActivityFeed
              entries={activityEntries}
              loading={activityLoading}
              onRefresh={fetchActivity}
              compact
            />
          </div>
        </div>
      </div>
    </PortalLayout>
  );
}
