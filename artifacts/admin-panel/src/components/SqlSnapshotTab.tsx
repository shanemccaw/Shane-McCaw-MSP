import { useEffect, useMemo, useRef, useState } from "react";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { PostgreSQL, sql } from "@codemirror/lang-sql";
import { keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { Play, Clock, Table as TableIcon } from "lucide-react";
import { sqlStatementGutter } from "@/lib/sql-statement-gutter";

// Inline sibling of SqlRunnerModal.tsx — same execute endpoint, same
// request/response shape, same results-table rendering, laid out for the
// right panel's compact strip. The editor is CodeMirror (Monaco is too heavy
// for this panel) with schema-aware autocomplete fed by the live db-schema
// endpoint, plus a per-statement play-button gutter so stacked statements can
// be run individually. The schema browser is the sibling DB Schema tab in the
// same panel, so there's no embedded schema tree here.
export function SqlSnapshotTab() {
  const [query, setQuery] = useState("SELECT * FROM msps LIMIT 10;");
  const [isExecuting, setIsExecuting] = useState(false);
  const [results, setResults] = useState<{ rows: any[]; rowCount: number; fields: string[]; executionMs: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasSelection, setHasSelection] = useState(false);
  const [schemaMap, setSchemaMap] = useState<Record<string, { label: string; detail: string }[]> | null>(null);
  const cmRef = useRef<ReactCodeMirrorRef>(null);

  const executeSql = async (statementText: string) => {
    if (!statementText.trim()) return;
    setIsExecuting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/engines/simulator/sql/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: statementText }),
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
  const executeSqlRef = useRef(executeSql);
  executeSqlRef.current = executeSql;

  // Runs the selected text if there is a selection, otherwise the full editor
  // contents — the per-statement gutter buttons cover the finer-grained case.
  const handleRunClick = () => {
    const view = cmRef.current?.view;
    if (view) {
      const { from, to } = view.state.selection.main;
      void executeSql(from === to ? view.state.doc.toString() : view.state.sliceDoc(from, to));
    } else {
      void executeSql(query);
    }
  };
  const handleRunClickRef = useRef(handleRunClick);
  handleRunClickRef.current = handleRunClick;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/engines/simulator/db-schema");
        const data = await res.json();
        if (!res.ok || cancelled) return;
        const map: Record<string, { label: string; detail: string }[]> = {};
        for (const tbl of data.tables || []) {
          map[tbl.name] = (tbl.columns || []).map((col: { name: string; dataType: string }) => ({
            label: col.name,
            detail: col.dataType,
          }));
        }
        setSchemaMap(map);
      } catch {
        // Autocomplete degrades to keywords-only if the schema fetch fails.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const extensions = useMemo(
    () => [
      sql({ dialect: PostgreSQL, schema: schemaMap ?? {}, upperCaseKeywords: true }),
      sqlStatementGutter((statementText) => void executeSqlRef.current(statementText)),
      Prec.highest(
        keymap.of([
          {
            key: "Mod-Enter",
            run: () => {
              handleRunClickRef.current();
              return true;
            },
          },
        ]),
      ),
    ],
    [schemaMap],
  );

  return (
    <div className="flex h-full bg-background font-mono text-[11px] text-foreground">
      <div className="flex h-full min-w-0 flex-1 flex-col">
        {/* Compact toolbar */}
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-2 py-1 select-none">
          <button
            onClick={handleRunClick}
            disabled={isExecuting}
            className="flex items-center gap-1 rounded bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
            title="Run selection if text is selected, otherwise run everything (Ctrl/Cmd + Enter)"
          >
            <Play className={`h-3 w-3 ${isExecuting ? "animate-spin" : ""}`} />
            {isExecuting ? "Running…" : hasSelection ? "Run Selection" : "Run All"}
          </button>
          {results && (
            <span className="ml-1 flex items-center gap-1 text-[10px] text-muted-foreground">
              <Clock className="h-3 w-3 text-emerald-400" />
              {results.executionMs}ms · {results.rowCount} rows
            </span>
          )}
        </div>

        {/* Query editor */}
        <div className="shrink-0 border-b border-border">
          <CodeMirror
            ref={cmRef}
            value={query}
            onChange={setQuery}
            onUpdate={(viewUpdate) => setHasSelection(!viewUpdate.state.selection.main.empty)}
            extensions={extensions}
            theme={oneDark}
            height="110px"
            style={{ fontSize: "11px" }}
            basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: true }}
          />
        </div>

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
