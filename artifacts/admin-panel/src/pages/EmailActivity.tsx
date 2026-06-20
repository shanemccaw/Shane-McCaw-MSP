import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useAssignEmail } from "@/hooks/useAssignEmail";

// ─── Types ────────────────────────────────────────────────────────────────────

interface EmailRow {
  email: {
    id: number;
    messageId: string;
    subject: string | null;
    senderAddress: string;
    senderDomain: string;
    bodyPreview: string | null;
    receivedAt: string;
    rawFrom: string | null;
    linkedUserId: number | null;
    ingestedAt: string;
  };
  clientName: string | null;
  clientEmail: string | null;
  clientCompany: string | null;
}

interface EmailList {
  emails: EmailRow[];
  total: number;
  page: number;
  limit: number;
}

interface EmailDetail {
  email: {
    id: number;
    messageId: string;
    subject: string | null;
    senderAddress: string;
    senderDomain: string;
    bodyPreview: string | null;
    receivedAt: string;
    rawFrom: string | null;
    linkedUserId: number | null;
    linkedProjectId: number | null;
    linkedLeadId: number | null;
  };
  clientName: string | null;
  clientEmail: string | null;
  clientCompany: string | null;
  clientPhone: string | null;
  clientId: number | null;
  linkedProjectTitle: string | null;
  linkedLeadName: string | null;
  bodyContent: string | null;
  bodyContentType: "html" | "text" | "preview";
  graphAvailable: boolean;
}

interface MatchingRuleRow {
  rule: { id: number; domain: string; linkedUserId: number; createdAt: string };
  clientName: string | null;
  clientEmail: string | null;
}

interface ClientOption {
  id: number;
  name: string | null;
  email: string;
  company: string | null;
}

interface Project {
  id: number;
  title: string;
  status: string;
  progress: number;
  phase: string | null;
  projectType: string;
  clientUserId: number | null;
}

interface LeadOption {
  id: number;
  name: string;
  email: string;
  company: string | null;
  status: string;
}

