/**
 * SQL Runner — the center canvas (`index.tsx`'s `render`).
 *
 * Real CodeMirror SQL editor (`@uiw/react-codemirror` + `@codemirror/lang-sql`
 * PostgreSQL dialect, schema-aware autocomplete) — same libraries the old
 * admin panel's `SqlQueryCanvas.tsx` already uses, restyled with adminv2's own
 * theme tokens rather than the old panel's tailwind classes (`theme.ts`'s doc
 * comment: this shell paints its own surfaces, never the surrounding panel's
 * token layer).
 *
 * Selection is derived from `ctx` (the open doc), not a separate store field
 * — `AdminV2.tsx`'s `ActiveScreen` already resolves which record is open;
 * duplicating that in `sqlStore` would just be a second, less trustworthy
 * source of truth. Unsaved edit text lives in this component's own state,
 * keyed by doc id, so it survives switching between open scripts on this
 * screen without needing a global store (see `sqlStore.ts`'s doc comment).
 *
 * A destructive run — a script flagged `isDestructive`, any query containing
 * a `delete`/`drop`/`truncate`/`alter` keyword, or *any* migration (real
 * migration files carry no destructive flag from the backend, so an unknown
 * risk is treated as one) — arms the Run button in place instead of firing:
 * the first click relabels it "Run — press again"; only the second runs it.
 * Mirrors the peek `confirm` convention (SHELL.md) for a control that isn't a
 * peek action, because running arbitrary SQL against the real database is at
 * least as irreversible as anything a peek guards.
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { PostgreSQL, sql } from "@codemirror/lang-sql";
import { EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { oneDark } from "@codemirror/theme-one-dark";
import { AlertTriangle, Play, Save } from "lucide-react";
import { sqlStatementGutter } from "@/lib/sql-statement-gutter";
import { ACCENT, FONT, LINE, SURFACE, TEXT } from "../../theme";
import { useShell } from "../../shell/ShellContext";
import { createScriptFromDraft, getSnapshot, loadMigrationContent, patchScript, runMigrationFile, runQueryText, setDraftQuery, subscribe } from "./sqlStore";
import { containsDangerousKeyword, relativeTime } from "./sqlTypes";

// `oneDark` is the base palette (backgrounds, selection, syntax highlighting,
// autocomplete popup) — without it CodeMirror falls back to its default
// *light* theme almost everywhere, which is why the editor was rendering as
// a bright white box against the rest of this shell's dark chrome. The
// override on top only repaints the couple of surfaces that need to match
// `theme.ts` tokens exactly rather than oneDark's own dark blue-grey.
const editorSurfaceTheme = EditorView.theme(
  {
    "&": { backgroundColor: SURFACE.app, height: "100%" },
    ".cm-scroller": { fontFamily: FONT.mono, fontSize: "12.5px" },
    ".cm-content": { backgroundColor: SURFACE.app, caretColor: "#fff" },
    ".cm-gutters": { backgroundColor: SURFACE.app, borderRight: `1px solid ${LINE.subtle}`, color: TEXT.faintest },
    ".cm-activeLine": { backgroundColor: "rgba(255,255,255,.03)" },
    ".cm-activeLineGutter": { backgroundColor: "rgba(255,255,255,.03)" },
    // oneDark's own selection color reads as near-invisible against this
    // theme's darker `.cm-content` background — explicit override so a
    // selected range is actually visible, focused or not.
    "&:not(.cm-focused) .cm-selectionBackground, .cm-selectionLayer .cm-selectionBackground": {
      backgroundColor: `${ACCENT.info}40 !important`,
    },
    "&.cm-focused .cm-selectionBackground, &.cm-focused .cm-selectionLayer .cm-selectionBackground": {
      backgroundColor: `${ACCENT.info}66 !important`,
    },
    ".cm-tooltip, .cm-tooltip-autocomplete": { backgroundColor: SURFACE.overlay, border: `1px solid ${LINE.control}` },
    ".cm-tooltip-autocomplete ul li[aria-selected]": { backgroundColor: SURFACE.wellHover },
  },
  { dark: true },
);

interface Props {
  recordId?: string;
  kind?: string;
}

export function SqlEditorBody({ recordId, kind }: Props) {
  const store = useSyncExternalStore(subscribe, getSnapshot);
  const shell = useShell();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [armed, setArmed] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);
  const cmRef = useRef<ReactCodeMirrorRef>(null);

  const script = kind === "script" && recordId ? store.scripts.find((s) => String(s.id) === recordId) : undefined;
  const migration = kind === "migration" && recordId ? store.migrations.find((m) => m.filename === recordId) : undefined;
  const docId = script ? `script:${script.id}` : migration ? `migration:${migration.filename}` : null;

  const migrationText = migration
    ? (store.migrationContent[migration.filename] ??
      (store.migrationContentLoading[migration.filename]
        ? `-- Loading lib/db/migrations/manual/${migration.filename}…`
        : `-- lib/db/migrations/manual/${migration.filename}`))
    : undefined;
  const savedText = script ? script.query : migration ? migrationText! : store.draftQuery;
  const editedText = docId ? edits[docId] : undefined;
  const isReadOnly = !!migration;
  const text = isReadOnly ? savedText : (editedText ?? savedText);
  const dirty = !isReadOnly && !!script && editedText !== undefined && editedText !== script.query;
  const canSave = script ? dirty : !migration && text.trim().length > 0;

  useEffect(() => {
    setArmed(false);
  }, [recordId, kind]);

  useEffect(() => {
    if (docId) shell.setDocDirty(docId, dirty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, dirty]);

  useEffect(() => {
    if (migration) void loadMigrationContent(migration.filename);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [migration?.filename]);

  const schemaMap = useMemo(() => {
    const map: Record<string, { label: string; detail: string }[]> = {};
    for (const t of store.schema) {
      map[t.name] = t.columns.map((c) => ({ label: c.name, detail: c.dataType }));
    }
    return map;
  }, [store.schema]);

  function setText(next: string) {
    if (isReadOnly) return;
    if (docId) {
      setEdits((prev) => ({ ...prev, [docId]: next }));
      return;
    }
    // No script/migration open — this is the unsaved "New query" draft, which
    // the ribbon's "New query" button and the Explorer both need to be able
    // to start from outside React (see `sqlStore.ts`), so it lives there.
    setDraftQuery(next);
  }

  const destructive = migration ? true : script ? script.isDestructive || containsDangerousKeyword(text) : containsDangerousKeyword(text);

  function currentRunText(): string {
    const view = cmRef.current?.view;
    if (!view) return text;
    const { from, to } = view.state.selection.main;
    return from === to ? view.state.doc.toString() : view.state.sliceDoc(from, to);
  }

  async function handleRun() {
    if (destructive && !armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    shell.dispatch({ type: "setBottomTab", id: "sql-output" });
    if (migration) {
      await runMigrationFile(migration.filename);
    } else {
      const runText = currentRunText();
      if (!runText.trim()) return;
      await runQueryText(runText);
    }
  }

  /**
   * The gutter's per-statement play button (below) — runs one chunk without
   * selecting it first. It has no label to relabel "press again" onto, so a
   * destructive chunk gets a one-shot `window.confirm` instead of the
   * toolbar Run button's in-place arm; either way nothing destructive fires
   * on a single click.
   */
  function runStatementText(statementText: string) {
    const stmtDestructive = (script?.isDestructive ?? false) || containsDangerousKeyword(statementText);
    if (stmtDestructive && !window.confirm("This statement looks like it writes or deletes data. Run just this one now?")) return;
    shell.dispatch({ type: "setBottomTab", id: "sql-output" });
    void runQueryText(statementText);
  }

  async function handleSave() {
    if (isReadOnly) return;
    if (script) {
      const next = docId ? edits[docId] : undefined;
      if (next === undefined) return;
      const ok = await patchScript(script.id, { query: next });
      if (ok && docId) setEdits((prev) => { const { [docId]: _drop, ...rest } = prev; return rest; });
      return;
    }
    // Unsaved draft — the same lightweight window.prompt flow `screens/ad`
    // uses for "New MSP"/"New organizational unit" (there is no modal-form
    // primitive in adminv2 yet).
    if (!text.trim()) return;
    const name = window.prompt("Script name:");
    if (!name?.trim()) return;
    const category = window.prompt("Category:", "Diagnostics");
    if (category === null) return;
    const created = await createScriptFromDraft({
      name: name.trim(),
      category: category.trim() || "Diagnostics",
      query: text,
      isDestructive: destructive,
      isResetScript: false,
    });
    if (created) shell.openDoc({ kind: "script", id: String(created.id), screenId: "sql", label: created.name });
  }

  const extensions = useMemo(
    () => [
      sql({ dialect: PostgreSQL, schema: schemaMap, upperCaseKeywords: true }),
      editorSurfaceTheme,
      EditorState.readOnly.of(isReadOnly),
      EditorView.editable.of(!isReadOnly),
      // Migrations are excluded: their text is a read-only preview and Run
      // always executes the real file off disk, never the shown text — a
      // per-chunk play button here would silently run arbitrary SQL through
      // /simulator/sql/execute instead of the migration it looks like it
      // belongs to.
      ...(isReadOnly ? [] : [sqlStatementGutter(runStatementText)]),
      Prec.highest(
        keymap.of([
          {
            key: "Mod-Enter",
            run: () => {
              void handleRun();
              return true;
            },
          },
        ]),
      ),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [schemaMap, isReadOnly, destructive, armed, docId, script?.isDestructive],
  );

  const title = script ? script.name : migration ? migration.filename : "New query";
  const isExecuting = store.output.isExecuting;

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", background: SURFACE.app }}>
      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 10, height: 34, padding: "0 14px", borderBottom: `1px solid ${LINE.group}`, background: SURFACE.chrome }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: TEXT.bright, fontFamily: script || migration ? FONT.mono : FONT.sans }}>{title}</span>
        {script && <Badge label={script.category} tone={TEXT.dim} />}
        {destructive && <Badge label="destructive" tone={ACCENT.danger} />}
        {script?.isResetScript && <Badge label="reset script" tone={ACCENT.amber} />}
        {dirty && <Badge label="unsaved" tone={ACCENT.amber} />}
        <div style={{ flex: 1 }} />
        {store.saving && <span style={{ fontSize: 11, color: TEXT.meta }}>Saving…</span>}
      </div>

      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 8, height: 32, padding: "0 10px", borderBottom: `1px solid ${LINE.subtle}`, background: SURFACE.chrome }}>
        <button
          type="button"
          onClick={() => void handleRun()}
          disabled={isExecuting}
          title={migration ? "Run this migration file for real" : "Run selection if text is selected, otherwise run everything (Ctrl/Cmd + Enter)"}
          style={runButtonStyle(destructive, armed, isExecuting)}
        >
          {destructive && !armed ? <AlertTriangle size={12} /> : <Play size={12} />}
          {isExecuting ? "Running…" : armed ? "Run — press again" : migration ? (migration.ranAt ? "Run again" : "Run migration") : hasSelection ? "Run selection" : "Run all"}
        </button>
        {!isReadOnly && (
          <button type="button" onClick={() => void handleSave()} disabled={!canSave} style={toolbarButtonStyle}>
            <Save size={12} />
            Save
          </button>
        )}
        <div style={{ flex: 1 }} />
        {migration && <span style={{ fontSize: 11, color: TEXT.meta }}>{migration.ranAt ? `ran ${relativeTime(migration.ranAt)}` : "never run"}</span>}
      </div>

      <div style={{ flex: 1, minHeight: 0 }}>
        <CodeMirror
          ref={cmRef}
          value={text}
          onChange={setText}
          onUpdate={(viewUpdate) => setHasSelection(!viewUpdate.state.selection.main.empty)}
          extensions={extensions}
          theme={oneDark}
          height="100%"
          style={{ height: "100%", fontSize: 12.5 }}
          basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: !isReadOnly }}
        />
      </div>
    </div>
  );
}

