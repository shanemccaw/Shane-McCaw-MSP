/**
 * Shell state.
 *
 * A pure reducer so the behaviour that actually matters — which tab is up, what
 * happens when you click the active tab, how the trail evolves, which doc gets
 * focus when you close one — is testable without rendering anything.
 */

import { pushTrail, type TrailEntry } from "../registry/ribbonAssembly";
import { METRICS } from "../theme";
import type { CommandType, FixedTabId, GallerySpec, PeekKind } from "../registry/types";

/** One open document in the tab strip. */
export interface OpenDoc {
  /** `${kind}:${recordId}`. Unique per open doc. */
  id: string;
  kind: PeekKind | "screen";
  recordId: string;
  /** Which registered screen renders this doc. */
  screenId: string;
  /** Resolved human name — never a raw id. */
  label: string;
  /** Drives the dot in the tab. */
  dirty?: boolean;
}

/** A dropped ribbon gallery and the button rect it hangs off. */
export interface OpenGallery {
  spec: GallerySpec;
  anchor: { left: number; top: number };
}

export interface PeekTarget {
  kind: PeekKind;
  id: string;
}

export interface ShellState {
  activeTab: FixedTabId;
  ribbonOpen: boolean;
  /** True when the contextual tab is the selected one. */
  contextActive: boolean;

  docs: OpenDoc[];
  activeDocId: string | null;
  trail: TrailEntry[];

  left: boolean;
  right: boolean;
  bottom: boolean;
  leftWidth: number;
  rightWidth: number;
  bottomHeight: number;
  bottomTabId: string | null;
  /** Which splitter is being dragged, for the highlight. */
  drag: "left" | "right" | "bottom" | null;

  paletteOpen: boolean;
  paletteQuery: string;
  /** Most-recent-first command ids. Feeds both the recency boost and the empty state. */
  recentCommandIds: string[];

  peek: PeekTarget | null;
  /** Label of the peek action armed in place, if any. The second press is the real one. */
  peekArmedAction: string | null;

  /** The ribbon gallery currently dropped, with the anchor it drops from. */
  gallery: OpenGallery | null;
}

export const RECENT_COMMANDS_MAX = 12;

export function initialShellState(overrides: Partial<ShellState> = {}): ShellState {
  return {
    activeTab: "home",
    ribbonOpen: true,
    contextActive: false,

    docs: [],
    activeDocId: null,
    trail: [],

    left: true,
    right: false,
    bottom: false,
    leftWidth: METRICS.leftWidth,
    rightWidth: METRICS.rightWidth,
    bottomHeight: METRICS.bottomHeight,
    bottomTabId: null,
    drag: null,

    paletteOpen: false,
    paletteQuery: "",
    recentCommandIds: [],

    peek: null,
    peekArmedAction: null,

    gallery: null,
    ...overrides,
  };
}

export type ShellAction =
  | { type: "selectTab"; tab: FixedTabId }
  | { type: "selectContextTab" }
  | { type: "toggleRibbon" }
  | { type: "openDoc"; doc: OpenDoc; trail?: TrailEntry }
  | { type: "activateDoc"; id: string }
  | { type: "closeDoc"; id: string }
  | { type: "closeOtherDocs"; id: string }
  | { type: "setDocDirty"; id: string; dirty: boolean }
  | { type: "togglePanel"; panel: "left" | "right" | "bottom" }
  | { type: "setPanel"; panel: "left" | "right" | "bottom"; open: boolean }
  | { type: "setPanelSize"; panel: "left" | "right" | "bottom"; size: number }
  | { type: "setBottomTab"; id: string }
  | { type: "startDrag"; panel: "left" | "right" | "bottom" }
  | { type: "endDrag" }
  | { type: "openPalette"; query?: string }
  | { type: "closePalette" }
  | { type: "setPaletteQuery"; query: string }
  | { type: "commandRun"; id: string; commandType: CommandType }
  | { type: "openPeek"; target: PeekTarget }
  | { type: "closePeek" }
  | { type: "armPeekAction"; label: string }
  | { type: "openGallery"; spec: GallerySpec; anchor: { left: number; top: number } }
  | { type: "closeGallery" };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Picks the doc to focus after `closingId` goes away: the one to its right,
 * else the one to its left. Matches every tabbed editor and means closing a run
 * of tabs never bounces focus to the far end of the strip.
 */
export function neighbourDocId(docs: readonly OpenDoc[], closingId: string): string | null {
  const index = docs.findIndex((d) => d.id === closingId);
  if (index === -1) return null;
  const next = docs[index + 1] ?? docs[index - 1];
  return next?.id ?? null;
}

