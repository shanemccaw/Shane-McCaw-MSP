import React, { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Play, Pause, SkipForward, RotateCcw, Loader2 } from "lucide-react";

interface Testbed {
  id: number;
  name: string;
  domain?: string;
}

interface EngineDefSummary {
  key: string;
  label: string;
  description: string;
}

interface ReplayStep {
  timestamp: string;
  engines: Record<string, any>;
}

// Every score ring in this matrix is fed exclusively by real
// POST /api/admin/simulator/replay-all output — each step is a real
// runForTenant() call against the selected testbed customer. There is no
// synthetic/animated score data; only the on-screen playback speed is
// artificial (a setInterval walking through already-computed real steps).
function extractScore(output: any): number | null {
  if (!output || typeof output !== "object") return null;
  if ("error" in output) return null;
  const s = output.score;
  if (typeof s === "number") return s;
  if (s && typeof s === "object") {
    const firstNum = Object.values(s).find(v => typeof v === "number");
    if (typeof firstNum === "number") return firstNum;
  }
  return null;
}

function extractFiredSignals(output: any): string[] {
  if (!output || typeof output !== "object" || "error" in output) return [];
  if (Array.isArray(output.rawSignals)) return output.rawSignals;
  if (Array.isArray(output.firedSignals)) return output.firedSignals;
  return [];
}

function ScoreRing({ label, score, hasError }: { label: string; score: number | null; hasError: boolean }) {
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score));
  const circumference = 2 * Math.PI * 26;
  const offset = circumference - (pct / 100) * circumference;
  return (
    <div className="flex flex-col items-center gap-1.5 p-2">
      <div className="relative w-16 h-16">
        <svg viewBox="0 0 60 60" className="w-16 h-16 -rotate-90">
          <circle cx="30" cy="30" r="26" fill="none" stroke="#1e293b" strokeWidth="5" />
          <circle
            cx="30" cy="30" r="26" fill="none"
            stroke={hasError ? "#f43f5e" : score == null ? "#475569" : "#6366f1"}
            strokeWidth="5"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className="transition-all duration-500"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center text-xs font-mono font-semibold text-slate-200">
          {hasError ? "!" : score == null ? "-" : Math.round(score)}
        </div>
      </div>
      <div className="text-[10px] text-slate-400 text-center leading-tight">{label}</div>
    </div>
  );
}