function Badge({ label, tone }: { label: string; tone: string }) {
  return (
    <span
      style={{
        flex: "none",
        fontSize: 9.5,
        fontWeight: 700,
        letterSpacing: ".05em",
        textTransform: "uppercase",
        padding: "2px 7px",
        borderRadius: 9,
        border: `1px solid ${tone}55`,
        background: `${tone}1e`,
        color: tone,
      }}
    >
      {label}
    </span>
  );
}

function runButtonStyle(destructive: boolean, armed: boolean, running: boolean): CSSProperties {
  const bg = running ? "rgba(233,202,99,.22)" : destructive ? (armed ? ACCENT.danger : "#8a3d3d") : "#3a8f5f";
  return {
    display: "flex",
    alignItems: "center",
    gap: 6,
    height: 24,
    padding: "0 11px",
    borderRadius: 5,
    border: 0,
    fontFamily: "inherit",
    fontSize: 11.5,
    fontWeight: 600,
    cursor: "pointer",
    background: bg,
    color: running ? ACCENT.amber : "#fff",
  };
}

const toolbarButtonStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  height: 24,
  padding: "0 10px",
  borderRadius: 5,
  border: `1px solid ${LINE.control}`,
  background: "transparent",
  color: TEXT.quiet,
  fontFamily: "inherit",
  fontSize: 11.5,
  cursor: "pointer",
};
