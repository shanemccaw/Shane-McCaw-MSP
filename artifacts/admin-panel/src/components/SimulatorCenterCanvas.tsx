import React, { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useModal } from "@/contexts/ModalContext";
import { 
  Play, 
  Trash2, 
  Save, 
  Terminal, 
  Database, 
  Lock, 
  Unlock, 
  AlertCircle, 
  CheckCircle,
  Loader2, 
  Clock, 
  ShieldAlert, 
  Building2,
  RefreshCw,
  Search
} from "lucide-react";
import CodeMirror from "@uiw/react-codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { SimulatorOverridesPanel } from "./SimulatorOverridesPanel";
import { SimulatorEnginesPanel } from "./SimulatorEnginesPanel";
import { LiveDbSchemaTree } from "./LiveDbSchemaTree";

interface Msp {
  id: number;
  name: string;
  slug: string;
  domain: string | null;
  status: "active" | "suspended" | "trial";
  isDirectBusiness: boolean;
  isTestbed: boolean;
}

export function SimulatorCenterCanvas(props?: {
  customerId?: string;
  simDate?: string;
  isReplaying?: boolean;
}) {
  const { fetchWithAuth } = useAuth();
  const { openModal } = useModal();

  const [activeTab, setActiveTab] = useState<"sql" | "testbeds" | "overrides" | "engines" | "schema">("sql");

  // SQL Editor state
  const [query, setQuery] = useState("SELECT * FROM msps;\n-- Try running any SQL command here!");
  const [currentScript, setCurrentScript] = useState<any>(null);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<any>(null);

  // Testbeds state
  const [msps, setMsps] = useState<Msp[]>([]);
  const [loadingTestbeds, setLoadingTestbeds] = useState(false);
  const [sessionLocks, setSessionLocks] = useState<Record<number, boolean>>({});

  useEffect(() => {
    // Listen for custom load-script events from SimulatorLeftTree
    const handleLoadScript = (e: CustomEvent) => {
      const script = e.detail;
      setQuery(script.query);
      setCurrentScript(script);
      setActiveTab("sql");
      toast.info(`Loaded script: ${script.name}`);
    };

    window.addEventListener("simulator-load-script", handleLoadScript as EventListener);
    return () => {
      window.removeEventListener("simulator-load-script", handleLoadScript as EventListener);
    };
  }, []);

  // Fetch MSP testbeds list
  const loadMsps = async () => {
    setLoadingTestbeds(true);
    try {
      const res = await fetchWithAuth("/api/admin/msps?limit=100");
      if (res.ok) {
        const data = await res.json();
        setMsps(data.msps || []);
      }
    } catch (err) {
      console.error("Failed to load testbeds", err);
      toast.error("Failed to reload MSP registry");
    } finally {
      setLoadingTestbeds(false);
    }
  };

  useEffect(() => {
    if (activeTab === "testbeds") {
      loadMsps();
    }
  }, [activeTab, fetchWithAuth]);

  // Run SQL Query
  const handleRunQuery = async () => {
    if (!query.trim()) {
      toast.error("SQL query cannot be empty");
      return;
    }
    setRunning(true);
    setResults(null);
    
    // Log executing to bottom drawer
    window.dispatchEvent(new CustomEvent("simulator-log", { 
      detail: { 
        type: "info", 
        message: `Executing SQL query: ${query.split("\n")[0]}...` 
      } 
    }));

    try {
      const res = await fetchWithAuth("/api/simulator/sql/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });

      const data = await res.json();
      const endTime = Date.now();

      if (res.ok) {
        setResults({
          success: true,
          rows: data.rows || [],
          fields: data.fields || (data.rows && data.rows.length > 0 ? Object.keys(data.rows[0]) : []),
          mutatedRows: data.mutatedRows,
          executionMs: data.executionMs || 0,
        });
        
        window.dispatchEvent(new CustomEvent("simulator-log", { 
          detail: { 
            type: "success", 
            message: `Query succeeded (${data.executionMs || 0}ms). Rows returned: ${data.rows?.length || 0}. Mutated: ${data.mutatedRows || 0}` 
          } 
        }));
      } else {
        setResults({
          success: false,
          error: data.error || "Query failed",
        });
        
        window.dispatchEvent(new CustomEvent("simulator-log", { 
          detail: { 
            type: "error", 
            message: `SQL Error: ${data.error || "Query failed"}` 
          } 
        }));
      }
    } catch (err: any) {
      setResults({
        success: false,
        error: err.message || "Network error",
      });
      
      window.dispatchEvent(new CustomEvent("simulator-log", { 
        detail: { 
          type: "error", 
          message: `Network error running query: ${err.message}` 
        } 
      }));
    } finally {
      setRunning(false);
    }
  };

  // Toggle Session Lock
  const handleToggleLock = async (mspId: number, isCurrentlyLocked: boolean) => {
    try {
      const res = await fetchWithAuth("/api/simulator/session-lock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          testbedMspId: mspId,
          lock: !isCurrentlyLocked
        }),
      });

      if (res.ok) {
        setSessionLocks(prev => ({ ...prev, [mspId]: !isCurrentlyLocked }));
        toast.success(!isCurrentlyLocked ? "Session locked" : "Session unlocked");
        loadMsps();
        
        window.dispatchEvent(new CustomEvent("simulator-log", { 
          detail: { 
            type: "info", 
            message: `MSP ${mspId} simulation lock state updated to: ${!isCurrentlyLocked}` 
          } 
        }));
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to toggle session lock");
      }
    } catch (err: any) {
      toast.error(err.message || "Network error updating lock status");
    }
  };

  // Toggle MSP status (suspend/reactivate)
  const handleToggleStatus = async (msp: Msp) => {
    const isSuspended = msp.status === "suspended";
    const endpoint = `/api/admin/msps/${msp.id}/${isSuspended ? 'reactivate' : 'suspend'}`;
    try {
      const res = await fetchWithAuth(endpoint, { method: "POST" });
      if (res.ok) {
        toast.success(isSuspended ? "MSP reactivated" : "MSP suspended");
        loadMsps();
        
        window.dispatchEvent(new CustomEvent("simulator-log", { 
          detail: { 
            type: "info", 
            message: `MSP ${msp.name} (${msp.id}) status set to: ${isSuspended ? 'active' : 'suspended'}` 
          } 
        }));
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to update MSP status");
      }
    } catch (err: any) {
      toast.error(err.message || "Error toggling status");
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-950 font-sans">
      {/* Navigation Tabs */}
      <div className="flex-shrink-0 flex items-center bg-slate-950 border-b border-slate-900 px-4 h-11 justify-between select-none">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setActiveTab("sql")}
            className={`px-3 py-1.5 rounded-md text-xs font-mono font-medium transition-all ${
              activeTab === "sql"
                ? "bg-slate-900 text-indigo-400 border border-slate-800"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            SQL Query Canvas
          </button>
          <button
            onClick={() => setActiveTab("testbeds")}
            className={`px-3 py-1.5 rounded-md text-xs font-mono font-medium transition-all ${
              activeTab === "testbeds"
                ? "bg-slate-900 text-indigo-400 border border-slate-800"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Testbeds Dashboard
          </button>
          <button
            onClick={() => setActiveTab("overrides")}
            className={`px-3 py-1.5 rounded-md text-xs font-mono font-medium transition-all ${
              activeTab === "overrides"
                ? "bg-slate-900 text-indigo-400 border border-slate-800"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Overrides Engine
          </button>
          <button
            onClick={() => setActiveTab("engines")}
            className={`px-3 py-1.5 rounded-md text-xs font-mono font-medium transition-all ${
              activeTab === "engines"
                ? "bg-slate-900 text-indigo-400 border border-slate-800"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Run Engines
          </button>
          <button
            onClick={() => setActiveTab("schema")}
            className={`px-3 py-1.5 rounded-md text-xs font-mono font-medium transition-all ${
              activeTab === "schema"
                ? "bg-slate-900 text-indigo-400 border border-slate-800"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Live DB Schema
          </button>
        </div>
      </div>

      {/* Workspace Area */}
      <div className="flex-1 flex flex-col min-h-0">
        
        {/* Tab 1: SQL Canvas */}
        {activeTab === "sql" && (
          <div className="flex-1 flex flex-col min-h-0">
            {/* Toolbar */}
            <div className="px-4 py-2 bg-slate-950/60 border-b border-slate-900 flex items-center justify-between gap-4 select-none">
              <div className="flex items-center gap-2 font-mono text-[10px] text-slate-500">
                <Database className="w-3.5 h-3.5" />
                <span>Target: local_testbed_db</span>
                {currentScript && (
                  <>
                    <span className="text-slate-700">|</span>
                    <span className="text-indigo-400">File: {currentScript.name}</span>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setQuery("");
                    setCurrentScript(null);
                    setResults(null);
                  }}
                  className="h-8 border-slate-800 hover:bg-slate-900 bg-transparent text-slate-400 hover:text-slate-100 text-xs px-2.5 font-mono"
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Clear
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (currentScript) {
                      openModal("edit-script", { script: { ...currentScript, query } });
                    } else {
                      openModal("new-script", { script: { query, category: "QA Asserts" } });
                    }
                  }}
                  className="h-8 border-slate-800 hover:bg-slate-900 bg-transparent text-slate-400 hover:text-slate-100 text-xs px-2.5 font-mono"
                >
                  <Save className="w-3.5 h-3.5 mr-1.5" /> Save Script
                </Button>
                <Button
                  size="sm"
                  onClick={handleRunQuery}
                  disabled={running}
                  className="h-8 bg-indigo-600 hover:bg-indigo-500 text-white text-xs px-3 font-mono shadow-md shadow-indigo-600/10"
                >
                  {running ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> Running...
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5 mr-1.5 fill-current" /> Run Query
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* CodeMirror Editor */}
            <div className="flex-1 min-h-[160px] border-b border-slate-900 overflow-y-auto bg-[#282c34]">
              <CodeMirror
                value={query}
                height="100%"
                theme={oneDark}
                onChange={(val) => {
                  setQuery(val);
                  if (currentScript && val !== currentScript.query) {
                    // Query changed, detach from saved script file indicator
                    setCurrentScript(null);
                  }
                }}
                className="text-[12px] leading-relaxed font-mono focus:outline-none"
                basicSetup={{
                  lineNumbers: true,
                  foldGutter: true,
                  highlightActiveLineGutter: true,
                  highlightActiveLine: true,
                  autocompletion: true,
                }}
              />
            </div>

            {/* Results Grid Container */}
            <div className="h-64 flex flex-col min-h-0 bg-slate-950 font-mono text-xs">
              <div className="px-4 py-2 border-b border-slate-900 flex items-center justify-between shrink-0 select-none bg-slate-950/80">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Query Output</span>
                {results && results.success && (
                  <span className="text-[10px] text-slate-400 flex items-center gap-1.5">
                    <Clock className="w-3 h-3 text-slate-500" /> {results.executionMs}ms
                  </span>
                )}
              </div>
              <div className="flex-1 overflow-auto p-4 min-h-0">
                {!results && !running && (
                  <div className="h-full flex flex-col items-center justify-center text-slate-600 italic">
                    <Terminal className="w-8 h-8 text-slate-800 mb-2" />
                    <span>Run a SQL query above to see outputs.</span>
                  </div>
                )}
                {running && (
                  <div className="h-full flex items-center justify-center text-slate-400 gap-2 font-semibold">
                    <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
                    <span>Executing database queries...</span>
                  </div>
                )}
                {results && !results.success && (
                  <div className="bg-rose-950/15 border border-rose-900/30 rounded-lg p-4 text-rose-400 flex gap-2.5 max-w-full">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="font-semibold text-xs mb-0.5">Database Error</h4>
                      <p className="text-[11px] leading-relaxed">{results.error}</p>
                    </div>
                  </div>
                )}
                {results && results.success && (
                  <div className="space-y-3 min-w-full">
                    {results.rows.length === 0 ? (
                      <div className="bg-emerald-950/15 border border-emerald-900/30 rounded-lg p-4 text-emerald-300 flex items-center gap-2">
                        <CheckCircle className="w-4 h-4" />
                        <span>Query completed. 0 rows returned. (Mutated rows: {results.mutatedRows ?? 0})</span>
                      </div>
                    ) : (
                      <div className="border border-slate-900 rounded-lg overflow-x-auto max-w-full">
                        <Table>
                          <TableHeader className="bg-slate-900/60 border-slate-900">
                            <TableRow className="border-slate-900 hover:bg-transparent">
                              {results.fields.map((field: string) => (
                                <TableHead key={field} className="text-[10px] text-slate-400 py-2.5 px-3 font-semibold font-mono uppercase tracking-wider select-none">
                                  {field}
                                </TableHead>
                              ))}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {results.rows.map((row: any, idx: number) => (
                              <TableRow key={idx} className="border-slate-900 hover:bg-slate-900/40">
                                {results.fields.map((field: string) => {
                                  const val = row[field];
                                  let displayVal = "";
                                  if (val === null) {
                                    displayVal = "NULL";
                                  } else if (typeof val === "object") {
                                    displayVal = JSON.stringify(val);
                                  } else {
                                    displayVal = String(val);
                                  }
                                  return (
                                    <TableCell 
                                      key={field} 
                                      className={`py-2 px-3 truncate max-w-[200px] border-slate-900 font-mono text-[11px] ${
                                        val === null ? 'text-slate-600 italic' : 'text-slate-300'
                                      }`}
                                      title={displayVal}
                                    >
                                      {displayVal}
                                    </TableCell>
                                  );
                                })}
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Testbeds Dashboard */}
        {activeTab === "testbeds" && (
          <div className="flex-1 p-6 overflow-y-auto space-y-6">
            <div className="flex items-center justify-between border-b border-slate-900 pb-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-200">Registered Platform MSP Tenants</h3>
                <p className="text-xs text-slate-500">Configure simulated status and locks for local development testing.</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={loadMsps}
                disabled={loadingTestbeds}
                className="h-8 border-slate-800 hover:bg-slate-900 bg-transparent text-slate-400 hover:text-slate-100 text-xs px-2.5"
              >
                <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loadingTestbeds ? 'animate-spin' : ''}`} /> Refresh
              </Button>
            </div>

            {loadingTestbeds && msps.length === 0 ? (
              <div className="flex justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
              </div>
            ) : msps.length === 0 ? (
              <div className="text-center py-12 text-slate-500 border border-dashed border-slate-800 rounded-xl">
                <Building2 className="w-12 h-12 text-slate-800 mx-auto mb-3" />
                <h4 className="font-semibold text-slate-400">No MSPs Registered</h4>
                <p className="text-xs max-w-sm mx-auto mt-1">Please populate the database or create active MSP organizations via command dashboards.</p>
              </div>
            ) : (
              <div className="border border-slate-900 rounded-xl overflow-hidden bg-slate-950">
                <Table>
                  <TableHeader className="bg-slate-900/50 border-slate-900 select-none">
                    <TableRow className="border-slate-900 hover:bg-transparent">
                      <TableHead className="text-xs font-semibold py-3">MSP Name</TableHead>
                      <TableHead className="text-xs font-semibold py-3">Slug</TableHead>
                      <TableHead className="text-xs font-semibold py-3 text-center">Status</TableHead>
                      <TableHead className="text-xs font-semibold py-3 text-center">Is Testbed</TableHead>
                      <TableHead className="text-xs font-semibold py-3 text-center">Demo Session Lock</TableHead>
                      <TableHead className="text-xs font-semibold py-3 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {msps.map((msp) => {
                      const isLocked = sessionLocks[msp.id] || false;
                      return (
                        <TableRow key={msp.id} className="border-slate-900 hover:bg-slate-900/20">
                          <TableCell className="font-medium py-3 text-slate-200">
                            <div className="flex flex-col">
                              <span>{msp.name}</span>
                              <span className="text-[10px] text-slate-600 font-mono">ID: {msp.id}</span>
                            </div>
                          </TableCell>
                          <TableCell className="py-3 text-slate-400 font-mono text-[11px]">{msp.slug}</TableCell>
                          <TableCell className="py-3 text-center">
                            <Badge 
                              className={`rounded-full px-2.5 py-0.5 border text-[10px] font-semibold capitalize font-mono ${
                                msp.status === "active" 
                                  ? "text-emerald-400 border-emerald-500/25 bg-emerald-500/10" 
                                  : msp.status === "suspended" 
                                  ? "text-rose-400 border-rose-500/25 bg-rose-500/10" 
                                  : "text-amber-400 border-amber-500/25 bg-amber-500/10"
                              }`}
                            >
                              {msp.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="py-3 text-center">
                            <Badge 
                              className={`rounded px-1.5 py-0.5 text-[9px] font-bold font-mono ${
                                msp.isTestbed 
                                  ? "text-indigo-400 border border-indigo-500/20 bg-indigo-500/10" 
                                  : "text-slate-600 border border-slate-800 bg-slate-900/50"
                              }`}
                            >
                              {msp.isTestbed ? "TRUE" : "FALSE"}
                            </Badge>
                          </TableCell>
                          <TableCell className="py-3 text-center">
                            <div className="flex items-center justify-center">
                              {msp.isTestbed ? (
                                <button
                                  onClick={() => handleToggleLock(msp.id, isLocked)}
                                  className={`p-1.5 rounded-lg border text-xs flex items-center gap-1.5 transition-all select-none font-mono text-[10px] ${
                                    isLocked 
                                      ? "text-amber-400 border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10" 
                                      : "text-slate-400 border-slate-800 bg-slate-900/35 hover:bg-slate-900/60"
                                  }`}
                                >
                                  {isLocked ? (
                                    <>
                                      <Lock className="w-3.5 h-3.5 text-amber-500 shrink-0" /> LOCKED
                                    </>
                                  ) : (
                                    <>
                                      <Unlock className="w-3.5 h-3.5 text-slate-500 shrink-0" /> UNLOCKED
                                    </>
                                  )}
                                </button>
                              ) : (
                                <span className="text-[10px] text-slate-600 italic font-mono">-</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="py-3 text-right">
                            <div className="flex justify-end gap-2">
                              {msp.isTestbed && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleToggleStatus(msp)}
                                  className={`h-7 border-slate-800 bg-transparent text-[11px] font-mono ${
                                    msp.status === "suspended"
                                      ? "text-emerald-400 hover:text-emerald-300 hover:bg-slate-900"
                                      : "text-rose-400 hover:text-rose-300 hover:bg-slate-900"
                                  }`}
                                >
                                  {msp.status === "suspended" ? "Reactivate" : "Suspend"}
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openModal("execute-scenario", { 
                                  event: {
                                    id: "FACTORY_RESET",
                                    name: "Factory Reset Testbed",
                                    description: "Wipes telemetry logs, clears suspensions, and restores baseline score definitions.",
                                    category: "crm"
                                  }
                                })}
                                className="h-7 border-slate-800 bg-transparent hover:bg-slate-900 text-slate-400 hover:text-slate-200 text-[11px] font-mono"
                              >
                                Reset
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>)}
        {/* Tab 3: Overrides Panel */}
        {activeTab === "overrides" && (
          <SimulatorOverridesPanel />
        )}
        {/* Tab 4: Run Engines Panel */}
        {activeTab === "engines" && (
          <SimulatorEnginesPanel />
        )}
        {/* Tab 5: Live DB Schema (relocated here from the standalone right panel, which is now the Customer Portal Mirror) */}
        {activeTab === "schema" && (
          <div className="flex-1 min-h-0 overflow-hidden">
            <LiveDbSchemaTree />
          </div>
        )}
      </div>
    </div>
  );
}
