import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import PortalLayout from "@/components/PortalLayout";

interface AppRegRecord {
  status: "pending" | "submitted" | "verified";
  tenantId: string;
  azureClientId: string;
  submittedAt: string | null;
  verifiedAt: string | null;
}

const REQUIRED_PERMISSIONS = [
  { permission: "Sites.FullControl.All", type: "Application", reason: "Read, write, and manage all SharePoint sites and document libraries in the tenant" },
  { permission: "User.Read.All", type: "Application", reason: "Enumerate users, resolve UPNs, and assign licenses across the M365 tenant" },
  { permission: "GroupMember.ReadWrite.All", type: "Application", reason: "Add and remove members from Microsoft 365 groups and Teams" },
  { permission: "Group.ReadWrite.All", type: "Application", reason: "Create and manage Microsoft 365 groups used by SharePoint and Teams" },
  { permission: "Directory.ReadWrite.All", type: "Application", reason: "Manage directory objects — required for governance and provisioning runbooks" },
  { permission: "Application.ReadWrite.All", type: "Application", reason: "Register and update app registrations on your tenant as part of automation workflows" },
  { permission: "Mail.Send", type: "Application", reason: "Send automated notification emails from within the tenant on behalf of runbooks" },
  { permission: "TeamMember.ReadWrite.All", type: "Application", reason: "Add members to Teams channels created during provisioning" },
];

function StatusBadge({ status }: { status: AppRegRecord["status"] | null }) {
  if (!status || status === "pending") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-red-50 text-red-700 border border-red-200">
        <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
        Not Connected
      </span>
    );
  }
  if (status === "submitted") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
        Submitted · Pending Verification
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-green-50 text-green-700 border border-green-200">
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
      Verified &amp; Active
    </span>
  );
}

