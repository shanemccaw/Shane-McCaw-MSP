/**
 * Run History body — the log itself.
 *
 * Header, filter bar, then day-banded rows, per the design's `show_hist`
 * column (`Admin Shell.dc.html` line 2012 onward). One row carries: a
 * pass/fail dot, the derived title, the ticket pill, the kind, when it ran,
 * how many times that exact command has run, the command on a mono line, and
 * the consequence chips. Everything a row says is measured from what actually
 * came back — see `api-server/src/lib/run-history.ts`, which is where the
 * measuring happens.
 *
 * Search and the Deploy/SQL chips are applied **server-side** (the search
 * covers the output, which the list response does not carry), so the rows here
 * are already the answer — there is no second, local filter pass that could
 * disagree with the count in the header.
 *
 * Selecting a row is not navigation: it fills the Properties panel and the
 * Output tab, which is handoff.md principle 3. Opening a run *properly* — a
 * doc tab, its own contextual tab — is the peek's "Open it properly".
 */

import { useEffect, useSyncExternalStore } from "react";
import { Search } from "lucide-react";
import { ACCENT, ACCENT_TEXT, FONT, LINE, SURFACE, TEXT, WASH } from "../../theme";
import { getShellApi } from "../../shell/ShellContext";
import { getSnapshot, selectRun, setFilter, setSearch, subscribe, warmRunHistory } from "./runHistoryStore";
import {
  dayBand,
  durationLabel,
  oneLine,
  repeatLabel,
  RUN_FILTERS,
  whenLabel,
  type RunHistoryEntry,
} from "./runHistoryTypes";

export function useRunHistory() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * @param recordId Set when a run was opened as its own doc tab. The list is
 * still the screen — opening a run selects its row rather than replacing the
 * view, so the surrounding runs stay in front of you (that context is most of
 * why you opened it).
 */
export function RunHistoryBody({ recordId }: { recordId?: string }) {
  const state = useRunHistory();

  useEffect(warmRunHistory, []);
  useEffect(() => {
    if (recordId) selectRun(recordId);
  }, [recordId]);

  const rows = state.entries;
  const filtered = Boolean(state.search.trim()) || state.filter !== "All";
  const count = filtered
    ? `${rows.length} of ${state.total}`
    : `${state.total} run${state.total === 1 ? "" : "s"}`;

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", background: SURFACE.app }}>
      <header
        style={{
          flex: "none",
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          padding: "11px 18px",
          borderBottom: `1px solid ${LINE.base}`,
          background: SURFACE.chrome,
        }}
      >
        <span style={{ flex: "none", fontSize: 14, fontWeight: 700, letterSpacing: "-.01em", color: TEXT.primary }}>
          Run history
        </span>
        <span
          style={{
            flex: "0 1 auto",
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: 11.5,
            color: TEXT.groupLabel,
          }}
        >
          Every command and query run against this server, with its output and what it changed
        </span>
        <div style={{ flex: 1, minWidth: 4 }} />
        <span style={{ flex: "none", whiteSpace: "nowrap", fontSize: 11.5, color: TEXT.faint }}>
          {state.loading ? "reading…" : count}
        </span>
      </header>

      <div
        style={{
          flex: "none",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 10px",
          borderBottom: `1px solid ${LINE.quiet}`,
        }}
      >
        <div
          style={{
            flex: "1 1 240px",
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            gap: 6,
            height: 24,
            padding: "0 8px",
            background: SURFACE.well,
            border: `1px solid ${LINE.control}`,
            borderRadius: 4,
          }}
        >
          <Search size={12} color={TEXT.groupLabel} style={{ flex: "none" }} />
          <input
            value={state.search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search commands, notes, tickets and output"
            aria-label="Search run history"
            spellCheck={false}
            style={{
              flex: 1,
              minWidth: 0,
              border: 0,
              outline: 0,
              background: "transparent",
              fontFamily: "inherit",
              fontSize: 11.5,
              color: TEXT.strong,
            }}
          />
        </div>
        {RUN_FILTERS.map((filter) => {
          const on = state.filter === filter;
          return (
            <button
              key={filter}
              type="button"
              onClick={() => setFilter(filter)}
              aria-pressed={on}
              style={{
                flex: "none",
                height: 24,
                padding: "0 10px",
                borderRadius: 4,
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: 11,
                fontWeight: 600,
                background: on ? WASH.chip : "transparent",
                border: `1px solid ${on ? LINE.strong : LINE.control}`,
                color: on ? TEXT.primary : TEXT.dim,
              }}
            >
              {filter}
            </button>
          );
        })}
      </div>

      {state.error ? (
        <div
          style={{
            flex: "none",
            padding: "8px 18px",
            borderBottom: `1px solid ${LINE.quiet}`,
            fontSize: 11.5,
            color: ACCENT_TEXT.danger,
          }}
        >
          {state.error}
        </div>
      ) : null}

      <div style={{ flex: 1, minHeight: 0, overflow: "auto", paddingBottom: 8 }}>
        {rows.length === 0 ? (
          <EmptyState
            loading={state.loading}
            loaded={state.loaded}
            filtered={filtered}
            tableMissing={state.tableMissing}
            migration={state.migration}
          />
        ) : (
          rows.map((entry, index) => (
            <Row
              key={entry.id}
              entry={entry}
              showDay={dayBand(entry.startedAt) !== (rows[index - 1] ? dayBand(rows[index - 1]!.startedAt) : null)}
              selected={state.selectedId === entry.id}
            />
          ))
        )}
      </div>
    </div>
  );
}

