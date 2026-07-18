import React, { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Play, Loader2, AlertCircle, CheckCircle2, Copy, FileText, Workflow, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useModal } from "@/contexts/ModalContext";
import { useTestbedContext } from "@/contexts/TestbedContext";

function getStatusBadgeStyle(status: string): string {
  const s = status ? status.toUpperCase() : "";
  if (s.includes("CRITICAL") || s.includes("RISK") || s.includes("EXPANSION") || s.includes("BREACH") || s.includes("FAIL")) {
    return "bg-destructive/10 text-destructive border border-destructive/25";
  }
  if (s.includes("WARN") || s.includes("ATTENTION") || s.includes("ACCELERATING") || s.includes("ENGAGEMENT")) {
    return "bg-amber-400/10 text-amber-400 border border-amber-400/25";
  }
  if (s.includes("HEALTHY") || s.includes("SECURE") || s.includes("OPTIMIZED") || s.includes("COMPLIANT") || s.includes("STABLE")) {
    return "bg-emerald-400/10 text-emerald-400 border border-emerald-400/25";
  }
  return "bg-card text-muted-foreground border border-border";
}

interface EngineDefSummary {
  key: string;
  label: string;
  description: string;
  categoryPrefix: string;
  tenantScoped: boolean;
}

interface EngineRunResult {
  mode: "tenant";
  customerId: number;
  output: unknown;
}

