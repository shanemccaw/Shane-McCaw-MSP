import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import PortalLayout from "@/components/PortalLayout";
import { KanbanCardModal } from "@/components/KanbanCardModal";
import type { KanbanCardModalTask } from "@/components/KanbanCardModal";

// ── Types ────────────────────────────────────────────────────────────────────

interface ProjectSummary {
  id: number;
  title: string;
  status: string;
  progress: number;
  projectType: string;
  stepCount: number;
  currentStepTitle: string | null;
  startDate: string | null;
  endDate: string | null;
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

interface KanbanTask {
  id: number;
  title: string;
  description: string | null;
  column: "backlog" | "in_progress" | "waiting_on_customer" | "completed";
  order: number;
  assignedTo: string | null;
  dueDate: string | null;
  workflowStepId: number | null;
  groupName: string | null;
  waitingReason: string | null;
  completionStatus: string | null;
  completionNotes: string | null;
  createdAt: string;
  updatedAt: string;
  priority?: string;
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

interface StatusReport {
  id: number;
  title: string;
  period: string;
  executiveSummary: string | null;
  completedActivities: Array<{ title: string; description: string }>;
  nextSteps: Array<{ label: string; title: string; description: string }>;
  reportDate: string | null;
  sentAt: string | null;
  clientStatus: "pending" | "accepted" | "has_questions";
  clientQuestion: string | null;
  adminReply: string | null;
}

interface ProjectDetail {
  project: {
    id: number;
    title: string;
    description: string | null;
    status: string;
    phase: string | null;
    progress: number;
    startDate: string | null;
    endDate: string | null;
    projectType: string;
  };
  steps: WorkflowStep[];
  tasks: KanbanTask[];
  documents: Document[];
  updates: Update[];
  statusReports: StatusReport[];
  pendingStatusReport: StatusReport | null;
  contract: { id: number; signedAt: string | null; signerName: string | null } | null;
}

interface Invoice {
  id: number;
  invoiceNumber: string;
  description: string | null;
  amount: string;
  currency: string;
  status: string;
  dueDate: string | null;
  paidAt: string | null;
  projectId: number | null;
  pdfFilename: string | null;
  createdAt: string;
}

interface Message {
  id: number;
  senderUserId: number;
  body: string;
  readByClient: boolean;
  createdAt: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d: string | null | undefined, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }) {
  if (!d) return null;
  return new Date(d).toLocaleDateString("en-US", opts);
}

function fmtBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function fmtCurrency(amount: string, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(parseFloat(amount));
}

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { label: string; cls: string }> = {
    active: { label: "In Progress", cls: "bg-blue-100 text-blue-700 border-blue-200" },
    on_hold: { label: "On Hold", cls: "bg-yellow-100 text-yellow-700 border-yellow-200" },
    completed: { label: "Completed", cls: "bg-green-100 text-green-700 border-green-200" },
    cancelled: { label: "Cancelled", cls: "bg-red-100 text-red-600 border-red-200" },
  };
  const c = cfg[status] ?? { label: status.replace("_", " "), cls: "bg-gray-100 text-gray-600 border-gray-200" };
  return (
    <span className={`text-[10px] font-bold tracking-widest uppercase px-2.5 py-1 rounded-md border ${c.cls}`}>{c.label}</span>
  );
}

function InvoiceStatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { label: string; cls: string }> = {
    paid: { label: "Paid", cls: "bg-green-100 text-green-700" },
    due: { label: "Due", cls: "bg-blue-100 text-blue-700" },
    overdue: { label: "Overdue", cls: "bg-red-100 text-red-700" },
    draft: { label: "Draft", cls: "bg-gray-100 text-gray-600" },
  };
  const c = cfg[status] ?? { label: status, cls: "bg-gray-100 text-gray-600" };
  return <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${c.cls}`}>{c.label}</span>;
}

function periodLabel(period: string) {
  return ({ weekly: "Weekly", monthly: "Monthly", executive_summary: "Executive Summary", other: "Report" })[period] ?? period;
}

function ClientStatusChip({ status }: { status: "pending" | "accepted" | "has_questions" }) {
  if (status === "accepted") return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200">
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
      Accepted
    </span>
  );
  if (status === "has_questions") return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
      Has Questions
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 border border-orange-200">
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
      Pending
    </span>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function ClientProjectDashboard() {
  const { fetchWithAuth, user } = useAuth();

  // Project list
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);

  // Selected project + its detail (cached)
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const detailCache = useRef<Map<number, ProjectDetail>>(new Map());
  const [currentDetail, setCurrentDetail] = useState<ProjectDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Global data (loaded once)
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);

  // Status report acknowledgement
  const [acknowledging, setAcknowledging] = useState(false);
  const [questionDialogFor, setQuestionDialogFor] = useState<StatusReport | null>(null);
  const [questionText, setQuestionText] = useState("");
  const [expandedReportId, setExpandedReportId] = useState<number | null>(null);

  // Document upload
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadName, setUploadName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  // Messages compose
  const [msgBody, setMsgBody] = useState("");
  const [sendingMsg, setSendingMsg] = useState(false);

  // Audit PDF export
  const [exportingAudit, setExportingAudit] = useState(false);

  // Kanban card modal
  const [selectedTask, setSelectedTask] = useState<KanbanCardModalTask | null>(null);

  // Invoice pay loading
  const [payingInvoice, setPayingInvoice] = useState<number | null>(null);

  // Ref to scroll to task board when "Waiting on You" stat is clicked
  const taskBoardRef = useRef<HTMLDivElement>(null);

  // ── Load project list ────────────────────────────────────────────────────

  useEffect(() => {
    fetchWithAuth("/api/portal/projects")
      .then(r => r.json())
      .then((list: ProjectSummary[]) => {
        setProjects(list);
        if (list.length > 0) setSelectedId(list[0].id);
      })
      .catch(() => null)
      .finally(() => setProjectsLoading(false));

    fetchWithAuth("/api/portal/invoices")
      .then(r => r.json())
      .then((list: Invoice[]) => setInvoices(list))
      .catch(() => null);

    fetchWithAuth("/api/portal/messages")
      .then(r => r.json())
      .then((list: Message[]) => setMessages(list))
      .catch(() => null);
  }, [fetchWithAuth]);

  // ── Load project detail on tab select ───────────────────────────────────

  useEffect(() => {
    if (!selectedId) return;
    if (detailCache.current.has(selectedId)) {
      setCurrentDetail(detailCache.current.get(selectedId)!);
      return;
    }
    setDetailLoading(true);
    fetchWithAuth(`/api/portal/projects/${selectedId}`)
      .then(r => r.json())
      .then((d: ProjectDetail) => {
        detailCache.current.set(selectedId, d);
        setCurrentDetail(d);
      })
      .catch(() => null)
      .finally(() => setDetailLoading(false));
  }, [selectedId, fetchWithAuth]);

  const refreshDetail = useCallback(() => {
    if (!selectedId) return;
    detailCache.current.delete(selectedId);
    setDetailLoading(true);
    fetchWithAuth(`/api/portal/projects/${selectedId}`)
      .then(r => r.json())
      .then((d: ProjectDetail) => {
        detailCache.current.set(selectedId, d);
        setCurrentDetail(d);
      })
      .catch(() => null)
      .finally(() => setDetailLoading(false));
  }, [fetchWithAuth, selectedId]);

  // ── Derived ──────────────────────────────────────────────────────────────

  const projectInvoices = useMemo(
    () => invoices.filter(inv => inv.projectId === selectedId),
    [invoices, selectedId]
  );

  const { steps, tasks, documents, updates, statusReports, pendingStatusReport, project } = currentDetail ?? {};

  const taskCounts = useMemo(() => {
    if (!tasks) return { backlog: 0, in_progress: 0, waiting: 0, completed: 0, total: 0 };
    return {
      backlog: tasks.filter(t => t.column === "backlog").length,
      in_progress: tasks.filter(t => t.column === "in_progress").length,
      waiting: tasks.filter(t => t.column === "waiting_on_customer").length,
      completed: tasks.filter(t => t.column === "completed").length,
      total: tasks.length,
    };
  }, [tasks]);

  const completedSteps = steps ? steps.filter(s => s.status === "completed").length : 0;
  const computedProgress = steps && steps.length > 0
    ? Math.round((completedSteps / steps.length) * 100)
    : project?.progress ?? 0;

  // Derived health status: Blocked > Needs Attention > On Track
  const healthStatus = useMemo((): { label: string; cls: string; dot: string } => {
    if (steps?.some(s => s.status === "blocked")) {
      return { label: "Blocked", cls: "bg-red-100 text-red-700 border-red-200", dot: "bg-red-500" };
    }
    if (projectInvoices.some(inv => inv.status === "overdue")) {
      return { label: "Needs Attention", cls: "bg-amber-100 text-amber-700 border-amber-200", dot: "bg-amber-500" };
    }
    if (project?.status === "completed") {
      return { label: "Complete", cls: "bg-green-100 text-green-700 border-green-200", dot: "bg-green-500" };
    }
    return { label: "On Track", cls: "bg-emerald-100 text-emerald-700 border-emerald-200", dot: "bg-emerald-500" };
  }, [steps, projectInvoices, project?.status]);

  // Composite activity feed — chronological merge from all sources for this project
  const activityFeed = useMemo(() => {
    type FeedItem = { id: string; content: string; type: string; createdAt: string };
    const items: FeedItem[] = [];

    // Project updates
    (updates ?? []).forEach(u => items.push({ id: `update-${u.id}`, content: u.content, type: u.type, createdAt: u.createdAt }));

    // Status reports
    (statusReports ?? []).forEach(r => {
      if (r.sentAt) items.push({ id: `report-${r.id}`, content: `Status report "${r.title}" sent`, type: "report", createdAt: r.sentAt });
    });

    // Project invoices
    projectInvoices.forEach(inv => {
      if (inv.paidAt) items.push({ id: `inv-paid-${inv.id}`, content: `Invoice ${inv.invoiceNumber} (${fmtCurrency(inv.amount, inv.currency)}) marked paid`, type: "invoice", createdAt: inv.paidAt });
      items.push({ id: `inv-${inv.id}`, content: `Invoice ${inv.invoiceNumber} for ${fmtCurrency(inv.amount, inv.currency)} created`, type: "invoice", createdAt: inv.createdAt });
    });

    // Documents
    (documents ?? []).forEach(doc => items.push({ id: `doc-${doc.id}`, content: `Document "${doc.name}" uploaded`, type: "document", createdAt: doc.createdAt }));

    // Last 3 messages
    messages.slice(-3).forEach(msg => items.push({ id: `msg-${msg.id}`, content: `Message: "${msg.body.slice(0, 80)}${msg.body.length > 80 ? "…" : ""}"`, type: "message", createdAt: msg.createdAt }));

    return items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 15);
  }, [updates, statusReports, projectInvoices, documents, messages]);

  // ── Acknowledge status report ────────────────────────────────────────────

  const acknowledgeReport = useCallback(async (report: StatusReport, status: "accepted" | "has_questions", question?: string) => {
    setAcknowledging(true);
    try {
      const r = await fetchWithAuth(`/api/portal/status-reports/${report.id}/acknowledge`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, question }),
      });
      if (r.ok) {
        setQuestionDialogFor(null);
        setQuestionText("");
        refreshDetail();
      }
    } finally {
      setAcknowledging(false);
    }
  }, [fetchWithAuth, refreshDetail]);

  // ── Document upload ──────────────────────────────────────────────────────

  const handleUpload = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile || !selectedId) return;
    setUploadError("");
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", uploadFile);
      if (uploadName.trim()) fd.append("name", uploadName.trim());
      const r = await fetchWithAuth(`/api/portal/projects/${selectedId}/documents`, { method: "POST", body: fd });
      if (!r.ok) {
        const d = await r.json() as { error: string };
        setUploadError(d.error ?? "Upload failed");
      } else {
        setUploadFile(null);
        setUploadName("");
        refreshDetail();
      }
    } finally {
      setUploading(false);
    }
  }, [fetchWithAuth, selectedId, uploadFile, uploadName, refreshDetail]);

  // ── Send message ─────────────────────────────────────────────────────────

  const sendMessage = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!msgBody.trim()) return;
    setSendingMsg(true);
    try {
      const r = await fetchWithAuth("/api/portal/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: msgBody.trim() }),
      });
      if (r.ok) {
        const newMsg = await r.json() as Message;
        setMessages(prev => [...prev, newMsg]);
        setMsgBody("");
      }
    } finally {
      setSendingMsg(false);
    }
  }, [fetchWithAuth, msgBody]);

  // ── Pay invoice ──────────────────────────────────────────────────────────

  const payInvoice = useCallback(async (invoiceId: number) => {
    setPayingInvoice(invoiceId);
    try {
      const r = await fetchWithAuth(`/api/portal/invoices/${invoiceId}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnUrl: window.location.origin }),
      });
      if (r.ok) {
        const d = await r.json() as { url: string };
        window.location.href = d.url;
      }
    } finally {
      setPayingInvoice(null);
    }
  }, [fetchWithAuth]);

  // ── Export audit PDF ─────────────────────────────────────────────────────

  const exportAuditPdf = useCallback(async () => {
    if (!selectedId || exportingAudit) return;
    setExportingAudit(true);
    try {
      const r = await fetchWithAuth(`/api/portal/projects/${selectedId}/audit-pdf`);
      if (r.ok) {
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `project-audit-${selectedId}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } finally {
      setExportingAudit(false);
    }
  }, [fetchWithAuth, selectedId, exportingAudit]);

  // ── Render ────────────────────────────────────────────────────────────────

  const selectedProject = projects.find(p => p.id === selectedId) ?? null;

  if (projectsLoading) {
    return (
      <PortalLayout>
        <div className="flex items-center justify-center min-h-[40vh]">
          <div className="w-8 h-8 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
        </div>
      </PortalLayout>
    );
  }

  if (projects.length === 0) {
    return (
      <PortalLayout>
        <div className="max-w-2xl mx-auto px-4 py-16 text-center">
          <div className="w-16 h-16 bg-[#0078D4]/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-[#0A2540] mb-2">No projects yet</h2>
          <p className="text-muted-foreground text-sm mb-6">Your active projects will appear here once Shane sets them up for you.</p>
          <Link href="/portal/onboarding/select" className="inline-flex items-center gap-2 bg-[#0078D4] text-white text-sm font-semibold px-5 py-2.5 rounded-xl hover:bg-[#0078D4]/90 transition-colors">
            Get Started
          </Link>
        </div>
      </PortalLayout>
    );
  }

  return (
    <PortalLayout>
      {/* Kanban card modal */}
      <KanbanCardModal
        open={!!selectedTask}
        task={selectedTask}
        stepTitle={null}
        onClose={() => setSelectedTask(null)}
      />

      {/* Question dialog */}
      {questionDialogFor && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h3 className="text-base font-bold text-[#0A2540] mb-1">Ask a Question</h3>
            <p className="text-sm text-muted-foreground mb-4">Re: <span className="font-semibold text-[#0A2540]">{questionDialogFor.title}</span></p>
            <label className="block text-xs font-semibold text-[#0A2540] mb-1.5">Your Question</label>
            <textarea
              value={questionText}
              onChange={e => setQuestionText(e.target.value)}
              rows={4}
              placeholder="Describe your question or concern about this report…"
              className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] resize-none"
            />
            <p className="text-xs text-muted-foreground mt-1.5 mb-5">Your question will be submitted to Shane for follow-up.</p>
            <div className="flex items-center gap-3 justify-end">
              <button onClick={() => { setQuestionDialogFor(null); setQuestionText(""); }} disabled={acknowledging}
                className="text-sm font-semibold text-muted-foreground px-4 py-2 rounded-lg border border-border hover:bg-gray-50 transition-colors disabled:opacity-50">
                Cancel
              </button>
              <button
                onClick={() => { if (questionText.trim()) acknowledgeReport(questionDialogFor, "has_questions", questionText.trim()); }}
                disabled={!questionText.trim() || acknowledging}
                className="text-sm font-semibold text-white bg-[#0078D4] px-4 py-2 rounded-lg hover:bg-[#0078D4]/90 transition-colors disabled:opacity-50 flex items-center gap-2">
                {acknowledging && <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
                Submit Question
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-5xl mx-auto px-4 pb-16">

        {/* ── Page heading ─────────────────────────────────────────────────── */}
        <div className="pt-6 pb-3">
          <h1 className="text-2xl font-bold text-[#0A2540]">My Projects</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Your active engagements with Shane McCaw Consulting</p>
        </div>

        {/* ── Mobile project selector ──────────────────────────────────────── */}
        <div className="md:hidden mb-4">
          <select
            value={selectedId ?? ""}
            onChange={e => setSelectedId(Number(e.target.value))}
            className="w-full border border-border rounded-xl px-4 py-2.5 text-sm font-semibold text-[#0A2540] bg-white focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
          >
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.title}</option>
            ))}
          </select>
        </div>

        {/* ── Desktop sticky tab strip ─────────────────────────────────────── */}
        <div className="hidden md:block sticky top-0 z-20 -mx-4 px-4 bg-[#F7F9FC] border-b border-border mb-6 overflow-x-auto">
          <div className="flex gap-1 min-w-max">
            {projects.map(p => (
              <button
                key={p.id}
                onClick={() => setSelectedId(p.id)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap ${
                  selectedId === p.id
                    ? "border-[#0078D4] text-[#0078D4]"
                    : "border-transparent text-muted-foreground hover:text-[#0A2540] hover:border-gray-300"
                }`}
              >
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  p.status === "active" ? "bg-blue-400" :
                  p.status === "completed" ? "bg-green-400" :
                  p.status === "on_hold" ? "bg-yellow-400" : "bg-gray-300"
                }`} />
                {p.title}
              </button>
            ))}
          </div>
        </div>

        {/* ── Project panel ────────────────────────────────────────────────── */}
        {detailLoading ? (
          <div className="flex items-center justify-center py-24">
            <div className="w-7 h-7 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : currentDetail && project ? (
          <div className="space-y-6">

            {/* ── Pending status report banner ─────────────────────────────── */}
            {pendingStatusReport && pendingStatusReport.clientStatus === "pending" && (
              <div className="bg-[#0078D4]/5 border border-[#0078D4]/20 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <div className="w-8 h-8 bg-[#0078D4]/10 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                    <svg className="w-4 h-4 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[#0A2540]">New status report awaiting your review</p>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{pendingStatusReport.title}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => { setQuestionDialogFor(pendingStatusReport); }}
                    className="text-xs font-semibold text-[#0078D4] border border-[#0078D4]/30 px-3 py-1.5 rounded-lg hover:bg-[#0078D4]/5 transition-colors"
                  >
                    Ask Question
                  </button>
                  <button
                    onClick={() => acknowledgeReport(pendingStatusReport, "accepted")}
                    disabled={acknowledging}
                    className="text-xs font-semibold text-white bg-[#0078D4] px-3 py-1.5 rounded-lg hover:bg-[#0078D4]/90 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {acknowledging && <div className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
                    Accept Report
                  </button>
                </div>
              </div>
            )}

            {/* ── 1. Project Header ─────────────────────────────────────────── */}
            <div className="bg-gradient-to-br from-[#0A2540] to-[#0A2540]/90 rounded-2xl p-5 text-white">
              <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <StatusBadge status={project.status} />
                    <span className={`text-[10px] font-bold tracking-wider uppercase px-2.5 py-1 rounded-md border flex items-center gap-1.5 ${healthStatus.cls}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${healthStatus.dot}`} />
                      {healthStatus.label}
                    </span>
                    <span className="text-white/50 text-xs uppercase tracking-widest font-semibold">
                      {project.projectType === "retainer" ? "Retainer" : "Project"}
                    </span>
                  </div>
                  <h2 className="text-xl font-bold text-white leading-tight">{project.title}</h2>
                  {project.description && (
                    <p className="text-white/60 text-sm mt-1 line-clamp-2">{project.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={exportAuditPdf}
                    disabled={exportingAudit}
                    className="flex items-center gap-1.5 text-xs font-semibold text-white/80 hover:text-white border border-white/20 px-3 py-1.5 rounded-lg hover:bg-white/10 transition-colors disabled:opacity-50"
                  >
                    {exportingAudit
                      ? <div className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                      : <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                    }
                    {exportingAudit ? "Exporting…" : "Audit PDF"}
                  </button>
                  <Link
                    href={`/portal/projects/${project.id}`}
                    className="flex items-center gap-1.5 text-xs font-semibold text-white border border-white/20 px-3 py-1.5 rounded-lg hover:bg-white/10 transition-colors"
                  >
                    Full View
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" /></svg>
                  </Link>
                </div>
              </div>

              {/* Progress bar */}
              <div className="mb-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-white/60 font-medium">Overall Progress</span>
                  <span className="text-xs font-bold text-white">{computedProgress}%</span>
                </div>
                <div className="w-full bg-white/10 rounded-full h-2">
                  <div
                    className="h-2 rounded-full transition-all"
                    style={{ width: `${computedProgress}%`, background: "linear-gradient(90deg, #0078D4 0%, #00B4D8 100%)" }}
                  />
                </div>
                {steps && steps.length > 0 && (
                  <p className="text-xs text-white/50 mt-1">{completedSteps} of {steps.length} phases complete</p>
                )}
              </div>

              {/* Date meta row */}
              <div className="flex flex-wrap items-center gap-4">
                {project.startDate && (
                  <span className="text-xs text-white/60">
                    <span className="font-semibold text-white/80">Started:</span> {fmtDate(project.startDate, { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                )}
                {project.endDate && (
                  <span className="text-xs text-white/60">
                    <span className="font-semibold text-white/80">Target:</span> {fmtDate(project.endDate, { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                )}
                {project.phase && (
                  <span className="text-xs text-white/60">
                    <span className="font-semibold text-white/80">Phase:</span> {project.phase}
                  </span>
                )}
              </div>
            </div>

            {/* ── 2. Phase Timeline ─────────────────────────────────────────── */}
            {steps && steps.length > 0 && (
              <div className="bg-white border border-border rounded-2xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-bold text-[#0A2540]">Phase Timeline</h3>
                  <span className="text-xs text-muted-foreground">{completedSteps}/{steps.length} complete</span>
                </div>

                {/* Mobile: vertical layout */}
                <div className="sm:hidden space-y-0">
                  {steps.map((step, idx) => {
                    const isCompleted = step.status === "completed";
                    const isActive = step.status === "in_progress";
                    const isBlocked = step.status === "blocked";
                    const isLast = idx === steps.length - 1;
                    return (
                      <div key={step.id} className="flex gap-3">
                        {/* Dot + line */}
                        <div className="flex flex-col items-center">
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 border-2 ${
                            isCompleted ? "bg-green-500 border-green-500" :
                            isActive ? "bg-[#0078D4] border-[#0078D4]" :
                            isBlocked ? "bg-red-500 border-red-500" :
                            "bg-white border-gray-300"
                          }`}>
                            {isCompleted ? (
                              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                            ) : isActive ? (
                              <div className="w-2 h-2 bg-white rounded-full" />
                            ) : isBlocked ? (
                              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                            ) : (
                              <span className="text-[8px] font-bold text-gray-400">{idx + 1}</span>
                            )}
                          </div>
                          {!isLast && <div className={`w-0.5 flex-1 my-1 ${isCompleted ? "bg-[#0078D4]" : "bg-gray-200"}`} style={{ minHeight: "24px" }} />}
                        </div>
                        {/* Content */}
                        <div className="pb-4 min-w-0 flex-1">
                          <p className={`text-xs font-semibold leading-snug ${isActive ? "text-[#0078D4]" : isCompleted ? "text-green-600" : isBlocked ? "text-red-600" : "text-gray-400"}`}>
                            {step.title}
                          </p>
                          {isActive && <p className="text-[10px] font-semibold text-[#0078D4] mt-0.5">Active</p>}
                          {step.completedAt && <p className="text-[10px] text-muted-foreground mt-0.5">{fmtDate(step.completedAt, { month: "short", day: "numeric" })}</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Desktop: horizontal layout */}
                <div className="hidden sm:block overflow-x-auto -mx-1 px-1 pb-1">
                  <div className="flex items-start gap-0 min-w-max">
                    {steps.map((step, idx) => {
                      const isCompleted = step.status === "completed";
                      const isActive = step.status === "in_progress";
                      const isBlocked = step.status === "blocked";
                      const isLast = idx === steps.length - 1;
                      return (
                        <div key={step.id} className="flex items-start">
                          <div className="flex flex-col items-center w-24 lg:w-28">
                            <div className="flex items-center w-full">
                              <div className={`flex-1 h-0.5 ${idx === 0 ? "invisible" : isCompleted || isActive ? "bg-[#0078D4]" : "bg-gray-200"}`} />
                              <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 border-2 transition-colors ${
                                isCompleted ? "bg-green-500 border-green-500" :
                                isActive ? "bg-[#0078D4] border-[#0078D4]" :
                                isBlocked ? "bg-red-500 border-red-500" :
                                "bg-white border-gray-300"
                              }`}>
                                {isCompleted ? (
                                  <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                                ) : isActive ? (
                                  <div className="w-2.5 h-2.5 bg-white rounded-full" />
                                ) : isBlocked ? (
                                  <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                                ) : (
                                  <span className="text-[9px] font-bold text-gray-400">{idx + 1}</span>
                                )}
                              </div>
                              <div className={`flex-1 h-0.5 ${isLast ? "invisible" : isCompleted ? "bg-[#0078D4]" : "bg-gray-200"}`} />
                            </div>
                            <div className="mt-2 px-1 text-center">
                              <p className={`text-[10px] font-semibold leading-tight line-clamp-2 ${
                                isActive ? "text-[#0078D4]" : isCompleted ? "text-green-600" : isBlocked ? "text-red-600" : "text-gray-400"
                              }`}>{step.title}</p>
                              {step.completedAt && <p className="text-[9px] text-muted-foreground mt-0.5">{fmtDate(step.completedAt, { month: "short", day: "numeric" })}</p>}
                              {isActive && !step.completedAt && <p className="text-[9px] font-semibold text-[#0078D4] mt-0.5">Active</p>}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* ── 3. Task Summary + Kanban ──────────────────────────────────── */}
            {tasks && tasks.length > 0 && (
              <div className="bg-white border border-border rounded-2xl p-5" ref={taskBoardRef}>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-bold text-[#0A2540]">Tasks</h3>
                  <Link href={`/portal/projects/${project.id}`} className="text-xs font-semibold text-[#0078D4] hover:underline">
                    Manage in full view →
                  </Link>
                </div>

                {/* Stat strip — "Waiting on You" scrolls to board */}
                <div className="grid grid-cols-4 gap-2 mb-5">
                  {([
                    { label: "Backlog", count: taskCounts.backlog, color: "text-gray-500", bg: "bg-gray-50 border-gray-200", scroll: false },
                    { label: "In Progress", count: taskCounts.in_progress, color: "text-[#0078D4]", bg: "bg-blue-50 border-blue-200", scroll: false },
                    { label: "Waiting on You", count: taskCounts.waiting, color: "text-yellow-600", bg: "bg-yellow-50 border-yellow-200", scroll: true },
                    { label: "Completed", count: taskCounts.completed, color: "text-green-600", bg: "bg-green-50 border-green-200", scroll: false },
                  ] as const).map(s => (
                    s.scroll ? (
                      <button
                        key={s.label}
                        onClick={() => taskBoardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                        className={`rounded-xl border p-3 text-center transition-colors hover:opacity-80 ${s.bg}`}
                      >
                        <p className={`text-xl font-bold ${s.color}`}>{s.count}</p>
                        <p className="text-[10px] text-muted-foreground font-medium leading-tight mt-0.5">{s.label}</p>
                      </button>
                    ) : (
                      <div key={s.label} className={`rounded-xl border p-3 text-center ${s.bg}`}>
                        <p className={`text-xl font-bold ${s.color}`}>{s.count}</p>
                        <p className="text-[10px] text-muted-foreground font-medium leading-tight mt-0.5">{s.label}</p>
                      </div>
                    )
                  ))}
                </div>

                {/* Compact kanban — all 4 columns */}
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                  {(["backlog", "in_progress", "waiting_on_customer", "completed"] as const).map(col => {
                    const colTasks = tasks.filter(t => t.column === col).slice(0, 5);
                    const colCfg = {
                      backlog: { label: "Backlog", hdr: "border-gray-300 bg-gray-50", chip: "bg-gray-200 text-gray-600" },
                      in_progress: { label: "In Progress", hdr: "border-[#0078D4] bg-blue-50", chip: "bg-[#0078D4]/10 text-[#0078D4]" },
                      waiting_on_customer: { label: "Waiting on You", hdr: "border-yellow-300 bg-yellow-50", chip: "bg-yellow-100 text-yellow-700" },
                      completed: { label: "Completed", hdr: "border-green-300 bg-green-50", chip: "bg-green-100 text-green-700" },
                    }[col];
                    const totalCol = tasks.filter(t => t.column === col).length;
                    return (
                      <div key={col} className={`rounded-xl border-t-2 ${colCfg.hdr} border border-border overflow-hidden`}>
                        <div className="px-3 py-2 flex items-center justify-between">
                          <span className="text-xs font-bold text-[#0A2540]">{colCfg.label}</span>
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${colCfg.chip}`}>{totalCol}</span>
                        </div>
                        <div className="px-3 pb-3 space-y-2">
                          {colTasks.length === 0 ? (
                            <p className="text-xs text-muted-foreground py-2 text-center">No tasks</p>
                          ) : colTasks.map(task => {
                            const priorityColor: Record<string, string> = {
                              high: "bg-red-100 text-red-700",
                              medium: "bg-amber-100 text-amber-700",
                              low: "bg-gray-100 text-gray-500",
                            };
                            const priCls = task.priority ? (priorityColor[task.priority] ?? "bg-gray-100 text-gray-500") : null;
                            return (
                              <button
                                key={task.id}
                                onClick={() => setSelectedTask(task)}
                                className="w-full text-left bg-white rounded-lg border border-border p-2.5 hover:border-[#0078D4]/30 hover:shadow-sm transition-all"
                              >
                                <p className="text-xs font-medium text-[#0A2540] line-clamp-2 leading-snug">{task.title}</p>
                                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                                  {priCls && task.priority && (
                                    <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${priCls}`}>
                                      {task.priority}
                                    </span>
                                  )}
                                  {task.assignedTo && (
                                    <span className="text-[9px] text-muted-foreground bg-gray-100 px-1.5 py-0.5 rounded truncate max-w-[80px]">
                                      {task.assignedTo}
                                    </span>
                                  )}
                                  {task.dueDate && (
                                    <span className="text-[9px] text-muted-foreground">
                                      Due {fmtDate(task.dueDate, { month: "short", day: "numeric" })}
                                    </span>
                                  )}
                                </div>
                              </button>
                            );
                          })}
                          {totalCol > 5 && (
                            <p className="text-[10px] text-muted-foreground text-center pt-1">+{totalCol - 5} more</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── 4. Status Reports ─────────────────────────────────────────── */}
            {statusReports && statusReports.length > 0 && (
              <div className="bg-white border border-border rounded-2xl p-5">
                <h3 className="text-sm font-bold text-[#0A2540] mb-4">Status Reports</h3>
                <div className="space-y-3">
                  {statusReports.map(report => (
                    <div key={report.id} className="border border-border rounded-xl overflow-hidden">
                      {/* Report header row */}
                      <button
                        className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left"
                        onClick={() => setExpandedReportId(expandedReportId === report.id ? null : report.id)}
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className="w-8 h-8 bg-[#0078D4]/10 rounded-lg flex items-center justify-center flex-shrink-0">
                            <svg className="w-4 h-4 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
                            </svg>
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-[#0A2540] truncate">{report.title}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-xs text-muted-foreground">{periodLabel(report.period)}</span>
                              {report.sentAt && <span className="text-xs text-muted-foreground">· {fmtDate(report.sentAt, { month: "short", day: "numeric", year: "numeric" })}</span>}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <ClientStatusChip status={report.clientStatus} />
                          <svg className={`w-4 h-4 text-muted-foreground transition-transform ${expandedReportId === report.id ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                        </div>
                      </button>

                      {/* Expanded content */}
                      {expandedReportId === report.id && (
                        <div className="border-t border-border px-4 py-4 bg-gray-50/50 space-y-4">
                          {report.executiveSummary && (
                            <div>
                              <p className="text-xs font-bold text-[#0A2540] uppercase tracking-wider mb-1.5">Executive Summary</p>
                              <p className="text-sm text-[#0A2540]/80 leading-relaxed">{report.executiveSummary}</p>
                            </div>
                          )}
                          {report.completedActivities.length > 0 && (
                            <div>
                              <p className="text-xs font-bold text-[#0A2540] uppercase tracking-wider mb-1.5">Completed Activities</p>
                              <ul className="space-y-1.5">
                                {report.completedActivities.map((a, i) => (
                                  <li key={i} className="flex items-start gap-2">
                                    <svg className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                                    <div>
                                      <span className="text-sm font-medium text-[#0A2540]">{a.title}</span>
                                      {a.description && <p className="text-xs text-muted-foreground mt-0.5">{a.description}</p>}
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {report.nextSteps.length > 0 && (
                            <div>
                              <p className="text-xs font-bold text-[#0A2540] uppercase tracking-wider mb-1.5">Next Steps</p>
                              <ul className="space-y-1.5">
                                {report.nextSteps.map((s, i) => (
                                  <li key={i} className="flex items-start gap-2">
                                    <span className="text-xs font-bold text-[#0078D4] bg-[#0078D4]/10 px-1.5 py-0.5 rounded mt-0.5 flex-shrink-0">{s.label}</span>
                                    <div>
                                      <span className="text-sm font-medium text-[#0A2540]">{s.title}</span>
                                      {s.description && <p className="text-xs text-muted-foreground mt-0.5">{s.description}</p>}
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {/* Admin reply */}
                          {report.adminReply && (
                            <div className="bg-[#0078D4]/5 border border-[#0078D4]/20 rounded-lg p-3">
                              <p className="text-xs font-bold text-[#0078D4] mb-1">Shane's Reply</p>
                              <p className="text-sm text-[#0A2540]">{report.adminReply}</p>
                            </div>
                          )}
                          {/* Client question */}
                          {report.clientQuestion && (
                            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                              <p className="text-xs font-bold text-amber-700 mb-1">Your Question</p>
                              <p className="text-sm text-[#0A2540]">{report.clientQuestion}</p>
                            </div>
                          )}
                          {/* Action buttons for pending */}
                          {report.clientStatus === "pending" && (
                            <div className="flex items-center gap-2 pt-1">
                              <button
                                onClick={() => acknowledgeReport(report, "accepted")}
                                disabled={acknowledging}
                                className="flex items-center gap-1.5 text-xs font-semibold text-white bg-green-600 px-3 py-1.5 rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
                              >
                                {acknowledging && <div className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
                                Accept Report
                              </button>
                              <button
                                onClick={() => setQuestionDialogFor(report)}
                                className="text-xs font-semibold text-[#0078D4] border border-[#0078D4]/30 px-3 py-1.5 rounded-lg hover:bg-[#0078D4]/5 transition-colors"
                              >
                                Ask Question
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── 5. Invoices ───────────────────────────────────────────────── */}
            <div className="bg-white border border-border rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-[#0A2540]">Invoices</h3>
                <Link href="/portal/billing" className="text-xs font-semibold text-[#0078D4] hover:underline">
                  View all billing →
                </Link>
              </div>
              {projectInvoices.length === 0 ? (
                <div className="text-center py-6">
                  <p className="text-sm text-muted-foreground">No invoices for this project yet.</p>
                </div>
              ) : (() => {
                const totalBilled = projectInvoices.reduce((s, i) => s + parseFloat(i.amount), 0);
                const totalPaid = projectInvoices.filter(i => i.status === "paid").reduce((s, i) => s + parseFloat(i.amount), 0);
                const totalOutstanding = totalBilled - totalPaid;
                const currency = projectInvoices[0].currency;
                return (
                  <>
                    <div className="divide-y divide-border mb-4">
                      {projectInvoices.map(inv => {
                        const isOverdue = inv.status === "overdue";
                        return (
                          <div key={inv.id} className={`flex items-center gap-3 py-3 first:pt-0 ${isOverdue ? "bg-red-50 -mx-5 px-5 first:rounded-t-xl" : ""}`}>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className={`text-sm font-semibold ${isOverdue ? "text-red-700" : "text-[#0A2540]"}`}>{inv.invoiceNumber}</span>
                                <InvoiceStatusBadge status={inv.status} />
                              </div>
                              {inv.description && <p className="text-xs text-muted-foreground mt-0.5 truncate">{inv.description}</p>}
                              <div className="flex items-center gap-3 mt-0.5">
                                <span className={`text-xs font-bold ${isOverdue ? "text-red-700" : "text-[#0A2540]"}`}>{fmtCurrency(inv.amount, inv.currency)}</span>
                                {inv.dueDate && inv.status !== "paid" && (
                                  <span className={`text-xs ${isOverdue ? "text-red-600 font-semibold" : "text-muted-foreground"}`}>
                                    {isOverdue ? "Overdue since" : "Due"} {fmtDate(inv.dueDate, { month: "short", day: "numeric" })}
                                  </span>
                                )}
                                {inv.paidAt && (
                                  <span className="text-xs text-green-600">Paid {fmtDate(inv.paidAt, { month: "short", day: "numeric" })}</span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              {inv.pdfFilename && (
                                <a
                                  href={`/api/portal/invoices/${inv.id}/download`}
                                  className="text-xs font-semibold text-muted-foreground hover:text-[#0078D4] transition-colors"
                                  title="Download PDF"
                                >
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                                </a>
                              )}
                              {(inv.status === "due" || inv.status === "overdue") && (
                                <Link
                                  href={`/portal/billing/invoices/${inv.id}`}
                                  className={`text-xs font-semibold text-white px-3 py-1.5 rounded-lg transition-colors ${isOverdue ? "bg-red-600 hover:bg-red-700" : "bg-[#0078D4] hover:bg-[#0078D4]/90"}`}
                                >
                                  Pay Now
                                </Link>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {/* Totals footer */}
                    <div className="border-t border-border pt-3 grid grid-cols-3 gap-2">
                      {[
                        { label: "Total Billed", value: fmtCurrency(String(totalBilled), currency), cls: "text-[#0A2540]" },
                        { label: "Paid", value: fmtCurrency(String(totalPaid), currency), cls: "text-green-600" },
                        { label: "Outstanding", value: fmtCurrency(String(totalOutstanding), currency), cls: totalOutstanding > 0 ? "text-red-600" : "text-green-600" },
                      ].map(t => (
                        <div key={t.label} className="text-center">
                          <p className={`text-sm font-bold ${t.cls}`}>{t.value}</p>
                          <p className="text-[10px] text-muted-foreground font-medium mt-0.5">{t.label}</p>
                        </div>
                      ))}
                    </div>
                  </>
                );
              })()}
            </div>

            {/* ── 6. Documents ──────────────────────────────────────────────── */}
            <div className="bg-white border border-border rounded-2xl p-5">
              <h3 className="text-sm font-bold text-[#0A2540] mb-4">Documents</h3>

              {/* Upload form */}
              <form onSubmit={handleUpload} className="border border-dashed border-[#0078D4]/30 rounded-xl p-4 mb-4 bg-[#0078D4]/2">
                <p className="text-xs font-semibold text-[#0A2540] mb-3">Upload a Document</p>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="flex-1 min-w-[180px]">
                    <input
                      type="file"
                      required
                      onChange={e => { setUploadFile(e.target.files?.[0] ?? null); setUploadError(""); }}
                      className="w-full border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none file:mr-3 file:text-xs file:font-semibold file:bg-[#0078D4] file:text-white file:border-0 file:rounded file:px-2 file:py-1 file:cursor-pointer"
                    />
                  </div>
                  <div className="flex-1 min-w-[160px]">
                    <input
                      value={uploadName}
                      onChange={e => setUploadName(e.target.value)}
                      placeholder="Display name (optional)"
                      className="w-full border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    {uploadError && <p className="text-xs text-red-600">{uploadError}</p>}
                    <button
                      type="submit"
                      disabled={!uploadFile || uploading}
                      className="flex items-center gap-2 bg-[#0078D4] text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[#0078D4]/90 disabled:opacity-50 transition-colors whitespace-nowrap"
                    >
                      {uploading
                        ? <><div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Uploading…</>
                        : <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg> Upload</>
                      }
                    </button>
                  </div>
                </div>
              </form>

              {/* Document grid */}
              {documents && documents.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No documents yet.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {(documents ?? []).map(doc => (
                    <a
                      key={doc.id}
                      href={`/api/portal/documents/${doc.id}/download`}
                      className="flex items-center gap-3 border border-border rounded-xl p-3 hover:border-[#0078D4]/30 hover:bg-gray-50 transition-all group"
                    >
                      <div className="w-9 h-9 bg-[#0078D4]/10 rounded-lg flex items-center justify-center flex-shrink-0">
                        <svg className="w-4.5 h-4.5 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                        </svg>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-[#0A2540] truncate group-hover:text-[#0078D4] transition-colors">{doc.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {doc.sizeBytes ? fmtBytes(doc.sizeBytes) + " · " : ""}
                          {fmtDate(doc.createdAt, { month: "short", day: "numeric", year: "numeric" })}
                        </p>
                      </div>
                      <svg className="w-4 h-4 text-muted-foreground group-hover:text-[#0078D4] flex-shrink-0 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                    </a>
                  ))}
                </div>
              )}
            </div>

            {/* ── 7. Messages ───────────────────────────────────────────────── */}
            <div className="bg-white border border-border rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-[#0A2540]">Messages</h3>
                <Link href="/portal/messages" className="text-xs font-semibold text-[#0078D4] hover:underline">
                  Full conversation →
                </Link>
              </div>

              {/* Last 5 messages */}
              {messages.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">No messages yet. Send a message below to start the conversation.</p>
              ) : (
                <div className="space-y-3 mb-4 max-h-64 overflow-y-auto pr-1">
                  {messages.slice(-5).map(msg => {
                    const fromClient = msg.senderUserId === user?.id;
                    return (
                      <div key={msg.id} className={`flex gap-2 ${fromClient ? "flex-row-reverse" : ""}`}>
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold ${
                          fromClient ? "bg-[#0078D4] text-white" : "bg-[#0A2540] text-white"
                        }`}>
                          {fromClient ? "You" : "S"}
                        </div>
                        <div className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 ${
                          fromClient ? "bg-[#0078D4] text-white rounded-tr-sm" : "bg-gray-100 text-[#0A2540] rounded-tl-sm"
                        }`}>
                          <p className="text-sm leading-relaxed">{msg.body}</p>
                          <p className={`text-[10px] mt-1 ${fromClient ? "text-white/60" : "text-muted-foreground"}`}>
                            {fmtDate(msg.createdAt, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                  {messages.length > 5 && (
                    <Link href="/portal/messages" className="block text-center text-xs text-[#0078D4] hover:underline py-1">
                      View {messages.length - 5} older messages
                    </Link>
                  )}
                </div>
              )}

              {/* Compose */}
              <form onSubmit={sendMessage} className="flex items-end gap-2">
                <textarea
                  value={msgBody}
                  onChange={e => setMsgBody(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(e as unknown as React.FormEvent); } }}
                  placeholder="Send a message to Shane…"
                  rows={2}
                  className="flex-1 border border-border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] resize-none"
                />
                <button
                  type="submit"
                  disabled={!msgBody.trim() || sendingMsg}
                  className="flex items-center gap-1.5 bg-[#0078D4] text-white text-sm font-semibold px-4 py-2.5 rounded-xl hover:bg-[#0078D4]/90 disabled:opacity-50 transition-colors whitespace-nowrap h-[52px]"
                >
                  {sendingMsg
                    ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" /></svg>
                  }
                  Send
                </button>
              </form>
            </div>

            {/* ── 8. Activity Feed ──────────────────────────────────────────── */}
            {activityFeed.length > 0 && (
              <div className="bg-white border border-border rounded-2xl p-5">
                <h3 className="text-sm font-bold text-[#0A2540] mb-4">Activity Feed</h3>
                <div className="relative">
                  <div className="absolute left-3.5 top-0 bottom-0 w-px bg-border" />
                  <div className="space-y-4">
                    {activityFeed.map(item => {
                      const typeIcon: Record<string, { bg: string; icon: string; svg: React.ReactNode }> = {
                        milestone: { bg: "bg-green-100", icon: "text-green-600", svg: <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg> },
                        report: { bg: "bg-[#0078D4]/10", icon: "text-[#0078D4]", svg: <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" /></svg> },
                        invoice: { bg: "bg-emerald-100", icon: "text-emerald-600", svg: <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" /></svg> },
                        document: { bg: "bg-amber-100", icon: "text-amber-600", svg: <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg> },
                        message: { bg: "bg-purple-100", icon: "text-purple-600", svg: <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8.625 9.75a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375m-13.5 3.01c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.184-4.183a1.14 1.14 0 01.778-.332 48.294 48.294 0 005.83-.498c1.585-.233 2.708-1.626 2.708-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" /></svg> },
                      };
                      const ic = typeIcon[item.type] ?? { bg: "bg-gray-100", icon: "text-gray-500", svg: <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" /></svg> };
                      return (
                        <div key={item.id} className="flex items-start gap-3 pl-1 relative">
                          <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 z-10 ${ic.bg} ${ic.icon}`}>
                            {ic.svg}
                          </div>
                          <div className="flex-1 min-w-0 pt-0.5">
                            <p className="text-sm text-[#0A2540] leading-relaxed">{item.content}</p>
                            <p className="text-xs text-muted-foreground mt-1">
                              {fmtDate(item.createdAt, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

          </div>
        ) : null}
      </div>
    </PortalLayout>
  );
}
