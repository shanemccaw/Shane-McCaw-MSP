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

interface Client {
  id: number;
  email: string;
  name: string | null;
  company: string | null;
  phone: string | null;
  sharepointSiteUrl: string | null;
  sharepointSiteId: string | null;
  createdAt: string;
}

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

// ─── ClientEmailPanel ─────────────────────────────────────────────────────────
interface ClientEmailPanelProps {
  client: Client;
  onClose: () => void;
}

function ClientEmailPanel({ client, onClose }: ClientEmailPanelProps) {
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
      const res = await fetchWithAuth(
        `/api/admin/emails?domain=${encodeURIComponent(clientDomain)}&limit=50`
      );
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

  async function handleLink(emailId: number) {
    try {
      await assignEmail(emailId, client.id);
      await load();
    } catch {
      alert("Failed to link email");
    }
  }

  async function handleUnlink(emailId: number) {
    try {
      await assignEmail(emailId, null);
      await load();
    } catch {
      alert("Failed to unlink email");
    }
  }

  const linkedToThis = emails.filter(r => r.email.linkedUserId === client.id);
  const unlinked = emails.filter(r => r.email.linkedUserId === null);
  const linkedToOther = emails.filter(r => r.email.linkedUserId !== null && r.email.linkedUserId !== client.id);

  const hasAny = emails.length > 0;

  return (
    <tr>
      <td colSpan={5} className="px-0 py-0 bg-[#0078D4]/10/40 border-b border-blue-100">
        <div className="px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <span className="text-xs font-bold text-[#0078D4] uppercase tracking-widest">
                Email Activity
              </span>
              {clientDomain && (
                <span className="ml-2 text-xs text-[#7D8590] font-mono">@{clientDomain}</span>
              )}
            </div>
            <button
              onClick={onClose}
              className="text-[#7D8590] hover:text-[#7D8590] transition-colors"
              aria-label="Close"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 py-4 text-sm text-[#7D8590]">
              <div className="w-4 h-4 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
              Loading emails…
            </div>
          ) : error ? (
            <p className="text-sm text-red-400">{error}</p>
          ) : !hasAny ? (
            <p className="text-sm text-[#7D8590] py-2">
              No emails found from <span className="font-mono">@{clientDomain}</span>.
              {" "}Emails appear here as soon as they are ingested from the M365 mailbox.
            </p>
          ) : (
            <div className="space-y-4">
              {unlinked.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-amber-600 uppercase tracking-widest mb-2">
                    Unlinked · {unlinked.length}
                  </p>
                  <div className="space-y-1.5">
                    {unlinked.map(row => (
                      <div
                        key={row.email.id}
                        className="flex items-center gap-3 bg-[#161B22] border border-amber-100 rounded-lg px-3 py-2.5"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-[#E6EDF3] truncate">
                            {row.email.subject ?? "(no subject)"}
                          </p>
                          <p className="text-[10px] text-[#7D8590] truncate">
                            {row.email.senderAddress} · {timeAgo(row.email.receivedAt)}
                          </p>
                        </div>
                        <button
                          disabled={assigningId === row.email.id}
                          onClick={() => void handleLink(row.email.id)}
                          className="shrink-0 px-2.5 py-1 text-[11px] font-semibold bg-[#0078D4] text-white rounded-md hover:bg-[#005fa3] disabled:opacity-50 transition-colors whitespace-nowrap"
                        >
                          {assigningId === row.email.id ? "Linking…" : `Link to ${client.name ?? client.email}`}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {linkedToThis.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest mb-2">
                    Linked to this client · {linkedToThis.length}
                  </p>
                  <div className="space-y-1.5">
                    {linkedToThis.map(row => (
                      <div
                        key={row.email.id}
                        className="flex items-center gap-3 bg-[#161B22] border border-emerald-100 rounded-lg px-3 py-2.5"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-[#E6EDF3] truncate">
                            {row.email.subject ?? "(no subject)"}
                          </p>
                          <p className="text-[10px] text-[#7D8590] truncate">
                            {row.email.senderAddress} · {timeAgo(row.email.receivedAt)}
                          </p>
                        </div>
                        <button
                          disabled={assigningId === row.email.id}
                          onClick={() => void handleUnlink(row.email.id)}
                          className="shrink-0 px-2.5 py-1 text-[11px] font-semibold border border-[#30363D] text-[#7D8590] rounded-md hover:bg-[#1C2128] hover:text-red-400 hover:border-red-500/20 disabled:opacity-50 transition-colors"
                        >
                          {assigningId === row.email.id ? "Unlinking…" : "Unlink"}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {linkedToOther.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-[#7D8590] uppercase tracking-widest mb-2">
                    Linked to another client · {linkedToOther.length}
                  </p>
                  <div className="space-y-1.5">
                    {linkedToOther.map(row => (
                      <div
                        key={row.email.id}
                        className="flex items-center gap-3 bg-[#161B22] border border-[#30363D] rounded-lg px-3 py-2.5 opacity-60"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-[#E6EDF3] truncate">
                            {row.email.subject ?? "(no subject)"}
                          </p>
                          <p className="text-[10px] text-[#7D8590] truncate">
                            {row.email.senderAddress} · linked to {row.clientName ?? row.clientEmail} · {timeAgo(row.email.receivedAt)}
                          </p>
                        </div>
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
function ClientSharePointPanel({ client, onClose, onUpdate }: {
  client: Client;
  onClose: () => void;
  onUpdate: (patch: Pick<Client, "sharepointSiteUrl" | "sharepointSiteId">) => void;
}) {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const [urlInput, setUrlInput] = useState(client.sharepointSiteUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [addingOwner, setAddingOwner] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current !== null) clearInterval(pollRef.current);
    };
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetchWithAuth(`/api/admin/clients/${client.id}/sharepoint`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sharepointSiteUrl: urlInput || null }),
      });
      if (res.ok) {
        const data = await res.json() as { sharepointSiteUrl: string | null; sharepointSiteId: string | null };
        onUpdate({ sharepointSiteUrl: data.sharepointSiteUrl, sharepointSiteId: data.sharepointSiteId });
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleProvision() {
    setProvisioning(true);
    try {
      const res = await fetchWithAuth(`/api/admin/clients/${client.id}/sharepoint/provision`, {
        method: "POST",
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({} as Record<string, unknown>)) as { error?: string };
        toast({ title: d.error ?? "Provisioning failed", variant: "destructive" });
        setProvisioning(false);
        return;
      }

      const data = await res.json() as { provisioning?: boolean; alreadyProvisioned?: boolean; sharepointSiteUrl?: string };

      if (data.alreadyProvisioned && data.sharepointSiteUrl) {
        onUpdate({ sharepointSiteUrl: data.sharepointSiteUrl, sharepointSiteId: null });
        toast({ title: "Already linked", description: data.sharepointSiteUrl });
        setProvisioning(false);
        return;
      }

      toast({ title: "SharePoint provisioning started", description: "This may take up to a minute." });

      let polls = 0;
      const MAX_POLLS = 20;
      pollRef.current = setInterval(() => {
        polls++;
        void fetchWithAuth(`/api/admin/clients/${client.id}`).then(async r => {
          if (!r.ok) return;
          const c = await r.json() as { sharepointSiteUrl?: string | null; sharepointSiteId?: string | null };
          if (c.sharepointSiteUrl) {
            if (pollRef.current !== null) clearInterval(pollRef.current);
            pollRef.current = null;
            onUpdate({ sharepointSiteUrl: c.sharepointSiteUrl, sharepointSiteId: c.sharepointSiteId ?? null });
            toast({ title: "SharePoint site ready", description: c.sharepointSiteUrl });
            setProvisioning(false);
            return;
          }
          if (polls >= MAX_POLLS) {
            if (pollRef.current !== null) clearInterval(pollRef.current);
            pollRef.current = null;
            toast({ title: "Provisioning is taking longer than expected", description: "Refresh this page in a few minutes to see the link.", variant: "destructive" });
            setProvisioning(false);
          }
        });
      }, 3000);
    } catch {
      toast({ title: "Network error", variant: "destructive" });
      setProvisioning(false);
    }
  }

  async function handleAddOwner() {
    setAddingOwner(true);
    try {
      const res = await fetchWithAuth(`/api/admin/clients/${client.id}/sharepoint/add-owner`, {
        method: "POST",
      });
      if (res.ok) {
        toast({ title: "Owner added", description: "You have been added as a site owner." });
      } else {
        const d = await res.json().catch(() => ({} as Record<string, unknown>)) as { error?: string };
        toast({ title: "Failed to add owner", description: d.error ?? "Unknown error", variant: "destructive" });
      }
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    } finally {
      setAddingOwner(false);
    }
  }

  const siteUrl = client.sharepointSiteUrl;

  return (
    <tr>
      <td colSpan={5} className="px-0 py-0 bg-[#0078D4]/10/40 border-b border-blue-100">
        <div className="px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-[#0078D4] uppercase tracking-widest">SharePoint Site</span>
            <button onClick={onClose} className="text-[#7D8590] hover:text-[#7D8590] transition-colors" aria-label="Close">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {siteUrl ? (
            <div className="flex items-center gap-3 bg-[#161B22] border border-[#0078D4]/20 rounded-lg px-3 py-2.5 mb-3">
              <svg className="w-5 h-5 text-[#0078D4] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-[#E6EDF3]">Site linked</p>
                <a href={siteUrl} target="_blank" rel="noopener noreferrer"
                  className="text-[11px] text-[#0078D4] hover:underline truncate block">{siteUrl}</a>
              </div>
              <button onClick={() => void handleAddOwner()} disabled={addingOwner}
                className="flex-shrink-0 flex items-center gap-1.5 text-xs font-semibold border border-[#0078D4] text-[#0078D4] px-3 py-1.5 rounded-lg hover:bg-[#0078D4]/10 disabled:opacity-50 transition-colors">
                {addingOwner ? <span className="w-3 h-3 border-2 border-[#0078D4]/40 border-t-[#0078D4] rounded-full animate-spin inline-block" /> : null}
                {addingOwner ? "Adding…" : "Add me as owner"}
              </button>
              <a href={siteUrl} target="_blank" rel="noopener noreferrer"
                className="flex-shrink-0 text-xs font-semibold bg-[#0078D4] text-white px-3 py-1.5 rounded-lg hover:bg-[#005fa3] transition-colors">
                Open →
              </a>
            </div>
          ) : (
            <div className="flex items-center gap-3 bg-[#161B22] border border-[#30363D] rounded-lg px-3 py-2.5 mb-3">
              <svg className="w-5 h-5 text-[#7D8590] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              <p className="flex-1 text-xs text-[#7D8590]">No SharePoint site linked yet.</p>
              <button onClick={() => void handleProvision()} disabled={provisioning}
                className="flex-shrink-0 flex items-center gap-1.5 text-xs font-semibold bg-[#0078D4] text-white px-3 py-1.5 rounded-lg hover:bg-[#005fa3] disabled:opacity-50 transition-colors">
                {provisioning ? <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin inline-block" /> : null}
                {provisioning ? "Provisioning…" : "Auto-Provision"}
              </button>
            </div>
          )}

          <div>
            <p className="text-[10px] font-bold text-[#7D8590] uppercase tracking-widest mb-1.5">Manual URL</p>
            <div className="flex gap-2">
              <input type="url" value={urlInput} onChange={e => setUrlInput(e.target.value)}
                placeholder="https://tenant.sharepoint.com/sites/…"
                className="flex-1 border border-border rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-[#161B22]" />
              <button onClick={() => void handleSave()} disabled={saving}
                className="flex-shrink-0 text-xs font-semibold border border-[#0078D4] text-[#0078D4] px-3 py-1.5 rounded-lg hover:bg-[#0078D4]/10 disabled:opacity-50 transition-colors">
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}

// ─── DeleteConfirmDialog ──────────────────────────────────────────────────────
function DeleteConfirmDialog({
  client,
  onClose,
  onConfirm,
  deleting,
}: {
  client: Client;
  onClose: () => void;
  onConfirm: () => void;
  deleting: boolean;
}) {
  const { fetchWithAuth } = useAuth();
  const [preview, setPreview] = useState<DeletePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const loadPreview = useCallback(() => {
    setPreviewLoading(true);
    setPreviewError(null);
    fetchWithAuth(`/api/admin/clients/${client.id}/delete-preview`)
      .then(async res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setPreview(await res.json() as DeletePreview);
      })
      .catch(e => setPreviewError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setPreviewLoading(false));
  }, [client.id, fetchWithAuth]);

  useEffect(() => { loadPreview(); }, [loadPreview]);

  const clientLabel = client.name ?? client.email;

  const summaryItems: Array<{ label: string; count: number }> = preview
    ? [
        { label: "Projects", count: preview.projects },
        { label: "Invoices", count: preview.invoices },
        { label: "Contracts", count: preview.contracts },
        { label: "Messages", count: preview.messages },
        { label: "Services", count: preview.services },
        { label: "Reports", count: preview.reports },
        { label: "Status reports", count: preview.statusReports },
      ].filter(item => item.count > 0)
    : [];

  const hasWarnings = preview && (preview.unpaidInvoices > 0 || preview.hasActiveStripeSubscription);

  return (
    <Dialog open onOpenChange={open => { if (!open && !deleting) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-400">
            <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            Permanently delete client?
          </DialogTitle>
          <DialogDescription asChild>
            <div className="text-sm text-[#7D8590] mt-1">
              You are about to permanently delete <strong className="text-[#E6EDF3]">{clientLabel}</strong> and all their associated data. This cannot be undone.
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Dependency summary */}
          {previewLoading ? (
            <div className="flex items-center gap-2 py-3 text-sm text-[#7D8590]">
              <div className="w-4 h-4 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
              Checking what will be deleted…
            </div>
          ) : previewError ? (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
              <p className="text-sm font-semibold text-red-400 mb-1">Could not load dependency summary</p>
              <p className="text-xs text-red-400 mb-2">{previewError}</p>
              <p className="text-xs text-red-400 mb-3">Deletion is blocked until the summary loads successfully. This protects you from accidentally removing data you didn't know existed.</p>
              <button
                onClick={loadPreview}
                className="text-xs font-semibold text-red-400 border border-red-300 bg-[#161B22] px-3 py-1.5 rounded-lg hover:bg-red-500/10 transition-colors"
              >
                Retry
              </button>
            </div>
          ) : preview ? (
            <>
              {summaryItems.length === 0 ? (
                <div className="bg-[#161B22] border border-border rounded-lg px-4 py-3">
                  <p className="text-sm text-[#7D8590]">This client has no associated records. Only their account will be removed.</p>
                </div>
              ) : (
                <div className="bg-[#161B22] border border-border rounded-lg px-4 py-3">
                  <p className="text-xs font-semibold text-[#E6EDF3] uppercase tracking-wider mb-2">Will be permanently erased</p>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                    {summaryItems.map(item => (
                      <div key={item.label} className="flex items-center justify-between text-sm">
                        <span className="text-[#7D8590]">{item.label}</span>
                        <span className="font-semibold text-[#E6EDF3]">{item.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Warnings */}
              {hasWarnings && (
                <div className="bg-amber-500/100/10 border border-amber-500/20 rounded-lg px-4 py-3 space-y-1.5">
                  <p className="text-xs font-bold text-amber-400 uppercase tracking-wider">⚠ Warnings</p>
                  {preview.unpaidInvoices > 0 && (
                    <p className="text-sm text-amber-400">
                      This client has <strong>{preview.unpaidInvoices} unpaid invoice{preview.unpaidInvoices !== 1 ? "s" : ""}</strong>. Deleting will erase them without collecting payment.
                    </p>
                  )}
                  {preview.hasActiveStripeSubscription && (
                    <p className="text-sm text-amber-400">
                      This client has an <strong>active Stripe subscription</strong>. Cancel it in the Stripe dashboard before deleting to avoid continued billing.
                    </p>
                  )}
                </div>
              )}
            </>
          ) : null}
        </div>

        <DialogFooter className="flex gap-2 pt-2">
          <button
            onClick={onClose}
            disabled={deleting}
            className="flex-1 border border-border text-sm font-medium px-4 py-2 rounded-lg hover:bg-[#1C2128] disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={deleting || previewLoading || !!previewError}
            className="flex-1 flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50 transition-colors"
          >
            {deleting ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                Deleting…
              </>
            ) : (
              "Permanently delete"
            )}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function ClientsPage() {
  const [, navigate] = useLocation();
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Client | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [search, setSearch] = useState("");
  const [expandedClientId, setExpandedClientId] = useState<number | null>(null);
  const [expandedSpClientId, setExpandedSpClientId] = useState<number | null>(null);
  const [m365ClientId, setM365ClientId] = useState<number | null>(null);
  const [resendingInviteId, setResendingInviteId] = useState<number | null>(null);

  const load = async () => {
    const res = await fetchWithAuth("/api/admin/clients");
    if (res.ok) {
      const loaded = await res.json() as Client[];
      setClients(loaded);
      const params = new URLSearchParams(window.location.search);
      const m365Param = params.get("m365");
      if (m365Param) {
        const targetId = parseInt(m365Param, 10);
        if (!isNaN(targetId) && loaded.some(c => c.id === targetId)) {
          setM365ClientId(targetId);
        }
      }
    }
    setLoading(false);
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
          toast({ title: "Client created", description: `A portal invite has been sent to ${form.email}.` });
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

  const handleResendInvite = async (c: Client) => {
    setResendingInviteId(c.id);
    try {
      const res = await fetchWithAuth(`/api/admin/clients/${c.id}/resend-invite`, { method: "POST" });
      if (res.ok) {
        toast({ title: "Invite resent", description: `A new setup link was emailed to ${c.email}.` });
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

  const [viewAsLoading, setViewAsLoading] = useState<number | null>(null);

  const handleViewAs = async (c: Client) => {
    setViewAsLoading(c.id);
    try {
      const res = await fetchWithAuth(`/api/admin/impersonate/${c.id}`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json() as { error: string };
        alert(err.error ?? "Could not start impersonation session");
        return;
      }
      const data = await res.json() as { token: string };
      const url = `${CRM_PORTAL_BASE}/portal?impersonation_token=${encodeURIComponent(data.token)}`;
      window.open(url, "_blank", "noopener");
    } finally {
      setViewAsLoading(null);
    }
  };

  const handleEdit = (c: Client) => {
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
        toast({ title: "Client deleted", description: `${deleteTarget.name ?? deleteTarget.email} and all their data have been removed.` });
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

  function toggleEmails(clientId: number) {
    setExpandedClientId(prev => prev === clientId ? null : clientId);
    setExpandedSpClientId(null);
  }

  function toggleSp(clientId: number) {
    setExpandedSpClientId(prev => prev === clientId ? null : clientId);
    setExpandedClientId(null);
  }

  return (
    <div className="p-6 max-w-[1200px]">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-[#E6EDF3]">Clients</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Manage portal access for consulting clients. Use "View as Client" to preview the portal as any client.</p>
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

      <div className="mb-4 relative max-w-sm">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
        </svg>
        <input
          type="search"
          placeholder="Search by name, email or company…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-[#161B22]"
        />
      </div>

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
              <input type="email" required value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-[#1C2128] text-[#E6EDF3]" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">Name</label>
              <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-[#1C2128] text-[#E6EDF3]" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">Company</label>
              <input type="text" value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-[#1C2128] text-[#E6EDF3]" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#E6EDF3] mb-1">Phone</label>
              <input type="text" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-[#1C2128] text-[#E6EDF3]" />
            </div>
            {error && <div className="sm:col-span-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</div>}
            <div className="sm:col-span-2 flex gap-3">
              <button type="submit" disabled={saving} className="bg-[#0078D4] text-white text-sm font-semibold px-5 py-2 rounded-lg hover:bg-[#0078D4]/90 disabled:opacity-50 transition-colors">
                {saving ? "Saving…" : editingId ? "Save Changes" : "Create & Send Invite"}
              </button>
              <button type="button" onClick={() => { setShowForm(false); setEditingId(null); setError(""); }}
                className="border border-border text-sm font-medium px-5 py-2 rounded-lg hover:bg-[#1C2128] transition-colors">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
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
                <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden md:table-cell">Phone</th>
                <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden lg:table-cell">Added</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {filteredClients.length === 0 ? (
                <tr><td colSpan={5} className="px-5 py-8 text-center text-muted-foreground text-sm">No clients match your search.</td></tr>
              ) : filteredClients.map(c => (
                <>
                  <tr key={c.id} className={`border-b border-border last:border-0 hover:bg-[#1C2128] transition-colors ${expandedClientId === c.id ? "bg-[#0078D4]/10/30" : ""}`}>
                    <td className="px-5 py-3.5">
                      <button
                        onClick={() => navigate(`/crm/clients/${c.id}`)}
                        className="text-left group"
                      >
                        <p className="font-semibold text-[#E6EDF3] group-hover:text-[#0078D4] transition-colors">{c.name ?? "—"}</p>
                        <p className="text-xs text-muted-foreground">{c.email}</p>
                      </button>
                    </td>
                    <td className="px-5 py-3.5 text-muted-foreground hidden sm:table-cell">{c.company ?? "—"}</td>
                    <td className="px-5 py-3.5 text-muted-foreground hidden md:table-cell">{c.phone ?? "—"}</td>
                    <td className="px-5 py-3.5 text-xs text-muted-foreground hidden lg:table-cell">{new Date(c.createdAt).toLocaleDateString()}</td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3 flex-wrap justify-end">
                        <button
                          onClick={() => toggleEmails(c.id)}
                          className={`flex items-center gap-1 text-xs font-semibold transition-colors ${
                            expandedClientId === c.id
                              ? "text-[#0078D4]"
                              : "text-[#7D8590] hover:text-[#0078D4]"
                          }`}
                          title="View emails from this client's domain"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                          </svg>
                          Emails
                        </button>
                        <button
                          onClick={() => navigate(`/crm/clients/${c.id}`)}
                          className="text-xs font-semibold text-[#0078D4] hover:underline"
                        >
                          Details
                        </button>
                        <button onClick={() => handleEdit(c)} className="text-xs font-semibold text-[#7D8590] hover:text-[#0078D4]">Edit</button>
                        <button
                          onClick={() => void handleResendInvite(c)}
                          disabled={resendingInviteId === c.id}
                          className="flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800 disabled:opacity-50 transition-colors"
                          title="Send a new portal invite link to this client"
                        >
                          {resendingInviteId === c.id ? (
                            <span className="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin inline-block" />
                          ) : (
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                            </svg>
                          )}
                          {resendingInviteId === c.id ? "Sending…" : "Resend Invite"}
                        </button>
                        <button
                          onClick={() => handleViewAs(c)}
                          disabled={viewAsLoading === c.id}
                          className="flex items-center gap-1 text-xs font-semibold text-amber-600 hover:text-amber-400 hover:underline disabled:opacity-50 transition-colors"
                          title="Open the client portal as this client (read-only, 30 min session)"
                        >
                          {viewAsLoading === c.id ? (
                            <span className="w-3 h-3 border-2 border-amber-500 border-t-transparent rounded-full animate-spin inline-block" />
                          ) : (
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                          )}
                          View as Client
                        </button>
                        <button
                          onClick={() => toggleSp(c.id)}
                          className={`flex items-center gap-1 text-xs font-semibold transition-colors ${
                            expandedSpClientId === c.id
                              ? "text-[#0078D4]"
                              : "text-[#7D8590] hover:text-[#0078D4]"
                          }`}
                          title="Manage SharePoint site for this client"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                          </svg>
                          SharePoint
                          {c.sharepointSiteUrl && (
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                          )}
                        </button>
                        <button
                          onClick={() => setM365ClientId(c.id)}
                          className="flex items-center gap-1 text-xs font-semibold text-[#0078D4] hover:underline transition-colors"
                          title="View or edit Microsoft 365 environment profile for this client"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          M365 Profile
                        </button>
                        <button onClick={() => setDeleteTarget(c)} className="text-xs font-semibold text-red-500 hover:text-red-400">Delete</button>
                      </div>
                    </td>
                  </tr>
                  {expandedClientId === c.id && (
                    <ClientEmailPanel
                      key={`email-panel-${c.id}`}
                      client={c}
                      onClose={() => setExpandedClientId(null)}
                    />
                  )}
                  {expandedSpClientId === c.id && (
                    <ClientSharePointPanel
                      key={`sp-panel-${c.id}`}
                      client={c}
                      onClose={() => setExpandedSpClientId(null)}
                      onUpdate={patch => setClients(prev => prev.map(x => x.id === c.id ? { ...x, ...patch } : x))}
                    />
                  )}
                </>
              ))}
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
