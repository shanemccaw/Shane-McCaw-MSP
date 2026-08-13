// CodeMirror extension for the SQL console: tracks the individual statements
// in the document, renders a play button in the gutter on each statement's
// first line, and highlights a statement's full line extent while its play
// button is hovered so it's unambiguous which block will run.

import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, gutter, GutterMarker } from "@codemirror/view";
import { splitSqlStatements, type SqlStatement } from "./sql-statements";

export const statementsField = StateField.define<SqlStatement[]>({
  create: (state) => splitSqlStatements(state.doc.toString()),
  update: (value, tr) => (tr.docChanged ? splitSqlStatements(tr.newDoc.toString()) : value),
});

const setHoveredStatement = StateEffect.define<SqlStatement | null>();

const hoverLine = Decoration.line({ class: "cm-sqlStmtHover" });

const hoverField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    if (tr.docChanged) return Decoration.none;
    for (const effect of tr.effects) {
      if (effect.is(setHoveredStatement)) {
        const stmt = effect.value;
        if (!stmt) return Decoration.none;
        const doc = tr.state.doc;
        const to = Math.min(stmt.to, doc.length);
        const first = doc.lineAt(Math.min(stmt.from, doc.length)).number;
        const last = doc.lineAt(to).number;
        const ranges = [];
        for (let n = first; n <= last; n++) {
          ranges.push(hoverLine.range(doc.line(n).from));
        }
        return Decoration.set(ranges);
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

class PlayMarker extends GutterMarker {
  constructor(
    readonly stmt: SqlStatement,
    readonly onRun: (statementText: string) => void,
  ) {
    super();
  }

  eq(other: PlayMarker) {
    return this.stmt.from === other.stmt.from && this.stmt.to === other.stmt.to && this.stmt.text === other.stmt.text;
  }

  toDOM(view: EditorView) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cm-sqlStmtRunBtn";
    btn.title = "Run this statement";
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="currentColor" width="10" height="10" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
    // Keep focus in the editor instead of the button.
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      this.onRun(this.stmt.text);
    });
    btn.addEventListener("mouseenter", () => {
      view.dispatch({ effects: setHoveredStatement.of(this.stmt) });
    });
    btn.addEventListener("mouseleave", () => {
      view.dispatch({ effects: setHoveredStatement.of(null) });
    });
    return btn;
  }
}

const gutterTheme = EditorView.baseTheme({
  ".cm-sqlStmtGutter": { width: "18px" },
  ".cm-sqlStmtRunBtn": {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "16px",
    height: "100%",
    padding: "0",
    margin: "0",
    border: "none",
    background: "transparent",
    color: "#3fb950",
    cursor: "pointer",
    opacity: "0.65",
  },
  ".cm-sqlStmtRunBtn:hover": { opacity: "1", transform: "scale(1.2)" },
  ".cm-sqlStmtHover": { backgroundColor: "rgba(88, 166, 255, 0.13)" },
});

/**
 * Builds the statement gutter extension. `onRun` receives the exact text of
 * the clicked statement (semicolon included).
 */
export function sqlStatementGutter(onRun: (statementText: string) => void) {
  return [
    statementsField,
    hoverField,
    gutterTheme,
    gutter({
      class: "cm-sqlStmtGutter",
      lineMarker(view, line) {
        const stmts = view.state.field(statementsField);
        const stmt = stmts.find((s) => view.state.doc.lineAt(Math.min(s.from, view.state.doc.length)).from === line.from);
        return stmt ? new PlayMarker(stmt, onRun) : null;
      },
      lineMarkerChange: (update) => update.docChanged,
    }),
  ];
}
