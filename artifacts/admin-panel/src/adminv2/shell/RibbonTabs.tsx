/**
 * Ribbon tab strip — 30px.
 *
 * Eight fixed tabs: five ordinary ones, then Git, Run and Build inside an amber
 * capsule that marks them as the developer set the way Office marks special tabs.
 * The contextual tab, when one is live, sits to the right behind a rule. The
 * "Search everything" capsule and the ribbon collapse chevron are pinned right.
 *
 * Clicking the tab that is already up collapses the ribbon; clicking any other
 * tab opens it. That is Office's behaviour and the prototype's.
 */

import type { CSSProperties } from "react";
import { ACCENT, FONT, LINE, METRICS, PRIMARY, SURFACE, TEXT, WASH } from "../theme";
import {
  DEV_TAB_IDS,
  FIXED_TAB_LABELS,
  MAIN_TAB_IDS,
  type ContextualTabSpec,
  type FixedTabId,
} from "../registry/types";
import { getLiveRibbonEntry, useLiveRibbonVersion } from "./liveRibbon";

export interface RibbonTabsProps {
  activeTab: FixedTabId;
  contextActive: boolean;
  ribbonOpen: boolean;
  contextualTab: ContextualTabSpec | null;
  onSelectTab: (tab: FixedTabId) => void;
  onSelectContextTab: () => void;
  onToggleRibbon: () => void;
  onOpenPalette: () => void;
}

function tabStyle(on: boolean, ribbonOpen: boolean, context: boolean, liveColor?: string): CSSProperties {
  return {
    padding: "0 13px",
    height: "100%",
    display: "flex",
    alignItems: "center",
    background: on && ribbonOpen ? SURFACE.app : "transparent",
    border: 0,
    borderRadius: "4px 4px 0 0",
    fontFamily: FONT.sans,
    fontSize: 12,
    whiteSpace: "nowrap",
    flex: "none",
    fontWeight: liveColor ? 700 : on ? 600 : 400,
    color: liveColor ?? (on ? TEXT.bright : context ? ACCENT.amber : "rgba(255,255,255,.66)"),
    cursor: "pointer",
    transition: "background 150ms, color 150ms",
    boxShadow: on && ribbonOpen ? `inset 0 2px 0 ${context ? ACCENT.amber : PRIMARY}` : "none",
  };
}

