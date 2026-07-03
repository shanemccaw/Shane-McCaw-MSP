import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

interface Activity { title: string; description: string; completionStatus?: string | null; completionNotes?: string | null; }
interface NextStep { label: string; title: string; description: string; kanbanTaskId?: number | null; }

export interface ThreadMessage {
  sender: "client" | "admin";
  content: string;
  timestamp: string;
}

export interface StatusReport {
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
  clientStatus?: "pending" | "accepted" | "has_questions";
  clientQuestion?: string | null;
  adminReply?: string | null;
  replyThread?: ThreadMessage[];
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
  lastReportDate: string | null;
  lastReportPeriod: string | null;
  sinceDate: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  on_hold: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  completed: "bg-blue-500/15 text-blue-400 border-blue-500/20",
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

export interface StatusReportFormProps {
  lockedProjectId?: number;
  initialReport?: StatusReport;
  onSaved?: (report: StatusReport) => void;
  onCancel?: () => void;
  embedded?: boolean;
  autoFill?: boolean;
}

export default function StatusReportForm({
  lockedProjectId,
  initialReport,
  onSaved,
  onCancel,
  embedded = false,
  autoFill = false,
}: StatusReportFormProps) {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();

  const [projects, setProjects] = useState<Project[]>([]);

  const isNew = !initialReport;
  const [selectedProjectId, setSelectedProjectId] = useState<string>(
    lockedProjectId ? String(lockedProjectId) : (initialReport?.projectId ? String(initialReport.projectId) : "")
  );
  const [autofill, setAutofill] = useState<AutofillData | null>(null);
  const [autofillLoading, setAutofillLoading] = useState(false);
  const [activityFillLoading, setActivityFillLoading] = useState(false);
  const [activitySince, setActivitySince] = useState<string | null>(null);
  const [oneDraftLoading, setOneDraftLoading] = useState(false);

  const [form, setForm] = useState({
    title: initialReport?.title ?? "",
    period: initialReport?.period ?? "monthly",
    executiveSummary: initialReport?.executiveSummary ?? "",
    keyOutcomes: initialReport?.keyOutcomes ?? "",
    reportDate: initialReport?.reportDate ? initialReport.reportDate.slice(0, 10) : "",
  });
  const [activities, setActivities] = useState<Activity[]>(initialReport?.completedActivities ?? []);
  const [nextSteps, setNextSteps] = useState<NextStep[]>(initialReport?.nextSteps ?? []);

  const [draftInput, setDraftInput] = useState("");

  type AiSection = "executive_summary" | "key_outcomes" | "next_steps" | "all";
  interface AiPreview { executiveSummary?: string; keyOutcomes?: string; nextSteps?: NextStep[] }
  const [aiLoading, setAiLoading] = useState<AiSection | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiPreview, setAiPreview] = useState<AiPreview>({});

  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [savedReport, setSavedReport] = useState<StatusReport | null>(initialReport ?? null);
  const [pushLoading, setPushLoading] = useState<Record<number, boolean>>({});
  const [pushAllLoading, setPushAllLoading] = useState(false);
  const [threadDraft, setThreadDraft] = useState("");
  const [threadSending, setThreadSending] = useState(false);
  const [liveReport, setLiveReport] = useState<StatusReport | null>(initialReport ?? null);

  const loadProjects = useCallback(async () => {
    if (lockedProjectId) return;
    const res = await fetchWithAuth("/api/admin/projects");
    if (res.ok) setProjects(await res.json() as Project[]);
  }, [fetchWithAuth, lockedProjectId]);

  useEffect(() => { void loadProjects(); }, [loadProjects]);

  const currentReportId = savedReport?.id ?? initialReport?.id;

  const handlePushToKanban = async (index: number) => {
    if (!currentReportId || isNew) return;
    setPushLoading(p => ({ ...p, [index]: true }));
    try {
      const res = await fetchWithAuth(`/api/admin/status-reports/${currentReportId}/next-steps/${index}/push-to-kanban`, {
        method: "POST",
        body: "{}",
      });
      if (res.ok) {
        const data = await res.json() as { report: StatusReport; kanbanTaskId: number };
        setNextSteps(data.report.nextSteps ?? []);
        setSavedReport(data.report);
      } else {
        const err = await res.json() as { error?: string };
        toast({ title: "Failed to push to Kanban", description: err.error, variant: "destructive" });
      }
    } finally {
      setPushLoading(p => ({ ...p, [index]: false }));
    }
  };

