/**
 * The shell — assembles all the chrome around whatever screen is active.
 *
 * Layout, top to bottom: title bar, ribbon tabs, ribbon body, then the
 * workspace. The workspace is left panel · centre · right panel, and the bottom
 * dock lives *inside* the centre column so it does not run under the side
 * panels — matching the prototype, and meaning a collapsed Explorer gives its
 * width to the screen rather than to the log.
 */

import { useMemo, useState, type ReactNode } from "react";
import { Compass, Search } from "lucide-react";
import { useShell } from "./ShellContext";
import { TitleBar, type TitleBarProps } from "./TitleBar";
import { RibbonTabs } from "./RibbonTabs";
import { RibbonBody } from "./RibbonBody";
import { DocTabStrip } from "./DocTabStrip";
import { SidePanel } from "./SidePanel";
import { BottomPanel } from "./BottomPanel";
import { CommandPalette } from "./CommandPalette";
import { Peek } from "./Peek";
import { Gallery } from "./Gallery";
import { StatusBar, type StatusSegment } from "./StatusBar";
import { ACCENT, FONT, KIND_BADGE, KIND_BADGE_FALLBACK, LINE, SURFACE, TEXT } from "../theme";
import { getScreen, resolvePeek } from "../registry/registry";
import { defaultKind } from "../command/paletteQuery";
import type { TrailEntry } from "../registry/ribbonAssembly";
import "./shell.css";

export interface ShellProps extends Omit<TitleBarProps, "productName" | "mark"> {
  productName?: string;
  mark?: string;
  /** Bottom status bar segments. Supplied by the app, not by screens. */
  statusLeft?: StatusSegment[];
  statusRight?: StatusSegment[];
  /** Rendered in the centre column. Normally the active screen. */
  children: ReactNode;
}

