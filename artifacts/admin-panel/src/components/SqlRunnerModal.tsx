import React, { useState } from "react";
import Editor from "@monaco-editor/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Play, PanelLeftClose, PanelLeft, Database, Clock, Table as TableIcon } from "lucide-react";
import { LiveDbSchemaTree } from "./LiveDbSchemaTree";
import { useAuth } from "@/contexts/AuthContext";

interface SqlRunnerModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialQuery?: string;
}

export function SqlRunnerModal({ isOpen, onClose, initialQuery = "SELECT * FROM msps LIMIT 10;" }: SqlRunnerModalProps) {
  const { fetchWithAuth } = useAuth();
  const [query, setQuery] = useState(initialQuery);
  const [showSchemaTree, setShowSchemaTree] = useState(true);
  const [isExecuting, setIsExecuting] = useState(false);
  const [results, setResults] = useState<{ rows: any[]; rowCount: number; fields: string[]; executionMs: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleExecute = async () => {
    setIsExecuting(true);
    setError(null);
    try {
      const res = await fetchWithAuth("/api/simulator/sql/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Execution failed");
      setResults(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-7xl h-[85vh] bg-slate-950 border-slate-800 text-slate-100 p-0 flex flex-col overflow-hidden">
        {/* Modal Header */}
        <DialogHeader className="p-4 border-b border-slate-800 flex flex-row items-center justify-between space-y-0">
          <div className="flex items-center space-x-3">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 border-slate-700 bg-slate-900 text-slate-300 hover:text-white"
              onClick={() => setShowSchemaTree(!showSchemaTree)}
              title={showSchemaTree ? "Hide Schema Explorer" : "Show Schema Explorer"}
            >
              {showSchemaTree ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeft className="w-4 h-4" />}
            </Button>
            <DialogTitle className="text-sm font-bold flex items-center space-x-2">
              <Database className="w-4 h-4 text-indigo-400" />
              <span>SQL IDE & Live Schema Console</span>
            </DialogTitle>
          </div>

          <div className="flex items-center space-x-3">
            {results && (
              <span className="text-xs text-slate-400 flex items-center space-x-1 font-mono">
                <Clock className="w-3 h-3 text-emerald-400" />
                <span>{results.executionMs}ms</span>
                <span className="text-slate-600">|</span>
                <span>{results.rowCount} rows</span>
              </span>
            )}
            <Button
              onClick={handleExecute}
              disabled={isExecuting}
              className="bg-indigo-600 hover:bg-indigo-500 text-white h-8 text-xs font-semibold px-4"
            >
              <Play className={`w-3.5 h-3.5 mr-1.5 ${isExecuting ? "animate-spin" : ""}`} />
              {isExecuting ? "Executing..." : "Run Query"}
            </Button>
          </div>
        </DialogHeader>

        {/* Main Split Body */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Side Panel: Live DB Schema Tree */}
          {showSchemaTree && (
            <div className="w-72 shrink-0 h-full border-r border-slate-800">
              <LiveDbSchemaTree />
            </div>
          )}

          {/* Right Panel: Editor + Terminal Results */}
          <div className="flex-1 flex flex-col min-w-0 h-full">
            {/* Upper Editor Pane */}
            <div className="flex-1 min-h-[250px] border-b border-slate-800 bg-slate-950">
              <Editor
                height="100%"
                defaultLanguage="sql"
                theme="vs-dark"
                value={query}
                onChange={(v) => setQuery(v || "")}
                options={{
                  minimap: { enabled: false },
                  fontSize: 13,
                  lineNumbers: "on",
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  padding: { top: 12 },
                }}
              />
            </div>

            {/* Lower Results Table / Terminal Pane */}
            <div className="h-64 bg-slate-900/60 overflow-hidden flex flex-col font-mono text-xs">
              <div className="px-4 py-2 border-b border-slate-800 bg-slate-950/80 flex items-center justify-between text-slate-400">
                <span className="font-semibold uppercase tracking-wider text-[10px]">Results Grid</span>
              </div>

              <div className="flex-1 overflow-auto p-4">
                {error && (
                  <div className="p-3 bg-red-950/50 border border-red-800 text-red-300 rounded text-xs font-mono">
                    <strong>Query Error:</strong> {error}
                  </div>
                )}

                {!error && results && results.rows.length === 0 && (
                  <div className="text-slate-500 py-8 text-center">Query executed successfully. 0 rows returned.</div>
                )}

                {!error && results && results.rows.length > 0 && (
                  <div className="border border-slate-800 rounded overflow-hidden">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-900 border-b border-slate-800 text-slate-400">
                          {results.fields.map((f) => (
                            <th key={f} className="p-2 border-r border-slate-800 font-semibold truncate">
                              {f}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {results.rows.map((row, idx) => (
                          <tr key={idx} className="hover:bg-slate-800/40">
                            {results.fields.map((f) => (
                              <td key={f} className="p-2 border-r border-slate-800/50 text-slate-300 max-w-xs truncate">
                                {row[f] === null ? (
                                  <span className="text-slate-600 italic">null</span>
                                ) : typeof row[f] === "object" ? (
                                  JSON.stringify(row[f])
                                ) : (
                                  String(row[f])
                                )}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {!error && !results && (
                  <div className="text-slate-600 py-8 text-center flex flex-col items-center justify-center space-y-2">
                    <TableIcon className="w-8 h-8 text-slate-800" />
                    <span>Run a query above or click any column in the left schema tree to inspect fields.</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}