export function shellReducer(state: ShellState, action: ShellAction): ShellState {
  switch (action.type) {
    case "selectTab": {
      // Office behaviour, and v1's: clicking the tab that is already up
      // collapses the ribbon; clicking any other tab opens it.
      const alreadyActive = !state.contextActive && state.activeTab === action.tab;
      return {
        ...state,
        activeTab: action.tab,
        contextActive: false,
        ribbonOpen: alreadyActive ? !state.ribbonOpen : true,
        gallery: null,
      };
    }

    case "selectContextTab": {
      const alreadyActive = state.contextActive;
      return {
        ...state,
        contextActive: true,
        ribbonOpen: alreadyActive ? !state.ribbonOpen : true,
        gallery: null,
      };
    }

    case "toggleRibbon":
      return { ...state, ribbonOpen: !state.ribbonOpen, gallery: null };

    case "openDoc": {
      const existing = state.docs.find((d) => d.id === action.doc.id);
      const docs = existing
        ? state.docs.map((d) => (d.id === action.doc.id ? { ...d, ...action.doc } : d))
        : [...state.docs, action.doc];
      return {
        ...state,
        docs,
        activeDocId: action.doc.id,
        trail: action.trail ? pushTrail(state.trail, action.trail) : state.trail,
        // Opening a record makes its contextual tab the useful one.
        contextActive: action.doc.kind !== "screen",
        ribbonOpen: state.ribbonOpen,
      };
    }

    case "activateDoc":
      return { ...state, activeDocId: action.id };

    case "closeDoc": {
      const nextActive =
        state.activeDocId === action.id ? neighbourDocId(state.docs, action.id) : state.activeDocId;
      const docs = state.docs.filter((d) => d.id !== action.id);
      return {
        ...state,
        docs,
        activeDocId: docs.length ? nextActive : null,
        contextActive: docs.length ? state.contextActive : false,
      };
    }

    case "closeOtherDocs": {
      const kept = state.docs.filter((d) => d.id === action.id);
      return { ...state, docs: kept, activeDocId: kept.length ? action.id : null };
    }

    case "setDocDirty":
      return {
        ...state,
        docs: state.docs.map((d) => (d.id === action.id ? { ...d, dirty: action.dirty } : d)),
      };

    case "togglePanel":
      return { ...state, [action.panel]: !state[action.panel] } as ShellState;

    case "setPanel":
      return { ...state, [action.panel]: action.open } as ShellState;

    case "setPanelSize": {
      if (action.panel === "left") {
        return { ...state, leftWidth: clamp(action.size, METRICS.panelMin, METRICS.panelMax) };
      }
      if (action.panel === "right") {
        return { ...state, rightWidth: clamp(action.size, METRICS.panelMin, METRICS.panelMax) };
      }
      return { ...state, bottomHeight: clamp(action.size, METRICS.bottomMin, METRICS.bottomMax) };
    }

    case "setBottomTab":
      return { ...state, bottomTabId: action.id, bottom: true };

    case "startDrag":
      return { ...state, drag: action.panel };

    case "endDrag":
      return { ...state, drag: null };

    case "openPalette":
      return { ...state, paletteOpen: true, paletteQuery: action.query ?? "" };

    case "closePalette":
      return { ...state, paletteOpen: false, paletteQuery: "" };

    case "setPaletteQuery":
      return { ...state, paletteQuery: action.query };

    case "commandRun": {
      const recentCommandIds = [
        action.id,
        ...state.recentCommandIds.filter((id) => id !== action.id),
      ].slice(0, RECENT_COMMANDS_MAX);
      return { ...state, recentCommandIds, paletteOpen: false, paletteQuery: "" };
    }

    case "openPeek":
      // Re-arming has to reset: opening a different record with delete still
      // armed from the last one would put a live destructive button one click
      // away on a record the user has not even looked at yet.
      return { ...state, peek: action.target, peekArmedAction: null, gallery: null };

    case "closePeek":
      return { ...state, peek: null, peekArmedAction: null };

    case "armPeekAction":
      return { ...state, peekArmedAction: action.label };

    case "openGallery":
      return { ...state, gallery: { spec: action.spec, anchor: action.anchor } };

    case "closeGallery":
      return { ...state, gallery: null };

    default:
      return state;
  }
}

// ─── Persistence ──────────────────────────────────────────────────────────────

/** Namespaced so it cannot collide with the existing panel's `admin_nav_expanded`. */
export const SHELL_STORAGE_KEY = "adminv2_shell";

/** Only layout survives a reload. Open docs, palette and peek deliberately do not. */
export interface PersistedShell {
  ribbonOpen: boolean;
  left: boolean;
  right: boolean;
  bottom: boolean;
  leftWidth: number;
  rightWidth: number;
  bottomHeight: number;
  activeTab: FixedTabId;
  recentCommandIds: string[];
}

export function toPersisted(state: ShellState): PersistedShell {
  return {
    ribbonOpen: state.ribbonOpen,
    left: state.left,
    right: state.right,
    bottom: state.bottom,
    leftWidth: state.leftWidth,
    rightWidth: state.rightWidth,
    bottomHeight: state.bottomHeight,
    activeTab: state.activeTab,
    recentCommandIds: state.recentCommandIds,
  };
}

/**
 * Reads persisted layout. Anything malformed is discarded rather than repaired —
 * a half-restored layout is more confusing than a default one.
 */
export function fromPersisted(raw: string | null): Partial<ShellState> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedShell>;
    const out: Partial<ShellState> = {};
    if (typeof parsed.ribbonOpen === "boolean") out.ribbonOpen = parsed.ribbonOpen;
    if (typeof parsed.left === "boolean") out.left = parsed.left;
    if (typeof parsed.right === "boolean") out.right = parsed.right;
    if (typeof parsed.bottom === "boolean") out.bottom = parsed.bottom;
    if (typeof parsed.leftWidth === "number") {
      out.leftWidth = clamp(parsed.leftWidth, METRICS.panelMin, METRICS.panelMax);
    }
    if (typeof parsed.rightWidth === "number") {
      out.rightWidth = clamp(parsed.rightWidth, METRICS.panelMin, METRICS.panelMax);
    }
    if (typeof parsed.bottomHeight === "number") {
      out.bottomHeight = clamp(parsed.bottomHeight, METRICS.bottomMin, METRICS.bottomMax);
    }
    if (typeof parsed.activeTab === "string") out.activeTab = parsed.activeTab as FixedTabId;
    if (Array.isArray(parsed.recentCommandIds)) {
      out.recentCommandIds = parsed.recentCommandIds
        .filter((id): id is string => typeof id === "string")
        .slice(0, RECENT_COMMANDS_MAX);
    }
    return out;
  } catch {
    return {};
  }
}