export function Shell({
  productName = "Simulator Studio",
  mark = "SM",
  statusLeft,
  statusRight,
  children,
  ...titleBar
}: ShellProps) {
  const {
    state,
    dispatch,
    activeScreen,
    ribbonGroups,
    contextualTab,
    peekModel,
    commandIndex,
    runCommand,
    activateDoc,
  } = useShell();

  // A record doc can be open on a screen that declares no contextual tab, and
  // closeDoc leaves contextActive set while a screen doc remains. Passing the
  // raw flag to the tab strip then suppresses every fixed tab (on = !contextActive)
  // while the body still renders that fixed tab groups, so nothing looks selected.
  // The strip and the body must agree on one value.
  const contextSelected = state.contextActive && !!contextualTab;

  // Rebuilt on every open rather than memoised across opens: `?` rows carry
  // live numbers, and a cached profit figure is worse than none.
  const items = useMemo(
    () => (state.paletteOpen ? commandIndex() : []),
    [state.paletteOpen, commandIndex],
  );

  const bottomTabs = activeScreen?.bottom ?? [];

  return (
    <div
      className="av2 dark"
      style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}
    >
      <TitleBar productName={productName} mark={mark} {...titleBar} />

      <RibbonTabs
        activeTab={state.activeTab}
        contextActive={contextSelected}
        ribbonOpen={state.ribbonOpen}
        contextualTab={contextualTab}
        onSelectTab={(tab) => dispatch({ type: "selectTab", tab })}
        onSelectContextTab={() => dispatch({ type: "selectContextTab" })}
        onToggleRibbon={() => dispatch({ type: "toggleRibbon" })}
        onOpenPalette={() => dispatch({ type: "openPalette" })}
      />

      <RibbonBody
        open={state.ribbonOpen}
        groups={ribbonGroups}
        onOpenGallery={(spec, anchor) => dispatch({ type: "openGallery", spec, anchor })}
      />

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          alignItems: "stretch",
          borderTop: `1px solid ${LINE.group}`,
        }}
      >
        <SidePanel
          side="left"
          open={state.left}
          width={state.leftWidth}
          title={activeScreen?.left?.title ?? "Start Something"}
          dragging={state.drag === "left"}
          onToggle={() => dispatch({ type: "togglePanel", panel: "left" })}
          onResize={(size) => dispatch({ type: "setPanelSize", panel: "left", size })}
          onDragStart={() => dispatch({ type: "startDrag", panel: "left" })}
          onDragEnd={() => dispatch({ type: "endDrag" })}
        >
          {activeScreen?.left ? activeScreen.left.render() : <StartSomethingExplorer />}
        </SidePanel>

        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <DocTabStrip
            docs={state.docs}
            activeDocId={state.activeDocId}
            onActivate={activateDoc}
            onClose={(id) => dispatch({ type: "closeDoc", id })}
            onCloseOthers={(id) => dispatch({ type: "closeOtherDocs", id })}
            onCloseAll={() => dispatch({ type: "closeAllDocs" })}
          />

          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              alignItems: "stretch",
              background: SURFACE.app,
              overflow: "auto",
            }}
          >
            {children}
          </div>

          <BottomPanel
            open={state.bottom}
            height={state.bottomHeight}
            tabs={bottomTabs}
            activeTabId={state.bottomTabId}
            dragging={state.drag === "bottom"}
            onSelectTab={(id) => dispatch({ type: "setBottomTab", id })}
            onToggle={() => dispatch({ type: "togglePanel", panel: "bottom" })}
            onResize={(size) => dispatch({ type: "setPanelSize", panel: "bottom", size })}
            onDragStart={() => dispatch({ type: "startDrag", panel: "bottom" })}
            onDragEnd={() => dispatch({ type: "endDrag" })}
          />
        </div>

        <SidePanel
          side="right"
          open={state.right}
          width={state.rightWidth}
          title={activeScreen?.right?.title ?? "Properties"}
          dragging={state.drag === "right"}
          onToggle={() => dispatch({ type: "togglePanel", panel: "right" })}
          onResize={(size) => dispatch({ type: "setPanelSize", panel: "right", size })}
          onDragStart={() => dispatch({ type: "startDrag", panel: "right" })}
          onDragEnd={() => dispatch({ type: "endDrag" })}
        >
          {activeScreen?.right ? activeScreen.right.render() : null}
        </SidePanel>
      </div>

      <StatusBar left={statusLeft} right={statusRight} />

      {state.gallery && (
        <Gallery
          spec={state.gallery.spec}
          anchor={state.gallery.anchor}
          onClose={() => dispatch({ type: "closeGallery" })}
        />
      )}

      <CommandPalette
        open={state.paletteOpen}
        query={state.paletteQuery}
        items={items}
        currentArea={activeScreen?.area}
        recentIds={state.recentCommandIds}
        onQueryChange={(query) => dispatch({ type: "setPaletteQuery", query })}
        onRun={runCommand}
        onClose={() => dispatch({ type: "closePalette" })}
      />

      <Peek
        // Remounted per record so the edit drafts inside it reset cleanly.
        key={state.peek ? `${state.peek.kind}:${state.peek.id}` : "none"}
        model={state.peek ? peekModel : null}
        armedActionLabel={state.peekArmedAction}
        onArm={(label) => dispatch({ type: "armPeekAction", label })}
        onClose={() => dispatch({ type: "closePeek" })}
      />
    </div>
  );
}

/**
 * Resolves a trail entry's icon and colour from the real record it points
 * at — never a hand-maintained kind→icon table. A screen destination uses
 * its own registered icon; a record reuses the exact icon and tone its own
 * peek already declares, via `resolvePeek`, so this can never disagree with
 * what opening the record actually shows. Falls back to a neutral compass
 * only when the record is genuinely gone (deleted since it was opened).
 */
function trailGlyph(entry: TrailEntry): { icon: typeof Compass; color: string } {
  if (entry.kind === "screen") {
    const screen = getScreen(entry.id);
    return { icon: screen?.icon ?? Compass, color: TEXT.dim };
  }
  const model = resolvePeek(entry.kind, entry.id);
  return { icon: model?.icon ?? Compass, color: model?.tone ?? ACCENT.info };
}

