import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { GovernanceAreasPicker } from "@/components/kanban/TypedCardContent";

interface AzureCredential {
  id: number;
  displayName: string | null;
  tenantId: string | null;
  clientId: string | null;
  credentialType: "secret" | "certificate" | null;
  keyVaultSecretName: string | null;
}

interface ClientWithCredential {
  id: number;
  name: string;
  email: string;
  credential: AzureCredential | null;
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
  "Never run":  { cls: "bg-[#30363D]/50 text-[#7D8590]" },
  "New":        { cls: "bg-[#0078D4]/100/15 text-blue-400" },
  "Activating": { cls: "bg-[#0078D4]/100/15 text-blue-400" },
  "Running":    { cls: "bg-yellow-500/15 text-yellow-400" },
  "Completed":  { cls: "bg-green-500/15 text-green-400" },
  "Failed":     { cls: "bg-red-500/15 text-red-400" },
  "Stopped":    { cls: "bg-[#30363D]/50 text-[#7D8590]" },
  "Suspended":  { cls: "bg-orange-500/15 text-orange-400" },
};

const inputCls = "w-full border border-border rounded-lg px-3 py-2 text-sm text-[#E6EDF3] focus:outline-none focus:ring-2 focus:ring-[#0078D4]/40 bg-[#161B22]";
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

interface AIAnalysis {
  summary: string;
  risks: string[];
  recommendations: string[];
  nextSteps: string[];
}

const AI_TABS = [
  { id: "summary", label: "Summary" },
  { id: "risks", label: "Risks" },
  { id: "recommendations", label: "Recommendations" },
  { id: "nextSteps", label: "Next Steps" },
] as const;

type AITab = typeof AI_TABS[number]["id"];

