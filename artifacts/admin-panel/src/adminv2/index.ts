/**
 * adminv2 public surface.
 *
 * A screen module should import from here and nowhere deeper — the paths under
 * `shell/` are the shell's own business and will move.
 */

export { default as AdminV2 } from "./AdminV2";

// Registration
export {
  registerScreen,
  resetRegistry,
  getScreen,
  allScreens,
  screenForRoute,
  docLabel,
  ShellContractError,
  auditFixedTabIntents,
} from "./registry/registry";

// Contracts
export type {
  ScreenModule,
  ScreenRenderContext,
  RibbonContribution,
  RibbonGroup,
  RibbonCommand,
  RibbonCombo,
  CommandIntent,
  ContextualTabSpec,
  FixedTabId,
  GallerySpec,
  GalleryRow,
  PeekKind,
  PeekModel,
  PeekFact,
  PeekEdit,
  PeekListRow,
  PeekAction,
  PeekResolver,
  CommandItem,
  CommandType,
  CommandKind,
  CommandSource,
  PanelSpec,
  BottomPanelTab,
} from "./registry/types";

export {
  FIXED_TAB_IDS,
  FIXED_TAB_LABELS,
  FIXED_TAB_INTENTS,
  MAIN_TAB_IDS,
  DEV_TAB_IDS,
  PEEK_KINDS,
  COMMAND_PREFIX,
} from "./registry/types";

// Runtime
export { useShell, ADMINV2_BASE } from "./shell/ShellContext";
export type { ShellApi, OpenDocInput } from "./shell/ShellContext";
export type { OpenDoc, ShellState } from "./shell/shellState";
export { pushTrail, TRAIL_MAX, backGroupFrom, assembleContextualGroups } from "./registry/ribbonAssembly";
export type { TrailEntry } from "./registry/ribbonAssembly";

// Design tokens — screens paint with these, never with raw hexes.
export {
  SURFACE,
  LINE,
  TEXT,
  ACCENT,
  ACCENT_TEXT,
  PRIMARY,
  PRIMARY_OVERLAY,
  KIND_BADGE,
  WASH,
  FONT,
  METRICS,
  SHADOW,
  SCRIM,
  Z,
} from "./theme";

// Status bar segments are supplied by the app shell, not by screens.
export { StatusBar } from "./shell/StatusBar";
export type { StatusSegment } from "./shell/StatusBar";
export { isNumericFact } from "./shell/Peek";
