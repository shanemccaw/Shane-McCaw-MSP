import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

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
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();

  const [credentials, setCredentials] = useState<AzureCredential[]>([]);
  const [runbooks, setRunbooks] = useState<RunbookSummary[]>([]);
  const [loadingCredentials, setLoadingCredentials] = useState(true);
  const [loadingRunbooks, setLoadingRunbooks] = useState(false);

  const [selectedCredId, setSelectedCredId] = useState<number | "">("");
  const [selectedRunbook, setSelectedRunbook] = useState("");

  const [running, setRunning] = useState(false);
  const [jobStatus, setJobStatus] = useState("Never run");
  const [logLines, setLogLines] = useState<string[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);

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

  const loadRunbooks = async () => {
    setLoadingRunbooks(true);
    try {
      const res = await fetchWithAuth("/api/admin/runbooks");
      if (res.ok) {
        const data = await res.json() as RunbookSummary[];
        setRunbooks(data);
      } else {
        toast({ title: "Could not load runbooks", description: "Check Azure Automation secrets are configured.", variant: "destructive" });
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
      const res = await fetchWithAuth("/api/admin/runbook-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credentialId: selectedCredId, runbookName: selectedRunbook }),
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
  const canRun = !!selectedCredId && !!selectedRunbook && !running;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#0A2540]">Script Runner</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Run Azure Automation Runbooks against customer tenants</p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#0078D4] border border-[#0078D4]/30 hover:border-[#0078D4] hover:bg-blue-50 rounded-lg px-3 py-2 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Add Customer
        </button>
      </div>

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

          {/* Customers list */}
          {credentials.length > 0 && (
            <div className="bg-white border border-border rounded-xl p-4 space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Customers</p>
              {credentials.map(c => (
                <div key={c.id} className="flex items-center gap-2 py-1.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#0A2540] truncate">{c.displayName}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{c.credentialType === "certificate" ? "Certificate" : "Client Secret"}</p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => openEdit(c)}
                      className="p-1 text-muted-foreground hover:text-[#0078D4] rounded transition-colors"
                      title="Edit"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => void handleDeleteCred(c.id)}
                      disabled={deletingId === c.id}
                      className="p-1 text-muted-foreground hover:text-red-600 rounded transition-colors"
                      title="Delete"
                    >
                      {deletingId === c.id ? (
                        <div className="w-3.5 h-3.5 border-2 border-gray-300 border-t-red-500 rounded-full animate-spin" />
                      ) : (
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      )}
                    </button>
                  </div>
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
