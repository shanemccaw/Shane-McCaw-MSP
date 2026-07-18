import { useState } from "react";
import { Play, PanelLeftClose, PanelLeft, Clock, Table as TableIcon } from "lucide-react";
import { LiveDbSchemaTree } from "./LiveDbSchemaTree";

// Inline sibling of SqlRunnerModal.tsx — same endpoint, same request/response
// shape, same results-table rendering, just laid out for the bottom panel's
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
    <div className="flex h-full bg-background font-mono text-[11px] text-foreground">
      {showSchemaTree && (
        <div className="h-full w-56 shrink-0 overflow-hidden border-r border-border">
          <LiveDbSchemaTree />
        </div>
      )}

      <div className="flex h-full min-w-0 flex-1 flex-col">
        {/* Compact toolbar */}
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-2 py-1 select-none">
          <button
            onClick={() => setShowSchemaTree(!showSchemaTree)}
            className="rounded border border-border bg-background p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title={showSchemaTree ? "Hide schema explorer" : "Show schema explorer"}
          >
            {showSchemaTree ? <PanelLeftClose className="h-3 w-3" /> : <PanelLeft className="h-3 w-3" />}
          </button>
          <button
            onClick={handleExecute}
            disabled={isExecuting}
            className="flex items-center gap-1 rounded bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
            title="Run query (Ctrl/Cmd + Enter)"
          >
            <Play className={`h-3 w-3 ${isExecuting ? "animate-spin" : ""}`} />
            {isExecuting ? "Running…" : "Run"}
          </button>
          {results && (
            <span className="ml-1 flex items-center gap-1 text-[10px] text-muted-foreground">
              <Clock className="h-3 w-3 text-emerald-400" />
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
          className="w-full shrink-0 resize-none border-b border-border bg-background px-2.5 py-1.5 text-[11px] text-foreground outline-none placeholder:text-muted-foreground/60 focus:bg-card/60"
          placeholder="SELECT …"
        />

        {/* Results */}
        <div className="flex-1 overflow-auto p-2">
          {error && (
            <div className="rounded border border-destructive/40 bg-destructive/10 p-2 text-[10px] text-destructive">
              <strong>Query error:</strong> {error}
            </div>
          )}

          {!error && results && results.rows.length === 0 && (
            <div className="py-2 text-center text-muted-foreground">Query executed successfully. 0 rows returned.</div>
          )}

          {!error && results && results.rows.length > 0 && (
            <div className="max-w-full overflow-x-auto rounded border border-border">
              <table className="w-full border-collapse text-left text-[10px]">
                <thead>
                  <tr className="border-b border-border bg-card text-muted-foreground">
                    {results.fields.map((f) => (
                      <th key={f} className="truncate border-r border-border p-1 font-semibold">
                        {f}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {results.rows.map((row, idx) => (
                    <tr key={idx} className="hover:bg-accent/40">
                      {results.fields.map((f) => {
                        const display = row[f] === null ? "null" : typeof row[f] === "object" ? JSON.stringify(row[f]) : String(row[f]);
                        return (
                          <td key={f} title={display} className="max-w-[160px] truncate border-r border-border/50 p-1 text-foreground/90">
                            {row[f] === null ? <span className="italic text-muted-foreground/60">null</span> : display}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!error && !results && (
            <div className="flex items-center justify-center gap-2 py-2 text-muted-foreground">
              <TableIcon className="h-3.5 w-3.5 opacity-50" />
              <span>Run a query above to inspect testbed data.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