// This panel deliberately has exactly one execution path: POST
// /api/admin/engines/:key/test with a real testbed customer id as tenantId.
// The fake-payload path (runForPayload / free-text sample JSON) has been
// retired platform-wide — there is no fallback here, and none should ever
// be re-added. If tenantId is missing the backend hard-errors.
export function SimulatorEnginesPanel() {
  const { fetchWithAuth } = useAuth();
  const { openModal } = useModal();
  const { selectedCustomerId, selectedCustomer } = useTestbedContext();

  const [engines, setEngines] = useState<EngineDefSummary[]>([]);
  const [loadingEngines, setLoadingEngines] = useState(false);

  const [runningKey, setRunningKey] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, EngineRunResult | { error: string }>>({});

  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [pipelineResult, setPipelineResult] = useState<{
    engines: Record<string, { ok: boolean }>;
    executionMs: number;
  } | null>(null);

  useEffect(() => {
    setLoadingEngines(true);
    fetchWithAuth("/api/admin/engines")
      .then(r => r.json())
      .then(d => setEngines(d.engines ?? []))
      .catch(() => toast.error("Failed to load engine registry"))
      .finally(() => setLoadingEngines(false));
  }, [fetchWithAuth]);

  const handleRunEngine = async (key: string) => {
    if (selectedCustomerId == null) {
      toast.error("Select a testbed customer in the header first");
      return;
    }
    setRunningKey(key);
    try {
      const res = await fetchWithAuth(`/api/admin/engines/${key}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId: selectedCustomerId, debug: true }),
      });
      const data = await res.json();
      if (res.ok) {
        setResults(prev => ({ ...prev, [key]: data as EngineRunResult }));
        toast.success(`${key} ran against real tenant data`);
      } else {
        setResults(prev => ({ ...prev, [key]: { error: data.error ?? "Engine run failed" } }));
        toast.error(data.error ?? "Engine run failed");
      }
    } catch (err: any) {
      setResults(prev => ({ ...prev, [key]: { error: err.message ?? "Network error" } }));
      toast.error(err.message ?? "Network error");
    } finally {
      setRunningKey(null);
    }
  };

  const handleRunPipeline = async () => {
    if (selectedCustomerId == null) {
      toast.error("Select a testbed customer in the header first");
      return;
    }
    setPipelineRunning(true);
    try {
      const res = await fetchWithAuth("/api/simulator/orchestrated-pipeline/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ testbedCustomerId: selectedCustomerId }),
      });
      const data = await res.json();
      if (res.ok) {
        setPipelineResult(data);
        toast.success(`Pipeline ran ${Object.keys(data.engines ?? {}).length} engines in ${data.executionMs}ms`);
      } else {
        setPipelineResult(null);
        toast.error(data.error ?? "Pipeline run failed");
      }
    } catch (err: any) {
      setPipelineResult(null);
      toast.error(err.message ?? "Network error");
    } finally {
      setPipelineRunning(false);
    }
  };

  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full bg-background">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Run Engines</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Every run below calls the real production path — <code className="text-primary">runForTenant()</code> against
            the testbed customer selected here. There is no sample-payload mode.
          </p>
        </div>
        {selectedCustomer && (
          <div className="text-xs text-muted-foreground shrink-0">
            Target: <span className="text-foreground font-medium">{selectedCustomer.name}</span>
            <span className="font-mono text-[10px]"> (#{selectedCustomer.id})</span>
          </div>
        )}
      </div>

      {/* Standalone orchestrated pipeline run — one POST fans out to the full engine manifest in dependency order. */}
      <div className="bg-card border border-border rounded-lg p-3.5 space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-sm font-semibold text-foreground">Orchestrated Pipeline</div>
            <p className="text-xs text-muted-foreground mt-1">
              Run the full engine manifest in dependency order against the selected testbed customer.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={handleRunPipeline}
            disabled={pipelineRunning}
            className="h-7 px-3 shrink-0 gap-1.5"
          >
            {pipelineRunning ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Workflow className="w-3.5 h-3.5" />
            )}
            Run
          </Button>
        </div>

        {pipelineResult && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-2.5">
            {Object.entries(pipelineResult.engines).map(([key, result]) => (
              <span
                key={key}
                className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                  result.ok
                    ? "bg-emerald-400/10 text-emerald-400 border-emerald-400/25"
                    : "bg-destructive/10 text-destructive border-destructive/25"
                }`}
              >
                {result.ok ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                {key}
              </span>
            ))}
            <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">
              {pipelineResult.executionMs}ms
            </span>
          </div>
        )}
      </div>

      {selectedCustomerId == null ? (
        <div className="border border-dashed border-border rounded-lg p-10 text-center text-sm text-muted-foreground">
          Select a testbed customer in the header above — the same one the Overrides tab injects against —
          to enable engine runs.
        </div>
      ) : loadingEngines ? (
        <div className="flex justify-center py-10">
          <Loader2 className="w-5 h-5 animate-spin text-primary" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {engines.map(engine => {
            const result = results[engine.key];
            const isRunning = runningKey === engine.key;
            const isError = result && "error" in result;
            return (
              <div
                key={engine.key}
                className="bg-card border border-border rounded-lg p-3.5 space-y-3"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-sm font-semibold text-foreground">{engine.label}</div>
                    <div className="text-[11px] text-muted-foreground font-mono mt-0.5">{engine.key}</div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleRunEngine(engine.key)}
                    disabled={isRunning}
                    className="h-7 px-3 shrink-0"
                  >
                    {isRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{engine.description}</p>

                {result && (
                  <div
                    className={`p-3 rounded-md border text-xs ${
                      isError
                        ? "bg-destructive/10 border-destructive/40 text-destructive"
                        : "bg-background border-border text-foreground/90"
                    }`}
                  >
                    {isError ? (
                      <div className="flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 shrink-0" /> {(result as { error: string }).error}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5 text-emerald-400 font-semibold text-[10px] uppercase tracking-wider">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Customer #{(result as EngineRunResult).customerId} Succeeded
                          </div>
                          <div className="flex gap-1 shrink-0">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-muted-foreground hover:text-foreground"
                              onClick={() => {
                                const data = (result as EngineRunResult).output;
                                navigator.clipboard.writeText(JSON.stringify(data, null, 2));
                                toast.success("Copied raw JSON to clipboard");
                              }}
                              title="Copy Raw JSON"
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-muted-foreground hover:text-foreground"
                              onClick={() => {
                                const data = (result as EngineRunResult).output as any;
                                openModal("engine-trace", { engineName: engine.label, data });
                              }}
                              title="View Evaluation Trace"
                            >
                              <FileText className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>

                        {/* Human Readable Premium Preview Card */}
                        <div className="bg-background border border-border rounded-md p-3 space-y-2.5">
                          <div className="flex items-center justify-between border-b border-border pb-1.5">
                            <span className="text-[11px] font-semibold text-foreground uppercase tracking-wide">
                              {((result as EngineRunResult).output as any)?.display?.title || engine.label}
                            </span>
                            {((result as EngineRunResult).output as any)?.display?.status && (
                              <Badge className={`rounded font-mono font-bold text-[9px] uppercase tracking-wider px-1.5 py-0.5 ${
                                getStatusBadgeStyle(((result as EngineRunResult).output as any)?.display?.status)
                              }`}>
                                {((result as EngineRunResult).output as any)?.display?.status}
                              </Badge>
                            )}
                          </div>
                          <div className="space-y-1 text-[11px]">
                            <div className="flex gap-1.5 items-start">
                              <span className="text-muted-foreground font-semibold tracking-wide select-none">IMPACT:</span>
                              <span className="text-foreground/90 leading-normal">{((result as EngineRunResult).output as any)?.display?.impact || "No active signals detected."}</span>
                            </div>
                            <div className="flex gap-1.5 items-start">
                              <span className="text-muted-foreground font-semibold tracking-wide select-none">ACTION:</span>
                              <span className="text-foreground/90 leading-normal">{((result as EngineRunResult).output as any)?.display?.recommendation || "Review baseline configurations."}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
