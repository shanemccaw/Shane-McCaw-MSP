// ⚠️ DEBUG-ONLY CODE — staff tooling, never customer-facing ⚠️
//
// artifacts/admin-panel/src/components/debug/AdminDebugPanel.tsx
//
// Floating, draggable, resizable, collapsible debug console for admin-panel
// (#285) — the client-side counterpart of msp-portal's Copilot-assessment
// panel (#279). State tab: the live in-memory state behind whatever page is
// open. Network tab: this tab's own real fetch/EventSource traffic. Both are
// rendered with @workspace/json-viewer.
//
// GATING — requireAdmin, not isTestbed. Reaching admin-panel at all already
// means the caller holds a `role: "admin"` access token: App.tsx's RequireAdmin
// wrapper redirects anyone else to /login, that role claim is issued by the
// server on /api/auth/login and /api/auth/refresh (both of which refuse to hand
// a non-admin an admin session), and it is the exact same claim the server's
// requireAdmin middleware checks before serving any /api/admin/* route — which
// 403s "Admin access required" without it. This panel is mounted *inside* that
// wrapper and additionally checks the same server-issued claim itself, so for a
// non-admin it is never mounted at all: the recorder never patches window.fetch
// and nothing is rendered-then-hidden.
//
// NOT the same thing as the shell's ConsolePanel / SimulatorLogStream, and
// deliberately does not overlap them: those stream SERVER-side output (the
// app's own logger buffer and the simulator's server log firehose). This shows
// CLIENT-side React/in-memory state and browser network traffic, which nothing
// else in admin-panel exposes.
//
// z-index sits above modals (z-[200]) so a page can be debugged with a dialog
// open, but below the shell's toasts and context menus (z-[999]/z-[9999]) so
// those still work over the top of it.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type SetStateAction,
} from "react";
import { useLocation, useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Bug, ChevronDown, ChevronUp, Trash2, X } from "lucide-react";
import { JsonViewer } from "@workspace/json-viewer";
import {
  clearNetworkLog,
  getNetworkLog,
  getRecordingStartedAt,
  installNetworkRecorder,
  subscribeNetworkLog,
  type NetworkEntry,
} from "@workspace/debug-console";
import { useAuth } from "@/contexts/AuthContext";
import { getDebugStateSlices, subscribeDebugState } from "./debugState";

const STORAGE_KEY = "admin-panel.debug-panel.v1";

const DEFAULT_WIDTH = 460;
const DEFAULT_HEIGHT = 540;
const MIN_WIDTH = 300;
const MIN_HEIGHT = 220;
const HEADER_HEIGHT = 30;

/** Same discipline as the network recorder's body cap: a react-query entry
 *  holding a huge list must not turn the panel into a memory hog or freeze the
 *  tree render. Over the cap the data is replaced by a visible marker that says
 *  so — never a silent drop. */
const MAX_QUERY_DATA_CHARS = 20_000;

type PanelLayout = {
  x: number;
  y: number;
  width: number;
  height: number;
  collapsed: boolean;
  tab: "state" | "network";
};

