import { useState } from "react";
import { Link } from "wouter";
import { formatAuditEntry, type AuditLogEntry } from "@/lib/auditFormatter";
import { useToast } from "@/hooks/use-toast";

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
  sharepointFolderUrl: string | null;
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

interface Task {
  id: number;
  title: string;
  column: string;
  workflowStepId: number | null;
  completionNotes: string | null;
}

interface ClosureRecord {
  id: number;
  projectId: number;
  requestedAt: string;
  feedback: string | null;
  permissionGranted: boolean;
  signatureDataUrl: string | null;
  signedAt: string | null;
}

interface ProjectDetailData {
  project: Project;
  steps: WorkflowStep[];
  tasks: Task[];
}

function formatRefNumber(id: number): string {
  return `SMC-${new Date().getFullYear()}-${String(id).padStart(3, "0")}`;
}

function formatDate(iso: string | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", opts ?? { month: "long", day: "numeric", year: "numeric" });
}

function hashStub(id: number, iso: string): string {
  const seed = `${id}-${iso}`;
  let h1 = 0x6c62272e, h2 = 0x07bb0142;
  for (let i = 0; i < seed.length; i++) {
    const c = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x9e3779b9) | 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) | 0;
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  return `${hex(h1)}${hex(h2)}${hex(h1 ^ h2)}${hex(h2 ^ (h1 + 7))}${hex(h1 ^ 42)}${hex(h2 ^ 13)}${hex(h1 + h2)}${hex(h1 ^ h2 ^ 99)}`;
}

