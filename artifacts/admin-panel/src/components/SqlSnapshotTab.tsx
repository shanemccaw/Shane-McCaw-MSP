import React, { useState } from "react";
import { Play, PanelLeftClose, PanelLeft, Clock, Table as TableIcon } from "lucide-react";
import { LiveDbSchemaTree } from "./LiveDbSchemaTree";

// Inline sibling of SqlRunnerModal.tsx — same endpoint, same request/response
// shape, same results-table rendering, just laid out for the footer drawer's
// compact strip instead of a full-height modal dialog. The Monaco editor from
// the modal doesn't fit this panel's vertical space, so the query input here is
// a plain compact textarea; the execute call and result handling are unchanged.
export function SqlSnapshotTab() {
  const [query, setQuery] = useState("SELECT * FROM msps LIMIT 10;");
  const [showSchemaTree, setShowSchemaTree] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [results, setResults] = useState<{ rows: any[]; rowCount: number; fields: string[]; executionMs: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleExecute = async () => {
    setIsExecuting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/engines/simulator/sql/execute", {
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void handleExecute();
    }
  };

  return (
    <div className="h-full flex font-mono text-[11px] text-purple-300">
      {showSchemaTree && (
        <div className="w-56 shrink-0 h-full border-r border-slate-800/80 overflow-hidden">
          <LiveDbSchemaTree />
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0 h-full">
        {/* Compact toolbar */}
        <div className="flex-shrink-0 flex items-center gap-2 px-2 py-1 border-b border-slate-900/80">
          <button
            onClick={() => setShowSchemaTree(!showSchemaTree)}
            className="p-1 rounded bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-100 transition-colors"
            title={showSchemaTree ? "Hide Schema Explorer" : "Show Schema Explorer"}
          >
            {showSchemaTree ? <PanelLeftClose className="w-3 h-3" /> : <PanelLeft className="w-3 h-3" />}
          </button>
          <button
            onClick={handleExecute}
            disabled={isExecuting}
            className="flex items-center gap-1 px-2 py-0.5 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white text-[10px] font-bold uppercase tracking-wide"
            title="Run Query (Ctrl/Cmd + Enter)"
          >
            <Play className={`w-3 h-3 ${isExecuting ? "animate-spin" : ""}`} />
            {isExecuting ? "Running..." : "Run"}
          </button>
          {results && (
            <span className="flex items-center gap-1 text-[10px] text-slate-500 ml-1">
              <Clock className="w-3 h-3 text-emerald-400" />
              {results.executionMs}ms · {results.rowCount} rows
            </span>
          )}
        </div>

        {/* Compact query input */}
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          rows={2}
          className="flex-shrink-0 w-full resize-none bg-slate-950 border-b border-slate-800/80 text-purple-200 text-[11px] px-2.5 py-1.5 outline-none focus:bg-slate-900/40"
          placeholder="SELECT ..."
        />

        {/* Results */}
        <div className="flex-1 overflow-auto p-2">
          {error && (
            <div className="p-2 bg-red-950/50 border border-red-800 text-red-300 rounded text-[10px]">
              <strong>Query Error:</strong> {error}
            </div>
          )}

          {!error && results && results.rows.length === 0 && (
            <div className="text-slate-500 text-center py-2">Query executed successfully. 0 rows returned.</div>
          )}

          {!error && results && results.rows.length > 0 && (
            <div className="border border-slate-800 rounded overflow-hidden">
              <table className="w-full text-left border-collapse text-[10px]">
                <thead>
                  <tr className="bg-slate-900 border-b border-slate-800 text-slate-400">
                    {results.fields.map((f) => (
                      <th key={f} className="p-1 border-r border-slate-800 font-semibold truncate">{f}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {results.rows.map((row, idx) => (
                    <tr key={idx} className="hover:bg-slate-800/40">
                      {results.fields.map((f) => (
                        <td key={f} className="p-1 border-r border-slate-800/50 text-slate-300 max-w-[160px] truncate">
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
            <div className="text-slate-600 text-center flex items-center justify-center gap-2 py-2">
              <TableIcon className="w-3.5 h-3.5 text-slate-800" />
              <span>Run a query above to inspect testbed data.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
