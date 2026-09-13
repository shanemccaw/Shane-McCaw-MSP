import { useState, useEffect, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { Plus, Pencil, Trash2, Loader2, KeyRound, X, AlertTriangle, ShieldAlert } from "lucide-react";

interface AzureCredential {
  id: number;
  clientUserId: number | null;
  displayName: string;
  tenantId: string;
  clientId: string;
  credentialType: "secret" | "certificate";
  keyVaultSecretName: string;
  lastExpiryAlertSentAt: string | null;
  createdAt: string;
  updatedAt: string;
  expiresOn: string | null;
}

interface ClientOption {
  id: number;
  name: string | null;
  company: string | null;
  email: string;
}

interface ExpiringSummary {
  count: number;
  items: Array<{ id: number; displayName: string; clientUserId: number | null; expiresOn: string | null }>;
}

interface CredentialForm {
  displayName: string;
  tenantId: string;
  clientId: string;
  credentialType: "secret" | "certificate";
  clientUserId: string; // "" = unassigned
  keyVaultSecretName: string;
  clientSecretValue: string;
}

const EMPTY_FORM: CredentialForm = {
  displayName: "",
  tenantId: "",
  clientId: "",
  credentialType: "secret",
  clientUserId: "",
  keyVaultSecretName: "",
  clientSecretValue: "",
};

function clientLabel(client: ClientOption | undefined): string {
  if (!client) return "—";
  return client.company || client.name || client.email;
}

function formatExpiry(expiresOn: string | null): { text: string; expired: boolean; soon: boolean } {
  if (!expiresOn) return { text: "Unknown", expired: false, soon: false };
  const d = new Date(expiresOn);
  const now = new Date();
  const diffDays = (d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  const formatted = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return { text: formatted, expired: diffDays < 0, soon: diffDays >= 0 && diffDays <= 30 };
}

function formatDate(val: string) {
  return new Date(val).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function AzureCredentialsPage() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();

  const [credentials, setCredentials] = useState<AzureCredential[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [summary, setSummary] = useState<ExpiringSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<CredentialForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [credRes, clientRes, summaryRes] = await Promise.all([
        fetchWithAuth("/api/admin/azure-credentials"),
        fetchWithAuth("/api/admin/clients"),
        fetchWithAuth("/api/admin/azure-credentials/expiring-summary"),
      ]);
      if (credRes.ok) setCredentials(await credRes.json() as AzureCredential[]);
      if (clientRes.ok) setClients(await clientRes.json() as ClientOption[]);
      if (summaryRes.ok) setSummary(await summaryRes.json() as ExpiringSummary);
    } catch {
      toast({ title: "Failed to load Azure credentials", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, toast]);

  useEffect(() => { void load(); }, [load]);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError("");
    setShowForm(true);
  };

  const openEdit = (cred: AzureCredential) => {
    setEditingId(cred.id);
    setForm({
      displayName: cred.displayName,
      tenantId: cred.tenantId,
      clientId: cred.clientId,
      credentialType: cred.credentialType,
      clientUserId: cred.clientUserId != null ? String(cred.clientUserId) : "",
      keyVaultSecretName: cred.keyVaultSecretName,
      clientSecretValue: "",
    });
    setFormError("");
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError("");
  };

  const handleSave = async () => {
    if (!form.displayName.trim() || !form.tenantId.trim() || !form.clientId.trim()) {
      setFormError("Display name, Tenant ID, and Client ID are required.");
      return;
    }
    if (!editingId && !form.keyVaultSecretName.trim() && !form.clientSecretValue.trim()) {
      setFormError("Provide either a Key Vault secret name or a client secret value.");
      return;
    }

    setSaving(true);
    setFormError("");
    try {
      const body: Record<string, unknown> = {
        displayName: form.displayName.trim(),
        tenantId: form.tenantId.trim(),
        clientId: form.clientId.trim(),
        credentialType: form.credentialType,
        clientUserId: form.clientUserId ? Number(form.clientUserId) : null,
      };
      if (form.clientSecretValue.trim()) {
        body.clientSecretValue = form.clientSecretValue.trim();
      } else if (form.keyVaultSecretName.trim()) {
        body.keyVaultSecretName = form.keyVaultSecretName.trim();
      }

      const url = editingId ? `/api/admin/azure-credentials/${editingId}` : "/api/admin/azure-credentials";
      const method = editingId ? "PUT" : "POST";
      const res = await fetchWithAuth(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        setFormError(data.error ?? "Failed to save credential.");
        return;
      }

      toast({ title: editingId ? "Credential updated" : "Credential created" });
      closeForm();
      await load();
    } catch {
      setFormError("Network error saving credential.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (cred: AzureCredential) => {
    if (!window.confirm(`Delete the Azure credential "${cred.displayName}"? This cannot be undone.`)) return;
    setDeletingId(cred.id);
    try {
      const res = await fetchWithAuth(`/api/admin/azure-credentials/${cred.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast({ title: "Credential deleted" });
      await load();
    } catch {
      toast({ title: "Failed to delete credential", variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-6xl">
      <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <KeyRound className="w-6 h-6 text-primary" />
            Azure Tenant Credentials
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Per-customer Azure app registrations used by the Script Runner / PowerShell execution
            engine. Secret values are stored in Key Vault — this list only carries metadata.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 bg-primary text-white text-sm font-semibold px-4 py-2 rounded-xl hover:bg-[#005A9E] transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add credential
        </button>
      </div>

      {summary && summary.count > 0 && (
        <div className="mb-6 bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 flex gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-400">
              {summary.count} credential{summary.count === 1 ? "" : "s"} expiring soon
            </p>
            <ul className="text-xs text-amber-400 mt-1 space-y-0.5">
              {summary.items.map(item => (
                <li key={item.id}>
                  {item.displayName}
                  {item.expiresOn ? ` — expires ${formatDate(item.expiresOn)}` : ""}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {showForm && (
        <div className="bg-card border border-border rounded-2xl p-5 mb-6 shadow-sm">
          <div className="flex items-center justify-between flex-wrap gap-4 mb-4">
            <h2 className="font-bold text-foreground text-sm flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-primary" />
              {editingId ? "Edit Credential" : "Add Credential"}
            </h2>
            <button onClick={closeForm} className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">Display name <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={form.displayName}
                onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))}
                placeholder="Contoso — Script Runner App"
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">Client (customer)</label>
              <select
                value={form.clientUserId}
                onChange={e => setForm(f => ({ ...f, clientUserId: e.target.value }))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-background"
              >
                <option value="">Unassigned</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>{clientLabel(c)}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">Tenant ID <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={form.tenantId}
                onChange={e => setForm(f => ({ ...f, tenantId: e.target.value }))}
                placeholder="00000000-0000-0000-0000-000000000000"
                className="w-full border border-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">App (client) ID <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={form.clientId}
                onChange={e => setForm(f => ({ ...f, clientId: e.target.value }))}
                placeholder="00000000-0000-0000-0000-000000000000"
                className="w-full border border-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">Credential type</label>
              <div className="flex gap-2">
                {(["secret", "certificate"] as const).map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, credentialType: t }))}
                    className={`flex-1 py-2 text-xs font-semibold rounded-lg border transition-colors capitalize ${
                      form.credentialType === t
                        ? "bg-primary text-white border-primary"
                        : "border-border text-muted-foreground hover:border-primary hover:text-primary"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">Key Vault secret name</label>
              <input
                type="text"
                value={form.keyVaultSecretName}
                onChange={e => setForm(f => ({ ...f, keyVaultSecretName: e.target.value }))}
                placeholder="Leave blank if providing a secret value below"
                disabled={!!form.clientSecretValue.trim()}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Reference an existing Key Vault secret, or paste the raw secret value instead —
                never both.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">Client secret value</label>
              <input
                type="password"
                value={form.clientSecretValue}
                onChange={e => setForm(f => ({ ...f, clientSecretValue: e.target.value }))}
                placeholder="Paste to write a new secret to Key Vault"
                disabled={!!form.keyVaultSecretName.trim()}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Written directly to Key Vault on save; never stored in this table or returned by
                the API afterward.
              </p>
            </div>
          </div>

          {formError && (
            <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mt-4">{formError}</p>
          )}

          <div className="flex items-center gap-3 mt-5 pt-4 border-t border-border">
            <button
              onClick={() => void handleSave()}
              disabled={saving}
              className="flex items-center gap-2 bg-primary text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[#005A9E] disabled:opacity-50 transition-colors"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              {saving ? "Saving…" : editingId ? "Update Credential" : "Create Credential"}
            </button>
            <button onClick={closeForm} className="text-sm text-muted-foreground hover:text-foreground px-3 py-2">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground gap-2 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading Azure credentials…
          </div>
        ) : credentials.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-6">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
              <KeyRound className="w-6 h-6 text-primary" />
            </div>
            <p className="font-semibold text-foreground mb-1">No Azure credentials yet</p>
            <p className="text-sm text-muted-foreground mb-4">
              Add a customer's Azure app registration to enable Script Runner / PowerShell
              execution for their tenant.
            </p>
            <button
              onClick={openCreate}
              className="flex items-center gap-2 bg-primary text-white text-sm font-semibold px-4 py-2 rounded-xl hover:bg-[#005A9E] transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add credential
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-accent border-b border-border text-left">
                  <th className="px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">Display name</th>
                  <th className="px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">Client</th>
                  <th className="px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">Type</th>
                  <th className="px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">Tenant ID</th>
                  <th className="px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">Expires</th>
                  <th className="px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider w-24"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {credentials.map(cred => {
                  const client = clients.find(c => c.id === cred.clientUserId);
                  const expiry = formatExpiry(cred.expiresOn);
                  return (
                    <tr key={cred.id} className="hover:bg-accent/50 transition-colors">
                      <td className="px-4 py-3 font-medium text-foreground">{cred.displayName}</td>
                      <td className="px-4 py-3 text-foreground/80">{clientLabel(client)}</td>
                      <td className="px-4 py-3 text-foreground/80 capitalize">{cred.credentialType}</td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{cred.tenantId}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 text-xs ${
                          expiry.expired ? "text-red-400 font-semibold" : expiry.soon ? "text-amber-400 font-semibold" : "text-muted-foreground"
                        }`}>
                          {(expiry.expired || expiry.soon) && <ShieldAlert className="w-3.5 h-3.5" />}
                          {expiry.text}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 justify-end">
                          <button
                            onClick={() => openEdit(cred)}
                            className="p-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
                            title="Edit"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => void handleDelete(cred)}
                            disabled={deletingId === cred.id}
                            className="p-1.5 text-muted-foreground hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-50"
                            title="Delete"
                          >
                            {deletingId === cred.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
