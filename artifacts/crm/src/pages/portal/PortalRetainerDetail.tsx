import { useState } from "react";
import { Link } from "wouter";

interface Project {
  id: number;
  title: string;
  description: string | null;
  status: string;
  phase: string | null;
  progress: number;
  startDate: string | null;
  endDate: string | null;
  projectType: string;
}

interface WorkflowStep {
  id: number;
  title: string;
  description: string | null;
  status: string;
  notes: string | null;
  completedAt: string | null;
  dueDate: string | null;
  order: number;
}

interface Document {
  id: number;
  name: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  createdAt: string;
}

interface Update {
  id: number;
  content: string;
  type: string;
  createdAt: string;
}

interface ProjectDetailData {
  project: Project;
  steps: WorkflowStep[];
  tasks: { id: number; column: string }[];
  documents: Document[];
  updates: Update[];
}

function formatRefNumber(id: number) {
  return `SMC-${new Date().getFullYear()}-${String(id).padStart(3, "0")}`;
}

function formatDate(dateStr: string | null | undefined, opts?: Intl.DateTimeFormatOptions) {
  if (!dateStr) return null;
  return new Date(dateStr).toLocaleDateString("en-US", opts ?? { month: "short", day: "numeric", year: "numeric" });
}

function ImpactBadge({ type }: { type: string }) {
  const cfg: Record<string, { label: string; cls: string }> = {
    milestone: { label: "High Impact", cls: "bg-red-50 text-red-700 border border-red-100" },
    update:    { label: "Strategic",   cls: "bg-blue-50 text-[#0078D4] border border-blue-100" },
    file:      { label: "Reference",   cls: "bg-gray-50 text-gray-600 border border-gray-200" },
    message:   { label: "Advisory",    cls: "bg-teal-50 text-teal-700 border border-teal-100" },
  };
  const c = cfg[type] ?? cfg.update;
  return <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${c.cls}`}>{c.label}</span>;
}

function StatusPill({ status }: { status: string }) {
  const cfg: Record<string, { label: string; cls: string }> = {
    completed:   { label: "APPROVED",    cls: "text-green-600" },
    in_progress: { label: "IN REVIEW",   cls: "text-[#0078D4]" },
    pending:     { label: "PLANNED",     cls: "text-gray-500" },
    blocked:     { label: "ON HOLD",     cls: "text-amber-600" },
  };
  const c = cfg[status] ?? { label: status.replace("_", " ").toUpperCase(), cls: "text-gray-500" };
  return (
    <span className={`flex items-center gap-1.5 text-[11px] font-bold tracking-wide ${c.cls}`}>
      <span className={`w-2 h-2 rounded-full ${status === "completed" ? "bg-green-500" : status === "in_progress" ? "bg-[#0078D4]" : status === "blocked" ? "bg-amber-500" : "bg-gray-300"}`} />
      {c.label}
    </span>
  );
}

export default function PortalRetainerDetail({
  data,
  projectId,
  fetchWithAuth,
}: {
  data: ProjectDetailData;
  projectId: string;
  fetchWithAuth: (url: string, opts?: RequestInit) => Promise<Response>;
}) {
  const [exportingAudit, setExportingAudit] = useState(false);

  const { project, steps, documents, updates } = data;

  const activeInitiatives = steps.filter(s => s.status === "in_progress");
  const longTermGoals     = steps.filter(s => s.status === "pending");
  const completedSteps    = steps.filter(s => s.status === "completed").length;
  const overallPct        = steps.length > 0 ? Math.round((completedSteps / steps.length) * 100) : project.progress;
  const inProgressPct     = steps.length > 0 ? Math.round((activeInitiatives.length / steps.length) * 100) : 0;
  const pendingPct        = steps.length > 0 ? Math.round((longTermGoals.length / steps.length) * 100) : 0;

  const recentUpdates = updates.slice(0, 6);

  const handleExportAudit = async () => {
    if (exportingAudit) return;
    setExportingAudit(true);
    try {
      const res = await fetchWithAuth(`/api/portal/projects/${projectId}/audit-pdf`);
      if (!res.ok) { alert("Failed to generate audit PDF. Please try again."); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const year = new Date().getFullYear();
      const refNum = `SMC-${year}-${String(projectId).padStart(3, "0")}`;
      const a = document.createElement("a");
      a.href = url; a.download = `audit-${refNum}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } finally { setExportingAudit(false); }
  };

  return (
    <div className="bg-[#F8FAFC] min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">

        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
          <Link href="/portal/projects"><span className="hover:text-[#0078D4] cursor-pointer">Projects</span></Link>
          <span>/</span>
          <span className="text-[#0A2540] font-medium truncate">{project.title}</span>
        </nav>

        {/* ── Header ── */}
        <header className="flex flex-col md:flex-row md:items-end justify-between mb-10 gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className="bg-[#0A2540] text-white text-[10px] px-2.5 py-1 rounded tracking-widest uppercase font-bold">
                Fractional Oversight
              </span>
              <span className="text-xs font-mono text-muted-foreground tracking-wider">
                {formatRefNumber(project.id)}
              </span>
            </div>
            <h1 className="text-3xl font-bold text-[#0A2540] tracking-tight leading-tight">{project.title}</h1>
            {project.phase && (
              <p className="text-muted-foreground mt-1 text-sm">
                Engagement Scope: <span className="font-mono text-[#0A2540] font-semibold">{project.phase}</span>
              </p>
            )}
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => void handleExportAudit()}
              disabled={exportingAudit}
              className="bg-white border border-[#0A2540]/20 px-4 py-2 rounded-lg text-sm font-semibold text-[#0A2540] flex items-center gap-2 hover:bg-gray-50 disabled:opacity-50 transition-all shadow-sm"
            >
              {exportingAudit ? (
                <div className="w-4 h-4 border-2 border-[#0A2540] border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              )}
              Export Report
            </button>
            <Link href="/portal/messages">
              <button className="bg-[#0A2540] text-white px-5 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 hover:bg-[#0A2540]/90 transition-all shadow-sm">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
                Message Advisor
              </button>
            </Link>
          </div>
        </header>

        {/* ── Grid ── */}
        <div className="grid grid-cols-12 gap-6">

          {/* ── Left Column (8/12) ── */}
          <section className="col-span-12 lg:col-span-8 space-y-6">

            {/* Executive Summary & Strategy */}
            <div className="bg-white p-8 rounded-xl shadow-sm border-l-4 border-[#0A2540]">
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h3 className="text-lg font-bold text-[#0A2540] mb-1">Executive Summary &amp; Strategy</h3>
                  {project.description && (
                    <p className="text-sm text-muted-foreground leading-relaxed max-w-xl">{project.description}</p>
                  )}
                </div>
                <svg className="w-8 h-8 text-gray-200 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Active Initiatives */}
                <div className="space-y-4">
                  <h4 className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">Active Initiatives</h4>
                  {activeInitiatives.length === 0 ? (
                    <p className="text-sm text-muted-foreground italic">No active phases at this time.</p>
                  ) : (
                    <ul className="space-y-3">
                      {activeInitiatives.slice(0, 4).map(step => (
                        <li key={step.id} className="flex items-start gap-3">
                          <svg className="w-5 h-5 text-[#00B4D8] flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="currentColor">
                            <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clipRule="evenodd" />
                          </svg>
                          <div>
                            <p className="text-sm font-semibold text-[#0A2540] leading-snug">{step.title}</p>
                            {step.description && <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{step.description}</p>}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {/* Long-Term Goals */}
                <div className="space-y-4">
                  <h4 className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">Long-Term Goals</h4>
                  {longTermGoals.length === 0 ? (
                    <p className="text-sm text-muted-foreground italic">All planned phases are in motion.</p>
                  ) : (
                    <ul className="space-y-3">
                      {longTermGoals.slice(0, 4).map(step => (
                        <li key={step.id} className="flex items-start gap-3">
                          <svg className="w-5 h-5 text-gray-300 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                            <circle cx="12" cy="12" r="9" />
                            <circle cx="12" cy="12" r="3" fill="currentColor" />
                          </svg>
                          <div>
                            <p className="text-sm font-semibold text-[#0A2540] leading-snug">{step.title}</p>
                            {step.description && <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{step.description}</p>}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>

            {/* Quarterly Strategic Roadmap */}
            {steps.length > 0 && (
              <div className="bg-white p-8 rounded-xl shadow-sm">
                <h3 className="text-lg font-bold text-[#0A2540] mb-8">Strategic Roadmap</h3>
                <div className="relative pt-8 pb-4">
                  {/* Timeline line */}
                  <div className="absolute top-0 left-0 w-full h-0.5 bg-gray-100" />
                  <div
                    className="absolute top-0 left-0 h-0.5 bg-[#0078D4] transition-all"
                    style={{ width: `${overallPct}%` }}
                  />
                  <div className={`grid gap-6 ${steps.length <= 2 ? "grid-cols-2" : steps.length === 3 ? "grid-cols-3" : "grid-cols-2 md:grid-cols-4"}`}>
                    {steps.map((step, idx) => {
                      const isComplete  = step.status === "completed";
                      const isActive    = step.status === "in_progress";
                      const monthLabel  = step.dueDate
                        ? new Date(step.dueDate).toLocaleDateString("en-US", { month: "long" }).toUpperCase()
                        : step.completedAt
                          ? new Date(step.completedAt).toLocaleDateString("en-US", { month: "long" }).toUpperCase()
                          : `PHASE ${idx + 1}`;
                      return (
                        <div key={step.id} className={`relative ${!isComplete && !isActive ? "opacity-60" : ""}`}>
                          <div className={`absolute -top-[37px] left-0 w-4 h-4 rounded-full border-4 border-white ${isComplete ? "bg-[#0A2540]" : isActive ? "bg-[#0078D4]" : "bg-gray-300"}`} />
                          <p className="font-mono text-[11px] text-muted-foreground mb-2 tracking-wider">{monthLabel}</p>
                          <h5 className="text-sm font-bold text-[#0A2540] mb-2 leading-snug">{step.title}</h5>
                          {step.description && <p className="text-xs text-muted-foreground mb-3 leading-relaxed line-clamp-2">{step.description}</p>}
                          <div className="h-1 bg-gray-100 w-full rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${isComplete ? "bg-[#0A2540]" : isActive ? "bg-[#00B4D8]" : "bg-transparent"}`}
                              style={{ width: isComplete ? "100%" : isActive ? "50%" : "0%" }}
                            />
                          </div>
                          {step.completedAt && (
                            <p className="text-[10px] text-green-600 font-semibold mt-1">
                              Completed {formatDate(step.completedAt, { month: "short", day: "numeric" })}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Key Decision Log */}
            {recentUpdates.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                <div className="p-8 pb-4">
                  <h3 className="text-lg font-bold text-[#0A2540]">Engagement Log</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-gray-50 border-y border-gray-100">
                        <th className="px-8 py-3 text-[11px] font-bold text-muted-foreground uppercase tracking-wider">ENTRY</th>
                        <th className="px-8 py-3 text-[11px] font-bold text-muted-foreground uppercase tracking-wider">IMPACT</th>
                        <th className="px-8 py-3 text-[11px] font-bold text-muted-foreground uppercase tracking-wider">STATUS</th>
                        <th className="px-8 py-3 text-[11px] font-bold text-muted-foreground uppercase tracking-wider">DATE</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {recentUpdates.map(upd => (
                        <tr key={upd.id} className="hover:bg-gray-50/50 transition-colors">
                          <td className="px-8 py-5">
                            <p className="text-sm font-semibold text-[#0A2540] leading-snug line-clamp-1">{upd.content}</p>
                          </td>
                          <td className="px-8 py-5">
                            <ImpactBadge type={upd.type} />
                          </td>
                          <td className="px-8 py-5">
                            <StatusPill status={upd.type === "milestone" ? "completed" : "in_progress"} />
                          </td>
                          <td className="px-8 py-5 font-mono text-xs text-muted-foreground">
                            {formatDate(upd.createdAt, { month: "short", day: "numeric", year: "numeric" })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>

          {/* ── Right Sidebar (4/12) ── */}
          <aside className="col-span-12 lg:col-span-4 space-y-6">

            {/* Governance Health Score */}
            <div className="bg-white p-8 rounded-xl shadow-sm">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">Engagement Health</h3>
                <span className="text-[#00B4D8] font-bold text-2xl">{overallPct}%</span>
              </div>
              <div className="space-y-5">
                <div>
                  <div className="flex justify-between text-sm mb-1.5">
                    <span className="text-[#0A2540]">Overall Progress</span>
                    <span className="font-semibold text-[#0A2540]">{overallPct}%</span>
                  </div>
                  <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-[#00B4D8] rounded-full transition-all" style={{ width: `${overallPct}%` }} />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1.5">
                    <span className="text-[#0A2540]">Active Phases</span>
                    <span className="font-semibold text-[#0A2540]">{activeInitiatives.length}/{steps.length}</span>
                  </div>
                  <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-[#0078D4] rounded-full transition-all" style={{ width: `${inProgressPct}%` }} />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1.5">
                    <span className="text-[#0A2540]">Phases Completed</span>
                    <span className="font-semibold text-[#0A2540]">{completedSteps}/{steps.length}</span>
                  </div>
                  <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-[#0A2540] rounded-full transition-all" style={{ width: steps.length > 0 ? `${Math.round(completedSteps / steps.length * 100)}%` : "0%" }} />
                  </div>
                </div>
                {longTermGoals.length > 0 && (
                  <div>
                    <div className="flex justify-between text-sm mb-1.5">
                      <span className="text-[#0A2540]">Planned Ahead</span>
                      <span className="font-semibold text-[#0A2540]">{longTermGoals.length}/{steps.length}</span>
                    </div>
                    <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-gray-300 rounded-full transition-all" style={{ width: `${pendingPct}%` }} />
                    </div>
                  </div>
                )}
              </div>
              {steps.length > 0 && (
                <p className="mt-6 text-xs text-muted-foreground leading-relaxed">
                  {completedSteps} of {steps.length} phases complete.
                  {activeInitiatives.length > 0 && ` ${activeInitiatives.length} phase${activeInitiatives.length > 1 ? "s" : ""} currently active.`}
                </p>
              )}
            </div>

            {/* Your Executive Advisor */}
            <div className="bg-[#0A2540] p-8 rounded-xl shadow-sm text-white relative overflow-hidden">
              <div className="absolute -right-8 -top-8 w-32 h-32 bg-white/5 rounded-full blur-2xl pointer-events-none" />
              <div className="flex items-center gap-4 mb-6">
                <div className="w-16 h-16 rounded-full border-2 border-white/20 bg-white/10 flex items-center justify-center flex-shrink-0">
                  <svg className="w-8 h-8 text-white/60" viewBox="0 0 24 24" fill="currentColor">
                    <path fillRule="evenodd" d="M7.5 6a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM3.751 20.105a8.25 8.25 0 0116.498 0 .75.75 0 01-.437.695A18.683 18.683 0 0112 22.5c-2.786 0-5.433-.608-7.812-1.7a.75.75 0 01-.437-.695z" clipRule="evenodd" />
                  </svg>
                </div>
                <div>
                  <h4 className="font-bold text-lg text-white">Shane McCaw</h4>
                  <p className="text-white/60 text-sm">Lead Strategic Advisor</p>
                  <p className="text-white/40 text-xs mt-0.5">Microsoft 365 Architect · NASA</p>
                </div>
              </div>
              <div className="space-y-3">
                <Link href="/portal/book-meeting">
                  <button className="w-full bg-white text-[#0A2540] py-3 rounded-lg text-sm font-bold hover:bg-gray-50 transition-all flex items-center justify-center gap-2">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    Schedule Strategy Session
                  </button>
                </Link>
                <Link href="/portal/messages">
                  <button className="w-full bg-white/10 text-white border border-white/20 py-3 rounded-lg text-sm font-semibold hover:bg-white/20 transition-all flex items-center justify-center gap-2">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                    </svg>
                    Message Advisor
                  </button>
                </Link>
              </div>
            </div>

            {/* Strategic Resources (Documents) */}
            {documents.length > 0 && (
              <div className="bg-white p-8 rounded-xl shadow-sm">
                <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-5">Strategic Resources</h3>
                <nav className="space-y-3">
                  {documents.slice(0, 6).map(doc => (
                    <a
                      key={doc.id}
                      href={`/api/portal/documents/${doc.id}/download`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between group p-2 -mx-2 rounded-lg hover:bg-gray-50 transition-all"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <svg className="w-5 h-5 text-muted-foreground flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                        </svg>
                        <span className="text-sm text-[#0A2540] truncate">{doc.name}</span>
                      </div>
                      <svg className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                  ))}
                </nav>
              </div>
            )}

            {/* Engagement Certification */}
            <div className="border-2 border-dashed border-gray-200 p-6 rounded-xl flex items-center gap-4">
              <svg className="w-8 h-8 text-muted-foreground flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
              </svg>
              <div>
                <p className="text-[10px] uppercase font-bold text-muted-foreground mb-0.5">Certified Oversight</p>
                <p className="text-sm text-[#0A2540] leading-snug">Engagement meets Microsoft 365 Best Practice Framework (BPF) standards.</p>
              </div>
            </div>

          </aside>
        </div>
      </div>
    </div>
  );
}
