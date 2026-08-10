/**
 * The floating SQL console — a quick-query box that hovers over whatever
 * screen you're on, mirroring `screens/git/FloatingDeployConsole.tsx` (same
 * chrome, same corner, same "always mounted, renders null while closed"
 * shape) so the two developer consoles feel like one family rather than two
 * separately-invented panels.
 *
 * Unlike the docked SQL Runner editor (`SqlEditorBody.tsx`), this never opens
 * a doc or touches `edits`/`draftQuery` — it is a standalone way to fire one
 * query without navigating to `/sql` first, the same relationship the
 * floating Deploy Console has to the full Git screen (`GitConsoleBody.tsx`'s
 * own doc comment: "this body is a documented, one-click launcher ... not a
 * second, separate place results show up" — here it's the reverse: the
 * floating console is the quick path, `/sql` is where you go for the full
 * editor, autocomplete, and saved-script tools).
 *
 * Always mounted (see `AdminV2.tsx`) so `SqlFetchBridge`'s already-configured
 * `sqlStore` fetch is ready the moment this opens — no separate wiring needed.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Check, ChevronDown, ChevronRight, Play, X } from "lucide-react";
import { ACCENT, ACCENT_TEXT, LINE, SHADOW, SURFACE, TEXT, Z } from "../../theme";
import { getShellApi } from "../../shell/ShellContext";
import { ContextMenu, useContextMenu } from "../../shell/ContextMenu";
import {
  closeFloatingSql,
  getSnapshot,
  runFloatingQuery,
  setFloatingInput,
  setDraftQuery,
  startDraft,
  subscribe,
  type FloatingSqlEntry,
} from "./sqlStore";
import { containsDangerousKeyword } from "./sqlTypes";
import { FloatingSqlHistorySidekick } from "./FloatingSqlHistorySidekick";

export function FloatingSqlConsole() {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    const el = transcriptRef.current;
    // jsdom (tests) does not implement Element.scrollTo — real browsers do.
    if (el && typeof el.scrollTo === "function") el.scrollTo({ top: el.scrollHeight });
  }, [state.floatingTranscript]);

  if (!state.floatingOpen) return null;

  const destructive = containsDangerousKeyword(state.floatingInput);

  function fire() {
    if (destructive && !armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    void runFloatingQuery();
  }

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
          right: 16,
          bottom: 16,
          width: 620,
          maxWidth: "calc(100vw - 32px)",
          height: 340,
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
          <button
            type="button"
            aria-label="Close SQL Console"
            onClick={closeFloatingSql}
            style={{
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
            }}
          >
            <X size={13} />
          </button>
        </div>

        <div ref={transcriptRef} style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 10 }}>
          {state.floatingTranscript.length === 0 ? (
            <div style={{ fontSize: 12, color: TEXT.meta, lineHeight: 1.6, maxWidth: 480 }}>
              Type a query below — Enter runs it. For the full editor with autocomplete, saved scripts, and
              migrations, open the SQL Runner screen instead.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {state.floatingTranscript.map((entry) => (
                <TranscriptRow key={entry.id} entry={entry} onOpenInEditor={() => openInEditor(entry.query)} />
              ))}
            </div>
          )}
        </div>

        <div
          style={{
            flex: "none",
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: 8,
            borderTop: `1px solid ${LINE.base}`,
          }}
        >
          <input
            value={state.floatingInput}
            onChange={(e) => {
              setArmed(false);
              setFloatingInput(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                fire();
              }
            }}
            placeholder="SELECT … — Enter runs it"
            spellCheck={false}
            aria-label="SQL Console query"
            style={{
              flex: 1,
              minWidth: 0,
              height: 28,
              padding: "0 10px",
              borderRadius: 5,
              border: `1px solid ${LINE.control}`,
              background: SURFACE.inset,
              color: TEXT.body,
              outline: "none",
              fontFamily: "Menlo, Consolas, monospace",
              fontSize: 12,
            }}
          />
          <button
            type="button"
            onClick={fire}
            disabled={!state.floatingInput.trim()}
            style={{
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              gap: 6,
              height: 28,
              padding: "0 14px",
              borderRadius: 5,
              border: "none",
              cursor: state.floatingInput.trim() ? "pointer" : "default",
              fontSize: 12,
              fontWeight: 600,
              fontFamily: "inherit",
              background: destructive ? (armed ? ACCENT.danger : "#8a3d3d") : "#3a8f5f",
              color: "#fff",
              opacity: state.floatingInput.trim() ? 1 : 0.6,
            }}
          >
            <Play size={12} />
            {armed ? "Run — press again" : "Run"}
          </button>
        </div>
      </div>
    </>
  );
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
        <span style={{ color: ACCENT.info, fontFamily: "Menlo, Consolas, monospace", fontSize: 12 }}>{"›"}</span>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: TEXT.primary, fontFamily: "Menlo, Consolas, monospace", fontSize: 12 }}>
          {entry.query}
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
