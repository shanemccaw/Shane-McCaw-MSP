/**
 * SQL Runner — "Query Output" bottom panel tab.
 *
 * Renders whatever `sqlStore.output` last held after a run — one collapsible
 * block per statement, SSMS-style, same shape the old admin panel's
 * `SqlQueryOutput.tsx` already renders (this is a restyle onto adminv2's own
 * theme tokens, not a new component design).
 *
 * Each statement block also gets a right-click menu — the closest fit here to
 * Deploy Console's `TranscriptRow` "Run again / Copy command / Copy output"
 * (`screens/git/FloatingDeployConsole.tsx`), since this is this screen's own
 * run transcript. "Run again" is deliberately left off: `statementText`
 * (`sqlTypes.ts`) is documented as a truncated preview, "not necessarily the
 * full statement text", and this panel never receives the original query
 * that produced it — re-running a possibly-truncated preview could silently
 * execute different SQL than what actually ran, so the menu only ever copies
 * what is genuinely shown, the same values the row's own `CopyButton`s copy.
 */

import { useState, useSyncExternalStore, type CSSProperties } from "react";
import { Check, ChevronDown, ChevronRight, Clock, Copy, Loader2, TableIcon, X } from "lucide-react";
import { ACCENT, FONT, LINE, SURFACE, TEXT } from "../../theme";
import { ContextMenu, useContextMenu } from "../../shell/ContextMenu";
import { copyOutput, getSnapshot, setResultView, subscribe } from "./sqlStore";
import type { SqlStatementResult } from "./sqlTypes";

function CopyButton({ value, title = "Copy" }: { value: string; title?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard?.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      title={title}
      style={{ display: "flex", alignItems: "center", background: "transparent", border: 0, color: copied ? ACCENT.greenSoft : TEXT.faint, cursor: "pointer", padding: 2 }}
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
    </button>
  );
}