type Tab = "all" | "linked" | "unlinked";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(ts: string) {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatDateLong(ts: string) {
  return new Date(ts).toLocaleString("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  });
}

function initials(name: string | null, email: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
    return (parts[0]![0] ?? "").toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

function senderDisplayName(row: EmailRow): string {
  if (row.email.rawFrom) {
    const m = row.email.rawFrom.match(/^(.+?)\s*</);
    if (m && m[1]) return m[1].trim().replace(/^"(.*)"$/, "$1");
  }
  return row.email.senderAddress;
}

function avatarColor(seed: string): string {
  const colors = [
    "bg-blue-600", "bg-purple-600", "bg-green-600", "bg-amber-600",
    "bg-rose-600", "bg-teal-600", "bg-indigo-600", "bg-orange-600",
  ];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length]!;
}

function ruleLabel(value: string) {
  return value.includes("@") ? value : `@${value}`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Avatar({ name, email, size = "md" }: { name: string | null; email: string; size?: "sm" | "md" }) {
  const ini = initials(name, email);
  const color = avatarColor(email);
  const sz = size === "sm" ? "w-7 h-7 text-[10px]" : "w-9 h-9 text-xs";
  return (
    <div className={`${sz} ${color} rounded-full flex items-center justify-center text-white font-bold shrink-0`}>
      {ini}
    </div>
  );
}

function SkeletonDetail() {
  return (
    <div className="p-6 space-y-4 animate-pulse">
      <div className="h-5 w-2/3 bg-gray-200 rounded" />
      <div className="h-4 w-1/2 bg-gray-100 rounded" />
      <div className="h-4 w-1/3 bg-gray-100 rounded" />
      <div className="mt-6 h-40 bg-gray-100 rounded-xl" />
    </div>
  );
}

// ─── Email List Panel ─────────────────────────────────────────────────────────

interface EmailListPanelProps {
  emails: EmailRow[];
  total: number;
  page: number;
  totalPages: number;
  loading: boolean;
  error: string | null;
  tab: Tab;
  selectedId: number | null;
  assigningId: number | null;
  onTabChange: (t: Tab) => void;
  onSelect: (id: number) => void;
  onPageChange: (p: number) => void;
}

function EmailListPanel({
  emails, total, page, totalPages, loading, error, tab, selectedId,
  onTabChange, onSelect, onPageChange,
}: EmailListPanelProps) {
  const tabs: { key: Tab; label: string }[] = [
    { key: "all", label: "All" },
    { key: "linked", label: "Linked" },
    { key: "unlinked", label: "Unlinked" },
  ];

  return (
    <div className="flex flex-col h-full border-r border-gray-100 bg-white">
      {/* Tab bar */}
      <div className="flex gap-0 border-b border-gray-100 shrink-0">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => onTabChange(t.key)}
            className={`flex-1 px-3 py-3 text-xs font-semibold border-b-2 transition-colors -mb-px ${
              tab === t.key
                ? "border-[#0078D4] text-[#0078D4]"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Email list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-10">
            <div className="w-6 h-6 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="p-4 text-sm text-red-600">{error}</div>
        ) : emails.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 px-4 text-center gap-3">
            <div className="w-10 h-10 bg-gray-100 rounded-xl flex items-center justify-center">
              <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
              </svg>
            </div>
            <p className="text-xs text-gray-500">
              {tab === "unlinked"
                ? "All senders matched to a client."
                : tab === "linked"
                ? "No linked emails yet."
                : "No emails ingested yet."}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {emails.map(row => {
              const active = row.email.id === selectedId;
              const linked = Boolean(row.email.linkedUserId);
              const displayName = senderDisplayName(row);
              return (
                <button
                  key={row.email.id}
                  onClick={() => onSelect(row.email.id)}
                  className={`w-full text-left px-4 py-3 flex gap-3 transition-colors ${
                    active ? "bg-blue-50/80 border-l-2 border-[#0078D4]" : "hover:bg-gray-50/50 border-l-2 border-transparent"
                  }`}
                >
                  <Avatar name={displayName !== row.email.senderAddress ? displayName : null} email={row.email.senderAddress} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-[#0A2540] truncate">{displayName}</span>
                      <span className="text-[10px] text-gray-400 shrink-0 whitespace-nowrap">{timeAgo(row.email.receivedAt)}</span>
                    </div>
                    <p className="text-xs text-gray-700 truncate mt-0.5">
                      {row.email.subject ?? "(no subject)"}
                    </p>
                    <p className="text-[11px] text-gray-400 truncate mt-0.5 leading-tight">
                      {row.email.bodyPreview ?? ""}
                    </p>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      {linked ? (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-blue-100 text-blue-700 max-w-[130px] truncate">
                          {row.clientName ?? row.clientEmail ?? "Linked"}
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-100 text-amber-700">
                          Unlinked
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="shrink-0 px-4 py-2.5 border-t border-gray-100 flex items-center justify-between">
          <span className="text-[10px] text-gray-400">{total} total</span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => onPageChange(Math.max(1, page - 1))}
              disabled={page === 1}
              className="w-6 h-6 flex items-center justify-center rounded border border-gray-200 text-gray-500 text-xs hover:bg-gray-50 disabled:opacity-40"
            >
              ‹
            </button>
            <span className="text-[10px] text-gray-500">{page}/{totalPages}</span>
            <button
              onClick={() => onPageChange(Math.min(totalPages, page + 1))}
              disabled={page === totalPages}
              className="w-6 h-6 flex items-center justify-center rounded border border-gray-200 text-gray-500 text-xs hover:bg-gray-50 disabled:opacity-40"
            >
              ›
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Email Detail Panel ───────────────────────────────────────────────────────

interface EmailDetailPanelProps {
  emailId: number | null;
  reloadKey: number;
  clients: ClientOption[];
  leads: LeadOption[];
  onEmailReassigned: () => void;
}

function EmailDetailPanel({ emailId, reloadKey, clients, leads, onEmailReassigned }: EmailDetailPanelProps) {
  const { fetchWithAuth } = useAuth();
  const { assignEmail, assigningId } = useAssignEmail();

  const [detail, setDetail] = useState<EmailDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [clientProjects, setClientProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);

  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [selectedLeadId, setSelectedLeadId] = useState<string>("");
  const [linkMode, setLinkMode] = useState<"project" | "lead">("project");
  const [linkSaving, setLinkSaving] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  const [nextStepOpen, setNextStepOpen] = useState(false);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskProjectId, setTaskProjectId] = useState<string>("");
  const [taskPriority, setTaskPriority] = useState<string>("");
  const [taskDueDate, setTaskDueDate] = useState<string>("");
  const [taskNotes, setTaskNotes] = useState<string>("");
  const [taskSubmitting, setTaskSubmitting] = useState(false);
  const [createdTask, setCreatedTask] = useState<{ id: number; title: string; projectId: number } | null>(null);
  const [taskError, setTaskError] = useState<string | null>(null);

  const prevEmailIdRef = useRef<number | null>(null);

  const loadDetail = useCallback(async (id: number) => {
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    setCreatedTask(null);
    setTaskError(null);
    setNextStepOpen(false);
    setLinkError(null);
    try {
      const res = await fetchWithAuth(`/api/admin/emails/${id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as EmailDetail;
      setDetail(data);
      setTaskTitle(data.email.subject ?? "");
      setSelectedProjectId(data.email.linkedProjectId ? String(data.email.linkedProjectId) : "");
      setSelectedLeadId(data.email.linkedLeadId ? String(data.email.linkedLeadId) : "");
      if (data.email.linkedLeadId) {
        setLinkMode("lead");
      } else {
        setLinkMode("project");
      }
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : "Failed to load email");
    } finally {
      setDetailLoading(false);
    }
  }, [fetchWithAuth]);

  const loadClientProjects = useCallback(async (clientId: number) => {
    setProjectsLoading(true);
    try {
      const res = await fetchWithAuth("/api/admin/projects");
      if (!res.ok) return;
      const all = await res.json() as Project[];
      setClientProjects(all.filter(p => p.clientUserId === clientId && p.status === "active"));
    } catch { /* silent */ } finally {
      setProjectsLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    if (emailId === null) { setDetail(null); return; }
    prevEmailIdRef.current = emailId;
    setClientProjects([]);
    setTaskProjectId("");
    void loadDetail(emailId);
  }, [emailId, reloadKey, loadDetail]);

  useEffect(() => {
    if (detail?.clientId) {
      void loadClientProjects(detail.clientId);
    } else {
      setClientProjects([]);
    }
  }, [detail?.clientId, loadClientProjects]);

  useEffect(() => {
    if (clientProjects.length > 0 && !taskProjectId) {
      setTaskProjectId(String(clientProjects[0]!.id));
    }
  }, [clientProjects, taskProjectId]);

  async function handleAssign(userId: number | null) {
    if (!detail) return;
    try {
      await assignEmail(detail.email.id, userId);
      await loadDetail(detail.email.id);
      onEmailReassigned();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to assign email");
    }
  }

  async function handleLinkProject() {
    if (!detail) return;
    setLinkSaving(true);
    setLinkError(null);
    try {
      const projectId = selectedProjectId ? parseInt(selectedProjectId, 10) : null;
      const res = await fetchWithAuth(`/api/admin/emails/${detail.email.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkedProjectId: projectId }),
      });
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      await loadDetail(detail.email.id);
    } catch (e) {
      setLinkError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setLinkSaving(false);
    }
  }

  async function handleLinkLead() {
    if (!detail) return;
    setLinkSaving(true);
    setLinkError(null);
    try {
      const leadId = selectedLeadId ? parseInt(selectedLeadId, 10) : null;
      const res = await fetchWithAuth(`/api/admin/emails/${detail.email.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkedLeadId: leadId }),
      });
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      await loadDetail(detail.email.id);
    } catch (e) {
      setLinkError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setLinkSaving(false);
    }
  }

  async function handleCreateTask(e: React.FormEvent) {
    e.preventDefault();
    if (!detail || !taskProjectId || !taskTitle.trim()) return;
    setTaskSubmitting(true);
    setTaskError(null);
    try {
      const res = await fetchWithAuth(`/api/admin/emails/${detail.email.id}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: parseInt(taskProjectId, 10),
          title: taskTitle.trim(),
          description: taskNotes.trim() || undefined,
          priority: taskPriority || undefined,
          dueDate: taskDueDate || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const { task } = await res.json() as { task: { id: number; title: string; projectId: number } };
      setCreatedTask(task);
      setNextStepOpen(false);
      setTaskNotes("");
      setTaskDueDate("");
      setTaskPriority("");
    } catch (err) {
      setTaskError(err instanceof Error ? err.message : "Failed to create task");
    } finally {
      setTaskSubmitting(false);
    }
  }

  if (emailId === null) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-400">
        <svg className="w-12 h-12 text-gray-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
        </svg>
        <p className="text-sm">Select an email to read</p>
      </div>
    );
  }

  if (detailLoading) return <SkeletonDetail />;
  if (detailError) return <div className="p-6 text-sm text-red-600">{detailError}</div>;
  if (!detail) return null;

  const senderName = detail.email.rawFrom
    ? detail.email.rawFrom.replace(/^"?(.*?)"?\s*<.*>$/, "$1").trim() || detail.email.senderAddress
    : detail.email.senderAddress;

  const activeProjects = clientProjects.filter(p => p.status === "active");

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Email header */}
      <div className="px-6 pt-5 pb-4 border-b border-gray-100 shrink-0">
        <h2 className="text-base font-bold text-[#0A2540] leading-snug mb-3">
          {detail.email.subject ?? "(no subject)"}
        </h2>
        <div className="flex items-start gap-3">
          <Avatar name={senderName !== detail.email.senderAddress ? senderName : null} email={detail.email.senderAddress} size="md" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[#0A2540]">{senderName}</p>
            <p className="text-xs text-gray-500">{detail.email.senderAddress}</p>
            <p className="text-xs text-gray-400 mt-0.5">{formatDateLong(detail.email.receivedAt)}</p>
          </div>
          {/* Assign dropdown */}
          <div className="shrink-0">
            <select
              disabled={assigningId === detail.email.id}
              value={detail.email.linkedUserId ?? ""}
              onChange={e => {
                const val = e.target.value;
                void handleAssign(val === "" ? null : parseInt(val, 10));
              }}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-700 bg-white focus:outline-none focus:ring-1 focus:ring-[#0078D4] disabled:opacity-50 max-w-[180px]"
            >
              <option value="">— Unassigned —</option>
              {clients.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name ?? c.email}{c.company ? ` (${c.company})` : ""}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Email body */}
      <div className="px-6 py-4 border-b border-gray-100 shrink-0">
        {detail.bodyContentType === "html" && detail.bodyContent ? (
          <iframe
            srcDoc={detail.bodyContent}
            sandbox="allow-same-origin"
            className="w-full min-h-[280px] border-0 rounded-lg bg-white"
            title="Email body"
            style={{ height: "320px" }}
          />
        ) : detail.bodyContent ? (
          <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed max-h-72 overflow-y-auto">
            {detail.bodyContent}
          </pre>
        ) : (
          <p className="text-sm text-gray-400 italic">No body content available.</p>
        )}
        {!detail.graphAvailable && (
          <p className="mt-2 text-[10px] text-gray-400 italic">
            Showing preview only — configure Graph credentials to load the full email body.
          </p>
        )}
      </div>

      {/* Client context */}
      {detail.clientId ? (
        <div className="px-6 py-4 border-b border-gray-100 shrink-0">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Client</p>
          <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
            <Avatar name={detail.clientName} email={detail.clientEmail ?? ""} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[#0A2540]">{detail.clientName ?? detail.clientEmail}</p>
              {detail.clientCompany && <p className="text-xs text-gray-500">{detail.clientCompany}</p>}
              {detail.clientEmail && <p className="text-xs text-gray-400">{detail.clientEmail}</p>}
            </div>
          </div>

          {/* Mode toggle: Project vs Lead */}
          <div className="mt-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                {linkMode === "project" ? "Linked Project" : "Linked Lead"}
              </p>
              <button
                onClick={() => {
                  setLinkMode(m => m === "project" ? "lead" : "project");
                  setLinkError(null);
                }}
                className="text-[10px] text-[#0078D4] hover:underline font-medium"
              >
                {linkMode === "project" ? "Assign to lead instead →" : "← Back to project"}
              </button>
            </div>

            {linkMode === "project" ? (
              <>
                {detail.linkedProjectTitle && (
                  <div className="mb-2 flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-100 rounded-xl">
                    <svg className="w-3.5 h-3.5 text-[#0078D4] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                    </svg>
                    <span className="text-xs font-semibold text-[#0078D4] truncate flex-1">{detail.linkedProjectTitle}</span>
                    <a
                      href={`/admin-panel/crm/projects/${detail.email.linkedProjectId}`}
                      className="text-[10px] text-[#0078D4] hover:underline shrink-0 font-medium"
                    >
                      View →
                    </a>
                  </div>
                )}
                {projectsLoading ? (
                  <div className="text-xs text-gray-400 animate-pulse">Loading projects…</div>
                ) : activeProjects.length === 0 ? (
                  <p className="text-xs text-gray-400">No active projects for this client.</p>
                ) : (
                  <div className="flex gap-2">
                    <select
                      value={selectedProjectId}
                      onChange={e => setSelectedProjectId(e.target.value)}
                      className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
                    >
                      <option value="">— None —</option>
                      {activeProjects.map(p => (
                        <option key={p.id} value={p.id}>{p.title}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => void handleLinkProject()}
                      disabled={linkSaving}
                      className="px-3 py-1.5 bg-[#0078D4] text-white text-xs font-semibold rounded-lg hover:bg-[#005fa3] disabled:opacity-50 transition-colors shrink-0"
                    >
                      {linkSaving ? "…" : "Save"}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <>
                {detail.linkedLeadName && (
                  <div className="mb-2 flex items-center gap-2 px-3 py-2 bg-purple-50 border border-purple-100 rounded-xl">
                    <svg className="w-3.5 h-3.5 text-purple-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                    </svg>
                    <span className="text-xs font-semibold text-purple-700 truncate flex-1">{detail.linkedLeadName}</span>
                    <a
                      href="/admin-panel/crm/leads"
                      className="text-[10px] text-purple-600 hover:underline shrink-0 font-medium"
                    >
                      View →
                    </a>
                  </div>
                )}
                <div className="flex gap-2">
                  <select
                    value={selectedLeadId}
                    onChange={e => setSelectedLeadId(e.target.value)}
                    className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
                  >
                    <option value="">— None —</option>
                    {leads.map(l => (
                      <option key={l.id} value={l.id}>
                        {l.name}{l.company ? ` (${l.company})` : ""}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => void handleLinkLead()}
                    disabled={linkSaving}
                    className="px-3 py-1.5 bg-purple-600 text-white text-xs font-semibold rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors shrink-0"
                  >
                    {linkSaving ? "…" : "Save"}
                  </button>
                </div>
              </>
            )}
            {linkError && <p className="mt-1.5 text-xs text-red-600">{linkError}</p>}
          </div>
        </div>
      ) : (
        <div className="px-6 py-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-2 text-amber-600 mb-3">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <p className="text-xs font-medium">Not linked to a client — assign above, or link to a lead below.</p>
          </div>

          {/* Lead picker */}
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Linked Lead</p>
          {detail.linkedLeadName && (
            <div className="mb-2 flex items-center gap-2 px-3 py-2 bg-purple-50 border border-purple-100 rounded-xl">
              <svg className="w-3.5 h-3.5 text-purple-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
              </svg>
              <span className="text-xs font-semibold text-purple-700 truncate flex-1">{detail.linkedLeadName}</span>
              <a
                href="/admin-panel/crm/leads"
                className="text-[10px] text-purple-600 hover:underline shrink-0 font-medium"
              >
                View →
              </a>
            </div>
          )}
          <div className="flex gap-2">
            <select
              value={selectedLeadId}
              onChange={e => setSelectedLeadId(e.target.value)}
              className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
            >
              <option value="">— None —</option>
              {leads.map(l => (
                <option key={l.id} value={l.id}>
                  {l.name}{l.company ? ` (${l.company})` : ""}
                </option>
              ))}
            </select>
            <button
              onClick={() => void handleLinkLead()}
              disabled={linkSaving}
              className="px-3 py-1.5 bg-purple-600 text-white text-xs font-semibold rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors shrink-0"
            >
              {linkSaving ? "…" : "Save"}
            </button>
          </div>
          {linkError && <p className="mt-1.5 text-xs text-red-600">{linkError}</p>}
        </div>
      )}

      {/* Next Steps */}
      <div className="px-6 py-4 shrink-0">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Next Step</p>
          {!nextStepOpen && !createdTask && detail.clientId && (
            <button
              onClick={() => setNextStepOpen(true)}
              className="text-xs text-[#0078D4] hover:text-[#005fa3] font-semibold transition-colors flex items-center gap-1"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Add task
            </button>
          )}
        </div>

        {createdTask ? (
          <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-100 rounded-xl">
            <svg className="w-4 h-4 text-green-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-green-800 truncate">{createdTask.title}</p>
              <p className="text-[10px] text-green-600">Task added to project backlog</p>
            </div>
            <button
              onClick={() => setCreatedTask(null)}
              className="text-[10px] text-green-600 hover:text-green-800 font-semibold"
            >
              + Add another
            </button>
          </div>
        ) : nextStepOpen ? (
          <form onSubmit={e => void handleCreateTask(e)} className="p-4 bg-gray-50 border border-gray-100 rounded-xl space-y-3">
            <div>
              <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block mb-1">Task title</label>
              <input
                type="text"
                value={taskTitle}
                onChange={e => setTaskTitle(e.target.value)}
                placeholder="e.g. Follow up on proposal"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-[#0A2540] focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
                required
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block mb-1">Project</label>
              {activeProjects.length === 0 ? (
                <p className="text-xs text-gray-400 italic">No active projects for this client.</p>
              ) : (
                <select
                  value={taskProjectId}
                  onChange={e => setTaskProjectId(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
                  required
                >
                  <option value="">Select project…</option>
                  {activeProjects.map(p => (
                    <option key={p.id} value={p.id}>{p.title}</option>
                  ))}
                </select>
              )}
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block mb-1">Priority</label>
                <select
                  value={taskPriority}
                  onChange={e => setTaskPriority(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
                >
                  <option value="">None</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
              <div className="flex-1">
                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block mb-1">Due date</label>
                <input
                  type="date"
                  value={taskDueDate}
                  onChange={e => setTaskDueDate(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
                />
              </div>
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block mb-1">Notes (optional)</label>
              <textarea
                value={taskNotes}
                onChange={e => setTaskNotes(e.target.value)}
                rows={2}
                placeholder="Additional context…"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-[#0A2540] focus:outline-none focus:ring-1 focus:ring-[#0078D4] resize-none"
              />
            </div>
            {taskError && <p className="text-xs text-red-600">{taskError}</p>}
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setNextStepOpen(false)}
                className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800 font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={taskSubmitting || !taskTitle.trim() || !taskProjectId}
                className="px-4 py-1.5 bg-[#0078D4] text-white text-xs font-semibold rounded-lg hover:bg-[#005fa3] disabled:opacity-50 transition-colors"
              >
                {taskSubmitting ? "Creating…" : "Create Task"}
              </button>
            </div>
          </form>
        ) : !detail.clientId ? (
          <p className="text-xs text-gray-400 italic">Link a client above to add follow-up tasks.</p>
        ) : (
          <p className="text-xs text-gray-400 italic">No follow-up tasks yet.</p>
        )}
      </div>
    </div>
  );
}

// ─── Email Settings (Rules + Setup) ──────────────────────────────────────────

interface EmailSettingsProps {
  clients: ClientOption[];
}

function EmailSettings({ clients }: EmailSettingsProps) {
  const { fetchWithAuth } = useAuth();
  const [open, setOpen] = useState(false);
  const [rules, setRules] = useState<MatchingRuleRow[]>([]);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [newRuleValue, setNewRuleValue] = useState("");
  const [newRuleUserId, setNewRuleUserId] = useState("");
  const [addingRule, setAddingRule] = useState(false);

  const loadRules = useCallback(async () => {
    setRulesLoading(true);
    setRulesError(null);
    try {
      const res = await fetchWithAuth("/api/admin/email-domain-rules");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRules(await res.json() as MatchingRuleRow[]);
    } catch (e) {
      setRulesError(e instanceof Error ? e.message : "Failed to load rules");
    } finally {
      setRulesLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    if (open && rules.length === 0 && !rulesLoading) void loadRules();
  }, [open, rules.length, rulesLoading, loadRules]);

  async function deleteRule(ruleId: number) {
    if (!confirm("Delete this matching rule?")) return;
    try {
      const res = await fetchWithAuth(`/api/admin/email-domain-rules/${ruleId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadRules();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to delete rule");
    }
  }

  async function addRule(e: React.FormEvent) {
    e.preventDefault();
    if (!newRuleValue.trim() || !newRuleUserId) return;
    setAddingRule(true);
    try {
      const res = await fetchWithAuth("/api/admin/email-domain-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: newRuleValue.trim(), userId: parseInt(newRuleUserId, 10) }),
      });
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setNewRuleValue("");
      setNewRuleUserId("");
      await loadRules();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to add rule");
    } finally {
      setAddingRule(false);
    }
  }

  return (
    <div className="border-t border-gray-100 bg-white shrink-0">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 011.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.56.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.893.149c-.425.07-.765.383-.93.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 01-1.449.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.397.165-.71.505-.781.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 01-.12-1.45l.527-.737c.25-.35.273-.806.108-1.204-.165-.397-.505-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.854-.107-1.204l-.527-.738a1.125 1.125 0 01.12-1.45l.773-.773a1.125 1.125 0 011.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span className="text-xs font-semibold text-gray-600">Email Settings</span>
        </div>
        <svg
          className={`w-3.5 h-3.5 text-gray-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-gray-50">
          {/* Matching Rules */}
          <div className="px-4 py-3">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Matching Rules</p>
            <p className="text-[11px] text-gray-500 mb-3 leading-relaxed">
              Auto-link inbound emails by exact address (e.g. <span className="font-mono">john@outlook.com</span>) or domain (e.g. <span className="font-mono">@contoso.com</span>).
            </p>
            {rulesLoading ? (
              <p className="text-xs text-gray-400 animate-pulse">Loading rules…</p>
            ) : rulesError ? (
              <p className="text-xs text-red-600">{rulesError}</p>
            ) : rules.length === 0 ? (
              <p className="text-xs text-gray-400 mb-3">No rules defined yet.</p>
            ) : (
              <div className="space-y-1.5 mb-3">
                {rules.map(row => (
                  <div key={row.rule.id} className="flex items-center gap-2 py-1.5 px-3 bg-gray-50 rounded-lg">
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                      row.rule.domain.includes("@")
                        ? "bg-purple-100 text-purple-700"
                        : "bg-blue-100 text-blue-700"
                    }`}>
                      {row.rule.domain.includes("@") ? "Addr" : "Dom"}
                    </span>
                    <span className="font-mono text-xs text-[#0A2540] flex-1 truncate">{ruleLabel(row.rule.domain)}</span>
                    <span className="text-xs text-gray-500 truncate max-w-[100px]">{row.clientName ?? row.clientEmail}</span>
                    <button
                      onClick={() => void deleteRule(row.rule.id)}
                      className="text-[10px] text-red-500 hover:text-red-700 font-medium shrink-0"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
            {/* Add rule form */}
            <form onSubmit={e => void addRule(e)} className="space-y-2">
              <input
                type="text"
                placeholder="john@outlook.com or contoso.com"
                value={newRuleValue}
                onChange={e => setNewRuleValue(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-[#0A2540] focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
              />
              <div className="flex gap-2">
                <select
                  value={newRuleUserId}
                  onChange={e => setNewRuleUserId(e.target.value)}
                  className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-[#0078D4]"
                >
                  <option value="">Select client…</option>
                  {clients.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name ?? c.email}{c.company ? ` (${c.company})` : ""}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  disabled={addingRule || !newRuleValue.trim() || !newRuleUserId}
                  className="px-3 py-1.5 bg-[#0078D4] text-white text-xs font-semibold rounded-lg hover:bg-[#005fa3] disabled:opacity-50 transition-colors"
                >
                  {addingRule ? "…" : "Add"}
                </button>
              </div>
            </form>
          </div>

          {/* Setup instructions */}
          <div className="px-4 py-3 border-t border-gray-50 bg-blue-50/60">
            <p className="text-[10px] font-bold text-[#0078D4] uppercase tracking-widest mb-1.5">Connect M365 Mailbox</p>
            <ol className="text-[11px] text-blue-800 space-y-1 list-decimal list-inside leading-relaxed">
              <li>Register an Azure AD app → grant <span className="font-mono">Mail.Read</span> permission → admin-consent.</li>
              <li>Set secrets: <span className="font-mono">GRAPH_TENANT_ID</span>, <span className="font-mono">GRAPH_CLIENT_ID</span>, <span className="font-mono">GRAPH_CLIENT_SECRET</span>, <span className="font-mono">GRAPH_MAIL_USER_ID</span>.</li>
              <li>Redeploy — Graph webhook registers automatically.</li>
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function EmailActivityPage() {
  const { fetchWithAuth } = useAuth();
  const [tab, setTab] = useState<Tab>("all");
  const [emails, setEmails] = useState<EmailRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedEmailId, setSelectedEmailId] = useState<number | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [leads, setLeads] = useState<LeadOption[]>([]);

  const LIMIT = 50;

  const loadEmails = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
      if (tab === "linked") params.set("linked", "true");
      if (tab === "unlinked") params.set("unlinked", "true");
      const res = await fetchWithAuth(`/api/admin/emails?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as EmailList;
      setEmails(data.emails);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load emails");
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, tab, page]);

  const loadClients = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/admin/clients");
      if (!res.ok) return;
      const data = await res.json() as ClientOption[];
      setClients(Array.isArray(data) ? data : []);
    } catch { /* silent */ }
  }, [fetchWithAuth]);

  const loadLeads = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/leads?limit=200");
      if (!res.ok) return;
      const data = await res.json() as { leads: LeadOption[] };
      setLeads(Array.isArray(data.leads) ? data.leads : []);
    } catch { /* silent */ }
  }, [fetchWithAuth]);

  useEffect(() => { void loadEmails(); }, [loadEmails]);
  useEffect(() => { void loadClients(); }, [loadClients]);
  useEffect(() => { void loadLeads(); }, [loadLeads]);
  useEffect(() => { setPage(1); setSelectedEmailId(null); }, [tab]);

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div className="flex flex-col h-[calc(100vh-48px)]">
      {/* Page header */}
      <div className="px-6 py-4 border-b border-gray-100 bg-white shrink-0">
        <h1 className="text-lg font-bold text-[#0A2540]">Email Activity</h1>
        <p className="text-xs text-gray-500 mt-0.5">
          M365 mailbox emails matched to clients by sender address or domain.
        </p>
      </div>

      {/* Split pane */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: email list + settings */}
        <div className="w-[340px] shrink-0 flex flex-col overflow-hidden border-r border-gray-100">
          <div className="flex-1 overflow-hidden flex flex-col">
            <EmailListPanel
              emails={emails}
              total={total}
              page={page}
              totalPages={totalPages}
              loading={loading}
              error={error}
              tab={tab}
              selectedId={selectedEmailId}
              assigningId={null}
              onTabChange={t => setTab(t)}
              onSelect={id => { setSelectedEmailId(id); setReloadKey(k => k + 1); }}
              onPageChange={p => setPage(p)}
            />
          </div>
          <EmailSettings clients={clients} />
        </div>

        {/* Right: email detail */}
        <div className="flex-1 overflow-hidden bg-white">
          <EmailDetailPanel
            emailId={selectedEmailId}
            reloadKey={reloadKey}
            clients={clients}
            leads={leads}
            onEmailReassigned={loadEmails}
          />
        </div>
      </div>
    </div>
  );
}