const rowStyle = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  padding: "9px 12px",
  borderRadius: 6,
  border: `1px solid ${LINE.base}`,
  background: SURFACE.card,
  color: "inherit",
  font: "inherit",
  cursor: "pointer",
  textAlign: "left" as const,
};

import { useSyncExternalStore } from "react";
import {
  subscribe, getSnapshot, unlinkedChats, setTriageActive,
} from "../screens/build-tracker/buildTrackerStore";
import { getShellApi } from "./ShellContext";

export function StartSomethingExplorer() {
  const { commandIndex, runCommand, openPalette } = useShell();
  const [filter, setFilter] = useState("");
  const items = commandIndex().filter((item) => item.type === "action" || item.type === "destination");

  const filtered = items.filter((item) => {
    if (!filter.trim()) return true;
    return item.name.toLowerCase().includes(filter.trim().toLowerCase());
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "8px 10px", borderBottom: `1px solid ${LINE.control}`, background: SURFACE.well }}>
        <input
          placeholder="Filter actions & destinations..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{
            width: "100%", padding: "5px 8px", borderRadius: 4,
            background: SURFACE.card, border: `1px solid ${LINE.quiet}`,
            color: TEXT.primary, fontSize: 11.5, fontFamily: FONT.sans, outline: "none",
          }}
        />
      </div>

      <div style={{ padding: "8px 6px", display: "flex", flexDirection: "column", gap: 4, overflowY: "auto", flex: 1 }}>
        <button
          onClick={() => openPalette()}
          style={{
            display: "flex", alignItems: "center", gap: 8, padding: "8px 10px",
            background: `${ACCENT.info}15`, border: `1px solid ${ACCENT.info}30`,
            borderRadius: 6, cursor: "pointer", color: ACCENT.info, fontSize: 12, fontWeight: 600,
            fontFamily: FONT.sans, width: "100%", textAlign: "left", marginBottom: 4,
          }}
        >
          <Search size={14} /> Search Everything (Ctrl K)
        </button>

        <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: TEXT.caption, padding: "4px 6px" }}>
          Start Something ({filtered.length})
        </span>

        {filtered.map((item) => {
          const [color, badge] = KIND_BADGE[item.kind ?? defaultKind(item)] ?? KIND_BADGE_FALLBACK;
          return (
            <button
              key={item.id}
              onClick={() => runCommand(item)}
              style={{
                display: "flex", alignItems: "center", gap: 8, padding: "6px 8px",
                background: SURFACE.well, border: `1px solid ${LINE.control}`,
                borderRadius: 5, cursor: "pointer", textAlign: "left", width: "100%",
                fontFamily: FONT.sans, transition: "border-color 150ms",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = ACCENT.info; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = LINE.control; }}
            >
              <span style={{ fontSize: 9, fontWeight: 800, color, fontFamily: FONT.mono, flexShrink: 0 }}>
                {badge}
              </span>
              <span style={{ flex: 1, fontSize: 12, color: TEXT.primary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {item.name}
              </span>
              <span style={{ fontSize: 10, color: TEXT.dim }}>↗</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

import * as sqlStore from "../screens/sql/sqlStore";
import * as deployStore from "../screens/git/deployStore";
import { findDeployOperation } from "../screens/git/deployOperations";
import * as inboxStore from "../screens/inbox/inboxStore";
import * as marketingStore from "../screens/marketing/marketingStore";

/**
 * What the centre column shows when nothing is open — the bare `/adminv2`
 * root, or after closing the last doc.
 */
export function NoScreen() {
  const { state } = useShell();
  const buildState = useSyncExternalStore(subscribe, getSnapshot);
  const sqlState = useSyncExternalStore(sqlStore.subscribe, sqlStore.getSnapshot);
  const deployState = useSyncExternalStore(deployStore.subscribe, deployStore.getSnapshot);
  const inboxState = useSyncExternalStore(inboxStore.subscribe, inboxStore.getSnapshot);
  const marketingState = useSyncExternalStore(marketingStore.subscribe, marketingStore.getSnapshot);

  const [executingMigration, setExecutingMigration] = useState<string | null>(null);
  const [migrationDone, setMigrationDone] = useState<string | null>(null);

  const recents = state.trail.slice(0, 8);
  const epics = Array.isArray(buildState?.epics) ? buildState.epics : [];
  const issues = Array.isArray(buildState?.issues) ? buildState.issues : [];
  const milestones = Array.isArray(buildState?.milestones) ? buildState.milestones : [];

  const unlinked = unlinkedChats().length;
  const noEpicIssues = issues.filter((i) => i.epicId === null && i.status !== "closed" && i.status !== "done").length;
  const inProgressEpics = epics.filter((e) => e.status === "in_progress").length;
  const inProgressIssues = issues.filter((i) => i.status === "in_progress").length;
  const inProgressTotal = inProgressEpics + inProgressIssues;
  const activeMilestones = milestones.filter((m) => m.status !== "closed");

  const pendingMigrations = sqlState.migrations.filter((m) => !m.ranAt);
  const activeCampaigns = marketingState.campaigns.filter((c) => c.status === "active" || c.status === "draft");

  async function handleRunMigration(filename: string) {
    setExecutingMigration(filename);
    try {
      await sqlStore.runMigrationFile(filename);
      setMigrationDone(filename);
      setTimeout(() => setMigrationDone(null), 3000);
    } catch {
      /* handled in store */
    } finally {
      setExecutingMigration(null);
    }
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto", display: "flex", justifyContent: "center", padding: "36px 24px" }}>
      <div style={{ width: "100%", maxWidth: 840, display: "flex", flexDirection: "column", gap: 24 }}>
        
        {/* Title Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${LINE.quiet}`, paddingBottom: 16 }}>
          <div>
            <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: ACCENT.amber }}>
              ADHD Command Center
            </span>
            <h1 style={{ margin: "2px 0 0", fontSize: 22, fontWeight: 800, color: TEXT.bright }}>
              Pickup where you left off
            </h1>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: TEXT.dim }}>
              Live system rollup. Everything below opens in 1 click.
            </p>
          </div>

          <button
            onClick={() => getShellApi()?.openDoc({ kind: "screen", id: "build-tracker", screenId: "build-tracker", label: "Build Tracker" })}
            style={{
              padding: "8px 16px", borderRadius: 6, border: 0,
              background: ACCENT.info, color: SURFACE.well, fontSize: 13, fontWeight: 700,
              cursor: "pointer", fontFamily: FONT.sans, display: "flex", alignItems: "center", gap: 6,
            }}
          >
            🚀 Open Build Studio
          </button>
        </div>

        {/* 2 Column Rollup Grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 20, alignItems: "start" }}>
          
          {/* Left Column: Recent Work (Where You Were) */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ padding: 16, background: SURFACE.card, borderRadius: 8, border: `1px solid ${LINE.quiet}`, display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: ACCENT.info }}>
                  🕒 Recent Work (Jump Back)
                </span>
                <span style={{ fontSize: 10.5, color: TEXT.dim }}>{recents.length} recent places</span>
              </div>

              {recents.length === 0 ? (
                <div style={{ fontSize: 12.5, color: TEXT.caption, padding: "8px 0" }}>
                  Nothing yet. Press Ctrl K and type what you want to open.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {recents.map((entry) => {
                    const { icon: Icon, color } = trailGlyph(entry);
                    return (
                      <button
                        key={`${entry.kind}:${entry.id}`}
                        type="button"
                        className="av2-card"
                        onClick={entry.open}
                        style={{
                          display: "flex", alignItems: "center", gap: 10, padding: "9px 12px",
                          background: SURFACE.well, borderRadius: 6, border: `1px solid ${LINE.control}`,
                          cursor: "pointer", textAlign: "left", width: "100%", fontFamily: FONT.sans,
                          transition: "border-color 150ms",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = ACCENT.info; }}
                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = LINE.control; }}
                      >
                        <Icon size={15} color={color} style={{ flexShrink: 0 }} />
                        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12.5, fontWeight: 600, color: TEXT.primary }}>
                          {entry.label}
                        </span>
                        <span style={{ flexShrink: 0, fontSize: 10.5, color: TEXT.dim, textTransform: "uppercase", fontWeight: 700 }}>
                          {entry.kind} ↗
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Live Attention Rollup */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Attention Rollup Card */}
            <div style={{ padding: 16, background: SURFACE.card, borderRadius: 8, border: `1px solid ${LINE.quiet}`, display: "flex", flexDirection: "column", gap: 14 }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: ACCENT.amber }}>
                ⚡ Attention Rollup & Signals
              </span>

              {/* Build Triage Item */}
              <div
                onClick={() => {
                  setTriageActive(true);
                  getShellApi()?.openDoc({ kind: "screen", id: "build-tracker", screenId: "build-tracker", label: "Build Tracker" });
                }}
                style={{
                  padding: 12, borderRadius: 6, background: SURFACE.well, border: `1px solid ${LINE.control}`,
                  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 16 }}>🧹</span>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: TEXT.primary }}>
                      {unlinked} unlinked chats & {noEpicIssues} unassigned issues
                    </span>
                    <span style={{ fontSize: 11, color: TEXT.caption }}>
                      Click to launch 1-click Triage Mode
                    </span>
                  </div>
                </div>
                <span style={{ fontSize: 11, color: ACCENT.amber, fontWeight: 700 }}>Triage ↗</span>
              </div>

              {/* In-Progress Work Item */}
              <div
                onClick={() => getShellApi()?.openDoc({ kind: "screen", id: "build-tracker", screenId: "build-tracker", label: "Build Tracker" })}
                style={{
                  padding: 12, borderRadius: 6, background: SURFACE.well, border: `1px solid ${LINE.control}`,
                  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 16 }}>🔥</span>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: TEXT.primary }}>
                      {inProgressTotal} active items in progress
                    </span>
                    <span style={{ fontSize: 11, color: TEXT.caption }}>
                      {inProgressEpics} epics · {inProgressIssues} issues active
                    </span>
                  </div>
                </div>
                <span style={{ fontSize: 11, color: ACCENT.info, fontWeight: 700 }}>View ↗</span>
              </div>

              {/* Milestones Roadmap Rollup */}
              <div
                onClick={() => getShellApi()?.openDoc({ kind: "screen", id: "project-management", screenId: "project-management", label: "Milestones & Roadmap" })}
                style={{
                  padding: 12, borderRadius: 6, background: SURFACE.well, border: `1px solid ${LINE.control}`,
                  cursor: "pointer", display: "flex", flexDirection: "column", gap: 6,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 16 }}>🎯</span>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: TEXT.primary }}>
                      {activeMilestones.length} active GitHub milestones
                    </span>
                  </div>
                  <span style={{ fontSize: 11, color: ACCENT.amber, fontWeight: 700 }}>Gantt ↗</span>
                </div>
                {activeMilestones.slice(0, 2).map((m) => (
                  <div key={m.id} style={{ fontSize: 11, color: TEXT.caption, display: "flex", justifyContent: "space-between", paddingLeft: 24 }}>
                    <span>#{m.githubNumber ?? m.id} {m.title}</span>
                    <span>{m.targetDate ? m.targetDate : "No date"}</span>
                  </div>
                ))}
              </div>

              {/* SQL Script Migrations Rollup */}
              <div
                style={{
                  padding: 12, borderRadius: 6, background: SURFACE.well, border: `1px solid ${LINE.control}`,
                  display: "flex", flexDirection: "column", gap: 8,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 16 }}>🛠️</span>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: TEXT.primary }}>
                      {sqlState.migrations.length} DB Migration Scripts
                    </span>
                  </div>
                  <button
                    onClick={() => getShellApi()?.openDoc({ kind: "screen", id: "sql", screenId: "sql", label: "SQL Runner" })}
                    style={{ background: "transparent", border: 0, padding: 0, fontSize: 11, color: ACCENT.info, fontWeight: 700, cursor: "pointer", fontFamily: FONT.sans }}
                  >
                    SQL Console ↗
                  </button>
                </div>

                {sqlState.migrations.slice(0, 3).map((m) => {
                  const isDone = migrationDone === m.filename;
                  const isBusy = executingMigration === m.filename;
                  return (
                    <div key={m.filename} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, background: SURFACE.card, padding: "5px 8px", borderRadius: 4, border: `1px solid ${LINE.quiet}` }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: TEXT.soft, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                        {m.filename}
                      </span>
                      <button
                        onClick={() => void handleRunMigration(m.filename)}
                        disabled={isBusy}
                        style={{
                          padding: "3px 8px", borderRadius: 4, border: 0,
                          background: isDone ? ACCENT.green : ACCENT.info,
                          color: SURFACE.well, fontSize: 10.5, fontWeight: 700, cursor: isBusy ? "default" : "pointer",
                          fontFamily: FONT.sans, opacity: isBusy ? 0.6 : 1, flexShrink: 0,
                        }}
                      >
                        {isDone ? "✓ Executed!" : isBusy ? "Running..." : "▶ Run Script"}
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Git & Deploy Sync Card */}
              <div
                style={{
                  padding: 12, borderRadius: 6, background: SURFACE.well, border: `1px solid ${LINE.control}`,
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 16 }}>🐙</span>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: TEXT.primary }}>
                      Git & Deployment Console
                    </span>
                    <span style={{ fontSize: 11, color: TEXT.caption }}>
                      1-click pull latest changes from remote
                    </span>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    onClick={() => {
                      const op = findDeployOperation("git-pull");
                      if (op) deployStore.runOperation(op);
                    }}
                    style={{
                      padding: "4px 8px", borderRadius: 4, border: 0,
                      background: ACCENT.green, color: SURFACE.well, fontSize: 11, fontWeight: 700,
                      cursor: "pointer", fontFamily: FONT.sans,
                    }}
                  >
                    ⚡ Git Pull
                  </button>
                  <button
                    onClick={() => getShellApi()?.openDoc({ kind: "screen", id: "git", screenId: "git", label: "Git Console" })}
                    style={{
                      padding: "4px 8px", borderRadius: 4, border: `1px solid ${LINE.quiet}`,
                      background: SURFACE.card, color: TEXT.primary, fontSize: 11, fontWeight: 600,
                      cursor: "pointer", fontFamily: FONT.sans,
                    }}
                  >
                    Git ↗
                  </button>
                </div>
              </div>

              {/* Inbox & Marketing Quick Rollup */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div
                  onClick={() => getShellApi()?.openDoc({ kind: "screen", id: "inbox", screenId: "inbox", label: "Inbox" })}
                  style={{
                    padding: 10, borderRadius: 6, background: SURFACE.well, border: `1px solid ${LINE.control}`,
                    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 14 }}>📬</span>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: TEXT.primary }}>Inbox</span>
                  </div>
                  <span style={{ fontSize: 10.5, color: ACCENT.info, fontWeight: 700 }}>Open ↗</span>
                </div>

                <div
                  onClick={() => getShellApi()?.openDoc({ kind: "screen", id: "ad", screenId: "ad", label: "Marketing" })}
                  style={{
                    padding: 10, borderRadius: 6, background: SURFACE.well, border: `1px solid ${LINE.control}`,
                    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 14 }}>📢</span>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: TEXT.primary }}>Marketing</span>
                  </div>
                  <span style={{ fontSize: 10.5, color: ACCENT.info, fontWeight: 700 }}>View ↗</span>
                </div>
              </div>

            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