function StatementRows({ statement, view }: { statement: SqlStatementResult; view: "table" | "json" }) {
  const { rows, fields } = statement;

  if (view === "json") {
    return (
      <div style={{ position: "relative" }}>
        <div style={{ position: "absolute", top: 2, right: 2 }}>
          <CopyButton value={JSON.stringify(rows, null, 2)} title="Copy JSON" />
        </div>
        <pre style={{ margin: 0, whiteSpace: "pre", lineHeight: 1.65, color: TEXT.soft, fontFamily: FONT.mono, fontSize: 11 }}>{JSON.stringify(rows, null, 2)}</pre>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "100%", overflowX: "auto", borderRadius: 4, border: `1px solid ${LINE.base}` }}>
      <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: 10.5, fontFamily: FONT.mono }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${LINE.base}`, background: SURFACE.card, color: TEXT.meta }}>
            {fields.map((f) => (
              <th key={f} style={{ padding: 4, borderRight: `1px solid ${LINE.base}`, fontWeight: 700 }}>
                {f}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={idx} style={{ borderBottom: `1px solid ${LINE.subtle}` }}>
              {fields.map((f) => {
                const value = row[f];
                const display = value === null ? "null" : typeof value === "object" ? JSON.stringify(value) : String(value);
                return (
                  <td key={f} title={display} style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", padding: 4, borderRight: `1px solid ${LINE.subtle}`, color: value === null ? TEXT.faint : TEXT.body, fontStyle: value === null ? "italic" : "normal" }}>
                    {display}
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

function StatementBlock({ statement, view }: { statement: SqlStatementResult; view: "table" | "json" }) {
  const [open, setOpen] = useState(!statement.success || statement.rows.length > 0);
  const hasRows = statement.success && statement.rows.length > 0;
  const { menu, open: openMenu, close: closeMenu } = useContextMenu();

  return (
    <div
      style={{ borderRadius: 5, border: `1px solid ${statement.success ? LINE.base : ACCENT.danger}` }}
      onContextMenu={(event) =>
        openMenu(
          event,
          [
            { label: "Copy statement text", onSelect: () => void navigator.clipboard?.writeText(statement.statementText) },
            {
              label: "Copy result as JSON",
              onSelect: () => void navigator.clipboard?.writeText(JSON.stringify(statement.rows, null, 2)),
              disabled: !hasRows,
            },
            {
              label: "Copy error",
              onSelect: () => void navigator.clipboard?.writeText(statement.error ?? ""),
              disabled: statement.success,
            },
          ],
          `Actions for statement #${statement.statementIndex + 1}`,
        )
      }
    >
      <ContextMenu menu={menu} onClose={closeMenu} />
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{ display: "flex", width: "100%", alignItems: "center", gap: 6, padding: "4px 8px", background: "transparent", border: 0, textAlign: "left", cursor: "pointer" }}
      >
        {open ? <ChevronDown size={12} color={TEXT.faint} /> : <ChevronRight size={12} color={TEXT.faint} />}
        {statement.success ? <Check size={12} color={ACCENT.greenBright} /> : <X size={12} color={ACCENT.danger} />}
        <span style={{ flex: "none", fontSize: 10, fontWeight: 700, color: TEXT.faint }}>#{statement.statementIndex + 1}</span>
        <code style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 10.5, color: TEXT.soft, fontFamily: FONT.mono }} title={statement.statementText}>
          {statement.statementText}
        </code>
        <span style={{ marginLeft: "auto", display: "flex", flex: "none", alignItems: "center", gap: 8, fontSize: 10.5, color: TEXT.meta }}>
          {statement.success ? <span>{hasRows ? `${statement.rowCount} row${statement.rowCount === 1 ? "" : "s"}` : "OK"}</span> : <span style={{ color: ACCENT.danger }}>error</span>}
          <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
            <Clock size={11} color={ACCENT.greenSoft} />
            {statement.executionMs}ms
          </span>
        </span>
      </button>

      {open && (
        <div style={{ borderTop: `1px solid ${LINE.subtle}`, padding: 8 }}>
          {!statement.success && (
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, borderRadius: 4, border: `1px solid ${ACCENT.danger}66`, background: `${ACCENT.danger}1a`, padding: 8, fontSize: 10.5, color: ACCENT.danger }}>
              <div>
                <strong>Error:</strong> {statement.error}
              </div>
              <CopyButton value={statement.error ?? ""} title="Copy error" />
            </div>
          )}
          {statement.success && hasRows && <StatementRows statement={statement} view={view} />}
          {statement.success && !hasRows && (
            <div style={{ fontSize: 10.5, color: TEXT.meta }}>
              Statement executed successfully. {statement.rowCount > 0 ? `${statement.rowCount} row${statement.rowCount === 1 ? "" : "s"} affected.` : "No rows returned."}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const viewToggleStyle = (on: boolean): CSSProperties => ({
  borderRadius: 4,
  padding: "2px 7px",
  fontSize: 10,
  fontWeight: 700,
  background: on ? "rgba(255,255,255,.14)" : "transparent",
  color: on ? TEXT.bright : TEXT.faint,
  border: 0,
  cursor: "pointer",
});

export function SqlQueryOutputPanel() {
  const store = useSyncExternalStore(subscribe, getSnapshot);
  const { isExecuting, statements, error } = store.output;
  const view = store.resultView;

  const total = statements?.length ?? 0;
  const failed = statements?.filter((s) => !s.success).length ?? 0;
  const totalMs = statements?.reduce((sum, s) => sum + s.executionMs, 0) ?? 0;

  return (
    <div style={{ display: "flex", height: "100%", minHeight: 0, flexDirection: "column", background: SURFACE.app, fontFamily: FONT.mono, fontSize: 11, color: TEXT.body }}>
      <div style={{ display: "flex", flex: "none", height: 28, alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${LINE.subtle}`, background: SURFACE.chrome, padding: "0 8px" }}>
        <div style={{ display: "flex", gap: 2 }}>
          <button type="button" onClick={() => setResultView("table")} style={viewToggleStyle(view === "table")}>
            TABLE
          </button>
          <button type="button" onClick={() => setResultView("json")} style={viewToggleStyle(view === "json")}>
            JSON
          </button>
        </div>
        {statements && total > 0 && (
          <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10.5, color: TEXT.meta }}>
            <Clock size={11} color={ACCENT.greenBright} />
            {total} stmt{total === 1 ? "" : "s"} · {totalMs}ms
            {failed > 0 && <span style={{ color: ACCENT.danger }}> · {failed} failed</span>}
            <button type="button" onClick={() => copyOutput(view === "json")} title="Copy all" style={{ display: "flex", background: "transparent", border: 0, color: TEXT.faint, cursor: "pointer" }}>
              <Copy size={12} />
            </button>
          </span>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 8 }}>
        {isExecuting && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: 16, color: TEXT.meta }}>
            <Loader2 size={14} />
            <span>Executing query…</span>
          </div>
        )}

        {!isExecuting && error && (
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, borderRadius: 4, border: `1px solid ${ACCENT.danger}66`, background: `${ACCENT.danger}1a`, padding: 8, fontSize: 10.5, color: ACCENT.danger }}>
            <div>
              <strong>Request error:</strong> {error}
            </div>
            <CopyButton value={error} title="Copy error" />
          </div>
        )}

        {!isExecuting && !error && statements && total === 0 && (
          <div style={{ padding: 8, textAlign: "center", color: TEXT.meta }}>Nothing to run — no SQL statements found.</div>
        )}

        {!isExecuting && !error && statements && total > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {statements.map((s) => (
              <StatementBlock key={s.statementIndex} statement={s} view={view} />
            ))}
          </div>
        )}

        {!isExecuting && !error && !statements && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: 8, color: TEXT.meta }}>
            <TableIcon size={14} style={{ opacity: 0.5 }} />
            <span>Run a query to see results here.</span>
          </div>
        )}
      </div>
    </div>
  );
}
