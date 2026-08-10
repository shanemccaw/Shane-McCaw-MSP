/**
 * The shell's React surface.
 *
 * `useShell()` is the only API a screen needs at runtime: open a doc, open a
 * peek, open the palette, mark something dirty. Everything the shell draws is
 * derived here from the registry plus `shellState`.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import { useLocation } from "wouter";
import { logger } from "@/lib/logger";
import {
  buildCommandIndex,
  docLabel,
  getScreen,
  groupsForFixedTab,
  resolvePeek,
  screenForRoute,
} from "../registry/registry";
import { assembleContextualGroups, trailKey, type TrailEntry } from "../registry/ribbonAssembly";
import { shellGroupsForTab } from "./shellRibbon";
import type {
  CommandItem,
  ContextualTabSpec,
  FixedTabId,
  PeekKind,
  PeekModel,
  RibbonGroup,
  ScreenModule,
} from "../registry/types";
import {
  fromPersisted,
  initialShellState,
  shellReducer,
  toPersisted,
  SHELL_STORAGE_KEY,
  type OpenDoc,
  type ShellAction,
  type ShellState,
} from "./shellState";

const log = logger.child({ channel: "admin.shell" });

/** Everything adminv2 lives under this prefix. */
export const ADMINV2_BASE = "/adminv2";

export interface OpenDocInput {
  /** Peek kind for a record, or "screen" for a plain destination. */
  kind: PeekKind | "screen";
  /** Record id, or the screen id when `kind` is "screen". */
  id: string;
  /** Which registered screen renders it. Defaults to `id` when kind is "screen". */
  screenId?: string;
  /** Overrides the resolved label. Rarely needed — `docLabel` reuses the peek resolver. */
  label?: string;
}

export interface ShellApi {
  state: ShellState;
  dispatch: React.Dispatch<ShellAction>;

  /** Navigate within adminv2. Pass a screen route like "/endpoints". */
  navigate: (route: string) => void;
  /** Opens a doc tab, extends the trail, routes to its screen, and focuses it. */
  openDoc: (input: OpenDocInput) => void;
  /** Focuses an already-open doc, routing to its screen. */
  activateDoc: (docId: string) => void;
  /** Opens the peek overlay over whatever you are doing. */
  openPeek: (kind: PeekKind, id: string) => void;
  closePeek: () => void;
  openPalette: (query?: string) => void;
  /** Runs a palette item and records it for the recency boost. */
  runCommand: (item: CommandItem) => void;
  /** Marks an open doc dirty, which shows the dot in its tab. */
  setDocDirty: (docId: string, dirty: boolean) => void;

  activeScreen: ScreenModule | undefined;
  /** Groups for whichever tab is currently selected, Back group already spliced in. */
  ribbonGroups: RibbonGroup[];
  contextualTab: ContextualTabSpec | null;
  /** Live peek model for the current target, or null. */
  peekModel: PeekModel | null;
  commandIndex: () => CommandItem[];
}

const ShellCtx = createContext<ShellApi | null>(null);

export function useShell(): ShellApi {
  const ctx = useContext(ShellCtx);
  if (!ctx) throw new Error("useShell() must be called inside <ShellProvider>.");
  return ctx;
}

/**
 * Escape hatch for the rare `RibbonCommand.onSelect` that only needs to
 * navigate. A screen's `ribbon` array is built once, at `registerScreen()`
 * module-load time — outside any component — so it cannot call `useShell()`.
 * Populated by the mounted `ShellProvider` and read only at click time, by
 * which point a provider always exists. Prefer `useShell()` inside a
 * screen's own render; reach for this only from a closure that has no
 * component of its own to hook from.
 */
let shellSingleton: ShellApi | null = null;

export function getShellApi(): ShellApi | null {
  return shellSingleton;
}

function readPersisted(): Partial<ShellState> {
  if (typeof window === "undefined") return {};
  try {
    return fromPersisted(window.localStorage.getItem(SHELL_STORAGE_KEY));
  } catch {
    return {};
  }
}

/**
 * Strips the adminv2 prefix off wouter's location.
 *
 * wouter has already removed the app's own BASE_URL, so this only has to deal
 * with the `/adminv2` segment. Returns "/" for the shell root.
 */
export function subRoute(location: string): string {
  if (!location.startsWith(ADMINV2_BASE)) return "/";
  const rest = location.slice(ADMINV2_BASE.length);
  return rest === "" ? "/" : rest;
}

