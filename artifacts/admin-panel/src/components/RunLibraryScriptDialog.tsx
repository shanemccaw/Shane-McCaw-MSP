import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  startPoll,
  attachStatusListener,
  detachStatusListener,
  getLastStatus,
  isActive,
  stopPoll,
  registerTaskJob,
  type RunStatus,
} from "@/lib/scriptPoller";

interface ClientEntry {
  id: number;
  name: string | null;
  appRegistration: { id: number; tenantId: string; azureClientId: string; keyVaultSecretName: string; status: string } | null;
}

interface Props {
  scriptId?: string;
  moduleId?: string;
  scriptTitle: string;
  onClose: () => void;
  initialClientId?: number | null;
  /** Pre-validated App Registration ID from the parent's pre-flight check.
   *  When provided, the client list fetch is skipped entirely and autoRun
   *  fires as soon as the component mounts — no network round-trip needed. */
  initialAppRegistrationId?: number | null;
  kanbanTaskId?: number | null;
  onRunComplete?: (status: "completed" | "failed", scriptTitle: string) => void;
  autoRun?: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function RunLibraryScriptDialog({ scriptId, moduleId, scriptTitle, onClose, initialClientId, initialAppRegistrationId, kanbanTaskId, onRunComplete, autoRun }: Props) {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();

  const [clients, setClients] = useState<ClientEntry[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<number | null>(initialClientId ?? null);
  // If the parent already pre-validated an app reg, start with it and skip loading
  const [loadingClients, setLoadingClients] = useState(initialAppRegistrationId == null);
  const [appRegistrationId, setAppRegistrationId] = useState<number | null>(initialAppRegistrationId ?? null);

  const [running, setRunning] = useState(false);
  const [jobRef, setJobRef] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<RunStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const terminalRef = useRef<HTMLDivElement>(null);
  const jobRefRef = useRef<string | null>(null);

  // Load clients with credentials.
  // When initialAppRegistrationId is already provided (pre-validated by parent), skip the
  // round-trip entirely — loadingClients is already false and appRegistrationId is already set.
  useEffect(() => {
    if (initialAppRegistrationId != null) return;
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
  }, [fetchWithAuth, toast, initialClientId, initialAppRegistrationId]);

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

  // Reset saved state when a new run starts
  useEffect(() => {
    if (running) setSaved(false);
  }, [running]);

  // On unmount: detach the live UI listener so the poll keeps running in the background
  useEffect(() => {
    return () => {
      if (jobRefRef.current && isActive(jobRefRef.current)) {
        detachStatusListener(jobRefRef.current);
      }
    };
  }, []);

  // autoRun: fire handleRun() once credentials are resolved, without requiring a second button click.
  // NOTE: appRegistrationId is set in a *separate* useEffect (clients → appRegistrationId), so it may
  // still be null on the first render where loadingClients becomes false. We therefore keep re-checking
  // on each deps change rather than marking fired immediately when appRegistrationId is null.
  const autoRunFiredRef = useRef(false);
  useEffect(() => {
    if (!autoRun || loadingClients || autoRunFiredRef.current) return;
    if (appRegistrationId != null) {
      // Definitive: client has an app reg — fire the run
      autoRunFiredRef.current = true;
      void handleRun();
    } else {
      // appRegistrationId is null — could be transient (effect ordering) or definitive (no app reg).
      // Check the clients list directly to distinguish.
      const client = clients.find(c => c.id === selectedClientId);
      const definitivelyNone =
        selectedClientId == null ||
        (client != null && client.appRegistration == null);
      if (definitivelyNone) {
        // No app reg will ever appear — stop retrying; amber warning box already visible
        autoRunFiredRef.current = true;
      }
      // else: client not found yet / state still settling — effect will re-fire when appRegistrationId updates
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun, loadingClients, appRegistrationId, clients, selectedClientId]);

  // The backend (processRunInBackground) now owns all kanban task status writes — it bulk-updates
  // the triggering card AND all sibling cards sharing the same runbook. Patching only the triggering
  // card here would diverge siblings. Keep the callback signature for startPoll compatibility but
  // make it a no-op.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const patchKanbanTask = useCallback(async (_status: "completed" | "failed", _outputLines: string[]) => {
    // no-op: backend handles all kanban task column + completionNotes updates
  }, []);

  const handleRun = async () => {
    if (!moduleId && !scriptId) {
      toast({ title: "Script not linked", description: "This card's script metadata is incomplete — re-link it to a library script.", variant: "destructive" });
      return;
    }
    if (!moduleId && scriptId && !UUID_RE.test(scriptId)) {
      toast({ title: "Script metadata is invalid", description: "The script ID is malformed — re-link this card to a library script.", variant: "destructive" });
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
        const errData = await r.json().catch(() => ({})) as { error?: string; issues?: Array<{ message: string }> };
        // Surface the first Zod issue message for validation failures, otherwise use the error field
        const issueMsg = errData.issues?.[0]?.message;
        throw new Error(issueMsg ? `${errData.error ?? "Validation error"}: ${issueMsg}` : (errData.error ?? "Run failed"));
      }
      const { jobRef: ref } = await r.json() as { jobRef: string };
      setJobRef(ref);
      jobRefRef.current = ref;
      if (kanbanTaskId != null) registerTaskJob(kanbanTaskId, ref);
      const initialStatus: RunStatus = { status: "running", outputLines: [], findings: [], recommendations: [], scoreImpact: {} };
      setRunStatus(initialStatus);

      // Capture stable refs for the background completion callback
      const capturedPatchKanbanTask = patchKanbanTask;
      const capturedOnRunComplete = onRunComplete;
      const capturedScriptTitle = scriptTitle;

      startPoll(
        ref,
        fetchWithAuth,
        (status) => {
          setRunStatus(status);
          if (status.status !== "running") {
            setRunning(false);
          }
        },
        async (status, outputLines) => {
          // This fires even if the dialog has been closed
          await capturedPatchKanbanTask(status, outputLines);
          capturedOnRunComplete?.(status, capturedScriptTitle);
        },
        kanbanTaskId ?? undefined
      );
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Run failed", variant: "destructive" });
      setRunning(false);
    }
  };