export function AdminDebugPanel() {
  const { user, accessToken } = useAuth();
  const [layout, setLayout] = useState<PanelLayout>(() => loadLayout());
  const [dismissed, setDismissed] = useState(false);
  const [entries, setEntries] = useState<NetworkEntry[]>(getNetworkLog);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [urlFilter, setUrlFilter] = useState("");
  const [recordingStartedAt, setRecordingStartedAt] = useState<number | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Patch fetch/EventSource for as long as the panel is mounted — i.e. only
  // ever for a server-authenticated admin, since that is the only case this
  // component is rendered at all.
  useEffect(() => {
    const uninstall = installNetworkRecorder();
    setRecordingStartedAt(getRecordingStartedAt());
    return uninstall;
  }, []);
  useEffect(() => subscribeNetworkLog(setEntries), []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    } catch {
      // storage can be full or blocked — position just won't persist
    }
  }, [layout]);

  // A position saved on a bigger monitor must not strand the panel offscreen.
  useLayoutEffect(() => {
    setLayout((prev) => clampLayout(prev));
  }, []);
  useEffect(() => {
    const onResize = () => setLayout((prev) => clampLayout(prev));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const startDrag = useDragHandle(panelRef, setLayout, "move");
  const startResize = useDragHandle(panelRef, setLayout, "resize");

  const stateVisible = !dismissed && !layout.collapsed && layout.tab === "state";
  const pageState = useLivePageState(stateVisible, user, accessToken);

  const filtered = useMemo(() => {
    const q = urlFilter.trim().toLowerCase();
    return q ? entries.filter((e) => e.url.toLowerCase().includes(q)) : entries;
  }, [entries, urlFilter]);
  const selected = useMemo(() => entries.find((e) => e.id === selectedId) ?? null, [entries, selectedId]);

  if (dismissed) {
    return (
      <button
        type="button"
        data-testid="admin-debug-reopen"
        onClick={() => setDismissed(false)}
        className="fixed right-3 bottom-3 z-[300] flex items-center gap-1.5 rounded-full border border-primary/60 bg-primary/15 px-3 py-1.5 text-[11px] font-semibold text-primary shadow-lg backdrop-blur transition-colors hover:bg-primary/25"
        title="Reopen the admin debug panel"
      >
        <Bug className="h-3.5 w-3.5" />
        Debug
      </button>
    );
  }

  return (
    <div
      ref={panelRef}
      data-testid="admin-debug-panel"
      className="fixed z-[300] flex flex-col overflow-hidden rounded-lg border border-primary/50 bg-card/95 shadow-2xl backdrop-blur select-none"
      style={{
        left: layout.x,
        top: layout.y,
        width: layout.width,
        height: layout.collapsed ? HEADER_HEIGHT : layout.height,
      }}
    >
      {/* Drag handle */}
      <div
        onPointerDown={startDrag}
        data-testid="admin-debug-panel-header"
        className="flex h-[30px] shrink-0 cursor-move items-center gap-1.5 border-b border-primary/30 bg-primary/10 px-2"
      >
        <Bug className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="truncate text-[10px] font-semibold tracking-wider text-primary uppercase">
          Admin Debug
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            data-testid="admin-debug-collapse"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setLayout((p) => ({ ...p, collapsed: !p.collapsed }))}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title={layout.collapsed ? "Expand panel" : "Collapse panel"}
          >
            {layout.collapsed ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            data-testid="admin-debug-dismiss"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setDismissed(true)}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title="Hide panel"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>

      {!layout.collapsed && (
        <>
          <div className="flex h-7 shrink-0 items-center border-b border-border bg-background/60 px-1.5">
            {(
              [
                { key: "state", label: "State" },
                { key: "network", label: `Network (${entries.length})` },
              ] as const
            ).map(({ key, label }) => (
              <button
                key={key}
                type="button"
                data-testid={`admin-debug-tab-${key}`}
                onClick={() => setLayout((p) => ({ ...p, tab: key }))}
                className={`relative h-full px-2 text-[10px] font-semibold tracking-wider uppercase transition-colors ${
                  layout.tab === key
                    ? "text-foreground after:absolute after:inset-x-1 after:bottom-0 after:h-0.5 after:bg-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col p-1.5">
            {layout.tab === "state" ? (
              <JsonViewer
                value={pageState}
                rootLabel="page"
                className="min-h-0 flex-1"
                initialExpandDepth={2}
                searchPlaceholder="Search live state…"
              />
            ) : (
              <NetworkTab
                entries={filtered}
                totalCount={entries.length}
                recordingStartedAt={recordingStartedAt}
                urlFilter={urlFilter}
                onUrlFilterChange={setUrlFilter}
                selected={selected}
                onSelect={setSelectedId}
                onClear={() => {
                  clearNetworkLog();
                  setSelectedId(null);
                }}
              />
            )}
          </div>

          {/* Resize handle */}
          <div
            onPointerDown={startResize}
            data-testid="admin-debug-resize"
            className="absolute right-0 bottom-0 h-3 w-3 cursor-nwse-resize"
            title="Resize"
          >
            <span className="absolute right-[2px] bottom-[2px] h-0 w-0 border-r-[6px] border-b-[6px] border-r-muted-foreground/50 border-b-muted-foreground/50" />
          </div>
        </>
      )}
    </div>
  );
}

// ── Live state ────────────────────────────────────────────────────────────────

/**
 * Assembles the live in-memory state behind the current page.
 *
 * Unlike msp-portal's panel — which watches one page's single state object —
 * admin-panel has ~295 components and no shared page-state shape, so this reads
 * the state that genuinely exists on every page: the route, the authenticated
 * identity, and the live react-query cache (admin-panel's actual client-side
 * data store). Pages holding interesting local state add it on top by calling
 * useDebugState(); those slices land under `page`.
 *
 * Only recomputed while the State tab is actually showing — the cache
 * subscription and the stringify-based capping below should not run for a panel
 * sitting collapsed in the corner.
 */
function useLivePageState(
  enabled: boolean,
  user: { id: number; email: string; role: string } | null,
  accessToken: string | null,
): Record<string, unknown> | undefined {
  const [location] = useLocation();
  const search = useSearch();
  const queryClient = useQueryClient();
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const bump = () => setVersion((v) => v + 1);
    const unsubCache = queryClient.getQueryCache().subscribe(bump);
    const unsubSlices = subscribeDebugState(bump);
    bump();
    return () => {
      unsubCache();
      unsubSlices();
    };
  }, [enabled, queryClient]);

  return useMemo(() => {
    if (!enabled) return undefined;
    void version;
    const queries = queryClient
      .getQueryCache()
      .getAll()
      .map((query) => ({
        queryKey: query.queryKey,
        status: query.state.status,
        fetchStatus: query.state.fetchStatus,
        isStale: query.isStale(),
        observers: query.getObserversCount(),
        dataUpdatedAt: query.state.dataUpdatedAt ? new Date(query.state.dataUpdatedAt).toISOString() : null,
        error: query.state.error instanceof Error ? query.state.error.message : (query.state.error ?? null),
        data: capForPanel(query.state.data),
      }));

    return {
      route: {
        location,
        search: search ? `?${search}` : "",
        base: import.meta.env.BASE_URL,
        href: window.location.href,
      },
      // Identity only — the bearer token is deliberately never surfaced, same
      // reasoning as the recorder redacting query-string JWTs: this panel is
      // exactly the sort of thing that ends up in a screenshot.
      auth: user
        ? { id: user.id, email: user.email, role: user.role, accessToken: accessToken ? "REDACTED" : null }
        : null,
      reactQuery: { count: queries.length, queries },
      page: getDebugStateSlices(),
    };
  }, [enabled, version, location, search, user, accessToken, queryClient]);
}

/** Keeps an oversized cache entry out of the tree, visibly. */
function capForPanel(value: unknown): unknown {
  if (value === undefined || value === null) return value ?? null;
  try {
    const text = JSON.stringify(value);
    if (text === undefined) return String(value);
    if (text.length <= MAX_QUERY_DATA_CHARS) return value;
    return `…[${text.length} chars — over the ${MAX_QUERY_DATA_CHARS}-char panel cap, not shown]`;
  } catch {
    return "…[unserializable value]";
  }
}

// ── Network tab ───────────────────────────────────────────────────────────────

function NetworkTab({
  entries,
  totalCount,
  recordingStartedAt,
  urlFilter,
  onUrlFilterChange,
  selected,
  onSelect,
  onClear,
}: {
  entries: NetworkEntry[];
  totalCount: number;
  recordingStartedAt: number | null;
  urlFilter: string;
  onUrlFilterChange: (next: string) => void;
  selected: NetworkEntry | null;
  onSelect: (id: number | null) => void;
  onClear: () => void;
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1.5">
      <div className="flex shrink-0 items-center gap-1.5 rounded border border-border bg-background px-1.5 py-1">
        <input
          value={urlFilter}
          onChange={(e) => onUrlFilterChange(e.target.value)}
          placeholder="Filter by URL…"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-[11px] text-foreground outline-none placeholder:text-muted-foreground/60"
        />
        <button
          type="button"
          data-testid="admin-debug-net-clear"
          onClick={onClear}
          className="flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="Clear the log"
        >
          <Trash2 className="h-3 w-3" />
          Clear
        </button>
      </div>

      <div className="max-h-[45%] min-h-[80px] shrink-0 overflow-auto rounded border border-border bg-background">
        {entries.length === 0 ? (
          <div className="px-2 py-3 text-[11px] italic text-muted-foreground/70">
            {totalCount === 0
              ? "No requests recorded yet — navigate the admin panel to capture traffic."
              : "No request matches this filter."}
          </div>
        ) : (
          entries.map((e) => (
            <button
              key={e.id}
              type="button"
              data-testid="admin-debug-net-row"
              onClick={() => onSelect(selected?.id === e.id ? null : e.id)}
              className={`flex w-full items-center gap-1.5 border-b border-border/50 px-1.5 py-1 text-left font-mono text-[10px] transition-colors last:border-b-0 hover:bg-accent/60 ${
                selected?.id === e.id ? "bg-accent" : ""
              }`}
            >
              <span className={`w-8 shrink-0 font-semibold ${e.kind === "sse" ? "text-purple-600 dark:text-purple-400" : "text-muted-foreground"}`}>
                {e.kind === "sse" ? "SSE" : e.method}
              </span>
              <span className={`w-9 shrink-0 tabular-nums ${statusColor(e)}`}>{statusLabel(e)}</span>
              <span className="min-w-0 flex-1 truncate text-foreground/85">{e.url}</span>
              <span className="w-11 shrink-0 text-right tabular-nums text-muted-foreground/70">
                {e.durationMs != null ? `${e.durationMs}ms` : "…"}
              </span>
              {e.kind === "sse" && (
                <span className="w-8 shrink-0 text-right tabular-nums text-muted-foreground/70">
                  {e.events?.length ?? 0}ev
                </span>
              )}
            </button>
          ))
        )}
      </div>

      <div className="min-h-0 min-w-0 flex-1">
        <JsonViewer
          value={selected ? toDetail(selected) : undefined}
          rawText={selected && selected.responseBody === undefined ? selected.responseText : undefined}
          rootLabel="request"
          className="h-full"
          initialExpandDepth={2}
          searchPlaceholder="Search this request…"
          emptyLabel={
            recordingStartedAt
              ? `Select a request above. Recording since ${new Date(recordingStartedAt).toLocaleTimeString()} — traffic from before the panel opened is not captured.`
              : "Select a request above."
          }
        />
      </div>
    </div>
  );
}

/** The shape shown in the detail viewer — the raw entry minus its internal id. */
function toDetail(entry: NetworkEntry): Record<string, unknown> {
  const { id: _id, startedAt, endedAt, ...rest } = entry;
  return {
    ...rest,
    startedAt: new Date(startedAt).toISOString(),
    endedAt: endedAt != null ? new Date(endedAt).toISOString() : null,
    events: entry.events?.map((ev) => ({ ...ev, at: new Date(ev.at).toISOString() })),
  };
}

function statusLabel(entry: NetworkEntry): string {
  if (entry.status != null) return String(entry.status);
  if (entry.kind === "sse") return entry.state === "closed" ? "shut" : entry.state === "error" ? "err" : "open";
  return entry.state === "error" ? "err" : "…";
}

function statusColor(entry: NetworkEntry): string {
  if (entry.state === "error") return "text-red-600 dark:text-red-400";
  if (entry.status != null && entry.status >= 400) return "text-red-600 dark:text-red-400";
  if (entry.state === "pending") return "text-muted-foreground/60";
  return "text-emerald-600 dark:text-emerald-400";
}

// ── Layout: drag, resize, persistence ─────────────────────────────────────────

/** Shared pointer-drag driver for the move handle and the resize corner. */
function useDragHandle(
  panelRef: RefObject<HTMLDivElement | null>,
  setLayout: Dispatch<SetStateAction<PanelLayout>>,
  mode: "move" | "resize",
) {
  return useCallback(
    (event: ReactPointerEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const rect = panelRef.current?.getBoundingClientRect();
      if (!rect) return;
      const startX = event.clientX;
      const startY = event.clientY;
      const origin = { x: rect.left, y: rect.top, width: rect.width, height: rect.height };

      const onMove = (e: PointerEvent) => {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        setLayout((prev) =>
          clampLayout(
            mode === "move"
              ? { ...prev, x: origin.x + dx, y: origin.y + dy }
              : { ...prev, width: origin.width + dx, height: origin.height + dy },
          ),
        );
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [panelRef, setLayout, mode],
  );
}

function clampLayout(layout: PanelLayout): PanelLayout {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(Math.max(layout.width, MIN_WIDTH), Math.max(MIN_WIDTH, vw - 16));
  const height = Math.min(Math.max(layout.height, MIN_HEIGHT), Math.max(MIN_HEIGHT, vh - 16));
  // Keep at least the header reachable so the panel can always be dragged back.
  const x = Math.min(Math.max(layout.x, 8 - width + 60), Math.max(8, vw - 60));
  const y = Math.min(Math.max(layout.y, 8), Math.max(8, vh - HEADER_HEIGHT - 8));
  return { ...layout, x, y, width, height };
}

function loadLayout(): PanelLayout {
  const fallback: PanelLayout = {
    x: Math.max(8, window.innerWidth - DEFAULT_WIDTH - 16),
    y: Math.max(8, window.innerHeight - DEFAULT_HEIGHT - 16),
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    collapsed: false,
    tab: "state",
  };
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return fallback;
    const parsed = JSON.parse(stored) as Partial<PanelLayout>;
    return clampLayout({
      x: numberOr(parsed.x, fallback.x),
      y: numberOr(parsed.y, fallback.y),
      width: numberOr(parsed.width, fallback.width),
      height: numberOr(parsed.height, fallback.height),
      collapsed: parsed.collapsed === true,
      tab: parsed.tab === "network" ? "network" : "state",
    });
  } catch {
    return fallback;
  }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
