import React, { useState, useEffect, useRef } from "react";
import { AlertCircle, Play, Pause, RefreshCw, Layers, CheckCircle, XCircle, ShieldAlert, Database, HelpCircle, Terminal, FileText, Activity } from "lucide-react";

interface PccTest {
  id: string;
  name: string;
  taxonomy: string;
  description: string;
  isProdSafe: boolean;
  dependencies: string[];
}

interface PccRunResult {
  runId: string;
  testId: string;
  taxonomy: string;
  environment: string;
  status: "PASS" | "FAIL" | "SKIPPED";
  timestamp: string;
  durationMs: number;
  why?: string;
  comparison?: {
    expected: any;
    actual: any;
    diff?: any;
  };
  metadata?: Record<string, any>;
}

export function PccDashboard() {
  // Env & Config state
  const [environment, setEnvironment] = useState<"dev" | "test" | "prod">("test");
  const [catalog, setCatalog] = useState<PccTest[]>([]);
  const [selectedTestId, setSelectedTestId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"rawContext" | "baseline" | "delta" | "sql" | "logs">("logs");

  // Playback & Replay state
  const [replayMode, setReplayMode] = useState<"live" | "replay">("live");
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState("1x");
  const [currentDay, setCurrentDay] = useState(1);
  const [currentTick, setCurrentTick] = useState(0);

  // Live telemetry streams
  const [logs, setLogs] = useState<string[]>([]);
  const [results, setResults] = useState<PccRunResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [selectedResult, setSelectedResult] = useState<PccRunResult | null>(null);

  // Resizable / Collapsible Region States
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [bottomCollapsed, setBottomCollapsed] = useState(false);
  
  const [leftWidth, setLeftWidth] = useState(25); // percentage
  const [rightWidth, setRightWidth] = useState(30); // percentage
  const [bottomHeight, setBottomHeight] = useState(300); // pixels

  // SSE event source reference
  const eventSourceRef = useRef<EventSource | null>(null);
  const logsEndRef = useRef<HTMLDivElement | null>(null);

  // Load catalog and initial state
  useEffect(() => {
    fetchCatalog();
    fetchState();
    connectStream();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs]);

  // Connect to SSE stream
  const connectStream = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const host = window.location.origin;
    const es = new EventSource(`${host}/api/pcc/stream`);

    es.addEventListener("run_started", (e: any) => {
      const data = JSON.parse(e.data);
      addLog(`[SYSTEM] Starting full test suite run: ${data.runId} on target: ${data.environment}`);
      setIsRunning(true);
      setResults([]);
    });

    es.addEventListener("test_started", (e: any) => {
      const data = JSON.parse(e.data);
      addLog(`[RUNNING] Starting test ${data.testId} [${data.taxonomy}]`);
    });

    es.addEventListener("step_progress", (e: any) => {
      const data = JSON.parse(e.data);
      addLog(`  -> [STEP] ${data.stepName}: ${data.status}`);
    });

    es.addEventListener("test_finished", (e: any) => {
      const data = JSON.parse(e.data);
      const res = data.result as PccRunResult;
      setResults(prev => [...prev, res]);
      addLog(`[${res.status}] ${res.testId} finished in ${res.durationMs}ms${res.why ? ` (${res.why})` : ""}`);
    });

    es.addEventListener("run_finished", (e: any) => {
      const data = JSON.parse(e.data);
      addLog(`[SYSTEM] Run complete: ${data.summary.passed} passed, ${data.summary.failed} failed, ${data.summary.skipped} skipped.`);
      setIsRunning(false);
    });

    es.addEventListener("event_injected", (e: any) => {
      const data = JSON.parse(e.data);
      addLog(`[INJECTOR] Injected event: ${data.eventType} -> status: ${data.status}`);
    });

    es.addEventListener("ui_surface_validated", (e: any) => {
      const data = JSON.parse(e.data);
      addLog(`[UI VALIDATOR] Verified selector: ${data.selector} -> result: ${data.status}`);
    });

    es.addEventListener("replay_tick", (e: any) => {
      const data = JSON.parse(e.data);
      setCurrentDay(data.currentDay);
      addLog(`[REPLAY] Day ${data.currentDay} tick -> active users: ${data.metrics.activeUsersCount}`);
    });

    eventSourceRef.current = es;
  };

  const addLog = (msg: string) => {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  const fetchCatalog = async () => {
    try {
      const res = await fetch("/api/pcc/catalog");
      const data = await res.json();
      setCatalog(data.tests || []);
    } catch (err) {
      addLog("[ERROR] Failed to fetch catalog");
    }
  };

  const fetchState = async () => {
    try {
      const res = await fetch("/api/pcc/state");
      const data = await res.json();
      setEnvironment(data.environment);
      setReplayMode(data.replayMode);
      setPlaybackSpeed(data.playbackSpeed);
      setCurrentDay(data.progress.day);
      setCurrentTick(data.progress.tick);
    } catch (err) {
      addLog("[ERROR] Failed to fetch state");
    }
  };

  const changeEnvironment = async (env: "dev" | "test" | "prod") => {
    try {
      const res = await fetch("/api/pcc/environment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ environment: env })
      });
      const data = await res.json();
      if (data.success) {
        setEnvironment(env);
        addLog(`[SYSTEM] Gating environment switched to: ${env}`);
      }
    } catch (err) {
      addLog("[ERROR] Failed to change environment target");
    }
  };

  const triggerRun = async () => {
    if (isRunning) return;
    setIsRunning(true);
    setResults([]);
    try {
      await fetch("/api/pcc/run", { method: "POST" });
    } catch (err) {
      addLog("[ERROR] Failed to trigger run");
      setIsRunning(false);
    }
  };

  const triggerInjection = async (type: string, payload: any) => {
    try {
      await fetch("/api/pcc/inject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventType: type, payload })
      });
    } catch (err) {
      addLog("[ERROR] Failed to inject event");
    }
  };

  // Replay play / pause Simulation loops
  useEffect(() => {
    let interval: any = null;
    if (isPlaying) {
      interval = setInterval(() => {
        setCurrentDay(prev => {
          if (prev >= 90) {
            setIsPlaying(false);
            return 90;
          }
          const nextDay = prev + 1;
          fetch("/api/pcc/replay/config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ day: nextDay, tick: 0 })
          });
          // Broadcast local mock tick
          streamingServerSimulateTick(nextDay);
          return nextDay;
        });
      }, parseFloat(playbackSpeed) === 5 ? 200 : parseFloat(playbackSpeed) === 2 ? 500 : 1000);
    } else {
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [isPlaying, playbackSpeed]);

  const streamingServerSimulateTick = (day: number) => {
    addLog(`[REPLAY] Day ${day} simulation tick update completed.`);
  };

  const togglePlayback = () => {
    setIsPlaying(!isPlaying);
    fetch("/api/pcc/replay/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "replay" })
    });
    setReplayMode("replay");
  };

  const resetReplay = () => {
    setIsPlaying(false);
    setCurrentDay(1);
    fetch("/api/pcc/replay/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ day: 1, tick: 0 })
    });
    addLog("[REPLAY] Resetted timeline back to Day 1");
  };

  const filteredTests = catalog.filter(t => 
    t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.taxonomy.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex flex-col h-screen bg-[#0D1117] text-[#C9D1D9] font-sans overflow-hidden">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#21262D] bg-[#161B22] shrink-0">
        <div className="flex items-center gap-3">
          <Activity className="w-6 h-6 text-[#58A6FF] animate-pulse" />
          <h1 className="text-lg font-bold text-[#F0F6FC] tracking-wide">Platform Command Center (PCC)</h1>
        </div>

        <div className="flex items-center gap-4">
          {/* Target Gating selector */}
          <div className="flex items-center gap-2 bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-1.5">
            <span className="text-xs text-[#8B949E] uppercase font-semibold">Gating Targets:</span>
            <select 
              value={environment} 
              onChange={(e) => changeEnvironment(e.target.value as any)}
              className="bg-transparent text-sm font-semibold text-[#58A6FF] border-none outline-none cursor-pointer"
            >
              <option value="dev">Development</option>
              <option value="test">Testing Target</option>
              <option value="prod">Production Target</option>
            </select>
          </div>

          <button 
            onClick={triggerRun}
            disabled={isRunning}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${
              isRunning 
                ? "bg-[#21262D] text-[#8B949E] cursor-not-allowed" 
                : "bg-[#238636] hover:bg-[#2EA043] text-white shadow-lg shadow-emerald-950/20"
            }`}
          >
            <Play className="w-4 h-4" />
            {isRunning ? "Running Suite..." : "Run Full Suite"}
          </button>
        </div>
      </div>

      {/* Main Workspace split panel */}
      <div className="flex flex-1 overflow-hidden">
        
        {/* Left Panel: Catalog & Injections */}
        <div 
          style={{ width: leftCollapsed ? 0 : `${leftWidth}%` }}
          className={`flex flex-col border-r border-[#21262D] bg-[#161B22] transition-all duration-300 overflow-hidden relative`}
        >
          {!leftCollapsed && (
            <div className="flex flex-col h-full p-4 overflow-y-auto">
              <h2 className="text-xs uppercase font-bold tracking-wider text-[#8B949E] mb-3">PCC Test Catalog</h2>
              <input 
                type="text"
                placeholder="Filter tests by type or category..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#C9D1D9] outline-none placeholder-[#484F58] focus:border-[#58A6FF] mb-4"
              />

              <div className="flex-1 space-y-3">
                {filteredTests.map(test => {
                  const hasFailed = results.some(r => r.testId === test.id && r.status === "FAIL");
                  const hasPassed = results.some(r => r.testId === test.id && r.status === "PASS");
                  const hasSkipped = results.some(r => r.testId === test.id && r.status === "SKIPPED");
                  
                  return (
                    <div 
                      key={test.id}
                      onClick={() => {
                        setSelectedTestId(test.id);
                        const res = results.find(r => r.testId === test.id);
                        if (res) setSelectedResult(res);
                      }}
                      className={`p-3 rounded-lg border cursor-pointer transition-all ${
                        selectedTestId === test.id 
                          ? "bg-[#1F6FEB]/10 border-[#1F6FEB]" 
                          : "bg-[#0D1117] border-[#30363D] hover:border-[#8B949E]"
                      }`}
                    >
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-xs font-semibold px-2 py-0.5 rounded bg-[#21262D] text-[#8B949E]">{test.taxonomy}</span>
                        {hasPassed && <CheckCircle className="w-4 h-4 text-[#3FB950]" />}
                        {hasFailed && <XCircle className="w-4 h-4 text-[#F85149]" />}
                        {hasSkipped && <HelpCircle className="w-4 h-4 text-[#8B949E]" />}
                      </div>
                      <h4 className="text-sm font-semibold text-[#F0F6FC]">{test.name}</h4>
                      <p className="text-xs text-[#8B949E] mt-1 line-clamp-2">{test.description}</p>
                    </div>
                  );
                })}
              </div>

              {/* Event Injector section */}
              <div className="border-t border-[#30363D] pt-4 mt-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#8B949E] mb-3">Event Injector</h3>
                <div className="space-y-2">
                  <button 
                    onClick={() => triggerInjection("stripe.checkout.success", { customerId: "cus_mock_99", amountTotal: 14900 })}
                    className="w-full text-left px-3 py-2 text-xs font-semibold rounded bg-[#21262D] hover:bg-[#30363D] border border-[#30363D]"
                  >
                    ⚡ Stripe Checkout (Success)
                  </button>
                  <button 
                    onClick={() => triggerInjection("stripe.checkout.failure", { customerId: "cus_mock_99", failureReason: "expired_card" })}
                    className="w-full text-left px-3 py-2 text-xs font-semibold rounded bg-[#21262D] hover:bg-[#30363D] border border-[#30363D]"
                  >
                    ⚡ Stripe Checkout (Failure)
                  </button>
                  <button 
                    onClick={() => triggerInjection("consent.granted", { policyVersion: "v2026.1" })}
                    className="w-full text-left px-3 py-2 text-xs font-semibold rounded bg-[#21262D] hover:bg-[#30363D] border border-[#30363D]"
                  >
                    ⚡ Consent Granted
                  </button>
                </div>
              </div>
            </div>
          )}
          {/* Collapse button */}
          <button 
            onClick={() => setLeftCollapsed(!leftCollapsed)}
            className="absolute top-1/2 -right-3 -translate-y-1/2 w-6 h-12 bg-[#21262D] hover:bg-[#30363D] border border-[#30363D] rounded-r-lg flex items-center justify-center text-xs z-10"
          >
            {leftCollapsed ? ">" : "<"}
          </button>
        </div>

        {/* Center Panel: Live logs & Timeline Replay */}
        <div className="flex-1 flex flex-col bg-[#0D1117] overflow-hidden">
          
          {/* Timeline Replay Bar */}
          <div className="p-4 border-b border-[#21262D] bg-[#161B22] flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <button 
                onClick={togglePlayback}
                className="p-2 rounded-full bg-[#1F6FEB] hover:bg-[#388BFD] text-white"
              >
                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              </button>
              <button 
                onClick={resetReplay}
                className="p-2 rounded-full bg-[#21262D] hover:bg-[#30363D] text-[#C9D1D9]"
              >
                <RefreshCw className="w-4 h-4" />
              </button>

              <div className="flex flex-col">
                <span className="text-xs font-semibold text-[#8B949E] uppercase">90-Day Journey Timeline</span>
                <span className="text-sm font-bold text-[#F0F6FC]">Day {currentDay} / 90</span>
              </div>
            </div>

            {/* Slider Scrubber */}
            <input 
              type="range"
              min="1"
              max="90"
              value={currentDay}
              onChange={(e) => setCurrentDay(parseInt(e.target.value))}
              className="flex-1 mx-8 h-1.5 bg-[#30363D] rounded-lg appearance-none cursor-pointer accent-[#58A6FF]"
            />

            <div className="flex items-center gap-2">
              <span className="text-xs text-[#8B949E]">Speed:</span>
              <select 
                value={playbackSpeed}
                onChange={(e) => setPlaybackSpeed(e.target.value)}
                className="bg-[#21262D] border border-[#30363D] rounded px-2 py-1 text-xs text-[#C9D1D9]"
              >
                <option value="1x">1x Normal</option>
                <option value="2x">2x Fast</option>
                <option value="5x">5x Compress</option>
              </select>
            </div>
          </div>

          {/* Live streaming Console logs */}
          <div className="flex-1 p-4 font-mono text-xs overflow-y-auto space-y-1.5 scrollbar-thin">
            <div className="flex items-center gap-2 text-[#8B949E] border-b border-[#21262D] pb-2 mb-3">
              <Terminal className="w-4 h-4" />
              <span>LIVE ORCHESTRATOR TELEMETRY STREAM</span>
            </div>
            {logs.length === 0 ? (
              <p className="text-[#484F58] italic">Waiting for incoming telemetry broadcast events...</p>
            ) : (
              logs.map((log, i) => (
                <div key={i} className="leading-5 text-[#C9D1D9]">
                  {log}
                </div>
              ))
            )}
            <div ref={logsEndRef} />
          </div>

          {/* Bottom Drawer (Collapsible) */}
          <div 
            style={{ height: bottomCollapsed ? 0 : `${bottomHeight}px` }}
            className="border-t border-[#21262D] bg-[#161B22] transition-all duration-300 overflow-hidden relative flex flex-col"
          >
            {/* Tabs control bar */}
            <div className="flex items-center justify-between border-b border-[#30363D] bg-[#0D1117] px-4 py-2 shrink-0">
              <div className="flex gap-1">
                {(["logs", "rawContext", "baseline", "delta", "sql"] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-3 py-1 text-xs font-semibold rounded ${
                      activeTab === tab 
                        ? "bg-[#21262D] text-[#F0F6FC]" 
                        : "text-[#8B949E] hover:text-[#C9D1D9]"
                    }`}
                  >
                    {tab === "logs" && "Logs"}
                    {tab === "rawContext" && "Raw Context"}
                    {tab === "baseline" && "Baseline"}
                    {tab === "delta" && "Delta"}
                    {tab === "sql" && "SQL Inspector"}
                  </button>
                ))}
              </div>
              <button 
                onClick={() => setBottomCollapsed(!bottomCollapsed)}
                className="text-xs text-[#8B949E] hover:text-[#C9D1D9]"
              >
                [Toggle Drawer]
              </button>
            </div>

            {/* Tab contents */}
            {!bottomCollapsed && (
              <div className="flex-1 p-4 font-mono text-xs overflow-y-auto">
                {activeTab === "logs" && (
                  <pre className="text-[#8B949E]">
                    {JSON.stringify(results, null, 2)}
                  </pre>
                )}
                {activeTab === "rawContext" && (
                  <pre className="text-[#58A6FF]">
                    {JSON.stringify({
                      activeSessionId: "sess-908123-x",
                      timestamp: new Date().toISOString(),
                      environment,
                      gatingRules: "strict"
                    }, null, 2)}
                  </pre>
                )}
                {activeTab === "baseline" && (
                  <pre className="text-[#3FB950]">
                    {JSON.stringify({
                      portalSettings: {
                        theme: "dark",
                        mfaEnabled: true,
                        activeModules: ["billing", "compliance"]
                      }
                    }, null, 2)}
                  </pre>
                )}
                {activeTab === "delta" && (
                  <pre className="text-[#F85149]">
                    {JSON.stringify({
                      portalSettings: {
                        activeModules: {
                          "__op": "remove",
                          "value": "compliance"
                        }
                      }
                    }, null, 2)}
                  </pre>
                )}
                {activeTab === "sql" && (
                  <div className="space-y-2 text-[#C9D1D9]">
                    <div className="p-2 rounded bg-[#0D1117] border border-[#30363D]">
                      <span className="text-[#FF7B72] font-semibold">SELECT</span> * <span className="text-[#FF7B72] font-semibold">FROM</span> tenant_settings <span className="text-[#FF7B72] font-semibold">WHERE</span> tenant_id = <span className="text-[#A5D6FF]">'acme'</span>;
                      <p className="text-xs text-[#8B949E] mt-1">Returned 1 row in 4ms</p>
                    </div>
                    <div className="p-2 rounded bg-[#0D1117] border border-[#30363D]">
                      <span className="text-[#FF7B72] font-semibold">SELECT</span> * <span className="text-[#FF7B72] font-semibold">FROM</span> audit_logs <span className="text-[#FF7B72] font-semibold">ORDER BY</span> created_at <span className="text-[#FF7B72] font-semibold">DESC</span> <span className="text-[#FF7B72] font-semibold">LIMIT</span> 5;
                      <p className="text-xs text-[#8B949E] mt-1">Returned 5 rows in 12ms</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Panel: Engine Inspector */}
        <div 
          style={{ width: rightCollapsed ? 0 : `${rightWidth}%` }}
          className="flex flex-col border-l border-[#21262D] bg-[#161B22] transition-all duration-300 overflow-hidden relative"
        >
          {!rightCollapsed && (
            <div className="flex flex-col h-full p-4 overflow-y-auto">
              <h2 className="text-xs uppercase font-bold tracking-wider text-[#8B949E] mb-3">Engine Output Inspector</h2>
              
              {selectedResult ? (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-bold text-[#F0F6FC]">{selectedResult.testId}</h3>
                    <p className="text-xs text-[#8B949E]">Status: 
                      <span className={`ml-1 font-bold ${
                        selectedResult.status === "PASS" ? "text-[#3FB950]" : "text-[#F85149]"
                      }`}>
                        {selectedResult.status}
                      </span>
                    </p>
                  </div>

                  {selectedResult.why && (
                    <div className="p-3 rounded bg-[#F85149]/10 border border-[#F85149]/30 text-xs text-[#F85149]">
                      <strong>Failure Reason:</strong> {selectedResult.why}
                    </div>
                  )}

                  {selectedResult.comparison && (
                    <div className="space-y-3">
                      <h4 className="text-xs font-semibold text-[#8B949E]">Expected vs Actual Output</h4>
                      <div className="space-y-2">
                        <div>
                          <span className="text-xs text-[#8B949E]">Expected Schema:</span>
                          <pre className="p-2 rounded bg-[#0D1117] border border-[#30363D] text-[10px] overflow-x-auto text-[#8B949E]">
                            {JSON.stringify(selectedResult.comparison.expected, null, 2)}
                          </pre>
                        </div>
                        <div>
                          <span className="text-xs text-[#8B949E]">Actual Payload:</span>
                          <pre className="p-2 rounded bg-[#0D1117] border border-[#30363D] text-[10px] overflow-x-auto text-[#C9D1D9]">
                            {JSON.stringify(selectedResult.comparison.actual, null, 2)}
                          </pre>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center flex-1 text-center py-12">
                  <FileText className="w-12 h-12 text-[#484F58] mb-3" />
                  <p className="text-sm text-[#8B949E]">Select any test result from the list to inspect details.</p>
                </div>
              )}
            </div>
          )}
          {/* Collapse button */}
          <button 
            onClick={() => setRightCollapsed(!rightCollapsed)}
            className="absolute top-1/2 -left-3 -translate-y-1/2 w-6 h-12 bg-[#21262D] hover:bg-[#30363D] border border-[#30363D] rounded-l-lg flex items-center justify-center text-xs z-10"
          >
            {rightCollapsed ? "<" : ">"}
          </button>
        </div>

      </div>
    </div>
  );
}
export default PccDashboard;
