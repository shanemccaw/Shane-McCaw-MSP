/**
 * The SQL Console's run-history sidekick — a second floating panel docked
 * immediately to the console's left, mirroring
 * `screens/git/FloatingRunHistorySidekick.tsx` for the SQL side: Saved
 * scripts (the screen's own real, server-side `saved_sql_scripts` — not a
 * client-only pinboard like the Deploy Console's, since SQL Runner already
 * has a persisted save) above Recent (the real `simulator_run_history` log,
 * filtered to `kind === "sql"`).
 *
 * Rendered by `FloatingSqlConsole.tsx` as its own sibling, not nested inside
 * it, so it can sit outside the console's own `overflow: hidden` box. Shares
 * the console's `floatingOpen` state — no point floating a companion panel
 * next to a console that is not there — and its live `floatingWidth`, since
 * the console is resizable now (a real multi-line editor, not the single-line
 * input it started as) and a hardcoded offset would drift out of alignment
 * the moment someone drags it wider or narrower.
 *
 * Clicking a Saved row runs it through `runFloatingQuery` — the exact same
 * execution path the console's own input takes. Clicking a Recent row goes
 * through `rerunEntry`, same as the full Run History screen and its Deploy
 * counterpart — a migration re-run still gets its own confirm there, so it is
 * never silently re-fired from this shortcut.
 */

import { useSyncExternalStore } from "react";
import { Play } from "lucide-react";
import { ACCENT, LINE, SHADOW, SURFACE, TEXT, Z } from "../../theme";
import { getSnapshot as getSqlSnapshot, runFloatingQuery, subscribe as subscribeSql } from "./sqlStore";
import { getSnapshot as getHistorySnapshot, subscribe as subscribeHistory } from "../run-history/runHistoryStore";
import { rerunEntry } from "../run-history/runHistoryActions";
import { oneLine, whenLabel, type RunHistoryEntry } from "../run-history/runHistoryTypes";

const SIDEKICK_WIDTH = 260;
const CONSOLE_RIGHT = 16;
const GAP = 12;
const SAVED_LIMIT = 8;
const RECENT_LIMIT = 15;

export function FloatingSqlHistorySidekick() {
  const sqlState = useSyncExternalStore(subscribeSql, getSqlSnapshot);
  const historyState = useSyncExternalStore(subscribeHistory, getHistorySnapshot);

  if (!sqlState.floatingOpen) return null;

  const saved = sqlState.scripts.slice(0, SAVED_LIMIT);
  const recent = historyState.entries.filter((e) => e.kind === "sql").slice(0, RECENT_LIMIT);

  return (
    <div
      role="complementary"
      aria-label="SQL Console run history"
      style={{
        position: "fixed",
        right: CONSOLE_RIGHT + sqlState.floatingWidth + GAP,
        bottom: 16,
        width: SIDEKICK_WIDTH,
        maxHeight: "calc(100vh - 80px)",
        height: sqlState.floatingHeight,
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
          padding: "0 10px",
          borderBottom: `1px solid ${LINE.base}`,
          background: SURFACE.chrome,
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 700, color: TEXT.bright }}>Runs</span>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 8, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <SectionLabel>Saved</SectionLabel>
          {saved.length === 0 ? (
            <EmptyNote>Saved scripts from the SQL Runner show up here</EmptyNote>
          ) : (
            saved.map((sc) => (
              <RowShell key={sc.id} onRun={() => void runFloatingQuery(sc.query)} tone={sc.isDestructive ? ACCENT.danger : undefined}>
                {sc.name}
              </RowShell>
            ))
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <SectionLabel>Recent</SectionLabel>
          {recent.length === 0 ? (
            <EmptyNote>{historyState.tableMissing ? "Run history isn't set up yet" : "Nothing run yet"}</EmptyNote>
          ) : (
            recent.map((entry) => <RecentRow key={entry.id} entry={entry} onRun={() => rerunEntry(entry)} />)
          )}
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: TEXT.caption, margin: "2px 2px 2px" }}>
      {children}
    </p>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 11, color: TEXT.meta, margin: "0 2px 4px", lineHeight: 1.4 }}>{children}</p>;
}

function RowShell({ onRun, tone, children }: { onRun: () => void; tone?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onRun}
      title="Run in the console"
      style={{
        display: "flex", alignItems: "center", gap: 6, width: "100%",
        background: "transparent", border: 0, borderRadius: 5, padding: "4px 4px", cursor: "pointer", textAlign: "left",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = SURFACE.chrome; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      <Play size={10} color={tone ?? ACCENT.info} style={{ flex: "none" }} />
      <span style={{ flex: 1, minWidth: 0, fontSize: 11, fontFamily: "Menlo, Consolas, monospace", color: TEXT.primary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {children}
      </span>
    </button>
  );
}

function RecentRow({ entry, onRun }: { entry: RunHistoryEntry; onRun: () => void }) {
  const tone = entry.ok ? undefined : ACCENT.danger;
  return (
    <div>
      <RowShell onRun={onRun} tone={tone}>
        {oneLine(entry.migrationFile ?? entry.cmd)}
      </RowShell>
      <div style={{ fontSize: 9.5, color: TEXT.faint, margin: "0 0 2px 20px" }}>
        {whenLabel(entry.startedAt)}{!entry.ok ? " · failed" : ""}
      </div>
    </div>
  );
}
