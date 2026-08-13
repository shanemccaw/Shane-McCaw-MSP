/**
 * Run History — screen registration.
 *
 * The log of every command and query actually run against this server. Read
 * `SHELL.md` first, then `api-server/src/lib/run-history.ts` — the rows are
 * written *there*, by the routes that do the running, not by this screen
 * reporting what its browser saw. A run is therefore kept when the tab is
 * closed mid-build, and one admin's runs show up in another's history.
 *
 * This module only reads, annotates and forgets. There is no code path here
 * that can create a run.
 *
 * ## Placement
 *
 * `run` pairs with `git` as the amber developer capsule (`handoff.md`
 * section 3) and already hosts Live Scan and SQL Runner — the two things that
 * *produce* the rows this screen keeps. Its group lands there at order 30, to
 * the right of both, which is also the reading order: run something, then look
 * at what running it did.
 *
 * The second contribution is to `watch`, and it is the only count this screen
 * publishes. `SHELL.md` section 6: a badge is for a number that means you must
 * act. A run that failed is exactly that, and it clears itself when there are
 * none.
 *
 * Every fixed-tab command here is `open`/`create`/`global` per the audited
 * rule. Re-running, copying and forgetting a specific run all need that run
 * open, so they are `record` intents and live on the contextual tab and in the
 * peek.
 *
 * ## Known gaps
 *
 * - The table is provisioned by a manual migration Shane runs himself
 *   (`lib/db/migrations/manual/2026-08-09-simulator-run-history.sql`, per
 *   CLAUDE.md). Until he does, the routes answer with `tableMissing` and this
 *   screen says exactly that, naming the file — a state it can be in, not an
 *   error.
 * - Runs started by a shell on the box itself are not here, and cannot be:
 *   nothing writes a row for them. Anything that goes through the Deploy
 *   Console or the SQL Runner is covered, including from the old admin panel,
 *   because the recording sits in the shared routes rather than in adminv2.
 */

import { Clock, Database, Layers, Search, Terminal, Trash2 } from "lucide-react";
import { ACCENT } from "../../theme";
import { registerScreen } from "../../registry/registry";
import { getShellApi } from "../../shell/ShellContext";
import type { CommandItem, ContextualTabSpec, GalleryRow, PeekModel } from "../../registry/types";
import { RunHistoryBody } from "./RunHistoryBody";
import { RunHistoryOutput } from "./RunHistoryOutput";
import { RunHistoryProperties } from "./RunHistoryProperties";
import { rerunEntry } from "./runHistoryActions";
import {
  clearRunHistory,
  copyText,
  entryById,
  failedCount,
  forgetRun,
  getSnapshot,
  selectRun,
  setFilter,
  setNote,
  setSearch,
  warmRunHistory,
  WATCH_FAILED_KEY,
} from "./runHistoryStore";
import {
  durationLabel,
  oneLine,
  repeatLabel,
  whenLabel,
  type RunFilter,
  type RunHistoryEntry,
} from "./runHistoryTypes";

const ROUTE = "/run-history";

function openRunHistory(filter?: RunFilter) {
  warmRunHistory();
  if (filter) setFilter(filter);
  getShellApi()?.navigate(ROUTE);
}

function showEverything() {
  warmRunHistory();
  setFilter("All");
  setSearch("");
  getShellApi()?.navigate(ROUTE);
}

function openRun(entry: RunHistoryEntry) {
  selectRun(entry.id);
  getShellApi()?.navigate(ROUTE);
  getShellApi()?.openDoc({ kind: "run", id: entry.id, screenId: "run-history", label: entry.title });
}

function showFailures() {
  warmRunHistory();
  setFilter("All");
  setSearch("");
  getShellApi()?.navigate(ROUTE);
  const failed = getSnapshot().entries.find((e) => !e.ok);
  if (failed) selectRun(failed.id);
}

/** Two or three mono characters carrying the row's most useful code — SHELL.md section 5. */
function tileFor(entry: RunHistoryEntry): string {
  if (!entry.ok) return "!";
  return entry.kind === "sql" ? "SQL" : "SH";
}

/**
 * Rebuilt on every read via the `get rows()` getter below — `ribbon` is a
 * plain array captured once at `registerScreen()` module-load time, so a
 * static `rows: [...]` would freeze at the empty log every reload starts with.
 * Same pattern `screens/sql/index.tsx` uses.
 */
function recentRunRows(): GalleryRow[] {
  warmRunHistory();
  return getSnapshot()
    .entries.slice(0, 40)
    .map((entry) => ({
      id: entry.id,
      group: entry.kind === "sql" ? "Queries" : "Commands",
      tile: tileFor(entry),
      name: entry.title,
      head: entry.ok ? "" : "failed",
      // Real data, not a restatement of the name: when it ran, how long it
      // took, and what it did to the system.
      sub: [whenLabel(entry.startedAt), durationLabel(entry.durationMs), ...entry.effect]
        .filter(Boolean)
        .join(" · "),
      on: getSnapshot().selectedId === entry.id,
      onSelect: () => getShellApi()?.openPeek("run", entry.id),
    }));
}