function EmptyState({
  loading,
  loaded,
  filtered,
  tableMissing,
  migration,
}: {
  loading: boolean;
  loaded: boolean;
  filtered: boolean;
  tableMissing: boolean;
  migration: string | null;
}) {
  const base = { padding: "34px 22px", maxWidth: 600, fontSize: 12, lineHeight: 1.6 } as const;

  if (tableMissing) {
    return (
      <div style={{ ...base, color: TEXT.meta }}>
        The run history table does not exist yet, so nothing is being kept.
        <div style={{ marginTop: 10, color: TEXT.faint }}>
          Run{" "}
          <span style={{ fontFamily: FONT.mono, color: ACCENT_TEXT.amber }}>
            lib/db/migrations/manual/{migration ?? "2026-08-09-simulator-run-history.sql"}
          </span>{" "}
          and every command and query from then on lands here. Runs made before that are not
          recoverable — there was nowhere to put them.
        </div>
      </div>
    );
  }

  if (!loaded || loading) {
    return <div style={{ ...base, color: TEXT.faint }}>Reading the log…</div>;
  }

  if (filtered) {
    return (
      <div style={{ ...base, color: TEXT.meta }}>
        Nothing matches. History keeps every run — command, output, and what it did.
      </div>
    );
  }

  return (
    <div style={{ ...base, color: TEXT.meta }}>
      Nothing has been run yet. Every Deploy Console command and every SQL Runner query lands here
      the moment it finishes, with its output and what it changed.
      <div style={{ marginTop: 10, color: TEXT.faint }}>
        Recorded by the server as it runs, not by this browser — so a run is kept even if you close
        the tab mid-build, and another admin&rsquo;s runs show up here too.
      </div>
    </div>
  );
}

function Row({ entry, showDay, selected }: { entry: RunHistoryEntry; showDay: boolean; selected: boolean }) {
  return (
    <>
      {showDay ? (
        <div
          style={{
            margin: "8px 12px 3px",
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: ".09em",
            textTransform: "uppercase",
            color: TEXT.faintest,
          }}
        >
          {dayBand(entry.startedAt)}
        </div>
      ) : null}
      <div
        role="button"
        tabIndex={0}
        onClick={() => selectRun(entry.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            selectRun(entry.id);
          }
        }}
        onDoubleClick={() => getShellApi()?.openPeek("run", entry.id)}
        title={entry.ok ? entry.title : `${entry.title} — failed`}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          padding: "7px 12px 9px",
          cursor: "pointer",
          borderBottom: `1px solid ${LINE.subtle}`,
          borderLeft: `2px solid ${selected ? TEXT.quiet : "transparent"}`,
          background: selected ? WASH.hoverSoft : "transparent",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <span
            aria-hidden
            style={{
              flex: "none",
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: entry.ok ? ACCENT.greenBright : ACCENT.danger,
            }}
          />
          <span
            style={{
              flex: "0 1 auto",
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontSize: 12.5,
              fontWeight: 600,
              color: TEXT.strong,
            }}
          >
            {entry.title}
          </span>
          {entry.ticket ? (
            <span
              style={{
                flex: "none",
                whiteSpace: "nowrap",
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: ".04em",
                padding: "1px 6px",
                borderRadius: 9,
                border: `1px solid ${LINE.strong}`,
                color: ACCENT_TEXT.neutral,
              }}
            >
              {entry.ticket}
            </span>
          ) : null}
          <span
            style={{
              flex: "none",
              whiteSpace: "nowrap",
              fontSize: 9.5,
              fontWeight: 700,
              letterSpacing: ".06em",
              textTransform: "uppercase",
              color: entry.kind === "sql" ? ACCENT.amberDim : TEXT.groupLabel,
            }}
          >
            {entry.kind}
          </span>
          <div style={{ flex: 1, minWidth: 4 }} />
          <span style={{ flex: "none", whiteSpace: "nowrap", fontSize: 11, color: TEXT.groupLabel }}>
            {whenLabel(entry.startedAt)}
          </span>
          <span style={{ flex: "none", whiteSpace: "nowrap", fontSize: 11, color: TEXT.faint }}>
            {repeatLabel(entry.runCount)}
          </span>
        </div>

        <div
          style={{
            fontFamily: FONT.mono,
            fontSize: 11,
            color: TEXT.dimmer,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {oneLine(entry.cmd)}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {entry.effect.map((chip) => (
            <span
              key={chip}
              style={{
                flex: "none",
                whiteSpace: "nowrap",
                padding: "1px 7px",
                borderRadius: 9,
                border: `1px solid ${LINE.control}`,
                fontSize: 10,
                color: ACCENT_TEXT.neutral,
              }}
            >
              {chip}
            </span>
          ))}
          <span style={{ flex: "none", whiteSpace: "nowrap", fontSize: 10, color: TEXT.faint }}>
            {durationLabel(entry.durationMs)}
          </span>
          {entry.note ? (
            <span style={{ flex: "1 1 100%", minWidth: 0, fontSize: 11.5, lineHeight: 1.45, color: TEXT.dimmer }}>
              {entry.note}
            </span>
          ) : null}
        </div>
      </div>
    </>
  );
}
