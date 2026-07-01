import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams, useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import ClientM365HealthTab from "./ClientM365HealthTab";

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
  onboardingWizardCompletedAt: string | null;
  appRegStatus: "pending" | "submitted" | "verified" | null;
  hasM365Profile: boolean;
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
  id?: number;
  totalScore: number;
  tier: string;
  categoryScores: Record<string, number>;
  quizType?: string;
  createdAt: string;
}

interface CommandCenterData {
  client: Client;
  projects: Project[];
  recentTasks: RecentTask[];
  recentEmails: RecentEmail[];
  quiz: QuizData | null;
  quizzes: QuizData[];
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

interface PermissionCheckResult {
  granted: string[];
  missing: string[];
  unverifiable: string[];
  checkedAt: string;
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
  permissionCheck: PermissionCheckResult | null;
}

interface NbaAction {
  id: number;
  action: string;
  rationale: string | null;
  entityType: string;
  entityId: number | null;
  entityName: string | null;
  confidence: number;
  priority: number;
  linkPath: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

interface HealthTrendCategory {
  date: string;
  score: number;
}

interface HealthTrendsResponse {
  byCategory: Record<string, HealthTrendCategory[]>;
  deltas: Array<{ category: string; latestScore: number; delta: number }>;
  insight: string | null;
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
    <div className="flex flex-col items-center px-3 py-1.5 bg-[#1C2128] rounded-lg border border-border min-w-[60px]">
      <span className={`text-base font-bold leading-none ${accent ?? "text-[#E6EDF3]"}`}>{value}</span>
      <span className="text-[10px] text-muted-foreground mt-0.5 whitespace-nowrap">{label}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, string> = {
    active: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
    on_hold: "bg-amber-500/15 text-amber-400 border-amber-500/20",
    completed: "bg-[#30363D] text-[#7D8590] border-[#30363D]",
  };
  const label: Record<string, string> = { active: "Active", on_hold: "On Hold", completed: "Done" };
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
    backlog: "Backlog", in_progress: "In Progress", waiting_on_customer: "Waiting", completed: "Done",
  };
  return <span className={`text-[10px] font-semibold ${cfg[column] ?? "text-[#7D8590]"}`}>{label[column] ?? column}</span>;
}

function PriorityDot({ priority }: { priority: string }) {
  const color =
    priority === "high" || priority === "urgent" ? "bg-red-500" :
    priority === "medium" ? "bg-amber-500" : "bg-[#484F58]";
  return <span className={`w-1.5 h-1.5 rounded-full inline-block flex-shrink-0 ${color}`} />;
}

function MaturityGauge({ label, score }: { label: string; score: number | null }) {
  const pct = score !== null ? Math.min(100, Math.max(0, score)) : null;
  const barColor = pct === null ? "bg-[#30363D]" : pct >= 70 ? "bg-emerald-500" : pct >= 40 ? "bg-amber-500" : "bg-red-500";
  const textColor = pct === null ? "text-muted-foreground" : pct >= 70 ? "text-emerald-400" : pct >= 40 ? "text-amber-400" : "text-red-400";
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-muted-foreground">{label}</span>
        <span className={`text-[10px] font-bold tabular-nums ${textColor}`}>{pct !== null ? pct : "—"}</span>
      </div>
      <div className="h-1.5 bg-[#30363D] rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: pct !== null ? `${pct}%` : "0%" }} />
      </div>
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

  const [ccData, setCcData] = useState<CommandCenterData | null>(null);
  const [ccLoading, setCcLoading] = useState(true);
  const [ccError, setCcError] = useState<string | null>(null);

  const [editingInfo, setEditingInfo] = useState(false);
  const [infoForm, setInfoForm] = useState({ name: "", email: "", company: "", phone: "" });
  const [savingInfo, setSavingInfo] = useState(false);

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

  const [appReg, setAppReg] = useState<AppRegRecord | null | undefined>(undefined);
  const [appRegLoading, setAppRegLoading] = useState(true);
  const [showPermissionsDetail, setShowPermissionsDetail] = useState(false);
  const [verifyingAppReg, setVerifyingAppReg] = useState(false);

  const [mfaMethods, setMfaMethods] = useState<string[]>([]);
  const [mfaLoading, setMfaLoading] = useState(true);
  const [resettingMfa, setResettingMfa] = useState(false);
  const [showMfaConfirm, setShowMfaConfirm] = useState(false);

  const [viewAsLoading, setViewAsLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAiInsights, setShowAiInsights] = useState(true);
  const [showAssessments, setShowAssessments] = useState(true);
  const [showDocuments, setShowDocuments] = useState(false);
  const [clientDocuments, setClientDocuments] = useState<Array<{id:number;name:string;category:string;description:string|null;fileUrl:string|null;createdAt:string}>>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docsCategory, setDocsCategory] = useState<string>("all");
  const [docForm, setDocForm] = useState({ name: "", category: "contracts", description: "", fileUrl: "" });
  const [docFormOpen, setDocFormOpen] = useState(false);
  const [savingDoc, setSavingDoc] = useState(false);

  // M365 Health
  const [showM365Health, setShowM365Health] = useState(true);

  // AI Recommendations
  const [showAiRecs, setShowAiRecs] = useState(false);
  const [clientNba, setClientNba] = useState<NbaAction[] | null>(null);
  const [clientNbaLoading, setClientNbaLoading] = useState(false);
  const [clientNbaGenerating, setClientNbaGenerating] = useState(false);
  const [healthTrends, setHealthTrends] = useState<HealthTrendsResponse | null>(null);
  const [healthTrendsLoading, setHealthTrendsLoading] = useState(false);