  const handlePushAllToKanban = async () => {
    if (!currentReportId || isNew) return;
    setPushAllLoading(true);
    try {
      const res = await fetchWithAuth(`/api/admin/status-reports/${currentReportId}/push-all-to-kanban`, {
        method: "POST",
        body: "{}",
      });
      if (res.ok) {
        const data = await res.json() as { report: StatusReport; pushed: number };
        setNextSteps(data.report.nextSteps ?? []);
        setSavedReport(data.report);
        setSaveMsg(`${data.pushed} step${data.pushed !== 1 ? "s" : ""} added to Kanban.`);
      } else {
        const err = await res.json() as { error?: string };
        toast({ title: "Failed to push to Kanban", description: err.error, variant: "destructive" });
      }
    } finally {
      setPushAllLoading(false);
    }
  };

  const fetchAutofill = useCallback(async (projectId: string, since?: string | null, isActivityFill = false): Promise<AutofillData | null> => {
    if (!projectId) { setAutofill(null); return null; }
    const url = since
      ? `/api/admin/projects/${projectId}/report-autofill?since=${encodeURIComponent(since)}`
      : `/api/admin/projects/${projectId}/report-autofill`;
    if (isActivityFill) {
      setActivityFillLoading(true);
    } else {
      setAutofillLoading(true);
    }
    try {
      const res = await fetchWithAuth(url);
      if (res.ok) {
        const data = await res.json() as AutofillData;
        setAutofill(data);
        setActivitySince(data.sinceDate ?? null);
        const combined = [...data.completedSteps, ...data.completedTasks];
        setActivities(combined);
        setNextSteps(data.pendingSteps.slice(0, 5));
        if (!form.title) {
          const now = new Date();
          setForm(f => ({
            ...f,
            title: `${data.project.title} — ${now.toLocaleString("default", { month: "long" })} ${now.getFullYear()} Status Report`,
            ...(isNew && !savedReport && data.lastReportPeriod ? { period: data.lastReportPeriod } : {}),
          }));
        } else if (isNew && !savedReport && data.lastReportPeriod) {
          setForm(f => ({ ...f, period: data.lastReportPeriod! }));
        }
        const tasksWithNotes = data.completedTasks.filter(t => t.completionNotes);
        if (tasksWithNotes.length > 0) {
          const prompt = tasksWithNotes
            .map(t => {
              const header = `✓ ${t.title}${t.completionStatus ? ` — ${t.completionStatus}` : ""}`;
              return `${header}\n${t.completionNotes!.trim()}`;
            })
            .join("\n\n");
          setDraftInput(prompt);
        }
        return data;
      }
    } finally {
      if (isActivityFill) {
        setActivityFillLoading(false);
      } else {
        setAutofillLoading(false);
      }
    }
    return null;
  }, [fetchWithAuth, form.title]);

  useEffect(() => {
    if (autoFill && lockedProjectId) {
      void fetchAutofill(String(lockedProjectId));
    }
  }, []);

  const handleActivityFill = async () => {
    if (!selectedProjectId) return;
    const since = autofill?.lastReportDate
      ? autofill.lastReportDate
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    await fetchAutofill(selectedProjectId, since, true);
  };

  const handleOneDraft = async () => {
    if (!selectedProjectId) return;
    setOneDraftLoading(true);
    try {
      const since = autofill?.lastReportDate
        ? autofill.lastReportDate
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const filled = await fetchAutofill(selectedProjectId, since, false);
      if (!filled) return;
      const filledActivities = [...filled.completedSteps, ...filled.completedTasks];
      const filledNextSteps = filled.pendingSteps.slice(0, 5);
      await aiDraft("all", {
        activities: filledActivities,
        nextSteps: filledNextSteps,
        autofillData: filled,
      });
    } finally {
      setOneDraftLoading(false);
    }
  };

  const handleProjectChange = async (pid: string) => {
    setSelectedProjectId(pid);
    await fetchAutofill(pid);
  };

