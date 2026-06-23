import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { GovernanceAreasPicker } from "@/components/kanban/TypedCardContent";

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
}

interface RunbookSummary {
  name: string;
  description?: string;
  runbookType?: string;
  state?: string;
}

const JOB_STATUS_CFG: Record<string, { cls: string }> = {
  "Never run":  { cls: "bg-gray-100 text-gray-600" },
  "New":        { cls: "bg-blue-100 text-blue-700" },
  "Activating": { cls: "bg-blue-100 text-blue-700" },
  "Running":    { cls: "bg-yellow-100 text-yellow-700" },
  "Completed":  { cls: "bg-green-100 text-green-700" },
  "Failed":     { cls: "bg-red-100 text-red-700" },
  "Stopped":    { cls: "bg-gray-100 text-gray-600" },
  "Suspended":  { cls: "bg-orange-100 text-orange-700" },
};

const inputCls = "w-full border border-border rounded-lg px-3 py-2 text-sm text-[#0A2540] focus:outline-none focus:ring-2 focus:ring-[#0078D4]/40 bg-white";
const labelCls = "block text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1";

export default function ScriptRunnerPage() {
  const [, navigate] = useLocation();
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();

  const [credentials, setCredentials] = useState<AzureCredential[]>([]);
  const [runbooks, setRunbooks] = useState<RunbookSummary[]>([]);
  const [loadingCredentials, setLoadingCredentials] = useState(true);
  const [loadingRunbooks, setLoadingRunbooks] = useState(false);
  const [azureConfigured, setAzureConfigured] = useState<boolean | null>(null);

  const [selectedCredId, setSelectedCredId] = useState<number | "">("");
  const [selectedRunbook, setSelectedRunbook] = useState("");

  const [running, setRunning] = useState(false);
  const [jobStatus, setJobStatus] = useState("Never run");
  const [logLines, setLogLines] = useState<string[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);
  const [governanceAreas, setGovernanceAreas] = useState<string[] | null>(null);

  const [manageOpen, setManageOpen] = useState(false);
  const [editingCred, setEditingCred] = useState<AzureCredential | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [credForm, setCredForm] = useState({
    displayName: "",
    tenantId: "",
    clientId: "",
    credentialType: "secret" as "secret" | "certificate",
    keyVaultSecretName: "",
  });
  const [savingCred, setSavingCred] = useState(false);

  useEffect(() => {
    void loadCredentials();
    void checkAzureConfig();
  }, []);

  useEffect(() => {
    if (selectedCredId) void loadRunbooks();
    else setRunbooks([]);
    setSelectedRunbook("");
  }, [selectedCredId]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logLines]);

  const loadCredentials = async () => {
    setLoadingCredentials(true);
    try {
      const res = await fetchWithAuth("/api/admin/azure-credentials");
      if (res.ok) {
        const data = await res.json() as AzureCredential[];
        setCredentials(data);
      }
    } finally {
      setLoadingCredentials(false);
    }
  };

  const checkAzureConfig = async () => {
    try {
      const res = await fetchWithAuth("/api/admin/runbooks");
      const data = await res.json() as { configured: boolean };
      setAzureConfigured(res.status === 503 && data.configured === false ? false : true);
    } catch {
      // network error — leave as null (unknown)
    }
  };

  const loadRunbooks = async () => {
    setLoadingRunbooks(true);
    try {
      const res = await fetchWithAuth("/api/admin/runbooks");
      const data = await res.json() as { configured: boolean; runbooks?: RunbookSummary[]; error?: string };
      if (res.status === 503 && data.configured === false) {
        setAzureConfigured(false);
        setRunbooks([]);
      } else if (res.ok && data.configured) {
        setAzureConfigured(true);
        setRunbooks(data.runbooks ?? []);
      } else {
        setAzureConfigured(true);
        toast({ title: "Could not load runbooks", description: data.error ?? "Check Azure Automation is reachable.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Could not load runbooks", variant: "destructive" });
    } finally {
      setLoadingRunbooks(false);
    }
  };

  const handleRun = async () => {
    if (!selectedCredId || !selectedRunbook) return;
    setRunning(true);
    setLogLines(["[Starting job…]"]);
    setJobStatus("New");

    try {
      const areasPayload = governanceAreas !== null && governanceAreas.length > 0 ? governanceAreas : undefined;
      const res = await fetchWithAuth("/api/admin/runbook-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          credentialId: selectedCredId,
          runbookName: selectedRunbook,
          ...(areasPayload ? { governanceAreas: areasPayload } : {}),
        }),
      });

      if (!res.ok) {
        const err = await res.json() as { error?: string };
        setLogLines(prev => [...prev, `[Error: ${err.error ?? "Failed to start job"}]`]);
        setRunning(false);
        return;
      }

      const { jobId } = await res.json() as { jobId: string };

      let lastSeq = -1;
      let aborted = false;

      const poll = async (): Promise<void> => {
        if (aborted) return;
        try {
          const pollRes = await fetchWithAuth(`/api/admin/runbook-jobs/output?jobId=${encodeURIComponent(jobId)}&since=${lastSeq}`);
          if (!pollRes.ok) throw new Error("poll failed");
          const data = await pollRes.json() as {
            status: string;
            terminal: boolean;
            lines: Array<{ sequence: number; text: string }>;
          };

          setJobStatus(data.status);
          if (data.lines.length > 0) {
            setLogLines(prev => [...prev, ...data.lines.map(l => l.text)]);
            lastSeq = Math.max(...data.lines.map(l => l.sequence));
          }

          if (data.terminal) {
            setLogLines(prev => [...prev, `[Job ${data.status}]`]);
            setRunning(false);
            return;
          }

          setTimeout(() => void poll(), 3000);
        } catch {
          if (!aborted) {
            setLogLines(prev => [...prev, "[Polling error — job may still be running in Azure]"]);
            setRunning(false);
          }
        }
      };

      void poll();
    } catch {
      setLogLines(prev => [...prev, "[Network error]"]);
      setRunning(false);
    }
  };

  const openCreate = () => {
    setEditingCred(null);
    setCredForm({ displayName: "", tenantId: "", clientId: "", credentialType: "secret", keyVaultSecretName: "" });
    setManageOpen(true);
  };

  const openEdit = (c: AzureCredential) => {
    setEditingCred(c);
    setCredForm({
      displayName: c.displayName,
      tenantId: c.tenantId,
      clientId: c.clientId,
      credentialType: c.credentialType,
      keyVaultSecretName: c.keyVaultSecretName,
    });
    setManageOpen(true);
  };

  const handleSaveCred = async () => {
    if (!credForm.displayName || !credForm.tenantId || !credForm.clientId || !credForm.keyVaultSecretName) {
      toast({ title: "All fields are required", variant: "destructive" });
      return;
    }
    setSavingCred(true);
    try {
      const url = editingCred ? `/api/admin/azure-credentials/${editingCred.id}` : "/api/admin/azure-credentials";
      const method = editingCred ? "PUT" : "POST";
      const res = await fetchWithAuth(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credForm),
      });
      if (res.ok) {
        toast({ title: editingCred ? "Customer updated" : "Customer added" });
        setManageOpen(false);
        void loadCredentials();
      } else {
        const err = await res.json() as { error?: string };
        toast({ title: err.error ?? "Failed to save", variant: "destructive" });
      }
    } finally {
      setSavingCred(false);
    }
  };

  const handleDeleteCred = async (id: number) => {
    setDeletingId(id);
    try {
      const res = await fetchWithAuth(`/api/admin/azure-credentials/${id}`, { method: "DELETE" });
      if (res.ok) {
        toast({ title: "Customer deleted" });
        void loadCredentials();
        if (selectedCredId === id) setSelectedCredId("");
      } else {
        toast({ title: "Failed to delete", variant: "destructive" });
      }
    } finally {
      setDeletingId(null);
    }
  };

  const statusCfg = JOB_STATUS_CFG[jobStatus] ?? { cls: "bg-gray-100 text-gray-600" };
  const canRun = !!selectedCredId && !!selectedRunbook && !running && (governanceAreas === null || governanceAreas.length > 0);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#0A2540]">Script Runner</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Run Azure Automation Runbooks against customer tenants</p>
        </div>
        <button
          onClick={() => navigate("/crm/clients")}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#0078D4] border border-[#0078D4]/30 hover:border-[#0078D4] hover:bg-blue-50 rounded-lg px-3 py-2 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Manage Clients
        </button>
      </div>

      {azureConfigured === false && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 space-y-3">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-amber-800 mb-1">Azure Automation is not configured</p>
              <p className="text-xs text-amber-700 leading-relaxed mb-3">
                Add the following 7 secrets to <strong>Replit Secrets</strong> (Tools → Secrets in the sidebar) to enable Script Runner. The values come from your Azure App Registration and Automation account.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 font-mono text-xs text-amber-900">
                {[
                  ["AZURE_CLIENT_ID", "App Registration client ID"],
                  ["AZURE_CLIENT_SECRET", "App Registration client secret"],
                  ["AZURE_TENANT_ID", "Azure AD tenant ID"],
                  ["AZURE_KEY_VAULT_URL", "https://your-vault.vault.azure.net"],
                  ["AZURE_SUBSCRIPTION_ID", "Azure subscription ID"],
                  ["AZURE_AUTOMATION_RESOURCE_GROUP", "Resource group name"],
                  ["AZURE_AUTOMATION_ACCOUNT_NAME", "Automation account name"],
                ].map(([key, hint]) => (
                  <div key={key} className="flex flex-col py-0.5">
                    <span className="font-bold">{key}</span>
                    <span className="text-amber-700 font-sans text-[10px]">{hint}</span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-amber-600 mt-3">
                The App Registration needs <strong>Key Vault Secrets User</strong> on the vault and <strong>Automation Operator</strong> on the Automation account. Reload this page after adding the secrets.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Configuration sidebar */}
        <div className="space-y-4">
          <div className="bg-white border border-border rounded-xl p-4 space-y-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Configuration</p>

            <div>
              <label className={labelCls}>Customer</label>
              {loadingCredentials ? (
                <div className="h-9 bg-gray-100 rounded-lg animate-pulse" />
              ) : (
                <select
                  className={inputCls}
                  value={selectedCredId}
                  onChange={e => setSelectedCredId(e.target.value ? Number(e.target.value) : "")}
                >
                  <option value="">Select a customer…</option>
                  {credentials.map(c => (
                    <option key={c.id} value={c.id}>{c.displayName}</option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <label className={labelCls}>Runbook</label>
              {loadingRunbooks ? (
                <div className="h-9 bg-gray-100 rounded-lg animate-pulse" />
              ) : (
                <select
                  className={inputCls}
                  value={selectedRunbook}
                  disabled={!selectedCredId}
                  onChange={e => setSelectedRunbook(e.target.value)}
                >
                  <option value="">{selectedCredId ? "Select a runbook…" : "Select a customer first"}</option>
                  {runbooks.map(rb => (
                    <option key={rb.name} value={rb.name}>{rb.name}</option>
                  ))}
                </select>
              )}
              {selectedRunbook && runbooks.find(r => r.name === selectedRunbook)?.description && (
                <p className="text-[10px] text-muted-foreground mt-1.5 leading-snug">
                  {runbooks.find(r => r.name === selectedRunbook)?.description}
                </p>
              )}
            </div>

            <div className="border-t border-border pt-3">
              <GovernanceAreasPicker
                value={governanceAreas}
                onChange={setGovernanceAreas}
                disabled={running}
              />
            </div>

            <button
              onClick={() => void handleRun()}
              disabled={!canRun}
              className="w-full inline-flex items-center justify-center gap-2 text-sm font-semibold text-white bg-[#0078D4] hover:bg-[#0078D4]/90 disabled:opacity-40 rounded-lg px-4 py-2.5 transition-colors"
            >
              {running ? (
                <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 3l14 9-14 9V3z" />
                </svg>
              )}
              {running ? "Running…" : "Run Runbook"}
            </button>
          </div>

          {/* Customers list — managed from CRM */}
          {credentials.length > 0 && (
            <div className="bg-white border border-border rounded-xl p-4 space-y-1">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Customers</p>
                <button
                  onClick={() => navigate("/crm/clients")}
                  className="text-[10px] font-semibold text-[#0078D4] hover:underline"
                >
                  Manage in CRM →
                </button>
              </div>
              {credentials.map(c => (
                <div key={c.id} className="flex items-center gap-2 py-1.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#0A2540] truncate">{c.displayName}</p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {c.credentialType === "certificate" ? "Certificate" : "Client Secret"}
                    </p>
                  </div>
                  {c.clientUserId && (
                    <button
                      onClick={() => navigate(`/crm/clients/${c.clientUserId}`)}
                      className="flex-shrink-0 p-1 text-muted-foreground hover:text-[#0078D4] rounded transition-colors"
                      title="View client profile"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Log panel */}
        <div className="lg:col-span-2 space-y-3">
          <div className="bg-white border border-border rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-[#F7F9FC]">
              <div className="flex items-center gap-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Live Output</p>
                {running && (
                  <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusCfg.cls}`}>{jobStatus}</span>
                {logLines.length > 0 && !running && (
                  <button
                    onClick={() => { setLogLines([]); setJobStatus("Never run"); }}
                    className="text-[10px] font-semibold text-muted-foreground hover:text-[#0A2540] transition-colors"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            <div className="bg-gray-900 min-h-64 max-h-[600px] overflow-y-auto p-4 font-mono text-xs text-gray-100">
              {logLines.length === 0 ? (
                <p className="text-gray-500 italic">Select a customer and runbook, then click Run to start.</p>
              ) : (
                <div className="space-y-0.5">
                  {logLines.map((line, i) => (
                    <div key={i} className="whitespace-pre-wrap break-all leading-relaxed">{line}</div>
                  ))}
                </div>
              )}
              <div ref={logEndRef} />
            </div>
          </div>
        </div>
      </div>

      {/* Add/Edit Customer modal */}
      {manageOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md space-y-4 p-6">
            <h2 className="text-base font-bold text-[#0A2540]">
              {editingCred ? "Edit Customer" : "Add Customer"}
            </h2>

            <div className="space-y-3">
              <div>
                <label className={labelCls}>Display Name</label>
                <input
                  className={inputCls}
                  placeholder="Contoso Corp"
                  value={credForm.displayName}
                  onChange={e => setCredForm(f => ({ ...f, displayName: e.target.value }))}
                />
              </div>

              <div>
                <label className={labelCls}>Tenant ID</label>
                <input
                  className={inputCls}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  value={credForm.tenantId}
                  onChange={e => setCredForm(f => ({ ...f, tenantId: e.target.value }))}
                />
              </div>

              <div>
                <label className={labelCls}>Client ID (App Registration)</label>
                <input
                  className={inputCls}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  value={credForm.clientId}
                  onChange={e => setCredForm(f => ({ ...f, clientId: e.target.value }))}
                />
              </div>

              <div>
                <label className={labelCls}>Credential Type</label>
                <div className="flex gap-4">
                  {(["secret", "certificate"] as const).map(type => (
                    <label key={type} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="credentialType"
                        value={type}
                        checked={credForm.credentialType === type}
                        onChange={() => setCredForm(f => ({ ...f, credentialType: type }))}
                        className="accent-[#0078D4]"
                      />
                      <span className="text-sm capitalize">{type}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className={labelCls}>Key Vault Secret / Certificate Name</label>
                <input
                  className={inputCls}
                  placeholder="contoso-client-secret"
                  value={credForm.keyVaultSecretName}
                  onChange={e => setCredForm(f => ({ ...f, keyVaultSecretName: e.target.value }))}
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  The name of the secret or certificate in Azure Key Vault. The actual value stays in Key Vault — never stored here.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={() => void handleSaveCred()}
                disabled={savingCred}
                className="flex items-center gap-1.5 bg-[#0A2540] text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[#0A2540]/90 disabled:opacity-50 transition-colors"
              >
                {savingCred && <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
                {savingCred ? "Saving…" : "Save"}
              </button>
              <button
                onClick={() => setManageOpen(false)}
                disabled={savingCred}
                className="text-sm font-semibold text-muted-foreground hover:text-[#0A2540] px-3 py-2 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
