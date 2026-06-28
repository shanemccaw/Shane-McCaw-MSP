import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

interface ClientEntry {
  id: number;
  name: string | null;
  appRegistration: { id: number; tenantId: string; azureClientId: string; keyVaultSecretName: string; status: string } | null;
}

interface RunStatus {
  status: "running" | "completed" | "failed";
  outputLines: string[];
  findings: string[];
  recommendations: string[];
  scoreImpact: Record<string, number>;
}

interface Props {
  scriptId?: string;
  moduleId?: string;
  scriptTitle: string;
  azureRunbookName?: string | null;
  onClose: () => void;
  initialClientId?: number | null;
  kanbanTaskId?: number | null;
}

export default function RunLibraryScriptDialog({ scriptId, moduleId, scriptTitle, azureRunbookName, onClose, initialClientId, kanbanTaskId }: Props) {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();

  const [clients, setClients] = useState<ClientEntry[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<number | null>(initialClientId ?? null);
  const [loadingClients, setLoadingClients] = useState(true);
  const [appRegistrationId, setAppRegistrationId] = useState<number | null>(null);

  const [running, setRunning] = useState(false);
  const [jobRef, setJobRef] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<RunStatus | null>(null);

  const terminalRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load clients with credentials
  useEffect(() => {
    setLoadingClients(true);
    fetchWithAuth("/api/admin/clients/with-azure-credentials")
      .then(r => r.json())
      .then((data: unknown) => {
        const list = Array.isArray(data) ? (data as ClientEntry[]) : [];
        setClients(list);
        if (initialClientId != null && list.some(c => c.id === initialClientId)) {
          setSelectedClientId(initialClientId);
        }
      })
      .catch(() => {
        toast({ title: "Failed to load clients", variant: "destructive" });
      })
      .finally(() => setLoadingClients(false));
  }, [fetchWithAuth, toast, initialClientId]);

  // Auto-select App Registration when client changes
  useEffect(() => {
    const client = clients.find(c => c.id === selectedClientId);
    setAppRegistrationId(client?.appRegistration?.id ?? null);
  }, [selectedClientId, clients]);

  // Auto-scroll terminal
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [runStatus?.outputLines]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const patchKanbanTask = useCallback(async (status: "completed" | "failed", outputLines: string[]) => {
    if (!kanbanTaskId) return;
    const summary = outputLines.slice(-10).join("\n");
    const completionNotes = status === "completed"
      ? `Script '${scriptTitle}' completed successfully.\n\nOutput:\n${summary}`
      : `Script '${scriptTitle}' failed.\n\nOutput:\n${summary}`;
    const patch: Record<string, unknown> = {
      completionNotes,
      completionStatus: status === "completed" ? "script_completed" : "script_failed",
    };
    if (status === "completed") {
      patch.column = "completed";
    }
    try {
      await fetchWithAuth(`/api/admin/kanban-tasks/${kanbanTaskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
    } catch { /* silent */ }
  }, [kanbanTaskId, scriptTitle, fetchWithAuth]);

  const startPolling = useCallback((ref: string) => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetchWithAuth(`/api/admin/run-script/${ref}/status`);
        if (!r.ok) { stopPolling(); return; }
        const data = await r.json() as RunStatus;
        setRunStatus(data);
        if (data.status !== "running") {
          stopPolling();
          setRunning(false);
          void patchKanbanTask(data.status, data.outputLines);
        }
      } catch {
        stopPolling();
        setRunning(false);
      }
    }, 4000);
  }, [fetchWithAuth, stopPolling, patchKanbanTask]);

  const handleRun = async () => {
    if (!moduleId && !azureRunbookName) {
      toast({ title: "Script not pushed to Azure", description: "Push this script to Azure Automation first", variant: "destructive" });
      return;
    }
    if (!appRegistrationId) {
      toast({ title: "Select a client with an App Registration", variant: "destructive" });
      return;
    }
    setRunning(true);
    setRunStatus(null);
    try {
      const body: Record<string, unknown> = moduleId
        ? { libraryModuleId: moduleId }
        : { libraryScriptId: scriptId };
      if (appRegistrationId) body.appRegistrationId = appRegistrationId;
      if (selectedClientId) body.customerId = selectedClientId;
      if (kanbanTaskId) body.kanbanTaskId = kanbanTaskId;

      const r = await fetchWithAuth("/api/admin/run-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? "Run failed");
      }
      const { jobRef: ref } = await r.json() as { jobRef: string };
      setJobRef(ref);
      setRunStatus({ status: "running", outputLines: [], findings: [], recommendations: [], scoreImpact: {} });
      startPolling(ref);
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Run failed", variant: "destructive" });
      setRunning(false);
    }
  };

  const statusColor = runStatus?.status === "completed" ? "text-green-400" : runStatus?.status === "failed" ? "text-red-400" : "text-yellow-400";
  const statusLabel = runStatus?.status === "completed" ? "Completed" : runStatus?.status === "failed" ? "Failed" : "Running…";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-[#161B22] border border-[#30363D] rounded-2xl w-full max-w-2xl mx-4 overflow-hidden shadow-2xl flex flex-col" style={{ maxHeight: "90vh" }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#21262D]">
          <div className="min-w-0">
            <p className="text-xs font-bold text-[#7D8590] uppercase tracking-wider mb-0.5">Run Script</p>
            <p className="text-sm font-semibold text-[#E6EDF3] truncate">{scriptTitle}</p>
            {azureRunbookName && (
              <p className="text-xs text-[#484F58] mt-0.5 truncate">Runbook: {azureRunbookName}</p>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 text-[#484F58] hover:text-[#E6EDF3] rounded transition-colors flex-shrink-0 ml-3">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {!azureRunbookName && (
            <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/30 px-4 py-3">
              <p className="text-xs text-yellow-400 font-medium">This script has not been pushed to Azure Automation yet. Push it first from the Library editor before running.</p>
            </div>
          )}

          {/* Client selector */}
          <div>
            <label className="block text-xs font-semibold text-[#7D8590] uppercase tracking-wider mb-2">Client (optional)</label>
            {loadingClients ? (
              <div className="flex items-center gap-2 text-xs text-[#484F58]">
                <div className="w-3 h-3 border border-[#0078D4] border-t-transparent rounded-full animate-spin" />
                Loading clients…
              </div>
            ) : (
              <select
                value={selectedClientId ?? ""}
                onChange={e => setSelectedClientId(e.target.value ? parseInt(e.target.value) : null)}
                className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-xs text-[#E6EDF3] outline-none focus:border-[#0078D4]/50 transition-colors"
              >
                <option value="">— No client / run standalone —</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name ?? `Client #${c.id}`}
                    {c.appRegistration ? ` (App Registration — ${c.appRegistration.status})` : " — no App Registration"}
                  </option>
                ))}
              </select>
            )}
          </div>

          {selectedClientId && !appRegistrationId && (
            <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 px-4 py-3">
              <p className="text-xs text-amber-400">This client has no App Registration linked — the Run button is disabled. Add one in the CRM first.</p>
            </div>
          )}

          {/* Run button */}
          <button
            onClick={() => void handleRun()}
            disabled={running || !azureRunbookName || !appRegistrationId}
            className="w-full flex items-center justify-center gap-2 bg-[#0078D4] text-white rounded-lg px-4 py-2.5 text-sm font-semibold hover:bg-[#006CBE] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {running ? (
              <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Running…</>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                Run Script
              </>
            )}
          </button>

          {/* Terminal output */}
          {runStatus && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className={`text-xs font-semibold ${statusColor}`}>{statusLabel}</span>
                {jobRef && <span className="text-xs text-[#484F58]">Job: {jobRef.slice(0, 8)}…</span>}
              </div>

              <div
                ref={terminalRef}
                className="bg-[#0D1117] border border-[#21262D] rounded-lg p-3 font-mono text-xs overflow-y-auto"
                style={{ height: 200 }}
              >
                {runStatus.outputLines.length === 0 ? (
                  <span className="text-[#484F58]">Waiting for output…</span>
                ) : (
                  runStatus.outputLines.map((line, i) => (
                    <div key={i} className="text-[#E6EDF3] leading-relaxed whitespace-pre-wrap break-all">{line}</div>
                  ))
                )}
              </div>

              {runStatus.status !== "running" && runStatus.findings.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-[#7D8590] uppercase tracking-wider">AI Findings</p>
                  {runStatus.findings.map((f, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs text-[#C9D1D9]">
                      <span className="text-blue-400 mt-0.5 flex-shrink-0">•</span>
                      <span>{f}</span>
                    </div>
                  ))}
                </div>
              )}

              {runStatus.status !== "running" && runStatus.recommendations.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-[#7D8590] uppercase tracking-wider">Recommendations</p>
                  {runStatus.recommendations.map((r, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs text-[#C9D1D9]">
                      <span className="text-green-400 mt-0.5 flex-shrink-0">→</span>
                      <span>{r}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
