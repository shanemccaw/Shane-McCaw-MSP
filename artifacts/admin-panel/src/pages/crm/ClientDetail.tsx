import { useEffect, useState, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

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

const EXPIRY_WARN_DAYS = 60;

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function ExpiryBadge({ expiresOn }: { expiresOn: string | null }) {
  if (!expiresOn) return null;
  const days = daysUntil(expiresOn);
  if (days > EXPIRY_WARN_DAYS) return null;

  const expired = days <= 0;
  const critical = days > 0 && days <= 14;
  const color = expired
    ? "bg-red-500/15 text-red-400 border-red-500/20"
    : critical
      ? "bg-red-100 text-red-400 border-red-500/20"
      : "bg-amber-500/100/15 text-amber-400 border-amber-500/20";
  const label = expired
    ? "Expired"
    : `Expires in ${days} day${days !== 1 ? "s" : ""}`;

  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold border px-2 py-0.5 rounded-full ${color}`}>
      <svg className="w-2.5 h-2.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      {label}
    </span>
  );
}

interface CredForm {
  displayName: string;
  tenantId: string;
  appClientId: string;
  credentialType: "secret" | "certificate";
  clientSecretValue: string;
  keyVaultSecretName: string;
  showAdvanced: boolean;
}

const EMPTY_CRED: CredForm = {
  displayName: "",
  tenantId: "",
  appClientId: "",
  credentialType: "secret",
  clientSecretValue: "",
  keyVaultSecretName: "",
  showAdvanced: false,
};

const inputCls =
  "w-full border border-border rounded-lg px-3 py-2 text-sm text-[#E6EDF3] focus:outline-none focus:ring-2 focus:ring-[#0078D4]/40 bg-[#161B22]";
const labelCls =
  "block text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className={labelCls}>{label}</p>
      <p className="text-sm text-[#E6EDF3]">{value ?? "—"}</p>
    </div>
  );
}

export default function ClientDetailPage() {
  const params = useParams<{ id: string }>();
  const clientId = Number(params.id);
  const [, navigate] = useLocation();
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();

  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [editingInfo, setEditingInfo] = useState(false);
  const [infoForm, setInfoForm] = useState({ name: "", email: "", company: "", phone: "" });
  const [savingInfo, setSavingInfo] = useState(false);

  const [azureCred, setAzureCred] = useState<AzureCredential | null | undefined>(undefined);
  const [credLoading, setCredLoading] = useState(true);
  const [editingCred, setEditingCred] = useState(false);
  const [credForm, setCredForm] = useState<CredForm>(EMPTY_CRED);
  const [savingCred, setSavingCred] = useState(false);
  const [deletingCred, setDeletingCred] = useState(false);

  const [appReg, setAppReg] = useState<AppRegRecord | null | undefined>(undefined);
  const [appRegLoading, setAppRegLoading] = useState(true);
  const [verifyingAppReg, setVerifyingAppReg] = useState(false);

  const [viewAsLoading, setViewAsLoading] = useState(false);

  const [mfaMethods, setMfaMethods] = useState<string[]>([]);
  const [mfaLoading, setMfaLoading] = useState(true);
  const [resettingMfa, setResettingMfa] = useState(false);
  const [showMfaConfirm, setShowMfaConfirm] = useState(false);

  const CRM_PORTAL_BASE = `${window.location.protocol}//${window.location.host}/crm`;

  const loadClient = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetchWithAuth(`/api/admin/clients/${clientId}`);
      if (!res.ok) {
        setLoadError(res.status === 404 ? "Client not found." : `HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as Client;
      setClient(data);
    } catch {
      setLoadError("Failed to load client.");
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, clientId]);

  const loadAzureCred = useCallback(async () => {
    setCredLoading(true);
    try {
      const res = await fetchWithAuth(`/api/admin/clients/${clientId}/azure-credential`);
      if (!res.ok) {
        setAzureCred(null);
        return;
      }
      const data = (await res.json()) as AzureCredential | null;
      setAzureCred(data);
    } finally {
      setCredLoading(false);
    }
  }, [fetchWithAuth, clientId]);

  const loadAppReg = useCallback(async () => {
    setAppRegLoading(true);
    try {
      const res = await fetchWithAuth(`/api/admin/clients/${clientId}/app-registration`);
      if (!res.ok) { setAppReg(null); return; }
      const data = (await res.json()) as AppRegRecord | null;
      setAppReg(data);
    } finally {
      setAppRegLoading(false);
    }
  }, [fetchWithAuth, clientId]);

  const loadMfaMethods = useCallback(async () => {
    setMfaLoading(true);
    try {
      const res = await fetchWithAuth(`/api/admin/clients/${clientId}/mfa-status`);
      if (!res.ok) { setMfaMethods([]); return; }
      const data = (await res.json()) as { methods: string[] };
      setMfaMethods(data.methods);
    } finally {
      setMfaLoading(false);
    }
  }, [fetchWithAuth, clientId]);

  useEffect(() => {
    if (!isNaN(clientId)) {
      void loadClient();
      void loadAzureCred();
      void loadAppReg();
      void loadMfaMethods();
    }
  }, [loadClient, loadAzureCred, loadAppReg, loadMfaMethods, clientId]);

  async function handleSetAppRegStatus(status: "verified" | "submitted" | "pending") {
    setVerifyingAppReg(true);
    try {
      const res = await fetchWithAuth(`/api/admin/clients/${clientId}/app-registration`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error: string };
        toast({ title: "Failed", description: err.error, variant: "destructive" });
        return;
      }
      await loadAppReg();
      toast({ title: status === "verified" ? "App Registration verified" : "Status updated" });
    } finally {
      setVerifyingAppReg(false);
    }
  }

  function startEditInfo() {
    if (!client) return;
    setInfoForm({
      name: client.name ?? "",
      email: client.email,
      company: client.company ?? "",
      phone: client.phone ?? "",
    });
    setEditingInfo(true);
  }

  async function handleSaveInfo(e: React.FormEvent) {
    e.preventDefault();
    if (!client) return;
    setSavingInfo(true);
    try {
      const res = await fetchWithAuth(`/api/admin/clients/${client.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(infoForm),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error: string };
        toast({ title: "Save failed", description: err.error, variant: "destructive" });
        return;
      }
      const updated = (await res.json()) as Client;
      setClient(updated);
      setEditingInfo(false);
      toast({ title: "Client updated" });
    } finally {
      setSavingInfo(false);
    }
  }

  function startAddCred() {
    if (!client) return;
    setCredForm({
      ...EMPTY_CRED,
      displayName: client.company ?? client.name ?? "",
    });
    setEditingCred(true);
  }

  function startEditCred() {
    if (!azureCred) return;
    setCredForm({
      displayName: azureCred.displayName,
      tenantId: azureCred.tenantId,
      appClientId: azureCred.clientId,
      credentialType: azureCred.credentialType,
      clientSecretValue: "",
      keyVaultSecretName: azureCred.keyVaultSecretName,
      showAdvanced: azureCred.credentialType === "certificate",
    });
    setEditingCred(true);
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
      if (credForm.clientSecretValue.trim() !== "") {
        payload.clientSecretValue = credForm.clientSecretValue.trim();
      } else {
        payload.keyVaultSecretName = credForm.keyVaultSecretName;
      }
      const res = await fetchWithAuth(`/api/admin/clients/${clientId}/azure-credential`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error: string };
        toast({ title: "Save failed", description: err.error, variant: "destructive" });
        return;
      }
      const updated = (await res.json()) as AzureCredential;
      setAzureCred(updated);
      setEditingCred(false);
      toast({ title: azureCred ? "Azure credential updated" : "Azure credential added" });
    } finally {
      setSavingCred(false);
    }
  }

  async function handleDeleteCred() {
    if (!confirm("Remove the Azure credential from this client? This cannot be undone.")) return;
    setDeletingCred(true);
    try {
      const res = await fetchWithAuth(`/api/admin/clients/${clientId}/azure-credential`, {
        method: "DELETE",
      });
      if (res.ok) {
        setAzureCred(null);
        toast({ title: "Azure credential removed" });
      } else {
        toast({ title: "Failed to remove credential", variant: "destructive" });
      }
    } finally {
      setDeletingCred(false);
    }
  }

  const MFA_LABELS: Record<string, string> = {
    totp: "Authenticator App (TOTP)",
    sms: "SMS",
    passkey: "Passkey / Biometric",
  };

  async function handleMfaReset() {
    setResettingMfa(true);
    try {
      const res = await fetchWithAuth(`/api/admin/clients/${clientId}/mfa-reset`, { method: "POST" });
      if (!res.ok) {
        const err = (await res.json()) as { error: string };
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

  async function handleViewAs() {
    if (!client) return;
    setViewAsLoading(true);
    try {
      const res = await fetchWithAuth(`/api/admin/impersonate/${client.id}`, { method: "POST" });
      if (!res.ok) {
        const err = (await res.json()) as { error: string };
        toast({ title: "Cannot impersonate", description: err.error, variant: "destructive" });
        return;
      }
      const data = (await res.json()) as { token: string };
      window.open(
        `${CRM_PORTAL_BASE}/portal?impersonation_token=${encodeURIComponent(data.token)}`,
        "_blank",
        "noopener"
      );
    } finally {
      setViewAsLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center py-24">
        <div className="w-6 h-6 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (loadError || !client) {
    return (
      <div className="p-6">
        <button
          onClick={() => navigate("/crm/clients")}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-[#0078D4] transition-colors mb-4"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          All Clients
        </button>
        <p className="text-sm text-red-400">{loadError ?? "Client not found."}</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl space-y-6">

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div>
        <button
          onClick={() => navigate("/crm/clients")}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-[#0078D4] transition-colors mb-3"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          All Clients
        </button>

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold text-[#E6EDF3]">
              {client.name ?? client.email}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">{client.email}</p>
            {client.company && (
              <p className="text-xs text-muted-foreground">{client.company}</p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => void handleViewAs()}
              disabled={viewAsLoading}
              className="flex items-center gap-1.5 text-xs font-semibold border border-border px-3 py-1.5 rounded-lg hover:bg-[#1C2128] disabled:opacity-50 transition-colors"
              title="Open the client portal as this client (30 min session)"
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
      </div>

      {/* ── Client Information ──────────────────────────────────────── */}
      <div className="bg-[#161B22] border border-border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-[#1C2128]">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Client Information
          </p>
          {!editingInfo && (
            <button
              onClick={startEditInfo}
              className="text-xs font-semibold text-[#0078D4] hover:underline"
            >
              Edit
            </button>
          )}
        </div>

        {editingInfo ? (
          <form onSubmit={handleSaveInfo} className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Email *</label>
              <input
                type="email"
                required
                value={infoForm.email}
                onChange={e => setInfoForm(f => ({ ...f, email: e.target.value }))}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Full Name</label>
              <input
                type="text"
                value={infoForm.name}
                onChange={e => setInfoForm(f => ({ ...f, name: e.target.value }))}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Company</label>
              <input
                type="text"
                value={infoForm.company}
                onChange={e => setInfoForm(f => ({ ...f, company: e.target.value }))}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Phone</label>
              <input
                type="tel"
                value={infoForm.phone}
                onChange={e => setInfoForm(f => ({ ...f, phone: e.target.value }))}
                className={inputCls}
              />
            </div>
            <div className="sm:col-span-2 flex gap-2">
              <button
                type="submit"
                disabled={savingInfo}
                className="bg-[#0078D4] text-white text-xs font-semibold px-4 py-1.5 rounded-lg hover:bg-[#0078D4]/90 disabled:opacity-50 transition-colors"
              >
                {savingInfo ? "Saving…" : "Save Changes"}
              </button>
              <button
                type="button"
                onClick={() => setEditingInfo(false)}
                className="border border-border text-xs font-medium px-4 py-1.5 rounded-lg hover:bg-[#1C2128] transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="p-5 grid grid-cols-2 sm:grid-cols-4 gap-5">
            <Field label="Email" value={client.email} />
            <Field label="Name" value={client.name} />
            <Field label="Company" value={client.company} />
            <Field label="Phone" value={client.phone} />
            <Field
              label="Member Since"
              value={new Date(client.createdAt).toLocaleDateString("en-US", {
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            />
            {client.sharepointSiteUrl && (
              <div className="col-span-2 sm:col-span-3">
                <p className={labelCls}>SharePoint Site</p>
                <a
                  href={client.sharepointSiteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-[#0078D4] hover:underline truncate block"
                >
                  {client.sharepointSiteUrl}
                </a>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Two-Factor Authentication ───────────────────────────────── */}
      <div className="bg-[#161B22] border border-border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-[#1C2128]">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Two-Factor Authentication
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              MFA methods currently enrolled for this client
            </p>
          </div>
          {!mfaLoading && mfaMethods.length > 0 && !showMfaConfirm && (
            <button
              onClick={() => setShowMfaConfirm(true)}
              className="flex items-center gap-1.5 text-xs font-semibold text-red-400 border border-red-500/20 bg-red-500/10 px-3 py-1.5 rounded-lg hover:bg-red-500/20 transition-colors flex-shrink-0"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
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
                <p className="text-[11px] text-red-400 mt-0.5">
                  This will permanently remove the following method{mfaMethods.length !== 1 ? "s" : ""} and send a notification email to the client:
                </p>
                <ul className="mt-2 space-y-1">
                  {mfaMethods.map(m => (
                    <li key={m} className="flex items-center gap-1.5 text-[11px] font-semibold text-red-400">
                      <span className="w-1 h-1 rounded-full bg-red-500 flex-shrink-0" />
                      {MFA_LABELS[m] ?? m}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => void handleMfaReset()}
                disabled={resettingMfa}
                className="flex items-center gap-1.5 text-xs font-semibold bg-red-600 text-white px-4 py-1.5 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {resettingMfa ? (
                  <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                ) : null}
                {resettingMfa ? "Resetting…" : "Yes, reset MFA"}
              </button>
              <button
                type="button"
                onClick={() => setShowMfaConfirm(false)}
                disabled={resettingMfa}
                className="border border-border text-xs font-medium px-4 py-1.5 rounded-lg hover:bg-[#1C2128] disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : mfaMethods.length > 0 ? (
          <div className="p-5 flex flex-wrap gap-2">
            {mfaMethods.map(m => (
              <span
                key={m}
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-green-500/15 text-green-400 border border-green-500/20"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                {MFA_LABELS[m] ?? m}
              </span>
            ))}
          </div>
        ) : (
          <div className="p-5">
            <p className="text-sm text-muted-foreground">No MFA methods enrolled — this client signs in with password only.</p>
          </div>
        )}
      </div>

      {/* ── Azure / Script Runner Credential ───────────────────────── */}
      <div className="bg-[#161B22] border border-border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-[#1C2128]">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Script Runner · Azure Tenant Credential
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              App Registration used to run PowerShell runbooks against this client's M365 tenant
            </p>
          </div>

          {!editingCred && !credLoading && (
            azureCred ? (
              <div className="flex items-center gap-3 flex-shrink-0">
                <button
                  onClick={startEditCred}
                  className="text-xs font-semibold text-[#0078D4] hover:underline"
                >
                  Edit
                </button>
                <button
                  onClick={() => void handleDeleteCred()}
                  disabled={deletingCred}
                  className="text-xs font-semibold text-red-500 hover:text-red-400 disabled:opacity-50 transition-colors"
                >
                  {deletingCred ? "Removing…" : "Remove"}
                </button>
              </div>
            ) : (
              <button
                onClick={startAddCred}
                className="flex items-center gap-1.5 text-xs font-semibold bg-[#0078D4] text-white px-3 py-1.5 rounded-lg hover:bg-[#0078D4]/90 transition-colors flex-shrink-0"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                Add Credential
              </button>
            )
          )}
        </div>

        {credLoading ? (
          <div className="p-5 flex items-center gap-2 text-sm text-[#7D8590]">
            <div className="w-4 h-4 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
            Loading…
          </div>
        ) : editingCred ? (
          <form onSubmit={handleSaveCred} className="p-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Display Name *</label>
                <input
                  required
                  className={inputCls}
                  placeholder="Contoso Corp"
                  value={credForm.displayName}
                  onChange={e => setCredForm(f => ({ ...f, displayName: e.target.value }))}
                />
              </div>
              <div>
                <label className={labelCls}>Credential Type</label>
                <select
                  className={inputCls}
                  value={credForm.credentialType}
                  onChange={e =>
                    setCredForm(f => ({ ...f, credentialType: e.target.value as "secret" | "certificate" }))
                  }
                >
                  <option value="secret">Client Secret</option>
                  <option value="certificate">Certificate</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Tenant ID *</label>
                <input
                  required
                  className={inputCls}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  value={credForm.tenantId}
                  onChange={e => setCredForm(f => ({ ...f, tenantId: e.target.value }))}
                />
              </div>
              <div>
                <label className={labelCls}>Client ID (App Registration) *</label>
                <input
                  required
                  className={inputCls}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  value={credForm.appClientId}
                  onChange={e => setCredForm(f => ({ ...f, appClientId: e.target.value }))}
                />
              </div>
              {credForm.credentialType === "secret" && (
                <div className="sm:col-span-2">
                  <label className={labelCls}>Client Secret Value</label>
                  <input
                    type="password"
                    autoComplete="new-password"
                    className={inputCls}
                    placeholder={azureCred ? "Leave blank to keep existing secret" : "Paste the App Registration client secret"}
                    value={credForm.clientSecretValue}
                    onChange={e => setCredForm(f => ({ ...f, clientSecretValue: e.target.value }))}
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Stored directly in Key Vault — write-only, never shown again
                  </p>
                </div>
              )}

              {/* Advanced: manual Key Vault secret name (certificates or pre-existing secrets) */}
              <div className="sm:col-span-2">
                <button
                  type="button"
                  onClick={() => setCredForm(f => ({ ...f, showAdvanced: !f.showAdvanced }))}
                  className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-[#0078D4] transition-colors"
                >
                  <svg
                    className={`w-3 h-3 transition-transform ${credForm.showAdvanced ? "rotate-90" : ""}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                  Advanced — enter an existing Key Vault secret name directly
                </button>

                {credForm.showAdvanced && (
                  <div className="mt-2">
                    <input
                      required={credForm.clientSecretValue.trim() === "" || credForm.credentialType === "certificate"}
                      className={inputCls}
                      placeholder="contoso-client-secret"
                      value={credForm.keyVaultSecretName}
                      onChange={e => setCredForm(f => ({ ...f, keyVaultSecretName: e.target.value }))}
                    />
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Name of an existing secret in Azure Key Vault — use for certificate credentials or pre-provisioned secrets
                    </p>
                  </div>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={savingCred}
                className="bg-[#0078D4] text-white text-xs font-semibold px-4 py-1.5 rounded-lg hover:bg-[#0078D4]/90 disabled:opacity-50 transition-colors"
              >
                {savingCred ? "Saving…" : azureCred ? "Save Changes" : "Add Credential"}
              </button>
              <button
                type="button"
                onClick={() => setEditingCred(false)}
                className="border border-border text-xs font-medium px-4 py-1.5 rounded-lg hover:bg-[#1C2128] transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : azureCred ? (
          <div className="p-5 space-y-4">
            {azureCred.expiresOn && daysUntil(azureCred.expiresOn) <= EXPIRY_WARN_DAYS && (
              <div className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${daysUntil(azureCred.expiresOn) <= 0 ? "bg-red-500/10 border-red-500/20" : daysUntil(azureCred.expiresOn) <= 14 ? "bg-red-500/10 border-red-500/20" : "bg-amber-500/100/10 border-amber-500/20"}`}>
                <svg className={`w-4 h-4 flex-shrink-0 mt-0.5 ${daysUntil(azureCred.expiresOn) <= 14 ? "text-red-500" : "text-amber-500"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>
                  <p className={`text-xs font-bold ${daysUntil(azureCred.expiresOn) <= 14 ? "text-red-400" : "text-amber-400"}`}>
                    {daysUntil(azureCred.expiresOn) <= 0
                      ? "Client secret has expired — Script Runner will fail for this client"
                      : `Client secret expires in ${daysUntil(azureCred.expiresOn)} day${daysUntil(azureCred.expiresOn) !== 1 ? "s" : ""} — rotate it before it expires`}
                  </p>
                  <p className={`text-[11px] mt-0.5 ${daysUntil(azureCred.expiresOn) <= 14 ? "text-red-400" : "text-amber-400"}`}>
                    Expiry: {new Date(azureCred.expiresOn).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                    {" — "}Create a new client secret in Azure AD, then update this credential.
                  </p>
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-5">
              <div>
                <p className={labelCls}>Display Name</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm text-[#E6EDF3]">{azureCred.displayName}</p>
                  <ExpiryBadge expiresOn={azureCred.expiresOn} />
                </div>
              </div>
              <Field
                label="Credential Type"
                value={azureCred.credentialType === "certificate" ? "Certificate" : "Client Secret"}
              />
              <Field
                label="Last Updated"
                value={new Date(azureCred.updatedAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              />
              <div>
                <p className={labelCls}>Tenant ID</p>
                <p className="text-xs text-[#E6EDF3] font-mono break-all">{azureCred.tenantId}</p>
              </div>
              <div>
                <p className={labelCls}>Client ID (App Reg)</p>
                <p className="text-xs text-[#E6EDF3] font-mono break-all">{azureCred.clientId}</p>
              </div>
              <div>
                <p className={labelCls}>Key Vault Secret</p>
                <p className="text-xs text-[#E6EDF3] font-mono">{azureCred.keyVaultSecretName}</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-5">
            <p className="text-sm text-muted-foreground">
              No Azure credential linked. Click{" "}
              <button
                onClick={startAddCred}
                className="text-[#0078D4] hover:underline font-semibold"
              >
                Add Credential
              </button>{" "}
              to enable Script Runner for this client.
            </p>
          </div>
        )}
      </div>

      {/* ── Automation Credentials (client-submitted App Registration) ─── */}
      <div className="bg-[#161B22] border border-border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-[#1C2128]">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Automation Credentials · Client App Registration
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Submitted by the client via the portal — used to run PowerShell runbooks in their tenant
            </p>
          </div>
        </div>

        {appRegLoading ? (
          <div className="p-5 flex items-center gap-2 text-sm text-[#7D8590]">
            <div className="w-4 h-4 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
            Loading…
          </div>
        ) : appReg ? (
          <div className="p-5 space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              {appReg.status === "verified" ? (
                <span className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full bg-green-500/15 text-green-400 border border-green-500/20">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                  Verified
                </span>
              ) : appReg.status === "submitted" ? (
                <span className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full bg-amber-500/100/15 text-amber-400 border border-amber-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500/100" />
                  Submitted · Pending Verification
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full bg-red-500/15 text-red-400 border border-red-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                  Pending
                </span>
              )}
              <ExpiryBadge expiresOn={appReg.expiresOn} />
            </div>

            {appReg.expiresOn && daysUntil(appReg.expiresOn) <= EXPIRY_WARN_DAYS && (
              <div className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${daysUntil(appReg.expiresOn) <= 14 ? "bg-red-500/10 border-red-500/20" : "bg-amber-500/100/10 border-amber-500/20"}`}>
                <svg className={`w-4 h-4 flex-shrink-0 mt-0.5 ${daysUntil(appReg.expiresOn) <= 14 ? "text-red-500" : "text-amber-500"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>
                  <p className={`text-xs font-bold ${daysUntil(appReg.expiresOn) <= 14 ? "text-red-400" : "text-amber-400"}`}>
                    {daysUntil(appReg.expiresOn) <= 0
                      ? "Client App Registration secret has expired — runbooks will fail for this client"
                      : `Client App Registration secret expires in ${daysUntil(appReg.expiresOn)} day${daysUntil(appReg.expiresOn) !== 1 ? "s" : ""} — rotate it before it expires`}
                  </p>
                  <p className={`text-[11px] mt-0.5 ${daysUntil(appReg.expiresOn) <= 14 ? "text-red-400" : "text-amber-400"}`}>
                    Expiry: {new Date(appReg.expiresOn).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                    {" — "}Have the client create a new App Registration secret, then resubmit via their portal.
                  </p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div>
                <p className={labelCls}>Tenant ID</p>
                <p className="text-xs text-[#E6EDF3] font-mono break-all">{appReg.tenantId}</p>
              </div>
              <div>
                <p className={labelCls}>Client ID (App Reg)</p>
                <p className="text-xs text-[#E6EDF3] font-mono break-all">{appReg.azureClientId}</p>
              </div>
              <div>
                <p className={labelCls}>Key Vault Secret</p>
                <p className="text-xs text-[#E6EDF3] font-mono">{appReg.keyVaultSecretName}</p>
              </div>
              {appReg.submittedAt && (
                <div>
                  <p className={labelCls}>Submitted</p>
                  <p className="text-sm text-[#E6EDF3]">
                    {new Date(appReg.submittedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </p>
                </div>
              )}
              {appReg.verifiedAt && (
                <div>
                  <p className={labelCls}>Verified</p>
                  <p className="text-sm text-[#E6EDF3]">
                    {new Date(appReg.verifiedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </p>
                </div>
              )}
            </div>

            <div className="flex gap-2 pt-1 flex-wrap">
              {appReg.status !== "verified" && (
                <button
                  onClick={() => void handleSetAppRegStatus("verified")}
                  disabled={verifyingAppReg}
                  className="flex items-center gap-1.5 text-xs font-semibold bg-green-600 text-white px-4 py-1.5 rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
                >
                  {verifyingAppReg ? (
                    <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  ) : (
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                  )}
                  Mark as Verified
                </button>
              )}
              {appReg.status === "verified" && (
                <button
                  onClick={() => void handleSetAppRegStatus("submitted")}
                  disabled={verifyingAppReg}
                  className="text-xs font-semibold text-amber-400 border border-amber-500/30 bg-amber-500/10 px-4 py-1.5 rounded-lg hover:bg-amber-500/20 disabled:opacity-50 transition-colors"
                >
                  Revert to Submitted
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="p-5">
            <p className="text-sm text-muted-foreground">
              The client has not yet submitted their Azure App Registration credentials. Once they complete setup in their portal, the details will appear here.
            </p>
          </div>
        )}
      </div>

    </div>
  );
}