export default function ScriptRunnerPage() {
  const [, navigate] = useLocation();
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();

  const [clients, setClients] = useState<ClientWithCredential[]>([]);
  const [runbooks, setRunbooks] = useState<RunbookSummary[]>([]);
  const [loadingClients, setLoadingClients] = useState(true);
  const [loadingRunbooks, setLoadingRunbooks] = useState(false);
  const [azureConfigured, setAzureConfigured] = useState<boolean | null>(null);

  const [selectedClientId, setSelectedClientId] = useState<number | "">("");
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
  const [refetchingJobId, setRefetchingJobId] = useState<string | null>(null);

  // AI Analysis
  const [aiAnalysis, setAiAnalysis] = useState<AIAnalysis | null>(null);
  const [analyzingAI, setAnalyzingAI] = useState(false);
  const [aiTab, setAiTab] = useState<AITab>("summary");
  const [aiError, setAiError] = useState<string | null>(null);

  // Test SMS
  const [smsSending, setSmsSending] = useState(false);
  const [smsResult, setSmsResult] = useState<{ ok: boolean; message: string } | null>(null);

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
    void loadClients();
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

  const sendTestSms = async () => {
    setSmsSending(true);
    setSmsResult(null);
    try {
      const res = await fetchWithAuth("/api/admin/test-sms", { method: "POST" });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (res.ok && data.ok) {
        setSmsResult({ ok: true, message: "Test SMS sent! Check your phone." });
      } else {
        setSmsResult({ ok: false, message: data.error ?? "Send failed — check server logs." });
      }
    } catch {
      setSmsResult({ ok: false, message: "Network error — could not reach the server." });
    } finally {
      setSmsSending(false);
    }
  };

  const loadClients = async () => {
    setLoadingClients(true);
    try {
      const res = await fetchWithAuth("/api/admin/clients/with-azure-credentials");
      if (res.ok) {
        const data = await res.json() as ClientWithCredential[];
        setClients(data);
      }
    } finally {
      setLoadingClients(false);
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
    setAiAnalysis(null);
    setAiError(null);

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

  const handleAnalyzeWithAI = async () => {
    if (!logLines.length || running) return;
    setAnalyzingAI(true);
    setAiAnalysis(null);
    setAiError(null);
    setAiTab("summary");
    const selectedClient = clients.find(c => c.id === selectedClientId);
    try {
      const res = await fetchWithAuth("/api/admin/scripts/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          output: logLines.join("\n"),
          runbookName: logLabel
            ? logLabel.split(" — ")[0]?.trim()
            : selectedRunbook || undefined,
          customerName: logLabel
            ? logLabel.split(" — ")[1]?.trim()
            : selectedClient?.name,
        }),
      });
      const data = await res.json() as AIAnalysis & { error?: string };
      if (!res.ok) {
        setAiError(data.error ?? "AI analysis failed");
        return;
      }
      setAiAnalysis(data);
    } catch {
      setAiError("Request failed — check connection");
    } finally {
      setAnalyzingAI(false);
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

  const handleRefetch = async (row: JobHistoryRow, e: React.MouseEvent) => {
    e.stopPropagation();
    if (refetchingJobId === row.jobId) return;
    setRefetchingJobId(row.jobId);
    try {
      const res = await fetchWithAuth(
        `/api/admin/runbook-jobs/${encodeURIComponent(row.jobId)}/refetch-output`,
        { method: "POST" },
      );
      const data = await res.json() as {
        runbookName?: string;
        customerName?: string;
        status?: string;
        lines?: Array<{ sequence: number; text: string }>;
        error?: string;
      };
      if (!res.ok) {
        toast({ title: "Re-fetch failed", description: data.error ?? `HTTP ${res.status}`, variant: "destructive" });
        return;
      }
      const lines = data.lines ?? [];
      const fullOutput = lines.map(l => l.text).join("\n");
      // Update the local history row so replay becomes available without a full reload
      setHistory(prev => prev.map(h =>
        h.jobId === row.jobId ? { ...h, output: fullOutput || null } : h,
      ));
      if (lines.length === 0) {
        toast({ title: "No output found", description: "Azure Automation returned no stream records for this job." });
        return;
      }
      // Load the freshly fetched output into the console
      setJobStatus(data.status ?? row.status);
      setLogLines(lines.map(l => l.text));
      setLogLabel(`${data.runbookName ?? row.runbookName} — ${data.customerName ?? row.customerName}`);
      setAiAnalysis(null);
      setAiError(null);
      toast({ title: "Output recovered", description: `${lines.length} line${lines.length === 1 ? "" : "s"} loaded from Azure Automation.` });
    } catch {
      toast({ title: "Re-fetch failed", description: "Network error — could not reach the server.", variant: "destructive" });
    } finally {
      setRefetchingJobId(null);
    }
  };

  const statusCfg = JOB_STATUS_CFG[jobStatus] ?? { cls: "bg-[#30363D]/50 text-[#7D8590]" };
  const canRun = !!selectedCredId && !!selectedRunbook && !running && (governanceAreas === null || governanceAreas.length > 0);

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#E6EDF3]">Script Runner</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Run Azure Automation Runbooks against customer tenants</p>
        </div>
        <button
          onClick={() => navigate("/crm/clients")}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#0078D4] border border-[#0078D4]/30 hover:border-[#0078D4] hover:bg-[#0078D4]/10 rounded-lg px-3 py-2 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Manage Clients
        </button>
      </div>

      {azureConfigured === false && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/100/10 p-5 space-y-3">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-amber-400 mb-1">Azure Automation is not configured</p>
              <p className="text-xs text-amber-400 leading-relaxed mb-3">
                Add the following 7 secrets to <strong>Replit Secrets</strong> (Tools → Secrets in the sidebar) to enable Script Runner. The values come from your Azure App Registration and Automation account.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 font-mono text-xs text-amber-400">
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
                    <span className="text-amber-400 font-sans text-[10px]">{hint}</span>
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
          <div className="bg-[#161B22] border border-border rounded-xl p-4 space-y-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Configuration</p>

            <div>
              <label className={labelCls}>Customer</label>
              {loadingClients ? (
                <div className="h-9 bg-[#1C2128] rounded-lg animate-pulse" />
              ) : (
                <select
                  className={inputCls}
                  value={selectedClientId}
                  onChange={e => {
                    const clientId = e.target.value ? Number(e.target.value) : "";
                    setSelectedClientId(clientId);
                    if (clientId) {
                      const client = clients.find(c => c.id === clientId);
                      setSelectedCredId(client?.credential?.id ?? "");
                    } else {
                      setSelectedCredId("");
                    }
                  }}
                >
                  <option value="">Select a customer…</option>
                  {clients.map(c => (
                    <option key={c.id} value={c.id} disabled={!c.credential}>
                      {c.name}{!c.credential ? " (no Azure credential)" : ""}
                    </option>
                  ))}
                </select>
              )}
              {selectedClientId !== "" && !clients.find(c => c.id === selectedClientId)?.credential && (
                <p className="text-[10px] text-amber-400 mt-1.5">
                  No Azure credential set up for this client — add one in the CRM first.
                </p>
              )}
            </div>

            <div>
              <label className={labelCls}>Runbook</label>
              {loadingRunbooks ? (
                <div className="h-9 bg-[#1C2128] rounded-lg animate-pulse" />
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
          {clients.length > 0 && (
            <div className="bg-[#161B22] border border-border rounded-xl p-4 space-y-1">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Customers</p>
                <button
                  onClick={() => navigate("/crm/clients")}
                  className="text-[10px] font-semibold text-[#0078D4] hover:underline"
                >
                  Manage in CRM →
                </button>
              </div>
              {clients.map(c => (
                <div key={c.id} className="flex items-center gap-2 py-1.5">
                  <div
                    className={`w-2 h-2 rounded-full flex-shrink-0 ${c.credential ? "bg-green-500" : "bg-[#30363D]"}`}
                    title={c.credential ? "Azure credential configured" : "No Azure credential"}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#E6EDF3] truncate">{c.name}</p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {c.credential
                        ? (c.credential.credentialType === "certificate" ? "Certificate" : "Client Secret")
                        : "No credential"}
                    </p>
                  </div>
                  <button
                    onClick={() => navigate(`/crm/clients/${c.id}`)}
                    className="flex-shrink-0 p-1 text-muted-foreground hover:text-[#0078D4] rounded transition-colors"
                    title="View client profile"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Log panel */}
        <div className="lg:col-span-2 space-y-3">
          <div className="bg-[#161B22] border border-border rounded-xl overflow-hidden">
            <div className="flex items-center justify-between flex-wrap gap-3 px-4 py-3 border-b border-border bg-[#1C2128]">
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
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => void handleAnalyzeWithAI()}
                      disabled={analyzingAI}
                      className="flex items-center gap-1 text-[10px] font-semibold bg-[#0078D4]/15 text-[#0078D4] border border-[#0078D4]/30 hover:bg-[#0078D4]/25 disabled:opacity-50 px-2 py-0.5 rounded-md transition-colors"
                    >
                      {analyzingAI ? (
                        <div className="w-3 h-3 border-2 border-[#0078D4]/40 border-t-[#0078D4] rounded-full animate-spin" />
                      ) : (
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                        </svg>
                      )}
                      {analyzingAI ? "Analyzing…" : "Analyze with AI"}
                    </button>
                    <button
                      onClick={() => { setLogLines([]); setJobStatus("Never run"); setLogLabel(null); setAiAnalysis(null); setAiError(null); }}
                      className="text-[10px] font-semibold text-muted-foreground hover:text-[#E6EDF3] transition-colors"
                    >
                      Clear
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-gray-900 min-h-64 max-h-[600px] overflow-y-auto p-4 font-mono text-xs text-gray-100">
              {logLines.length === 0 ? (
                <p className="text-[#7D8590] italic">Select a customer and runbook, then click Run to start.</p>
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

          {/* ── AI Analysis Panel ── */}
          {(logLines.length > 0 || aiAnalysis) && (
            <div className="bg-[#161B22] border border-border rounded-xl overflow-hidden">
              {/* Header */}
              <div className="px-4 py-3 bg-[#1C2128] border-b border-border">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-lg bg-[#0078D4]/15 flex items-center justify-center flex-shrink-0">
                      <svg className="w-3.5 h-3.5 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                      </svg>
                    </div>
                    <p className="text-xs font-bold text-[#E6EDF3]">AI Analysis</p>
                    <span className="text-[10px] text-muted-foreground">powered by Claude</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => { toast({ title: "Update Client Scores", description: "Client assessment scores will be updated from this run. (Coming soon)" }); }}
                      className="text-[10px] font-semibold text-emerald-400 border border-emerald-500/20 bg-emerald-500/10 hover:bg-emerald-500/20 px-2.5 py-1 rounded-lg transition-colors"
                    >
                      Update Client Scores
                    </button>
                    {!aiAnalysis && !analyzingAI && !running && (
                      <button
                        onClick={() => void handleAnalyzeWithAI()}
                        className="text-[10px] font-semibold text-white bg-[#0078D4] hover:bg-[#0078D4]/90 px-2.5 py-1 rounded-lg transition-colors"
                      >
                        Run Analysis
                      </button>
                    )}
                  </div>
                </div>

                {/* Tabs */}
                <div className="flex gap-1">
                  {AI_TABS.map(tab => (
                    <button
                      key={tab.id}
                      onClick={() => setAiTab(tab.id)}
                      className={`text-[10px] font-semibold px-2.5 py-1 rounded-md transition-colors ${
                        aiTab === tab.id
                          ? "bg-[#0078D4]/20 text-[#0078D4]"
                          : "text-muted-foreground hover:text-[#E6EDF3] hover:bg-[#30363D]"
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tab content */}
              <div className="p-4 min-h-24">
                {analyzingAI ? (
                  <div className="flex items-center gap-3 py-6 justify-center">
                    <div className="w-5 h-5 border-2 border-[#0078D4]/30 border-t-[#0078D4] rounded-full animate-spin" />
                    <p className="text-sm text-muted-foreground">Analyzing execution output with AI…</p>
                  </div>
                ) : aiError ? (
                  <div className="flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-3">
                    <svg className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-xs text-red-400">{aiError}</p>
                  </div>
                ) : aiAnalysis ? (
                  <div>
                    {aiTab === "summary" && (
                      <p className="text-sm text-[#E6EDF3]/90 leading-relaxed">{aiAnalysis.summary}</p>
                    )}
                    {aiTab === "risks" && (
                      <ul className="space-y-2">
                        {aiAnalysis.risks.map((r, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs text-[#E6EDF3]/90">
                            <span className="text-red-400 flex-shrink-0 mt-0.5">▲</span>
                            {r}
                          </li>
                        ))}
                      </ul>
                    )}
                    {aiTab === "recommendations" && (
                      <ul className="space-y-2">
                        {aiAnalysis.recommendations.map((r, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs text-[#E6EDF3]/90">
                            <span className="text-[#0078D4] flex-shrink-0 mt-0.5">→</span>
                            {r}
                          </li>
                        ))}
                      </ul>
                    )}
                    {aiTab === "nextSteps" && (
                      <ul className="space-y-2">
                        {aiAnalysis.nextSteps.map((s, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs text-[#E6EDF3]/90">
                            <span className="text-emerald-400 font-bold flex-shrink-0 mt-0.5">{i + 1}.</span>
                            {s}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : !running ? (
                  <div className="flex flex-col items-center justify-center py-6 gap-2">
                    <p className="text-xs text-muted-foreground">Click <strong className="text-[#E6EDF3]">Analyze with AI</strong> above to generate a structured analysis of the run output.</p>
                  </div>
                ) : null}
              </div>

              {/* Future Triggers stub */}
              <div className="border-t border-border px-4 py-3 bg-[#1C2128]/50">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">Future Triggers</p>
                    <p className="text-[11px] text-muted-foreground">Auto-trigger workflows based on script output patterns or score thresholds.</p>
                  </div>
                  <span className="text-[10px] font-semibold text-[#0078D4] border border-[#0078D4]/20 bg-[#0078D4]/10 px-2 py-0.5 rounded-full">Coming soon</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Job History */}
      <div className="bg-[#161B22] border border-border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between flex-wrap gap-3 px-4 py-3 border-b border-border bg-[#1C2128]">
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
              <div key={i} className="h-10 bg-[#1C2128] rounded-lg animate-pulse" />
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
            <div className="grid grid-cols-[1fr_1fr_auto_auto_auto] gap-4 px-4 py-2 bg-[#161B22]">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Runbook</span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Customer</span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Duration</span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Started</span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Status</span>
            </div>
            {history.map(row => {
              const cfg = JOB_STATUS_CFG[row.status] ?? { cls: "bg-[#30363D]/50 text-[#7D8590]" };
              const isReplaying = replayingJobId === row.jobId;
              const isRefetching = refetchingJobId === row.jobId;
              const hasOutput = !!row.output;
              const isTerminal = ["Completed", "Failed", "Stopped", "Suspended"].includes(row.status);
              return (
                <div
                  key={row.id}
                  onClick={hasOutput && !running ? () => void handleReplay(row) : undefined}
                  className={`grid grid-cols-[1fr_1fr_auto_auto_auto] gap-4 px-4 py-3 items-center transition-colors group ${hasOutput && !running ? "cursor-pointer hover:bg-[#0078D4]/10/40" : "hover:bg-[#1C2128]/50"}`}
                  title={hasOutput ? "Click to replay stored output" : undefined}
                >
                  <span className="text-sm font-medium text-[#E6EDF3] truncate" title={row.runbookName}>
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
                          <div className="w-3.5 h-3.5 border-2 border-[#30363D] border-t-[#0078D4] rounded-full animate-spin" />
                        ) : (
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 3l14 9-14 9V3z" />
                          </svg>
                        )}
                      </div>
                    )}
                    {!hasOutput && isTerminal && (
                      <button
                        onClick={e => void handleRefetch(row, e)}
                        disabled={isRefetching || running}
                        title="Re-fetch output from Azure Automation"
                        className="flex items-center gap-1 text-[10px] font-semibold text-amber-400 border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 disabled:opacity-50 px-1.5 py-0.5 rounded transition-colors"
                      >
                        {isRefetching ? (
                          <div className="w-2.5 h-2.5 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin" />
                        ) : (
                          <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                        )}
                        {isRefetching ? "Fetching…" : "Re-fetch"}
                      </button>
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

      {/* ── Test SMS ──────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-[#161B22] p-5">
        <div className="flex items-center gap-2 mb-1">
          <svg className="w-4 h-4 text-[#0078D4] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          <h3 className="text-sm font-semibold text-[#E6EDF3]">Test SMS Alert</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Send a test text message to your phone to verify Twilio is configured correctly.
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={() => void sendTestSms()}
            disabled={smsSending}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-[#0078D4] text-white hover:bg-[#0078D4]/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {smsSending ? (
              <>
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Sending…
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
                Send Test SMS
              </>
            )}
          </button>
          {smsResult && (
            <div className={`flex items-center gap-1.5 text-xs font-medium ${smsResult.ok ? "text-green-400" : "text-red-400"}`}>
              {smsResult.ok ? (
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
              {smsResult.message}
            </div>
          )}
        </div>
      </div>
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
    <div className="bg-[#161B22] border border-border rounded-xl p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0">
          <svg className="w-4.5 h-4.5 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </div>
        <div>
          <h2 className="text-sm font-bold text-[#E6EDF3]">Replay Stripe Session</h2>
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
        <div className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-xs font-medium ${result.status === "created" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-[#161B22] text-[#7D8590] border border-[#30363D]"}`}>
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
        <div className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20">
          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {error}
        </div>
      )}
    </div>
  );
}
