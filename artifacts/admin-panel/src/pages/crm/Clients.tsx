import { useEffect, useRef, useState, useCallback, useMemo, Fragment } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useAssignEmail } from "@/hooks/useAssignEmail";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { M365ProfileWizard } from "@/components/M365ProfileWizard";

interface EnrichedClient {
  id: number;
  email: string;
  name: string | null;
  company: string | null;
  phone: string | null;
  sharepointSiteUrl: string | null;
  sharepointSiteId: string | null;
  createdAt: string;
  projectCount: number;
  activeProjectCount: number;
  openTaskCount: number;
  quizScore: number | null;
  quizTier: string | null;
  // Extended fields
  industry: string | null;
  licenseTier: string | null;
  employeeCount: number | null;
  tenantAge: number | null;
  itTeamSize: number | null;
  governanceScore: number | null;
  securityScore: number | null;
  complianceScore: number | null;
  copilotReadinessScore: number | null;
  powerPlatformScore: number | null;
  externalSharingScore: number | null;
  shadowItScore: number | null;
  lastActivityAt: string | null;
  aiRiskLevel: "high" | "medium" | "low" | null;
  aiOpportunityLevel: "high" | "medium" | "low" | null;
  onboardingWizardCompletedAt: string | null;
}

interface EmailRow {
  email: {
    id: number;
    subject: string | null;
    senderAddress: string;
    senderDomain: string;
    bodyPreview: string | null;
    receivedAt: string;
    rawFrom: string | null;
    linkedUserId: number | null;
  };
  clientName: string | null;
  clientEmail: string | null;
}

interface DeletePreview {
  projects: number;
  invoices: number;
  unpaidInvoices: number;
  contracts: number;
  messages: number;
  services: number;
  reports: number;
  statusReports: number;
  hasActiveStripeSubscription: boolean;
}

const CRM_PORTAL_BASE = (() => {
  const url = new URL(window.location.href);
  return `${url.protocol}//${url.host}/crm`;
})();

interface FormState {
  email: string;
  name: string;
  company: string;
  phone: string;
}

const EMPTY_FORM: FormState = { email: "", name: "", company: "", phone: "" };

function timeAgo(ts: string) {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) return <span className="text-xs text-[#484F58]">—</span>;
  const pct = Math.min(100, Math.round((score / 100) * 100));
  const color =
    pct >= 70 ? "text-emerald-400" : pct >= 40 ? "text-amber-400" : "text-red-400";
  return (
    <span className={`text-xs font-bold tabular-nums ${color}`}>{score}</span>
  );
}

