import { useEffect, useRef, useState, useCallback } from "react";
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
          <div className="flex items-center justify-between mb-3">
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
      const data = await res.json() as { status: string; siteUrl?: string; sharepointSiteId?: string };
      if (data.status === "provisioned" && data.siteUrl) {
        setUrlInput(data.siteUrl);
        onUpdate({ sharepointSiteUrl: data.siteUrl, sharepointSiteId: data.sharepointSiteId ?? null });
        toast({ title: "SharePoint site provisioned" });
      } else {
        toast({ title: "Provisioning started", description: "The site is being created. Check back in a moment." });
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
          <div className="flex items-center justify-between mb-3">
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

  const filteredClients = clients.filter(c => {
    const q = search.toLowerCase();
    return (
      c.email.toLowerCase().includes(q) ||
      (c.name ?? "").toLowerCase().includes(q) ||
      (c.company ?? "").toLowerCase().includes(q)
    );
  });

  const inputCls =
    "w-full border border-border rounded-lg px-3 py-2 text-sm text-[#E6EDF3] focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-[#1C2128]";

  return (
    <div className="p-6 max-w-[1400px]">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-[#E6EDF3]">Clients</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {clients.length} client{clients.length !== 1 ? "s" : ""} — click a name to open the command center
          </p>
        </div>
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

      {/* ── Table ───────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : clients.length === 0 ? (
        <div className="bg-[#161B22] border border-border rounded-xl p-10 text-center text-muted-foreground text-sm">
          No clients yet. Add a client account to give them portal access.
        </div>
      ) : (
        <div className="bg-[#161B22] border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#1C2128] border-b border-border">
              <tr>
                <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Name / Email</th>
                <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden sm:table-cell">Company</th>
                <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden md:table-cell">Projects</th>
                <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden md:table-cell">Open Tasks</th>
                <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden lg:table-cell">M365 Score</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden xl:table-cell">Joined</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {filteredClients.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-muted-foreground text-sm">
                    No clients match your search.
                  </td>
                </tr>
              ) : (
                filteredClients.map(c => (
                  <>
                    <tr
                      key={c.id}
                      className={`border-b border-border last:border-0 hover:bg-[#1C2128] transition-colors ${expandedEmailId === c.id || expandedSpId === c.id ? "bg-[#1C2128]" : ""}`}
                    >
                      {/* Name / Email */}
                      <td className="px-5 py-3.5">
                        <button
                          onClick={() => navigate(`/crm/clients/${c.id}`)}
                          className="text-left group"
                        >
                          <p className="font-semibold text-[#E6EDF3] group-hover:text-[#0078D4] transition-colors leading-tight">
                            {c.name ?? <span className="text-[#484F58]">—</span>}
                          </p>
                          <p className="text-xs text-muted-foreground">{c.email}</p>
                        </button>
                      </td>

                      {/* Company */}
                      <td className="px-5 py-3.5 text-sm text-muted-foreground hidden sm:table-cell">
                        {c.company ?? "—"}
                      </td>

                      {/* Projects */}
                      <td className="px-4 py-3.5 text-center hidden md:table-cell">
                        {c.projectCount === 0 ? (
                          <span className="text-xs text-[#484F58]">—</span>
                        ) : (
                          <div className="inline-flex items-center gap-1">
                            {c.activeProjectCount > 0 && (
                              <span className="text-xs font-bold text-[#0078D4]">{c.activeProjectCount}</span>
                            )}
                            {c.projectCount > c.activeProjectCount && (
                              <span className="text-xs text-[#484F58]">
                                {c.activeProjectCount > 0 ? `+${c.projectCount - c.activeProjectCount}` : c.projectCount}
                              </span>
                            )}
                            {c.activeProjectCount > 0 && (
                              <span className="w-1.5 h-1.5 rounded-full bg-[#0078D4] inline-block" />
                            )}
                          </div>
                        )}
                      </td>

                      {/* Open Tasks */}
                      <td className="px-4 py-3.5 text-center hidden md:table-cell">
                        {c.openTaskCount === 0 ? (
                          <span className="text-xs text-[#484F58]">—</span>
                        ) : (
                          <span className={`text-xs font-bold tabular-nums ${c.openTaskCount > 5 ? "text-amber-400" : "text-[#E6EDF3]"}`}>
                            {c.openTaskCount}
                          </span>
                        )}
                      </td>

                      {/* M365 Score */}
                      <td className="px-4 py-3.5 text-center hidden lg:table-cell">
                        <div className="flex flex-col items-center gap-0.5">
                          <ScoreBadge score={c.quizScore} />
                          <TierBadge tier={c.quizTier} />
                        </div>
                      </td>

                      {/* Joined */}
                      <td className="px-4 py-3.5 text-xs text-muted-foreground hidden xl:table-cell whitespace-nowrap">
                        {new Date(c.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </td>

                      {/* Actions */}
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2.5 flex-wrap justify-end">
                          <button
                            onClick={() => navigate(`/crm/clients/${c.id}`)}
                            className="flex items-center gap-1 text-xs font-semibold text-[#0078D4] hover:underline"
                            title="Open command center"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                            </svg>
                            Open
                          </button>

                          <button
                            onClick={() => handleEdit(c)}
                            className="text-xs font-semibold text-[#7D8590] hover:text-[#E6EDF3]"
                          >
                            Edit
                          </button>

                          <button
                            onClick={() => { setExpandedEmailId(prev => prev === c.id ? null : c.id); setExpandedSpId(null); }}
                            className={`flex items-center gap-1 text-xs font-semibold transition-colors ${expandedEmailId === c.id ? "text-[#0078D4]" : "text-[#7D8590] hover:text-[#0078D4]"}`}
                            title="View email activity"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                            </svg>
                            Emails
                          </button>

                          <button
                            onClick={() => { setExpandedSpId(prev => prev === c.id ? null : c.id); setExpandedEmailId(null); }}
                            className={`flex items-center gap-1 text-xs font-semibold transition-colors ${expandedSpId === c.id ? "text-[#0078D4]" : "text-[#7D8590] hover:text-[#0078D4]"}`}
                            title="Manage SharePoint site"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                            </svg>
                            SP
                            {c.sharepointSiteUrl && (
                              <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                            )}
                          </button>

                          <button
                            onClick={() => setM365ClientId(c.id)}
                            className="flex items-center gap-1 text-xs font-semibold text-[#7D8590] hover:text-[#0078D4] transition-colors"
                            title="M365 environment profile"
                          >
                            M365
                          </button>

                          <button
                            onClick={() => void handleResendInvite(c)}
                            disabled={resendingInviteId === c.id}
                            className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 disabled:opacity-50 transition-colors"
                            title="Resend portal invite"
                          >
                            {resendingInviteId === c.id ? "Sending…" : "Invite"}
                          </button>

                          <button
                            onClick={() => void handleViewAs(c)}
                            disabled={viewAsLoading === c.id}
                            className="text-xs font-semibold text-amber-400 hover:text-amber-300 disabled:opacity-50 transition-colors"
                            title="View portal as this client"
                          >
                            {viewAsLoading === c.id ? "…" : "View as"}
                          </button>

                          <button
                            onClick={() => setDeleteTarget(c)}
                            className="text-xs font-semibold text-red-500 hover:text-red-400"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>

                    {expandedEmailId === c.id && (
                      <ClientEmailPanel
                        key={`email-${c.id}`}
                        client={c}
                        onClose={() => setExpandedEmailId(null)}
                      />
                    )}

                    {expandedSpId === c.id && (
                      <ClientSharePointPanel
                        key={`sp-${c.id}`}
                        client={c}
                        onClose={() => setExpandedSpId(null)}
                        onUpdate={patch => setClients(prev => prev.map(x => x.id === c.id ? { ...x, ...patch } : x))}
                      />
                    )}
                  </>
                ))
              )}
            </tbody>
          </table>
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