export function RibbonTabs({
  activeTab,
  contextActive,
  ribbonOpen,
  contextualTab,
  onSelectTab,
  onSelectContextTab,
  onToggleRibbon,
  onOpenPalette,
}: RibbonTabsProps) {
  useLiveRibbonVersion();

  return (
    <div
      style={{
        flex: "none",
        display: "flex",
        alignItems: "stretch",
        height: METRICS.ribbonTabs,
        background: SURFACE.chrome,
        padding: "0 6px",
        gap: 2,
      }}
    >
      <div
        data-noscrollbar="true"
        role="tablist"
        aria-label="Ribbon"
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          alignItems: "stretch",
          gap: 2,
          overflowX: "auto",
          overflowY: "hidden",
        }}
      >
        {MAIN_TAB_IDS.map((id) => {
          const on = !contextActive && activeTab === id;
          const overlay = getLiveRibbonEntry(`tab:${id}`);
          return (
            <button
              key={id}
              role="tab"
              aria-selected={on}
              className="av2-tab"
              onClick={() => onSelectTab(id)}
              style={tabStyle(on, ribbonOpen, false, overlay?.color)}
            >
              {overlay?.label ?? FIXED_TAB_LABELS[id]}
            </button>
          );
        })}

        {/* The developer set. Grouped visually, not functionally — Git and Run
            are ordinary fixed tabs that follow the same intent rule.
            Git and Build only work against a local dev checkout (raw git,
            GitHub-token sync) and are devOnly-gated screens (registry/types.ts)
            outside import.meta.env.DEV — their tab buttons would otherwise
            dead-end into an empty tab in production, so they are dropped from
            this list there too. Run stays in every environment: it hosts SQL
            Runner, which is used for real in production. */}
        <div
          style={{
            display: "flex",
            alignItems: "stretch",
            gap: 2,
            marginLeft: 6,
            padding: "0 3px",
            alignSelf: "center",
            height: 24,
            background: WASH.devCapsule,
            border: `1px solid ${WASH.devCapsuleBorder}`,
            borderRadius: 12,
          }}
        >
          {(import.meta.env.DEV ? DEV_TAB_IDS : DEV_TAB_IDS.filter((id) => id === "run")).map((id) => {
            const on = !contextActive && activeTab === id;
            return (
              <button
                key={id}
                role="tab"
                aria-selected={on}
                className="av2-tab"
                onClick={() => onSelectTab(id)}
                style={{
                  ...tabStyle(on, ribbonOpen, false),
                  height: "100%",
                  padding: "0 11px",
                  borderRadius: 11,
                  background: on && ribbonOpen ? "rgba(242,202,99,.18)" : "transparent",
                  color: on ? ACCENT.amber : "rgba(242,202,99,.72)",
                  boxShadow: "none",
                }}
              >
                {FIXED_TAB_LABELS[id]}
              </button>
            );
          })}
        </div>

        {contextualTab && (
          <div
            style={{
              display: "flex",
              alignItems: "stretch",
              gap: 2,
              paddingLeft: 8,
              marginLeft: 6,
              borderLeft: `1px solid ${LINE.control}`,
            }}
          >
            <button
              role="tab"
              aria-selected={contextActive}
              className="av2-tab"
              onClick={onSelectContextTab}
              style={tabStyle(contextActive, ribbonOpen, true)}
            >
              {contextualTab.label}
            </button>
          </div>
        )}
      </div>

      {/* Search everything. A button, not an input: focusing it opens the real
          palette, so there is exactly one search field in the app. */}
      <button
        onClick={onOpenPalette}
        title="Search everything (Ctrl K)"
        style={{
          flex: "none",
          alignSelf: "center",
          display: "flex",
          alignItems: "center",
          gap: 6,
          height: 22,
          padding: "0 8px",
          marginLeft: 8,
          background: SURFACE.well,
          border: `1px solid ${LINE.strong}`,
          borderRadius: 11,
          cursor: "pointer",
          fontFamily: FONT.sans,
        }}
      >
        <svg
          viewBox="0 0 24 24"
          width={12}
          height={12}
          fill="none"
          stroke={TEXT.quiet}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M13 2L4 14h7l-1 8 9-12h-7z" />
        </svg>
        <span
          style={{
            width: 170,
            textAlign: "left",
            fontSize: 11.5,
            color: TEXT.dimmer,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          Search everything
        </span>
        <span
          style={{
            flex: "none",
            whiteSpace: "nowrap",
            fontSize: 9.5,
            padding: "1px 4px",
            borderRadius: 3,
            background: WASH.chip,
            color: TEXT.dimmer,
          }}
        >
          Ctrl K
        </span>
      </button>

      <button
        className="av2-ghost"
        onClick={onToggleRibbon}
        title={ribbonOpen ? "Collapse the Ribbon" : "Expand the Ribbon"}
        aria-label={ribbonOpen ? "Collapse the Ribbon" : "Expand the Ribbon"}
        aria-expanded={ribbonOpen}
        style={{
          alignSelf: "center",
          width: 24,
          height: 22,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "transparent",
          border: 0,
          borderRadius: 4,
          color: "rgba(255,255,255,.65)",
          cursor: "pointer",
          flex: "none",
        }}
      >
        <svg
          viewBox="0 0 24 24"
          width={14}
          height={14}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ transform: `rotate(${ribbonOpen ? 0 : 180}deg)`, transition: "transform 200ms" }}
        >
          <path d="M6 15l6-6 6 6" />
        </svg>
      </button>
    </div>
  );
}
