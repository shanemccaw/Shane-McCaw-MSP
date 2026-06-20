import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";

interface Activity { title: string; description: string; }
interface NextStep { label: string; title: string; description: string; }

interface StatusReport {
  id: number;
  projectId: number | null;
  clientUserId: number | null;
  title: string;
  period: string;
  reportStatus: string;
  executiveSummary: string | null;
  completedActivities: Activity[];
  keyOutcomes: string | null;
  nextSteps: NextStep[];
  reportDate: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Project {
  id: number;
  title: string;
  status: string;
  progress: number;
  clientUserId: number | null;
  description: string | null;
  endDate: string | null;
}

interface Client {
  id: number;
  name: string | null;
  email: string;
  company: string | null;
}

interface AutofillData {
  project: { id: number; title: string; status: string; progress: number; description: string | null; endDate: string | null };
  client: Client | null;
  completedTasks: Activity[];
  completedSteps: Activity[];
  pendingSteps: NextStep[];
  blockedCount: number;
  totalSteps: number;
  completedStepsCount: number;
}

const PERIOD_LABELS: Record<string, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  executive_summary: "Executive Summary",
  other: "Other",
};

const STATUS_COLORS: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700 border-emerald-200",
  on_hold: "bg-amber-100 text-amber-700 border-amber-200",
  completed: "bg-blue-100 text-blue-700 border-blue-200",
};

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  on_hold: "On Hold",
  completed: "Completed",
};

