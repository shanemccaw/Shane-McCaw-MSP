// ⚠️ TEMPORARY DEBUG CODE — DELETE BEFORE PRODUCTION ⚠️
//
// artifacts/msp-portal/src/components/copilot-assessment/debug/DebugPanel.tsx
//
// Floating, draggable, collapsible debug console for the Copilot assessment
// flow (#279): the page's live in-memory state on one tab, its real network /
// SSE traffic on the other, both rendered through the standalone JsonViewer
// (@/components/ui/json-viewer).
//
// Gating: this component is only ever rendered when the page's `isTestbed` is
// true, and that flag comes from GET /portal/assessment/testbed-status — the
// real server-side tenants.isTestbed lookup, same discipline as every other
// debug tool in this flow (#228/#231/#234/#253). It defaults to false, so for
// a non-testbed customer the panel is genuinely never mounted (and the network
// recorder never patches anything) rather than being rendered-and-hidden.
//
// The JsonViewer it consumes knows nothing about any of this — see that file's
// header for why it is deliberately generic.

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
import { Bug, ChevronDown, ChevronUp, Trash2, X } from "lucide-react";
import { JsonViewer } from "@/components/ui/json-viewer";
import {
  clearNetworkLog,
  getNetworkLog,
  getRecordingStartedAt,
  installNetworkRecorder,
  subscribeNetworkLog,
  type NetworkEntry,
} from "./networkRecorder";

const STORAGE_KEY = "copilot-assessment.debug-panel.v1";

const DEFAULT_WIDTH = 440;
const DEFAULT_HEIGHT = 520;
const MIN_WIDTH = 300;
const MIN_HEIGHT = 220;
const HEADER_HEIGHT = 30;

type PanelLayout = {
  x: number;
  y: number;
  width: number;
  height: number;
  collapsed: boolean;
  tab: "state" | "network";
};

export function CopilotAssessmentDebugPanel({ state }: { state: Record<string, unknown> }) {
  const [layout, setLayout] = useState<PanelLayout>(() => loadLayout());
  const [dismissed, setDismissed] = useState(false);
  const [entries, setEntries] = useState<NetworkEntry[]>(getNetworkLog);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [urlFilter, setUrlFilter] = useState("");
  const panelRef = useRef<HTMLDivElement | null>(null);

  const [recordingStartedAt, setRecordingStartedAt] = useState<number | null>(null);

  // Patch fetch/EventSource for as long as the panel is mounted — i.e. only
  // ever on a real testbed tenant, since that is the only case this component
  // is rendered at all.
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

  const filtered = useMemo(() => {
    const q = urlFilter.trim().toLowerCase();
    return q ? entries.filter((e) => e.url.toLowerCase().includes(q)) : entries;
  }, [entries, urlFilter]);
  const selected = useMemo(() => entries.find((e) => e.id === selectedId) ?? null, [entries, selectedId]);

  if (dismissed) {
    return (
      <button
        type="button"
        onClick={() => setDismissed(false)}
        className="fixed right-3 bottom-3 z-[70] flex items-center gap-1.5 rounded-full border border-amber-500/60 bg-amber-500/15 px-3 py-1.5 text-[11px] font-semibold text-amber-600 shadow-lg backdrop-blur transition-colors hover:bg-amber-500/25 dark:text-amber-300"
        title="Reopen the testbed debug panel"
      >
        <Bug className="h-3.5 w-3.5" />
        Debug
      </button>
    );
  }

  return (
    <div
      ref={panelRef}
      data-testid="copilot-debug-panel"
      className="fixed z-[70] flex flex-col overflow-hidden rounded-lg border border-amber-500/50 bg-card/95 shadow-2xl backdrop-blur select-none"
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
        data-testid="copilot-debug-panel-header"
        className="flex h-[30px] shrink-0 cursor-move items-center gap-1.5 border-b border-amber-500/30 bg-amber-500/10 px-2"
      >
        <Bug className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
        <span className="truncate text-[10px] font-semibold tracking-wider text-amber-700 uppercase dark:text-amber-300">
          Testbed Debug
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setLayout((p) => ({ ...p, collapsed: !p.collapsed }))}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title={layout.collapsed ? "Expand panel" : "Collapse panel"}
          >
            {layout.collapsed ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
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
                data-testid={`copilot-debug-tab-${key}`}
                onClick={() => setLayout((p) => ({ ...p, tab: key }))}
                className={`relative h-full px-2 text-[10px] font-semibold tracking-wider uppercase transition-colors ${
                  layout.tab === key
                    ? "text-foreground after:absolute after:inset-x-1 after:bottom-0 after:h-0.5 after:bg-amber-500"
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
                value={state}
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
              ? "No requests recorded yet — navigate the flow to capture traffic."
              : "No request matches this filter."}
          </div>
        ) : (
          entries.map((e) => (
            <button
              key={e.id}
              type="button"
              data-testid="copilot-debug-net-row"
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
