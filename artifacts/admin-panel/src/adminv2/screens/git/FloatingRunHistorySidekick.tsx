/**
 * The Deploy Console's run-history sidekick — a second floating panel that
 * docks immediately to the console's left, showing Saved commands (pinned,
 * client-only — see `savedCommandsStore.ts`) above Recent ones (the real,
 * server-side `simulator_run_history` log this whole app already keeps,
 * filtered to deploy-kind runs).
 *
 * Rendered by `FloatingDeployConsole.tsx` as its own sibling, not nested
 * inside it, so it can sit outside the console's own `overflow: hidden` box.
 * It shares the console's `open` state — no point floating a companion panel
 * next to a console that is not there.
 *
 * Clicking a row runs it through the exact same path a typed command takes
 * (`rerunEntry` / `runTyped`) — this is a second way to reach the console,
 * not a second way to run something.
 */

import { useSyncExternalStore } from "react";
import { Bookmark, Play, X } from "lucide-react";
import { ACCENT, ACCENT_TEXT, LINE, SHADOW, SURFACE, TEXT, Z } from "../../theme";
import { getSnapshot as getDeploySnapshot, openConsole, runTyped, setInput, subscribe as subscribeDeploy } from "./deployStore";
import { getSnapshot as getHistorySnapshot, subscribe as subscribeHistory } from "../run-history/runHistoryStore";
import { rerunEntry } from "../run-history/runHistoryActions";
import { oneLine, whenLabel, type RunHistoryEntry } from "../run-history/runHistoryTypes";
import { getSavedCommands, isSaved, removeSavedCommand, saveCommand, subscribe as subscribeSaved, type SavedCommand } from "./savedCommandsStore";

const SIDEKICK_WIDTH = 260;
const CONSOLE_RIGHT = 16;
const CONSOLE_WIDTH = 620;
const GAP = 12;
const RECENT_LIMIT = 15;

export function FloatingRunHistorySidekick() {
  const deployState = useSyncExternalStore(subscribeDeploy, getDeploySnapshot);
  const historyState = useSyncExternalStore(subscribeHistory, getHistorySnapshot);
  const saved = useSyncExternalStore(subscribeSaved, getSavedCommands);

  if (!deployState.open) return null;

  const recent = historyState.entries.filter((e) => e.kind === "deploy").slice(0, RECENT_LIMIT);

  function runCommand(cmd: string): void {
    openConsole();
    setInput(cmd);
    runTyped();
  }

  return (
    <div
      role="complementary"
      aria-label="Deploy Console run history"
      style={{
        position: "fixed",
        right: CONSOLE_RIGHT + CONSOLE_WIDTH + GAP,
        bottom: 16,
        width: SIDEKICK_WIDTH,
        maxHeight: "calc(100vh - 80px)",
        height: 340,
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
            <EmptyNote>Star a run below to pin it here</EmptyNote>
          ) : (
            saved.map((s) => <SavedRow key={s.id} saved={s} onRun={() => runCommand(s.cmd)} />)
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <SectionLabel>Recent</SectionLabel>
          {recent.length === 0 ? (
            <EmptyNote>{historyState.tableMissing ? "Run history isn't set up yet" : "Nothing run yet"}</EmptyNote>
          ) : (
            recent.map((entry) => (
              <RecentRow
                key={entry.id}
                entry={entry}
                saved={isSaved(entry.cmd)}
                onRun={() => rerunEntry(entry)}
                onToggleSave={() => (isSaved(entry.cmd) ? removeByCmd(entry.cmd) : saveCommand(entry.cmd))}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function removeByCmd(cmd: string): void {
  const match = getSavedCommands().find((c) => c.cmd === cmd.trim());
  if (match) removeSavedCommand(match.id);
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

function RowShell({
  onRun, tone, children, trailing,
}: { onRun: () => void; tone?: string; children: React.ReactNode; trailing: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 4,
        borderRadius: 5, padding: "4px 2px 4px 4px",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = SURFACE.chrome; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      <button
        type="button"
        onClick={onRun}
        title="Run in the console"
        style={{
          display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0,
          background: "transparent", border: 0, padding: "2px 4px", cursor: "pointer", textAlign: "left",
        }}
      >
        <Play size={10} color={tone ?? ACCENT.info} style={{ flex: "none" }} />
        <span style={{ fontSize: 11, fontFamily: "Menlo, Consolas, monospace", color: TEXT.primary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {children}
        </span>
      </button>
      {trailing}
    </div>
  );
}

function SavedRow({ saved, onRun }: { saved: SavedCommand; onRun: () => void }) {
  return (
    <RowShell
      onRun={onRun}
      tone={ACCENT.amber}
      trailing={
        <button
          type="button"
          onClick={() => removeSavedCommand(saved.id)}
          title="Remove from Saved"
          style={{ flex: "none", display: "flex", background: "transparent", border: 0, padding: 3, cursor: "pointer", color: TEXT.meta, borderRadius: 3 }}
          onMouseEnter={(e) => { e.currentTarget.style.color = ACCENT_TEXT.danger; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = TEXT.meta; }}
        >
          <X size={11} />
        </button>
      }
    >
      {oneLine(saved.cmd)}
    </RowShell>
  );
}

function RecentRow({
  entry, saved, onRun, onToggleSave,
}: { entry: RunHistoryEntry; saved: boolean; onRun: () => void; onToggleSave: () => void }) {
  const tone = entry.ok ? undefined : ACCENT.danger;
  return (
    <div>
      <RowShell
        onRun={onRun}
        tone={tone}
        trailing={
          <button
            type="button"
            onClick={onToggleSave}
            title={saved ? "Saved — click to unsave" : "Save this command"}
            style={{
              flex: "none", display: "flex", background: "transparent", border: 0, padding: 3,
              cursor: "pointer", borderRadius: 3, color: saved ? ACCENT.amber : TEXT.meta,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = ACCENT.amber; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = saved ? ACCENT.amber : TEXT.meta; }}
          >
            <Bookmark size={11} fill={saved ? ACCENT.amber : "none"} />
          </button>
        }
      >
        {oneLine(entry.cmd)}
      </RowShell>
      <div style={{ fontSize: 9.5, color: TEXT.faint, margin: "0 0 2px 24px" }}>
        {whenLabel(entry.startedAt)}{!entry.ok ? " · failed" : ""}
      </div>
    </div>
  );
}