export default function PortalAppRegistration() {
  const { fetchWithAuth } = useAuth();

  const [record, setRecord] = useState<AppRegRecord | null>(null);
  const [loading, setLoading] = useState(true);

  const [tenantId, setTenantId] = useState("");
  const [azureClientId, setAzureClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [updateMode, setUpdateMode] = useState(false);

  useEffect(() => {
    fetchWithAuth("/api/portal/app-registration")
      .then(r => r.ok ? r.json() : null)
      .then((d: AppRegRecord | null) => {
        setRecord(d);
        if (d && d.status !== "pending") {
          setTenantId(d.tenantId ?? "");
          setAzureClientId(d.azureClientId ?? "");
        }
      })
      .catch(() => null)
      .finally(() => setLoading(false));
  }, [fetchWithAuth]);

  function enterUpdateMode() {
    setClientSecret("");
    setError(null);
    setUpdateMode(true);
  }

  function cancelUpdate() {
    setUpdateMode(false);
    setError(null);
    setClientSecret("");
    if (record) {
      setTenantId(record.tenantId ?? "");
      setAzureClientId(record.azureClientId ?? "");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!tenantId.trim() || !azureClientId.trim() || !clientSecret.trim()) {
      setError("All three fields are required.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetchWithAuth("/api/portal/app-registration", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: tenantId.trim(),
          azureClientId: azureClientId.trim(),
          clientSecret: clientSecret.trim(),
        }),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        setError(err.error ?? "Failed to save credentials. Please try again.");
        return;
      }
      const updated = await res.json() as AppRegRecord;
      setRecord(updated);
      setClientSecret("");
      setSubmitted(true);
      setUpdateMode(false);
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  const isVerified = record?.status === "verified";
  const isSubmitted = submitted || record?.status === "submitted" || record?.status === "verified";
  const wasAlreadyConnected = !!(record && (record.status === "submitted" || record.status === "verified"));

  return (
    <PortalLayout>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-6">

        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-9 h-9 rounded-xl bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold text-[#0A2540]">Automation Setup</h1>
              <p className="text-sm text-gray-500">Connect your Azure tenant so Shane's scripts can automate work inside your M365 environment</p>
            </div>
          </div>

          {!loading && (
            <div className="mt-3">
              <StatusBadge status={updateMode ? (record?.status ?? "pending") : (record?.status ?? "pending")} />
            </div>
          )}
        </div>

        {/* ── Why we need this ────────────────────────────────────────────────── */}
        <div className="bg-white border border-border rounded-xl p-5">
          <h2 className="text-sm font-bold text-[#0A2540] mb-2">Why this is needed</h2>
          <p className="text-sm text-gray-600 leading-relaxed">
            Shane's Script Runner executes PowerShell runbooks in Azure Automation to provision SharePoint sites, manage Teams channels, configure governance policies, and handle bulk M365 tasks inside your tenant. To do this securely, the runbook needs a service identity — an Azure App Registration — that has exactly the permissions required, with no more access than necessary. You create and own this App Registration in your Azure portal, which means you maintain full control and can revoke access at any time.
          </p>
        </div>

        {/* ── Security ────────────────────────────────────────────────────────── */}
        <div className="bg-[#0A2540] rounded-xl p-5 text-white">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#0078D4]/20 flex items-center justify-center flex-shrink-0 mt-0.5">
              <svg className="w-4.5 h-4.5 text-[#00B4D8]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <div>
              <h2 className="text-sm font-bold text-white mb-1.5">Your credentials stay in Azure Key Vault</h2>
              <p className="text-sm text-white/70 leading-relaxed">
                The Client Secret you enter below is transmitted over HTTPS and stored immediately in <strong className="text-white/90">Azure Key Vault</strong> — Microsoft's managed secrets store. It is <strong className="text-white/90">never written to this application's database</strong>. Only Shane's Azure Automation service account can retrieve it at execution time. The Tenant ID and Client ID (which are not sensitive on their own) are stored in the database to display your connection status. You can revoke access at any time by deleting the App Registration from your Azure portal.
              </p>
            </div>
          </div>
        </div>

        {/* ── Required permissions ────────────────────────────────────────────── */}
        <div className="bg-white border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border bg-[#F7F9FC]">
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Required API Permissions</p>
            <p className="text-xs text-gray-500 mt-0.5">Grant all of these as <strong>Application</strong> permissions (not delegated) in your App Registration</p>
          </div>
          <div className="divide-y divide-border">
            {REQUIRED_PERMISSIONS.map(p => (
              <div key={p.permission} className="px-5 py-3 grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-1 sm:gap-3 items-start">
                <div>
                  <code className="text-xs font-mono font-semibold text-[#0078D4] bg-[#0078D4]/8 px-1.5 py-0.5 rounded">{p.permission}</code>
                  <span className="ml-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{p.type}</span>
                </div>
                <p className="text-xs text-gray-600">{p.reason}</p>
              </div>
            ))}
          </div>
          <div className="px-5 py-3 border-t border-border bg-amber-50">
            <p className="text-xs text-amber-800">
              <strong>After granting permissions:</strong> Click <strong>Grant admin consent</strong> in the Azure portal — otherwise the App Registration won't be able to act on behalf of the organization.
            </p>
          </div>
        </div>

        {/* ── Step-by-step guide ──────────────────────────────────────────────── */}
        <div className="bg-white border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border bg-[#F7F9FC]">
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Step-by-Step Setup</p>
          </div>
          <ol className="divide-y divide-border">
            {[
              {
                n: 1,
                title: "Open Azure Active Directory",
                body: "Go to portal.azure.com and sign in as a Global Administrator. In the left sidebar choose Microsoft Entra ID (formerly Azure Active Directory).",
              },
              {
                n: 2,
                title: "Create a new App Registration",
                body: "Select App Registrations → New Registration. Give it a recognisable name such as \"Shane McCaw Automation\" and leave the supported account types as \"Accounts in this organizational directory only\". Click Register.",
              },
              {
                n: 3,
                title: "Copy your Tenant ID and Client ID",
                body: "On the Overview page of the newly created registration, copy the Application (client) ID and the Directory (tenant) ID. You will paste these into the form below.",
              },
              {
                n: 4,
                title: "Grant the required API permissions",
                body: "Go to API Permissions → Add a permission → Microsoft Graph → Application permissions. Search for and add every permission listed in the table above. Once added, click Grant admin consent for [Your Organisation].",
              },
              {
                n: 5,
                title: "Create a Client Secret",
                body: "Go to Certificates & Secrets → New client secret. Set an expiry (24 months recommended) and click Add. Immediately copy the Value shown — it is only visible once. Paste it into the Client Secret field below.",
              },
              {
                n: 6,
                title: "Submit your credentials",
                body: "Paste all three values into the form below and click Submit. Shane will verify the connection and confirm within one business day.",
              },
            ].map(step => (
              <li key={step.n} className="flex gap-4 px-5 py-4">
                <div className="w-7 h-7 rounded-full bg-[#0078D4] text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                  {step.n}
                </div>
                <div>
                  <p className="text-sm font-semibold text-[#0A2540] mb-0.5">{step.title}</p>
                  <p className="text-sm text-gray-600 leading-relaxed">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        {/* ── Credential form / status ─────────────────────────────────────────── */}
        <div className="bg-white border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border bg-[#F7F9FC] flex items-center justify-between gap-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
              {updateMode
                ? "Update Credentials"
                : isVerified
                  ? "Connected Credentials"
                  : "Submit Credentials"}
            </p>
            {!loading && !updateMode && isSubmitted && (
              <button
                onClick={enterUpdateMode}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0078D4] hover:text-[#0078D4]/80 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
                Update Credentials
              </button>
            )}
          </div>

          {loading ? (
            <div className="p-8 flex justify-center">
              <div className="w-6 h-6 border-3 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : updateMode ? (
            /* ── Update mode form ─────────────────────────────────────────────── */
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              {/* Warning banner */}
              <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3.5">
                <svg className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
                <div>
                  <p className="text-sm font-semibold text-amber-800">Resubmitting will pause automations until re-verified</p>
                  <p className="text-xs text-amber-700 mt-1 leading-relaxed">
                    Updating your credentials resets the connection status to <strong>Submitted · Pending Verification</strong>. Shane will need to test and re-verify the new credentials before your automations can run again. This typically takes one business day.
                  </p>
                </div>
              </div>

              {error && (
                <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
                  <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {error}
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-[#0A2540] mb-1.5">
                  Tenant ID <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={tenantId}
                  onChange={e => setTenantId(e.target.value)}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-white"
                  autoComplete="off"
                />
                <p className="text-[11px] text-gray-400 mt-1">Found on your App Registration's Overview page under Directory (tenant) ID</p>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#0A2540] mb-1.5">
                  Client ID (Application ID) <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={azureClientId}
                  onChange={e => setAzureClientId(e.target.value)}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-white"
                  autoComplete="off"
                />
                <p className="text-[11px] text-gray-400 mt-1">Found on your App Registration's Overview page under Application (client) ID</p>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#0A2540] mb-1.5">
                  New Client Secret <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showSecret ? "text" : "password"}
                    value={clientSecret}
                    onChange={e => setClientSecret(e.target.value)}
                    placeholder="Paste the new secret value here"
                    className="w-full border border-border rounded-lg px-3 py-2 pr-10 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-white"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecret(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                    tabIndex={-1}
                  >
                    {showSecret ? (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                    )}
                  </button>
                </div>
                <p className="text-[11px] text-gray-400 mt-1">The previous secret will be overwritten in Azure Key Vault immediately.</p>
              </div>

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={cancelUpdate}
                  disabled={saving}
                  className="flex-1 border border-border text-[#0A2540] text-sm font-semibold py-2.5 rounded-lg transition-colors hover:bg-gray-50 disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white text-sm font-semibold py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  {saving ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                      Updating…
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Update &amp; Resubmit
                    </>
                  )}
                </button>
              </div>
              <p className="text-[11px] text-center text-gray-400">Your new Client Secret will be encrypted in transit and stored only in Azure Key Vault.</p>
            </form>
          ) : isVerified ? (
            /* ── Verified state ───────────────────────────────────────────────── */
            <div className="p-5 space-y-4">
              <div className="flex items-center gap-2.5 text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
                <svg className="w-4.5 h-4.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm font-semibold">Credentials verified and active</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">Tenant ID</p>
                  <p className="font-mono text-[#0A2540] text-xs break-all">{record?.tenantId}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">Client ID</p>
                  <p className="font-mono text-[#0A2540] text-xs break-all">{record?.azureClientId}</p>
                </div>
                {record?.verifiedAt && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">Verified on</p>
                    <p className="text-[#0A2540] text-sm">{new Date(record.verifiedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>
                  </div>
                )}
              </div>
              <div className="border-t border-border pt-4 flex items-center justify-between gap-3">
                <p className="text-xs text-gray-500">
                  If your App Registration secret has rotated or been recreated, use the Update Credentials button above to resubmit.
                </p>
              </div>
            </div>
          ) : isSubmitted ? (
            /* ── Submitted / pending state ────────────────────────────────────── */
            <div className="p-5 space-y-4">
              <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
                <svg className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>
                  <p className="text-sm font-semibold text-amber-800">Credentials submitted — pending verification</p>
                  <p className="text-xs text-amber-700 mt-0.5">Shane will test the connection and verify your App Registration within one business day.</p>
                </div>
              </div>
              {record && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">Tenant ID</p>
                    <p className="font-mono text-[#0A2540] text-xs break-all">{record.tenantId}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">Client ID</p>
                    <p className="font-mono text-[#0A2540] text-xs break-all">{record.azureClientId}</p>
                  </div>
                  {record.submittedAt && (
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">Submitted on</p>
                      <p className="text-[#0A2540] text-sm">{new Date(record.submittedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            /* ── Initial submission form ──────────────────────────────────────── */
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              {error && (
                <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
                  <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {error}
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-[#0A2540] mb-1.5">
                  Tenant ID <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={tenantId}
                  onChange={e => setTenantId(e.target.value)}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-white"
                  autoComplete="off"
                />
                <p className="text-[11px] text-gray-400 mt-1">Found on your App Registration's Overview page under Directory (tenant) ID</p>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#0A2540] mb-1.5">
                  Client ID (Application ID) <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={azureClientId}
                  onChange={e => setAzureClientId(e.target.value)}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-white"
                  autoComplete="off"
                />
                <p className="text-[11px] text-gray-400 mt-1">Found on your App Registration's Overview page under Application (client) ID</p>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#0A2540] mb-1.5">
                  Client Secret <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showSecret ? "text" : "password"}
                    value={clientSecret}
                    onChange={e => setClientSecret(e.target.value)}
                    placeholder="Paste the secret value here"
                    className="w-full border border-border rounded-lg px-3 py-2 pr-10 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-white"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecret(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                    tabIndex={-1}
                  >
                    {showSecret ? (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                    )}
                  </button>
                </div>
                <p className="text-[11px] text-gray-400 mt-1">Created under Certificates &amp; Secrets → Client secrets. Copy the Value column immediately — it's only shown once.</p>
              </div>

              <div className="pt-1">
                <button
                  type="submit"
                  disabled={saving}
                  className="w-full bg-[#0078D4] hover:bg-[#0078D4]/90 disabled:opacity-60 text-white text-sm font-semibold py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  {saving ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                      Encrypting &amp; Saving…
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                      </svg>
                      Submit Credentials Securely
                    </>
                  )}
                </button>
                <p className="text-[11px] text-center text-gray-400 mt-2">Your Client Secret is encrypted in transit and stored only in Azure Key Vault — never in this app.</p>
              </div>
            </form>
          )}
        </div>

      </div>
    </PortalLayout>
  );
}
