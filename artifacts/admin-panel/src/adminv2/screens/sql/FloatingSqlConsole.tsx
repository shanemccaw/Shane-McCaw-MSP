/**
 * The floating SQL console — a real multi-line CodeMirror editor that hovers
 * over whatever screen you're on, mirroring `screens/git/FloatingDeployConsole.tsx`
 * (same corner, same "always mounted, renders null while closed" shape) so
 * the two developer consoles feel like one family rather than two
 * separately-invented panels.
 *
 * Started life as a single-line `<input>` — too small for real SQL, which
 * routinely runs to a dozen-plus lines (multi-step migrations, CTEs). It's
 * now the same `@codemirror/lang-sql` editor the docked SQL Runner uses
 * (`SqlEditorBody.tsx`, sharing `sqlEditorTheme.ts` so a future theme fix
 * can't drift between the two), just floating and resizable instead of
 * docked — "the big SQL editor, but floaty small" was the ask.
 *
 * Unlike the docked editor, this never opens a doc or touches
 * `edits`/`draftQuery` — it is a standalone way to fire queries without
 * navigating to `/sql` first, the same relationship the floating Deploy
 * Console has to the full Git screen. Its own transcript
 * (`floatingTranscript`) is a session log of everything run here, not a
 * single "last result" — see `sqlStore.ts`'s `FloatingSqlEntry` doc comment.
 *
 * Always mounted (see `AdminV2.tsx`) so `SqlFetchBridge`'s already-configured
 * `sqlStore` fetch is ready the moment this opens — no separate wiring needed.
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { PostgreSQL, sql } from "@codemirror/lang-sql";
import { Prec } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { oneDark } from "@codemirror/theme-one-dark";
import { AlertTriangle, Check, ChevronDown, ChevronRight, Maximize2, Play, X } from "lucide-react";
import { sqlStatementGutter } from "@/lib/sql-statement-gutter";
import { ACCENT, ACCENT_TEXT, FONT, LINE, SHADOW, SURFACE, TEXT, Z } from "../../theme";
import { getShellApi } from "../../shell/ShellContext";
import { ContextMenu, useContextMenu } from "../../shell/ContextMenu";
import {
  closeFloatingSql,
  getSnapshot,
  runFloatingQuery,
  setDraftQuery,
  setFloatingInput,
  setFloatingSize,
  startDraft,
  subscribe,
  type FloatingSqlEntry,
} from "./sqlStore";
import { sqlEditorTheme } from "./sqlEditorTheme";
import { containsDangerousKeyword } from "./sqlTypes";
import { FloatingSqlHistorySidekick } from "./FloatingSqlHistorySidekick";

const CONSOLE_RIGHT = 16;
const CONSOLE_BOTTOM = 16;
/** How tall the transcript strip below the editor gets, fixed rather than proportional — the editor is the point, the log is a scrollable strip under it. */
const TRANSCRIPT_HEIGHT = 150;