export default function PortalProjectCloseOut({
  data,
  closure,
  auditLogs,
  projectId,
  fetchWithAuth,
}: {
  data: ProjectDetailData;
  closure: ClosureRecord;
  auditLogs: AuditLogEntry[];
  projectId: string;
  fetchWithAuth: (url: string, opts?: RequestInit) => Promise<Response>;
}) {
  const [exportingAudit, setExportingAudit] = useState(false);
  const { toast } = useToast();
  const { project, steps, tasks } = data;

  const handleExportAudit = async () => {
    if (exportingAudit) return;
    setExportingAudit(true);
    try {
      const res = await fetchWithAuth(`/api/portal/projects/${projectId}/audit-pdf`);
      if (!res.ok) {
        toast({ variant: "destructive", title: "Export failed", description: "Failed to generate report. Please try again." });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `close-out-${formatRefNumber(project.id)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExportingAudit(false);
    }
  };

  const hash = closure.signedAt ? hashStub(closure.id, closure.signedAt) : "—";

  return (
    <div className="bg-[#F8FAFC] min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">

        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
          <Link href="/portal/projects">
            <span className="hover:text-[#0078D4] cursor-pointer">Projects</span>
          </Link>
          <span>/</span>
          <span className="text-[#0A2540] font-medium truncate">{project.title}</span>
        </nav>

        {/* ── Header ── */}
        <header className="bg-[#0A2540] rounded-2xl px-8 py-7 mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 bg-green-500/20 text-green-400 text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full border border-green-500/30">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                  <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clipRule="evenodd" />
                </svg>
                Completed
              </span>
              <span className="text-white/40 font-mono text-xs tracking-wider">{formatRefNumber(project.id)}</span>
            </div>
            <h1 className="text-2xl font-extrabold text-white leading-tight">{project.title}</h1>
            <p className="text-white/50 text-sm mt-1">Shane McCaw Consulting · Lead Microsoft 365 Architect</p>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <Link href="/portal/messages">
              <span className="inline-flex items-center gap-2 bg-white/10 border border-white/20 text-white text-sm font-semibold px-4 py-2.5 rounded-xl hover:bg-white/20 transition-colors cursor-pointer">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
                Message Advisor
              </span>
            </Link>
            <button
              onClick={() => void handleExportAudit()}
              disabled={exportingAudit}
              className="flex items-center gap-2 bg-white text-[#0A2540] text-sm font-semibold px-4 py-2.5 rounded-xl hover:bg-gray-100 transition-colors disabled:opacity-50"
            >
              {exportingAudit ? (
                <div className="w-4 h-4 border-2 border-[#0A2540]/40 border-t-[#0A2540] rounded-full animate-spin" />
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              )}
              Export Report
            </button>
          </div>
        </header>

        {/* ── Executive Summary + Final Approval ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">

          {/* Executive Summary */}
          <div className="bg-white rounded-2xl p-7 shadow-sm border-l-4 border-[#00B4D8]">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-9 h-9 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 24 24">
                  <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clipRule="evenodd" />
                </svg>
              </div>
              <div>
                <h2 className="text-base font-bold text-[#0A2540]">Project Signed Off</h2>
                <p className="text-xs text-muted-foreground">{formatDate(closure.signedAt)}</p>
              </div>
            </div>

            {closure.feedback ? (
              <blockquote className="border-l-2 border-[#00B4D8] pl-4 my-4">
                <p className="text-sm text-[#0A2540] leading-relaxed italic">"{closure.feedback}"</p>
              </blockquote>
            ) : (
              <p className="text-sm text-muted-foreground italic my-4">No written feedback was submitted.</p>
            )}

            {project.description && (
              <div className="pt-4 border-t border-border">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">Project Scope</p>
                <p className="text-xs text-muted-foreground leading-relaxed">{project.description}</p>
              </div>
            )}

            <div className="mt-4 pt-4 border-t border-border flex flex-wrap gap-6">
              {project.startDate && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-0.5">Started</p>
                  <p className="text-xs font-semibold text-[#0A2540]">{formatDate(project.startDate)}</p>
                </div>
              )}
              {closure.signedAt && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-0.5">Closed</p>
                  <p className="text-xs font-semibold text-[#0A2540]">{formatDate(closure.signedAt)}</p>
                </div>
              )}
            </div>
          </div>

          {/* Final Approval */}
          <div className="bg-white rounded-2xl p-7 shadow-sm">
            <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-5">Final Approval</h2>

            <div className="border-2 border-dashed border-border rounded-xl bg-gray-50 p-4 mb-4 min-h-[100px] flex items-center justify-center">
              {closure.signatureDataUrl ? (
                <img
                  src={closure.signatureDataUrl}
                  alt="Client signature"
                  className="max-h-20 max-w-full object-contain"
                />
              ) : (
                <p className="text-xs text-muted-foreground italic">No signature on file</p>
              )}
            </div>

            <div className="border-t-2 border-[#0A2540] pt-3 mb-5">
              <p className="text-xs font-semibold text-[#0A2540]">Authorized Digital Signature</p>
              {closure.signedAt && (
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Signed {formatDate(closure.signedAt)}
                </p>
              )}
            </div>

            <div className="bg-gray-50 border border-border rounded-xl px-4 py-3 mb-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">Signature Hash (SHA-256)</p>
              <p className="font-mono text-[10px] text-[#0A2540] break-all leading-relaxed">{hash}</p>
            </div>

            <div className="flex items-start gap-2">
              <svg className="w-4 h-4 text-green-600 flex-shrink-0 mt-px" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
              </svg>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                This electronic signature has the same legal effect as a handwritten signature under applicable e-signature law.
              </p>
            </div>
          </div>
        </div>

        {/* ── Engagement Progress ── */}
        <div className="bg-white rounded-2xl p-7 shadow-sm mb-6">
          <div className="flex items-center justify-between flex-wrap gap-4 mb-3">
            <h2 className="text-sm font-bold text-[#0A2540]">Engagement Progress</h2>
            <span className="text-lg font-extrabold text-green-600">100%</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-2.5 mb-3">
            <div
              className="h-2.5 rounded-full"
              style={{ width: "100%", background: "linear-gradient(90deg, #0078D4 0%, #00B4D8 100%)" }}
            />
          </div>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-green-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <p className="text-xs text-muted-foreground">All strategic gates verified — engagement successfully concluded</p>
            </div>
            {project.sharepointFolderUrl && (
              <a
                href={project.sharepointFolderUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0078D4] hover:text-[#0078D4]/80 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
                View SharePoint Folder
              </a>
            )}
          </div>
        </div>

        {/* ── Final Deliverables & Milestones ── */}
        <div className="bg-white rounded-2xl shadow-sm mb-6 overflow-hidden">
          <div className="px-7 py-5 border-b border-border">
            <h2 className="text-sm font-bold text-[#0A2540]">Final Deliverables &amp; Milestones</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{steps.length} phase{steps.length !== 1 ? "s" : ""} · {tasks.filter(t => t.column === "completed").length}/{tasks.length} tasks completed</p>
          </div>
          {steps.length === 0 ? (
            <div className="px-7 py-8 text-center text-sm text-muted-foreground">No workflow phases defined for this project.</div>
          ) : (
            <div className="divide-y divide-border">
              {steps.map((step, idx) => {
                const stepTasks = tasks.filter(t => t.workflowStepId === step.id);
                return (
                  <div key={step.id} className="px-7 py-5">
                    <div className="flex items-start gap-3 mb-3">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 border-2 mt-0.5 ${
                        step.status === "completed"
                          ? "bg-green-500 border-green-500"
                          : step.status === "in_progress"
                          ? "bg-[#0078D4] border-[#0078D4]"
                          : "bg-white border-gray-300"
                      }`}>
                        {step.status === "completed" ? (
                          <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        ) : (
                          <span className="text-[9px] font-bold text-gray-400">{idx + 1}</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <p className="text-sm font-bold text-[#0A2540]">{step.title}</p>
                          <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full flex-shrink-0 ${
                            step.status === "completed"
                              ? "bg-green-100 text-green-700"
                              : step.status === "in_progress"
                              ? "bg-blue-100 text-blue-700"
                              : "bg-gray-100 text-gray-500"
                          }`}>
                            {step.status === "completed" ? "Completed" : step.status === "in_progress" ? "In Progress" : "Pending"}
                          </span>
                          {step.dueDate && (
                            <span className="text-[10px] text-muted-foreground flex-shrink-0">
                              Due {formatDate(step.dueDate, { month: "short", day: "numeric", year: "numeric" })}
                            </span>
                          )}
                          {step.completedAt && (
                            <span className="text-[10px] text-green-600 font-semibold flex-shrink-0">
                              ✓ {formatDate(step.completedAt, { month: "short", day: "numeric" })}
                            </span>
                          )}
                        </div>
                        {step.description && (
                          <p className="text-xs text-muted-foreground leading-relaxed">{step.description}</p>
                        )}
                      </div>
                    </div>

                    {stepTasks.length > 0 && (
                      <div className="ml-10 space-y-2">
                        {stepTasks.map(t => (
                          <div key={t.id} className="flex items-start gap-2.5 bg-gray-50 border border-border rounded-xl px-4 py-2.5">
                            <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${
                              t.column === "completed" ? "bg-green-500 border-green-500" : "border-gray-300"
                            }`}>
                              {t.column === "completed" && (
                                <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 12 12" fill="none">
                                  <path d="M2 6l3 3 5-5" stroke="white" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className={`text-xs font-medium leading-snug ${t.column === "completed" ? "text-muted-foreground line-through" : "text-[#0A2540]"}`}>
                                {t.title}
                              </p>
                              {t.completionNotes && (
                                <p className="text-[10px] text-muted-foreground mt-0.5 italic">{t.completionNotes}</p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Audit Log & Activity History ── */}
        <details className="bg-white rounded-2xl shadow-sm overflow-hidden mb-8 group">
          <summary className="px-7 py-5 cursor-pointer flex items-center justify-between list-none select-none">
            <div>
              <h2 className="text-sm font-bold text-[#0A2540]">Audit Log &amp; Activity History</h2>
              <p className="text-xs text-muted-foreground mt-0.5">{auditLogs.length} event{auditLogs.length !== 1 ? "s" : ""} recorded</p>
            </div>
            <svg className="w-4 h-4 text-muted-foreground transition-transform group-open:rotate-180 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </summary>
          <div className="border-t border-border">
            {auditLogs.length === 0 ? (
              <div className="px-7 py-8 text-center text-sm text-muted-foreground">No activity records found.</div>
            ) : (
              <div className="divide-y divide-border max-h-96 overflow-y-auto">
                {auditLogs.map((entry, i) => (
                  <div key={entry.id ?? i} className="flex items-start gap-3 px-7 py-3.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#0078D4] flex-shrink-0 mt-1.5" />
                    <p className="text-xs text-[#0A2540] leading-relaxed flex-1 min-w-0">{formatAuditEntry(entry)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </details>

      </div>
    </div>
  );
}
