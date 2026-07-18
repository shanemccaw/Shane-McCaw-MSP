import { useState } from "react";
import { Check, Clock, Copy, Loader2, Table as TableIcon } from "lucide-react";
import type { SqlOutput } from "./SqlQueryCanvas";

function CopyButton({
  value,
  title = "Copy",
  className = "shrink-0 text-destructive/70 hover:text-destructive transition-colors",
}: {
  value: string;
  title?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        void navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className={className}
      title={title}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

// The bottom panel's Query Output tab — renders whatever the center canvas's
// SQL Query editor (SqlQueryCanvas) last executed. Output state lives in
// SimulatorStudioPage, same lifted pattern as the Log Stream's channel
// selection. The Table/JSON toggle mirrors the Log Stream toolbar's
// INFO/WARN/ERROR toggle styling.
export function SqlQueryOutput({ output }: { output: SqlOutput }) {
  const [view, setView] = useState<"table" | "json">("table");
  const { isExecuting, results, error } = output;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background font-mono text-[11px] text-foreground">
      {/* Toolbar: view toggle + run stats */}
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-border bg-card px-2 select-none">
        <div className="flex items-center gap-0.5">
          {(
            [
              { key: "table", label: "TABLE" },
              { key: "json", label: "JSON" },
            ] as const
          ).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setView(key)}
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold transition-colors ${
                view === key ? "bg-accent text-primary" : "text-muted-foreground/50 hover:text-muted-foreground"
              }`}
              title={key === "table" ? "Show results as a table" : "Show results as raw JSON"}
            >
              {label}
            </button>
          ))}
        </div>
        {results && (
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Clock className="h-3 w-3 text-emerald-400" />
            {results.executionMs}ms · {results.rowCount} rows
          </span>
        )}
      </div>

      {/* Results */}
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {isExecuting && (
          <div className="flex items-center justify-center gap-2 py-4 text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            <span>Executing query…</span>
          </div>
        )}

        {!isExecuting && error && (
          <div className="rounded border border-destructive/40 bg-destructive/10 p-2 text-[10px] text-destructive flex items-start justify-between gap-2">
            <div>
              <strong>Query error:</strong> {error}
            </div>
            <CopyButton value={error} title="Copy error" />
          </div>
        )}

        {!isExecuting && !error && results && results.rows.length === 0 && (
          <div className="py-2 text-center text-muted-foreground">Query executed successfully. 0 rows returned.</div>
        )}

        {!isExecuting && !error && results && results.rows.length > 0 && view === "json" && (
          <div className="relative">
            <CopyButton
              value={JSON.stringify(results.rows, null, 2)}
              title="Copy JSON"
              className="absolute top-1 right-1 text-muted-foreground hover:text-foreground transition-colors"
            />
            <pre className="whitespace-pre leading-[1.65] text-foreground/90">{JSON.stringify(results.rows, null, 2)}</pre>
          </div>
        )}

        {!isExecuting && !error && results && results.rows.length > 0 && view === "table" && (
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

        {!isExecuting && !error && !results && (
          <div className="flex items-center justify-center gap-2 py-2 text-muted-foreground">
            <TableIcon className="h-3.5 w-3.5 opacity-50" />
            <span>Run a query in the SQL Query tab to inspect testbed data.</span>
          </div>
        )}
      </div>
    </div>
  );
}
