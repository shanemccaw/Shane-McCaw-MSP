import { useState, useEffect, useCallback, useMemo } from "react";
import DOMPurify from "dompurify";
import { useAuth } from "@/contexts/AuthContext";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface ClientOption {
  id: number;
  name: string;
  email: string;
  company: string | null;
  projects: Array<{ id: number; title: string }>;
}

interface SowDebugLogEntry {
  ts: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  meta?: Record<string, unknown>;
}

interface SowDebugRun {
  correlationId: string;
  createdAt: string;
  clientUserId: number;
  projectId: number | null;
  logs: SowDebugLogEntry[];
  signals: {
    firedSignals?: string[];
    firedAdjSignalKeys?: string[];
    includedProjectTitles?: string[];
    excludedProjectTitles?: string[];
    signalFilterMeta?: { clean: boolean; conflictCount: number };
    usedOverride?: boolean;
  };
  status: "running" | "success" | "failed";
  error?: string;
}

interface AiPrompt {
  id: number | null;
  key: string;
  name: string;
  promptBody: string;
  defaultBody: string;
}

const PROMPT_KEY = "insights-consulting-consolidated_sow";
const LEVEL_COLORS: Record<string, string> = {
  debug: "text-muted-foreground",
  info: "text-primary",
  warn: "text-amber-400",
  error: "text-red-400",
};