function runPeek(id: string): PeekModel | null {
  const entry = entryById(id);
  if (!entry) return null;

  return {
    kind: "run",
    eyebrow: entry.kind === "sql" ? "SQL RUN" : "DEPLOY RUN",
    title: entry.title,
    sub: oneLine(entry.cmd),
    icon: entry.kind === "sql" ? Database : Terminal,
    tone: entry.ok ? ACCENT.info : ACCENT.danger,
    tag: entry.ok ? "succeeded" : "failed",
    tagTone: entry.ok ? ACCENT.green : ACCENT.danger,
    facts: [
      { label: "When", value: whenLabel(entry.startedAt), prose: true },
      { label: "Took", value: durationLabel(entry.durationMs) || "not measured" },
      { label: "Run before", value: repeatLabel(entry.runCount), prose: true },
      { label: "Ticket", value: entry.ticket || "none in the text", prose: !entry.ticket },
    ],
    edits: [
      {
        key: "note",
        label: "What it was",
        value: entry.note,
        area: true,
        onChange: (next) => void setNote(entry.id, next),
      },
    ],
    body: {
      title: entry.ok ? "Output" : "What it printed before it failed",
      // undefined is "not fetched yet", not "empty" - selecting the run loads it.
      content: entry.output ?? (entry.hasOutput ? "Reading what it printed…" : "It printed nothing."),
    },
    list:
      entry.effect.length > 0
        ? {
            title: "What it did",
            rows: entry.effect.map((chip, i) => ({ id: `${entry.id}-effect-${i}`, name: chip })),
          }
        : undefined,
    open: () => openRun(entry),
    openLabel: "Open it properly",
    actions: [
      {
        label: entry.migrationFile ? "Run this migration again" : entry.kind === "sql" ? "Open in SQL Runner" : "Run again",
        tone: "primary",
        // Re-running a migration writes to the live database from text nobody
        // in this session has read. Everything else is armed by its own screen.
        confirm: Boolean(entry.migrationFile),
        onSelect: () => rerunEntry(entry),
      },
      { label: "Copy output", onSelect: () => copyText(entry.output ?? "") },
      { label: "Forget it", tone: "danger", confirm: true, onSelect: () => void forgetRun(entry.id) },
    ],
  };
}

registerScreen({
  id: "run-history",
  title: "Run History",
  area: "run-history",
  icon: Clock,
  route: ROUTE,
  render: (ctx) => <RunHistoryBody recordId={ctx.recordId} />,
  right: { title: "Properties", render: () => <RunHistoryProperties /> },
  bottom: [{ id: "run-output", label: "Output", render: () => <RunHistoryOutput /> }],

  ribbon: [
    {
      tab: "run",
      order: 30,
      group: {
        label: "History",
        large: [
          {
            label: "Search runs",
            icon: Search,
            intent: "open",
            onSelect: showEverything,
            gallery: {
              id: "recent-runs",
              title: "Recent runs",
              searchable: true,
              searchPlaceholder: "Search what you have run",
              get rows() {
                return recentRunRows();
              },
              footer: { label: "Open the full log", onSelect: showEverything },
            },
          },
        ],
        small: [
          { label: "Deploy only", icon: Terminal, intent: "open", onSelect: () => openRunHistory("Deploy") },
          { label: "SQL only", icon: Database, intent: "open", onSelect: () => openRunHistory("SQL") },
          { label: "Everything", icon: Layers, intent: "open", onSelect: showEverything },
        ],
      },
    },
    {
      tab: "watch",
      order: 40,
      group: {
        label: "Broken",
        small: [
          {
            // Both are overridden at render time by `liveRibbon` once anything
            // has failed — see `runHistoryStore.syncWatchCount`. The resting
            // state is deliberately not a zero: no badge means nothing to act on.
            label: "Runs that failed",
            icon: Clock,
            intent: "open",
            color: ACCENT.danger,
            liveKey: WATCH_FAILED_KEY,
            onSelect: showFailures,
            title: "Every command or query that came back failed",
          },
        ],
      },
    },
  ],

  contextualTab: (ctx): ContextualTabSpec | null => {
    if (ctx.kind !== "run" || !ctx.recordId) return null;
    const entry = entryById(ctx.recordId);
    if (!entry) return null;

    return {
      id: "run-tools",
      label: "Run Tools",
      groups: [
        {
          label: "This run",
          large: [
            {
              label: entry.migrationFile ? "Run migration again" : entry.kind === "sql" ? "Open in SQL Runner" : "Run again",
              icon: Terminal,
              intent: "record",
              color: entry.migrationFile ? ACCENT.amber : undefined,
              onSelect: () => rerunEntry(entry),
              title: entry.cmd,
            },
          ],
          small: [
            {
              label: "Copy output",
              icon: Layers,
              intent: "record",
              disabled: !entry.hasOutput,
              onSelect: () => copyText(entry.output ?? ""),
            },
            { label: "Copy command", icon: Database, intent: "record", onSelect: () => copyText(entry.cmd) },
            {
              label: "Forget this run",
              icon: Trash2,
              intent: "record",
              color: ACCENT.danger,
              onSelect: () => {
                if (window.confirm(`Forget "${entry.title}"? Its output goes with it.`)) void forgetRun(entry.id);
              },
            },
          ],
        },
      ],
    };
  },

  peeks: { run: runPeek },

  commands: () => {
    warmRunHistory();
    const items: CommandItem[] = [
      {
        id: "act:run-history-search",
        type: "action",
        kind: "run",
        name: "Search run history",
        sub: "Every command and query, with its output",
        area: "run-history",
        run: showEverything,
      },
    ];

    const failed = failedCount();
    if (failed > 0) {
      items.push({
        id: "ans:run-history-failed",
        type: "answer",
        name: "Runs that failed",
        sub: "Commands and queries that came back failed",
        area: "run-history",
        live: String(failed),
        run: showFailures,
      });
    }

    if (getSnapshot().entries.length > 0) {
      items.push({
        id: "act:run-history-clear",
        type: "action",
        kind: "run",
        name: "Clear the run log",
        sub: "Forgets every run and its output. Nothing else is affected.",
        area: "run-history",
        run: () => {
          if (window.confirm("Forget every run and its output? The runs themselves already happened — this only clears the log.")) {
            void clearRunHistory();
          }
        },
      });
    }

    return items;
  },
});
