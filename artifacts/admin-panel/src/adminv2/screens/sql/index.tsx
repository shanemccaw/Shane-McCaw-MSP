/**
 * SQL Runner — screen registration.
 *
 * A real Postgres console at `/admin-panel/adminv2/sql` over the exact
 * backend the old admin panel's Simulator Studio already shipped
 * (`admin-engines.ts`'s `/simulator/sql/*` and `/simulator/migrations/*`
 * routes, `saved_sql_scripts` table) — no new backend route or migration,
 * this is new adminv2-shell chrome over already-real, already-dangerous
 * data. Read `SHELL.md` first.
 *
 * Placement: `run` pairs with `git` as the amber developer capsule
 * (`handoff.md` section 3) and already hosts Live Scan ("watch the platform's
 * own checks executing"). SQL Runner is the same family — a developer tool
 * that *runs* something for real against the platform — so its ribbon group
 * lands on `run` rather than a new fixed tab (the seven are closed).
 *
 * Every fixed-tab command here is `open`/`create`/`global` per the audited
 * rule (`SHELL.md` section 1) — Rename/Delete/Run-a-specific-script are all
 * `record`-scoped and live on the two per-kind contextual tabs below
 * ("Script Tools", "Migration Tools"), matching `screens/ad/index.tsx`'s
 * per-`ctx.kind` pattern. `PEEK_KINDS` (`registry/types.ts`) gained
 * `"migration"` for this screen — a migration file is a genuinely different
 * record shape from a saved script (no name/category to edit, no delete, an
 * unknown destructive risk instead of a stored flag) — same additive
 * extension AD did for `msp`/`user`/`group`/`ou`.
 *
 * Known gap, matching the shell's own "Known gaps" convention: no live count
 * is wired onto the Watch tab for unrun migrations, even though the design
 * names that as a canonical Watch example. Doing that honestly needs a
 * background poll independent of whether anyone has opened this screen —
 * out of scope here, same reasoning `screens/ad/index.tsx` gives for MSPs
 * past due.
 */

import { AlertTriangle, CheckCheck, Copy, Database, FileJson, FileWarning, Layers, Play, Plus, Table2, Trash2 } from "lucide-react";
import { ACCENT } from "../../theme";
import { registerScreen } from "../../registry/registry";
import { getShellApi } from "../../shell/ShellContext";
import type { CommandItem, ContextualTabSpec, GalleryRow } from "../../registry/types";
import { SqlEditorBody } from "./SqlEditorBody";
import { SqlExplorer } from "./SqlExplorer";
import { SqlQueryOutputPanel } from "./SqlQueryOutput";
import {
  deleteScriptById,
  duplicateScript,
  getSnapshot,
  markMigrationAsRan,
  patchScript,
  runMigrationFile,
  runQueryText,
  setAutoCopy,
  setAutoCopyFormat,
  SQL_RIBBON_KEYS,
  startDraft,
} from "./sqlStore";
import { relativeTime } from "./sqlTypes";

function toggleAutoCopy() {
  setAutoCopy(!getSnapshot().autoCopy);
}

function openSql() {
  getShellApi()?.navigate("/sql");
}

function openScript(id: number, label: string) {
  getShellApi()?.navigate("/sql");
  getShellApi()?.openDoc({ kind: "script", id: String(id), screenId: "sql", label });
}

function openMigration(filename: string) {
  getShellApi()?.navigate("/sql");
  getShellApi()?.openDoc({ kind: "migration", id: filename, screenId: "sql", label: filename });
}

function newQuery() {
  startDraft();
  openSql();
}

/**
 * Rebuilt on every read via the `get rows()` getter below — matches
 * `screens/endpoints/index.tsx`'s `endpointRows()`/`get rows()` pattern.
 * `ribbon` is a plain array captured once at `registerScreen()` module-load
 * time, so a plain `rows: [...]` property would freeze at whatever
 * `scripts`/`migrations` held (usually nothing) at import time — a getter
 * re-runs this function every time the gallery is actually opened.
 */
function scriptGalleryRows(): GalleryRow[] {
  const s = getSnapshot();
  const scriptRows: GalleryRow[] = s.scripts.map((sc) => ({
    id: `script:${sc.id}`,
    group: sc.category,
    tile: sc.isDestructive ? "!" : "SQL",
    name: sc.name,
    head: sc.isDestructive ? "destructive" : sc.isResetScript ? "reset" : "",
    sub: `${sc.isDestructive ? "writes to the database" : "read only"} · updated ${relativeTime(sc.updatedAt)}`,
    onSelect: () => getShellApi()?.openPeek("script", String(sc.id)),
  }));
  const pendingMigrationRows: GalleryRow[] = s.migrations
    .filter((m) => !m.ranAt)
    .map((m) => ({
      id: `migration:${m.filename}`,
      group: "Migrations to run",
      tile: "run",
      name: m.filename,
      head: "never run",
      sub: "lib/db/migrations/manual/ — runs against the real database",
      onSelect: () => getShellApi()?.openPeek("migration", m.filename),
    }));
  return [...scriptRows, ...pendingMigrationRows];
}