export default function SowDebugPage() {
  const { fetchWithAuth } = useAuth();

  const [clients, setClients] = useState<ClientOption[]>([]);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");

  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [htmlContent, setHtmlContent] = useState<string>("");
  const [sowTotal, setSowTotal] = useState<number | null>(null);
  const [clientName, setClientName] = useState<string>("");
  const [correlationId, setCorrelationId] = useState<string | null>(null);

  const [debugOpen, setDebugOpen] = useState(false);
  const [run, setRun] = useState<SowDebugRun | null>(null);
  const [runLoading, setRunLoading] = useState(false);
  const [logFilter, setLogFilter] = useState<"all" | "warn" | "error">("all");

  const [prompt, setPrompt] = useState<AiPrompt | null>(null);
  const [promptBody, setPromptBody] = useState("");
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptSaving, setPromptSaving] = useState(false);
  const [promptSaved, setPromptSaved] = useState<string | null>(null);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [promptEditorOpen, setPromptEditorOpen] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetchWithAuth("/api/admin/sow-debug/clients");
        if (!res.ok) throw new Error("Failed to load clients");
        const data = await res.json() as { clients: ClientOption[] };
        setClients(data.clients);
      } catch {
        // leave clients empty — the select will show a helpful placeholder
      } finally {
        setClientsLoading(false);
      }
    })();
  }, [fetchWithAuth]);

  const selectedClient = useMemo(
    () => clients.find(c => String(c.id) === selectedClientId) ?? null,
    [clients, selectedClientId],
  );

  const loadRun = useCallback(async (id: string) => {
    setRunLoading(true);
    try {
      const res = await fetchWithAuth(`/api/admin/sow-debug/runs/${id}`);
      if (!res.ok) throw new Error("Run not found");
      const data = await res.json() as { run: SowDebugRun };
      setRun(data.run);
    } catch {
      setRun(null);
    } finally {
      setRunLoading(false);
    }
  }, [fetchWithAuth]);

  const generate = useCallback(async () => {
    if (!selectedClientId) {
      setGenError("Select a client first");
      return;
    }
    setGenerating(true);
    setGenError(null);
    try {
      const res = await fetchWithAuth("/api/admin/sow-debug/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientUserId: Number(selectedClientId),
          projectId: selectedProjectId ? Number(selectedProjectId) : null,
        }),
      });
      const data = await res.json() as {
        correlationId: string;
        htmlContent?: string;
        sowTotal?: number;
        clientName?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Generation failed");
      setHtmlContent(data.htmlContent ?? "");
      setSowTotal(data.sowTotal ?? null);
      setClientName(data.clientName ?? "");
      setCorrelationId(data.correlationId);
      await loadRun(data.correlationId);
      setDebugOpen(true);
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }, [selectedClientId, selectedProjectId, fetchWithAuth, loadRun]);

  const loadPrompt = useCallback(async () => {
    setPromptLoading(true);
    setPromptError(null);
    try {
      const res = await fetchWithAuth(`/api/admin/ai-prompts/by-key/${PROMPT_KEY}`);
      if (!res.ok) throw new Error("Failed to load prompt");
      const data = await res.json() as { prompt: AiPrompt };
      setPrompt(data.prompt);
      setPromptBody(data.prompt.promptBody);
    } catch (err) {
      setPromptError(err instanceof Error ? err.message : "Failed to load prompt");
    } finally {
      setPromptLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    if (promptEditorOpen && !prompt && !promptLoading) {
      void loadPrompt();
    }
  }, [promptEditorOpen, prompt, promptLoading, loadPrompt]);

  const savePrompt = useCallback(async () => {
    setPromptSaving(true);
    setPromptError(null);
    setPromptSaved(null);
    try {
      const res = await fetchWithAuth(`/api/admin/ai-prompts/by-key/${PROMPT_KEY}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promptBody }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Failed to save prompt");
      }
      setPromptSaved("Published — this is now the live SOW prompt");
      await loadPrompt();
    } catch (err) {
      setPromptError(err instanceof Error ? err.message : "Failed to save prompt");
    } finally {
      setPromptSaving(false);
    }
  }, [promptBody, fetchWithAuth, loadPrompt]);

  const filteredLogs = useMemo(() => {
    if (!run) return [];
    if (logFilter === "all") return run.logs;
    if (logFilter === "warn") return run.logs.filter(l => l.level === "warn" || l.level === "error");
    return run.logs.filter(l => l.level === "error");
  }, [run, logFilter]);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">SOW Generation Debug</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Run the real Consolidated SOW generator against any client without persisting the result,
          then inspect the signals that fired, the step-by-step log, and the live prompt.
        </p>
      </div>

      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Client</label>
            <select
              className="bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground min-w-[220px]"
              value={selectedClientId}
              onChange={(e) => { setSelectedClientId(e.target.value); setSelectedProjectId(""); }}
              disabled={clientsLoading}
            >
              <option value="">{clientsLoading ? "Loading clients…" : "Select a client"}</option>
              {clients.map(c => (
                <option key={c.id} value={c.id}>{c.company || c.name} ({c.email})</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Project (optional)</label>
            <select
              className="bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground min-w-[200px]"
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              disabled={!selectedClient || selectedClient.projects.length === 0}
            >
              <option value="">No project</option>
              {selectedClient?.projects.map(p => (
                <option key={p.id} value={p.id}>{p.title}</option>
              ))}
            </select>
          </div>
          <button
            onClick={() => void generate()}
            disabled={generating || !selectedClientId}
            className="bg-primary hover:bg-[#0086EF] disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded-md"
          >
            {generating ? "Generating…" : correlationId ? "Regenerate SOW" : "Generate SOW"}
          </button>
          {correlationId && (
            <span className="text-xs text-muted-foreground">Run ID: {correlationId.slice(0, 8)}…</span>
          )}
        </div>
        {genError && <p className="text-sm text-red-400">{genError}</p>}
        <p className="text-xs text-muted-foreground">
          Generation runs in test mode — nothing is written to the database and no client-facing
          document is created.
        </p>
      </div>

      {htmlContent && (
        <div className="bg-card border border-border rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Generated SOW — {clientName}</h2>
            {sowTotal != null && (
              <span className="text-sm text-[#00B4D8] font-medium">
                {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(sowTotal)}
              </span>
            )}
          </div>
          <div
            className="bg-white text-black rounded-md p-6 max-h-[600px] overflow-y-auto text-sm"
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(htmlContent) }}
          />
        </div>
      )}

      <Collapsible open={debugOpen} onOpenChange={setDebugOpen}>
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <CollapsibleTrigger asChild>
            <button className="w-full flex items-center justify-between px-5 py-4 text-left">
              <span className="text-sm font-semibold text-foreground">Debug Panel</span>
              <span className="text-xs text-muted-foreground">{debugOpen ? "Collapse ▲" : "Expand ▼"}</span>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="px-5 pb-5 space-y-6 border-t border-border pt-5">

              {/* Signal Output */}
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-2">Signal Output</h3>
                {runLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
                {!runLoading && !run && (
                  <p className="text-sm text-muted-foreground">Generate a SOW above to see fired signals.</p>
                )}
                {!runLoading && run && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                    <div>
                      <p className="text-muted-foreground mb-1">Fired signals ({run.signals.firedSignals?.length ?? 0})</p>
                      <pre className="bg-background border border-border rounded-md p-3 overflow-x-auto text-primary">
{JSON.stringify(run.signals.firedSignals ?? [], null, 2)}
                      </pre>
                    </div>
                    <div>
                      <p className="text-muted-foreground mb-1">Fired adjustment signals ({run.signals.firedAdjSignalKeys?.length ?? 0})</p>
                      <pre className="bg-background border border-border rounded-md p-3 overflow-x-auto text-amber-400">
{JSON.stringify(run.signals.firedAdjSignalKeys ?? [], null, 2)}
                      </pre>
                    </div>
                    <div>
                      <p className="text-muted-foreground mb-1">Included projects ({run.signals.includedProjectTitles?.length ?? 0})</p>
                      <pre className="bg-background border border-border rounded-md p-3 overflow-x-auto text-green-400">
{JSON.stringify(run.signals.includedProjectTitles ?? [], null, 2)}
                      </pre>
                    </div>
                    <div>
                      <p className="text-muted-foreground mb-1">Excluded projects ({run.signals.excludedProjectTitles?.length ?? 0})</p>
                      <pre className="bg-background border border-border rounded-md p-3 overflow-x-auto text-muted-foreground">
{JSON.stringify(run.signals.excludedProjectTitles ?? [], null, 2)}
                      </pre>
                    </div>
                    {run.signals.signalFilterMeta && !run.signals.signalFilterMeta.clean && (
                      <div className="md:col-span-2 text-amber-400">
                        ⚠ {run.signals.signalFilterMeta.conflictCount} signal rule conflict(s) detected during evaluation.
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Logs */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-foreground">Logs</h3>
                  <div className="flex gap-1">
                    {(["all", "warn", "error"] as const).map(f => (
                      <button
                        key={f}
                        onClick={() => setLogFilter(f)}
                        className={`text-xs px-2 py-1 rounded-md border ${
                          logFilter === f
                            ? "bg-primary/20 border-primary text-primary"
                            : "border-border text-muted-foreground"
                        }`}
                      >
                        {f === "all" ? "All" : f === "warn" ? "Warnings+" : "Errors"}
                      </button>
                    ))}
                  </div>
                </div>
                {run && filteredLogs.length === 0 && (
                  <p className="text-sm text-muted-foreground">No log entries match this filter.</p>
                )}
                {!run && <p className="text-sm text-muted-foreground">No run yet.</p>}
                {run && filteredLogs.length > 0 && (
                  <div className="bg-background border border-border rounded-md max-h-72 overflow-y-auto font-mono text-xs">
                    {filteredLogs.map((l, i) => (
                      <div key={i} className="px-3 py-2 border-b border-card last:border-b-0">
                        <span className="text-muted-foreground/60">{new Date(l.ts).toLocaleTimeString()}</span>{" "}
                        <span className={`font-semibold ${LEVEL_COLORS[l.level]}`}>[{l.level.toUpperCase()}]</span>{" "}
                        <span className="text-foreground">{l.message}</span>
                        {l.meta && (
                          <pre className="text-muted-foreground mt-1 whitespace-pre-wrap">{JSON.stringify(l.meta, null, 2)}</pre>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {run?.status === "failed" && run.error && (
                  <p className="text-sm text-red-400 mt-2">Run failed: {run.error}</p>
                )}
              </div>

              {/* AI Prompt Editor */}
              <Collapsible open={promptEditorOpen} onOpenChange={setPromptEditorOpen}>
                <CollapsibleTrigger asChild>
                  <button className="text-sm font-semibold text-foreground flex items-center gap-2">
                    AI Prompt Editor — {PROMPT_KEY}
                    <span className="text-xs text-muted-foreground">{promptEditorOpen ? "▲" : "▼"}</span>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="mt-3 space-y-3">
                    {promptLoading && <p className="text-sm text-muted-foreground">Loading prompt…</p>}
                    {promptError && <p className="text-sm text-red-400">{promptError}</p>}
                    {promptSaved && <p className="text-sm text-green-400">{promptSaved}</p>}
                    {prompt && (
                      <>
                        <textarea
                          value={promptBody}
                          onChange={(e) => { setPromptBody(e.target.value); setPromptSaved(null); }}
                          className="w-full h-64 bg-background border border-border rounded-md p-3 text-xs font-mono text-foreground"
                          spellCheck={false}
                        />
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => void savePrompt()}
                            disabled={promptSaving || !promptBody.trim()}
                            className="bg-primary hover:bg-[#0086EF] disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-md"
                          >
                            {promptSaving ? "Publishing…" : "Publish Prompt"}
                          </button>
                          <button
                            onClick={() => setPromptBody(prompt.defaultBody)}
                            className="text-xs text-muted-foreground hover:text-foreground underline"
                          >
                            Reset editor to default body
                          </button>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Publishing here updates the live prompt used by all Consolidated SOW generation —
                          including client-facing document generation. Generate a new debug run afterward
                          to see the effect.
                        </p>
                      </>
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>
    </div>
  );
}