function CheckIcon() {
  return (
    <svg className="w-5 h-5 text-teal-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

export default function StatusReportsPage() {
  const { fetchWithAuth } = useAuth();
  const [reports, setReports] = useState<StatusReport[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<StatusReport | null>(null);
  const [isNew, setIsNew] = useState(false);

  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [autofill, setAutofill] = useState<AutofillData | null>(null);
  const [autofillLoading, setAutofillLoading] = useState(false);

  const [form, setForm] = useState({
    title: "",
    period: "monthly",
    executiveSummary: "",
    keyOutcomes: "",
    reportDate: "",
  });
  const [activities, setActivities] = useState<Activity[]>([]);
  const [nextSteps, setNextSteps] = useState<NextStep[]>([]);

  const [draftInput, setDraftInput] = useState("");
  const [draftPreview, setDraftPreview] = useState("");

  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  const load = useCallback(async () => {
    const [rRes, pRes, cRes] = await Promise.all([
      fetchWithAuth("/api/admin/status-reports"),
      fetchWithAuth("/api/admin/projects"),
      fetchWithAuth("/api/admin/clients"),
    ]);
    if (rRes.ok) setReports(await rRes.json() as StatusReport[]);
    if (pRes.ok) setProjects(await pRes.json() as Project[]);
    if (cRes.ok) setClients(await cRes.json() as Client[]);
    setLoading(false);
  }, [fetchWithAuth]);

  useEffect(() => { void load(); }, [load]);

  const clientName = (id: number | null) => {
    if (!id) return "—";
    const c = clients.find(c => c.id === id);
    return c ? (c.name ?? c.email) : String(id);
  };

  const projectTitle = (id: number | null) => {
    if (!id) return "—";
    const p = projects.find(p => p.id === id);
    return p?.title ?? String(id);
  };

  const fetchAutofill = async (projectId: string) => {
    if (!projectId) { setAutofill(null); return; }
    setAutofillLoading(true);
    try {
      const res = await fetchWithAuth(`/api/admin/projects/${projectId}/report-autofill`);
      if (res.ok) {
        const data = await res.json() as AutofillData;
        setAutofill(data);
        const combined = [...data.completedSteps, ...data.completedTasks];
        setActivities(combined);
        setNextSteps(data.pendingSteps.slice(0, 5));
        if (!form.title) {
          const now = new Date();
          setForm(f => ({
            ...f,
            title: `${data.project.title} — ${now.toLocaleString("default", { month: "long" })} ${now.getFullYear()} Status Report`,
          }));
        }
      }
    } finally {
      setAutofillLoading(false);
    }
  };

  const openNew = () => {
    setEditing(null);
    setIsNew(true);
    setSelectedProjectId("");
    setAutofill(null);
    setForm({ title: "", period: "monthly", executiveSummary: "", keyOutcomes: "", reportDate: "" });
    setActivities([]);
    setNextSteps([]);
    setDraftInput("");
    setDraftPreview("");
    setSaveMsg("");
  };

  const openEdit = (r: StatusReport) => {
    setEditing(r);
    setIsNew(false);
    setSelectedProjectId(r.projectId ? String(r.projectId) : "");
    setAutofill(null);
    setForm({
      title: r.title,
      period: r.period,
      executiveSummary: r.executiveSummary ?? "",
      keyOutcomes: r.keyOutcomes ?? "",
      reportDate: r.reportDate ? r.reportDate.slice(0, 10) : "",
    });
    setActivities(r.completedActivities ?? []);
    setNextSteps(r.nextSteps ?? []);
    setDraftInput("");
    setDraftPreview("");
    setSaveMsg("");
  };

  const handleProjectChange = async (pid: string) => {
    setSelectedProjectId(pid);
    await fetchAutofill(pid);
  };

  const handleSave = async (statusOverride?: "draft" | "sent") => {
    setSaving(true);
    setSaveMsg("");
    try {
      const body = {
        projectId: selectedProjectId ? parseInt(selectedProjectId, 10) : undefined,
        clientUserId: autofill?.client?.id ?? (editing?.clientUserId ?? undefined),
        title: form.title || "Untitled Report",
        period: form.period,
        executiveSummary: form.executiveSummary || null,
        completedActivities: activities,
        keyOutcomes: form.keyOutcomes || null,
        nextSteps,
        reportDate: form.reportDate || null,
      };

      let res: Response;
      if (isNew) {
        res = await fetchWithAuth("/api/admin/status-reports", { method: "POST", body: JSON.stringify(body) });
      } else {
        res = await fetchWithAuth(`/api/admin/status-reports/${editing!.id}`, { method: "PATCH", body: JSON.stringify(body) });
      }

      if (res.ok) {
        const saved = await res.json() as StatusReport;
        if (statusOverride === "sent") {
          await fetchWithAuth(`/api/admin/status-reports/${saved.id}/send`, { method: "POST", body: "{}" });
        }
        setSaveMsg(statusOverride === "sent" ? "Report sent to client!" : "Draft saved.");
        setIsNew(false);
        setEditing(saved);
        await load();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSend = async () => {
    setSending(true);
    try {
      if (isNew || !editing) {
        await handleSave("sent");
      } else {
        await handleSave();
        await fetchWithAuth(`/api/admin/status-reports/${editing.id}/send`, { method: "POST", body: "{}" });
        setSaveMsg("Report sent to client!");
        await load();
      }
    } finally {
      setSending(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this status report?")) return;
    await fetchWithAuth(`/api/admin/status-reports/${id}`, { method: "DELETE" });
    await load();
  };

  const draftSummary = () => {
    const proj = autofill?.project ?? projects.find(p => p.id === parseInt(selectedProjectId, 10));
    const acts = activities.map(a => `• ${a.title}`).join("\n");
    const input = draftInput.trim();
    const summary = `${proj?.title ?? "This project"} has made strong progress this period${input ? `, with ${input}` : ""}. `
      + (activities.length > 0 ? `Key completed activities include:\n${acts}\n\n` : "")
      + (proj ? `The project is currently ${Math.round(proj.progress)}% complete` : "")
      + (autofill?.blockedCount ? `, with ${autofill.blockedCount} item(s) flagged for attention.` : ".");
    setDraftPreview(summary);
  };

  const applyDraft = () => {
    setForm(f => ({ ...f, executiveSummary: draftPreview }));
    setDraftPreview("");
  };

  const removeActivity = (i: number) => setActivities(a => a.filter((_, idx) => idx !== i));
  const addActivity = () => setActivities(a => [...a, { title: "", description: "" }]);
  const updateActivity = (i: number, field: "title" | "description", val: string) =>
    setActivities(a => a.map((item, idx) => idx === i ? { ...item, [field]: val } : item));

  const removeNextStep = (i: number) => setNextSteps(s => s.filter((_, idx) => idx !== i));
  const addNextStep = () => setNextSteps(s => [...s, { label: "Upcoming", title: "", description: "" }]);
  const updateNextStep = (i: number, field: keyof NextStep, val: string) =>
    setNextSteps(s => s.map((item, idx) => idx === i ? { ...item, [field]: val } : item));

  const selectedProject = autofill?.project ?? projects.find(p => p.id === parseInt(selectedProjectId, 10));
  const progress = selectedProject?.progress ?? 0;

  if (!isNew && !editing) {
    return (
      <div className="p-6 max-w-[1200px]">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-[#0A2540]">Status Reports</h1>
            <p className="text-sm text-gray-500 mt-0.5">Create and send structured project status reports to clients.</p>
          </div>
          <button
            onClick={openNew}
            className="flex items-center gap-2 bg-[#0078D4] text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[#0078D4]/90 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New Status Report
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : reports.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
            <div className="w-12 h-12 bg-[#0078D4]/10 rounded-xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-[#0A2540] mb-1">No status reports yet</p>
            <p className="text-xs text-gray-500">Create your first status report to send to a client.</p>
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
            {reports.map(r => (
              <div key={r.id} className="flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition-colors">
                <div className="w-9 h-9 rounded-xl bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0">
                  <svg className="w-4 h-4 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[#0A2540] truncate">{r.title}</p>
                  <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                    <span className="text-xs text-gray-500">{projectTitle(r.projectId)}</span>
                    <span className="text-xs text-gray-400">·</span>
                    <span className="text-xs text-gray-500">{clientName(r.clientUserId)}</span>
                    <span className="text-xs text-gray-400">·</span>
                    <span className="text-xs text-gray-500">{PERIOD_LABELS[r.period] ?? r.period}</span>
                    <span className="text-xs text-gray-400">·</span>
                    <span className="text-xs text-gray-500">{new Date(r.updatedAt).toLocaleDateString()}</span>
                  </div>
                </div>
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${r.reportStatus === "sent" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-amber-50 text-amber-700 border-amber-200"}`}>
                  {r.reportStatus === "sent" ? "Sent" : "Draft"}
                </span>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => openEdit(r)} className="text-xs text-[#0078D4] hover:text-[#0078D4]/80 font-semibold transition-colors px-2 py-1 rounded hover:bg-[#0078D4]/10">
                    Edit
                  </button>
                  <button onClick={() => void handleDelete(r.id)} className="text-xs text-red-500 hover:text-red-700 font-semibold transition-colors px-2 py-1 rounded hover:bg-red-50">
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-full bg-[#f7f9fb]">
      <div className="max-w-[1280px] mx-auto px-6 py-6">

        {/* Breadcrumb + back */}
        <div className="flex items-center gap-2 mb-6">
          <button
            onClick={() => { setEditing(null); setIsNew(false); }}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-[#0A2540] transition-colors font-medium"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Status Reports
          </button>
          <span className="text-gray-400">/</span>
          <span className="text-sm text-[#0A2540] font-medium">{isNew ? "New Report" : form.title}</span>
        </div>

        {/* Project selector (prominent, only shown when creating or no project set) */}
        <div className="bg-white border border-gray-200 rounded-xl px-5 py-4 mb-6 flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[220px]">
            <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1.5">Project</label>
            <select
              value={selectedProjectId}
              onChange={e => void handleProjectChange(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-white font-medium text-[#0A2540]"
            >
              <option value="">— Select a project to auto-populate —</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.title}</option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1.5">Report Period</label>
            <select
              value={form.period}
              onChange={e => setForm(f => ({ ...f, period: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-white"
            >
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="executive_summary">Executive Summary</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1.5">Report Date</label>
            <input
              type="date"
              value={form.reportDate}
              onChange={e => setForm(f => ({ ...f, reportDate: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
            />
          </div>
          {autofillLoading && (
            <div className="flex items-center gap-2 text-xs text-gray-400 pb-2">
              <div className="w-4 h-4 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
              Loading project data…
            </div>
          )}
        </div>

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-5 mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[11px] font-bold uppercase tracking-widest text-gray-400">Client Deliverable</span>
              <span className="w-1.5 h-1.5 rounded-full bg-teal-500" />
              <span className="text-[11px] font-bold text-teal-600 uppercase tracking-widest">Shane McCaw Consulting</span>
            </div>
            <h1 className="text-2xl font-bold text-[#0A2540] tracking-tight mb-1">Project Status Report</h1>
            <div className="flex items-center gap-3 flex-wrap">
              <input
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="Report title (e.g. May 2026 Status Update)"
                className="text-lg text-gray-500 bg-transparent border-0 border-b border-dashed border-gray-300 focus:outline-none focus:border-[#0078D4] min-w-[320px] pb-0.5"
              />
              {selectedProject && (
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${STATUS_COLORS[selectedProject.status] ?? "bg-gray-100 text-gray-600 border-gray-200"}`}>
                  {STATUS_LABELS[selectedProject.status] ?? selectedProject.status}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {saveMsg && (
              <span className="text-xs text-emerald-600 font-semibold bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-lg">
                {saveMsg}
              </span>
            )}
            <button
              onClick={() => void handleSave()}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 transition-all"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
              </svg>
              {saving ? "Saving…" : "Save Draft"}
            </button>
            <button
              onClick={() => void handleSend()}
              disabled={sending || saving}
              className="flex items-center gap-2 px-5 py-2 bg-[#0078D4] text-white rounded-lg text-sm font-semibold hover:bg-[#0078D4]/90 disabled:opacity-50 active:scale-95 transition-all"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
              {sending ? "Sending…" : "Send to Client"}
            </button>
          </div>
        </div>

        {/* Progress + Health Bar */}
        {selectedProject && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6 p-5 bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="flex flex-col gap-2">
              <div className="flex justify-between items-center">
                <span className="text-[11px] font-bold uppercase tracking-widest text-gray-400">Overall Project Progress</span>
                <span className="text-sm font-bold text-[#0A2540]">{progress}%</span>
              </div>
              <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-[#0078D4] rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
              </div>
              {autofill && (
                <p className="text-xs text-gray-400 mt-0.5">{autofill.completedStepsCount} of {autofill.totalSteps} phases complete</p>
              )}
            </div>
            <div className="flex items-center md:justify-end gap-4 flex-wrap">
              {autofill && autofill.blockedCount > 0 && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-red-50 border border-red-200 rounded-lg">
                  <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <span className="text-xs font-bold text-red-600">Raised Issues: {autofill.blockedCount}</span>
                </div>
              )}
              <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg">
                <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                <span className="text-xs font-bold text-gray-600">{activities.length} Activities</span>
              </div>
            </div>
          </div>
        )}

        {/* Two-column main content */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">

          {/* LEFT COLUMN */}
          <div className="flex flex-col gap-6">

            {/* Executive Summary */}
            <section className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-9 h-9 rounded-lg bg-[#0A2540] flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <h3 className="text-base font-bold text-[#0A2540]">Executive Summary</h3>
              </div>
              <textarea
                value={form.executiveSummary}
                onChange={e => setForm(f => ({ ...f, executiveSummary: e.target.value }))}
                placeholder="Write a concise executive summary of progress, achievements, and current project health…"
                rows={6}
                className="w-full p-3 border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#0078D4] resize-none leading-relaxed"
              />
            </section>

            {/* Completed Activities */}
            <section className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-bold text-[#0A2540]">Completed Activities</h3>
                <button
                  onClick={addActivity}
                  className="text-xs font-semibold text-[#0078D4] hover:text-[#0078D4]/80 flex items-center gap-1 px-2 py-1 rounded hover:bg-[#0078D4]/10 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  Add
                </button>
              </div>
              {activities.length === 0 ? (
                <div className="text-center py-6 border-2 border-dashed border-gray-200 rounded-lg">
                  <p className="text-xs text-gray-400 font-medium">Select a project above to auto-populate from completed tasks, or add manually.</p>
                </div>
              ) : (
                <ul className="space-y-3">
                  {activities.map((a, i) => (
                    <li key={i} className="flex items-start gap-3 group">
                      <CheckIcon />
                      <div className="flex-1 min-w-0">
                        <input
                          value={a.title}
                          onChange={e => updateActivity(i, "title", e.target.value)}
                          placeholder="Activity title"
                          className="w-full text-sm font-semibold text-[#0A2540] bg-transparent border-0 border-b border-transparent focus:border-[#0078D4] focus:outline-none pb-0.5 mb-1"
                        />
                        <input
                          value={a.description}
                          onChange={e => updateActivity(i, "description", e.target.value)}
                          placeholder="Short description…"
                          className="w-full text-xs text-gray-500 bg-transparent border-0 focus:outline-none"
                        />
                      </div>
                      <button
                        onClick={() => removeActivity(i)}
                        className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-all mt-0.5"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Key Outcomes */}
            <section className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-9 h-9 rounded-lg bg-teal-50 border border-teal-100 flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  </svg>
                </div>
                <h3 className="text-base font-bold text-[#0A2540]">Key Outcomes</h3>
              </div>
              <textarea
                value={form.keyOutcomes}
                onChange={e => setForm(f => ({ ...f, keyOutcomes: e.target.value }))}
                placeholder="Describe the business or technical outcomes achieved this period — compliance improvements, risk reductions, efficiency gains…"
                rows={4}
                className="w-full p-3 border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#0078D4] resize-none leading-relaxed"
              />
            </section>
          </div>

          {/* RIGHT COLUMN */}
          <div className="flex flex-col gap-6">

            {/* Draft Assist Panel */}
            <section className="bg-white/80 backdrop-blur border border-gray-200 p-6 rounded-xl shadow-md flex flex-col gap-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                  </svg>
                  <h4 className="text-base font-bold text-[#0A2540]">Draft Assist</h4>
                </div>
                <span className="text-[9px] px-2 py-0.5 bg-[#0078D4] text-white rounded font-bold uppercase tracking-wider">Smart</span>
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1.5 block">Additional Context / Activity Log</label>
                <textarea
                  value={draftInput}
                  onChange={e => setDraftInput(e.target.value)}
                  placeholder="Describe what else happened this period, any extra context, blockers resolved… (optional)"
                  rows={4}
                  className="w-full p-3 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-[#0078D4] focus:outline-none resize-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={draftSummary}
                  className="p-3 border border-gray-200 rounded-lg text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-all flex flex-col items-center gap-1.5 group"
                >
                  <svg className="w-5 h-5 text-[#0078D4] group-hover:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
                  </svg>
                  Draft Summary
                </button>
                <button
                  onClick={() => {
                    const exec = activities.map(a => `✓ ${a.title}`).join(". ");
                    setDraftPreview(exec ? `Key activities this period: ${exec}.` : "No completed activities to summarize.");
                  }}
                  className="p-3 border border-gray-200 rounded-lg text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-all flex flex-col items-center gap-1.5 group"
                >
                  <svg className="w-5 h-5 text-[#0078D4] group-hover:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.562.562 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
                  </svg>
                  Exec Translate
                </button>
              </div>
              {draftPreview && (
                <div className="border-t border-gray-100 pt-4 flex flex-col gap-3">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Draft Preview</label>
                    <span className="flex items-center gap-1 text-[10px] text-teal-600 font-bold">
                      <span className="w-1.5 h-1.5 bg-teal-500 rounded-full animate-pulse" />
                      Ready
                    </span>
                  </div>
                  <div className="p-3 bg-gray-50 rounded-lg border border-dashed border-gray-200 text-sm italic text-gray-600 leading-relaxed">
                    {draftPreview}
                  </div>
                  <button
                    onClick={applyDraft}
                    className="w-full py-2.5 bg-gray-100 hover:bg-[#0078D4]/10 text-[#0A2540] text-xs font-bold uppercase tracking-wider rounded-lg flex items-center justify-center gap-2 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                    Apply to Executive Summary
                  </button>
                </div>
              )}
            </section>

            {/* Next Steps */}
            <section className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-bold text-[#0A2540]">Next Steps: Lookahead</h3>
                <button
                  onClick={addNextStep}
                  className="text-xs font-semibold text-[#0078D4] hover:text-[#0078D4]/80 flex items-center gap-1 px-2 py-1 rounded hover:bg-[#0078D4]/10 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  Add
                </button>
              </div>
              {nextSteps.length === 0 ? (
                <div className="text-center py-6 border-2 border-dashed border-gray-200 rounded-lg">
                  <p className="text-xs text-gray-400 font-medium">Pending workflow steps will appear here when a project is selected.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {nextSteps.map((s, i) => (
                    <div key={i} className="group p-3 border-l-4 border-[#0078D4] bg-gray-50 rounded-r-lg relative">
                      <input
                        value={s.label}
                        onChange={e => updateNextStep(i, "label", e.target.value)}
                        placeholder="Phase label"
                        className="text-[10px] font-bold uppercase tracking-widest text-gray-400 bg-transparent border-0 focus:outline-none w-full mb-0.5"
                      />
                      <input
                        value={s.title}
                        onChange={e => updateNextStep(i, "title", e.target.value)}
                        placeholder="Next step title"
                        className="text-sm font-bold text-[#0A2540] bg-transparent border-0 focus:outline-none w-full mb-1"
                      />
                      <input
                        value={s.description}
                        onChange={e => updateNextStep(i, "description", e.target.value)}
                        placeholder="Brief description…"
                        className="text-xs text-gray-500 bg-transparent border-0 focus:outline-none w-full"
                      />
                      <button
                        onClick={() => removeNextStep(i)}
                        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-all"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