export function FloatingSqlConsole() {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const cmRef = useRef<ReactCodeMirrorRef>(null);
  const [armed, setArmed] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(true);

  useEffect(() => {
    const el = transcriptRef.current;
    // jsdom (tests) does not implement Element.scrollTo — real browsers do.
    if (el && typeof el.scrollTo === "function") el.scrollTo({ top: el.scrollHeight });
  }, [state.floatingTranscript]);

  const schemaMap = useMemo(() => {
    const map: Record<string, { label: string; detail: string }[]> = {};
    for (const t of state.schema) {
      map[t.name] = t.columns.map((c) => ({ label: c.name, detail: c.dataType }));
    }
    return map;
  }, [state.schema]);

  const destructive = containsDangerousKeyword(state.floatingInput);

  function currentRunText(): string {
    const view = cmRef.current?.view;
    if (!view) return state.floatingInput;
    const { from, to } = view.state.selection.main;
    return from === to ? view.state.doc.toString() : view.state.sliceDoc(from, to);
  }

  function fire() {
    const runText = currentRunText();
    if (!runText.trim()) return;
    if (destructive && !armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    setTranscriptOpen(true);
    // A selection runs without clearing the editor (same as the docked
    // editor's "Run selection") — only a whole-buffer run clears it after,
    // since that's the "fire one query, type the next" quick-console flow.
    void runFloatingQuery(hasSelection ? runText : undefined);
  }

  /** Per-statement gutter play button — same one-shot confirm the docked editor's own uses for a destructive chunk. */
  function runStatementText(statementText: string) {
    if (containsDangerousKeyword(statementText) && !window.confirm("This statement looks like it writes or deletes data. Run just this one now?")) return;
    setTranscriptOpen(true);
    void runFloatingQuery(statementText);
  }

  const extensions = useMemo(
    () => [
      sql({ dialect: PostgreSQL, schema: schemaMap, upperCaseKeywords: true }),
      sqlEditorTheme,
      sqlStatementGutter(runStatementText),
      Prec.highest(
        keymap.of([
          {
            key: "Mod-Enter",
            run: () => {
              fire();
              return true;
            },
          },
        ]),
      ),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [schemaMap, destructive, armed, state.floatingInput],
  );

  const resizeStart = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  function startResize(event: ReactPointerEvent) {
    event.preventDefault();
    resizeStart.current = { x: event.clientX, y: event.clientY, width: state.floatingWidth, height: state.floatingHeight };
    function onMove(moveEvent: PointerEvent) {
      const start = resizeStart.current;
      if (!start) return;
      // Anchored bottom-right, so dragging the corner outward (up/left) grows it.
      setFloatingSize(start.width + (start.x - moveEvent.clientX), start.height + (start.y - moveEvent.clientY));
    }
    function onUp() {
      resizeStart.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  if (!state.floatingOpen) return null;

  function openInEditor(query: string) {
    startDraft();
    setDraftQuery(query);
    getShellApi()?.navigate("/sql");
    getShellApi()?.dispatch({ type: "setBottomTab", id: "sql-output" });
  }

  return (
    <>
      <FloatingSqlHistorySidekick />
      <div
        role="dialog"
        aria-label="SQL Console"
        style={{
          position: "fixed",
          right: CONSOLE_RIGHT,
          bottom: CONSOLE_BOTTOM,
          width: state.floatingWidth,
          maxWidth: "calc(100vw - 32px)",
          height: state.floatingHeight,
          maxHeight: "calc(100vh - 80px)",
          display: "flex",
          flexDirection: "column",
          background: SURFACE.overlay,
          border: `1px solid ${LINE.strong}`,
          borderRadius: 9,
          boxShadow: SHADOW.overlay,
          zIndex: Z.ribbon + 10,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            flex: "none",
            height: 34,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 10px",
            borderBottom: `1px solid ${LINE.base}`,
            background: SURFACE.chrome,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: TEXT.bright }}>SQL Console</span>
            <span style={{ fontSize: 11, color: TEXT.meta }}>real database — nothing here is simulated</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button
              type="button"
              title="Open in the full SQL Runner"
              onClick={() => openInEditor(state.floatingInput)}
              style={iconButtonStyle}
            >
              <Maximize2 size={12} />
            </button>
            <button type="button" aria-label="Close SQL Console" onClick={closeFloatingSql} style={iconButtonStyle}>
              <X size={13} />
            </button>
          </div>
        </div>

        <div
          style={{
            flex: "none",
            display: "flex",
            alignItems: "center",
            gap: 8,
            height: 32,
            padding: "0 10px",
            borderBottom: `1px solid ${LINE.subtle}`,
            background: SURFACE.chrome,
          }}
        >
          <button
            type="button"
            onClick={fire}
            disabled={!state.floatingInput.trim()}
            title="Run selection if text is selected, otherwise run everything (Ctrl/Cmd + Enter)"
            style={runButtonStyle(destructive, armed, !state.floatingInput.trim())}
          >
            {destructive && !armed ? <AlertTriangle size={12} /> : <Play size={12} />}
            {armed ? "Run — press again" : hasSelection ? "Run selection" : "Run all"}
          </button>
          <div style={{ flex: 1 }} />
        </div>

        <div style={{ flex: 1, minHeight: 0 }}>
          <CodeMirror
            ref={cmRef}
            value={state.floatingInput}
            onChange={(next) => {
              setArmed(false);
              setFloatingInput(next);
            }}
            onUpdate={(viewUpdate) => setHasSelection(!viewUpdate.state.selection.main.empty)}
            extensions={extensions}
            theme={oneDark}
            height="100%"
            style={{ height: "100%", fontSize: 12.5 }}
            placeholder="SELECT … — Ctrl/Cmd+Enter runs it"
            basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: true }}
          />
        </div>

        <div style={{ flex: "none", borderTop: `1px solid ${LINE.base}`, background: SURFACE.chrome }}>
          <button
            type="button"
            onClick={() => setTranscriptOpen((v) => !v)}
            style={{
              display: "flex", alignItems: "center", gap: 6, width: "100%", height: 24, padding: "0 10px",
              background: "transparent", border: 0, cursor: "pointer", color: TEXT.meta, fontSize: 10.5, fontWeight: 700,
              textTransform: "uppercase", letterSpacing: ".04em",
            }}
          >
            {transcriptOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            Run log{state.floatingTranscript.length > 0 ? ` (${state.floatingTranscript.length})` : ""}
          </button>
          {transcriptOpen && (
            <div ref={transcriptRef} style={{ height: TRANSCRIPT_HEIGHT, overflow: "auto", padding: "0 10px 8px", borderTop: `1px solid ${LINE.subtle}` }}>
              {state.floatingTranscript.length === 0 ? (
                <div style={{ fontSize: 11.5, color: TEXT.meta, lineHeight: 1.5, padding: "8px 0" }}>
                  Nothing run yet this session.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 6 }}>
                  {state.floatingTranscript.map((entry) => (
                    <TranscriptRow key={entry.id} entry={entry} onOpenInEditor={() => openInEditor(entry.query)} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div
          onPointerDown={startResize}
          title="Drag to resize"
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: 16,
            height: 16,
            cursor: "nwse-resize",
            zIndex: 1,
          }}
        >
          <svg viewBox="0 0 16 16" width={16} height={16} style={{ display: "block", opacity: 0.5 }}>
            <path d="M14 2 L2 14 M14 7 L7 14 M14 12 L12 14" stroke={TEXT.faint} strokeWidth={1.4} />
          </svg>
        </div>
      </div>
    </>
  );
}

const iconButtonStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 20,
  height: 20,
  border: "none",
  borderRadius: 4,
  background: "transparent",
  color: TEXT.meta,
  cursor: "pointer",
};

function runButtonStyle(destructive: boolean, armed: boolean, disabled: boolean): CSSProperties {
  const bg = destructive ? (armed ? ACCENT.danger : "#8a3d3d") : "#3a8f5f";
  return {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: 6,
    height: 24,
    padding: "0 12px",
    borderRadius: 5,
    border: "none",
    cursor: disabled ? "default" : "pointer",
    fontSize: 11.5,
    fontWeight: 600,
    fontFamily: "inherit",
    background: bg,
    color: "#fff",
    opacity: disabled ? 0.6 : 1,
  };
}

function TranscriptRow({ entry, onOpenInEditor }: { entry: FloatingSqlEntry; onOpenInEditor: () => void }) {
  const [open, setOpen] = useState(entry.status !== "ok" || (entry.statements?.length ?? 0) <= 1);
  const { menu, open: openMenu, close: closeMenu } = useContextMenu();
  const tone = entry.status === "running" ? TEXT.meta : entry.status === "ok" ? ACCENT_TEXT.green : ACCENT_TEXT.danger;
  const total = entry.statements?.length ?? 0;
  const failed = entry.statements?.filter((s) => !s.success).length ?? 0;

  return (
    <div
      onContextMenu={(event) =>
        openMenu(
          event,
          [
            { label: "Copy query", onSelect: () => void navigator.clipboard?.writeText(entry.query) },
            { label: "Open in SQL Runner", onSelect: onOpenInEditor },
          ],
          `Actions for query`,
        )
      }
    >
      <ContextMenu menu={menu} onClose={closeMenu} />
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{ display: "flex", width: "100%", alignItems: "center", gap: 8, background: "transparent", border: 0, padding: 0, textAlign: "left", cursor: "pointer" }}
      >
        {open ? <ChevronDown size={12} color={TEXT.faint} /> : <ChevronRight size={12} color={TEXT.faint} />}
        <span style={{ color: ACCENT.info, fontFamily: FONT.mono, fontSize: 12 }}>{"›"}</span>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: TEXT.primary, fontFamily: FONT.mono, fontSize: 12 }}>
          {entry.query.replace(/\s*\n\s*/g, " ⏎ ")}
        </span>
        <span style={{ marginLeft: "auto", flexShrink: 0, fontSize: 10.5, fontWeight: 700, color: tone }}>
          {entry.status === "running" ? "RUNNING" : entry.status === "ok" ? (failed > 0 ? `${failed}/${total} FAILED` : "OK") : "FAILED"}
        </span>
      </button>

      {open && (
        <div style={{ marginTop: 4, marginLeft: 20 }}>
          {entry.error && <div style={{ fontSize: 11, color: ACCENT_TEXT.danger }}>{entry.error}</div>}
          {entry.statements?.map((s) => (
            <div key={s.statementIndex} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, marginTop: 2 }}>
              {s.success ? <Check size={11} color={ACCENT_TEXT.green} /> : <X size={11} color={ACCENT_TEXT.danger} />}
              <span style={{ color: TEXT.meta }}>
                {s.success ? (s.rows.length > 0 ? `${s.rowCount} row${s.rowCount === 1 ? "" : "s"}` : "OK") : s.error}
              </span>
              <span style={{ color: TEXT.faint }}>· {s.executionMs}ms</span>
            </div>
          ))}
          {entry.status === "ok" && total > 0 && (
            <button
              type="button"
              onClick={onOpenInEditor}
              style={{ marginTop: 4, background: "transparent", border: 0, padding: 0, color: ACCENT.info, fontSize: 10.5, cursor: "pointer" }}
            >
              View full results in SQL Runner →
            </button>
          )}
        </div>
      )}
    </div>
  );
}