  // Re-attach status listener if dialog is opened while a poll is already active for this job
  useEffect(() => {
    if (jobRef && isActive(jobRef)) {
      attachStatusListener(jobRef, (status) => {
        setRunStatus(status);
        if (status.status !== "running") setRunning(false);
      });
      const last = getLastStatus(jobRef);
      if (last) setRunStatus(last);
    }
  }, [jobRef]);

  const handleClose = () => {
    // If a poll is active, detach the UI listener so it runs in background; otherwise stop polling
    if (jobRefRef.current) {
      if (isActive(jobRefRef.current)) {
        detachStatusListener(jobRefRef.current);
      }
    }
    onClose();
  };

  const handleSaveToCard = async () => {
    if (!kanbanTaskId || !runStatus || runStatus.status === "running") return;
    const { findings, recommendations, scoreImpact } = runStatus;

    const top3Findings = findings.slice(0, 3);
    const top3Recs = recommendations.slice(0, 3);
    const findingsSummary = top3Findings.length > 0
      ? "Findings:\n" + top3Findings.map((f, i) => `${i + 1}. ${f}`).join("\n")
      : "";
    const recsSummary = top3Recs.length > 0
      ? "Recommendations:\n" + top3Recs.map((r, i) => `${i + 1}. ${r}`).join("\n")
      : "";
    const completionNotes = [findingsSummary, recsSummary].filter(Boolean).join("\n\n") ||
      `Script '${scriptTitle}' completed with no AI findings.`;

    const lastRunResult = {
      savedAt: new Date().toISOString(),
      jobRef: jobRef ?? "",
      scriptTitle,
      findings,
      recommendations,
      scoreImpact,
    };

    setSaving(true);
    try {
      const res = await fetchWithAuth(`/api/admin/kanban-tasks/${kanbanTaskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskMetadata: { lastRunResult },
          completionNotes,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? "Failed to save");
      }
      setSaved(true);
      toast({ title: "Results saved to card" });
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Failed to save results", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const statusColor = runStatus?.status === "completed" ? "text-green-400" : runStatus?.status === "failed" ? "text-red-400" : "text-yellow-400";
  const statusLabel = runStatus?.status === "completed" ? "Completed" : runStatus?.status === "failed" ? "Failed" : "Running…";

  const aiDone = runStatus && runStatus.status !== "running" &&
    (runStatus.findings.length > 0 || runStatus.recommendations.length > 0);
  const showSaveButton = !!kanbanTaskId && !!runStatus && runStatus.status !== "running";
  const saveEnabled = !saving && !saved && !!aiDone;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-card border border-border rounded-2xl w-full max-w-2xl mx-4 overflow-hidden shadow-2xl flex flex-col" style={{ maxHeight: "90vh" }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-accent">
          <div className="min-w-0">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-0.5">Run Script</p>
            <p className="text-sm font-semibold text-foreground truncate">{scriptTitle}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 ml-3">
            {autoRun && loadingClients && !running && !jobRef && (
              <span className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
                <div className="w-3 h-3 border border-primary border-t-transparent rounded-full animate-spin" />
                Starting…
              </span>
            )}
            {running && (
              <span className="text-xs text-yellow-400 font-medium flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
                Running in background if closed
              </span>
            )}
            <button onClick={handleClose} className="p-1.5 text-muted-foreground/60 hover:text-foreground rounded transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {!scriptId && !moduleId && (
            <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/30 px-4 py-3">
              <p className="text-xs text-yellow-400 font-medium">This card has no script linked. Re-link it to a library script before running.</p>
            </div>
          )}

          {/* Client selector */}
          <div>
            <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Client (optional)</label>
            {loadingClients ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
                <div className="w-3 h-3 border border-primary border-t-transparent rounded-full animate-spin" />
                Loading clients…
              </div>
            ) : (
              <select
                value={selectedClientId ?? ""}
                onChange={e => setSelectedClientId(e.target.value ? parseInt(e.target.value) : null)}
                disabled={running}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs text-foreground outline-none focus:border-primary/50 transition-colors disabled:opacity-50"
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
            disabled={running || (!scriptId && !moduleId) || !appRegistrationId}
            className="w-full flex items-center justify-center gap-2 bg-primary text-white rounded-lg px-4 py-2.5 text-sm font-semibold hover:bg-[#006CBE] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
                {jobRef && <span className="text-xs text-muted-foreground/60">Job: {jobRef.slice(0, 8)}…</span>}
              </div>

              <div
                ref={terminalRef}
                className="bg-background border border-accent rounded-lg p-3 font-mono text-xs overflow-y-auto"
                style={{ height: 200 }}
              >
                {runStatus.outputLines.length === 0 ? (
                  <span className="text-muted-foreground/60">Waiting for output…</span>
                ) : (
                  runStatus.outputLines.map((line, i) => (
                    <div key={i} className="text-foreground leading-relaxed whitespace-pre-wrap break-all">{line}</div>
                  ))
                )}
              </div>

              {runStatus.status !== "running" && runStatus.findings.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">AI Findings</p>
                  {runStatus.findings.map((f, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs text-foreground/90">
                      <span className="text-blue-400 mt-0.5 flex-shrink-0">•</span>
                      <span>{f}</span>
                    </div>
                  ))}
                </div>
              )}

              {runStatus.status !== "running" && runStatus.recommendations.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Recommendations</p>
                  {runStatus.recommendations.map((r, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs text-foreground/90">
                      <span className="text-green-400 mt-0.5 flex-shrink-0">→</span>
                      <span>{r}</span>
                    </div>
                  ))}
                </div>
              )}

              {runStatus.status !== "running" && !aiDone && (
                <p className="text-xs text-muted-foreground/60 italic">No AI findings generated for this run.</p>
              )}
            </div>
          )}
        </div>

        {/* Footer — Save to Card */}
        {showSaveButton && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-accent bg-background/60">
            <p className="text-xs text-muted-foreground/60">
              {saved ? (
                <span className="text-green-400 font-medium">✓ Saved to card</span>
              ) : (
                "Persist AI findings to the linked Kanban card"
              )}
            </p>
            <button
              onClick={() => void handleSaveToCard()}
              disabled={!saveEnabled}
              title={!aiDone && !saved ? "Waiting for AI analysis before saving" : undefined}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-50 disabled:cursor-not-allowed border-primary/40 text-primary hover:bg-primary/10 hover:border-primary"
            >
              {saving ? (
                <><div className="w-3 h-3 border border-primary/40 border-t-primary rounded-full animate-spin" /> Saving…</>
              ) : saved ? (
                <>
                  <svg className="w-3.5 h-3.5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  Saved
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                  </svg>
                  Save to Card
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