  // Status Reports
  const [showReports, setShowReports] = useState(false);
  const [statusReports, setStatusReports] = useState<Array<{id:number;title:string;period:string;reportStatus:string;clientStatus:string;executiveSummary:string|null;keyOutcomes:string|null;sentAt:string|null;reportDate:string|null;createdAt:string;projectId:number|null}>>([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [expandedReportId, setExpandedReportId] = useState<number|null>(null);

  // Invoices
  const [showInvoices, setShowInvoices] = useState(false);
  const [clientInvoices, setClientInvoices] = useState<Array<{id:number;invoiceNumber:string;invoiceType:string;status:string;amount:string;currency:string;dueDate:string|null;paidAt:string|null;discountAmount:string|null;couponCode:string|null;createdAt:string}>>([]);
  const [invoicesLoading, setInvoicesLoading] = useState(false);

  // M365 Intelligence dialog
  const [showM365Dialog, setShowM365Dialog] = useState(false);
  const [m365FormData, setM365FormData] = useState<Record<string, unknown>>({});
  const [m365FormLoading, setM365FormLoading] = useState(false);
  const [m365FormSaving, setM365FormSaving] = useState(false);

  // App Registration dialog
  const [showAppRegDialog, setShowAppRegDialog] = useState(false);

  const CRM_PORTAL_BASE = `${window.location.protocol}//${window.location.host}/crm`;

  const loadDocuments = useCallback(async () => {
    if (!clientId) return;
    setDocsLoading(true);
    try {
      const res = await fetchWithAuth(`/api/admin/clients/${clientId}/documents`);
      if (res.ok) {
        const data = await res.json() as typeof clientDocuments;
        setClientDocuments(data);
      }
    } finally {
      setDocsLoading(false);
    }
  }, [fetchWithAuth, clientId]);

  const loadStatusReports = useCallback(async () => {
    if (!clientId) return;
    setReportsLoading(true);
    try {
      const res = await fetchWithAuth(`/api/admin/clients/${clientId}/status-reports`);
      if (res.ok) {
        const data = await res.json() as typeof statusReports;
        setStatusReports(data);
      }
    } finally {
      setReportsLoading(false);
    }
  }, [fetchWithAuth, clientId]);

  const loadClientNba = useCallback(async () => {
    if (!clientId) return;
    setClientNbaLoading(true);
    try {
      const res = await fetchWithAuth(`/api/ai/next-best-actions?entityType=client&entityId=${clientId}`);
      if (res.ok) setClientNba(await res.json() as NbaAction[]);
    } catch { /* non-fatal */ }
    finally { setClientNbaLoading(false); }
  }, [fetchWithAuth, clientId]);

  const generateClientNba = useCallback(async () => {
    if (!clientId) return;
    setClientNbaGenerating(true);
    try {
      const res = await fetchWithAuth("/api/ai/next-best-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityType: "client", entityId: clientId }),
      });
      if (res.ok) await loadClientNba();
    } catch { /* non-fatal */ }
    finally { setClientNbaGenerating(false); }
  }, [fetchWithAuth, clientId, loadClientNba]);

  const resolveClientNba = useCallback(async (id: number) => {
    const res = await fetchWithAuth(`/api/ai/next-best-actions/${id}/resolve`, { method: "POST" });
    if (res.ok) setClientNba(prev => prev?.filter(a => a.id !== id) ?? null);
  }, [fetchWithAuth]);

  const loadHealthTrends = useCallback(async () => {
    if (!clientId) return;
    setHealthTrendsLoading(true);
    try {
      const res = await fetchWithAuth(`/api/clients/${clientId}/health/trends`);
      if (res.ok) setHealthTrends(await res.json() as HealthTrendsResponse);
    } catch { /* non-fatal */ }
    finally { setHealthTrendsLoading(false); }
  }, [fetchWithAuth, clientId]);

  // Load AI data when tab is opened
  useEffect(() => {
    if (showAiRecs && clientId) {
      void loadClientNba();
      void loadHealthTrends();
    }
  }, [showAiRecs, clientId, loadClientNba, loadHealthTrends]);

  const loadClientInvoices = useCallback(async () => {
    if (!clientId) return;
    setInvoicesLoading(true);
    try {
      const res = await fetchWithAuth(`/api/admin/invoices?clientUserId=${clientId}&sortBy=createdAt&sortDir=desc`);
      if (res.ok) {
        const all = await res.json() as Array<{id:number;clientUserId:number;invoiceNumber:string;invoiceType:string;status:string;amount:string;currency:string;dueDate:string|null;paidAt:string|null;discountAmount:string|null;couponCode:string|null;createdAt:string}>;
        setClientInvoices(all.filter(i => i.clientUserId === clientId));
      }
    } catch { /* non-fatal */ }
    finally { setInvoicesLoading(false); }
  }, [fetchWithAuth, clientId]);

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
      void loadDocuments();
      void loadStatusReports();
    }
  }, [loadCommandCenter, loadAzureCred, loadAppReg, loadMfaMethods, loadDocuments, loadStatusReports, clientId]);

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

  // ─── M365 Intelligence dialog ─────────────────────────────────────────────

  async function openM365Dialog() {
    setShowM365Dialog(true);
    setM365FormLoading(true);
    try {
      const res = await fetchWithAuth(`/api/admin/clients/${clientId}/m365-profile`);
      if (res.ok) {
        const data = await res.json() as { profile: Record<string, unknown> | null };
        setM365FormData(data.profile ?? {});
      }
    } finally {
      setM365FormLoading(false);
    }
  }

  async function saveM365Profile() {
    setM365FormSaving(true);
    try {
      const res = await fetchWithAuth(`/api/admin/clients/${clientId}/m365-profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: m365FormData }),
      });
      if (res.ok) {
        toast({ title: "M365 profile saved" });
        setShowM365Dialog(false);
      } else {
        toast({ title: "Save failed", variant: "destructive" });
      }
    } finally {
      setM365FormSaving(false);
    }
  }

  // ─── Loading / Error ──────────────────────────────────────────────────────────

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

  const { client, projects, recentTasks, recentEmails, quiz, quizzes = [], m365Profile } = ccData;
  const activeProjects = projects.filter(p => p.status === "active");
  const pastProjects = projects.filter(p => p.status === "completed");
  const openTaskCount = recentTasks.filter(t => t.column !== "completed").length;

  // ─── M365 profile header fields ───────────────────────────────────────────
  const mp = (m365Profile ?? {}) as Record<string, unknown>;
  const mpIndustry = typeof mp.industry === "string" && mp.industry ? mp.industry : null;
  const mpEmployees = typeof mp.employeeCount === "number" ? String(mp.employeeCount) :
    typeof mp.employeeCount === "string" && mp.employeeCount ? mp.employeeCount : null;
  const mpDomain = typeof mp.tenantDomain === "string" && mp.tenantDomain ? mp.tenantDomain : null;
  const mpITContact = typeof mp.itContactName === "string" && mp.itContactName ? mp.itContactName : null;
  const mpLicenses = Array.isArray(mp.licenseSKUs) ? (mp.licenseSKUs as string[]).join(", ") : null;
  const mpTenantAge = typeof mp.tenantAge === "number" ? mp.tenantAge : null;
  const mpItTeamSize = typeof mp.itTeamSize === "number" ? mp.itTeamSize : null;

  // ─── Seven M365 maturity gauges ───────────────────────────────────────────
  const cs = quiz?.categoryScores ?? {};
  const sevenGauges = [
    { label: "Governance", score: typeof cs.changeManagement === "number" ? cs.changeManagement : null },
    { label: "Security", score: typeof cs.infrastructure === "number" ? cs.infrastructure : null },
    { label: "Compliance", score: typeof cs.data === "number" ? cs.data : null },
    { label: "Copilot Readiness", score: typeof cs.aiLiteracy === "number" ? cs.aiLiteracy : null },
    { label: "Power Platform", score: typeof cs.businessProcess === "number" ? cs.businessProcess : null },
    {
      label: "External Sharing",
      score: mp.externalSharingEnabled === false ? 90 : mp.externalSharingEnabled === true ? 45 : null,
    },
    {
      label: "Shadow IT Risk",
      score: typeof mp.currentAITools === "string" && mp.currentAITools.trim() ? 55 : typeof mp.currentAITools === "string" ? 80 : null,
    },
  ];

  // ─── AI Pain Points callouts ──────────────────────────────────────────────
  const catLabels: Record<string, string> = {
    infrastructure: "Infrastructure & Security",
    data: "Data & Compliance",
    aiLiteracy: "AI Literacy",
    changeManagement: "Change Management",
    businessProcess: "Business Processes",
  };
  const csEntries = Object.entries(cs).filter(([, v]) => typeof v === "number") as [string, number][];
  const sortedCats = [...csEntries].sort(([, a], [, b]) => a - b);
  const mostCritical = sortedCats[0] ?? null;
  const highestRisk = sortedCats.find(([, v]) => v < 40) ?? null;
  const fastestWin = quiz ? sevenGauges.find(g => g.score !== null && g.score >= 60 && g.score < 80) : null;

  // ─── M365 pain points from profile ────────────────────────────────────────
  const m365Pain = Array.isArray(mp.painPoints) ? (mp.painPoints as string[]) : [];

  // ─── Kanban buckets ───────────────────────────────────────────────────────
  const nowTs = new Date();
  const todayStart = new Date(nowTs); todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart); todayEnd.setDate(todayEnd.getDate() + 1);
  const openTasks = recentTasks.filter(t => t.column !== "completed");
  const completedTasks = recentTasks.filter(t => t.column === "completed");
  const kbOverdue = openTasks.filter(t => t.dueDate && new Date(t.dueDate) < todayStart);
  const kbDueToday = openTasks.filter(t => t.dueDate && new Date(t.dueDate) >= todayStart && new Date(t.dueDate) < todayEnd);
  const kbUpcoming = openTasks.filter(t => !t.dueDate || new Date(t.dueDate) >= todayEnd);

  // ─── Overall health score + risk/opportunity ──────────────────────────────
  const allScores = sevenGauges.map(g => g.score).filter((s): s is number => s !== null);
  const healthScore = allScores.length > 0 ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length) : (quiz?.totalScore ?? null);
  const riskScores = [typeof cs.changeManagement === "number" ? cs.changeManagement : null, typeof cs.infrastructure === "number" ? cs.infrastructure : null, typeof cs.data === "number" ? cs.data : null].filter((s): s is number => s !== null);
  const overallRisk: "high" | "medium" | "low" | null = riskScores.length === 0 ? null : riskScores.some(s => s < 40) ? "high" : riskScores.some(s => s < 70) ? "medium" : "low";
  const oppScores = [typeof cs.aiLiteracy === "number" ? cs.aiLiteracy : null, typeof cs.businessProcess === "number" ? cs.businessProcess : null].filter((s): s is number => s !== null);
  const overallOpp: "high" | "medium" | "low" | null = oppScores.length === 0 ? null : oppScores.some(s => s >= 70) ? "high" : oppScores.some(s => s >= 40) ? "medium" : "low";

  // ─── Activity feed (chronological merge) ──────────────────────────────────
  interface FeedEntry { type: "email" | "task" | "project"; id: number; title: string; sub: string; ts: string; }
  const activityFeed: FeedEntry[] = [
    ...recentEmails.map(e => ({ type: "email" as const, id: e.id, title: e.subject ?? "(no subject)", sub: `from ${e.senderAddress}`, ts: e.receivedAt })),
    ...recentTasks.slice(0, 8).map(t => ({ type: "task" as const, id: t.id, title: t.title, sub: t.projectTitle, ts: t.updatedAt })),
    ...projects.slice(0, 3).map(p => ({ type: "project" as const, id: p.id, title: p.title, sub: `${p.status} · ${p.progress}% complete`, ts: p.updatedAt })),
  ].sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime()).slice(0, 12);

  // ─── AI insights ──────────────────────────────────────────────────────────
  const aiInsights = quiz ? [
    {
      type: quiz.totalScore >= 70 ? "opportunity" : "risk",
      title: quiz.totalScore >= 70 ? "Strong Copilot adoption candidate" :
        quiz.totalScore >= 40 ? "Moderate M365 maturity — upskilling recommended" :
        "Foundational gaps require attention before AI rollout",
      body: quiz.totalScore >= 70
        ? `With a score of ${quiz.totalScore} (${quiz.tier}), this client has the infrastructure and readiness for advanced Copilot deployment.`
        : quiz.totalScore >= 40
          ? `Score of ${quiz.totalScore} shows moderate readiness. Targeted training and governance improvements could accelerate adoption.`
          : `Score of ${quiz.totalScore} indicates foundational gaps. Recommend addressing core infrastructure and change management first.`,
    },
    ...(activeProjects.length > 0 ? [{
      type: "info" as const,
      title: `${activeProjects.length} active project${activeProjects.length !== 1 ? "s" : ""} in flight`,
      body: `${openTaskCount} open task${openTaskCount !== 1 ? "s" : ""} across current engagements. ${openTaskCount > 5 ? "High task load — consider prioritising backlog." : "Task load looks healthy."}`,
    }] : []),
    {
      type: "opportunity" as const,
      title: "Email intelligence",
      body: recentEmails.length > 0
        ? `${recentEmails.length} recent email${recentEmails.length !== 1 ? "s" : ""} on file. Monitor for unanswered questions and new service signals.`
        : "No linked emails yet. Ensure Exchange ingestion is active to surface email intelligence.",
    },
  ] : [
    { type: "info" as const, title: "No quiz data available", body: "Run the Copilot Readiness Quiz with this client to unlock AI-powered insights and opportunity scoring." },
    { type: "info" as const, title: "Email intelligence", body: "Link emails to this client in Email Activity to surface communication patterns and opportunities." },
  ];

  // ─── AI recommended projects (stubs) ─────────────────────────────────────
  const aiRecommended = [
    { title: "Governance Assessment", reason: "Based on low governance scores", icon: "policy" },
    { title: "Copilot Readiness Review", reason: "Client approaching readiness threshold", icon: "smart_toy" },
    { title: "External Sharing Audit", reason: "Possible shadow IT signals in M365 profile", icon: "security" },
  ];

  return (
    <div className="p-4 sm:p-6 max-w-[1440px] space-y-5">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="bg-[#161B22] border border-border rounded-xl overflow-hidden">
        <div className="px-6 pt-5 pb-4">
          <button
            onClick={() => navigate("/crm/clients")}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-[#0078D4] mb-3 transition-colors"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
            All Clients
          </button>

          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-[#E6EDF3]">{client.name ?? client.email}</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                {client.email}{client.company ? ` · ${client.company}` : ""}
              </p>

              {/* M365 profile chips */}
              {(mpIndustry || mpEmployees || mpDomain || mpITContact || mpLicenses) && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {mpIndustry && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium bg-[#1C2128] border border-border rounded px-2 py-0.5 text-[#E6EDF3]">
                      <svg className="w-2.5 h-2.5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
                      {mpIndustry}
                    </span>
                  )}
                  {mpEmployees && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium bg-[#1C2128] border border-border rounded px-2 py-0.5 text-[#E6EDF3]">
                      <svg className="w-2.5 h-2.5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                      {mpEmployees} employees
                    </span>
                  )}
                  {mpDomain && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium bg-[#1C2128] border border-border rounded px-2 py-0.5 text-[#E6EDF3]">
                      <svg className="w-2.5 h-2.5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9" /></svg>
                      {mpDomain}
                    </span>
                  )}
                  {mpITContact && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium bg-[#1C2128] border border-border rounded px-2 py-0.5 text-[#E6EDF3]">
                      <svg className="w-2.5 h-2.5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                      IT: {mpITContact}
                    </span>
                  )}
                  {mpLicenses && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium bg-[#0078D4]/10 border border-[#0078D4]/20 rounded px-2 py-0.5 text-[#0078D4]">
                      {mpLicenses}
                    </span>
                  )}
                  {mpTenantAge !== null && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium bg-[#1C2128] border border-border rounded px-2 py-0.5 text-[#E6EDF3]">
                      <svg className="w-2.5 h-2.5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                      {mpTenantAge}yr tenant
                    </span>
                  )}
                  {mpItTeamSize !== null && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium bg-[#1C2128] border border-border rounded px-2 py-0.5 text-[#E6EDF3]">
                      <svg className="w-2.5 h-2.5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                      IT: {mpItTeamSize} staff
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Stat chips */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Setup status badge */}
              {client.appRegStatus === "verified" && client.hasM365Profile ? (
                <div className="flex flex-col items-center px-3 py-1.5 bg-emerald-500/10 rounded-lg border border-emerald-500/20 min-w-[60px]">
                  <span className="text-sm font-bold leading-none text-emerald-400">✓</span>
                  <span className="text-[10px] text-emerald-400/70 mt-0.5 whitespace-nowrap">Setup Done</span>
                </div>
              ) : (
                <div
                  className="flex flex-col items-center px-3 py-1.5 bg-amber-500/10 rounded-lg border border-amber-500/20 min-w-[60px]"
                  title={!client.appRegStatus || client.appRegStatus !== "verified" ? "App Registration not verified" : "M365 profile not filled"}
                >
                  <span className="text-sm font-bold leading-none text-amber-400">!</span>
                  <span className="text-[10px] text-amber-400/70 mt-0.5 whitespace-nowrap">Pending</span>
                </div>
              )}
              <StatChip label="Active" value={activeProjects.length} accent={activeProjects.length > 0 ? "text-[#0078D4]" : undefined} />
              <StatChip label="Open Tasks" value={openTaskCount} accent={openTaskCount > 5 ? "text-amber-400" : undefined} />
              {healthScore !== null && (
                <StatChip label="Health" value={healthScore} accent={healthScore >= 70 ? "text-emerald-400" : healthScore >= 40 ? "text-amber-400" : "text-red-400"} />
              )}
              {overallRisk && (
                <div className="flex flex-col items-center px-3 py-1.5 bg-[#1C2128] rounded-lg border border-border min-w-[60px]">
                  <span className={`text-sm font-bold leading-none ${overallRisk === "high" ? "text-red-400" : overallRisk === "medium" ? "text-amber-400" : "text-emerald-400"}`}>
                    {overallRisk.charAt(0).toUpperCase() + overallRisk.slice(1)}
                  </span>
                  <span className="text-[10px] text-muted-foreground mt-0.5">Risk</span>
                </div>
              )}
              {overallOpp && (
                <div className="flex flex-col items-center px-3 py-1.5 bg-[#1C2128] rounded-lg border border-border min-w-[60px]">
                  <span className={`text-sm font-bold leading-none ${overallOpp === "high" ? "text-emerald-400" : overallOpp === "medium" ? "text-[#0078D4]" : "text-muted-foreground"}`}>
                    {overallOpp.charAt(0).toUpperCase() + overallOpp.slice(1)}
                  </span>
                  <span className="text-[10px] text-muted-foreground mt-0.5">Opportunity</span>
                </div>
              )}
              {kbOverdue.length > 0 && (
                <StatChip label="Overdue" value={kbOverdue.length} accent="text-red-400" />
              )}
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="px-6 pb-4 flex items-center gap-2 flex-wrap border-t border-border pt-3">
          <button
            onClick={() => navigate("/crm/projects")}
            className="flex items-center gap-1.5 text-xs font-semibold bg-[#0078D4] text-white px-3 py-1.5 rounded-lg hover:bg-[#0078D4]/90 transition-colors"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
            New Project
          </button>
          <button
            onClick={() => navigate("/crm/projects")}
            className="flex items-center gap-1.5 text-xs font-semibold border border-border px-3 py-1.5 rounded-lg hover:bg-[#1C2128] transition-colors text-[#E6EDF3]"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
            New Task
          </button>
          <button
            onClick={() => navigate("/email-activity")}
            className="flex items-center gap-1.5 text-xs font-semibold border border-border px-3 py-1.5 rounded-lg hover:bg-[#1C2128] transition-colors text-[#E6EDF3]"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
            Email Client
          </button>
          <button
            onClick={() => navigate(`/crm/reports`)}
            className="flex items-center gap-1.5 text-xs font-semibold border border-border px-3 py-1.5 rounded-lg hover:bg-[#1C2128] transition-colors text-[#E6EDF3]"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
            Generate Report
          </button>
          <button
            onClick={() => navigate("/email-activity")}
            className="flex items-center gap-1.5 text-xs font-semibold border border-border px-3 py-1.5 rounded-lg hover:bg-[#1C2128] transition-colors text-[#E6EDF3]"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" /></svg>
            Open Inbox
          </button>
          <button
            onClick={() => void openM365Dialog()}
            className="flex items-center gap-1.5 text-xs font-semibold border border-[#0078D4]/40 text-[#0078D4] px-3 py-1.5 rounded-lg hover:bg-[#0078D4]/10 transition-colors"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
            M365 Intelligence
          </button>
          <button
            onClick={() => setShowAppRegDialog(true)}
            className="flex items-center gap-1.5 text-xs font-semibold border border-[#0078D4]/40 text-[#0078D4] px-3 py-1.5 rounded-lg hover:bg-[#0078D4]/10 transition-colors"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
            App Registration
          </button>
          <button
            onClick={() => void handleViewAs()}
            disabled={viewAsLoading}
            className="flex items-center gap-1.5 text-xs font-semibold border border-border px-3 py-1.5 rounded-lg hover:bg-[#1C2128] disabled:opacity-50 transition-colors text-muted-foreground ml-auto"
          >
            {viewAsLoading ? <span className="w-3 h-3 border-2 border-[#484F58] border-t-transparent rounded-full animate-spin" /> : (
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
            )}
            View as Client
          </button>
        </div>
      </div>

      {/* ── M365 Health — front and center ──────────────────────────────────── */}
      <div className="bg-[#161B22] border border-[#0078D4]/40 rounded-xl overflow-hidden shadow-[0_0_0_1px_rgba(0,120,212,0.12)]">
        <button
          onClick={() => setShowM365Health(o => !o)}
          className="w-full flex items-center justify-between px-5 py-3.5 bg-[#0078D4]/8 hover:bg-[#0078D4]/12 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#0078D4]/20 flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <div className="text-left">
              <p className="text-sm font-bold text-[#E6EDF3]">M365 Environment Health</p>
              <p className="text-[11px] text-[#7D8590]">Score ring · category breakdown · 30-day alerts · trend chart</p>
            </div>
          </div>
          <svg className={`w-4 h-4 text-[#7D8590] transition-transform ${showM365Health ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {showM365Health && (
          <div className="border-t border-[#0078D4]/20 bg-[#0D1117]">
            <ClientM365HealthTab clientId={clientId} fetchWithAuth={fetchWithAuth} onOpenWizard={() => void openM365Dialog()} />
          </div>
        )}
      </div>

      {/* ── Three-Column Command Center ──────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr_260px] gap-5">

        {/* ── LEFT COLUMN: Profile + 7 Gauges + Pain Points ───────────────── */}
        <div className="space-y-4">

          {/* Profile card */}
          <div className="bg-[#161B22] border border-border rounded-xl overflow-hidden">
            <div className="flex items-center justify-between flex-wrap gap-3 px-4 py-3 bg-[#1C2128] border-b border-border">
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
                  <button type="button" onClick={() => setEditingInfo(false)} className="border border-border text-xs px-3 py-1.5 rounded-lg hover:bg-[#1C2128] transition-colors">Cancel</button>
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
                {/* Setup status */}
                <div>
                  <p className={labelCls}>Setup Status</p>
                  {client.appRegStatus === "verified" && client.hasM365Profile ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                      <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                      Setup complete
                    </span>
                  ) : (
                    <div className="flex flex-col gap-1">
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border bg-amber-500/10 text-amber-400 border-amber-500/20 w-fit">
                        <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        Pending setup
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {client.appRegStatus !== "verified" ? "App Reg not verified" : "M365 profile missing"}
                      </span>
                    </div>
                  )}
                </div>
                {client.sharepointSiteUrl && (
                  <div>
                    <p className={labelCls}>SharePoint Site</p>
                    <a href={client.sharepointSiteUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-[#0078D4] hover:underline truncate block">{client.sharepointSiteUrl}</a>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 7 M365 Maturity Gauges */}
          <div className="bg-[#161B22] border border-border rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 bg-[#1C2128] border-b border-border">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">M365 Maturity Scores</p>
              {quiz && (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                  quiz.tier === "Expert" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/20" :
                  quiz.tier === "Intermediate" ? "bg-blue-500/15 text-blue-400 border-blue-500/20" :
                  "bg-amber-500/15 text-amber-400 border-amber-500/20"
                }`}>{quiz.tier}</span>
              )}
            </div>
            <div className="p-4 space-y-3">
              {quiz ? (
                sevenGauges.map(g => <MaturityGauge key={g.label} label={g.label} score={g.score} />)
              ) : (
                <div className="text-center py-3">
                  <p className="text-sm text-muted-foreground">No assessment data.</p>
                  <p className="text-xs text-muted-foreground mt-1">Run the Copilot Readiness Quiz to populate scores.</p>
                </div>
              )}
              {quiz && (
                <div className="pt-1 border-t border-border">
                  <div className="flex justify-between text-[10px]">
                    <span className="text-muted-foreground">Overall Score</span>
                    <span className={`font-bold ${quiz.totalScore >= 70 ? "text-emerald-400" : quiz.totalScore >= 40 ? "text-amber-400" : "text-red-400"}`}>{quiz.totalScore}</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">From quiz taken {new Date(quiz.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>
                </div>
              )}
            </div>
          </div>

          {/* AI Pain Points callouts */}
          <div className="bg-[#161B22] border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-[#1C2128] border-b border-border">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">AI Pain Point Analysis</p>
            </div>
            <div className="p-4 space-y-3">
              {mostCritical && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/8 px-3 py-2">
                  <p className="text-[10px] font-bold text-red-400 uppercase tracking-wide mb-0.5">⚠ Most Critical</p>
                  <p className="text-xs font-semibold text-[#E6EDF3]">{catLabels[mostCritical[0]] ?? mostCritical[0]}</p>
                  <p className="text-[10px] text-muted-foreground">Score: {mostCritical[1]} — requires immediate attention</p>
                </div>
              )}
              {fastestWin && (
                <div className="rounded-lg border border-[#0078D4]/20 bg-[#0078D4]/8 px-3 py-2">
                  <p className="text-[10px] font-bold text-[#0078D4] uppercase tracking-wide mb-0.5">⚡ Fastest Win</p>
                  <p className="text-xs font-semibold text-[#E6EDF3]">{fastestWin.label}</p>
                  <p className="text-[10px] text-muted-foreground">Score: {fastestWin.score} — close to next tier threshold</p>
                </div>
              )}
              {highestRisk && (
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/8 px-3 py-2">
                  <p className="text-[10px] font-bold text-amber-400 uppercase tracking-wide mb-0.5">🔴 Highest Risk</p>
                  <p className="text-xs font-semibold text-[#E6EDF3]">{catLabels[highestRisk[0]] ?? highestRisk[0]}</p>
                  <p className="text-[10px] text-muted-foreground">Score: {highestRisk[1]} — below acceptable threshold</p>
                </div>
              )}
              {m365Pain.length > 0 && (
                <div className="pt-1">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Stated Pain Points</p>
                  <div className="flex flex-wrap gap-1">
                    {m365Pain.map((p, i) => (
                      <span key={i} className="text-[10px] font-medium px-2 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20">{p}</span>
                    ))}
                  </div>
                </div>
              )}
              {!mostCritical && !fastestWin && !highestRisk && m365Pain.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-2">Run a quiz to generate AI pain point analysis.</p>
              )}
            </div>
          </div>
        </div>

        {/* ── MIDDLE COLUMN: Projects + Past + AI Recommended ─────────────── */}
        <div className="space-y-4">

          {/* Active Projects */}
          <div className="bg-[#161B22] border border-border rounded-xl overflow-hidden">
            <div className="flex items-center justify-between flex-wrap gap-3 px-5 py-3.5 bg-[#1C2128] border-b border-border">
              <div className="flex items-center gap-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Active Projects</p>
                {activeProjects.length > 0 && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#0078D4]/15 text-[#0078D4]">{activeProjects.length}</span>
                )}
              </div>
              <button onClick={() => navigate("/crm/projects")} className="text-xs font-semibold text-muted-foreground hover:text-[#0078D4] transition-colors">
                All Projects →
              </button>
            </div>

            {activeProjects.length === 0 ? (
              <div className="p-5 text-center">
                <p className="text-sm text-muted-foreground">No active projects.</p>
                <button onClick={() => navigate("/crm/projects")} className="mt-2 text-xs font-semibold text-[#0078D4] hover:underline">Create a project →</button>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {activeProjects.map(p => (
                  <div key={p.id} className="px-5 py-3.5 hover:bg-[#1C2128] transition-colors group">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <button onClick={() => navigate(`/crm/projects/${p.id}`)} className="font-semibold text-[#E6EDF3] text-sm group-hover:text-[#0078D4] transition-colors leading-tight text-left">
                            {p.title}
                          </button>
                          <StatusBadge status={p.status} />
                          {p.projectType === "retainer" && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border bg-purple-500/10 text-purple-400 border-purple-500/20">Retainer</span>
                          )}
                        </div>
                        {p.phase && <p className="text-xs text-muted-foreground mb-1.5">{p.phase}</p>}
                        {p.progress > 0 && (
                          <div className="flex items-center gap-2 mb-1.5">
                            <div className="flex-1 h-1.5 bg-[#30363D] rounded-full overflow-hidden max-w-[160px]">
                              <div className={`h-full rounded-full ${p.progress >= 100 ? "bg-emerald-500" : "bg-[#0078D4]"}`} style={{ width: `${Math.min(100, p.progress)}%` }} />
                            </div>
                            <span className="text-[10px] text-muted-foreground">{p.progress}%</span>
                          </div>
                        )}
                        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                          {p.taskCounts.open > 0 && <span><span className="font-semibold text-[#E6EDF3]">{p.taskCounts.open}</span> open task{p.taskCounts.open !== 1 ? "s" : ""}</span>}
                          {p.endDate && <span>Due {new Date(p.endDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>}
                          <span>Updated {timeAgo(p.updatedAt)}</span>
                        </div>
                      </div>
                      <button onClick={() => navigate(`/crm/projects/${p.id}`)} className="opacity-0 group-hover:opacity-100 text-[10px] font-semibold text-[#0078D4] hover:underline flex-shrink-0 transition-opacity">
                        Open →
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Past Projects */}
          {pastProjects.length > 0 && (
            <div className="bg-[#161B22] border border-border rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3.5 bg-[#1C2128] border-b border-border">
                <div className="flex items-center gap-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Past Projects</p>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#30363D] text-[#7D8590]">{pastProjects.length}</span>
                </div>
              </div>
              <div className="divide-y divide-border">
                {pastProjects.slice(0, 5).map(p => (
                  <div key={p.id} className="px-5 py-3 hover:bg-[#1C2128] transition-colors group flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-muted-foreground truncate">{p.title}</p>
                      <p className="text-[10px] text-muted-foreground">Completed · {p.progress}%</p>
                    </div>
                    <button onClick={() => navigate(`/crm/projects/${p.id}`)} className="opacity-0 group-hover:opacity-100 text-[10px] text-[#0078D4] hover:underline flex-shrink-0 transition-opacity">
                      View →
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* AI Recommended Projects */}
          {aiRecommended.length > 0 && (
            <div className="bg-[#161B22] border border-border rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 bg-[#1C2128] border-b border-border flex items-center gap-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">AI Recommended Projects</p>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#0078D4]/15 text-[#0078D4] border border-[#0078D4]/20">Preview</span>
              </div>
              <div className="divide-y divide-border">
                {aiRecommended.map((rec, i) => (
                  <div key={i} className="px-5 py-3.5 hover:bg-[#1C2128] transition-colors">
                    <div className="flex items-start gap-3">
                      <div className="w-7 h-7 rounded-lg bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0">
                        <span className="material-symbols-outlined text-sm text-[#0078D4]" style={{ fontVariationSettings: "'FILL' 0" }}>{rec.icon}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-[#E6EDF3]">{rec.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{rec.reason}</p>
                      </div>
                      <button
                        onClick={() => toast({ title: "AI Recommendation", description: `Create a project: ${rec.title}` })}
                        className="text-[10px] font-semibold text-[#0078D4] hover:underline flex-shrink-0"
                      >
                        Create →
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── RIGHT COLUMN: Kanban Buckets + Inbox + Activity Feed ─────────── */}
        <div className="space-y-4">

          {/* Kanban Bucket Preview */}
          <div className="bg-[#161B22] border border-border rounded-xl overflow-hidden">
            <div className="flex items-center justify-between flex-wrap gap-3 px-4 py-3 bg-[#1C2128] border-b border-border">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Kanban Preview</p>
              <button onClick={() => navigate("/crm/projects")} className="text-[10px] text-muted-foreground hover:text-[#0078D4] transition-colors">View Board →</button>
            </div>
            <div className="divide-y divide-border">
              {/* Overdue */}
              {kbOverdue.length > 0 && (
                <div className="px-4 py-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
                    <p className="text-[10px] font-bold text-red-400 uppercase tracking-wide">Overdue · {kbOverdue.length}</p>
                  </div>
                  <div className="space-y-1.5">
                    {kbOverdue.slice(0, 3).map(t => (
                      <div key={t.id} className="flex items-start gap-2">
                        <PriorityDot priority={t.priority} />
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] font-medium text-[#E6EDF3] truncate">{t.title}</p>
                          <p className="text-[10px] text-red-400">Due {t.dueDate ? new Date(t.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Due today */}
              {kbDueToday.length > 0 && (
                <div className="px-4 py-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" />
                    <p className="text-[10px] font-bold text-amber-400 uppercase tracking-wide">Due Today · {kbDueToday.length}</p>
                  </div>
                  <div className="space-y-1.5">
                    {kbDueToday.slice(0, 3).map(t => (
                      <div key={t.id} className="flex items-start gap-2">
                        <PriorityDot priority={t.priority} />
                        <p className="text-[10px] font-medium text-[#E6EDF3] truncate flex-1">{t.title}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Upcoming */}
              <div className="px-4 py-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-2 h-2 rounded-full bg-[#0078D4] flex-shrink-0" />
                  <p className="text-[10px] font-bold text-[#0078D4] uppercase tracking-wide">Upcoming · {kbUpcoming.length}</p>
                </div>
                {kbUpcoming.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground">No upcoming tasks.</p>
                ) : (
                  <div className="space-y-1.5">
                    {kbUpcoming.slice(0, 3).map(t => (
                      <div key={t.id} className="flex items-start gap-2">
                        <PriorityDot priority={t.priority} />
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] font-medium text-[#E6EDF3] truncate">{t.title}</p>
                          <TaskColumnBadge column={t.column} />
                        </div>
                      </div>
                    ))}
                    {kbUpcoming.length > 3 && (
                      <p className="text-[10px] text-muted-foreground">+{kbUpcoming.length - 3} more</p>
                    )}
                  </div>
                )}
              </div>

              {/* Completed */}
              {completedTasks.length > 0 && (
                <div className="px-4 py-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
                    <p className="text-[10px] font-bold text-emerald-400 uppercase tracking-wide">Completed · {completedTasks.length}</p>
                  </div>
                  <div className="space-y-1.5">
                    {completedTasks.slice(0, 3).map(t => (
                      <div key={t.id} className="flex items-start gap-2">
                        <svg className="w-3 h-3 text-emerald-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                        <p className="text-[10px] font-medium text-muted-foreground truncate flex-1 line-through">{t.title}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {kbOverdue.length === 0 && kbDueToday.length === 0 && kbUpcoming.length === 0 && completedTasks.length === 0 && (
                <div className="px-4 py-5 text-center">
                  <p className="text-sm text-muted-foreground">No open tasks.</p>
                </div>
              )}
            </div>
            <div className="px-4 py-2.5 border-t border-border bg-[#1C2128]/50">
              <button onClick={() => navigate("/crm/projects")} className="text-[10px] font-semibold text-[#0078D4] hover:underline">
                + Add Task
              </button>
            </div>
          </div>

          {/* Inbox Pane */}
          <div className="bg-[#161B22] border border-border rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 bg-[#1C2128] border-b border-border">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Inbox</p>
              <button onClick={() => navigate("/email-activity")} className="text-[10px] text-muted-foreground hover:text-[#0078D4] transition-colors">All →</button>
            </div>
            {recentEmails.length === 0 ? (
              <div className="p-4 text-center">
                <p className="text-sm text-muted-foreground">No linked emails.</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {recentEmails.slice(0, 4).map(e => (
                  <div key={e.id} className="px-4 py-3 hover:bg-[#1C2128] transition-colors">
                    <p className="text-xs font-medium text-[#E6EDF3] truncate leading-tight">{e.subject ?? "(no subject)"}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{timeAgo(e.receivedAt)}</p>
                    {e.bodyPreview && <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{e.bodyPreview}</p>}
                    {/* Quick actions */}
                    <div className="flex gap-2 mt-1.5 flex-wrap">
                      {[
                        { label: "Reply", action: () => navigate("/email-activity") },
                        { label: "→ Task", action: () => toast({ title: "Convert to Task", description: "Open Email Activity to convert this email." }) },
                        { label: "Extract", action: () => toast({ title: "Extract Tasks (Preview)", description: "AI extraction coming soon." }) },
                        { label: "Opportunity", action: () => toast({ title: "Create Opportunity (Preview)", description: "Opportunity tracking coming soon." }) },
                      ].map(({ label, action }) => (
                        <button key={label} onClick={action} className="text-[10px] font-semibold text-muted-foreground hover:text-[#0078D4] transition-colors">
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Activity Feed */}
          <div className="bg-[#161B22] border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-[#1C2128] border-b border-border">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Activity Feed</p>
            </div>
            {activityFeed.length === 0 ? (
              <div className="p-4 text-center"><p className="text-sm text-muted-foreground">No activity yet.</p></div>
            ) : (
              <div className="divide-y divide-border max-h-[280px] overflow-y-auto">
                {activityFeed.map((item, i) => {
                  const iconEl = item.type === "email"
                    ? <svg className="w-3 h-3 text-[#0078D4] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                    : item.type === "task"
                      ? <svg className="w-3 h-3 text-emerald-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
                      : <svg className="w-3 h-3 text-purple-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>;
                  return (
                    <div key={`${item.type}-${item.id}-${i}`} className="px-4 py-2.5 flex items-start gap-2">
                      <div className="mt-0.5">{iconEl}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-medium text-[#E6EDF3] truncate">{item.title}</p>
                        <p className="text-[10px] text-muted-foreground">{item.sub} · {timeAgo(item.ts)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Document Hub Section ─────────────────────────────────────────────── */}
      <div className="bg-[#161B22] border border-border rounded-xl overflow-hidden">
        <button
          onClick={() => { setShowDocuments(s => { if (!s) void loadDocuments(); return !s; }); }}
          className="w-full flex items-center justify-between px-5 py-4 hover:bg-[#1C2128] transition-colors text-left"
        >
          <div className="flex items-center gap-3">
            <p className="text-sm font-bold text-[#E6EDF3]">Document Hub</p>
            {clientDocuments.length > 0 && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#0078D4]/15 text-[#0078D4] border border-[#0078D4]/20">
                {clientDocuments.length} doc{clientDocuments.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          <svg className={`w-4 h-4 text-muted-foreground transition-transform ${showDocuments ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
        </button>

        {showDocuments && (
          <div className="border-t border-border">
            {/* Category tabs */}
            <div className="flex gap-1 px-4 pt-3 pb-2 flex-wrap">
              {(["all", "contracts", "reports", "proposals", "deliverables", "assessments", "misc"] as const).map(cat => {
                const count = cat === "all" ? clientDocuments.length : clientDocuments.filter(d => d.category === cat).length;
                return (
                  <button
                    key={cat}
                    onClick={() => setDocsCategory(cat)}
                    className={`text-[10px] font-semibold px-2.5 py-1 rounded-md transition-colors ${
                      docsCategory === cat
                        ? "bg-[#0078D4]/20 text-[#0078D4]"
                        : "text-muted-foreground hover:text-[#E6EDF3] hover:bg-[#30363D]"
                    }`}
                  >
                    {cat === "all" ? "All" : cat.charAt(0).toUpperCase() + cat.slice(1)}
                    {count > 0 && <span className="ml-1 opacity-60">({count})</span>}
                  </button>
                );
              })}
            </div>

            {/* AI action buttons */}
            <div className="px-4 pb-3 flex gap-2 flex-wrap">
              {[
                { label: "Summarize All", icon: "📋" },
                { label: "Extract Action Items", icon: "✅" },
                { label: "Generate SOW Draft", icon: "📝" },
              ].map(action => (
                <button
                  key={action.label}
                  onClick={() => toast({ title: action.label, description: "AI document actions coming soon." })}
                  className="flex items-center gap-1.5 text-[10px] font-semibold border border-[#0078D4]/20 bg-[#0078D4]/10 text-[#0078D4] hover:bg-[#0078D4]/20 px-2.5 py-1 rounded-lg transition-colors"
                >
                  <span>{action.icon}</span>
                  {action.label}
                </button>
              ))}
            </div>

            {/* Doc list */}
            <div className="px-4 pb-4 space-y-2">
              {docsLoading ? (
                <p className="text-xs text-muted-foreground py-4 text-center">Loading documents…</p>
              ) : (clientDocuments.filter(d => docsCategory === "all" || d.category === docsCategory)).length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">No documents in this category yet.</p>
              ) : (
                clientDocuments
                  .filter(d => docsCategory === "all" || d.category === docsCategory)
                  .map(doc => (
                    <div key={doc.id} className="flex items-start justify-between gap-3 bg-[#1C2128] rounded-lg px-3 py-2.5">
                      <div className="flex items-start gap-2 min-w-0">
                        <svg className="w-4 h-4 text-[#0078D4] flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-[#E6EDF3] truncate">{doc.name}</p>
                          {doc.description && <p className="text-[10px] text-muted-foreground">{doc.description}</p>}
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[9px] font-bold uppercase text-[#0078D4]">{doc.category}</span>
                            <span className="text-[9px] text-muted-foreground">{new Date(doc.createdAt).toLocaleDateString()}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end">
                        <button
                          onClick={() => toast({ title: "Summarize", description: "AI document summary coming soon." })}
                          className="text-[9px] font-semibold text-[#0078D4] bg-[#0078D4]/10 border border-[#0078D4]/20 hover:bg-[#0078D4]/20 px-1.5 py-0.5 rounded transition-colors"
                          title="Summarize document"
                        >
                          Summarize
                        </button>
                        <button
                          onClick={() => toast({ title: "Extract Risks", description: "AI risk extraction coming soon." })}
                          className="text-[9px] font-semibold text-[#0078D4] bg-[#0078D4]/10 border border-[#0078D4]/20 hover:bg-[#0078D4]/20 px-1.5 py-0.5 rounded transition-colors"
                          title="Extract risks from document"
                        >
                          Risks
                        </button>
                        {doc.fileUrl && (
                          <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-[#0078D4] hover:underline">View</a>
                        )}
                        <button
                          onClick={async () => {
                            await fetchWithAuth(`/api/admin/clients/${clientId}/documents/${doc.id}`, { method: "DELETE" });
                            void loadDocuments();
                          }}
                          className="text-[10px] text-red-400 hover:text-red-300 transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))
              )}
            </div>

            {/* Add Document */}
            {docFormOpen ? (
              <div className="border-t border-border px-4 py-4">
                <p className="text-xs font-bold text-[#E6EDF3] mb-3">Add Document</p>
                <form
                  onSubmit={async e => {
                    e.preventDefault();
                    if (!docForm.name.trim()) return;
                    setSavingDoc(true);
                    try {
                      const res = await fetchWithAuth(`/api/admin/clients/${clientId}/documents`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(docForm),
                      });
                      if (res.ok) {
                        setDocForm({ name: "", category: "contracts", description: "", fileUrl: "" });
                        setDocFormOpen(false);
                        void loadDocuments();
                      }
                    } finally {
                      setSavingDoc(false);
                    }
                  }}
                  className="space-y-2"
                >
                  <input
                    required
                    placeholder="Document name"
                    value={docForm.name}
                    onChange={e => setDocForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-[#0D1117] text-[#E6EDF3] focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                  />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <select
                      value={docForm.category}
                      onChange={e => setDocForm(f => ({ ...f, category: e.target.value }))}
                      className="px-3 py-2 text-sm border border-border rounded-lg bg-[#0D1117] text-[#E6EDF3] focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                    >
                      {["contracts", "reports", "proposals", "deliverables", "assessments", "misc"].map(c => (
                        <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                      ))}
                    </select>
                    <input
                      placeholder="URL (optional)"
                      value={docForm.fileUrl}
                      onChange={e => setDocForm(f => ({ ...f, fileUrl: e.target.value }))}
                      className="px-3 py-2 text-sm border border-border rounded-lg bg-[#0D1117] text-[#E6EDF3] focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                    />
                  </div>
                  <input
                    placeholder="Description (optional)"
                    value={docForm.description}
                    onChange={e => setDocForm(f => ({ ...f, description: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-[#0D1117] text-[#E6EDF3] focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                  />
                  <div className="flex gap-2 justify-end">
                    <button type="button" onClick={() => setDocFormOpen(false)} className="text-xs text-muted-foreground hover:text-[#E6EDF3] px-3 py-1.5">Cancel</button>
                    <button type="submit" disabled={savingDoc} className="text-xs font-semibold text-white bg-[#0078D4] hover:bg-[#0078D4]/90 disabled:opacity-50 px-3 py-1.5 rounded-lg transition-colors">
                      {savingDoc ? "Saving…" : "Save Document"}
                    </button>
                  </div>
                </form>
              </div>
            ) : (
              <div className="border-t border-border px-4 py-3">
                <button
                  onClick={() => setDocFormOpen(true)}
                  className="flex items-center gap-2 text-xs font-semibold text-[#0078D4] hover:text-[#0078D4]/80 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  Add Document
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Status Reports Section ───────────────────────────────────────────── */}
      <div className="bg-[#161B22] border border-border rounded-xl overflow-hidden">
        <button
          onClick={() => { setShowReports(s => { if (!s) void loadStatusReports(); return !s; }); }}
          className="w-full flex items-center justify-between px-5 py-4 hover:bg-[#1C2128] transition-colors text-left"
        >
          <div className="flex items-center gap-3">
            <p className="text-sm font-bold text-[#E6EDF3]">Status Reports</p>
            {statusReports.length > 0 && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#0078D4]/15 text-[#0078D4] border border-[#0078D4]/20">
                {statusReports.length} report{statusReports.length !== 1 ? "s" : ""}
              </span>
            )}
            {statusReports.some(r => r.clientStatus === "has_questions") && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/20">
                Has questions
              </span>
            )}
          </div>
          <svg className={`w-4 h-4 text-muted-foreground transition-transform ${showReports ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
        </button>

        {showReports && (
          <div className="border-t border-border">
            {/* AI action bar */}
            <div className="px-4 pt-3 pb-2 flex gap-2 flex-wrap">
              {[
                { label: "Summarize Reports", icon: "📋" },
                { label: "Extract Action Items", icon: "✅" },
              ].map(action => (
                <button
                  key={action.label}
                  onClick={() => toast({ title: action.label, description: "AI report actions coming soon." })}
                  className="flex items-center gap-1.5 text-[10px] font-semibold border border-[#0078D4]/20 bg-[#0078D4]/10 text-[#0078D4] hover:bg-[#0078D4]/20 px-2.5 py-1 rounded-lg transition-colors"
                >
                  <span>{action.icon}</span>
                  {action.label}
                </button>
              ))}
              <button
                onClick={() => navigate(`/crm/status-reports?client=${clientId}`)}
                className="flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground hover:text-[#E6EDF3] transition-colors ml-auto"
              >
                View all in Reports →
              </button>
            </div>

            {/* Report timeline */}
            {reportsLoading ? (
              <p className="text-xs text-muted-foreground px-4 py-4 text-center">Loading reports…</p>
            ) : statusReports.length === 0 ? (
              <div className="px-4 py-6 text-center">
                <p className="text-xs text-muted-foreground">No status reports yet for this client.</p>
                <button
                  onClick={() => navigate("/crm/status-reports")}
                  className="mt-2 text-xs font-semibold text-[#0078D4] hover:underline"
                >
                  Create first report →
                </button>
              </div>
            ) : (
              <div className="px-4 pb-4 space-y-2">
                {statusReports.map(report => {
                  const clientStatusCls: Record<string, string> = {
                    pending: "text-[#7D8590] bg-[#30363D] border-[#30363D]",
                    accepted: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
                    has_questions: "text-amber-400 bg-amber-500/10 border-amber-500/20",
                  };
                  const clientStatusLabel: Record<string, string> = {
                    pending: "Awaiting",
                    accepted: "Accepted",
                    has_questions: "Has Questions",
                  };
                  const periodLabel: Record<string, string> = {
                    weekly: "Weekly", monthly: "Monthly",
                    executive_summary: "Executive", other: "Report",
                  };
                  const isExpanded = expandedReportId === report.id;
                  const dateStr = report.sentAt
                    ? new Date(report.sentAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                    : new Date(report.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                  return (
                    <div key={report.id} className="bg-[#1C2128] rounded-lg overflow-hidden border border-border">
                      <button
                        onClick={() => setExpandedReportId(isExpanded ? null : report.id)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-[#30363D]/40 transition-colors"
                      >
                        <svg className="w-4 h-4 text-[#0078D4] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-xs font-semibold text-[#E6EDF3] truncate">{report.title}</p>
                            <span className="text-[9px] font-bold uppercase text-muted-foreground">{periodLabel[report.period] ?? report.period}</span>
                          </div>
                          <p className="text-[10px] text-muted-foreground">{dateStr}</p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {report.reportStatus === "sent" && (
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${clientStatusCls[report.clientStatus] ?? "text-muted-foreground"}`}>
                              {clientStatusLabel[report.clientStatus] ?? report.clientStatus}
                            </span>
                          )}
                          {report.reportStatus === "draft" && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border border-[#30363D] text-[#7D8590]">Draft</span>
                          )}
                          <svg className={`w-3 h-3 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </button>
                      {isExpanded && (
                        <div className="px-3 pb-3 border-t border-border space-y-2 pt-2">
                          {report.executiveSummary && (
                            <div>
                              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Executive Summary</p>
                              <p className="text-xs text-[#E6EDF3]/80 leading-relaxed line-clamp-4">{report.executiveSummary}</p>
                            </div>
                          )}
                          {report.keyOutcomes && (
                            <div>
                              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Key Outcomes</p>
                              <p className="text-xs text-[#E6EDF3]/80 leading-relaxed line-clamp-3">{report.keyOutcomes}</p>
                            </div>
                          )}
                          <div className="flex gap-2 pt-1 flex-wrap">
                            <button
                              onClick={() => toast({ title: "AI Summary", description: "AI report summary coming soon." })}
                              className="text-[10px] font-semibold text-[#0078D4] bg-[#0078D4]/10 border border-[#0078D4]/20 hover:bg-[#0078D4]/20 px-2 py-1 rounded-lg transition-colors"
                            >
                              AI Summary
                            </button>
                            <button
                              onClick={() => toast({ title: "Extract Action Items", description: "Action item extraction coming soon." })}
                              className="text-[10px] font-semibold text-[#0078D4] bg-[#0078D4]/10 border border-[#0078D4]/20 hover:bg-[#0078D4]/20 px-2 py-1 rounded-lg transition-colors"
                            >
                              Extract Action Items
                            </button>
                            <button
                              onClick={() => navigate(`/crm/status-reports?id=${report.id}`)}
                              className="text-[10px] font-semibold text-muted-foreground hover:text-[#E6EDF3] transition-colors"
                            >
                              Open Full Report →
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Invoices Section ─────────────────────────────────────────────────── */}
      <div className="bg-[#161B22] border border-border rounded-xl overflow-hidden">
        <button
          onClick={() => { setShowInvoices(s => { if (!s) void loadClientInvoices(); return !s; }); }}
          className="w-full flex items-center justify-between px-5 py-4 hover:bg-[#1C2128] transition-colors text-left"
        >
          <div className="flex items-center gap-3">
            <p className="text-sm font-bold text-[#E6EDF3]">Invoices</p>
            {clientInvoices.length > 0 && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#0078D4]/15 text-[#0078D4] border border-[#0078D4]/20">
                {clientInvoices.length}
              </span>
            )}
            {clientInvoices.some(i => i.status === "overdue") && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 border border-red-500/20">
                Overdue
              </span>
            )}
          </div>
          <svg className={`w-4 h-4 text-muted-foreground transition-transform ${showInvoices ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
        </button>

        {showInvoices && (
          <div className="border-t border-border">
            <div className="px-4 pt-3 pb-2 flex gap-2 flex-wrap">
              <button
                onClick={() => navigate(`/crm/invoices?client=${clientId}`)}
                className="flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground hover:text-[#E6EDF3] transition-colors ml-auto"
              >
                View all invoices →
              </button>
            </div>
            {invoicesLoading ? (
              <p className="text-xs text-muted-foreground px-4 py-4 text-center">Loading invoices…</p>
            ) : clientInvoices.length === 0 ? (
              <div className="px-4 py-6 text-center">
                <p className="text-xs text-muted-foreground">No invoices for this client yet.</p>
                <button
                  onClick={() => navigate("/crm/invoices")}
                  className="mt-2 text-xs font-semibold text-[#0078D4] hover:underline"
                >
                  Create invoice →
                </button>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {clientInvoices.map(inv => {
                  const statusCls: Record<string, string> = {
                    paid: "bg-emerald-500/15 text-emerald-400",
                    due: "bg-amber-500/15 text-amber-400",
                    overdue: "bg-red-500/15 text-red-400",
                    draft: "bg-[#30363D]/50 text-[#7D8590]",
                  };
                  const typeCls = inv.invoiceType === "retainer" ? "text-purple-400" : "text-[#0078D4]";
                  const fmtAmt = (a: string) => new Intl.NumberFormat("en-US", { style: "currency", currency: (inv.currency ?? "usd").toUpperCase() }).format(parseFloat(a));
                  return (
                    <div
                      key={inv.id}
                      onClick={() => navigate(`/crm/invoices/${inv.id}`)}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-[#1C2128] transition-colors cursor-pointer"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-[#E6EDF3]">{inv.invoiceNumber}</p>
                          <span className={`text-[10px] font-bold ${typeCls}`}>{inv.invoiceType === "retainer" ? "Retainer" : "Instant"}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {inv.dueDate ? `Due ${new Date(inv.dueDate).toLocaleDateString()}` : new Date(inv.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-bold text-[#E6EDF3]">{fmtAmt(inv.amount)}</p>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${statusCls[inv.status] ?? "bg-[#30363D]/50 text-[#7D8590]"}`}>
                          {inv.status.charAt(0).toUpperCase() + inv.status.slice(1)}
                        </span>
                      </div>
                      <svg className="w-4 h-4 text-muted-foreground flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Assessments Section ──────────────────────────────────────────────── */}
      <div className="bg-[#161B22] border border-border rounded-xl overflow-hidden">
        <button
          onClick={() => setShowAssessments(s => !s)}
          className="w-full flex items-center justify-between px-5 py-4 hover:bg-[#1C2128] transition-colors text-left"
        >
          <div className="flex items-center gap-3">
            <p className="text-sm font-bold text-[#E6EDF3]">Assessments</p>
            {quizzes.length > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">{quizzes.length} completed</span>}
          </div>
          <svg className={`w-4 h-4 text-muted-foreground transition-transform ${showAssessments ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
        </button>

        {showAssessments && (
          <div className="border-t border-border">
            {quizzes.length > 0 ? (
              <div className="p-5 space-y-5">
                {/* Latest quiz record only — explicit sort so render order is independent of API contract */}
                {(() => {
                  const sortedQuizzes = [...quizzes].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
                  const q = sortedQuizzes[0];
                  const qcs = (q.categoryScores ?? {}) as Record<string, number>;
                  const qEntries = Object.entries(qcs).filter(([, v]) => typeof v === "number") as [string, number][];
                  const sortedQ = [...qEntries].sort(([, a], [, b]) => a - b);
                  const qCritical = sortedQ[0] ?? null;
                  const quizLabel = q.quizType === "tenant_health" ? "Tenant Health Assessment" :
                    q.quizType === "governance" ? "Governance Maturity Assessment" :
                    "Copilot Readiness Assessment";
                  return (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      {/* Score card */}
                      <div className="bg-[#1C2128] border border-border rounded-xl p-5">
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <p className="text-sm font-bold text-[#E6EDF3]">{quizLabel}</p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">Completed {new Date(q.createdAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>
                          </div>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                            q.tier === "Expert" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/20" :
                            q.tier === "Intermediate" ? "bg-blue-500/15 text-blue-400 border-blue-500/20" :
                            "bg-amber-500/15 text-amber-400 border-amber-500/20"
                          }`}>{q.tier}</span>
                        </div>

                        <div className="flex items-center gap-3 mb-4">
                          <div className="text-3xl font-black text-[#E6EDF3]">{q.totalScore}</div>
                          <div>
                            <p className="text-xs text-muted-foreground">Overall Score</p>
                            <p className="text-xs text-muted-foreground">out of 100</p>
                          </div>
                        </div>

                        {qEntries.length > 0 && (
                          <div className="space-y-2 mb-4">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Category Scores</p>
                            {qEntries.map(([key, val]) => {
                              const pct = Math.min(100, Math.max(0, val));
                              const bar = pct >= 70 ? "bg-emerald-500" : pct >= 40 ? "bg-amber-500" : "bg-red-500";
                              return (
                                <div key={key}>
                                  <div className="flex justify-between text-[10px] mb-0.5">
                                    <span className="text-muted-foreground">{catLabels[key] ?? key}</span>
                                    <span className="font-bold text-[#E6EDF3]">{pct}</span>
                                  </div>
                                  <div className="h-1 bg-[#30363D] rounded-full overflow-hidden">
                                    <div className={`h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        <div className="mb-4">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Recommended Actions</p>
                          <ul className="space-y-1">
                            {q.totalScore < 40 && <li className="text-xs text-[#E6EDF3]">• Establish baseline M365 governance policies</li>}
                            {q.totalScore < 60 && <li className="text-xs text-[#E6EDF3]">• Enroll users in Copilot readiness training</li>}
                            {q.totalScore < 80 && <li className="text-xs text-[#E6EDF3]">• Conduct a data classification review</li>}
                            <li className="text-xs text-[#E6EDF3]">• Schedule a quarterly maturity review</li>
                          </ul>
                        </div>

                        <button
                          onClick={() => navigate("/m365-scripts")}
                          className="flex items-center gap-2 text-xs font-semibold bg-[#0078D4] text-white px-3 py-1.5 rounded-lg hover:bg-[#0078D4]/90 transition-colors"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                          Trigger Workflow
                        </button>
                      </div>

                      {/* Summary + profile card */}
                      <div className="bg-[#1C2128] border border-border rounded-xl p-5 space-y-4">
                        <p className="text-sm font-bold text-[#E6EDF3]">Assessment Summary</p>
                        <div className="text-xs text-[#E6EDF3]/80 leading-relaxed space-y-2">
                          <p>
                            {q.tier === "Expert"
                              ? "This client has excellent M365 maturity across key pillars. Focus on advanced Copilot scenarios and expanding AI governance practices."
                              : q.tier === "Intermediate"
                                ? "Moderate maturity with clear growth opportunities. Targeted training and governance improvements will unlock the next tier."
                                : "Foundational work is needed across multiple areas. A structured roadmap should prioritise governance, security, and user adoption before AI features."}
                          </p>
                          <p>
                            {qCritical
                              ? `The area most needing attention is ${catLabels[qCritical[0]] ?? qCritical[0]} with a score of ${qCritical[1]}.`
                              : "All assessed areas are performing at or above threshold."}
                          </p>
                        </div>

                        <div className="space-y-2">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Tenant M365 Profile</p>
                          {[
                            { label: "Industry", value: mpIndustry },
                            { label: "Employees", value: mpEmployees },
                            { label: "Tenant Domain", value: mpDomain },
                            { label: "IT Contact", value: mpITContact },
                            { label: "License SKUs", value: mpLicenses },
                          ].filter(({ value }) => value).map(({ label, value }) => (
                            <div key={label} className="flex justify-between text-[10px]">
                              <span className="text-muted-foreground">{label}</span>
                              <span className="text-[#E6EDF3] font-medium max-w-[140px] text-right truncate">{value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Score History chart — one line per category, ≥2 assessments */}
                {quizzes.length >= 2 && (() => {
                  const CHART_COLORS = ["#0078D4", "#00B4D8", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];
                  const chronoQuizzes = [...quizzes].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
                  const allCatKeys = Array.from(new Set(chronoQuizzes.flatMap(q => Object.keys((q.categoryScores ?? {}) as Record<string, number>))));
                  const chartData = chronoQuizzes.map(q => {
                    const cs = (q.categoryScores ?? {}) as Record<string, number>;
                    const entry: Record<string, string | number> = {
                      date: new Date(q.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
                    };
                    allCatKeys.forEach(k => { entry[k] = typeof cs[k] === "number" ? cs[k] : 0; });
                    return entry;
                  });
                  return (
                    <div className="bg-[#1C2128] border border-border rounded-xl p-5">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-4">Score History</p>
                      <ResponsiveContainer width="100%" height={200}>
                        <LineChart data={chartData} margin={{ top: 4, right: 16, left: -20, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#30363D" />
                          <XAxis dataKey="date" tick={{ fill: "#7D8590", fontSize: 10 }} axisLine={false} tickLine={false} />
                          <YAxis domain={[0, 100]} tick={{ fill: "#7D8590", fontSize: 10 }} axisLine={false} tickLine={false} />
                          <Tooltip
                            contentStyle={{ backgroundColor: "#1C2128", border: "1px solid #30363D", borderRadius: "8px", fontSize: 12, color: "#E6EDF3" }}
                            cursor={{ stroke: "#30363D" }}
                            formatter={(value, name) => [value, catLabels[name as string] ?? name]}
                          />
                          <Legend wrapperStyle={{ fontSize: 10, paddingTop: 8 }} formatter={(value) => catLabels[value] ?? value} />
                          {allCatKeys.map((key, idx) => (
                            <Line key={key} type="monotone" dataKey={key} name={key} stroke={CHART_COLORS[idx % CHART_COLORS.length]} strokeWidth={2} dot={{ r: 3, strokeWidth: 0 }} activeDot={{ r: 5 }} />
                          ))}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  );
                })()}
              </div>
            ) : (
              <div className="p-8 text-center">
                <p className="text-sm text-muted-foreground">No assessments completed yet.</p>
                <p className="text-xs text-muted-foreground mt-1">Run the Copilot Readiness Quiz with this client to populate assessment data.</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── AI Insights (preview) ────────────────────────────────────────────── */}
      <div className="bg-[#161B22] border border-border rounded-xl overflow-hidden">
        <button
          onClick={() => setShowAiInsights(s => !s)}
          className="w-full flex items-center justify-between px-5 py-4 hover:bg-[#1C2128] transition-colors text-left"
        >
          <div className="flex items-center gap-3">
            <p className="text-sm font-bold text-[#E6EDF3]">AI Insights</p>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#0078D4]/15 text-[#0078D4] border border-[#0078D4]/20">Preview</span>
          </div>
          <svg className={`w-4 h-4 text-muted-foreground transition-transform ${showAiInsights ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
        </button>

        {showAiInsights && (
          <div className="border-t border-border">
            <div className="px-5 py-3 bg-[#0078D4]/5 border-b border-border">
              <p className="text-xs text-[#7D8590]">
                AI Insights are computed from assessment scores, project data, and email activity. Connect a live AI backend to replace stubs with real-time analysis.
              </p>
            </div>
            <div className="p-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Client Health Summary */}
              <div className="bg-[#1C2128] border border-border rounded-xl p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Client Health Summary</p>
                {aiInsights.map((insight, i) => (
                  <div key={i} className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 mb-2 last:mb-0 ${
                    insight.type === "opportunity" ? "bg-emerald-500/8 border-emerald-500/20" :
                    insight.type === "risk" ? "bg-red-500/8 border-red-500/20" : "bg-[#0078D4]/8 border-[#0078D4]/20"
                  }`}>
                    <div>
                      <p className={`text-[10px] font-bold ${insight.type === "opportunity" ? "text-emerald-400" : insight.type === "risk" ? "text-red-400" : "text-[#0078D4]"}`}>{insight.title}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">{insight.body}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Top Risks */}
              <div className="bg-[#1C2128] border border-border rounded-xl p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Top Risks</p>
                <div className="space-y-2">
                  {quiz && sortedCats.slice(0, 3).map(([key, val]) => (
                    <div key={key} className="flex items-center justify-between text-xs">
                      <span className="text-[#E6EDF3]">{catLabels[key] ?? key}</span>
                      <span className={`font-bold tabular-nums ${val < 40 ? "text-red-400" : val < 70 ? "text-amber-400" : "text-emerald-400"}`}>{val}</span>
                    </div>
                  ))}
                  {!quiz && <p className="text-xs text-muted-foreground">Run an assessment to see risks.</p>}
                  {kbOverdue.length > 0 && (
                    <div className="flex items-center justify-between text-xs pt-1 border-t border-border">
                      <span className="text-[#E6EDF3]">Overdue tasks</span>
                      <span className="font-bold text-red-400">{kbOverdue.length}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Top Opportunities + Next Best Actions + Email Intelligence */}
              <div className="bg-[#1C2128] border border-border rounded-xl p-4 space-y-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Top Opportunities</p>
                  <div className="space-y-1.5">
                    {aiRecommended.map((r, i) => (
                      <div key={i} className="text-xs text-[#E6EDF3] flex items-start gap-1.5">
                        <span className="text-emerald-400 flex-shrink-0">↑</span>
                        {r.title}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="border-t border-border pt-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Next Best Actions</p>
                  <div className="space-y-1.5 text-xs text-muted-foreground">
                    {quiz && quiz.totalScore < 70 && <p>→ Schedule a governance review session</p>}
                    {recentEmails.length === 0 && <p>→ Activate email ingestion for this domain</p>}
                    {openTaskCount === 0 && <p>→ Create initial project tasks</p>}
                    <p>→ Book a quarterly business review</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Workspace & Credentials (expandable) ────────────────────────────── */}
      <div className="bg-[#161B22] border border-border rounded-xl overflow-hidden">
        <button
          onClick={() => setShowSettings(s => !s)}
          className="w-full flex items-center justify-between px-5 py-4 hover:bg-[#1C2128] transition-colors text-left"
        >
          <div>
            <p className="text-sm font-bold text-[#E6EDF3]">Workspace & Credentials</p>
            <p className="text-xs text-muted-foreground mt-0.5">MFA, Azure credentials, app registrations</p>
          </div>
          <svg className={`w-4 h-4 text-muted-foreground transition-transform ${showSettings ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
        </button>

        {showSettings && (
          <div className="border-t border-border divide-y divide-border">

            {/* MFA */}
            <div>
              <div className="flex items-center justify-between px-5 py-3.5 bg-[#1C2128]">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Two-Factor Authentication</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">MFA methods enrolled for this client</p>
                </div>
                {!mfaLoading && mfaMethods.length > 0 && !showMfaConfirm && (
                  <button onClick={() => setShowMfaConfirm(true)} className="flex items-center gap-1.5 text-xs font-semibold text-red-400 border border-red-500/20 bg-red-500/10 px-3 py-1.5 rounded-lg hover:bg-red-500/20 transition-colors">
                    Reset MFA
                  </button>
                )}
              </div>
              {mfaLoading ? (
                <div className="p-5 flex items-center gap-2 text-sm text-[#7D8590]"><div className="w-4 h-4 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin" />Loading…</div>
              ) : showMfaConfirm ? (
                <div className="p-5 space-y-4">
                  <div className="flex items-start gap-3 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3">
                    <svg className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    <div>
                      <p className="text-xs font-bold text-red-400">Confirm MFA Reset</p>
                      <p className="text-[11px] text-red-400 mt-0.5">This will remove all enrolled methods and notify the client.</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => void handleMfaReset()} disabled={resettingMfa} className="flex items-center gap-1.5 text-xs font-semibold bg-red-600 text-white px-4 py-1.5 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors">{resettingMfa ? "Resetting…" : "Yes, reset MFA"}</button>
                    <button onClick={() => setShowMfaConfirm(false)} disabled={resettingMfa} className="border border-border text-xs px-4 py-1.5 rounded-lg hover:bg-[#1C2128] disabled:opacity-50 transition-colors">Cancel</button>
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
                <div className="p-5"><p className="text-sm text-muted-foreground">No MFA enrolled — password-only sign-in.</p></div>
              )}
            </div>

            {/* Azure App Registration / Script Runner Credentials — unified panel */}
            <div>
              {/* Panel header */}
              <div className="flex items-center justify-between px-5 py-3.5 bg-[#1C2128]">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Azure App Registration / Script Runner Credentials</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Admin credential for runbooks · client-submitted app registration</p>
                </div>
                {!editingCred && !credLoading && (
                  azureCred ? (
                    <div className="flex items-center gap-3">
                      <button onClick={() => { setCredForm({ displayName: azureCred.displayName, tenantId: azureCred.tenantId, appClientId: azureCred.clientId, credentialType: azureCred.credentialType, clientSecretValue: "", keyVaultSecretName: azureCred.keyVaultSecretName, showAdvanced: azureCred.credentialType === "certificate" }); setEditingCred(true); }} className="text-xs font-semibold text-[#0078D4] hover:underline">Edit</button>
                      <button onClick={() => void handleDeleteCred()} disabled={deletingCred} className="text-xs font-semibold text-red-500 hover:text-red-400 disabled:opacity-50">{deletingCred ? "Removing…" : "Remove"}</button>
                    </div>
                  ) : (
                    <button onClick={() => { setCredForm({ displayName: client.company ?? client.name ?? "", tenantId: "", appClientId: "", credentialType: "secret", clientSecretValue: "", keyVaultSecretName: "", showAdvanced: false }); setEditingCred(true); }} className="flex items-center gap-1.5 text-xs font-semibold bg-[#0078D4] text-white px-3 py-1.5 rounded-lg hover:bg-[#0078D4]/90 transition-colors">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                      Add Credential
                    </button>
                  )
                )}
              </div>

              {credLoading || appRegLoading ? (
                <div className="px-5 py-4 flex items-center gap-2 text-sm text-[#7D8590]"><div className="w-4 h-4 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin" />Loading…</div>
              ) : editingCred ? (
                <form onSubmit={handleSaveCred} className="px-5 pb-5 pt-4 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div><label className={labelCls}>Display Name *</label><input required className={inputCls} value={credForm.displayName} onChange={e => setCredForm(f => ({ ...f, displayName: e.target.value }))} /></div>
                    <div><label className={labelCls}>Credential Type</label><select className={inputCls} value={credForm.credentialType} onChange={e => setCredForm(f => ({ ...f, credentialType: e.target.value as "secret" | "certificate" }))}><option value="secret">Client Secret</option><option value="certificate">Certificate</option></select></div>
                    <div><label className={labelCls}>Tenant ID *</label><input required className={inputCls} value={credForm.tenantId} onChange={e => setCredForm(f => ({ ...f, tenantId: e.target.value }))} /></div>
                    <div><label className={labelCls}>Client ID (App Reg) *</label><input required className={inputCls} value={credForm.appClientId} onChange={e => setCredForm(f => ({ ...f, appClientId: e.target.value }))} /></div>
                    {credForm.credentialType === "secret" && (
                      <div className="sm:col-span-2"><label className={labelCls}>Client Secret</label><input type="password" autoComplete="new-password" className={inputCls} placeholder={azureCred ? "Leave blank to keep existing" : "Paste the client secret"} value={credForm.clientSecretValue} onChange={e => setCredForm(f => ({ ...f, clientSecretValue: e.target.value }))} /></div>
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
                <div className="px-5 py-4">
                  {azureCred.expiresOn && daysUntil(azureCred.expiresOn) <= EXPIRY_WARN_DAYS && (
                    <div className={`flex items-start gap-3 rounded-lg border px-4 py-3 mb-4 ${daysUntil(azureCred.expiresOn) <= 14 ? "bg-red-500/10 border-red-500/20" : "bg-amber-500/10 border-amber-500/20"}`}>
                      <svg className={`w-4 h-4 flex-shrink-0 mt-0.5 ${daysUntil(azureCred.expiresOn) <= 14 ? "text-red-500" : "text-amber-500"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      <p className={`text-xs font-semibold ${daysUntil(azureCred.expiresOn) <= 14 ? "text-red-400" : "text-amber-400"}`}>{daysUntil(azureCred.expiresOn) <= 0 ? "Client secret expired" : `Expires in ${daysUntil(azureCred.expiresOn)} days`} — rotate before expiry</p>
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
                  {/* appReg verification status — inline when a portal submission also exists */}
                  {appReg && (
                    <div className="mt-4 pt-4 border-t border-border space-y-3">
                      <div className="flex items-center gap-3 flex-wrap">
                        {appReg.status === "verified" ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full bg-green-500/15 text-green-400 border border-green-500/20"><svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>Portal App Reg · Verified</span>
                        ) : appReg.status === "submitted" ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20"><span className="w-1.5 h-1.5 rounded-full bg-amber-500" />Portal App Reg · Pending Verification</span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full bg-red-500/15 text-red-400 border border-red-500/20"><span className="w-1.5 h-1.5 rounded-full bg-red-500" />Portal App Reg · Pending</span>
                        )}
                        <ExpiryBadge expiresOn={appReg.expiresOn} />
                        {appReg.permissionCheck ? (
                          appReg.permissionCheck.missing.length === 0 ? (
                            <span className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full bg-green-500/15 text-green-400 border border-green-500/20"><svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>All permissions granted</span>
                          ) : (
                            <button onClick={() => setShowPermissionsDetail(v => !v)} className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20 hover:bg-amber-500/25 transition-colors"><svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>Missing {appReg.permissionCheck.missing.length} permission{appReg.permissionCheck.missing.length !== 1 ? "s" : ""}</button>
                          )
                        ) : (
                          <span className="text-xs text-muted-foreground italic">Permissions not yet checked</span>
                        )}
                        {appReg.status !== "verified" && (
                          <button onClick={() => void handleSetAppRegStatus("verified")} disabled={verifyingAppReg} className="flex items-center gap-1.5 text-xs font-semibold bg-green-600 text-white px-3 py-1 rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors">
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                            Mark Verified
                          </button>
                        )}
                        {appReg.status === "verified" && (
                          <button onClick={() => void handleSetAppRegStatus("submitted")} disabled={verifyingAppReg} className="text-xs font-semibold text-amber-400 border border-amber-500/30 bg-amber-500/10 px-3 py-1 rounded-lg hover:bg-amber-500/20 disabled:opacity-50 transition-colors">Revert</button>
                        )}
                      </div>
                      {showPermissionsDetail && appReg.permissionCheck && appReg.permissionCheck.missing.length > 0 && (
                        <div className="pt-3 border-t border-border">
                          <p className="text-[10px] font-semibold text-[#484F58] uppercase tracking-widest mb-2">Missing Permissions</p>
                          <div className="space-y-1.5">
                            {appReg.permissionCheck.missing.map(perm => (
                              <div key={perm} className="flex items-center gap-2 text-xs">
                                <svg className="w-3 h-3 text-red-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                                <code className="text-red-300 font-mono">{perm}</code>
                              </div>
                            ))}
                          </div>
                          <p className="text-[10px] text-muted-foreground mt-2">Checked {new Date(appReg.permissionCheck.checkedAt).toLocaleString()}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : appReg ? (
                /* No admin credential yet, but client has submitted an app registration */
                <div className="px-5 py-4 space-y-4">
                  <div className="space-y-3">
                    <div className="flex items-center gap-3 flex-wrap">
                      {appReg.status === "verified" ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full bg-green-500/15 text-green-400 border border-green-500/20"><svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>Verified</span>
                      ) : appReg.status === "submitted" ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20"><span className="w-1.5 h-1.5 rounded-full bg-amber-500" />Submitted · Pending Verification</span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full bg-red-500/15 text-red-400 border border-red-500/20"><span className="w-1.5 h-1.5 rounded-full bg-red-500" />Pending</span>
                      )}
                      <ExpiryBadge expiresOn={appReg.expiresOn} />
                      {appReg.permissionCheck ? (
                        appReg.permissionCheck.missing.length === 0 ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full bg-green-500/15 text-green-400 border border-green-500/20"><svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>All permissions granted</span>
                        ) : (
                          <button onClick={() => setShowPermissionsDetail(v => !v)} className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20 hover:bg-amber-500/25 transition-colors"><svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>Missing {appReg.permissionCheck.missing.length} permission{appReg.permissionCheck.missing.length !== 1 ? "s" : ""}</button>
                        )
                      ) : (
                        <span className="text-xs text-muted-foreground italic">Permissions not yet checked</span>
                      )}
                    </div>
                    {showPermissionsDetail && appReg.permissionCheck && appReg.permissionCheck.missing.length > 0 && (
                      <div className="pt-3 border-t border-border">
                        <p className="text-[10px] font-semibold text-[#484F58] uppercase tracking-widest mb-2">Missing Permissions</p>
                        <div className="space-y-1.5">
                          {appReg.permissionCheck.missing.map(perm => (
                            <div key={perm} className="flex items-center gap-2 text-xs">
                              <svg className="w-3 h-3 text-red-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                              <code className="text-red-300 font-mono">{perm}</code>
                            </div>
                          ))}
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-2">Checked {new Date(appReg.permissionCheck.checkedAt).toLocaleString()}</p>
                      </div>
                    )}
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
                      <button onClick={() => void handleSetAppRegStatus("submitted")} disabled={verifyingAppReg} className="text-xs font-semibold text-amber-400 border border-amber-500/30 bg-amber-500/10 px-4 py-1.5 rounded-lg hover:bg-amber-500/20 disabled:opacity-50 transition-colors">Revert to Submitted</button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="px-5 py-4"><p className="text-sm text-muted-foreground">No credential linked. Add an admin credential or the client can submit their App Registration via the portal.</p></div>
              )}
            </div>
          </div>
        )}

        {/* ── AI Recommendations ── */}
        <div className="border border-[#30363D] rounded-xl overflow-hidden">
          <button
            onClick={() => setShowAiRecs(o => !o)}
            className="w-full flex items-center justify-between px-5 py-4 bg-[#161B22] hover:bg-[#1C2128] transition-colors"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-[#0078D4]/15 flex items-center justify-center flex-shrink-0">
                <svg className="w-3.5 h-3.5 text-[#58A6FF]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </div>
              <div className="text-left">
                <p className="text-sm font-bold text-[#E6EDF3]">AI Recommendations</p>
                <p className="text-[10px] text-[#7D8590]">Next best actions + health trend for this client</p>
              </div>
              {clientNba && clientNba.length > 0 && (
                <span className="text-xs font-bold bg-[#0078D4]/15 text-[#0078D4] border border-[#0078D4]/20 px-2 py-0.5 rounded-full">{clientNba.length}</span>
              )}
            </div>
            <svg className={`w-4 h-4 text-[#7D8590] transition-transform ${showAiRecs ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showAiRecs && (
            <div className="border-t border-[#30363D] bg-[#0D1117] p-5 space-y-5">
              {/* Next Best Actions */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-xs font-bold text-[#7D8590] uppercase tracking-widest">Next Best Actions</h4>
                  <button onClick={() => void generateClientNba()} disabled={clientNbaGenerating} className="flex items-center gap-1.5 text-xs font-semibold text-[#58A6FF] hover:text-[#0078D4] disabled:opacity-50 transition-colors">
                    {clientNbaGenerating ? <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg> : null}
                    {clientNbaGenerating ? "Generating…" : clientNba ? "Refresh" : "Generate"}
                  </button>
                </div>
                {clientNbaLoading ? (
                  <div className="space-y-2">{[0,1,2].map(i => <div key={i} className="h-14 bg-[#161B22] rounded-xl animate-pulse" />)}</div>
                ) : !clientNba || clientNba.length === 0 ? (
                  <p className="text-xs text-[#7D8590] py-3">No actions yet — click Generate to have Claude analyse this client's activity and surface the most impactful next steps.</p>
                ) : (
                  <div className="space-y-2">
                    {clientNba.map(action => (
                      <div key={action.id} className="bg-[#161B22] border border-[#30363D] rounded-xl px-4 py-3 flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-1">
                            <span className="text-[9px] font-bold text-[#0078D4] bg-[#0078D4]/10 px-1.5 py-0.5 rounded">{action.confidence}% confidence</span>
                          </div>
                          <p className="text-xs text-[#E6EDF3] leading-relaxed">{action.action}</p>
                          {action.rationale && <p className="text-[10px] text-[#7D8590] mt-0.5">{action.rationale}</p>}
                        </div>
                        <button onClick={() => void resolveClientNba(action.id)} className="text-[10px] font-semibold text-[#484F58] hover:text-emerald-400 border border-[#30363D] hover:border-emerald-500/30 px-2 py-0.5 rounded-lg transition-colors whitespace-nowrap flex-shrink-0">✓ Done</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Health Trends — always render all 8 categories */}
              {healthTrends !== null && (
                <div>
                  <h4 className="text-xs font-bold text-[#7D8590] uppercase tracking-widest mb-1">M365 Health Trends — Last 90 Days</h4>
                  {healthTrends.insight && (
                    <p className="text-[10px] text-[#7D8590] italic mb-3 leading-relaxed">{healthTrends.insight}</p>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    {(["governance", "security", "compliance", "copilot", "identity", "collaboration", "productivity", "data"] as const).map(cat => {
                      const points = healthTrends.byCategory[cat] ?? [];
                      const delta = healthTrends.deltas.find(d => d.category === cat);
                      const latest = delta?.latestScore ?? points[points.length - 1]?.score;
                      const change = delta?.delta ?? 0;
                      const hasData = points.length > 0;
                      const color = !hasData ? "#484F58" : (latest ?? 0) >= 70 ? "#10B981" : (latest ?? 0) >= 40 ? "#F59E0B" : "#EF4444";
                      const catLabel = cat.charAt(0).toUpperCase() + cat.slice(1);
                      return (
                        <div key={cat} className="bg-[#0D1117] border border-[#30363D] rounded-lg p-2.5">
                          <div className="flex items-center justify-between mb-1">
                            <p className="text-[10px] font-semibold text-[#7D8590]">{catLabel}</p>
                            <div className="flex items-center gap-1">
                              {hasData ? (
                                <>
                                  <span className="text-xs font-bold" style={{ color }}>{latest ?? "—"}</span>
                                  {change !== 0 && (
                                    <span className={`text-[9px] font-semibold ${change > 0 ? "text-emerald-400" : "text-red-400"}`}>
                                      {change > 0 ? "↑" : "↓"}{Math.abs(change)}
                                    </span>
                                  )}
                                </>
                              ) : (
                                <span className="text-[9px] text-[#484F58]">No data</span>
                              )}
                            </div>
                          </div>
                          {hasData ? (
                            <LineChart width={140} height={44} data={points}>
                              <Line type="monotone" dataKey="score" stroke={color} strokeWidth={1.5} dot={false} activeDot={{ r: 3 }} />
                              <XAxis dataKey="date" hide />
                              <YAxis domain={[0, 100]} hide />
                              <Tooltip
                                contentStyle={{ fontSize: 10, borderRadius: 6, border: "1px solid #30363D", background: "#1C2128", color: "#E6EDF3", padding: "4px 8px" }}
                                content={({ active, payload, label }) => {
                                  if (!active || !payload?.length) return null;
                                  const score = payload[0].value as number;
                                  const idx = points.findIndex(p => p.date === label);
                                  const prev = idx > 0 ? points[idx - 1].score : null;
                                  const ptDelta = prev !== null ? score - prev : null;
                                  return (
                                    <div style={{ fontSize: 10, borderRadius: 6, border: "1px solid #30363D", background: "#1C2128", color: "#E6EDF3", padding: "4px 8px" }}>
                                      <div className="font-semibold">{label}</div>
                                      <div>{catLabel}: <span className="font-bold">{score}</span></div>
                                      {ptDelta !== null && (
                                        <div style={{ color: ptDelta > 0 ? "#10B981" : ptDelta < 0 ? "#EF4444" : "#7D8590" }}>
                                          {ptDelta > 0 ? "↑" : ptDelta < 0 ? "↓" : "→"} {Math.abs(ptDelta)} vs prev
                                        </div>
                                      )}
                                    </div>
                                  );
                                }}
                              />
                            </LineChart>
                          ) : (
                            <div className="h-[44px] flex items-center justify-center">
                              <p className="text-[9px] text-[#484F58] text-center">Snapshot data will appear here once recorded</p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {healthTrendsLoading && <div className="h-40 bg-[#161B22] rounded-xl animate-pulse" />}
            </div>
          )}
        </div>
      </div>

      {/* ── M365 Intelligence Dialog ─────────────────────────────────────────── */}
      {showM365Dialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setShowM365Dialog(false)}>
          <div className="absolute inset-0 bg-black/60" />
          <div
            className="relative bg-[#161B22] border border-border rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-[#161B22] z-10">
              <div>
                <p className="text-sm font-bold text-[#E6EDF3]">M365 Intelligence Profile</p>
                <p className="text-xs text-muted-foreground mt-0.5">{client.company ?? client.name}</p>
              </div>
              <button onClick={() => setShowM365Dialog(false)} className="text-muted-foreground hover:text-[#E6EDF3] transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            {m365FormLoading ? (
              <div className="flex items-center justify-center py-16">
                <div className="w-6 h-6 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <div className="p-6 space-y-6">

                {/* ── 1. Organization Overview ──────────────────────────────── */}
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-3">Organization Overview</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    <div>
                      <label className={labelCls}>Org Name</label>
                      <input className={inputCls} value={String(m365FormData.orgName ?? "")} onChange={e => setM365FormData(f => ({ ...f, orgName: e.target.value }))} />
                    </div>
                    <div>
                      <label className={labelCls}>Industry</label>
                      <input className={inputCls} value={String(m365FormData.industry ?? "")} onChange={e => setM365FormData(f => ({ ...f, industry: e.target.value }))} />
                    </div>
                    <div>
                      <label className={labelCls}>Tenant Domain</label>
                      <input className={inputCls} placeholder="contoso.onmicrosoft.com" value={String(m365FormData.tenantDomain ?? "")} onChange={e => setM365FormData(f => ({ ...f, tenantDomain: e.target.value }))} />
                    </div>
                    <div>
                      <label className={labelCls}>Employee Count</label>
                      <input type="number" min="1" className={inputCls} value={String(m365FormData.employeeCount ?? "")} onChange={e => setM365FormData(f => ({ ...f, employeeCount: e.target.value ? Number(e.target.value) : undefined }))} />
                    </div>
                    <div>
                      <label className={labelCls}>M365 Licensed Users</label>
                      <input type="number" min="0" className={inputCls} value={String(m365FormData.licensedUserCount ?? "")} onChange={e => setM365FormData(f => ({ ...f, licensedUserCount: e.target.value ? Number(e.target.value) : undefined }))} />
                    </div>
                    <div>
                      <label className={labelCls}>IT Contact Name</label>
                      <input className={inputCls} value={String(m365FormData.itContactName ?? "")} onChange={e => setM365FormData(f => ({ ...f, itContactName: e.target.value }))} />
                    </div>
                    <div>
                      <label className={labelCls}>IT Contact Email</label>
                      <input type="email" className={inputCls} value={String(m365FormData.itContactEmail ?? "")} onChange={e => setM365FormData(f => ({ ...f, itContactEmail: e.target.value }))} />
                    </div>
                    <div className="flex items-center gap-2 pt-5">
                      <input type="checkbox" checked={Boolean(m365FormData.isMicrosoftPartner)} onChange={e => setM365FormData(f => ({ ...f, isMicrosoftPartner: e.target.checked }))} className="w-3.5 h-3.5 rounded accent-[#0078D4]" />
                      <span className="text-xs text-[#E6EDF3]">Microsoft Partner</span>
                    </div>
                  </div>
                </div>

                {/* ── 2. M365 Licensing & Usage ─────────────────────────────── */}
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-3">M365 Licensing & Usage</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-3">
                    <div className="sm:col-span-2">
                      <label className={labelCls}>License SKUs (comma-separated)</label>
                      <input className={inputCls} placeholder="E3, E5, Business Premium" value={Array.isArray(m365FormData.licenseSKUs) ? (m365FormData.licenseSKUs as string[]).join(", ") : String(m365FormData.licenseSKUs ?? "")} onChange={e => setM365FormData(f => ({ ...f, licenseSKUs: e.target.value.split(",").map(s => s.trim()).filter(Boolean) }))} />
                    </div>
                    <div>
                      <label className={labelCls}>Active User %</label>
                      <input type="number" min="0" max="100" className={inputCls} placeholder="e.g. 80" value={String(m365FormData.activeUserPercent ?? "")} onChange={e => setM365FormData(f => ({ ...f, activeUserPercent: e.target.value ? Number(e.target.value) : undefined }))} />
                    </div>
                  </div>
                  <p className="text-[10px] font-medium text-muted-foreground mb-2">Active Workloads</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {([
                      { key: "allUsersLicensed", label: "All Users Licensed" },
                      { key: "usesExchange", label: "Exchange Online" },
                      { key: "usesTeams", label: "Microsoft Teams" },
                      { key: "usesSharePoint", label: "SharePoint Online" },
                      { key: "usesOneDrive", label: "OneDrive for Business" },
                      { key: "usesYammer", label: "Viva Engage / Yammer" },
                    ] as { key: string; label: string }[]).map(({ key, label }) => (
                      <label key={key} className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={Boolean(m365FormData[key])} onChange={e => setM365FormData(f => ({ ...f, [key]: e.target.checked }))} className="w-3.5 h-3.5 rounded accent-[#0078D4]" />
                        <span className="text-xs text-[#E6EDF3]">{label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* ── 3. Environment Structure ──────────────────────────────── */}
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-3">Environment Structure</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-3">
                    <div>
                      <label className={labelCls}>SharePoint Site Count</label>
                      <input type="number" min="0" className={inputCls} value={String(m365FormData.sharepointSiteCount ?? "")} onChange={e => setM365FormData(f => ({ ...f, sharepointSiteCount: e.target.value ? Number(e.target.value) : undefined }))} />
                    </div>
                    <div>
                      <label className={labelCls}>Teams Count</label>
                      <input type="number" min="0" className={inputCls} value={String(m365FormData.teamCount ?? "")} onChange={e => setM365FormData(f => ({ ...f, teamCount: e.target.value ? Number(e.target.value) : undefined }))} />
                    </div>
                    <div>
                      <label className={labelCls}>Security Groups</label>
                      <input type="number" min="0" className={inputCls} value={String(m365FormData.securityGroupCount ?? "")} onChange={e => setM365FormData(f => ({ ...f, securityGroupCount: e.target.value ? Number(e.target.value) : undefined }))} />
                    </div>
                    <div>
                      <label className={labelCls}>Auth Method</label>
                      <input className={inputCls} placeholder="e.g. Cloud-only, Hybrid" value={String(m365FormData.authMethod ?? "")} onChange={e => setM365FormData(f => ({ ...f, authMethod: e.target.value }))} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {([
                      { key: "externalSharingEnabled", label: "External Sharing On" },
                      { key: "guestUsersPresent", label: "Guest Users Present" },
                      { key: "isHybrid", label: "Hybrid Environment" },
                      { key: "hasOnPremExchange", label: "On-Prem Exchange" },
                      { key: "usesAADConnect", label: "Entra Connect / AADC" },
                    ] as { key: string; label: string }[]).map(({ key, label }) => (
                      <label key={key} className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={Boolean(m365FormData[key])} onChange={e => setM365FormData(f => ({ ...f, [key]: e.target.checked }))} className="w-3.5 h-3.5 rounded accent-[#0078D4]" />
                        <span className="text-xs text-[#E6EDF3]">{label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* ── 4. Security & Compliance ──────────────────────────────── */}
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-3">Security & Compliance</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {([
                      { key: "mfaEnforced", label: "MFA Enforced" },
                      { key: "conditionalAccessEnabled", label: "Conditional Access" },
                      { key: "hasAADP1orP2", label: "Entra ID P1 / P2" },
                      { key: "intuneEnabled", label: "Intune Enabled" },
                      { key: "hasDefender", label: "Defender for M365" },
                      { key: "hasDLP", label: "DLP Policies" },
                      { key: "sensitivityLabelsConfigured", label: "Sensitivity Labels" },
                      { key: "hasRetentionPolicies", label: "Retention Policies" },
                      { key: "usesComplianceCenter", label: "Compliance Center" },
                      { key: "hasInsiderRisk", label: "Insider Risk Mgmt" },
                    ] as { key: string; label: string }[]).map(({ key, label }) => (
                      <label key={key} className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={Boolean(m365FormData[key])} onChange={e => setM365FormData(f => ({ ...f, [key]: e.target.checked }))} className="w-3.5 h-3.5 rounded accent-[#0078D4]" />
                        <span className="text-xs text-[#E6EDF3]">{label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* ── 5. Copilot Readiness ──────────────────────────────────── */}
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-3">Copilot Readiness</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    <div>
                      <label className={labelCls}>Readiness Score (1–5)</label>
                      <select className={inputCls} value={String(m365FormData.copilotReadinessScore ?? "")} onChange={e => setM365FormData(f => ({ ...f, copilotReadinessScore: e.target.value ? Number(e.target.value) : undefined }))}>
                        <option value="">— select —</option>
                        <option value="1">1 — Not Ready</option>
                        <option value="2">2 — Early Stage</option>
                        <option value="3">3 — Developing</option>
                        <option value="4">4 — Nearly Ready</option>
                        <option value="5">5 — Ready</option>
                      </select>
                    </div>
                    <div className="flex items-center gap-2 pt-5">
                      <input type="checkbox" checked={Boolean(m365FormData.hasCopilotLicenses)} onChange={e => setM365FormData(f => ({ ...f, hasCopilotLicenses: e.target.checked }))} className="w-3.5 h-3.5 rounded accent-[#0078D4]" />
                      <span className="text-xs text-[#E6EDF3]">Has Copilot Licenses</span>
                    </div>
                    {Boolean(m365FormData.hasCopilotLicenses) && (
                      <div>
                        <label className={labelCls}>Copilot License Count</label>
                        <input type="number" min="0" className={inputCls} value={String(m365FormData.copilotLicenseCount ?? "")} onChange={e => setM365FormData(f => ({ ...f, copilotLicenseCount: e.target.value ? Number(e.target.value) : undefined }))} />
                      </div>
                    )}
                    <div className="sm:col-span-3">
                      <label className={labelCls}>Primary Copilot Use Case</label>
                      <input className={inputCls} placeholder="e.g. Document summarisation, meeting transcripts" value={String(m365FormData.copilotUseCase ?? "")} onChange={e => setM365FormData(f => ({ ...f, copilotUseCase: e.target.value }))} />
                    </div>
                    <div className="sm:col-span-3">
                      <label className={labelCls}>Current AI Tools in Use</label>
                      <input className={inputCls} placeholder="e.g. ChatGPT, GitHub Copilot" value={String(m365FormData.currentAITools ?? "")} onChange={e => setM365FormData(f => ({ ...f, currentAITools: e.target.value }))} />
                    </div>
                    <div className="sm:col-span-2">
                      <label className={labelCls}>Data Governance Concerns</label>
                      <input className={inputCls} placeholder="e.g. Oversharing, unclassified data" value={String(m365FormData.dataGovernanceConcerns ?? "")} onChange={e => setM365FormData(f => ({ ...f, dataGovernanceConcerns: e.target.value }))} />
                    </div>
                    <div>
                      <label className={labelCls}>Primary Blocker</label>
                      <input className={inputCls} placeholder="e.g. No DLP, Hybrid complexity" value={String(m365FormData.copilotBlockedBy ?? "")} onChange={e => setM365FormData(f => ({ ...f, copilotBlockedBy: e.target.value }))} />
                    </div>
                  </div>
                </div>

                {/* ── 6. Engagement Metadata ────────────────────────────────── */}
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-3">Engagement Metadata</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    <div>
                      <label className={labelCls}>Engagement Start Date</label>
                      <input type="date" className={inputCls} value={String(m365FormData.engagementStartDate ?? "")} onChange={e => setM365FormData(f => ({ ...f, engagementStartDate: e.target.value }))} />
                    </div>
                    <div>
                      <label className={labelCls}>Estimated Duration</label>
                      <input className={inputCls} placeholder="e.g. 3 months" value={String(m365FormData.estimatedDuration ?? "")} onChange={e => setM365FormData(f => ({ ...f, estimatedDuration: e.target.value }))} />
                    </div>
                    <div>
                      <label className={labelCls}>Engagement Type</label>
                      <input className={inputCls} placeholder="e.g. Assessment, Retainer" value={String(m365FormData.engagementType ?? "")} onChange={e => setM365FormData(f => ({ ...f, engagementType: e.target.value }))} />
                    </div>
                    <div>
                      <label className={labelCls}>Budget Range</label>
                      <input className={inputCls} placeholder="e.g. $10k–$25k" value={String(m365FormData.budgetRange ?? "")} onChange={e => setM365FormData(f => ({ ...f, budgetRange: e.target.value }))} />
                    </div>
                    <div>
                      <label className={labelCls}>Decision Maker Name</label>
                      <input className={inputCls} value={String(m365FormData.decisionMakerName ?? "")} onChange={e => setM365FormData(f => ({ ...f, decisionMakerName: e.target.value }))} />
                    </div>
                    <div>
                      <label className={labelCls}>Decision Maker Email</label>
                      <input type="email" className={inputCls} value={String(m365FormData.decisionMakerEmail ?? "")} onChange={e => setM365FormData(f => ({ ...f, decisionMakerEmail: e.target.value }))} />
                    </div>
                    <div>
                      <label className={labelCls}>Referral Source</label>
                      <input className={inputCls} placeholder="e.g. LinkedIn, Word of mouth" value={String(m365FormData.referralSource ?? "")} onChange={e => setM365FormData(f => ({ ...f, referralSource: e.target.value }))} />
                    </div>
                    <div className="sm:col-span-3">
                      <label className={labelCls}>Business Goals</label>
                      <textarea rows={2} className={inputCls} placeholder="Key business objectives for this engagement" value={String(m365FormData.businessGoals ?? "")} onChange={e => setM365FormData(f => ({ ...f, businessGoals: e.target.value }))} />
                    </div>
                    <div className="sm:col-span-3">
                      <label className={labelCls}>Known Blockers</label>
                      <textarea rows={2} className={inputCls} placeholder="Technical or organizational blockers" value={String(m365FormData.knownBlockers ?? "")} onChange={e => setM365FormData(f => ({ ...f, knownBlockers: e.target.value }))} />
                    </div>
                  </div>
                </div>

              </div>
            )}

            {/* Footer */}
            {!m365FormLoading && (
              <div className="flex items-center gap-3 px-6 py-4 border-t border-border sticky bottom-0 bg-[#161B22]">
                <button onClick={() => void saveM365Profile()} disabled={m365FormSaving} className="bg-[#0078D4] text-white text-xs font-semibold px-4 py-1.5 rounded-lg hover:bg-[#0078D4]/90 disabled:opacity-50 transition-colors">
                  {m365FormSaving ? "Saving…" : "Save Profile"}
                </button>
                <button onClick={() => setShowM365Dialog(false)} className="border border-border text-xs px-4 py-1.5 rounded-lg hover:bg-[#1C2128] text-[#E6EDF3] transition-colors">Cancel</button>
                <a
                  href={`/api/admin/clients/${clientId}/m365-profile/pdf`}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground hover:text-[#0078D4] transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                  Export PDF
                </a>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── App Registration Dialog ──────────────────────────────────────────── */}
      {showAppRegDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setShowAppRegDialog(false)}>
          <div className="absolute inset-0 bg-black/60" />
          <div
            className="relative bg-[#161B22] border border-border rounded-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-[#161B22] z-10">
              <div>
                <p className="text-sm font-bold text-[#E6EDF3]">App Registration</p>
                <p className="text-xs text-muted-foreground mt-0.5">Azure credentials &amp; portal submission</p>
              </div>
              <button onClick={() => setShowAppRegDialog(false)} className="text-muted-foreground hover:text-[#E6EDF3] transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            {(credLoading || appRegLoading) ? (
              <div className="flex items-center justify-center py-16">
                <div className="w-6 h-6 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <div className="p-6 space-y-6">
                {/* Admin credential section */}
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-3">Admin Credential (Script Runner)</p>
                  {azureCred ? (
                    <div className="space-y-4">
                      {azureCred.expiresOn && daysUntil(azureCred.expiresOn) <= EXPIRY_WARN_DAYS && (
                        <div className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${daysUntil(azureCred.expiresOn) <= 14 ? "bg-red-500/10 border-red-500/20" : "bg-amber-500/10 border-amber-500/20"}`}>
                          <svg className={`w-4 h-4 flex-shrink-0 mt-0.5 ${daysUntil(azureCred.expiresOn) <= 14 ? "text-red-500" : "text-amber-500"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                          <p className={`text-xs font-semibold ${daysUntil(azureCred.expiresOn) <= 14 ? "text-red-400" : "text-amber-400"}`}>{daysUntil(azureCred.expiresOn) <= 0 ? "Secret expired" : `Expires in ${daysUntil(azureCred.expiresOn)} days`} — rotate before expiry</p>
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-4">
                        <div><p className={labelCls}>Display Name</p><div className="flex items-center gap-2"><p className="text-sm text-[#E6EDF3]">{azureCred.displayName}</p><ExpiryBadge expiresOn={azureCred.expiresOn} /></div></div>
                        <div><p className={labelCls}>Type</p><p className="text-sm text-[#E6EDF3]">{azureCred.credentialType === "certificate" ? "Certificate" : "Client Secret"}</p></div>
                        <div><p className={labelCls}>Tenant ID</p><p className="text-xs text-[#E6EDF3] font-mono break-all">{azureCred.tenantId}</p></div>
                        <div><p className={labelCls}>Client ID</p><p className="text-xs text-[#E6EDF3] font-mono break-all">{azureCred.clientId}</p></div>
                        {azureCred.keyVaultSecretName && <div className="col-span-2"><p className={labelCls}>Key Vault Secret</p><p className="text-xs text-[#E6EDF3] font-mono">{azureCred.keyVaultSecretName}</p></div>}
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No admin credential on file. Add one from the Workspace &amp; Credentials section.</p>
                  )}
                </div>

                {/* Portal App Registration */}
                {appReg && (
                  <div className="border-t border-border pt-6">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-3">Portal App Registration (Client-submitted)</p>
                    <div className="space-y-4">
                      <div className="flex items-center gap-3 flex-wrap">
                        {appReg.status === "verified" ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full bg-green-500/15 text-green-400 border border-green-500/20"><svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>Verified</span>
                        ) : appReg.status === "submitted" ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20"><span className="w-1.5 h-1.5 rounded-full bg-amber-500" />Submitted · Pending Verification</span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full bg-red-500/15 text-red-400 border border-red-500/20"><span className="w-1.5 h-1.5 rounded-full bg-red-500" />Pending</span>
                        )}
                        <ExpiryBadge expiresOn={appReg.expiresOn} />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div><p className={labelCls}>Tenant ID</p><p className="text-xs text-[#E6EDF3] font-mono break-all">{appReg.tenantId}</p></div>
                        <div><p className={labelCls}>Azure Client ID</p><p className="text-xs text-[#E6EDF3] font-mono break-all">{appReg.azureClientId}</p></div>
                        {appReg.keyVaultSecretName && <div className="col-span-2"><p className={labelCls}>Key Vault Secret</p><p className="text-xs text-[#E6EDF3] font-mono">{appReg.keyVaultSecretName}</p></div>}
                        {appReg.submittedAt && <div><p className={labelCls}>Submitted</p><p className="text-xs text-[#E6EDF3]">{new Date(appReg.submittedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p></div>}
                        {appReg.verifiedAt && <div><p className={labelCls}>Verified</p><p className="text-xs text-[#E6EDF3]">{new Date(appReg.verifiedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p></div>}
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        {appReg.status !== "verified" && (
                          <button onClick={() => void handleSetAppRegStatus("verified")} disabled={verifyingAppReg} className="flex items-center gap-1.5 text-xs font-semibold bg-green-600 text-white px-4 py-1.5 rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors">
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                            Mark Verified
                          </button>
                        )}
                        {appReg.status === "verified" && (
                          <button onClick={() => void handleSetAppRegStatus("submitted")} disabled={verifyingAppReg} className="text-xs font-semibold text-amber-400 border border-amber-500/30 bg-amber-500/10 px-4 py-1.5 rounded-lg hover:bg-amber-500/20 disabled:opacity-50 transition-colors">Revert to Submitted</button>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {!azureCred && !appReg && (
                  <p className="text-sm text-muted-foreground text-center py-4">No App Registration or admin credential on file for this client.</p>
                )}
              </div>
            )}

            <div className="flex justify-end px-6 py-4 border-t border-border sticky bottom-0 bg-[#161B22]">
              <button onClick={() => setShowAppRegDialog(false)} className="border border-border text-xs px-4 py-1.5 rounded-lg hover:bg-[#1C2128] text-[#E6EDF3] transition-colors">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