export function ShellProvider({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const [state, dispatch] = useReducer(shellReducer, undefined, () =>
    initialShellState(readPersisted()),
  );

  // Layout survives a reload; open docs, palette and peek deliberately do not.
  useEffect(() => {
    try {
      window.localStorage.setItem(SHELL_STORAGE_KEY, JSON.stringify(toPersisted(state)));
    } catch {
      /* private mode / quota — layout memory is not worth failing over */
    }
  }, [
    state.ribbonOpen,
    state.left,
    state.right,
    state.bottom,
    state.leftWidth,
    state.rightWidth,
    state.bottomHeight,
    state.activeTab,
    state.recentCommandIds,
  ]);

  const navigate = useCallback(
    (route: string) => {
      const screen = screenForRoute(route);
      if (screen) {
        openDocRef.current({ kind: "screen", id: screen.id, screenId: screen.id, label: screen.title });
      } else {
        setLocation(`${ADMINV2_BASE}${route === "/" ? "" : route}`);
      }
    },
    [setLocation],
  );

  const activeScreen = useMemo(() => screenForRoute(subRoute(location)), [location]);

  useEffect(() => {
    if (activeScreen && docsRef.current.length === 0) {
      openDocRef.current({ kind: "screen", id: activeScreen.id, screenId: activeScreen.id, label: activeScreen.title });
    }
  }, [activeScreen]);

  // Kept in a ref so `openDoc` does not have to re-create itself whenever the
  // route changes, which would re-render every screen that memoises on it.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const locationRef = useRef(location);
  locationRef.current = location;
  const docsRef = useRef(state.docs);
  docsRef.current = state.docs;

  const openDoc = useCallback((input: OpenDocInput) => {
    const screenId = input.screenId ?? (input.kind === "screen" ? input.id : undefined);
    if (!screenId) {
      log.error({ kind: input.kind, id: input.id }, "openDoc needs a screenId for a record doc");
      return;
    }
    const label = input.label ?? docLabel(input.kind, input.kind === "screen" ? screenId : input.id);
    const doc: OpenDoc = {
      id: `${input.kind}:${input.id}`,
      kind: input.kind,
      recordId: input.id,
      screenId,
      label,
    };
    const trail: TrailEntry = {
      kind: input.kind,
      id: input.id,
      label,
      open: () => openDocRef.current(input),
    };
    dispatch({ type: "openDoc", doc, trail });
    // Route to the screen that owns the doc. Without this, `screenId` is stored
    // and never acted on: the centre column keeps rendering whichever screen the
    // URL points at and hands it a recordId belonging to a different screen.
    routeToScreen(screenId);
    log.debug({ doc: doc.id, label, screen: screenId }, "doc opened");
  }, []);

  /** Navigates to a screen's route unless it is already the routed one. */
  const routeToScreen = useCallback((screenId: string) => {
    const target = getScreen(screenId);
    if (!target) {
      log.warn({ screen: screenId }, "doc names a screen that is not registered");
      return;
    }
    if (subRoute(locationRef.current) !== target.route) navigateRef.current(target.route);
  }, []);

  /**
   * Focuses an already-open doc, routing to its screen on the way.
   *
   * Clicking a tab has to move the route as well as the focus, for the same
   * reason `openDoc` does.
   */
  const activateDoc = useCallback((docId: string) => {
    dispatch({ type: "activateDoc", id: docId });
    const doc = docsRef.current.find((d) => d.id === docId);
    if (doc) routeToScreen(doc.screenId);
  }, [routeToScreen]);

  const openDocRef = useRef(openDoc);
  openDocRef.current = openDoc;

  const openPeek = useCallback((kind: PeekKind, id: string) => {
    dispatch({ type: "openPeek", target: { kind, id } });
    log.debug({ kind, id }, "peek opened");
  }, []);

  const closePeek = useCallback(() => dispatch({ type: "closePeek" }), []);
  const openPalette = useCallback((query?: string) => dispatch({ type: "openPalette", query }), []);

  const runCommand = useCallback((item: CommandItem) => {
    dispatch({ type: "commandRun", id: item.id, commandType: item.type });
    try {
      item.run();
    } catch (err) {
      log.error(
        { command: item.id, message: err instanceof Error ? err.message : String(err) },
        "palette command threw",
      );
    }
  }, []);

  const setDocDirty = useCallback((docId: string, dirty: boolean) => {
    dispatch({ type: "setDocDirty", id: docId, dirty });
  }, []);

  const activeDoc = useMemo(
    () => state.docs.find((d) => d.id === state.activeDocId) ?? null,
    [state.docs, state.activeDocId],
  );

  const contextualTab = useMemo<ContextualTabSpec | null>(() => {
    const spec = activeScreen?.contextualTab;
    if (!spec) return null;
    if (typeof spec === "function") {
      return spec({
        recordId: activeDoc?.recordId,
        kind: activeDoc && activeDoc.kind !== "screen" ? activeDoc.kind : undefined,
      });
    }
    // A static contextual tab is only live once a record is actually open —
    // otherwise its record-scoped commands would have nothing to act on.
    return activeDoc && activeDoc.kind !== "screen" ? spec : null;
  }, [activeScreen, activeDoc]);

  const ribbonGroups = useMemo<RibbonGroup[]>(() => {
    if (state.contextActive && contextualTab) {
      return assembleContextualGroups(
        contextualTab,
        state.trail,
        () => dispatch({ type: "openPalette" }),
        activeDoc ? trailKey({ kind: activeDoc.kind, id: activeDoc.recordId }) : undefined,
      );
    }
    // The window's own groups sort first, then whatever screens contributed.
    return [
      ...shellGroupsForTab(state.activeTab, {
        left: state.left,
        right: state.right,
        bottom: state.bottom,
        ribbonOpen: state.ribbonOpen,
        hasBottomTabs: (activeScreen?.bottom?.length ?? 0) > 0,
        togglePanel: (panel) => dispatch({ type: "togglePanel", panel }),
        toggleRibbon: () => dispatch({ type: "toggleRibbon" }),
        openPalette: () => dispatch({ type: "openPalette" }),
        leftTitle: activeScreen?.left?.title ?? "Explorer",
        rightTitle: activeScreen?.right?.title ?? "Properties",
      }),
      ...groupsForFixedTab(state.activeTab),
    ];
  }, [
    state.contextActive,
    state.activeTab,
    state.trail,
    state.left,
    state.right,
    state.bottom,
    state.ribbonOpen,
    contextualTab,
    activeScreen,
  ]);

  // Resolved on every render rather than memoised on the target. A memo keyed on
  // state.peek calls the resolver exactly once per open, so a screen writing
  // through an edit would never see its own value come back, and SHELL.md
  // promises the opposite. resolvePeek is a cheap registry walk; caching it is
  // not worth serving a stale record.
  const peekModel: PeekModel | null = state.peek
    ? resolvePeek(state.peek.kind, state.peek.id)
    : null;

  const commandIndex = useCallback(
    () => buildCommandIndex((route) => navigateRef.current(route)),
    [],
  );

  // ── Global keys ────────────────────────────────────────────────────────────
  // Ctrl/Cmd K is the primary way to move, so it wins everywhere including
  // inside inputs. Esc unwinds one layer at a time, frontmost first, never all
  // three at once. The ordering rationale is on the handler itself.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        dispatch({ type: "openPalette" });
        return;
      }
      if (event.key === "Escape") {
        // Topmost first, matching the design z-order (palette 131 > gallery 119
        // > peek 111). A peek can be open behind the palette, and Esc must
        // close what is actually in front of you.
        if (state.paletteOpen) {
          event.preventDefault();
          dispatch({ type: "closePalette" });
        } else if (state.gallery) {
          event.preventDefault();
          dispatch({ type: "closeGallery" });
        } else if (state.peek) {
          event.preventDefault();
          dispatch({ type: "closePeek" });
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [state.paletteOpen, state.gallery, state.peek]);

  const api = useMemo<ShellApi>(
    () => ({
      state,
      dispatch,
      navigate,
      openDoc,
      activateDoc,
      openPeek,
      closePeek,
      openPalette,
      runCommand,
      setDocDirty,
      activeScreen,
      ribbonGroups,
      contextualTab,
      peekModel,
      commandIndex,
    }),
    [
      state,
      navigate,
      openDoc,
      activateDoc,
      openPeek,
      closePeek,
      openPalette,
      runCommand,
      setDocDirty,
      activeScreen,
      ribbonGroups,
      contextualTab,
      peekModel,
      commandIndex,
    ],
  );

  useEffect(() => {
    shellSingleton = api;
    (window as any).__shellApi = api;
    return () => {
      shellSingleton = null;
      (window as any).__shellApi = null;
    };
  }, [api]);

  return <ShellCtx.Provider value={api}>{children}</ShellCtx.Provider>;
}

/** Convenience for screens that only need to know which fixed tab is up. */
export function useActiveTab(): FixedTabId {
  return useShell().state.activeTab;
}
