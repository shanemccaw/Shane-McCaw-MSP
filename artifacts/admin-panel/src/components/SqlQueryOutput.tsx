import { useState } from "react";
import { Check, ChevronDown, ChevronRight, Clock, Copy, Loader2, Table as TableIcon, X } from "lucide-react";
import type { SqlOutput, SqlStatementResult } from "./SqlQueryCanvas";

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
      onClick={(e) => {
        e.stopPropagation();
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

// The row grid for a single statement's result set, honoring the toolbar's
// TABLE/JSON toggle. Scoped to just this statement's rows/fields.
function StatementRows({ statement, view }: { statement: SqlStatementResult; view: "table" | "json" }) {
  const { rows, fields } = statement;

  if (view === "json") {
    return (
      <div className="relative">
        <CopyButton
          value={JSON.stringify(rows, null, 2)}
          title="Copy JSON"
          className="absolute top-1 right-1 text-muted-foreground hover:text-foreground transition-colors"
        />
        <pre className="whitespace-pre leading-[1.65] text-foreground/90">{JSON.stringify(rows, null, 2)}</pre>
      </div>
    );
  }

  return (
    <div className="max-w-full overflow-x-auto rounded border border-border">
      <table className="w-full border-collapse text-left text-[10px]">
        <thead>
          <tr className="border-b border-border bg-card text-muted-foreground">
            {fields.map((f) => (
              <th key={f} className="truncate border-r border-border p-1 font-semibold">
                {f}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {rows.map((row, idx) => (
            <tr key={idx} className="hover:bg-accent/40">
              {fields.map((f) => {
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
  );
}

// One collapsible block per statement in the submitted script. Each block owns
// its own status (success/error), statement preview, row count or error, and
// execution time — a failed statement reports its error inline on its own block
// so the statements around it stay readable.
function StatementBlock({ statement, view }: { statement: SqlStatementResult; view: "table" | "json" }) {
  // Failed statements and result-bearing SELECTs open by default; a plain
  // successful DDL/DML with nothing to show starts collapsed to reduce noise.
  const [open, setOpen] = useState(!statement.success || statement.rows.length > 0);
  const hasRows = statement.success && statement.rows.length > 0;

  return (
    <div className={`rounded border ${statement.success ? "border-border" : "border-destructive/40"}`}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left hover:bg-accent/30"
      >
        {open ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        {statement.success ? (
          <Check className="h-3 w-3 shrink-0 text-emerald-400" />
        ) : (
          <X className="h-3 w-3 shrink-0 text-destructive" />
        )}
        <span className="shrink-0 text-[10px] font-semibold text-muted-foreground/70">#{statement.statementIndex + 1}</span>
        <code className="min-w-0 flex-1 truncate text-[10px] text-foreground/80" title={statement.statementText}>
          {statement.statementText}
        </code>
        <span className="ml-auto flex shrink-0 items-center gap-2 text-[10px] text-muted-foreground">
          {statement.success ? (
            <span>{hasRows ? `${statement.rowCount} row${statement.rowCount === 1 ? "" : "s"}` : "OK"}</span>
          ) : (
            <span className="text-destructive">error</span>
          )}
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3 text-emerald-400/70" />
            {statement.executionMs}ms
          </span>
        </span>
      </button>

      {open && (
        <div className="border-t border-border/60 p-2">
          {!statement.success && (
            <div className="flex items-start justify-between gap-2 rounded border border-destructive/40 bg-destructive/10 p-2 text-[10px] text-destructive">
              <div>
                <strong>Error:</strong> {statement.error}
              </div>
              <CopyButton value={statement.error ?? ""} title="Copy error" />
            </div>
          )}
          {statement.success && hasRows && <StatementRows statement={statement} view={view} />}
          {statement.success && !hasRows && (
            <div className="text-[10px] text-muted-foreground">
              Statement executed successfully. {statement.rowCount > 0 ? `${statement.rowCount} row${statement.rowCount === 1 ? "" : "s"} affected.` : "No rows returned."}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// The bottom panel's Query Output tab — renders whatever the center canvas's
// SQL Query editor (SqlQueryCanvas) last executed, one block per statement.
// Output state lives in SimulatorStudioPage, same lifted pattern as the Log
// Stream's channel selection. The Table/JSON toggle mirrors the Log Stream
// toolbar's INFO/WARN/ERROR toggle styling and applies to every block's rows.
export function SqlQueryOutput({ output }: { output: SqlOutput }) {
  const [view, setView] = useState<"table" | "json">("table");
  const { isExecuting, statements, error } = output;

  const total = statements?.length ?? 0;
  const failed = statements?.filter((s) => !s.success).length ?? 0;
  const totalMs = statements?.reduce((sum, s) => sum + s.executionMs, 0) ?? 0;

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
              title={key === "table" ? "Show result sets as tables" : "Show result sets as raw JSON"}
            >
              {label}
            </button>
          ))}
        </div>
        {statements && total > 0 && (
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Clock className="h-3 w-3 text-emerald-400" />
            {total} stmt{total === 1 ? "" : "s"} · {totalMs}ms
            {failed > 0 && <span className="text-destructive"> · {failed} failed</span>}
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

        {/* Transport-level failure (network/auth) — distinct from a per-statement SQL error. */}
        {!isExecuting && error && (
          <div className="flex items-start justify-between gap-2 rounded border border-destructive/40 bg-destructive/10 p-2 text-[10px] text-destructive">
            <div>
              <strong>Request error:</strong> {error}
            </div>
            <CopyButton value={error} title="Copy error" />
          </div>
        )}

        {!isExecuting && !error && statements && total === 0 && (
          <div className="py-2 text-center text-muted-foreground">Nothing to run — no SQL statements found.</div>
        )}

        {!isExecuting && !error && statements && total > 0 && (
          <div className="flex flex-col gap-1.5">
            {statements.map((s) => (
              <StatementBlock key={s.statementIndex} statement={s} view={view} />
            ))}
          </div>
        )}

        {!isExecuting && !error && !statements && (
          <div className="flex items-center justify-center gap-2 py-2 text-muted-foreground">
            <TableIcon className="h-3.5 w-3.5 opacity-50" />
            <span>Run a query in the SQL Query tab to inspect testbed data.</span>
          </div>
        )}
      </div>
    </div>
  );
}
