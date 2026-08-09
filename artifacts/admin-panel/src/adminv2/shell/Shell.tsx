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
import { LINE, SURFACE, TEXT } from "../theme";
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
 * What the centre column shows when the route matches no registered screen.
 *
 * Deliberately points at Ctrl K rather than offering links: there is no left
 * navigation to fall back on, and the palette is the answer to "where is
 * everything".
 */
export function NoScreen() {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        padding: 40,
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 700, color: TEXT.primary }}>Nothing open</div>
      <div style={{ fontSize: 12.5, color: TEXT.caption, textWrap: "pretty" }}>
        Press Ctrl K and type what you want.
      </div>
    </div>
  );
}
