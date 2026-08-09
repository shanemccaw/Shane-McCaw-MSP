/**
 * The shell — assembles all the chrome around whatever screen is active.
 *
 * Layout, top to bottom: title bar, ribbon tabs, ribbon body, then the
 * workspace. The workspace is left panel · centre · right panel, and the bottom
 * dock lives *inside* the centre column so it does not run under the side
 * panels — matching the prototype, and meaning a collapsed Explorer gives its
 * width to the screen rather than to the log.
 */

import { useMemo, type ReactNode } from "react";
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
import { ACCENT, KIND_BADGE, KIND_BADGE_FALLBACK, LINE, SURFACE, TEXT } from "../theme";
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
          title={activeScreen?.left?.title ?? "Explorer"}
          dragging={state.drag === "left"}
          onToggle={() => dispatch({ type: "togglePanel", panel: "left" })}
          onResize={(size) => dispatch({ type: "setPanelSize", panel: "left", size })}
          onDragStart={() => dispatch({ type: "startDrag", panel: "left" })}
          onDragEnd={() => dispatch({ type: "endDrag" })}
        >
          {activeScreen?.left ? activeScreen.left.render() : null}
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

/**
 * What the centre column shows when nothing is open — the bare `/adminv2`
 * root, or after closing the last doc. handoff.md principle 3 ("a one-off
 * task should not move you off what you were doing") is why this exists at
 * all: coming back to nothing should not mean re-deriving where you were
 * from memory.
 *
 * Two real, live sources, nothing invented: `state.trail` (already tracked
 * for the Back group, so "Recent" costs nothing new) and the palette's own
 * `action`-type commands, via `commandIndex()` — the same list `?`/`>` search
 * against, so a quick-start button can never offer something the palette
 * itself would refuse to run.
 */
export function NoScreen() {
  const { state, commandIndex, runCommand, openPalette } = useShell();
  const recents = state.trail.slice(0, 6);
  const actions = commandIndex().filter((item) => item.type === "action");

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto", display: "flex", justifyContent: "center", padding: "48px 24px" }}>
      <div style={{ width: "100%", maxWidth: 520, display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-.01em", color: TEXT.bright }}>
            Pick up where you left off
          </span>
          <span style={{ fontSize: 12.5, color: TEXT.caption }}>
            Nothing is open. Everything below opens in one click.
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: TEXT.meta }}>
            Recent
          </span>
          {recents.length === 0 ? (
            <div style={{ fontSize: 12.5, color: TEXT.caption, padding: "9px 12px" }}>
              Nothing yet. Press Ctrl K and type what you want.
            </div>
          ) : (
            recents.map((entry) => {
              const { icon: Icon, color } = trailGlyph(entry);
              return (
                <button
                  key={`${entry.kind}:${entry.id}`}
                  type="button"
                  className="av2-card"
                  onClick={entry.open}
                  style={rowStyle}
                >
                  <Icon size={15} color={color} style={{ flexShrink: 0 }} />
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      fontSize: 12.5,
                      color: TEXT.body,
                    }}
                  >
                    {entry.label}
                  </span>
                  <span style={{ flexShrink: 0, fontSize: 11, color: TEXT.meta }}>{entry.kind}</span>
                </button>
              );
            })
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: TEXT.meta }}>
            Start something
          </span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="av2-card"
              onClick={() => openPalette()}
              style={{ ...rowStyle, width: "auto", gap: 7, padding: "8px 13px" }}
            >
              <Search size={14} color={ACCENT.info} style={{ flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: TEXT.soft, whiteSpace: "nowrap" }}>Search everything</span>
            </button>
            {actions.map((item) => {
              const [color, badge] = KIND_BADGE[item.kind ?? defaultKind(item)] ?? KIND_BADGE_FALLBACK;
              return (
                <button
                  key={item.id}
                  type="button"
                  className="av2-card"
                  onClick={() => runCommand(item)}
                  style={{ ...rowStyle, width: "auto", gap: 7, padding: "8px 13px" }}
                >
                  <span style={{ flexShrink: 0, fontSize: 9.5, fontWeight: 800, letterSpacing: ".04em", color, fontFamily: "Menlo, Consolas, monospace" }}>
                    {badge}
                  </span>
                  <span style={{ fontSize: 12, color: TEXT.soft, whiteSpace: "nowrap" }}>{item.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
