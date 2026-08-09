/**
 * SQL Runner — Explorer tree (the screen's `left` panel).
 *
 * Saved scripts grouped by category, plus migration files (never-run first),
 * mirroring `SimulatorLeftTree.tsx`'s "Saved SQL Scripts" / "Migrations"
 * sections in the old admin panel — same real data, adminv2 chrome.
 *
 * Rows only navigate (`openDoc`) — no context menu here. Mutating actions
 * (rename, recategorize, toggle destructive, duplicate, delete, run) live on
 * the record's own contextual "Script Tools"/"Migration Tools" ribbon tab
 * once it is open (`index.tsx`), or on its peek's edit fields/actions when
 * reached through the ribbon's gallery — same split `AdExplorerTree.tsx`
 * uses (its tree only navigates too; AD's mutations live on `contextualTab`).
 */

import { useState, useSyncExternalStore, type CSSProperties } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Layers, Plus, RefreshCw, RotateCcw, Scroll } from "lucide-react";
import { ACCENT, LINE, TEXT } from "../../theme";
import { useShell } from "../../shell/ShellContext";
import { getSnapshot, loadMigrations, loadScripts, startDraft, subscribe } from "./sqlStore";
import type { MigrationFile, SavedScript } from "./sqlTypes";

const sectionRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  height: 25,
  padding: "0 8px",
  cursor: "pointer",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: ".07em",
  textTransform: "uppercase",
  color: TEXT.dimmer,
};

const categoryRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  height: 22,
  padding: "0 8px 0 18px",
  fontSize: 11,
  fontWeight: 650,
  color: TEXT.quiet,
};

function itemRowStyle(on: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 6,
    height: 23,
    padding: "0 8px 0 28px",
    cursor: "pointer",
    fontSize: 12,
    color: on ? "#fff" : TEXT.quiet,
    background: on ? "rgba(255,255,255,.1)" : "transparent",
    borderLeft: `2px solid ${on ? "#c8c6c4" : "transparent"}`,
  };
}

function groupByCategory(scripts: SavedScript[]): Map<string, SavedScript[]> {
  const groups = new Map<string, SavedScript[]>();
  for (const sc of scripts) {
    const list = groups.get(sc.category) ?? [];
    list.push(sc);
    groups.set(sc.category, list);
  }
  return groups;
}

export function SqlExplorer() {
  const store = useSyncExternalStore(subscribe, getSnapshot);
  const shell = useShell();
  const [scriptsOpen, setScriptsOpen] = useState(true);
  const [migrationsOpen, setMigrationsOpen] = useState(true);

  const activeDoc = shell.state.docs.find((d) => d.id === shell.state.activeDocId);

  function openScript(sc: SavedScript) {
    shell.openDoc({ kind: "script", id: String(sc.id), screenId: "sql", label: sc.name });
  }

  function openMigration(m: MigrationFile) {
    shell.openDoc({ kind: "migration", id: m.filename, screenId: "sql", label: m.filename });
  }

  function onNewScript() {
    startDraft();
    shell.navigate("/sql");
  }

  const grouped = groupByCategory(store.scripts);
  const pendingMigrations = store.migrations.filter((m) => !m.ranAt);
  const ranMigrations = store.migrations.filter((m) => m.ranAt);
  const orderedMigrations = [...pendingMigrations, ...ranMigrations];

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "6px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 8px 8px" }}>
        <button type="button" onClick={onNewScript} title="New query" style={iconButtonStyle}>
          <Plus size={13} />
        </button>
        <button
          type="button"
          onClick={() => {
            void loadScripts();
            void loadMigrations();
          }}
          title="Refresh"
          style={iconButtonStyle}
        >
          <RefreshCw size={13} />
        </button>
      </div>

      <div style={sectionRowStyle} onClick={() => setScriptsOpen((v) => !v)}>
        {scriptsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>Saved Scripts</span>
      </div>
      {scriptsOpen && (
        <div>
          {store.scripts.length === 0 && !store.scriptsLoading && (
            <div style={{ padding: "2px 8px 6px 28px", fontSize: 11, fontStyle: "italic", color: TEXT.faint }}>No saved scripts</div>
          )}
          {[...grouped.entries()].map(([category, items]) => (
            <div key={category}>
              <div style={categoryRowStyle}>
                <span>{category}</span>
                <span style={{ color: TEXT.faintest, fontWeight: 400 }}>{items.length}</span>
              </div>
              {items.map((sc) => {
                const on = activeDoc?.id === `script:${sc.id}`;
                const dirty = !!shell.state.docs.find((d) => d.id === `script:${sc.id}`)?.dirty;
                return (
                  <div
                    key={sc.id}
                    style={itemRowStyle(on)}
                    onClick={() => openScript(sc)}
                    title={sc.isDestructive ? "Destructive script" : sc.isResetScript ? "Reset script" : sc.name}
                  >
                    {sc.isDestructive ? (
                      <AlertTriangle size={12} color={ACCENT.danger} />
                    ) : sc.isResetScript ? (
                      <RotateCcw size={12} color={ACCENT.amber} />
                    ) : (
                      <Scroll size={12} color={on ? "#fff" : TEXT.quieter} />
                    )}
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "Menlo, Consolas, monospace" }}>
                      {sc.name}
                    </span>
                    {dirty && <span style={{ fontSize: 8, color: ACCENT.amber }}>●</span>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      <div style={{ ...sectionRowStyle, marginTop: 6 }} onClick={() => setMigrationsOpen((v) => !v)}>
        {migrationsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>Migrations</span>
        {pendingMigrations.length > 0 && <span style={{ color: ACCENT.amber, fontWeight: 700 }}>{pendingMigrations.length} to run</span>}
      </div>
      {migrationsOpen && (
        <div>
          {orderedMigrations.length === 0 && !store.migrationsLoading && (
            <div style={{ padding: "2px 8px 6px 28px", fontSize: 11, fontStyle: "italic", color: TEXT.faint }}>No manual migration files</div>
          )}
          {orderedMigrations.map((m) => {
            const on = activeDoc?.id === `migration:${m.filename}`;
            const done = !!m.ranAt;
            return (
              <div
                key={m.filename}
                style={{ ...itemRowStyle(on), fontFamily: "Menlo, Consolas, monospace", fontSize: 11.5 }}
                onClick={() => openMigration(m)}
                title={done ? `Ran ${m.ranAt}` : "Never run"}
              >
                <Layers size={12} color={done ? TEXT.faintest : ACCENT.amberDim} />
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: done ? TEXT.faint : undefined }}>
                  {m.filename.replace(/\.sql$/, "")}
                </span>
                {done && <span style={{ fontSize: 9, color: TEXT.faintest }}>ran</span>}
              </div>
            );
          })}
        </div>
      )}
      <div style={{ borderTop: `1px solid ${LINE.subtle}`, marginTop: 8, padding: "8px 8px 2px", fontSize: 10.5, color: TEXT.faint, lineHeight: 1.5 }}>
        Open a row, then use its Script/Migration Tools tab. Every run here is real — nothing is simulated.
      </div>
    </div>
  );
}

const iconButtonStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 22,
  height: 22,
  borderRadius: 5,
  border: `1px solid ${LINE.control}`,
  background: "transparent",
  color: TEXT.quiet,
  cursor: "pointer",
};