registerScreen({
  id: "sql",
  title: "SQL Runner",
  area: "sql",
  icon: Database,
  route: "/sql",
  render: (ctx) => <SqlEditorBody recordId={ctx.recordId} kind={ctx.kind} />,
  left: { title: "Explorer", render: () => <SqlExplorer /> },
  bottom: [{ id: "sql-output", label: "Query Output", render: () => <SqlQueryOutputPanel /> }],

  ribbon: [
    {
      tab: "run",
      order: 20,
      group: {
        label: "SQL Runner",
        large: [
          {
            label: "Saved scripts",
            icon: Database,
            intent: "open",
            onSelect: openSql,
            gallery: {
              id: "sql-scripts",
              title: "SQL scripts",
              searchable: true,
              searchPlaceholder: "Search scripts and migrations",
              get rows() {
                return scriptGalleryRows();
              },
              footer: { label: "New query…", onSelect: newQuery },
            },
          },
        ],
        small: [
          { label: "New query", icon: Plus, intent: "create", onSelect: newQuery },
          {
            label: "Migrations to run",
            icon: Layers,
            intent: "open",
            get color() {
              return getSnapshot().migrations.some((m) => !m.ranAt) ? ACCENT.amber : undefined;
            },
            onSelect: () => {
              const pending = getSnapshot().migrations.find((m) => !m.ranAt);
              if (pending) openMigration(pending.filename);
              else openSql();
            },
          },
        ],
      },
    },
    {
      tab: "run",
      order: 30,
      group: {
        label: "Auto copy",
        large: [
          {
            label: "Auto copy",
            icon: Copy,
            intent: "global",
            onSelect: toggleAutoCopy,
            title: "Copy every result to the clipboard the moment a run finishes",
            liveKey: SQL_RIBBON_KEYS.autoCopyToggle,
          },
        ],
        small: [
          {
            label: "As table",
            icon: Table2,
            intent: "global",
            onSelect: () => setAutoCopyFormat("table"),
            liveKey: SQL_RIBBON_KEYS.autoCopyTable,
          },
          {
            label: "As JSON",
            icon: FileJson,
            intent: "global",
            onSelect: () => setAutoCopyFormat("json"),
            liveKey: SQL_RIBBON_KEYS.autoCopyJson,
          },
        ],
      },
    },
  ],

  contextualTab: (ctx): ContextualTabSpec | null => {
    if (!ctx.kind || !ctx.recordId) return null;
    const s = getSnapshot();

    if (ctx.kind === "script") {
      const sc = s.scripts.find((x) => String(x.id) === ctx.recordId);
      if (!sc) return null;
      return {
        id: "sql-script-tools",
        label: "Script Tools",
        groups: [
          {
            label: "Script",
            large: [
              {
                label: "Run it",
                icon: Play,
                intent: "record",
                color: sc.isDestructive ? ACCENT.danger : ACCENT.green,
                onSelect: () => {
                  getShellApi()?.dispatch({ type: "setBottomTab", id: "sql-output" });
                  void runQueryText(sc.query);
                },
              },
            ],
            small: [
              {
                label: sc.isDestructive ? "Mark as safe" : "Mark as destructive",
                icon: AlertTriangle,
                intent: "record",
                color: sc.isDestructive ? undefined : ACCENT.amber,
                onSelect: () => void patchScript(sc.id, { isDestructive: !sc.isDestructive }),
              },
              {
                label: "Duplicate",
                icon: Copy,
                intent: "record",
                onSelect: () => void duplicateScript(sc),
              },
              {
                label: "Delete",
                icon: Trash2,
                intent: "record",
                color: ACCENT.danger,
                onSelect: () => {
                  if (window.confirm(`Delete saved script "${sc.name}"? This cannot be undone.`)) void deleteScriptById(sc.id);
                },
              },
            ],
          },
        ],
      };
    }

    if (ctx.kind === "migration") {
      const m = s.migrations.find((x) => x.filename === ctx.recordId);
      if (!m) return null;
      return {
        id: "sql-migration-tools",
        label: "Migration Tools",
        groups: [
          {
            label: "Migration",
            large: [
              {
                label: m.ranAt ? "Run again" : "Run migration",
                icon: Play,
                intent: "record",
                color: ACCENT.amber,
                onSelect: () => {
                  if (!window.confirm(`Run "${m.filename}" against the real database now? This cannot be undone from here.`)) return;
                  getShellApi()?.dispatch({ type: "setBottomTab", id: "sql-output" });
                  void runMigrationFile(m.filename);
                },
              },
            ],
            small: [
              {
                label: m.ranAt ? "Re-mark as run" : "Mark as run (no execute)",
                icon: CheckCheck,
                intent: "record",
                onSelect: () => {
                  if (
                    window.confirm(
                      `Mark "${m.filename}" as already run WITHOUT executing it?\n\nOnly do this if you already ran the SQL yourself and the file's own tracking INSERT didn't fire.`,
                    )
                  ) {
                    void markMigrationAsRan(m.filename);
                  }
                },
              },
            ],
          },
        ],
      };
    }

    return null;
  },

  peeks: {
    script: (id) => {
      const sc = getSnapshot().scripts.find((s) => String(s.id) === id);
      if (!sc) return null;
      return {
        kind: "script",
        eyebrow: "SQL SCRIPT",
        title: sc.name,
        sub: sc.category,
        icon: Database,
        tone: sc.isDestructive ? ACCENT.danger : ACCENT.info,
        tag: sc.isDestructive ? "destructive" : sc.isResetScript ? "reset script" : "read only",
        tagTone: sc.isDestructive ? ACCENT.danger : ACCENT.info,
        facts: [
          { label: "Updated", value: relativeTime(sc.updatedAt), prose: true },
          { label: "Created", value: relativeTime(sc.createdAt), prose: true },
        ],
        edits: [
          { key: "name", label: "Name", value: sc.name, onChange: (v) => void patchScript(sc.id, { name: v }) },
          { key: "category", label: "Category", value: sc.category, onChange: (v) => void patchScript(sc.id, { category: v }) },
          {
            key: "destructive",
            label: "Destructive",
            value: sc.isDestructive ? "yes" : "no",
            options: ["no", "yes"],
            onChange: (v) => void patchScript(sc.id, { isDestructive: v === "yes" }),
          },
        ],
        body: { title: "Query", content: sc.query },
        open: () => openScript(sc.id, sc.name),
        actions: [
          {
            label: "Run it",
            tone: "primary",
            onSelect: () => {
              openScript(sc.id, sc.name);
              getShellApi()?.dispatch({ type: "setBottomTab", id: "sql-output" });
              void runQueryText(sc.query);
            },
          },
          { label: "Delete", tone: "danger", confirm: true, onSelect: () => void deleteScriptById(sc.id) },
        ],
      };
    },
    migration: (filename) => {
      const m = getSnapshot().migrations.find((x) => x.filename === filename);
      if (!m) return null;
      return {
        kind: "migration",
        eyebrow: "MIGRATION",
        title: filename,
        icon: FileWarning,
        tone: m.ranAt ? ACCENT.info : ACCENT.amber,
        tag: m.ranAt ? "ran" : "never run",
        tagTone: m.ranAt ? ACCENT.info : ACCENT.amber,
        facts: [{ label: "Ran", value: relativeTime(m.ranAt), prose: true }],
        body: { title: "Contents", content: "Executed directly from the server filesystem — not previewable here." },
        open: () => openMigration(filename),
        actions: [
          {
            label: m.ranAt ? "Run again" : "Run migration",
            tone: "primary",
            confirm: true,
            onSelect: () => {
              openMigration(filename);
              getShellApi()?.dispatch({ type: "setBottomTab", id: "sql-output" });
              void runMigrationFile(filename);
            },
          },
          {
            label: m.ranAt ? "Re-mark as run" : "Mark as run (no execute)",
            confirm: true,
            onSelect: () => void markMigrationAsRan(filename),
          },
        ],
      };
    },
  },

  commands: () => {
    const s = getSnapshot();
    const items: CommandItem[] = [
      {
        id: "act:sql-new-query",
        type: "action",
        kind: "run",
        name: "New SQL query",
        sub: "Blank script in the SQL Runner",
        area: "sql",
        run: newQuery,
      },
    ];

    const pending = s.migrations.filter((m) => !m.ranAt);
    if (pending.length > 0) {
      items.push({
        id: "ans:sql-migrations-pending",
        type: "answer",
        name: "Migrations never run",
        sub: "lib/db/migrations/manual/",
        area: "sql",
        live: String(pending.length),
        run: () => openMigration(pending[0]!.filename),
      });
    }

    for (const sc of s.scripts) {
      items.push({
        id: `rec:sql-script-${sc.id}`,
        type: "record",
        kind: "script",
        name: sc.name,
        sub: sc.category,
        tag: sc.isDestructive ? "destructive" : undefined,
        area: "sql",
        run: () => openScript(sc.id, sc.name),
      });
    }

    return items;
  },
});
