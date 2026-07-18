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
import { EditorView } from "@codemirror/view";

// One Dark's own #282c34 background clashes with the app's GitHub-dark canvas;
// keep its syntax palette but repaint the editor surfaces with app tokens.
const editorSurfaceTheme = EditorView.theme({
  "&": { backgroundColor: "#0D1117" },
  ".cm-gutters": { backgroundColor: "#0D1117", borderRight: "1px solid #21262D" },
  ".cm-activeLine": { backgroundColor: "#161B2280" },
  ".cm-activeLineGutter": { backgroundColor: "#161B2280" },
});
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

  const TABS: Array<{ key: typeof activeTab; label: string }> = [
    { key: "sql", label: "SQL Query" },
    { key: "testbeds", label: "Testbeds" },
    { key: "overrides", label: "Overrides" },
    { key: "engines", label: "Run Engines" },
    { key: "schema", label: "DB Schema" },
  ];

  return (
    <div className="flex-1 flex flex-col min-h-0 h-full bg-background font-sans">
      {/* Editor-style tab strip */}
      <div className="flex-shrink-0 flex items-end bg-card border-b border-border select-none">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`relative h-9 px-3.5 text-xs border-r border-border transition-colors ${
              activeTab === key
                ? "bg-background text-foreground before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Workspace Area */}
      <div className="flex-1 flex flex-col min-h-0">
        
        {/* Tab 1: SQL Canvas */}
        {activeTab === "sql" && (
          <div className="flex-1 flex flex-col min-h-0">
            {/* Toolbar */}
            <div className="px-3 py-1.5 bg-background border-b border-border flex items-center justify-between gap-4 select-none">
              <div className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
                <Database className="w-3.5 h-3.5" />
                <span>Target: local_testbed_db</span>
                {currentScript && (
                  <>
                    <span className="text-muted-foreground/50">|</span>
                    <span className="text-[#58A6FF]">File: {currentScript.name}</span>
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
                  className="h-7 text-xs px-2.5"
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
                  className="h-7 text-xs px-2.5"
                >
                  <Save className="w-3.5 h-3.5 mr-1.5" /> Save Script
                </Button>
                <Button
                  size="sm"
                  onClick={handleRunQuery}
                  disabled={running}
                  className="h-7 text-xs px-3"
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
            <div className="flex-1 min-h-[160px] border-b border-border overflow-y-auto bg-background">
              <CodeMirror
                value={query}
                height="100%"
                theme={oneDark}
                extensions={[editorSurfaceTheme]}
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
            <div className="h-64 flex flex-col min-h-0 bg-background font-mono text-xs">
              <div className="px-3 py-1.5 border-b border-border flex items-center justify-between shrink-0 select-none bg-card">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Query Output</span>
                {results && results.success && (
                  <span className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                    <Clock className="w-3 h-3" /> {results.executionMs}ms
                  </span>
                )}
              </div>
              <div className="flex-1 overflow-auto p-3 min-h-0">
                {!results && !running && (
                  <div className="h-full flex flex-col items-center justify-center text-muted-foreground/70 italic">
                    <Terminal className="w-8 h-8 opacity-40 mb-2" />
                    <span>Run a SQL query above to see outputs.</span>
                  </div>
                )}
                {running && (
                  <div className="h-full flex items-center justify-center text-muted-foreground gap-2 font-semibold">
                    <Loader2 className="w-4 h-4 animate-spin text-primary" />
                    <span>Executing database queries...</span>
                  </div>
                )}
                {results && !results.success && (
                  <div className="bg-destructive/10 border border-destructive/40 rounded-md p-3 text-destructive flex gap-2.5 max-w-full">
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
                      <div className="bg-emerald-400/10 border border-emerald-400/30 rounded-md p-3 text-emerald-400 flex items-center gap-2">
                        <CheckCircle className="w-4 h-4" />
                        <span>Query completed. 0 rows returned. (Mutated rows: {results.mutatedRows ?? 0})</span>
                      </div>
                    ) : (
                      <div className="border border-border rounded-md overflow-x-auto max-w-full">
                        <Table>
                          <TableHeader className="bg-card">
                            <TableRow className="hover:bg-transparent">
                              {results.fields.map((field: string) => (
                                <TableHead key={field} className="text-[10px] text-muted-foreground py-2 px-3 font-semibold font-mono uppercase tracking-wider select-none">
                                  {field}
                                </TableHead>
                              ))}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {results.rows.map((row: any, idx: number) => (
                              <TableRow key={idx} className="hover:bg-accent/40">
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
                                      className={`py-1.5 px-3 truncate max-w-[200px] font-mono text-[11px] ${
                                        val === null ? 'text-muted-foreground/60 italic' : 'text-foreground/90'
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
          <div className="flex-1 p-4 overflow-y-auto space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Registered Platform MSP Tenants</h3>
                <p className="text-xs text-muted-foreground">Configure simulated status and locks for local development testing.</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={loadMsps}
                disabled={loadingTestbeds}
                className="h-7 text-xs px-2.5"
              >
                <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loadingTestbeds ? 'animate-spin' : ''}`} /> Refresh
              </Button>
            </div>

            {loadingTestbeds && msps.length === 0 ? (
              <div className="flex justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : msps.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground border border-dashed border-border rounded-lg">
                <Building2 className="w-12 h-12 opacity-30 mx-auto mb-3" />
                <h4 className="font-semibold text-foreground/80">No MSPs Registered</h4>
                <p className="text-xs max-w-sm mx-auto mt-1">Please populate the database or create active MSP organizations via command dashboards.</p>
              </div>
            ) : (
              <div className="border border-border rounded-lg overflow-hidden bg-background">
                <Table>
                  <TableHeader className="bg-card select-none">
                    <TableRow className="hover:bg-transparent">
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
                        <TableRow key={msp.id} className="hover:bg-accent/30">
                          <TableCell className="font-medium py-2.5 text-foreground">
                            <div className="flex flex-col">
                              <span>{msp.name}</span>
                              <span className="text-[10px] text-muted-foreground/70 font-mono">ID: {msp.id}</span>
                            </div>
                          </TableCell>
                          <TableCell className="py-2.5 text-muted-foreground font-mono text-[11px]">{msp.slug}</TableCell>
                          <TableCell className="py-2.5 text-center">
                            <Badge
                              className={`rounded-full px-2.5 py-0.5 border text-[10px] font-semibold capitalize font-mono ${
                                msp.status === "active"
                                  ? "text-emerald-400 border-emerald-400/25 bg-emerald-400/10"
                                  : msp.status === "suspended"
                                  ? "text-destructive border-destructive/25 bg-destructive/10"
                                  : "text-amber-400 border-amber-400/25 bg-amber-400/10"
                              }`}
                            >
                              {msp.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="py-2.5 text-center">
                            <Badge
                              className={`rounded px-1.5 py-0.5 text-[9px] font-bold font-mono ${
                                msp.isTestbed
                                  ? "text-[#58A6FF] border border-primary/25 bg-primary/10"
                                  : "text-muted-foreground/70 border border-border bg-card"
                              }`}
                            >
                              {msp.isTestbed ? "TRUE" : "FALSE"}
                            </Badge>
                          </TableCell>
                          <TableCell className="py-2.5 text-center">
                            <div className="flex items-center justify-center">
                              {msp.isTestbed ? (
                                <button
                                  onClick={() => handleToggleLock(msp.id, isLocked)}
                                  className={`p-1.5 rounded-md border text-xs flex items-center gap-1.5 transition-all select-none font-mono text-[10px] ${
                                    isLocked
                                      ? "text-amber-400 border-amber-400/30 bg-amber-400/5 hover:bg-amber-400/10"
                                      : "text-muted-foreground border-border bg-card hover:bg-accent"
                                  }`}
                                >
                                  {isLocked ? (
                                    <>
                                      <Lock className="w-3.5 h-3.5 shrink-0" /> LOCKED
                                    </>
                                  ) : (
                                    <>
                                      <Unlock className="w-3.5 h-3.5 shrink-0" /> UNLOCKED
                                    </>
                                  )}
                                </button>
                              ) : (
                                <span className="text-[10px] text-muted-foreground/60 italic font-mono">-</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="py-2.5 text-right">
                            <div className="flex justify-end gap-2">
                              {msp.isTestbed && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleToggleStatus(msp)}
                                  className={`h-7 text-[11px] font-mono ${
                                    msp.status === "suspended"
                                      ? "text-emerald-400 hover:text-emerald-300"
                                      : "text-destructive hover:text-destructive/80"
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
                                className="h-7 text-[11px] font-mono"
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
