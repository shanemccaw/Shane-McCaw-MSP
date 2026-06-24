import { useEffect, useState, useCallback } from "react";
import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import PortalLayout from "@/components/PortalLayout";
import ActivityFeed from "@/components/ActivityFeed";
import { type AuditLogEntry } from "@/lib/auditFormatter";

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

  useEffect(() => {
    fetchWithAuth("/api/portal/dashboard")
      .then(r => r.json())
      .then(d => setData(d as DashboardData))
      .catch(() => null)
      .finally(() => setLoading(false));
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