function TierBadge({ tier }: { tier: string | null }) {
  if (!tier) return null;
  const cls =
    tier === "Expert"
      ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/20"
      : tier === "Intermediate"
        ? "bg-blue-500/15 text-blue-400 border-blue-500/20"
        : "bg-amber-500/15 text-amber-400 border-amber-500/20";
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${cls}`}>
      {tier}
    </span>
  );
}

// ─── DeleteConfirmDialog ───────────────────────────────────────────────────────
function DeleteConfirmDialog({
  client,
  onClose,
  onConfirm,
  deleting,
}: {
  client: EnrichedClient;
  onClose: () => void;
  onConfirm: () => void;
  deleting: boolean;
}) {
  const { fetchWithAuth } = useAuth();
  const [preview, setPreview] = useState<DeletePreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(true);

  useEffect(() => {
    fetchWithAuth(`/api/admin/clients/${client.id}/delete-preview`)
      .then(r => r.json())
      .then((d: DeletePreview) => setPreview(d))
      .catch(() => setPreview(null))
      .finally(() => setLoadingPreview(false));
  }, [client.id, fetchWithAuth]);

  return (
    <Dialog open onOpenChange={open => { if (!open && !deleting) onClose(); }}>
      <DialogContent className="bg-[#161B22] border-border text-[#E6EDF3] max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[#E6EDF3]">Delete {client.name ?? client.email}?</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            This will permanently remove the client and all associated data.
          </DialogDescription>
        </DialogHeader>
        {loadingPreview ? (
          <div className="flex items-center gap-2 py-2 text-sm text-[#7D8590]">
            <div className="w-4 h-4 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
            Checking data…
          </div>
        ) : preview ? (
          <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400 space-y-1">
            {preview.hasActiveStripeSubscription && (
              <p className="font-bold">⚠ Client has an active Stripe subscription — cancel it first.</p>
            )}
            {preview.unpaidInvoices > 0 && (
              <p>{preview.unpaidInvoices} unpaid invoice{preview.unpaidInvoices !== 1 ? "s" : ""}</p>
            )}
            <p>
              {[
                preview.projects > 0 && `${preview.projects} project${preview.projects !== 1 ? "s" : ""}`,
                preview.contracts > 0 && `${preview.contracts} contract${preview.contracts !== 1 ? "s" : ""}`,
                preview.invoices > 0 && `${preview.invoices} invoice${preview.invoices !== 1 ? "s" : ""}`,
                preview.messages > 0 && `${preview.messages} message${preview.messages !== 1 ? "s" : ""}`,
              ]
                .filter(Boolean)
                .join(", ") || "No associated data"}
              {" will be deleted."}
            </p>
          </div>
        ) : null}
        <DialogFooter>
          <button
            onClick={onClose}
            disabled={deleting}
            className="border border-border text-sm font-medium px-4 py-2 rounded-lg hover:bg-[#1C2128] disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={deleting || preview?.hasActiveStripeSubscription === true}
            className="bg-red-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            {deleting ? "Deleting…" : "Delete Client"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── ClientEmailPanel (inline row expansion) ───────────────────────────────────
function ClientEmailPanel({ client, onClose }: { client: EnrichedClient; onClose: () => void }) {
  const { fetchWithAuth } = useAuth();
  const { assignEmail, assigningId } = useAssignEmail();
  const [emails, setEmails] = useState<EmailRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const clientDomain = client.email.split("@")[1] ?? "";

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth(`/api/admin/emails?domain=${encodeURIComponent(clientDomain)}&limit=50`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { emails: EmailRow[] };
      setEmails(data.emails);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load emails");
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, clientDomain]);

  useEffect(() => { void load(); }, [load]);

  const linkedToThis = emails.filter(r => r.email.linkedUserId === client.id);
  const unlinked = emails.filter(r => r.email.linkedUserId === null);

  return (
    <tr>
      <td colSpan={7} className="px-0 py-0 border-b border-border bg-[#0078D4]/5">
        <div className="px-5 py-4">
          <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
            <span className="text-xs font-bold text-[#0078D4] uppercase tracking-widest">
              Email Activity · @{clientDomain}
            </span>
            <button onClick={onClose} className="text-[#7D8590] hover:text-[#E6EDF3] transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {loading ? (
            <div className="flex items-center gap-2 py-3 text-sm text-[#7D8590]">
              <div className="w-4 h-4 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
              Loading…
            </div>
          ) : error ? (
            <p className="text-sm text-red-400">{error}</p>
          ) : emails.length === 0 ? (
            <p className="text-sm text-[#7D8590]">No emails from @{clientDomain} yet.</p>
          ) : (
            <div className="space-y-3">
              {unlinked.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-amber-600 uppercase tracking-widest mb-1.5">
                    Unlinked · {unlinked.length}
                  </p>
                  <div className="space-y-1.5">
                    {unlinked.map(row => (
                      <div key={row.email.id} className="flex items-center gap-3 bg-[#161B22] border border-amber-500/20 rounded-lg px-3 py-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-[#E6EDF3] truncate">{row.email.subject ?? "(no subject)"}</p>
                          <p className="text-[10px] text-[#7D8590]">{row.email.senderAddress} · {timeAgo(row.email.receivedAt)}</p>
                        </div>
                        <button
                          disabled={assigningId === row.email.id}
                          onClick={() => assignEmail(row.email.id, client.id).then(() => void load()).catch(() => null)}
                          className="shrink-0 px-2.5 py-1 text-[11px] font-semibold bg-[#0078D4] text-white rounded-md hover:bg-[#005fa3] disabled:opacity-50 transition-colors"
                        >
                          Link
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {linkedToThis.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest mb-1.5">
                    Linked · {linkedToThis.length}
                  </p>
                  <div className="space-y-1.5">
                    {linkedToThis.map(row => (
                      <div key={row.email.id} className="flex items-center gap-3 bg-[#161B22] border border-emerald-500/20 rounded-lg px-3 py-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-[#E6EDF3] truncate">{row.email.subject ?? "(no subject)"}</p>
                          <p className="text-[10px] text-[#7D8590]">{row.email.senderAddress} · {timeAgo(row.email.receivedAt)}</p>
                        </div>
                        <button
                          disabled={assigningId === row.email.id}
                          onClick={() => assignEmail(row.email.id, null).then(() => void load()).catch(() => null)}
                          className="shrink-0 px-2.5 py-1 text-[11px] text-[#7D8590] border border-[#30363D] rounded-md hover:border-red-500/40 hover:text-red-400 disabled:opacity-50 transition-colors"
                        >
                          Unlink
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

// ─── ClientSharePointPanel ────────────────────────────────────────────────────
function ClientSharePointPanel({
  client,
  onClose,
  onUpdate,
}: {
  client: EnrichedClient;
  onClose: () => void;
  onUpdate: (patch: Pick<EnrichedClient, "sharepointSiteUrl" | "sharepointSiteId">) => void;
}) {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const [urlInput, setUrlInput] = useState(client.sharepointSiteUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [addingOwner, setAddingOwner] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => { if (pollRef.current !== null) clearInterval(pollRef.current); };
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetchWithAuth(`/api/admin/clients/${client.id}/sharepoint`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sharepointSiteUrl: urlInput || null }),
      });
      if (!res.ok) { toast({ title: "Save failed", variant: "destructive" }); return; }
      const data = await res.json() as { sharepointSiteUrl: string | null; sharepointSiteId: string | null };
      onUpdate({ sharepointSiteUrl: data.sharepointSiteUrl, sharepointSiteId: data.sharepointSiteId });
      toast({ title: "SharePoint site saved" });
    } finally {
      setSaving(false);
    }
  }

  async function handleProvision() {
    setProvisioning(true);
    try {
      const res = await fetchWithAuth(`/api/admin/clients/${client.id}/sharepoint/provision`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json() as { error: string };
        toast({ title: "Provision failed", description: err.error, variant: "destructive" });
        return;
      }
      const data = await res.json() as { ok?: boolean; alreadyProvisioned?: boolean; provisioning?: boolean; sharepointSiteUrl?: string; sharepointSiteId?: string };
      if (data.sharepointSiteUrl) {
        setUrlInput(data.sharepointSiteUrl);
        onUpdate({ sharepointSiteUrl: data.sharepointSiteUrl, sharepointSiteId: data.sharepointSiteId ?? null });
        toast({ title: data.alreadyProvisioned ? "SharePoint site already provisioned" : "SharePoint site provisioned" });
      } else {
        toast({ title: "Provisioning started", description: "The site is being created in the background. Check back in a minute." });
      }
    } finally {
      setProvisioning(false);
    }
  }

  async function handleAddOwner() {
    setAddingOwner(true);
    try {
      const res = await fetchWithAuth(`/api/admin/clients/${client.id}/sharepoint/add-owner`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json() as { error: string };
        toast({ title: "Failed", description: err.error, variant: "destructive" });
        return;
      }
      toast({ title: "Shane added as site owner" });
    } finally {
      setAddingOwner(false);
    }
  }

  return (
    <tr>
      <td colSpan={7} className="px-0 py-0 border-b border-border bg-[#0078D4]/5">
        <div className="px-5 py-4">
          <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
            <span className="text-xs font-bold text-[#0078D4] uppercase tracking-widest">SharePoint Site</span>
            <button onClick={onClose} className="text-[#7D8590] hover:text-[#E6EDF3] transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="flex items-center gap-2 max-w-lg">
            <input
              type="url"
              placeholder="https://contoso.sharepoint.com/sites/…"
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              className="flex-1 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-[#161B22] text-[#E6EDF3]"
            />
            <button
              onClick={() => void handleSave()}
              disabled={saving}
              className="px-3 py-2 bg-[#0078D4] text-white text-xs font-semibold rounded-lg hover:bg-[#005fa3] disabled:opacity-50 transition-colors"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
          <div className="flex gap-2 mt-2 flex-wrap">
            <button
              onClick={() => void handleProvision()}
              disabled={provisioning}
              className="text-xs font-semibold text-[#0078D4] hover:underline disabled:opacity-50 transition-colors"
            >
              {provisioning ? "Provisioning…" : "Auto-provision site"}
            </button>
            {client.sharepointSiteUrl && (
              <>
                <span className="text-[#484F58]">·</span>
                <a href={client.sharepointSiteUrl} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-emerald-400 hover:underline">
                  Open site ↗
                </a>
                <span className="text-[#484F58]">·</span>
                <button
                  onClick={() => void handleAddOwner()}
                  disabled={addingOwner}
                  className="text-xs font-semibold text-[#7D8590] hover:text-[#0078D4] disabled:opacity-50 transition-colors"
                >
                  {addingOwner ? "Adding…" : "Add Shane as owner"}
                </button>
              </>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function ClientsPage() {
  const [, navigate] = useLocation();
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();

  const [clients, setClients] = useState<EnrichedClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<EnrichedClient | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [search, setSearch] = useState("");
  const [expandedEmailId, setExpandedEmailId] = useState<number | null>(null);
  const [expandedSpId, setExpandedSpId] = useState<number | null>(null);
  const [m365ClientId, setM365ClientId] = useState<number | null>(null);
  const [resendingInviteId, setResendingInviteId] = useState<number | null>(null);
  const [viewAsLoading, setViewAsLoading] = useState<number | null>(null);
  const [sortKey, setSortKey] = useState<"name" | "projects" | "tasks" | "score" | "joined" | "lastActivity" | "governance" | "copilot" | "aiRisk">("joined");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [filterStatus, setFilterStatus] = useState<"all" | "active" | "no-projects">("all");
  const [filterTier, setFilterTier] = useState<"all" | "Expert" | "Intermediate" | "Beginner">("all");
  const [filterLicenseTier, setFilterLicenseTier] = useState<"all" | string>("all");
  const [filterAiRisk, setFilterAiRisk] = useState<"all" | "high" | "medium" | "low">("all");
  const [filterAiOpp, setFilterAiOpp] = useState<"all" | "high" | "medium" | "low">("all");
  const [filterIndustry, setFilterIndustry] = useState<"all" | string>("all");
  const [filterOnboarding, setFilterOnboarding] = useState<"all" | "complete" | "pending">("all");
  const [hoverRowId, setHoverRowId] = useState<number | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<number | null>(null);

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const load = async () => {
    try {
      const res = await fetchWithAuth("/api/admin/clients/enriched");
      if (res.ok) {
        const data = await res.json() as EnrichedClient[];
        setClients(data);
        const params = new URLSearchParams(window.location.search);
        const m365Param = params.get("m365");
        if (m365Param) {
          const targetId = parseInt(m365Param, 10);
          if (!isNaN(targetId) && data.some(c => c.id === targetId)) {
            setM365ClientId(targetId);
          }
        }
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      let res: Response;
      if (editingId) {
        res = await fetchWithAuth(`/api/admin/clients/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: form.name, company: form.company, phone: form.phone, email: form.email }),
        });
      } else {
        res = await fetchWithAuth("/api/admin/clients", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: form.email, name: form.name, company: form.company, phone: form.phone }),
        });
      }
      if (!res.ok) {
        const err = await res.json() as { error: string };
        setError(err.error);
      } else {
        if (!editingId) {
          toast({ title: "Client created", description: `Portal invite sent to ${form.email}.` });
        }
        setShowForm(false);
        setEditingId(null);
        setForm(EMPTY_FORM);
        await load();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleResendInvite = async (c: EnrichedClient) => {
    setResendingInviteId(c.id);
    try {
      const res = await fetchWithAuth(`/api/admin/clients/${c.id}/resend-invite`, { method: "POST" });
      if (res.ok) {
        toast({ title: "Invite resent", description: `New setup link sent to ${c.email}.` });
      } else {
        const err = await res.json() as { error?: string };
        toast({ title: "Failed to resend invite", description: err.error ?? "Unknown error", variant: "destructive" });
      }
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    } finally {
      setResendingInviteId(null);
    }
  };

  const handleViewAs = async (c: EnrichedClient) => {
    setViewAsLoading(c.id);
    try {
      const res = await fetchWithAuth(`/api/admin/impersonate/${c.id}`, { method: "POST" });
      if (!res.ok) { alert("Could not start impersonation session"); return; }
      const data = await res.json() as { token: string };
      window.open(`${CRM_PORTAL_BASE}/portal?impersonation_token=${encodeURIComponent(data.token)}`, "_blank", "noopener");
    } finally {
      setViewAsLoading(null);
    }
  };

  const handleEdit = (c: EnrichedClient) => {
    setEditingId(c.id);
    setForm({ email: c.email, name: c.name ?? "", company: c.company ?? "", phone: c.phone ?? "" });
    setShowForm(true);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetchWithAuth(`/api/admin/clients/${deleteTarget.id}`, { method: "DELETE" });
      if (res.ok) {
        toast({ title: "Client deleted" });
        setDeleteTarget(null);
        await load();
      } else {
        const err = await res.json() as { error: string };
        toast({ title: "Delete failed", description: err.error, variant: "destructive" });
      }
    } finally {
      setDeleting(false);
    }
  };

  const sortedFilteredClients = useMemo(() => {
    const q = search.toLowerCase();
    let result = clients.filter(c =>
      c.email.toLowerCase().includes(q) ||
      (c.name ?? "").toLowerCase().includes(q) ||
      (c.company ?? "").toLowerCase().includes(q)
    );

    if (filterStatus === "active") result = result.filter(c => c.activeProjectCount > 0);
    if (filterStatus === "no-projects") result = result.filter(c => c.projectCount === 0);
    if (filterTier !== "all") result = result.filter(c => c.quizTier === filterTier);
    if (filterLicenseTier !== "all") result = result.filter(c => c.licenseTier === filterLicenseTier);
    if (filterAiRisk !== "all") result = result.filter(c => c.aiRiskLevel === filterAiRisk);
    if (filterAiOpp !== "all") result = result.filter(c => c.aiOpportunityLevel === filterAiOpp);
    if (filterIndustry !== "all") result = result.filter(c => c.industry === filterIndustry);
    if (filterOnboarding === "complete") result = result.filter(c => c.onboardingWizardCompletedAt !== null);
    if (filterOnboarding === "pending") result = result.filter(c => c.onboardingWizardCompletedAt === null);

    return [...result].sort((a, b) => {
      let aVal: string | number, bVal: string | number;
      switch (sortKey) {
        case "name":
          aVal = (a.name ?? a.email).toLowerCase();
          bVal = (b.name ?? b.email).toLowerCase();
          break;
        case "projects":
          aVal = a.activeProjectCount;
          bVal = b.activeProjectCount;
          break;
        case "tasks":
          aVal = a.openTaskCount;
          bVal = b.openTaskCount;
          break;
        case "score":
          aVal = a.quizScore ?? -1;
          bVal = b.quizScore ?? -1;
          break;
        case "governance":
          aVal = a.governanceScore ?? -1;
          bVal = b.governanceScore ?? -1;
          break;
        case "copilot":
          aVal = a.copilotReadinessScore ?? -1;
          bVal = b.copilotReadinessScore ?? -1;
          break;
        case "lastActivity":
          aVal = a.lastActivityAt ? new Date(a.lastActivityAt).getTime() : 0;
          bVal = b.lastActivityAt ? new Date(b.lastActivityAt).getTime() : 0;
          break;
        case "aiRisk": {
          const riskOrder: Record<string, number> = { high: 3, medium: 2, low: 1 };
          aVal = riskOrder[a.aiRiskLevel ?? ""] ?? 0;
          bVal = riskOrder[b.aiRiskLevel ?? ""] ?? 0;
          break;
        }
        case "joined":
        default:
          aVal = new Date(a.createdAt).getTime();
          bVal = new Date(b.createdAt).getTime();
          break;
      }
      const cmp = typeof aVal === "string" ? aVal.localeCompare(bVal as string) : (aVal as number) - (bVal as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [clients, search, filterStatus, filterTier, filterLicenseTier, filterAiRisk, filterAiOpp, filterIndustry, sortKey, sortDir]);

  function toggleSort(key: typeof sortKey) {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  }

  function SortIcon({ col }: { col: typeof sortKey }) {
    if (sortKey !== col) return <svg className="w-3 h-3 text-[#484F58] inline ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 9l4-4 4 4m0 6l-4 4-4-4" /></svg>;
    return sortDir === "asc"
      ? <svg className="w-3 h-3 text-[#0078D4] inline ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" /></svg>
      : <svg className="w-3 h-3 text-[#0078D4] inline ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>;
  }

  const activeFilterCount = (filterStatus !== "all" ? 1 : 0) + (filterTier !== "all" ? 1 : 0) +
    (filterLicenseTier !== "all" ? 1 : 0) + (filterAiRisk !== "all" ? 1 : 0) + (filterAiOpp !== "all" ? 1 : 0) +
    (filterIndustry !== "all" ? 1 : 0) + (filterOnboarding !== "all" ? 1 : 0);

  const distinctLicenseTiers = useMemo(() =>
    [...new Set(clients.map(c => c.licenseTier).filter((t): t is string => !!t))].sort(),
    [clients]
  );

  const distinctIndustries = useMemo(() =>
    [...new Set(clients.map(c => c.industry).filter((t): t is string => !!t))].sort(),
    [clients]
  );

  const inputCls =
    "w-full border border-border rounded-lg px-3 py-2 text-sm text-[#E6EDF3] focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-[#1C2128]";

  return (
    <div className="p-4 sm:p-6 max-w-[1400px]">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold text-[#E6EDF3]">Clients</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {clients.length} client{clients.length !== 1 ? "s" : ""} — click a name to open the command center
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate("/crm/testimonials")}
            className="flex items-center gap-2 border border-border text-[#E6EDF3] text-sm font-medium px-4 py-2 rounded-lg hover:bg-[#1C2128] transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
            </svg>
            Testimonials
          </button>
          <button
            onClick={() => { setShowForm(true); setEditingId(null); setForm(EMPTY_FORM); setError(""); }}
            className="flex items-center gap-2 bg-[#0078D4] text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[#0078D4]/90 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add Client
          </button>
        </div>
      </div>

      {/* ── Search ─────────────────────────────────────────────────── */}
      <div className="mb-4 relative max-w-sm">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
        </svg>
        <input
          type="search"
          placeholder="Search by name, email or company…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-[#161B22] text-[#E6EDF3]"
        />
      </div>

      {/* ── Add / Edit form ─────────────────────────────────────────── */}
      {showForm && (
        <div className="bg-[#1C2128] border border-border rounded-xl p-5 mb-6">
          <h3 className="text-sm font-bold text-[#E6EDF3] mb-1">{editingId ? "Edit Client" : "Add New Client"}</h3>
          {!editingId && (
            <p className="text-xs text-muted-foreground mb-4">
              A portal invite email will be sent automatically so the client can set their own password.
            </p>
          )}
          <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">Email *</label>
              <input type="email" required value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">Name</label>
              <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">Company</label>
              <input type="text" value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">Phone</label>
              <input type="text" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className={inputCls} />
            </div>
            {error && (
              <div className="sm:col-span-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</div>
            )}
            <div className="sm:col-span-2 flex gap-3">
              <button type="submit" disabled={saving} className="bg-[#0078D4] text-white text-sm font-semibold px-5 py-2 rounded-lg hover:bg-[#0078D4]/90 disabled:opacity-50 transition-colors">
                {saving ? "Saving…" : editingId ? "Save Changes" : "Create & Send Invite"}
              </button>
              <button type="button" onClick={() => { setShowForm(false); setEditingId(null); setError(""); }} className="border border-border text-sm font-medium px-5 py-2 rounded-lg hover:bg-[#1C2128] transition-colors">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Table + Filter Sidebar ──────────────────────────────────── */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : clients.length === 0 ? (
        <div className="bg-[#161B22] border border-border rounded-xl p-10 text-center text-muted-foreground text-sm">
          No clients yet. Add a client account to give them portal access.
        </div>
      ) : (
        <div className="flex gap-4 items-start">
          {/* Filter Sidebar */}
          <div className="w-44 flex-shrink-0 bg-[#161B22] border border-border rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2.5 bg-[#1C2128] border-b border-border">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Filters</p>
              {activeFilterCount > 0 && (
                <button
                  onClick={() => { setFilterStatus("all"); setFilterTier("all"); setFilterLicenseTier("all"); setFilterAiRisk("all"); setFilterAiOpp("all"); setFilterIndustry("all"); setFilterOnboarding("all"); }}
                  className="text-[10px] font-semibold text-[#0078D4] hover:underline"
                >
                  Clear {activeFilterCount}
                </button>
              )}
            </div>

            <div className="p-3 space-y-4">
              {/* Status filter */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Status</p>
                <div className="space-y-0.5">
                  {(["all", "active", "no-projects"] as const).map(opt => {
                    const labels = { all: "All clients", active: "Has projects", "no-projects": "No projects" };
                    return (
                      <button key={opt} onClick={() => setFilterStatus(opt)}
                        className={`w-full text-left text-xs px-2 py-1 rounded transition-colors ${filterStatus === opt ? "bg-[#0078D4]/15 text-[#0078D4] font-semibold" : "text-muted-foreground hover:text-[#E6EDF3] hover:bg-[#1C2128]"}`}>
                        {labels[opt]}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* M365 Tier filter */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">M365 Tier</p>
                <div className="space-y-0.5">
                  {(["all", "Expert", "Intermediate", "Beginner"] as const).map(opt => (
                    <button key={opt} onClick={() => setFilterTier(opt)}
                      className={`w-full text-left text-xs px-2 py-1 rounded transition-colors ${filterTier === opt ? "bg-[#0078D4]/15 text-[#0078D4] font-semibold" : "text-muted-foreground hover:text-[#E6EDF3] hover:bg-[#1C2128]"}`}>
                      {opt === "all" ? "All tiers" : opt}
                    </button>
                  ))}
                </div>
              </div>

              {/* License Tier filter */}
              {distinctLicenseTiers.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">License Tier</p>
                  <div className="space-y-0.5">
                    <button onClick={() => setFilterLicenseTier("all")}
                      className={`w-full text-left text-xs px-2 py-1 rounded transition-colors ${filterLicenseTier === "all" ? "bg-[#0078D4]/15 text-[#0078D4] font-semibold" : "text-muted-foreground hover:text-[#E6EDF3] hover:bg-[#1C2128]"}`}>
                      All licenses
                    </button>
                    {distinctLicenseTiers.map(t => (
                      <button key={t} onClick={() => setFilterLicenseTier(t)}
                        className={`w-full text-left text-xs px-2 py-1 rounded transition-colors truncate ${filterLicenseTier === t ? "bg-[#0078D4]/15 text-[#0078D4] font-semibold" : "text-muted-foreground hover:text-[#E6EDF3] hover:bg-[#1C2128]"}`}>
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* AI Risk filter */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">AI Risk</p>
                <div className="space-y-0.5">
                  {(["all", "high", "medium", "low"] as const).map(opt => (
                    <button key={opt} onClick={() => setFilterAiRisk(opt)}
                      className={`w-full text-left text-xs px-2 py-1 rounded transition-colors ${filterAiRisk === opt ? "bg-[#0078D4]/15 text-[#0078D4] font-semibold" : "text-muted-foreground hover:text-[#E6EDF3] hover:bg-[#1C2128]"}`}>
                      {opt === "all" ? "All risk levels" : opt.charAt(0).toUpperCase() + opt.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              {/* AI Opportunity filter */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">AI Opportunity</p>
                <div className="space-y-0.5">
                  {(["all", "high", "medium", "low"] as const).map(opt => (
                    <button key={opt} onClick={() => setFilterAiOpp(opt)}
                      className={`w-full text-left text-xs px-2 py-1 rounded transition-colors ${filterAiOpp === opt ? "bg-[#0078D4]/15 text-[#0078D4] font-semibold" : "text-muted-foreground hover:text-[#E6EDF3] hover:bg-[#1C2128]"}`}>
                      {opt === "all" ? "All levels" : opt.charAt(0).toUpperCase() + opt.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Industry filter */}
              {distinctIndustries.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Industry</p>
                  <div className="space-y-0.5">
                    <button onClick={() => setFilterIndustry("all")}
                      className={`w-full text-left text-xs px-2 py-1 rounded transition-colors ${filterIndustry === "all" ? "bg-[#0078D4]/15 text-[#0078D4] font-semibold" : "text-muted-foreground hover:text-[#E6EDF3] hover:bg-[#1C2128]"}`}>
                      All industries
                    </button>
                    {distinctIndustries.map(ind => (
                      <button key={ind} onClick={() => setFilterIndustry(ind)}
                        className={`w-full text-left text-xs px-2 py-1 rounded transition-colors truncate ${filterIndustry === ind ? "bg-[#0078D4]/15 text-[#0078D4] font-semibold" : "text-muted-foreground hover:text-[#E6EDF3] hover:bg-[#1C2128]"}`}>
                        {ind}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Onboarding filter */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Setup Wizard</p>
                <div className="space-y-0.5">
                  {(["all", "complete", "pending"] as const).map(opt => {
                    const labels = { all: "All clients", complete: "Setup complete", pending: "Pending setup" };
                    return (
                      <button key={opt} onClick={() => setFilterOnboarding(opt)}
                        className={`w-full text-left text-xs px-2 py-1 rounded transition-colors ${filterOnboarding === opt ? "bg-[#0078D4]/15 text-[#0078D4] font-semibold" : "text-muted-foreground hover:text-[#E6EDF3] hover:bg-[#1C2128]"}`}>
                        {labels[opt]}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Quick stats */}
              <div className="border-t border-border pt-3 space-y-1.5">
                <div className="flex justify-between text-[10px]">
                  <span className="text-muted-foreground">Total</span>
                  <span className="text-[#E6EDF3] font-semibold">{clients.length}</span>
                </div>
                <div className="flex justify-between text-[10px]">
                  <span className="text-muted-foreground">Showing</span>
                  <span className="text-[#E6EDF3] font-semibold">{sortedFilteredClients.length}</span>
                </div>
                <div className="flex justify-between text-[10px]">
                  <span className="text-muted-foreground">Setup done</span>
                  <span className="text-emerald-400 font-semibold">{clients.filter(c => c.onboardingWizardCompletedAt !== null).length}</span>
                </div>
                <div className="flex justify-between text-[10px]">
                  <span className="text-muted-foreground">Pending setup</span>
                  <span className="text-amber-400 font-semibold">{clients.filter(c => c.onboardingWizardCompletedAt === null).length}</span>
                </div>
                <div className="flex justify-between text-[10px]">
                  <span className="text-muted-foreground">With M365</span>
                  <span className="text-[#E6EDF3] font-semibold">{clients.filter(c => c.quizScore !== null).length}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="flex-1 min-w-0 bg-[#161B22] border border-border rounded-xl overflow-hidden overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#1C2128] border-b border-border">
                <tr>
                  <th className="pl-4 pr-2 py-3 w-10">
                    <input
                      type="checkbox"
                      className="accent-[#0078D4] w-4 h-4 cursor-pointer"
                      checked={sortedFilteredClients.length > 0 && sortedFilteredClients.every(c => selectedIds.has(c.id))}
                      onChange={e => {
                        if (e.target.checked) {
                          setSelectedIds(new Set(sortedFilteredClients.map(c => c.id)));
                        } else {
                          setSelectedIds(new Set());
                        }
                      }}
                    />
                  </th>
                  <th className="text-left px-5 py-3">
                    <button onClick={() => toggleSort("name")} className="flex items-center text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-[#E6EDF3] transition-colors">
                      Name / Email<SortIcon col="name" />
                    </button>
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden sm:table-cell">Company</th>
                  <th className="text-center px-3 py-3 hidden md:table-cell">
                    <button onClick={() => toggleSort("projects")} className="flex items-center gap-0 mx-auto text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-[#E6EDF3] transition-colors">
                      Projects<SortIcon col="projects" />
                    </button>
                  </th>
                  <th className="text-center px-3 py-3 hidden md:table-cell">
                    <button onClick={() => toggleSort("tasks")} className="flex items-center gap-0 mx-auto text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-[#E6EDF3] transition-colors">
                      Tasks<SortIcon col="tasks" />
                    </button>
                  </th>
                  <th className="text-center px-3 py-3 hidden lg:table-cell">
                    <button onClick={() => toggleSort("copilot")} className="flex items-center gap-0 mx-auto text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-[#E6EDF3] transition-colors">
                      Copilot<SortIcon col="copilot" />
                    </button>
                  </th>
                  <th className="text-center px-3 py-3 hidden lg:table-cell">
                    <button onClick={() => toggleSort("governance")} className="flex items-center gap-0 mx-auto text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-[#E6EDF3] transition-colors">
                      Gov.<SortIcon col="governance" />
                    </button>
                  </th>
                  <th className="text-center px-3 py-3 hidden xl:table-cell">
                    <button onClick={() => toggleSort("score")} className="flex items-center gap-0 mx-auto text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-[#E6EDF3] transition-colors">
                      M365<SortIcon col="score" />
                    </button>
                  </th>
                  <th className="text-center px-3 py-3 hidden xl:table-cell">
                    <button onClick={() => toggleSort("aiRisk")} className="flex items-center gap-0 mx-auto text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-[#E6EDF3] transition-colors">
                      AI Risk<SortIcon col="aiRisk" />
                    </button>
                  </th>
                  <th className="text-center px-3 py-3 hidden xl:table-cell">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">AI Opp</span>
                  </th>
                  <th className="text-center px-3 py-3 hidden 2xl:table-cell">
                    <button onClick={() => toggleSort("lastActivity")} className="flex items-center gap-0 mx-auto text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-[#E6EDF3] transition-colors">
                      Activity<SortIcon col="lastActivity" />
                    </button>
                  </th>
                  <th className="text-center px-3 py-3 hidden lg:table-cell">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Setup</span>
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {sortedFilteredClients.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="px-5 py-8 text-center text-muted-foreground text-sm">
                      No clients match your filters.
                    </td>
                  </tr>
                ) : (
                  sortedFilteredClients.map(c => (
                    <Fragment key={c.id}>
                      <tr
                        onMouseEnter={() => setHoverRowId(c.id)}
                        onMouseLeave={() => { setHoverRowId(null); if (menuOpenId === c.id) setMenuOpenId(null); }}
                        className={`border-b border-border last:border-0 transition-colors ${expandedEmailId === c.id || expandedSpId === c.id ? "bg-[#1C2128]" : hoverRowId === c.id ? "bg-[#1C2128]" : ""}`}
                      >
                        {/* Checkbox */}
                        <td className="pl-4 pr-2 py-3.5" onClick={e => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            className="accent-[#0078D4] w-4 h-4 cursor-pointer"
                            checked={selectedIds.has(c.id)}
                            onChange={e => {
                              setSelectedIds(prev => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(c.id); else next.delete(c.id);
                                return next;
                              });
                            }}
                          />
                        </td>
                        {/* Name / Email */}
                        <td className="px-5 py-3.5">
                          <button onClick={() => navigate(`/crm/clients/${c.id}`)} className="text-left group">
                            <p className="font-semibold text-[#E6EDF3] group-hover:text-[#0078D4] transition-colors leading-tight">
                              {c.name ?? <span className="text-[#484F58]">—</span>}
                            </p>
                            <p className="text-xs text-muted-foreground">{c.email}</p>
                          </button>
                        </td>

                        {/* Company */}
                        <td className="px-4 py-3.5 text-sm text-muted-foreground hidden sm:table-cell">{c.company ?? "—"}</td>

                        {/* Projects */}
                        <td className="px-3 py-3.5 text-center hidden md:table-cell">
                          {c.projectCount === 0 ? (
                            <span className="text-xs text-[#484F58]">—</span>
                          ) : (
                            <div className="inline-flex items-center gap-1">
                              {c.activeProjectCount > 0 && <span className="text-xs font-bold text-[#0078D4]">{c.activeProjectCount}</span>}
                              {c.projectCount > c.activeProjectCount && (
                                <span className="text-xs text-[#484F58]">{c.activeProjectCount > 0 ? `+${c.projectCount - c.activeProjectCount}` : c.projectCount}</span>
                              )}
                              {c.activeProjectCount > 0 && <span className="w-1.5 h-1.5 rounded-full bg-[#0078D4] inline-block" />}
                            </div>
                          )}
                        </td>

                        {/* Open Tasks */}
                        <td className="px-3 py-3.5 text-center hidden md:table-cell">
                          {c.openTaskCount === 0 ? (
                            <span className="text-xs text-[#484F58]">—</span>
                          ) : (
                            <span className={`text-xs font-bold tabular-nums ${c.openTaskCount > 5 ? "text-amber-400" : "text-[#E6EDF3]"}`}>{c.openTaskCount}</span>
                          )}
                        </td>

                        {/* Copilot Readiness */}
                        <td className="px-3 py-3.5 text-center hidden lg:table-cell">
                          {c.copilotReadinessScore !== null ? (
                            <span className={`text-xs font-bold tabular-nums ${c.copilotReadinessScore >= 70 ? "text-emerald-400" : c.copilotReadinessScore >= 40 ? "text-amber-400" : "text-red-400"}`}>{c.copilotReadinessScore}</span>
                          ) : <span className="text-xs text-[#484F58]">—</span>}
                        </td>

                        {/* Governance Score */}
                        <td className="px-3 py-3.5 text-center hidden lg:table-cell">
                          {c.governanceScore !== null ? (
                            <span className={`text-xs font-bold tabular-nums ${c.governanceScore >= 70 ? "text-emerald-400" : c.governanceScore >= 40 ? "text-amber-400" : "text-red-400"}`}>{c.governanceScore}</span>
                          ) : <span className="text-xs text-[#484F58]">—</span>}
                        </td>

                        {/* M365 Maturity Score */}
                        <td className="px-3 py-3.5 text-center hidden xl:table-cell">
                          <div className="flex flex-col items-center gap-0.5">
                            <ScoreBadge score={c.quizScore} />
                            <TierBadge tier={c.quizTier} />
                          </div>
                        </td>

                        {/* AI Risk */}
                        <td className="px-3 py-3.5 text-center hidden xl:table-cell">
                          {c.aiRiskLevel ? (
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${
                              c.aiRiskLevel === "high" ? "bg-red-500/10 text-red-400 border-red-500/20" :
                              c.aiRiskLevel === "medium" ? "bg-amber-500/10 text-amber-400 border-amber-500/20" :
                              "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                            }`}>{c.aiRiskLevel}</span>
                          ) : <span className="text-xs text-[#484F58]">—</span>}
                        </td>

                        {/* AI Opportunity */}
                        <td className="px-3 py-3.5 text-center hidden xl:table-cell">
                          {c.aiOpportunityLevel ? (
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${
                              c.aiOpportunityLevel === "high" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                              c.aiOpportunityLevel === "medium" ? "bg-[#0078D4]/10 text-[#0078D4] border-[#0078D4]/20" :
                              "bg-[#30363D] text-muted-foreground border-border"
                            }`}>{c.aiOpportunityLevel}</span>
                          ) : <span className="text-xs text-[#484F58]">—</span>}
                        </td>

                        {/* Last Activity */}
                        <td className="px-3 py-3.5 text-center hidden 2xl:table-cell">
                          {c.lastActivityAt ? (
                            <span className="text-xs text-muted-foreground whitespace-nowrap">{timeAgo(c.lastActivityAt)}</span>
                          ) : <span className="text-xs text-[#484F58]">—</span>}
                        </td>

                        {/* Setup / Onboarding status */}
                        <td className="px-3 py-3.5 text-center hidden lg:table-cell">
                          {c.onboardingWizardCompletedAt !== null ? (
                            <span
                              className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                              title={`Completed ${new Date(c.onboardingWizardCompletedAt).toLocaleString()}`}
                            >
                              <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                              Done
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border bg-amber-500/10 text-amber-400 border-amber-500/20">
                              <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                              Pending
                            </span>
                          )}
                        </td>

                        {/* Actions — always-visible core + hover dropdown menu */}
                        <td className="px-3 py-3.5">
                          <div className="flex items-center gap-2 justify-end">
                            {/* Core always-visible actions */}
                            <button
                              onClick={() => navigate(`/crm/clients/${c.id}`)}
                              className="text-xs font-semibold text-[#0078D4] hover:underline"
                            >
                              Open
                            </button>

                            {/* Hover-revealed actions */}
                            <div className={`flex items-center gap-2 transition-opacity ${hoverRowId === c.id ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
                              <button
                                onClick={() => navigate("/crm/projects")}
                                className="text-xs font-semibold text-[#7D8590] hover:text-[#E6EDF3] transition-colors"
                                title="Add project"
                              >
                                + Project
                              </button>
                              <button
                                onClick={() => navigate("/crm/projects")}
                                className="text-xs font-semibold text-[#7D8590] hover:text-[#E6EDF3] transition-colors"
                                title="Add task"
                              >
                                + Task
                              </button>
                              <button
                                onClick={() => navigate("/email-activity")}
                                className="text-xs font-semibold text-[#7D8590] hover:text-[#E6EDF3] transition-colors"
                                title="Email client"
                              >
                                Email
                              </button>
                            </div>

                            {/* ⋯ menu button for more actions */}
                            <div className="relative">
                              <button
                                onClick={e => { e.stopPropagation(); setMenuOpenId(prev => prev === c.id ? null : c.id); }}
                                className={`text-muted-foreground hover:text-[#E6EDF3] transition-colors ${hoverRowId === c.id || menuOpenId === c.id ? "opacity-100" : "opacity-0 pointer-events-none"}`}
                                title="More actions"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z" />
                                </svg>
                              </button>

                              {menuOpenId === c.id && (
                                <div className="absolute right-0 top-full mt-1 z-20 w-44 bg-[#1C2128] border border-border rounded-xl shadow-xl overflow-hidden">
                                  {[
                                    { label: "View Client", action: () => { navigate(`/crm/clients/${c.id}`); setMenuOpenId(null); } },
                                    { label: "Edit Info", action: () => { handleEdit(c); setMenuOpenId(null); } },
                                    { label: "Email Activity", action: () => { setExpandedEmailId(prev => prev === c.id ? null : c.id); setExpandedSpId(null); setMenuOpenId(null); } },
                                    { label: "SharePoint Site", action: () => { setExpandedSpId(prev => prev === c.id ? null : c.id); setExpandedEmailId(null); setMenuOpenId(null); } },
                                    { label: "M365 Profile", action: () => { setM365ClientId(c.id); setMenuOpenId(null); } },
                                    { label: "Resend Invite", action: () => { void handleResendInvite(c); setMenuOpenId(null); } },
                                    { label: "View as Client", action: () => { void handleViewAs(c); setMenuOpenId(null); } },
                                    { label: "Generate Report", action: () => { navigate("/crm/reports"); setMenuOpenId(null); }, dim: true },
                                    { label: "Delete Client", action: () => { setDeleteTarget(c); setMenuOpenId(null); }, danger: true },
                                  ].map(({ label, action, danger, dim }) => (
                                    <button
                                      key={label}
                                      onClick={action}
                                      className={`w-full text-left text-xs px-3.5 py-2 hover:bg-[#30363D] transition-colors ${danger ? "text-red-400" : dim ? "text-muted-foreground" : "text-[#E6EDF3]"}`}
                                    >
                                      {label}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>

                      {expandedEmailId === c.id && (
                        <ClientEmailPanel key={`email-${c.id}`} client={c} onClose={() => setExpandedEmailId(null)} />
                      )}

                      {expandedSpId === c.id && (
                        <ClientSharePointPanel
                          key={`sp-${c.id}`}
                          client={c}
                          onClose={() => setExpandedSpId(null)}
                          onUpdate={patch => setClients(prev => prev.map(x => x.id === c.id ? { ...x, ...patch } : x))}
                        />
                      )}
                    </Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Bulk Action Bar ── */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-[#1C2128] border border-border rounded-xl px-5 py-3 shadow-xl">
          <span className="text-sm font-semibold text-[#E6EDF3]">{selectedIds.size} selected</span>
          <div className="w-px h-4 bg-border" />
          <button
            onClick={() => {
              toast({ title: "Send Status Email", description: `Status emails queued for ${selectedIds.size} client(s). (Coming soon)` });
            }}
            className="text-xs font-semibold text-white bg-[#0078D4] hover:bg-[#0078D4]/90 px-3 py-1.5 rounded-lg transition-colors"
          >
            Send Status Email
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-xs font-semibold text-muted-foreground hover:text-[#E6EDF3] transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {deleteTarget && (
        <DeleteConfirmDialog
          client={deleteTarget}
          onClose={() => { if (!deleting) setDeleteTarget(null); }}
          onConfirm={() => void handleDelete()}
          deleting={deleting}
        />
      )}

      {m365ClientId !== null && (
        <M365ProfileWizard
          clientId={m365ClientId}
          clientName={clients.find(c => c.id === m365ClientId)?.name ?? clients.find(c => c.id === m365ClientId)?.email ?? "Client"}
          onClose={() => setM365ClientId(null)}
        />
      )}
    </div>
  );
}
