import { useState, useRef, useEffect, useCallback } from "react";
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

interface JobHistoryRow {
  id: number;
  jobId: string;
  runbookName: string;
  credentialId: number | null;
  customerName: string;
  status: string;
  output: string | null;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
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

function formatRelative(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDuration(startedAt: string, completedAt: string | null): string {
  if (!completedAt) return "—";
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

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
  const [logLabel, setLogLabel] = useState<string | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const [governanceAreas, setGovernanceAreas] = useState<string[] | null>(null);

  // Job history
  const [history, setHistory] = useState<JobHistoryRow[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [replayingJobId, setReplayingJobId] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const res = await fetchWithAuth("/api/admin/runbook-jobs/history?limit=50");
      if (res.ok) {
        const data = await res.json() as JobHistoryRow[];
        setHistory(data);
      }
    } catch {
      // non-critical
    } finally {
      setLoadingHistory(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    void loadCredentials();
    void checkAzureConfig();
    void loadHistory();
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
    setLogLabel(null);
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
            void loadHistory();
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

  const handleReplay = async (row: JobHistoryRow) => {
    if (replayingJobId === row.jobId) return;
    setReplayingJobId(row.jobId);
    try {
      const res = await fetchWithAuth(`/api/admin/runbook-jobs/${encodeURIComponent(row.jobId)}/replay`);
      if (!res.ok) {
        toast({ title: "Could not replay job output", variant: "destructive" });
        return;
      }
      const data = await res.json() as {
        runbookName: string;
        customerName: string;
        status: string;
        lines: Array<{ sequence: number; text: string }>;
      };
      setJobStatus(data.status);
      setLogLines(data.lines.map(l => l.text));
      setLogLabel(`${data.runbookName} — ${data.customerName}`);
    } finally {
      setReplayingJobId(null);
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
              <div className="flex items-center gap-2 min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex-shrink-0">
                  {logLabel ? "Replayed Output" : "Live Output"}
                </p>
                {logLabel && (
                  <span className="text-[10px] text-muted-foreground truncate">{logLabel}</span>
                )}
                {running && (
                  <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse flex-shrink-0" />
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusCfg.cls}`}>{jobStatus}</span>
                {logLines.length > 0 && !running && (
                  <button
                    onClick={() => { setLogLines([]); setJobStatus("Never run"); setLogLabel(null); }}
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

      {/* Job History */}
      <div className="bg-white border border-border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-[#F7F9FC]">
          <div className="flex items-center gap-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Run History</p>
            {history.length > 0 && (
              <span className="text-[10px] text-muted-foreground">({history.length} runs)</span>
            )}
          </div>
          <button
            onClick={() => void loadHistory()}
            disabled={loadingHistory}
            className="text-[10px] font-semibold text-muted-foreground hover:text-[#0078D4] transition-colors flex items-center gap-1"
            title="Refresh history"
          >
            <svg
              className={`w-3 h-3 ${loadingHistory ? "animate-spin" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
        </div>

        {loadingHistory ? (
          <div className="p-6 space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-10 bg-gray-100 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : history.length === 0 ? (
          <div className="p-8 text-center">
            <svg className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm text-muted-foreground">No jobs have been run yet.</p>
            <p className="text-xs text-muted-foreground mt-0.5">History appears here after you run a runbook.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {/* Header row */}
            <div className="grid grid-cols-[1fr_1fr_auto_auto_auto] gap-4 px-4 py-2 bg-gray-50">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Runbook</span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Customer</span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Duration</span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Started</span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Status</span>
            </div>
            {history.map(row => {
              const cfg = JOB_STATUS_CFG[row.status] ?? { cls: "bg-gray-100 text-gray-600" };
              const isReplaying = replayingJobId === row.jobId;
              const hasOutput = !!row.output;
              return (
                <div
                  key={row.id}
                  onClick={hasOutput && !running ? () => void handleReplay(row) : undefined}
                  className={`grid grid-cols-[1fr_1fr_auto_auto_auto] gap-4 px-4 py-3 items-center transition-colors group ${hasOutput && !running ? "cursor-pointer hover:bg-blue-50/40" : "hover:bg-gray-50/50"}`}
                  title={hasOutput ? "Click to replay stored output" : undefined}
                >
                  <span className="text-sm font-medium text-[#0A2540] truncate" title={row.runbookName}>
                    {row.runbookName}
                  </span>
                  <span className="text-sm text-muted-foreground truncate" title={row.customerName}>
                    {row.customerName}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {formatDuration(row.startedAt, row.completedAt)}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                    {formatRelative(row.startedAt)}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${cfg.cls}`}>
                      {row.status}
                    </span>
                    {hasOutput && (
                      <div
                        title="Replay stored output"
                        className="p-1 rounded text-muted-foreground group-hover:text-[#0078D4] transition-colors"
                      >
                        {isReplaying ? (
                          <div className="w-3.5 h-3.5 border-2 border-gray-300 border-t-[#0078D4] rounded-full animate-spin" />
                        ) : (
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 3l14 9-14 9V3z" />
                          </svg>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Stripe Session Replay ── */}
      <StripeReplayCard />
    </div>
  );
}

function StripeReplayCard() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const [sessionId, setSessionId] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ status: string; invoiceId: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleReplay(e: React.FormEvent) {
    e.preventDefault();
    if (!sessionId.trim()) return;
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const res = await fetchWithAuth("/api/admin/stripe/replay-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sessionId.trim() }),
      });
      const body = await res.json() as { status?: string; invoiceId?: number | null; error?: string };
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      setResult({ status: body.status ?? "unknown", invoiceId: body.invoiceId ?? null });
      toast({ title: body.status === "created" ? "Session replayed" : "Already processed", description: body.status === "created" ? `Invoice #${body.invoiceId} created` : "No changes made — session was already processed." });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-white border border-border rounded-xl p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0">
          <svg className="w-4.5 h-4.5 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </div>
        <div>
          <h2 className="text-sm font-bold text-[#0A2540]">Replay Stripe Session</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Manually reprocess a paid Checkout Session that the webhook missed. Idempotent — safe to run if already processed.
          </p>
        </div>
      </div>

      <form onSubmit={handleReplay} className="flex gap-2">
        <input
          type="text"
          value={sessionId}
          onChange={e => { setSessionId(e.target.value); setResult(null); setError(null); }}
          placeholder="cs_test_… or cs_live_…"
          className={`${inputCls} flex-1 font-mono text-xs`}
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || !sessionId.trim()}
          className="flex-shrink-0 px-4 py-2 rounded-lg bg-[#0078D4] text-white text-xs font-semibold hover:bg-[#006BBD] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
        >
          {loading ? (
            <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 3l14 9-14 9V3z" />
            </svg>
          )}
          Replay
        </button>
      </form>

      {result && (
        <div className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-xs font-medium ${result.status === "created" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-gray-50 text-gray-600 border border-gray-200"}`}>
          {result.status === "created" ? (
            <>
              <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Session replayed — Invoice #{result.invoiceId} created, client provisioned.
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Already processed — no changes made.
            </>
          )}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-xs font-medium bg-red-50 text-red-700 border border-red-200">
          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {error}
        </div>
      )}
    </div>
  );
}