export function SimulatorReplayCanvas() {
  const { fetchWithAuth } = useAuth();
  const [testbeds, setTestbeds] = useState<Testbed[]>([]);
  const [selectedTestbedId, setSelectedTestbedId] = useState<number | "">("");
  const [engines, setEngines] = useState<EngineDefSummary[]>([]);

  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 90);
    return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [stepDays, setStepDays] = useState(3);
  const [speedMs, setSpeedMs] = useState(600);

  const [loadingReplay, setLoadingReplay] = useState(false);
  const [steps, setSteps] = useState<ReplayStep[]>([]);
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [trace, setTrace] = useState<Array<{ step: number; timestamp: string; newSignals: string[] }>>([]);

  const playRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetchWithAuth("/api/admin/testbeds").then(r => r.json()).then(d => setTestbeds(d.testbeds ?? [])).catch(() => toast.error("Failed to load testbeds"));
    fetchWithAuth("/api/admin/engines").then(r => r.json()).then(d => setEngines(d.engines ?? [])).catch(() => toast.error("Failed to load engine registry"));
  }, [fetchWithAuth]);

  const runReplay = async () => {
    if (selectedTestbedId === "") {
      toast.error("Select a testbed customer first");
      return;
    }
    setLoadingReplay(true);
    setPlaying(false);
    if (playRef.current) clearInterval(playRef.current);
    setSteps([]);
    setTrace([]);
    setCurrentStepIdx(0);
    try {
      const res = await fetchWithAuth("/api/admin/simulator/replay-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          testbedCustomerId: Number(selectedTestbedId),
          startDate: new Date(startDate).toISOString(),
          endDate: new Date(endDate).toISOString(),
          stepDays: Number(stepDays),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Replay failed");
      setSteps(data.steps ?? []);
      toast.success(`Loaded ${data.steps?.length ?? 0} real compressed-clock steps across ${data.engineKeys?.length ?? 0} engines`);
    } catch (err: any) {
      toast.error(err.message ?? "Replay failed");
    } finally {
      setLoadingReplay(false);
    }
  };

  const advanceStep = useCallback(() => {
    setCurrentStepIdx(prev => {
      const next = prev + 1;
      if (next >= steps.length) {
        setPlaying(false);
        return prev;
      }
      const prevStep = steps[prev];
      const nextStep = steps[next];
      const prevFired = new Set<string>();
      if (prevStep) {
        for (const key of Object.keys(prevStep.engines)) {
          for (const s of extractFiredSignals(prevStep.engines[key])) prevFired.add(s);
        }
      }
      const newSignals: string[] = [];
      for (const key of Object.keys(nextStep.engines)) {
        for (const s of extractFiredSignals(nextStep.engines[key])) {
          if (!prevFired.has(s)) newSignals.push(`${key}: ${s}`);
        }
      }
      setTrace(t => [...t, { step: next, timestamp: nextStep.timestamp, newSignals }]);
      return next;
    });
  }, [steps]);

  useEffect(() => {
    if (playing && steps.length > 0) {
      playRef.current = setInterval(advanceStep, speedMs);
    }
    return () => {
      if (playRef.current) clearInterval(playRef.current);
    };
  }, [playing, speedMs, advanceStep, steps.length]);

  const currentStep = steps[currentStepIdx];
  const progressPct = steps.length > 1 ? (currentStepIdx / (steps.length - 1)) * 100 : 0;

  return (
    <div className="flex flex-col h-full bg-slate-950 overflow-hidden">
      {/* Controls */}
      <div className="shrink-0 border-b border-slate-900 p-4 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={selectedTestbedId}
            onChange={e => setSelectedTestbedId(e.target.value === "" ? "" : Number(e.target.value))}
            className="bg-slate-900 border border-slate-800 rounded-md px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
          >
            <option value="">-- Testbed Customer --</option>
            {testbeds.map(tb => (
              <option key={tb.id} value={tb.id}>{tb.name} {tb.domain ? `(${tb.domain})` : ""}</option>
            ))}
          </select>
          <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-36 h-8 bg-slate-900 border-slate-800 text-slate-200 text-xs [color-scheme:dark]" />
          <span className="text-slate-600 text-xs">to</span>
          <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-36 h-8 bg-slate-900 border-slate-800 text-slate-200 text-xs [color-scheme:dark]" />
          <Input type="number" min={1} value={stepDays} onChange={e => setStepDays(Number(e.target.value))} className="w-20 h-8 bg-slate-900 border-slate-800 text-slate-200 text-xs" title="Step days" />
          <span className="text-[10px] text-slate-500">days/step</span>
          <Button size="sm" onClick={runReplay} disabled={loadingReplay} className="h-8 bg-indigo-600 hover:bg-indigo-500 text-white text-xs">
            {loadingReplay ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
            Load Replay
          </Button>
        </div>

        {steps.length > 0 && (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setPlaying(p => !p)} className="h-7 px-2 border-slate-700 bg-slate-800 hover:bg-slate-700">
              {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            </Button>
            <Button size="sm" variant="outline" onClick={advanceStep} disabled={currentStepIdx >= steps.length - 1} className="h-7 px-2 border-slate-700 bg-slate-800 hover:bg-slate-700">
              <SkipForward className="w-3.5 h-3.5" />
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setCurrentStepIdx(0); setTrace([]); setPlaying(false); }} className="h-7 px-2 border-slate-700 bg-slate-800 hover:bg-slate-700">
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
            <div className="flex-1 flex items-center gap-2 ml-2">
              <div className="flex-1 h-1.5 bg-slate-900 rounded-full overflow-hidden">
                <div className="h-full bg-indigo-500 transition-all duration-300" style={{ width: `${progressPct}%` }} />
              </div>
              <span className="text-[10px] font-mono text-slate-500 shrink-0">
                Step {currentStepIdx + 1}/{steps.length} — {currentStep ? new Date(currentStep.timestamp).toLocaleDateString() : ""}
              </span>
            </div>
            <select value={speedMs} onChange={e => setSpeedMs(Number(e.target.value))} className="bg-slate-900 border border-slate-800 rounded-md px-2 py-1 text-[10px] text-slate-300">
              <option value={1200}>0.5x</option>
              <option value={600}>1x</option>
              <option value={250}>2x</option>
              <option value={100}>4x</option>
            </select>
          </div>
        )}
      </div>

      {/* Score Ring Matrix */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {steps.length === 0 ? (
          <div className="border border-dashed border-slate-800 rounded-xl p-10 text-center text-sm text-slate-500">
            Select a testbed customer and load a replay to see engine scores evolve across the compressed timeline.
          </div>
        ) : (
          <>
            <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-3">
              <div className="flex flex-wrap justify-center">
                {engines.map(engine => {
                  const output = currentStep?.engines[engine.key];
                  const hasError = !!(output && typeof output === "object" && "error" in output);
                  return (
                    <ScoreRing key={engine.key} label={engine.label.replace(" Engine", "")} score={extractScore(output)} hasError={hasError} />
                  );
                })}
              </div>
            </div>

            {/* Derivation Trace Stream */}
            <div>
              <h3 className="text-xs font-semibold text-slate-300 mb-2">Derivation Trace Stream</h3>
              <div className="border border-slate-900 rounded-xl bg-slate-950 max-h-64 overflow-y-auto divide-y divide-slate-900">
                {trace.length === 0 ? (
                  <div className="p-4 text-center text-xs text-slate-600">
                    Play the replay to watch newly-fired signals accumulate step by step.
                  </div>
                ) : (
                  [...trace].reverse().map(t => (
                    <div key={t.step} className="p-2.5 text-[11px] font-mono">
                      <div className="text-slate-500 mb-1">
                        Step {t.step + 1} — {new Date(t.timestamp).toLocaleDateString()}
                      </div>
                      {t.newSignals.length === 0 ? (
                        <div className="text-slate-700">No newly-fired signals this step</div>
                      ) : (
                        t.newSignals.map((s, i) => (
                          <div key={i} className="text-emerald-400">→ {s}</div>
                        ))
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
