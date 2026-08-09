/**
 * Run History body — the log itself.
 *
 * Header, filter bar, then day-banded rows, per the design's `show_hist`
 * column (`Admin Shell.dc.html` line 2012 onward). One row carries: a
 * pass/fail dot, the derived title, the ticket pill, the kind, when it ran,
 * how many times that exact command has run, the command on a mono line, and
 * the consequence chips. Everything a row says is derived from what actually
 * came back — see `runHistoryStore.ts`.
 *
 * Selecting a row is not navigation: it fills the Properties panel and the
 * Output tab, which is handoff.md principle 3 (a one-off task should not move
 * you off what you were doing). Opening a run *properly* — a doc tab, its own
 * contextual tab — is the peek's "Open it properly", not a side effect of
 * clicking a row.
 */

import { useEffect, useSyncExternalStore } from "react";
import { Search } from "lucide-react";
import { ACCENT, ACCENT_TEXT, FONT, LINE, SURFACE, TEXT, WASH } from "../../theme";
import { getShellApi } from "../../shell/ShellContext";
import {
  getSnapshot,
  hydrateRunHistory,
  runCount,
  selectRun,
  setFilter,
  setSearch,
  subscribe,
  visibleEntries,
} from "./runHistoryStore";
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

  useEffect(hydrateRunHistory, []);
  useEffect(() => {
    if (recordId) selectRun(recordId);
  }, [recordId]);

  const rows = visibleEntries();
  const total = state.entries.length;
  const count =
    rows.length === total ? `${total} run${total === 1 ? "" : "s"}` : `${rows.length} of ${total}`;

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
          Every command and query you have run, with its output and what it changed
        </span>
        <div style={{ flex: 1, minWidth: 4 }} />
        <span style={{ flex: "none", whiteSpace: "nowrap", fontSize: 11.5, color: TEXT.faint }}>{count}</span>
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

      {state.storageError ? (
        <div
          style={{
            flex: "none",
            padding: "8px 18px",
            borderBottom: `1px solid ${LINE.quiet}`,
            fontSize: 11.5,
            color: ACCENT_TEXT.danger,
          }}
        >
          {state.storageError}
        </div>
      ) : null}

      <div style={{ flex: 1, minHeight: 0, overflow: "auto", paddingBottom: 8 }}>
        {rows.length === 0 ? (
          <EmptyState anyRuns={total > 0} />
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

function EmptyState({ anyRuns }: { anyRuns: boolean }) {
  return (
    <div style={{ padding: "34px 22px", maxWidth: 560, fontSize: 12, lineHeight: 1.6, color: TEXT.meta }}>
      {anyRuns ? (
        "Nothing matches. History keeps every run — command, output, and what it did."
      ) : (
        <>
          Nothing has been run yet. Every Deploy Console command and every SQL Runner query lands here
          the moment it finishes, with its output and what it changed.
          <div style={{ marginTop: 10, color: TEXT.faint }}>
            Kept in this browser, on this machine — it survives a reload and a redeploy, but it does not
            follow you to another machine and it is not the audit trail. The server keeps that on its own
            <span style={{ fontFamily: FONT.mono }}> admin.deploy </span>
            log channel.
          </div>
        </>
      )}
    </div>
  );
}

function Row({ entry, showDay, selected }: { entry: RunHistoryEntry; showDay: boolean; selected: boolean }) {
  const runs = runCount(entry.cmd);

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
            {repeatLabel(runs)}
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
