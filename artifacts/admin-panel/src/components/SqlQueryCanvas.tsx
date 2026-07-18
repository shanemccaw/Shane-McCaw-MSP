import { useEffect, useMemo, useRef, useState } from "react";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { PostgreSQL, sql } from "@codemirror/lang-sql";
import { keymap, EditorView } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { Play, Clock } from "lucide-react";
import { toast } from "sonner";
import { sqlStatementGutter } from "@/lib/sql-statement-gutter";

// The center canvas's SQL Query editor — relocated from the right panel's SQL
// Console strip (formerly SqlSnapshotTab), now full-height. Same execute
// endpoint, same CodeMirror setup: schema-aware autocomplete fed by the live
// db-schema endpoint, plus a per-statement play-button gutter so stacked
// statements can be run individually. Results don't render inline here —
// output state lives in SimulatorStudioPage and streams to the bottom panel's
// Query Output tab (SqlQueryOutput).

export interface SqlQueryResults {
  rows: any[];
  rowCount: number;
  fields: string[];
  executionMs: number;
}

export interface SqlOutput {
  isExecuting: boolean;
  results: SqlQueryResults | null;
  error: string | null;
}

export const EMPTY_SQL_OUTPUT: SqlOutput = { isExecuting: false, results: null, error: null };

// One Dark's own #282c34 background clashes with the app's GitHub-dark canvas;
// keep its syntax palette but repaint the editor surfaces with app tokens.
const editorSurfaceTheme = EditorView.theme({
  "&": { backgroundColor: "#0D1117" },
  ".cm-gutters": { backgroundColor: "#0D1117", borderRight: "1px solid #21262D" },
  ".cm-activeLine": { backgroundColor: "#161B2280" },
  ".cm-activeLineGutter": { backgroundColor: "#161B2280" },
});

interface SqlQueryCanvasProps {
  output: SqlOutput;
  onOutputChange: (next: SqlOutput) => void;
}

export function SqlQueryCanvas({ output, onOutputChange }: SqlQueryCanvasProps) {
  const [query, setQuery] = useState("SELECT * FROM msps LIMIT 10;");
  const [hasSelection, setHasSelection] = useState(false);
  const [schemaMap, setSchemaMap] = useState<Record<string, { label: string; detail: string }[]> | null>(null);
  const cmRef = useRef<ReactCodeMirrorRef>(null);

  const executeSql = async (statementText: string) => {
    if (!statementText.trim()) return;
    onOutputChange({ isExecuting: true, results: null, error: null });
    try {
      const res = await fetch("/api/admin/engines/simulator/sql/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: statementText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Execution failed");
      onOutputChange({ isExecuting: false, results: data, error: null });
    } catch (err: any) {
      onOutputChange({ isExecuting: false, results: null, error: err.message });
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

  // Saved scripts clicked in the Explorer tree load into this editor; the
  // center canvas listens for the same event to switch to the SQL Query tab.
  useEffect(() => {
    const handleLoadScript = (e: CustomEvent) => {
      const script = e.detail;
      setQuery(script.query);
      toast.info(`Loaded script: ${script.name}`);
    };
    window.addEventListener("simulator-load-script", handleLoadScript as EventListener);
    return () => {
      window.removeEventListener("simulator-load-script", handleLoadScript as EventListener);
    };
  }, []);

  // "Execute" from the Explorer tree's context menu — same load as above, but
  // also runs it immediately without waiting for a Run click.
  useEffect(() => {
    const handleRunScript = (e: CustomEvent) => {
      const script = e.detail;
      setQuery(script.query);
      toast.info(`Running script: ${script.name}`);
      void executeSqlRef.current(script.query);
    };
    window.addEventListener("simulator-run-script", handleRunScript as EventListener);
    return () => {
      window.removeEventListener("simulator-run-script", handleRunScript as EventListener);
    };
  }, []);

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
      editorSurfaceTheme,
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
    <div className="flex h-full min-h-0 flex-col bg-background font-mono text-[11px] text-foreground">
      {/* Compact toolbar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-2 py-1 select-none">
        <button
          onClick={handleRunClick}
          disabled={output.isExecuting}
          className="flex items-center gap-1 rounded bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
          title="Run selection if text is selected, otherwise run everything (Ctrl/Cmd + Enter)"
        >
          <Play className={`h-3 w-3 ${output.isExecuting ? "animate-spin" : ""}`} />
          {output.isExecuting ? "Running…" : hasSelection ? "Run Selection" : "Run All"}
        </button>
        {output.results && (
          <span className="ml-1 flex items-center gap-1 text-[10px] text-muted-foreground">
            <Clock className="h-3 w-3 text-emerald-400" />
            {output.results.executionMs}ms · {output.results.rowCount} rows
          </span>
        )}
      </div>

      {/* Query editor — full canvas height; results go to the bottom panel */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <CodeMirror
          ref={cmRef}
          value={query}
          onChange={setQuery}
          onUpdate={(viewUpdate) => setHasSelection(!viewUpdate.state.selection.main.empty)}
          extensions={extensions}
          theme={oneDark}
          height="100%"
          className="h-full"
          style={{ fontSize: "11px" }}
          basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: true }}
        />
      </div>
    </div>
  );
}
