/**
 * The shell's own ribbon groups.
 *
 * These are not a screen's. They are the commands that belong to the window
 * itself — showing and hiding the docked panels, and reaching the palette — so
 * they are contributed here rather than through `registerScreen`, and they
 * always sort first on their tab.
 *
 * Everything here is `open` or `global` intent, which is what a fixed tab is
 * allowed to carry.
 */

import { PanelBottom, PanelLeft, PanelRight, Search, Rows3, GitBranch, Flag, RefreshCw } from "lucide-react";
import { ACCENT } from "../theme";
import type { FixedTabId, RibbonGroup } from "../registry/types";
import { getShellApi } from "./ShellContext";
import { syncFromGitHub } from "../screens/build-tracker/buildTrackerStore";

export interface ShellRibbonDeps {
  left: boolean;
  right: boolean;
  bottom: boolean;
  ribbonOpen: boolean;
  hasBottomTabs: boolean;
  togglePanel: (panel: "left" | "right" | "bottom") => void;
  toggleRibbon: () => void;
  openPalette: () => void;
  /** Caption the active screen gives its left panel, so the button names the real thing. */
  leftTitle: string;
  rightTitle: string;
}

export function shellGroupsForTab(tab: FixedTabId, deps: ShellRibbonDeps): RibbonGroup[] {
  if (tab === "home") {
    return [
      {
        label: "Find",
        large: [
          {
            label: "Search everything",
            icon: Search,
            intent: "open",
            onSelect: deps.openPalette,
            color: ACCENT.info,
            title: "Search everything (Ctrl K)",
          },
        ],
      },
      {
        label: "Build Studio",
        large: [
          {
            label: "Build Tracker",
            icon: GitBranch,
            intent: "open",
            color: ACCENT.info,
            onSelect: () => getShellApi()?.navigate("/build-tracker"),
            title: "Open Build Tracker",
          },
          {
            label: "Roadmap & Milestones",
            icon: Flag,
            intent: "open",
            color: ACCENT.amber,
            onSelect: () => getShellApi()?.navigate("/project-management"),
            title: "Open Roadmap & Milestones Gantt Chart",
          },
        ],
        small: [
          {
            label: "Sync GitHub",
            icon: RefreshCw,
            intent: "record",
            onSelect: () => void syncFromGitHub(),
            title: "Sync latest Milestones and Epics from GitHub",
          },
        ],
      },
    ];
  }

  if (tab === "view") {
    return [
      {
        label: "Panels",
        large: [
          {
            label: deps.leftTitle,
            icon: PanelLeft,
            intent: "open",
            active: deps.left,
            onSelect: () => deps.togglePanel("left"),
            title: `Show or hide ${deps.leftTitle}`,
          },
        ],
        small: [
          {
            label: deps.rightTitle,
            icon: PanelRight,
            intent: "open",
            active: deps.right,
            onSelect: () => deps.togglePanel("right"),
            title: `Show or hide ${deps.rightTitle}`,
          },
          {
            label: "Bottom panel",
            icon: PanelBottom,
            intent: "open",
            active: deps.bottom,
            disabled: !deps.hasBottomTabs,
            onSelect: () => deps.togglePanel("bottom"),
            title: deps.hasBottomTabs
              ? "Show or hide the bottom panel"
              : "This screen has nothing to put down there",
          },
          {
            label: "Ribbon",
            icon: Rows3,
            intent: "open",
            active: deps.ribbonOpen,
            onSelect: deps.toggleRibbon,
            title: "Collapse or expand the Ribbon",
          },
        ],
      },
    ];
  }

  return [];
}