  const handleSave = async (statusOverride?: "draft" | "sent"): Promise<StatusReport | null> => {
    setSaving(true);
    setSaveMsg("");
    try {
      const body = {
        projectId: selectedProjectId ? parseInt(selectedProjectId, 10) : undefined,
        clientUserId: autofill?.client?.id ?? (initialReport?.clientUserId ?? undefined),
        title: form.title || "Untitled Report",
        period: form.period,
        executiveSummary: form.executiveSummary || null,
        completedActivities: activities,
        keyOutcomes: form.keyOutcomes || null,
        nextSteps,
        reportDate: form.reportDate || null,
      };

      let res: Response;
      if (isNew && !savedReport) {
        res = await fetchWithAuth("/api/admin/status-reports", { method: "POST", body: JSON.stringify(body) });
      } else {
        const id = savedReport?.id ?? initialReport!.id;
        res = await fetchWithAuth(`/api/admin/status-reports/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      }

      if (res.ok) {
        const saved = await res.json() as StatusReport;
        setSavedReport(saved);
        if (statusOverride === "sent") {
          await fetchWithAuth(`/api/admin/status-reports/${saved.id}/send`, { method: "POST", body: "{}" });
        }
        setSaveMsg(statusOverride === "sent" ? "Report published to client!" : "Draft saved.");
        onSaved?.(saved);
        return saved;
      }
    } finally {
      setSaving(false);
    }
    return null;
  };

  const handleSend = async () => {
    setSending(true);
    try {
      if (isNew && !savedReport) {
        await handleSave("sent");
      } else {
        const id = savedReport?.id ?? initialReport!.id;
        await handleSave();
        await fetchWithAuth(`/api/admin/status-reports/${id}/send`, { method: "POST", body: "{}" });
        setSaveMsg("Report published to client!");
      }
    } finally {
      setSending(false);
    }
  };

  interface AiDraftOverrides {
    activities?: Activity[];
    nextSteps?: NextStep[];
    autofillData?: AutofillData;
  }

  const aiDraft = async (section: AiSection, overrides?: AiDraftOverrides) => {
    const resolvedAutofill = overrides?.autofillData ?? autofill;
    const resolvedActivities = overrides?.activities ?? activities;
    const resolvedNextSteps = overrides?.nextSteps ?? nextSteps;
    const proj = resolvedAutofill?.project ?? projects.find(p => p.id === parseInt(selectedProjectId, 10));
    setAiLoading(section);
    setAiError(null);
    try {
      const res = await fetchWithAuth("/api/admin/status-reports/ai-draft", {
        method: "POST",
        body: JSON.stringify({
          section,
          project: proj ? { title: proj.title, status: proj.status, progress: proj.progress, description: proj.description } : undefined,
          client: resolvedAutofill?.client ?? null,
          activities: resolvedActivities,
          nextSteps: resolvedNextSteps,
          blockedCount: resolvedAutofill?.blockedCount ?? 0,
          progress: proj?.progress ?? 0,
          period: form.period,
          extraContext: draftInput.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        setAiError(err.error ?? "AI generation failed");
        return;
      }
      const data = await res.json() as { executiveSummary?: string; keyOutcomes?: string; nextSteps?: NextStep[] };
      setAiPreview(prev => ({ ...prev, ...data }));
    } catch {
      setAiError("AI generation failed. Check your connection and try again.");
    } finally {
      setAiLoading(null);
    }
  };

  const handleThreadReply = async () => {
    if (!currentReportId || !threadDraft.trim()) return;
    setThreadSending(true);
    try {
      const res = await fetchWithAuth(`/api/admin/status-reports/${currentReportId}/thread`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: threadDraft.trim() }),
      });
      if (res.ok) {
        const updated = await res.json() as StatusReport;
        setLiveReport(updated);
        setThreadDraft("");
      }
    } finally {
      setThreadSending(false);
    }
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

  return (
    <div>
        {/* Project selector */}
        <div className="bg-[#161B22] border border-[#30363D] rounded-xl px-5 py-4 mb-6 flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[220px]">
            <label className="block text-[10px] font-bold uppercase tracking-widest text-[#7D8590] mb-1.5">Project</label>
            {lockedProjectId ? (
              <div className="w-full border border-[#30363D] rounded-lg px-3 py-2 text-sm bg-[#161B22] font-medium text-[#E6EDF3]">
                {autofill?.project.title ?? (autofillLoading ? "Loading…" : `Project #${lockedProjectId}`)}
              </div>
            ) : (
              <select
                value={selectedProjectId}
                onChange={e => void handleProjectChange(e.target.value)}
                className="w-full border border-[#30363D] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-[#1C2128] font-medium text-[#E6EDF3]"
              >
                <option value="">— Select a project to auto-populate —</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.title}</option>
                ))}
              </select>
            )}
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className="block text-[10px] font-bold uppercase tracking-widest text-[#7D8590] mb-1.5">Report Period</label>
            <select
              value={form.period}
              onChange={e => setForm(f => ({ ...f, period: e.target.value }))}
              className="w-full border border-[#30363D] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-[#1C2128]"
            >
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="executive_summary">Executive Summary</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className="block text-[10px] font-bold uppercase tracking-widest text-[#7D8590] mb-1.5">Report Date</label>
            <input
              type="date"
              value={form.reportDate}
              onChange={e => setForm(f => ({ ...f, reportDate: e.target.value }))}
              className="w-full border border-[#30363D] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
            />
          </div>
          {autofillLoading && (
            <div className="flex items-center gap-2 text-xs text-[#7D8590] pb-2">
              <div className="w-4 h-4 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
              Loading project data…
            </div>
          )}
          {selectedProjectId && !autofillLoading && (
            <div className="flex items-center gap-2 flex-wrap pb-1">
              <button
                onClick={() => void handleActivityFill()}
                disabled={activityFillLoading || !!aiLoading}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#0078D4] border border-[#0078D4]/30 rounded-lg bg-[#0078D4]/5 hover:bg-[#0078D4]/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {activityFillLoading ? (
                  <div className="w-3.5 h-3.5 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                )}
                {activityFillLoading ? "Fetching activity…" : "Auto-fill from project activity"}
              </button>
              {autofill?.lastReportDate && (
                <span className="text-[10px] text-[#7D8590] font-medium">
                  Last report: {new Date(autofill.lastReportDate).toLocaleDateString()}
                </span>
              )}
              {!autofill?.lastReportDate && (
                <span className="text-[10px] text-[#7D8590] font-medium">
                  No prior reports — will fetch last 30 days
                </span>
              )}
            </div>
          )}
        </div>

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-5 mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[11px] font-bold uppercase tracking-widest text-[#7D8590]">Client Deliverable</span>
              <span className="w-1.5 h-1.5 rounded-full bg-teal-500/100" />
              <span className="text-[11px] font-bold text-teal-400 uppercase tracking-widest">Shane McCaw Consulting</span>
            </div>
            <h1 className="text-2xl font-bold text-[#E6EDF3] tracking-tight mb-1">Project Status Report</h1>
            <div className="flex items-center gap-3 flex-wrap">
              <input
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="Report title (e.g. May 2026 Status Update)"
                className="text-lg text-[#7D8590] bg-transparent border-0 border-b border-dashed border-[#30363D] focus:outline-none focus:border-[#0078D4] min-w-[320px] pb-0.5"
              />
              {selectedProject && (
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${STATUS_COLORS[selectedProject.status] ?? "bg-[#1C2128] text-[#7D8590] border-[#30363D]"}`}>
                  {STATUS_LABELS[selectedProject.status] ?? selectedProject.status}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {saveMsg && (
              <span className="text-xs text-emerald-400 font-semibold bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-lg">
                {saveMsg}
              </span>
            )}
            {embedded && onCancel && (
              <button
                onClick={onCancel}
                className="flex items-center gap-2 px-4 py-2 border border-[#30363D] rounded-lg text-sm font-medium text-[#7D8590] bg-[#1C2128] hover:bg-[#1C2128] transition-all"
              >
                Cancel
              </button>
            )}
            <button
              onClick={() => void handleSave()}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 border border-[#30363D] rounded-lg text-sm font-medium text-[#E6EDF3] bg-[#1C2128] hover:bg-[#1C2128] disabled:opacity-50 transition-all"
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
              {sending ? "Publishing…" : "Publish to Client"}
            </button>
          </div>
        </div>

        {/* Progress + Health Bar */}
        {selectedProject && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6 p-5 bg-[#161B22] rounded-xl border border-[#30363D]">
            <div className="flex flex-col gap-2">
              <div className="flex justify-between items-center">
                <span className="text-[11px] font-bold uppercase tracking-widest text-[#7D8590]">Overall Project Progress</span>
                <span className="text-sm font-bold text-[#E6EDF3]">{progress}%</span>
              </div>
              <div className="w-full h-2 bg-[#1C2128] rounded-full overflow-hidden">
                <div className="h-full bg-[#0078D4] rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
              </div>
              {autofill && (
                <p className="text-xs text-[#7D8590] mt-0.5">{autofill.completedStepsCount} of {autofill.totalSteps} phases complete</p>
              )}
            </div>
            <div className="flex items-center md:justify-end gap-4 flex-wrap">
              {autofill && autofill.blockedCount > 0 && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-red-500/10 border border-red-500/20 rounded-lg">
                  <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <span className="text-xs font-bold text-red-400">Raised Issues: {autofill.blockedCount}</span>
                </div>
              )}
              <div className="flex items-center gap-2 px-3 py-1.5 bg-[#161B22] border border-[#30363D] rounded-lg">
                <svg className="w-4 h-4 text-[#7D8590]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                <span className="text-xs font-bold text-[#7D8590]">{activities.length} Activities</span>
              </div>
            </div>
          </div>
        )}

        {/* Two-column main content */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">

          {/* LEFT COLUMN */}
          <div className="flex flex-col gap-6">

            {/* Executive Summary */}
            <section className="bg-[#161B22] p-6 rounded-xl border border-[#30363D]">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-9 h-9 rounded-lg bg-[#30363D] flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <h3 className="text-base font-bold text-[#E6EDF3]">Executive Summary</h3>
              </div>
              <textarea
                value={form.executiveSummary}
                onChange={e => setForm(f => ({ ...f, executiveSummary: e.target.value }))}
                placeholder="Write a concise executive summary of progress, achievements, and current project health…"
                rows={6}
                className="w-full p-3 border border-[#30363D] rounded-lg text-sm text-[#E6EDF3] focus:outline-none focus:ring-2 focus:ring-[#0078D4] resize-none leading-relaxed"
              />
            </section>

            {/* Completed Activities */}
            <section className="bg-[#161B22] p-6 rounded-xl border border-[#30363D]">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-base font-bold text-[#E6EDF3]">Completed Activities</h3>
                  {activitySince && (
                    <span className="flex items-center gap-1 text-[10px] font-semibold text-teal-400 bg-teal-500/10 border border-teal-500/20 px-2 py-0.5 rounded-full">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      Since {new Date(activitySince).toLocaleDateString()}
                    </span>
                  )}
                </div>
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
                <div className="text-center py-6 border-2 border-dashed border-[#30363D] rounded-lg">
                  <p className="text-xs text-[#7D8590] font-medium">Select a project above to auto-populate from completed tasks, or add manually.</p>
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
                          className="w-full text-sm font-semibold text-[#E6EDF3] bg-transparent border-0 border-b border-transparent focus:border-[#0078D4] focus:outline-none pb-0.5 mb-1"
                        />
                        <input
                          value={a.description}
                          onChange={e => updateActivity(i, "description", e.target.value)}
                          placeholder="Short description…"
                          className="w-full text-xs text-[#7D8590] bg-transparent border-0 focus:outline-none"
                        />
                      </div>
                      <button
                        onClick={() => removeActivity(i)}
                        className="opacity-0 group-hover:opacity-100 text-[#484F58] hover:text-red-400 transition-all mt-0.5"
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
            <section className="bg-[#161B22] p-6 rounded-xl border border-[#30363D]">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-9 h-9 rounded-lg bg-teal-500/100/10 border border-teal-500/20 flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  </svg>
                </div>
                <h3 className="text-base font-bold text-[#E6EDF3]">Key Outcomes</h3>
              </div>
              <textarea
                value={form.keyOutcomes}
                onChange={e => setForm(f => ({ ...f, keyOutcomes: e.target.value }))}
                placeholder="Describe the business or technical outcomes achieved this period — compliance improvements, risk reductions, efficiency gains…"
                rows={4}
                className="w-full p-3 border border-[#30363D] rounded-lg text-sm text-[#E6EDF3] focus:outline-none focus:ring-2 focus:ring-[#0078D4] resize-none leading-relaxed"
              />
            </section>
          </div>

          {/* RIGHT COLUMN */}
          <div className="flex flex-col gap-6">

            {/* Draft Assist Panel */}
            <section className="bg-[#161B22]/90 backdrop-blur border border-[#30363D] p-6 rounded-xl flex flex-col gap-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                  </svg>
                  <h4 className="text-base font-bold text-[#E6EDF3]">Draft Assist</h4>
                </div>
                <span className="text-[9px] px-2 py-0.5 bg-[#0078D4] text-white rounded font-bold uppercase tracking-wider">AI</span>
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-[#7D8590] mb-1.5 block">Additional Context</label>
                <textarea
                  value={draftInput}
                  onChange={e => setDraftInput(e.target.value)}
                  placeholder="Any extra context, blockers resolved, or notable events this period… (passed to AI)"
                  rows={3}
                  className="w-full p-3 border border-[#30363D] rounded-lg text-sm focus:ring-2 focus:ring-[#0078D4] focus:outline-none resize-none"
                />
              </div>

              {selectedProjectId && (
                <button
                  onClick={() => void handleOneDraft()}
                  disabled={oneDraftLoading || !!aiLoading || activityFillLoading}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-[#30363D] text-white rounded-lg text-xs font-bold hover:bg-[#0A2540]/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95"
                >
                  {oneDraftLoading ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                    </svg>
                  )}
                  {oneDraftLoading ? "Auto-filling & drafting…" : "One-click draft from activity"}
                </button>
              )}

              <div className="grid grid-cols-2 gap-2">
                {([ 
                  { section: "executive_summary" as AiSection, label: "Executive Summary", icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" },
                  { section: "key_outcomes" as AiSection, label: "Key Outcomes", icon: "M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" },
                  { section: "next_steps" as AiSection, label: "Next Steps", icon: "M9 5l7 7-7 7" },
                ] as { section: AiSection; label: string; icon: string }[]).map(({ section, label, icon }) => {
                  const loading = aiLoading === section || aiLoading === "all";
                  return (
                    <button
                      key={section}
                      onClick={() => void aiDraft(section)}
                      disabled={!!aiLoading || oneDraftLoading}
                      className="p-3 border border-[#30363D] rounded-lg text-xs font-semibold text-[#E6EDF3] hover:bg-[#0078D4]/5 hover:border-[#0078D4]/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex flex-col items-center gap-1.5 group"
                    >
                      {loading ? (
                        <div className="w-4 h-4 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <svg className="w-4.5 h-4.5 text-[#0078D4] group-hover:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
                        </svg>
                      )}
                      {loading ? "Writing…" : `Write ${label}`}
                    </button>
                  );
                })}
                <button
                  onClick={() => void aiDraft("all")}
                  disabled={!!aiLoading || oneDraftLoading}
                  className="p-3 bg-[#0078D4]/5 border border-[#0078D4]/20 rounded-lg text-xs font-bold text-[#0078D4] hover:bg-[#0078D4]/10 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex flex-col items-center gap-1.5 group"
                >
                  {aiLoading === "all" ? (
                    <div className="w-4 h-4 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <svg className="w-4.5 h-4.5 text-[#0078D4] group-hover:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                    </svg>
                  )}
                  {aiLoading === "all" ? "Writing Full Report…" : "Write Full Report"}
                </button>
              </div>

              {aiError && (
                <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                  <svg className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <p className="text-xs text-red-400 font-medium">{aiError}</p>
                </div>
              )}

              {(aiPreview.executiveSummary || aiPreview.keyOutcomes || aiPreview.nextSteps) && (
                <div className="border-t border-[#30363D] pt-4 flex flex-col gap-4">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-[#7D8590]">AI Draft Preview</label>
                    <div className="flex items-center gap-2">
                      <span className="flex items-center gap-1 text-[10px] text-teal-400 font-bold">
                        <span className="w-1.5 h-1.5 bg-teal-500/100 rounded-full animate-pulse" />
                        Ready to apply
                      </span>
                      <button
                        onClick={() => setAiPreview({})}
                        className="text-[10px] text-[#7D8590] hover:text-[#7D8590] transition-colors"
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  {aiPreview.executiveSummary && (
                    <div className="flex flex-col gap-2">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[#0078D4]">Executive Summary</p>
                      <div className="p-3 bg-[#0078D4]/5 rounded-lg border border-[#0078D4]/15 text-sm text-[#E6EDF3] leading-relaxed">
                        {aiPreview.executiveSummary}
                      </div>
                      <button
                        onClick={() => { setForm(f => ({ ...f, executiveSummary: aiPreview.executiveSummary! })); setAiPreview(p => ({ ...p, executiveSummary: undefined })); }}
                        className="self-start text-xs font-bold text-[#0078D4] hover:text-[#0078D4]/80 px-3 py-1.5 rounded-lg bg-[#0078D4]/10 hover:bg-[#0078D4]/15 transition-colors flex items-center gap-1.5"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
                        Apply to Executive Summary
                      </button>
                    </div>
                  )}

                  {aiPreview.keyOutcomes && (
                    <div className="flex flex-col gap-2">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-teal-400">Key Outcomes</p>
                      <div className="p-3 bg-teal-500/10/50 rounded-lg border border-teal-100 text-sm text-[#E6EDF3] leading-relaxed">
                        {aiPreview.keyOutcomes}
                      </div>
                      <button
                        onClick={() => { setForm(f => ({ ...f, keyOutcomes: aiPreview.keyOutcomes! })); setAiPreview(p => ({ ...p, keyOutcomes: undefined })); }}
                        className="self-start text-xs font-bold text-teal-400 hover:text-teal-400 px-3 py-1.5 rounded-lg bg-teal-500/10 hover:bg-teal-100 transition-colors flex items-center gap-1.5"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
                        Apply to Key Outcomes
                      </button>
                    </div>
                  )}

                  {aiPreview.nextSteps && aiPreview.nextSteps.length > 0 && (
                    <div className="flex flex-col gap-2">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[#7D8590]">Suggested Next Steps</p>
                      <div className="flex flex-col gap-1.5">
                        {aiPreview.nextSteps.map((s, i) => (
                          <div key={i} className="p-2.5 bg-[#161B22] rounded-lg border border-[#30363D] text-xs text-[#E6EDF3]">
                            <span className="font-bold text-[#E6EDF3]">{s.title}</span>
                            {s.description && <span className="text-[#7D8590]"> — {s.description}</span>}
                          </div>
                        ))}
                      </div>
                      <button
                        onClick={() => { setNextSteps(aiPreview.nextSteps!); setAiPreview(p => ({ ...p, nextSteps: undefined })); }}
                        className="self-start text-xs font-bold text-[#7D8590] hover:text-[#E6EDF3] px-3 py-1.5 rounded-lg bg-[#1C2128] hover:bg-[#30363D] transition-colors flex items-center gap-1.5"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
                        Apply as Next Steps
                      </button>
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* Next Steps */}
            <section className="bg-[#161B22] p-6 rounded-xl border border-[#30363D]">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-bold text-[#E6EDF3]">Next Steps: Lookahead</h3>
                <div className="flex items-center gap-2">
                  {currentReportId && !isNew && nextSteps.length > 0 && nextSteps.some(s => !s.kanbanTaskId) && (
                    <button
                      onClick={() => void handlePushAllToKanban()}
                      disabled={pushAllLoading}
                      title="Push all unpushed steps to the project Kanban board as Backlog tasks"
                      className="flex items-center gap-1 text-xs font-semibold text-emerald-400 border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed px-2.5 py-1 rounded-lg transition-colors"
                    >
                      {pushAllLoading ? (
                        <div className="w-3 h-3 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 0v10m0-10a2 2 0 012 2h2a2 2 0 012-2" />
                        </svg>
                      )}
                      Push all to Kanban
                    </button>
                  )}
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
              </div>
              {nextSteps.length === 0 ? (
                <div className="text-center py-6 border-2 border-dashed border-[#30363D] rounded-lg">
                  <p className="text-xs text-[#7D8590] font-medium">Pending workflow steps will appear here when a project is selected.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {nextSteps.map((s, i) => (
                    <div key={i} className={`group p-3 border-l-4 bg-[#161B22] rounded-r-lg relative ${s.kanbanTaskId ? "border-emerald-400" : "border-[#0078D4]"}`}>
                      <input
                        value={s.label}
                        onChange={e => updateNextStep(i, "label", e.target.value)}
                        placeholder="Phase label"
                        className="text-[10px] font-bold uppercase tracking-widest text-[#7D8590] bg-transparent border-0 focus:outline-none w-full mb-0.5"
                      />
                      <input
                        value={s.title}
                        onChange={e => updateNextStep(i, "title", e.target.value)}
                        placeholder="Next step title"
                        className="text-sm font-bold text-[#E6EDF3] bg-transparent border-0 focus:outline-none w-full mb-1"
                      />
                      <input
                        value={s.description}
                        onChange={e => updateNextStep(i, "description", e.target.value)}
                        placeholder="Brief description…"
                        className="text-xs text-[#7D8590] bg-transparent border-0 focus:outline-none w-full"
                      />
                      <div className="flex items-center justify-between mt-2">
                        {s.kanbanTaskId ? (
                          <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                            On Kanban #{s.kanbanTaskId}
                          </span>
                        ) : currentReportId && !isNew ? (
                          <button
                            onClick={() => void handlePushToKanban(i)}
                            disabled={!!pushLoading[i]}
                            title="Add this step to the project Kanban board as a Backlog task"
                            className="flex items-center gap-1 text-[10px] font-semibold text-[#0078D4] hover:text-white border border-[#0078D4]/30 hover:bg-[#0078D4] hover:border-[#0078D4] bg-[#1C2128] disabled:opacity-50 disabled:cursor-not-allowed px-2 py-0.5 rounded-full transition-colors"
                          >
                            {pushLoading[i] ? (
                              <div className="w-2.5 h-2.5 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
                            ) : (
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                              </svg>
                            )}
                            Add to Kanban
                          </button>
                        ) : (
                          <span className="text-[10px] text-[#484F58]">Save report first to push to Kanban</span>
                        )}
                        <button
                          onClick={() => removeNextStep(i)}
                          className="opacity-0 group-hover:opacity-100 text-[#484F58] hover:text-red-400 transition-all"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Client Conversation Thread — shown when client has a question or follow-ups */}
            {(() => {
              const report = liveReport ?? savedReport ?? initialReport;
              if (!report?.clientQuestion && !(report?.replyThread ?? []).length) return null;
              const thread = report?.replyThread ?? [];
              return (
                <section className="bg-[#161B22] p-6 rounded-xl border border-amber-500/20">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-7 h-7 rounded-lg bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                      <svg className="w-4 h-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                      </svg>
                    </div>
                    <h3 className="text-base font-bold text-[#E6EDF3]">Client Conversation</h3>
                    <span className={`ml-auto text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${report?.clientStatus === "has_questions" ? "bg-amber-500/15 text-amber-400 border-amber-500/20" : report?.clientStatus === "accepted" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/20" : "bg-[#1C2128] text-[#7D8590] border-[#30363D]"}`}>
                      {report?.clientStatus === "has_questions" ? "Awaiting resolution" : report?.clientStatus === "accepted" ? "Resolved" : report?.clientStatus ?? ""}
                    </span>
                  </div>

                  <div className="space-y-3">
                    {/* Initial client question */}
                    {report?.clientQuestion && (
                      <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-4 py-3">
                        <div className="flex items-center gap-1.5 mb-1">
                          <div className="w-4 h-4 rounded-full bg-amber-400 flex items-center justify-center flex-shrink-0">
                            <span className="text-white text-[7px] font-bold">C</span>
                          </div>
                          <p className="text-[10px] font-semibold text-amber-400 uppercase tracking-wide">Client Question</p>
                        </div>
                        <p className="text-sm text-[#E6EDF3] leading-relaxed">{report.clientQuestion}</p>
                      </div>
                    )}

                    {/* Initial admin reply */}
                    {report?.adminReply && (
                      <div className="border-l-4 border-[#0078D4] pl-4 bg-[#0078D4]/5 rounded-r-lg py-3 pr-3">
                        <div className="flex items-center gap-1.5 mb-1">
                          <div className="w-4 h-4 rounded-full bg-[#0078D4] flex items-center justify-center flex-shrink-0">
                            <span className="text-white text-[7px] font-bold">SM</span>
                          </div>
                          <p className="text-[10px] font-semibold text-[#0078D4] uppercase tracking-wide">Your Initial Reply</p>
                        </div>
                        <p className="text-sm text-[#E6EDF3] leading-relaxed">{report.adminReply}</p>
                      </div>
                    )}

                    {/* Thread follow-up messages */}
                    {thread.length > 0 && (
                      <div className="space-y-2 pl-2">
                        {thread.map((msg, i) => (
                          <div key={i} className={`rounded-lg px-4 py-3 ${msg.sender === "client" ? "bg-amber-500/10 border border-amber-500/20 ml-4" : "bg-[#1C2128] border border-[#0078D4]/30"}`}>
                            <div className="flex items-center gap-1.5 mb-1">
                              <div className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 ${msg.sender === "client" ? "bg-amber-400" : "bg-[#0078D4]"}`}>
                                <span className="text-white text-[7px] font-bold">{msg.sender === "client" ? "C" : "SM"}</span>
                              </div>
                              <p className="text-[10px] font-semibold text-[#7D8590]">
                                {msg.sender === "client" ? "Client" : "You"} · {new Date(msg.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                              </p>
                            </div>
                            <p className="text-sm text-[#E6EDF3] leading-relaxed">{msg.content}</p>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Reply box — only when still in has_questions state */}
                    {report?.clientStatus === "has_questions" && report?.adminReply && (
                      <div className="space-y-2 pt-1">
                        <textarea
                          value={threadDraft}
                          onChange={e => setThreadDraft(e.target.value)}
                          placeholder="Reply to client follow-up…"
                          rows={3}
                          className="w-full text-sm border border-[#30363D] rounded-lg px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-[#1C2128]"
                        />
                        <button
                          onClick={() => void handleThreadReply()}
                          disabled={!threadDraft.trim() || threadSending}
                          className="flex items-center gap-2 text-sm font-semibold text-white bg-[#0078D4] hover:bg-[#0078D4]/90 px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
                        >
                          {threadSending ? (
                            <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                          ) : (
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                          )}
                          Send Reply
                        </button>
                      </div>
                    )}
                  </div>
                </section>
              );
            })()}
          </div>
        </div>
    </div>
  );
}
