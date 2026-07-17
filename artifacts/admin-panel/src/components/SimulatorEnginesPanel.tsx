import React, { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Play, Loader2, AlertCircle, CheckCircle2, Copy, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useModal } from "@/contexts/ModalContext";

function getStatusBadgeStyle(status: string): string {
  const s = status ? status.toUpperCase() : "";
  if (s.includes("CRITICAL") || s.includes("RISK") || s.includes("EXPANSION") || s.includes("BREACH") || s.includes("FAIL")) {
    return "bg-rose-950/40 text-rose-400 border border-rose-500/25";
  }
  if (s.includes("WARN") || s.includes("ATTENTION") || s.includes("ACCELERATING") || s.includes("ENGAGEMENT")) {
    return "bg-amber-950/40 text-amber-400 border border-amber-500/25";
  }
  if (s.includes("HEALTHY") || s.includes("SECURE") || s.includes("OPTIMIZED") || s.includes("COMPLIANT") || s.includes("STABLE")) {
    return "bg-emerald-950/40 text-emerald-400 border border-emerald-500/25";
  }
  return "bg-slate-900 text-slate-400 border border-slate-800";
}

interface Testbed {
  id: number;
  name: string;
  domain?: string;
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
  const [testbeds, setTestbeds] = useState<Testbed[]>([]);
  const [selectedTestbedId, setSelectedTestbedId] = useState<number | "">("");

  const [engines, setEngines] = useState<EngineDefSummary[]>([]);
  const [loadingEngines, setLoadingEngines] = useState(false);

  const [runningKey, setRunningKey] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, EngineRunResult | { error: string }>>({});

  useEffect(() => {
    fetchWithAuth("/api/admin/testbeds")
      .then(r => r.json())
      .then(d => setTestbeds(d.testbeds ?? []))
      .catch(() => toast.error("Failed to load testbeds"));

    setLoadingEngines(true);
    fetchWithAuth("/api/admin/engines")
      .then(r => r.json())
      .then(d => setEngines(d.engines ?? []))
      .catch(() => toast.error("Failed to load engine registry"))
      .finally(() => setLoadingEngines(false));
  }, [fetchWithAuth]);

  const handleRunEngine = async (key: string) => {
    if (selectedTestbedId === "") {
      toast.error("Select a testbed customer first");
      return;
    }
    setRunningKey(key);
    try {
      const res = await fetchWithAuth(`/api/admin/engines/${key}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId: Number(selectedTestbedId), debug: true }),
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

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-200">Run Engines</h2>
          <p className="text-xs text-slate-500 mt-1">
            Every run below calls the real production path — <code className="text-indigo-400">runForTenant()</code> against
            the testbed customer selected here. There is no sample-payload mode.
          </p>
        </div>
        <div className="w-72">
          <select
            value={selectedTestbedId}
            onChange={e => setSelectedTestbedId(e.target.value === "" ? "" : Number(e.target.value))}
            className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
          >
            <option value="">-- Select Testbed Customer --</option>
            {testbeds.map(tb => (
              <option key={tb.id} value={tb.id}>{tb.name} {tb.domain ? `(${tb.domain})` : ""}</option>
            ))}
          </select>
        </div>
      </div>

      {selectedTestbedId === "" ? (
        <div className="border border-dashed border-slate-800 rounded-xl p-10 text-center text-sm text-slate-500">
          Select a testbed customer above — the same one you inject overrides against in the Overrides tab —
          to enable engine runs.
        </div>
      ) : loadingEngines ? (
        <div className="flex justify-center py-10">
          <Loader2 className="w-5 h-5 animate-spin text-indigo-500" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {engines.map(engine => {
            const result = results[engine.key];
            const isRunning = runningKey === engine.key;
            const isError = result && "error" in result;
            return (
              <div
                key={engine.key}
                className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 space-y-3"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-sm font-semibold text-slate-200">{engine.label}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">{engine.key}</div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleRunEngine(engine.key)}
                    disabled={isRunning}
                    className="h-8 px-3 border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 shrink-0"
                  >
                    {isRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                  </Button>
                </div>
                <p className="text-xs text-slate-500">{engine.description}</p>

                {result && (
                  <div
                    className={`p-3 rounded border text-xs ${
                      isError
                        ? "bg-rose-950/20 border-rose-900/50 text-rose-300"
                        : "bg-[#0b101c] border-slate-800 text-slate-300"
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
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                            Customer #{(result as EngineRunResult).customerId} Succeeded
                          </div>
                          <div className="flex gap-1 shrink-0">
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="h-6 w-6 hover:bg-slate-800 hover:text-slate-100 text-slate-400" 
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
                              className="h-6 w-6 hover:bg-slate-800 hover:text-slate-100 text-slate-400" 
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
                        <div className="bg-[#050810] border border-slate-800/80 rounded-lg p-3 space-y-2.5">
                          <div className="flex items-center justify-between border-b border-slate-900 pb-1.5">
                            <span className="text-[11px] font-bold text-slate-200 uppercase tracking-wide">
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
                              <span className="text-slate-500 font-bold tracking-wide select-none">IMPACT:</span>
                              <span className="text-slate-300 leading-normal">{((result as EngineRunResult).output as any)?.display?.impact || "No active signals detected."}</span>
                            </div>
                            <div className="flex gap-1.5 items-start">
                              <span className="text-slate-500 font-bold tracking-wide select-none">ACTION:</span>
                              <span className="text-slate-300 leading-normal">{((result as EngineRunResult).output as any)?.display?.recommendation || "Review baseline configurations."}</span>
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
