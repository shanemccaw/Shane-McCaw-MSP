import { useEffect, useState, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Client {
  id: number;
  email: string;
  name: string | null;
  company: string | null;
  phone: string | null;
  sharepointSiteUrl: string | null;
  sharepointSiteId: string | null;
  address: string | null;
  addressCity: string | null;
  addressState: string | null;
  createdAt: string;
}

interface Project {
  id: number;
  title: string;
  status: "active" | "on_hold" | "completed";
  phase: string | null;
  progress: number;
  projectType: "project" | "retainer";
  startDate: string | null;
  endDate: string | null;
  updatedAt: string;
  taskCounts: { total: number; open: number };
}

interface RecentTask {
  id: number;
  title: string;
  column: "backlog" | "in_progress" | "waiting_on_customer" | "completed";
  priority: string;
  dueDate: string | null;
  projectId: number;
  projectTitle: string;
  updatedAt: string;
}

interface RecentEmail {
  id: number;
  subject: string | null;
  senderAddress: string;
  receivedAt: string;
  bodyPreview: string | null;
}

interface QuizData {
  totalScore: number;
  tier: string;
  categoryScores: Record<string, number>;
  createdAt: string;
}

interface CommandCenterData {
  client: Client;
  projects: Project[];
  recentTasks: RecentTask[];
  recentEmails: RecentEmail[];
  quiz: QuizData | null;
  m365Profile: Record<string, unknown> | null;
}

interface AzureCredential {
  id: number;
  displayName: string;
  tenantId: string;
  clientId: string;
  credentialType: "secret" | "certificate";
  keyVaultSecretName: string;
  clientUserId: number | null;
  createdAt: string;
  updatedAt: string;
  expiresOn: string | null;
}

interface AppRegRecord {
  status: "pending" | "submitted" | "verified";
  tenantId: string;
  azureClientId: string;
  keyVaultSecretName: string;
  submittedAt: string | null;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
  expiresOn: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const EXPIRY_WARN_DAYS = 60;

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function timeAgo(ts: string) {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function ExpiryBadge({ expiresOn }: { expiresOn: string | null }) {
  if (!expiresOn) return null;
  const days = daysUntil(expiresOn);
  if (days > EXPIRY_WARN_DAYS) return null;
  const expired = days <= 0;
  const critical = days > 0 && days <= 14;
  const color = expired || critical
    ? "bg-red-500/15 text-red-400 border-red-500/20"
    : "bg-amber-500/15 text-amber-400 border-amber-500/20";
  const label = expired ? "Expired" : `Expires in ${days}d`;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold border px-2 py-0.5 rounded-full ${color}`}>
      {label}
    </span>
  );
}

const labelCls = "block text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1";
const inputCls =
  "w-full border border-border rounded-lg px-3 py-2 text-sm text-[#E6EDF3] focus:outline-none focus:ring-2 focus:ring-[#0078D4]/40 bg-[#161B22]";

function StatChip({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="flex flex-col items-center px-4 py-2 bg-[#1C2128] rounded-lg border border-border min-w-[72px]">
      <span className={`text-lg font-bold leading-none ${accent ?? "text-[#E6EDF3]"}`}>{value}</span>
      <span className="text-[10px] text-muted-foreground mt-1 whitespace-nowrap">{label}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, string> = {
    active: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
    on_hold: "bg-amber-500/15 text-amber-400 border-amber-500/20",
    completed: "bg-[#30363D] text-[#7D8590] border-[#30363D]",
  };
  const label: Record<string, string> = {
    active: "Active",
    on_hold: "On Hold",
    completed: "Done",
  };
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${cfg[status] ?? "bg-[#30363D] text-[#7D8590] border-[#30363D]"}`}>
      {label[status] ?? status}
    </span>
  );
}

function TaskColumnBadge({ column }: { column: string }) {
  const cfg: Record<string, string> = {
    backlog: "text-[#7D8590]",
    in_progress: "text-[#0078D4]",
    waiting_on_customer: "text-amber-400",
    completed: "text-emerald-400",
  };
  const label: Record<string, string> = {
    backlog: "Backlog",
    in_progress: "In Progress",
    waiting_on_customer: "Waiting",
    completed: "Done",
  };
  return (
    <span className={`text-[10px] font-semibold ${cfg[column] ?? "text-[#7D8590]"}`}>
      {label[column] ?? column}
    </span>
  );
}

function PriorityDot({ priority }: { priority: string }) {
  const color =
    priority === "high" || priority === "urgent" ? "bg-red-500" :
    priority === "medium" ? "bg-amber-500" : "bg-[#484F58]";
  return <span className={`w-1.5 h-1.5 rounded-full inline-block flex-shrink-0 ${color}`} />;
}

function ScoreRing({ score, label }: { score: number; label: string }) {
  const pct = Math.min(100, Math.max(0, score));
  const r = 28;
  const circ = 2 * Math.PI * r;
  const dashArr = circ;
  const dashOff = circ - (pct / 100) * circ;
  const color = pct >= 70 ? "#10b981" : pct >= 40 ? "#f59e0b" : "#ef4444";
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative w-16 h-16">
        <svg className="w-16 h-16 -rotate-90" viewBox="0 0 70 70">
          <circle cx="35" cy="35" r={r} fill="none" stroke="#30363D" strokeWidth="6" />
          <circle
            cx="35" cy="35" r={r} fill="none"
            stroke={color} strokeWidth="6"
            strokeDasharray={dashArr} strokeDashoffset={dashOff}
            strokeLinecap="round"
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-[#E6EDF3]">
          {pct}
        </span>
      </div>
      <span className="text-[10px] text-muted-foreground text-center leading-tight">{label}</span>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ClientDetailPage() {
  const params = useParams<{ id: string }>();
  const clientId = Number(params.id);
  const [, navigate] = useLocation();
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();

  // Command center data
  const [ccData, setCcData] = useState<CommandCenterData | null>(null);
  const [ccLoading, setCcLoading] = useState(true);
  const [ccError, setCcError] = useState<string | null>(null);

  // Basic client (for edits — synced from ccData)
  const [editingInfo, setEditingInfo] = useState(false);
  const [infoForm, setInfoForm] = useState({ name: "", email: "", company: "", phone: "" });
  const [savingInfo, setSavingInfo] = useState(false);

  // Azure credential
  const [azureCred, setAzureCred] = useState<AzureCredential | null | undefined>(undefined);
  const [credLoading, setCredLoading] = useState(true);
  const [editingCred, setEditingCred] = useState(false);
  const [credForm, setCredForm] = useState({
    displayName: "", tenantId: "", appClientId: "",
    credentialType: "secret" as "secret" | "certificate",
    clientSecretValue: "", keyVaultSecretName: "", showAdvanced: false,
  });
  const [savingCred, setSavingCred] = useState(false);
  const [deletingCred, setDeletingCred] = useState(false);

  // App registration
  const [appReg, setAppReg] = useState<AppRegRecord | null | undefined>(undefined);
  const [appRegLoading, setAppRegLoading] = useState(true);
  const [verifyingAppReg, setVerifyingAppReg] = useState(false);

  // MFA
  const [mfaMethods, setMfaMethods] = useState<string[]>([]);
  const [mfaLoading, setMfaLoading] = useState(true);
  const [resettingMfa, setResettingMfa] = useState(false);
  const [showMfaConfirm, setShowMfaConfirm] = useState(false);

  // View as
  const [viewAsLoading, setViewAsLoading] = useState(false);

  // Settings panel toggle
  const [showSettings, setShowSettings] = useState(false);

  const CRM_PORTAL_BASE = `${window.location.protocol}//${window.location.host}/crm`;

  const loadCommandCenter = useCallback(async () => {
    setCcLoading(true);
    setCcError(null);
    try {
      const res = await fetchWithAuth(`/api/admin/clients/${clientId}/command-center`);
      if (!res.ok) {
        setCcError(res.status === 404 ? "Client not found." : `HTTP ${res.status}`);
        return;
      }
      const data = await res.json() as CommandCenterData;
      setCcData(data);
    } catch {
      setCcError("Failed to load client.");
    } finally {
      setCcLoading(false);
    }
  }, [fetchWithAuth, clientId]);

  const loadAzureCred = useCallback(async () => {
    setCredLoading(true);
    try {
      const res = await fetchWithAuth(`/api/admin/clients/${clientId}/azure-credential`);
      setAzureCred(res.ok ? (await res.json() as AzureCredential | null) : null);
    } finally {
      setCredLoading(false);
    }
  }, [fetchWithAuth, clientId]);

  const loadAppReg = useCallback(async () => {
    setAppRegLoading(true);
    try {
      const res = await fetchWithAuth(`/api/admin/clients/${clientId}/app-registration`);
      setAppReg(res.ok ? (await res.json() as AppRegRecord | null) : null);
    } finally {
      setAppRegLoading(false);
    }
  }, [fetchWithAuth, clientId]);

  const loadMfaMethods = useCallback(async () => {
    setMfaLoading(true);
    try {
      const res = await fetchWithAuth(`/api/admin/clients/${clientId}/mfa-status`);
      setMfaMethods(res.ok ? (await res.json() as { methods: string[] }).methods : []);
    } finally {
      setMfaLoading(false);
    }
  }, [fetchWithAuth, clientId]);

  useEffect(() => {
    if (!isNaN(clientId)) {
      void loadCommandCenter();
      void loadAzureCred();
      void loadAppReg();
      void loadMfaMethods();
    }
  }, [loadCommandCenter, loadAzureCred, loadAppReg, loadMfaMethods, clientId]);

  async function handleSaveInfo(e: React.FormEvent) {
    e.preventDefault();
    setSavingInfo(true);
    try {
      const res = await fetchWithAuth(`/api/admin/clients/${clientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(infoForm),
      });
      if (!res.ok) {
        const err = await res.json() as { error: string };
        toast({ title: "Save failed", description: err.error, variant: "destructive" });
        return;
      }
      setEditingInfo(false);
      toast({ title: "Client updated" });
      await loadCommandCenter();
    } finally {
      setSavingInfo(false);
    }
  }

  async function handleViewAs() {
    setViewAsLoading(true);
    try {
      const res = await fetchWithAuth(`/api/admin/impersonate/${clientId}`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json() as { error: string };
        toast({ title: "Cannot impersonate", description: err.error, variant: "destructive" });
        return;
      }
      const data = await res.json() as { token: string };
      window.open(`${CRM_PORTAL_BASE}/portal?impersonation_token=${encodeURIComponent(data.token)}`, "_blank", "noopener");
    } finally {
      setViewAsLoading(false);
    }
  }

  async function handleSaveCred(e: React.FormEvent) {
    e.preventDefault();
    setSavingCred(true);
    try {
      const payload: Record<string, unknown> = {
        displayName: credForm.displayName,
        tenantId: credForm.tenantId,
        clientId: credForm.appClientId,
        credentialType: credForm.credentialType,
      };
      if (credForm.clientSecretValue.trim()) payload.clientSecretValue = credForm.clientSecretValue.trim();
      if (credForm.keyVaultSecretName.trim()) payload.keyVaultSecretName = credForm.keyVaultSecretName.trim();
      const res = await fetchWithAuth(`/api/admin/clients/${clientId}/azure-credential`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json() as { error: string };
        toast({ title: "Save failed", description: err.error, variant: "destructive" });
        return;
      }
      setAzureCred(await res.json() as AzureCredential);
      setEditingCred(false);
      toast({ title: azureCred ? "Credential updated" : "Credential added" });
    } finally {
      setSavingCred(false);
    }
  }

  async function handleDeleteCred() {
    if (!confirm("Remove the Azure credential from this client?")) return;
    setDeletingCred(true);
    try {
      const res = await fetchWithAuth(`/api/admin/clients/${clientId}/azure-credential`, { method: "DELETE" });
      if (res.ok) { setAzureCred(null); toast({ title: "Credential removed" }); }
      else toast({ title: "Failed to remove credential", variant: "destructive" });
    } finally {
      setDeletingCred(false);
    }
  }

  async function handleSetAppRegStatus(status: "verified" | "submitted" | "pending") {
    setVerifyingAppReg(true);
    try {
      const res = await fetchWithAuth(`/api/admin/clients/${clientId}/app-registration`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const err = await res.json() as { error: string };
        toast({ title: "Failed", description: err.error, variant: "destructive" });
        return;
      }
      await loadAppReg();
      toast({ title: status === "verified" ? "App Registration verified" : "Status updated" });
    } finally {
      setVerifyingAppReg(false);
    }
  }

  async function handleMfaReset() {
    setResettingMfa(true);
    try {
      const res = await fetchWithAuth(`/api/admin/clients/${clientId}/mfa-reset`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json() as { error: string };
        toast({ title: "Reset failed", description: err.error, variant: "destructive" });
        return;
      }
      setShowMfaConfirm(false);
      setMfaMethods([]);
      toast({ title: "MFA reset — email sent to client" });
    } finally {
      setResettingMfa(false);
    }
  }

  // ─── Loading / Error States ─────────────────────────────────────────────────

  if (ccLoading) {
    return (
      <div className="p-6 flex items-center justify-center py-24">
        <div className="w-6 h-6 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (ccError || !ccData) {
    return (
      <div className="p-6">
        <button onClick={() => navigate("/crm/clients")} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-[#0078D4] mb-4 transition-colors">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
          All Clients
        </button>
        <p className="text-sm text-red-400">{ccError ?? "Client not found."}</p>
      </div>
    );
  }

  const { client, projects, recentTasks, recentEmails, quiz, m365Profile } = ccData;
  const activeProjects = projects.filter(p => p.status === "active");
  const openTaskCount = recentTasks.filter(t => t.column !== "completed").length;
  const quizCategories = quiz?.categoryScores ? Object.entries(quiz.categoryScores) : [];
  const categoryLabels: Record<string, string> = {
    infrastructure: "Infrastructure",
    data: "Data",
    aiLiteracy: "AI Literacy",
    changeManagement: "Change Mgmt",
    businessProcess: "Biz Process",
  };
  const openTasks = recentTasks.filter(t => t.column !== "completed");
  const m365Pain = Array.isArray((m365Profile as Record<string, unknown> | null)?.painPoints)
    ? ((m365Profile as Record<string, unknown>).painPoints as string[])
    : [];

  // Stub AI insights
  const aiInsights = quiz ? [
    {
      type: quiz.totalScore >= 70 ? "opportunity" : "risk",
      title: quiz.totalScore >= 70
        ? "Strong Copilot adoption candidate"
        : quiz.totalScore >= 40
          ? "Moderate M365 maturity — upskilling recommended"
          : "Foundational gaps require attention first",
      body: quiz.totalScore >= 70
        ? `With a score of ${quiz.totalScore} (${quiz.tier}), this client has the infrastructure and readiness for advanced Copilot deployment.`
        : quiz.totalScore >= 40
          ? `Score of ${quiz.totalScore} shows moderate readiness. Targeted training and governance improvements could accelerate adoption.`
          : `Score of ${quiz.totalScore} indicates foundational gaps. Recommend addressing core infrastructure and change management before AI rollout.`,
    },
    ...(activeProjects.length > 0 ? [{
      type: "info" as const,
      title: `${activeProjects.length} active project${activeProjects.length !== 1 ? "s" : ""} in flight`,
      body: `${openTaskCount} open task${openTaskCount !== 1 ? "s" : ""} across current engagements. ${openTaskCount > 5 ? "High task load — consider prioritising backlog." : "Task load looks healthy."}`,
    }] : []),
  ] : [
    {
      type: "info" as const,
      title: "No quiz data available",
      body: "Run the Copilot Readiness Quiz with this client to unlock AI-powered insights and opportunity scoring.",
    },
  ];

  return (
    <div className="p-6 max-w-[1400px] space-y-6">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <button
            onClick={() => navigate("/crm/clients")}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-[#0078D4] mb-2 transition-colors"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            All Clients
          </button>
          <h1 className="text-xl font-bold text-[#E6EDF3]">{client.name ?? client.email}</h1>
          <p className="text-sm text-muted-foreground">{client.email}{client.company ? ` · ${client.company}` : ""}</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <StatChip label="Active Projects" value={activeProjects.length} accent={activeProjects.length > 0 ? "text-[#0078D4]" : undefined} />
          <StatChip label="Open Tasks" value={openTaskCount} accent={openTaskCount > 5 ? "text-amber-400" : undefined} />
          {quiz && (
            <StatChip label="M365 Score" value={quiz.totalScore} accent={quiz.totalScore >= 70 ? "text-emerald-400" : quiz.totalScore >= 40 ? "text-amber-400" : "text-red-400"} />
          )}
          <button
            onClick={() => void handleViewAs()}
            disabled={viewAsLoading}
            className="flex items-center gap-1.5 text-xs font-semibold border border-border px-3 py-2 rounded-lg hover:bg-[#1C2128] disabled:opacity-50 transition-colors"
          >
            {viewAsLoading ? (
              <span className="w-3 h-3 border-2 border-[#484F58] border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            )}
            View as Client
          </button>
        </div>
      </div>

      {/* ── Three-Column Command Center ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr_280px] gap-5">

        {/* ── LEFT COLUMN: Profile + M365 Scores ─────────────────────────── */}
        <div className="space-y-4">

          {/* Profile card */}
          <div className="bg-[#161B22] border border-border rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 bg-[#1C2128] border-b border-border">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Profile</p>
              {!editingInfo && (
                <button
                  onClick={() => {
                    setInfoForm({ name: client.name ?? "", email: client.email, company: client.company ?? "", phone: client.phone ?? "" });
                    setEditingInfo(true);
                  }}
                  className="text-xs font-semibold text-[#0078D4] hover:underline"
                >
                  Edit
                </button>
              )}
            </div>

            {editingInfo ? (
              <form onSubmit={handleSaveInfo} className="p-4 space-y-3">
                {[
                  { label: "Email", key: "email", type: "email" },
                  { label: "Name", key: "name", type: "text" },
                  { label: "Company", key: "company", type: "text" },
                  { label: "Phone", key: "phone", type: "tel" },
                ].map(({ label, key, type }) => (
                  <div key={key}>
                    <label className={labelCls}>{label}</label>
                    <input
                      type={type}
                      value={infoForm[key as keyof typeof infoForm]}
                      onChange={e => setInfoForm(f => ({ ...f, [key]: e.target.value }))}
                      className={inputCls}
                    />
                  </div>
                ))}
                <div className="flex gap-2 pt-1">
                  <button type="submit" disabled={savingInfo} className="bg-[#0078D4] text-white text-xs font-semibold px-4 py-1.5 rounded-lg hover:bg-[#0078D4]/90 disabled:opacity-50 transition-colors">
                    {savingInfo ? "Saving…" : "Save"}
                  </button>
                  <button type="button" onClick={() => setEditingInfo(false)} className="border border-border text-xs px-3 py-1.5 rounded-lg hover:bg-[#1C2128] transition-colors">
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <div className="p-4 space-y-3">
                {[
                  { label: "Email", value: client.email },
                  { label: "Company", value: client.company },
                  { label: "Phone", value: client.phone },
                  { label: "Member since", value: new Date(client.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) },
                ].map(({ label, value }) => value ? (
                  <div key={label}>
                    <p className={labelCls}>{label}</p>
                    <p className="text-sm text-[#E6EDF3] break-all">{value}</p>
                  </div>
                ) : null)}

                {client.sharepointSiteUrl && (
                  <div>
                    <p className={labelCls}>SharePoint Site</p>
                    <a href={client.sharepointSiteUrl} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-[#0078D4] hover:underline truncate block">
                      {client.sharepointSiteUrl}
                    </a>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* M365 Copilot Readiness */}
          <div className="bg-[#161B22] border border-border rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 bg-[#1C2128] border-b border-border">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">M365 Readiness</p>
              {quiz && (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                  quiz.tier === "Expert" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/20" :
                  quiz.tier === "Intermediate" ? "bg-blue-500/15 text-blue-400 border-blue-500/20" :
                  "bg-amber-500/15 text-amber-400 border-amber-500/20"
                }`}>{quiz.tier}</span>
              )}
            </div>

            {quiz ? (
              <div className="p-4">
                <div className="flex items-center justify-center mb-4">
                  <ScoreRing score={quiz.totalScore} label="Overall Score" />
                </div>

                {quizCategories.length > 0 && (
                  <div className="space-y-2">
                    {quizCategories.map(([key, val]) => {
                      const pct = Math.min(100, Math.max(0, Number(val)));
                      const bar = pct >= 70 ? "bg-emerald-500" : pct >= 40 ? "bg-amber-500" : "bg-red-500";
                      return (
                        <div key={key}>
                          <div className="flex justify-between text-[10px] mb-0.5">
                            <span className="text-muted-foreground">{categoryLabels[key] ?? key}</span>
                            <span className="font-bold text-[#E6EDF3]">{pct}</span>
                          </div>
                          <div className="h-1.5 bg-[#30363D] rounded-full overflow-hidden">
                            <div className={`h-full rounded-full transition-all ${bar}`} style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <p className="text-[10px] text-muted-foreground mt-3">
                  From quiz taken {new Date(quiz.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </p>
              </div>
            ) : (
              <div className="p-4 text-center">
                <p className="text-sm text-muted-foreground">No quiz data yet.</p>
                <p className="text-xs text-muted-foreground mt-1">Run the Copilot Readiness Quiz with this client to populate scores.</p>
              </div>
            )}
          </div>

          {/* Pain Points from M365 profile */}
          {m365Pain.length > 0 && (
            <div className="bg-[#161B22] border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-[#1C2128] border-b border-border">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Pain Points</p>
              </div>
              <div className="p-4 flex flex-wrap gap-1.5">
                {m365Pain.map((p, i) => (
                  <span key={i} className="text-[10px] font-medium px-2 py-1 rounded bg-red-500/10 text-red-400 border border-red-500/20">
                    {p}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── MIDDLE COLUMN: Projects + AI Insights ───────────────────────── */}
        <div className="space-y-4">

          {/* Projects */}
          <div className="bg-[#161B22] border border-border rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 bg-[#1C2128] border-b border-border">
              <div className="flex items-center gap-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Projects</p>
                {projects.length > 0 && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#30363D] text-[#7D8590]">
                    {projects.length}
                  </span>
                )}
              </div>
              <button
                onClick={() => navigate("/crm/projects")}
                className="text-xs font-semibold text-muted-foreground hover:text-[#0078D4] transition-colors"
              >
                All Projects →
              </button>
            </div>

            {projects.length === 0 ? (
              <div className="p-5 text-center">
                <p className="text-sm text-muted-foreground">No projects yet.</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {projects.map(p => (
                  <div key={p.id} className="px-5 py-3.5 hover:bg-[#1C2128] transition-colors group">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <button
                            onClick={() => navigate(`/crm/projects/${p.id}`)}
                            className="font-semibold text-[#E6EDF3] text-sm group-hover:text-[#0078D4] transition-colors leading-tight text-left"
                          >
                            {p.title}
                          </button>
                          <StatusBadge status={p.status} />
                          {p.projectType === "retainer" && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border bg-purple-500/10 text-purple-400 border-purple-500/20">
                              Retainer
                            </span>
                          )}
                        </div>

                        {p.phase && (
                          <p className="text-xs text-muted-foreground mb-1.5">{p.phase}</p>
                        )}

                        {/* Progress bar */}
                        {p.progress > 0 && (
                          <div className="flex items-center gap-2 mb-1.5">
                            <div className="flex-1 h-1.5 bg-[#30363D] rounded-full overflow-hidden max-w-[160px]">
                              <div
                                className={`h-full rounded-full ${p.progress >= 100 ? "bg-emerald-500" : "bg-[#0078D4]"}`}
                                style={{ width: `${Math.min(100, p.progress)}%` }}
                              />
                            </div>
                            <span className="text-[10px] text-muted-foreground">{p.progress}%</span>
                          </div>
                        )}

                        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                          {p.taskCounts.open > 0 && (
                            <span>
                              <span className="font-semibold text-[#E6EDF3]">{p.taskCounts.open}</span> open task{p.taskCounts.open !== 1 ? "s" : ""}
                            </span>
                          )}
                          {p.endDate && (
                            <span>Due {new Date(p.endDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                          )}
                          <span>Updated {timeAgo(p.updatedAt)}</span>
                        </div>
                      </div>

                      <button
                        onClick={() => navigate(`/crm/projects/${p.id}`)}
                        className="opacity-0 group-hover:opacity-100 text-[10px] font-semibold text-[#0078D4] hover:underline flex-shrink-0 transition-opacity"
                      >
                        Open →
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* AI Insights */}
          <div className="bg-[#161B22] border border-border rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 bg-[#1C2128] border-b border-border">
              <div className="flex items-center gap-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">AI Insights</p>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#0078D4]/20 text-[#0078D4] border border-[#0078D4]/20">
                  Beta
                </span>
              </div>
            </div>
            <div className="divide-y divide-border">
              {aiInsights.map((insight, i) => {
                const iconCls =
                  insight.type === "opportunity" ? "text-emerald-400" :
                  insight.type === "risk" ? "text-red-400" : "text-[#0078D4]";
                const bgCls =
                  insight.type === "opportunity" ? "bg-emerald-500/10 border-emerald-500/20" :
                  insight.type === "risk" ? "bg-red-500/10 border-red-500/20" : "bg-[#0078D4]/10 border-[#0078D4]/20";
                return (
                  <div key={i} className="px-5 py-4">
                    <div className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 ${bgCls}`}>
                      <svg className={`w-4 h-4 flex-shrink-0 mt-0.5 ${iconCls}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        {insight.type === "opportunity" ? (
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                        ) : insight.type === "risk" ? (
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        ) : (
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        )}
                      </svg>
                      <div>
                        <p className={`text-xs font-bold ${iconCls}`}>{insight.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{insight.body}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── RIGHT COLUMN: Tasks + Emails ────────────────────────────────── */}
        <div className="space-y-4">

          {/* Open Tasks */}
          <div className="bg-[#161B22] border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-[#1C2128] border-b border-border">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Open Tasks{openTasks.length > 0 ? ` · ${openTasks.length}` : ""}
              </p>
            </div>

            {openTasks.length === 0 ? (
              <div className="p-4 text-center">
                <p className="text-sm text-muted-foreground">No open tasks.</p>
              </div>
            ) : (
              <div className="divide-y divide-border max-h-[320px] overflow-y-auto">
                {openTasks.map(t => (
                  <div key={t.id} className="px-4 py-3 hover:bg-[#1C2128] transition-colors group">
                    <div className="flex items-start gap-2">
                      <PriorityDot priority={t.priority} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-[#E6EDF3] leading-tight truncate">{t.title}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <TaskColumnBadge column={t.column} />
                          <span className="text-[10px] text-muted-foreground truncate">{t.projectTitle}</span>
                        </div>
                        {t.dueDate && (
                          <p className={`text-[10px] mt-0.5 ${new Date(t.dueDate) < new Date() ? "text-red-400" : "text-muted-foreground"}`}>
                            Due {new Date(t.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => navigate(`/crm/projects/${t.projectId}`)}
                        className="opacity-0 group-hover:opacity-100 text-[10px] text-[#0078D4] hover:underline flex-shrink-0 transition-opacity"
                      >
                        →
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent Emails */}
          <div className="bg-[#161B22] border border-border rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 bg-[#1C2128] border-b border-border">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Recent Emails</p>
              <button onClick={() => navigate("/email-activity")} className="text-[10px] text-muted-foreground hover:text-[#0078D4] transition-colors">
                All →
              </button>
            </div>

            {recentEmails.length === 0 ? (
              <div className="p-4 text-center">
                <p className="text-sm text-muted-foreground">No linked emails.</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {recentEmails.map(e => (
                  <div key={e.id} className="px-4 py-3 hover:bg-[#1C2128] transition-colors">
                    <p className="text-xs font-medium text-[#E6EDF3] truncate leading-tight">{e.subject ?? "(no subject)"}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{timeAgo(e.receivedAt)}</p>
                    {e.bodyPreview && (
                      <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{e.bodyPreview}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Quick Links */}
          <div className="bg-[#161B22] border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-[#1C2128] border-b border-border">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Quick Links</p>
            </div>
            <div className="p-3 grid grid-cols-2 gap-2">
              {[
                { label: "Invoices", path: "/crm/invoices" },
                { label: "Documents", path: "/crm/documents" },
                { label: "Messages", path: "/crm/messages" },
                { label: "Contracts", path: "/crm/contracts" },
                { label: "Reports", path: "/crm/reports" },
                { label: "Email Activity", path: "/email-activity" },
              ].map(({ label, path }) => (
                <button
                  key={label}
                  onClick={() => navigate(path)}
                  className="text-xs font-medium text-muted-foreground hover:text-[#0078D4] text-left px-2 py-1.5 rounded hover:bg-[#1C2128] transition-colors"
                >
                  {label} →
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Workspace Settings (expandable) ─────────────────────────────────── */}
      <div className="bg-[#161B22] border border-border rounded-xl overflow-hidden">
        <button
          onClick={() => setShowSettings(s => !s)}
          className="w-full flex items-center justify-between px-5 py-4 hover:bg-[#1C2128] transition-colors text-left"
        >
          <div>
            <p className="text-sm font-bold text-[#E6EDF3]">Workspace & Credentials</p>
            <p className="text-xs text-muted-foreground mt-0.5">MFA, Azure credentials, app registrations</p>
          </div>
          <svg
            className={`w-4 h-4 text-muted-foreground transition-transform ${showSettings ? "rotate-180" : ""}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showSettings && (
          <div className="border-t border-border divide-y divide-border">

            {/* ── MFA ─────────────────────────────────────────────────── */}
            <div>
              <div className="flex items-center justify-between px-5 py-3.5 bg-[#1C2128]">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Two-Factor Authentication</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">MFA methods enrolled for this client</p>
                </div>
                {!mfaLoading && mfaMethods.length > 0 && !showMfaConfirm && (
                  <button
                    onClick={() => setShowMfaConfirm(true)}
                    className="flex items-center gap-1.5 text-xs font-semibold text-red-400 border border-red-500/20 bg-red-500/10 px-3 py-1.5 rounded-lg hover:bg-red-500/20 transition-colors"
                  >
                    Reset MFA
                  </button>
                )}
              </div>

              {mfaLoading ? (
                <div className="p-5 flex items-center gap-2 text-sm text-[#7D8590]">
                  <div className="w-4 h-4 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
                  Loading…
                </div>
              ) : showMfaConfirm ? (
                <div className="p-5 space-y-4">
                  <div className="flex items-start gap-3 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3">
                    <svg className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div>
                      <p className="text-xs font-bold text-red-400">Confirm MFA Reset</p>
                      <p className="text-[11px] text-red-400 mt-0.5">This will remove all enrolled methods and notify the client.</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => void handleMfaReset()} disabled={resettingMfa} className="flex items-center gap-1.5 text-xs font-semibold bg-red-600 text-white px-4 py-1.5 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors">
                      {resettingMfa ? "Resetting…" : "Yes, reset MFA"}
                    </button>
                    <button onClick={() => setShowMfaConfirm(false)} disabled={resettingMfa} className="border border-border text-xs px-4 py-1.5 rounded-lg hover:bg-[#1C2128] disabled:opacity-50 transition-colors">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : mfaMethods.length > 0 ? (
                <div className="p-5 flex flex-wrap gap-2">
                  {mfaMethods.map(m => (
                    <span key={m} className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-green-500/15 text-green-400 border border-green-500/20">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
                      {{ totp: "Authenticator App", sms: "SMS", passkey: "Passkey" }[m] ?? m}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="p-5">
                  <p className="text-sm text-muted-foreground">No MFA enrolled — password-only sign-in.</p>
                </div>
              )}
            </div>

            {/* ── Azure Credential ─────────────────────────────────────── */}
            <div>
              <div className="flex items-center justify-between px-5 py-3.5 bg-[#1C2128]">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Script Runner · Azure Tenant Credential</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">App Registration for running runbooks in this client's M365 tenant</p>
                </div>
                {!editingCred && !credLoading && (
                  azureCred ? (
                    <div className="flex items-center gap-3">
                      <button onClick={() => {
                        setCredForm({ displayName: azureCred.displayName, tenantId: azureCred.tenantId, appClientId: azureCred.clientId, credentialType: azureCred.credentialType, clientSecretValue: "", keyVaultSecretName: azureCred.keyVaultSecretName, showAdvanced: azureCred.credentialType === "certificate" });
                        setEditingCred(true);
                      }} className="text-xs font-semibold text-[#0078D4] hover:underline">Edit</button>
                      <button onClick={() => void handleDeleteCred()} disabled={deletingCred} className="text-xs font-semibold text-red-500 hover:text-red-400 disabled:opacity-50">{deletingCred ? "Removing…" : "Remove"}</button>
                    </div>
                  ) : (
                    <button onClick={() => {
                      setCredForm({ displayName: client.company ?? client.name ?? "", tenantId: "", appClientId: "", credentialType: "secret", clientSecretValue: "", keyVaultSecretName: "", showAdvanced: false });
                      setEditingCred(true);
                    }} className="flex items-center gap-1.5 text-xs font-semibold bg-[#0078D4] text-white px-3 py-1.5 rounded-lg hover:bg-[#0078D4]/90 transition-colors">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                      Add Credential
                    </button>
                  )
                )}
              </div>

              {credLoading ? (
                <div className="p-5 flex items-center gap-2 text-sm text-[#7D8590]">
                  <div className="w-4 h-4 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin" />Loading…
                </div>
              ) : editingCred ? (
                <form onSubmit={handleSaveCred} className="p-5 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className={labelCls}>Display Name *</label>
                      <input required className={inputCls} value={credForm.displayName} onChange={e => setCredForm(f => ({ ...f, displayName: e.target.value }))} />
                    </div>
                    <div>
                      <label className={labelCls}>Credential Type</label>
                      <select className={inputCls} value={credForm.credentialType} onChange={e => setCredForm(f => ({ ...f, credentialType: e.target.value as "secret" | "certificate" }))}>
                        <option value="secret">Client Secret</option>
                        <option value="certificate">Certificate</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>Tenant ID *</label>
                      <input required className={inputCls} value={credForm.tenantId} onChange={e => setCredForm(f => ({ ...f, tenantId: e.target.value }))} />
                    </div>
                    <div>
                      <label className={labelCls}>Client ID (App Reg) *</label>
                      <input required className={inputCls} value={credForm.appClientId} onChange={e => setCredForm(f => ({ ...f, appClientId: e.target.value }))} />
                    </div>
                    {credForm.credentialType === "secret" && (
                      <div className="sm:col-span-2">
                        <label className={labelCls}>Client Secret</label>
                        <input type="password" autoComplete="new-password" className={inputCls} placeholder={azureCred ? "Leave blank to keep existing" : "Paste the client secret"} value={credForm.clientSecretValue} onChange={e => setCredForm(f => ({ ...f, clientSecretValue: e.target.value }))} />
                      </div>
                    )}
                    <div className="sm:col-span-2">
                      <button type="button" onClick={() => setCredForm(f => ({ ...f, showAdvanced: !f.showAdvanced }))} className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-[#0078D4] transition-colors">
                        <svg className={`w-3 h-3 transition-transform ${credForm.showAdvanced ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                        Advanced — use existing Key Vault secret name
                      </button>
                      {credForm.showAdvanced && (
                        <input className={`mt-2 ${inputCls}`} placeholder="contoso-client-secret" value={credForm.keyVaultSecretName} onChange={e => setCredForm(f => ({ ...f, keyVaultSecretName: e.target.value }))} />
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button type="submit" disabled={savingCred} className="bg-[#0078D4] text-white text-xs font-semibold px-4 py-1.5 rounded-lg hover:bg-[#0078D4]/90 disabled:opacity-50 transition-colors">{savingCred ? "Saving…" : azureCred ? "Save Changes" : "Add Credential"}</button>
                    <button type="button" onClick={() => setEditingCred(false)} className="border border-border text-xs px-4 py-1.5 rounded-lg hover:bg-[#1C2128] transition-colors">Cancel</button>
                  </div>
                </form>
              ) : azureCred ? (
                <div className="p-5">
                  {azureCred.expiresOn && daysUntil(azureCred.expiresOn) <= EXPIRY_WARN_DAYS && (
                    <div className={`flex items-start gap-3 rounded-lg border px-4 py-3 mb-4 ${daysUntil(azureCred.expiresOn) <= 14 ? "bg-red-500/10 border-red-500/20" : "bg-amber-500/10 border-amber-500/20"}`}>
                      <svg className={`w-4 h-4 flex-shrink-0 mt-0.5 ${daysUntil(azureCred.expiresOn) <= 14 ? "text-red-500" : "text-amber-500"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      <p className={`text-xs font-semibold ${daysUntil(azureCred.expiresOn) <= 14 ? "text-red-400" : "text-amber-400"}`}>
                        {daysUntil(azureCred.expiresOn) <= 0 ? "Client secret expired" : `Expires in ${daysUntil(azureCred.expiresOn)} days`} — rotate before expiry
                      </p>
                    </div>
                  )}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    <div><p className={labelCls}>Display Name</p><div className="flex items-center gap-2"><p className="text-sm text-[#E6EDF3]">{azureCred.displayName}</p><ExpiryBadge expiresOn={azureCred.expiresOn} /></div></div>
                    <div><p className={labelCls}>Type</p><p className="text-sm text-[#E6EDF3]">{azureCred.credentialType === "certificate" ? "Certificate" : "Client Secret"}</p></div>
                    <div><p className={labelCls}>Updated</p><p className="text-sm text-[#E6EDF3]">{new Date(azureCred.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p></div>
                    <div><p className={labelCls}>Tenant ID</p><p className="text-xs text-[#E6EDF3] font-mono break-all">{azureCred.tenantId}</p></div>
                    <div><p className={labelCls}>Client ID</p><p className="text-xs text-[#E6EDF3] font-mono break-all">{azureCred.clientId}</p></div>
                    <div><p className={labelCls}>Key Vault Secret</p><p className="text-xs text-[#E6EDF3] font-mono">{azureCred.keyVaultSecretName}</p></div>
                  </div>
                </div>
              ) : (
                <div className="p-5"><p className="text-sm text-muted-foreground">No Azure credential linked. Add one to enable Script Runner for this client.</p></div>
              )}
            </div>

            {/* ── App Registration ────────────────────────────────────── */}
            <div>
              <div className="px-5 py-3.5 bg-[#1C2128]">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Automation Credentials · Client App Registration</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">Submitted by the client via the portal</p>
              </div>

              {appRegLoading ? (
                <div className="p-5 flex items-center gap-2 text-sm text-[#7D8590]">
                  <div className="w-4 h-4 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin" />Loading…
                </div>
              ) : appReg ? (
                <div className="p-5 space-y-4">
                  <div className="flex items-center gap-3 flex-wrap">
                    {appReg.status === "verified" ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full bg-green-500/15 text-green-400 border border-green-500/20">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>Verified
                      </span>
                    ) : appReg.status === "submitted" ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />Submitted · Pending Verification
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full bg-red-500/15 text-red-400 border border-red-500/20">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500" />Pending
                      </span>
                    )}
                    <ExpiryBadge expiresOn={appReg.expiresOn} />
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    <div><p className={labelCls}>Tenant ID</p><p className="text-xs text-[#E6EDF3] font-mono break-all">{appReg.tenantId}</p></div>
                    <div><p className={labelCls}>Client ID</p><p className="text-xs text-[#E6EDF3] font-mono break-all">{appReg.azureClientId}</p></div>
                    <div><p className={labelCls}>Key Vault Secret</p><p className="text-xs text-[#E6EDF3] font-mono">{appReg.keyVaultSecretName}</p></div>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {appReg.status !== "verified" && (
                      <button onClick={() => void handleSetAppRegStatus("verified")} disabled={verifyingAppReg} className="flex items-center gap-1.5 text-xs font-semibold bg-green-600 text-white px-4 py-1.5 rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                        Mark as Verified
                      </button>
                    )}
                    {appReg.status === "verified" && (
                      <button onClick={() => void handleSetAppRegStatus("submitted")} disabled={verifyingAppReg} className="text-xs font-semibold text-amber-400 border border-amber-500/30 bg-amber-500/10 px-4 py-1.5 rounded-lg hover:bg-amber-500/20 disabled:opacity-50 transition-colors">
                        Revert to Submitted
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="p-5"><p className="text-sm text-muted-foreground">No App Registration submitted yet. The client submits their credentials via the portal during onboarding.</p></div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
