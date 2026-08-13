import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, ListFilter, Pin, PinOff, Radio, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useLiveStream, type LiveStreamFrame } from "@/hooks/useLiveStream";
import { useSimulatorActivity } from "@/contexts/SimulatorActivityContext";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

// Mirrors the canonical EVENT_TYPES in artifacts/api-server/src/lib/event-bus.ts.
// The event bus is server-only (no shared package export), so the frontend
// duplicates the values it needs — same convention msp-portal/src/pages/webhooks.tsx
// uses for its own event-type picker. Keep in sync with event-bus.ts if a new
// EVENT_TYPES entry is added.
//
// The admin-live-stream firehose bridge (lib/sse-hub-event-bridge.ts) keys the hub
// channel by the event's `eventType` field directly — so subscribing with
// ?channel=<eventType> is exactly how a business event surfaces live, and these
// fold into the same picker as the logger channel taxonomy.
const BUSINESS_EVENT_TYPES = [
  "auth.login",
  "auth.logout",
  "auth.token.refresh",
  "auth.token.revoked",
  "auth.role.changed",
  "auth.account.setup",
  "auth.password.reset",
  "msp.service_account.created",
  "msp.service_account.revoked",
  "msp.created",
  "msp.updated",
  "msp.suspended",
  "customer.created",
  "customer.updated",
  "customer.status.changed",
  "user.invited",
  "user.activated",
  "user.deactivated",
  "service_account.created",
  "service_account.revoked",
  "document.created",
  "document.version.added",
  "document.status.changed",
  "idempotency.hit",
  "dlq.item.enqueued",
  "dlq.item.resolved",
  "auth.impersonation.session_started",
  "auth.impersonation.token_issued",
] as const;

const EVENT_TYPE_SET = new Set<string>(BUSINESS_EVENT_TYPES);

type LevelBucket = "info" | "warn" | "error";

interface NormalizedLine {
  id: string;
  /** Display/sort timestamp — server occurredAt for events, receivedAt otherwise. */
  at: number;
  /** Client arrival time — the clear filter compares against this, never against
   *  server clocks (client/server skew would silently drop late frames). */
  recvAt: number;
  time: string;
  bucket: LevelBucket;
  /** 3-char gutter tag: DBG INF OK WRN ERR FTL EVT BUS */
  tag: string;
  tagClass: string;
  msgClass: string;
  rowClass: string;
  text: string;
  /** Present on firehose frames — which channel the line arrived on. */
  channel?: string;
  /** mspId scope when the hub delivered one. */
  scope?: string;
  detail: Record<string, unknown> | null;
}

const LEVEL_STYLES: Record<string, { tag: string; tagClass: string; msgClass: string; rowClass: string; bucket: LevelBucket }> = {
  debug: { tag: "DBG", tagClass: "text-muted-foreground", msgClass: "text-muted-foreground", rowClass: "", bucket: "info" },
  info: { tag: "INF", tagClass: "text-primary", msgClass: "text-foreground/90", rowClass: "", bucket: "info" },
  success: { tag: "OK", tagClass: "text-emerald-400", msgClass: "text-foreground/90", rowClass: "", bucket: "info" },
  warn: { tag: "WRN", tagClass: "text-amber-400", msgClass: "text-amber-200/90", rowClass: "", bucket: "warn" },
  error: { tag: "ERR", tagClass: "text-destructive", msgClass: "text-destructive", rowClass: "", bucket: "error" },
  fatal: { tag: "FTL", tagClass: "text-destructive font-bold", msgClass: "text-destructive font-semibold", rowClass: "bg-destructive/10", bucket: "error" },
};

function levelStyle(level: string) {
  return LEVEL_STYLES[level] ?? LEVEL_STYLES.info;
}

function fmtTime(at: number): string {
  const d = new Date(at);
  return `${d.toLocaleTimeString([], { hour12: false })}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

// Identifying fields worth surfacing inline, in priority order — sampled from
// the log.error/log.warn call sites across artifacts/api-server/src (engines,
// rules, signals, monitor checks, tenants, docs). Add a key here once a real
// call site uses it; this is not meant to be exhaustive up front.
const HIGHLIGHT_FIELDS = [
  "engineKey",
  "ruleKey",
  "groupId",
  "signalKey",
  "checkKey",
  "runId",
  "suiteId",
  "mspId",
  "tenantId",
  "customerId",
  "clientId",
  "clientUserId",
  "projectId",
  "docId",
  "resultId",
  "taskId",
  "packKey",
  "artifactName",
  "automationId",
];

function extractHighlightFields(meta: Record<string, unknown> | null): string {
  if (!meta) return "";
  const found = HIGHLIGHT_FIELDS.filter((k) => meta[k] != null).map((k) => `${k}=${meta[k]}`);
  return found.length ? ` [${found.join(", ")}]` : "";
}

/** Normalize any live-stream frame (log-bridge, event-bridge, or raw hub
 *  broadcast) into one renderable line. The firehose taps ALL hub traffic,
 *  so this degrades gracefully for shapes it doesn't know. */
function frameToLine(frame: LiveStreamFrame): NormalizedLine {
  const data = frame.data;
  const channel = typeof data.channel === "string" ? data.channel : undefined;
  const scope = data.scope != null ? String(data.scope) : undefined;

  if (data.type === "log") {
    const style = levelStyle(String(data.level ?? "info"));
    const detail: Record<string, unknown> = {};
    const meta = data.meta && typeof data.meta === "object" ? (data.meta as Record<string, unknown>) : null;
    if (meta) Object.assign(detail, meta);
    if (data.correlationId) detail.correlationId = data.correlationId;
    return {
      id: frame.id,
      at: frame.receivedAt,
      recvAt: frame.receivedAt,
      time: fmtTime(frame.receivedAt),
      ...style,
      text: `${String(data.message ?? "")}${extractHighlightFields(meta)}`,
      channel,
      scope,
      detail: Object.keys(detail).length > 0 ? detail : null,
    };
  }

  if (data.type === "event") {
    const occurredAt = typeof data.occurredAt === "string" ? Date.parse(data.occurredAt) : NaN;
    const at = Number.isNaN(occurredAt) ? frame.receivedAt : occurredAt;
    const detail: Record<string, unknown> = {};
    if (data.payload && typeof data.payload === "object") detail.payload = data.payload;
    if (data.eventId) detail.eventId = data.eventId;
    return {
      id: frame.id,
      at,
      recvAt: frame.receivedAt,
      time: fmtTime(at),
      bucket: "info",
      tag: "EVT",
      tagClass: "text-primary",
      msgClass: "text-foreground font-medium",
      rowClass: "",
      text: String(data.eventType ?? "unknown"),
      channel,
      scope,
      detail: Object.keys(detail).length > 0 ? detail : null,
    };
  }

  const { type, channel: _c, scope: _s, ...rest } = data;
  return {
    id: frame.id,
    at: frame.receivedAt,
    recvAt: frame.receivedAt,
    time: fmtTime(frame.receivedAt),
    bucket: "info",
    tag: "BUS",
    tagClass: "text-muted-foreground",
    msgClass: "text-foreground/90",
    rowClass: "",
    text: String(type ?? "frame"),
    channel,
    scope,
    detail: Object.keys(rest).length > 0 ? rest : null,
  };
}

const EMPTY_LOCAL: never[] = [];

interface LogPaneProps {
  /** Hub channel to subscribe to; "*" is the full firehose. */
  channel: string;
  title: string;
  isFirehose?: boolean;
  isEventType?: boolean;
  enabledBuckets: Set<LevelBucket>;
  onClose?: () => void;
  /** Manually pinned lines for this pane — a curated, static addition
   *  separate from the live `frames` subscription. */
  pinnedLines: NormalizedLine[];
  onUnpin: (lineId: string) => void;
  /** Panes available as "Send to pane" targets, plus a handler to pin into
   *  one (or create a new one) from a line's context menu. */
  paneTargets: Array<{ channel: string; title: string }>;
  onSendToPane: (line: NormalizedLine, targetChannel: string) => void;
  onSendToNewPane: (line: NormalizedLine) => void;
}

/** One independently-scrolling live pane. Mounts its own useLiveStream —
 *  the multi-select split view mounts one pane per selected channel. */
function LogPane({
  channel,
  title,
  isFirehose,
  isEventType,
  enabledBuckets,
  onClose,
  pinnedLines,
  onUnpin,
  paneTargets,
  onSendToPane,
  onSendToNewPane,
}: LogPaneProps) {
  const { frames, connected } = useLiveStream(channel);
  // Local (immediate UI-action) studio logs only belong in the firehose pane;
  // the hook must run unconditionally, the merge below is what's conditional.
  const { logs: activityLogs } = useSimulatorActivity();
  const localLogs = isFirehose ? activityLogs : EMPTY_LOCAL;

  const [clearedAt, setClearedAt] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pinned, setPinned] = useState(true);
  const pinnedRef = useRef(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const lines = useMemo(() => {
    // frames buffer is newest-first; reverse to oldest-first BEFORE the stable
    // sort so same-millisecond bursts keep their true arrival order.
    const streamLines = frames.map(frameToLine).reverse();
    const local: NormalizedLine[] = localLogs.map((l) => {
      const style = levelStyle(l.type);
      return {
        id: l.id,
        at: l.at,
        recvAt: l.at,
        time: fmtTime(l.at),
        ...style,
        text: l.message,
        channel: "studio",
        detail: null,
      };
    });
    return [...streamLines, ...local]
      .filter((l) => l.recvAt > clearedAt && enabledBuckets.has(l.bucket))
      .sort((a, b) => a.at - b.at);
  }, [frames, localLogs, clearedAt, enabledBuckets]);

  // Stick to the newest line unless the user has scrolled up to read history.
  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    pinnedRef.current = atBottom;
    setPinned(atBottom);
  };

  // Depend on the lines array itself, NOT lines.length — once the 200-frame
  // ring buffer saturates, length is constant while content keeps changing,
  // and the pin would silently die exactly when the stream is busiest.
  // expandedId is deliberately excluded: expanding a row is the user reading,
  // not a moment to yank the viewport to the tail.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const jumpToLatest = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    pinnedRef.current = true;
    setPinned(true);
  };

  const copyLineText = (line: NormalizedLine) => {
    void navigator.clipboard.writeText(line.text);
    toast.success("Copied line to clipboard");
  };

  const copyLineJson = (line: NormalizedLine) => {
    void navigator.clipboard.writeText(JSON.stringify(line.detail ?? {}, null, 2));
    toast.success("Copied raw JSON to clipboard");
  };

  const renderLineRow = (line: NormalizedLine, opts: { pinned?: boolean } = {}) => (
    <ContextMenu key={`${opts.pinned ? "pin" : "live"}-${line.id}`}>
      <ContextMenuTrigger asChild>
        <div
          className={`px-2 ${line.rowClass} ${line.detail ? "cursor-pointer" : ""} hover:bg-accent/40`}
          onClick={line.detail ? () => setExpandedId(expandedId === line.id ? null : line.id) : undefined}
        >
          <div className="flex items-start gap-2">
            {opts.pinned && <Pin className="mt-0.5 h-2.5 w-2.5 shrink-0 text-primary" aria-label="Pinned line" />}
            <span className="shrink-0 select-none tabular-nums text-muted-foreground/60">{line.time}</span>
            <span className={`w-7 shrink-0 select-none font-semibold ${line.tagClass}`}>{line.tag}</span>
            {isFirehose && line.channel && (
              <span className="shrink-0 select-none text-muted-foreground">[{line.channel}]</span>
            )}
            <span className={`min-w-0 flex-1 whitespace-pre-wrap break-all ${line.msgClass}`}>{line.text}</span>
            {line.scope && <span className="shrink-0 select-none text-[10px] text-muted-foreground/60">msp:{line.scope}</span>}
          </div>
          {expandedId === line.id && line.detail && (
            <pre className="my-1 ml-24 overflow-x-auto rounded border border-border bg-card p-2 text-[10px] leading-relaxed text-muted-foreground">
              {JSON.stringify(line.detail, null, 2)}
            </pre>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuItem onSelect={() => copyLineText(line)} className="text-xs">
          Copy line
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => copyLineJson(line)} className="text-xs">
          Copy raw JSON
        </ContextMenuItem>
        <ContextMenuSeparator />
        {opts.pinned ? (
          <ContextMenuItem onSelect={() => onUnpin(line.id)} className="gap-2 text-xs">
            <PinOff className="h-3.5 w-3.5" />
            Unpin from this pane
          </ContextMenuItem>
        ) : (
          <ContextMenuSub>
            <ContextMenuSubTrigger className="gap-2 text-xs">
              <Pin className="h-3.5 w-3.5" />
              Send to pane
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-48">
              {paneTargets.map((target) => (
                <ContextMenuItem key={target.channel} onSelect={() => onSendToPane(line, target.channel)} className="text-xs">
                  {target.title}
                </ContextMenuItem>
              ))}
              {paneTargets.length > 0 && <ContextMenuSeparator />}
              <ContextMenuItem onSelect={() => onSendToNewPane(line)} className="text-xs">
                New pane…
              </ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );

  return (
    <div className="relative flex h-full min-w-0 flex-1 flex-col" style={{ minWidth: 300 }}>
      <div className="flex h-7 shrink-0 items-center gap-1.5 border-b border-border bg-card px-2 select-none">
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${connected ? "animate-pulse bg-emerald-400" : "bg-muted-foreground/60"}`}
          title={connected ? "Live — SSE connected" : "Disconnected — reconnecting with backoff"}
        />
        <span className="truncate font-mono text-[11px] text-foreground" title={title}>
          {title}
        </span>
        {isEventType && (
          <span className="shrink-0 rounded-sm border border-border bg-background px-1 text-[9px] uppercase tracking-wide text-muted-foreground">
            event
          </span>
        )}
        <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground">{lines.length}</span>
        <button
          onClick={() => setClearedAt(Date.now())}
          className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="Clear pane"
        >
          <Trash2 className="h-3 w-3" />
        </button>
        {onClose && (
          <button
            onClick={onClose}
            className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title="Remove this channel from the split"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      <div ref={scrollRef} onScroll={handleScroll} className="min-h-0 flex-1 overflow-y-auto py-1 font-mono text-[11px] leading-[1.65]">
        {pinnedLines.length > 0 && (
          <div className="mb-1 border-b border-dashed border-border pb-1">
            {pinnedLines.map((line) => renderLineRow(line, { pinned: true }))}
          </div>
        )}
        {lines.length === 0 ? (
          pinnedLines.length === 0 && (
            <div className="px-3 py-4 italic text-muted-foreground/70 select-none">
              {connected ? `Waiting for activity on ${title}…` : "Connecting…"}
            </div>
          )
        ) : (
          lines.map((line) => renderLineRow(line))
        )}
      </div>

      {!pinned && (
        <button
          onClick={jumpToLatest}
          className="absolute bottom-2 right-3 z-10 rounded-full border border-border bg-popover px-2.5 py-1 text-[10px] font-medium text-foreground shadow-md transition-colors hover:bg-accent"
        >
          ↓ Jump to latest
        </button>
      )}
    </div>
  );
}

const BUCKET_TOGGLES: Array<{ key: LevelBucket; label: string; activeClass: string }> = [
  { key: "info", label: "INFO", activeClass: "text-primary" },
  { key: "warn", label: "WARN", activeClass: "text-amber-400" },
  { key: "error", label: "ERROR", activeClass: "text-destructive" },
];

interface SimulatorLogStreamProps {
  selectedChannels: string[];
  onChangeChannels: (channels: string[]) => void;
}

/**
 * The bottom panel's Log Stream tab — merges the old Telemetry Log Stream,
 * Signal Engine Bus, and Engines tabs into one splittable view.
 *
 * Selection behavior:
 *   0 channels → one unified firehose pane (?channel=*).
 *   1 channel  → one pane, server-side filtered to that channel.
 *   N channels → N side-by-side panes, one per channel, each independently
 *                scrollable and labeled — VS Code's split-terminal pattern.
 */
export function SimulatorLogStream({ selectedChannels, onChangeChannels }: SimulatorLogStreamProps) {
  const { fetchWithAuth } = useAuth();
  const [channels, setChannels] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [enabledBuckets, setEnabledBuckets] = useState<Set<LevelBucket>>(
    () => new Set<LevelBucket>(["info", "warn", "error"]),
  );

  // "Send to pane" — manually pinned lines, keyed by the pane's channel (the
  // firehose pane uses "*"). Kept separate from each pane's live `frames`.
  const [pinnedByChannel, setPinnedByChannel] = useState<Record<string, NormalizedLine[]>>({});
  // A line queued for pinning once the "New pane…" channel picker selection lands.
  const pendingPinLineRef = useRef<NormalizedLine | null>(null);

  const pinLineToChannel = (line: NormalizedLine, targetChannel: string) => {
    setPinnedByChannel((prev) => ({
      ...prev,
      [targetChannel]: [...(prev[targetChannel] ?? []), line],
    }));
  };

  const unpinLineFromChannel = (targetChannel: string, lineId: string) => {
    setPinnedByChannel((prev) => ({
      ...prev,
      [targetChannel]: (prev[targetChannel] ?? []).filter((l) => l.id !== lineId),
    }));
  };

  const handleSendToNewPane = (line: NormalizedLine) => {
    pendingPinLineRef.current = line;
    setPickerOpen(true);
    toast.info("Pick a channel to open a new pane and pin this line into it");
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchWithAuth("/api/admin/live-stream/channels");
        const data = await res.json();
        if (!cancelled && Array.isArray(data.channels)) setChannels(data.channels);
      } catch {
        // picker just stays empty for log channels; business events still work
      }
    })();
    return () => {
      cancelled = true;
    };
    // fetchWithAuth is stable (memoized in AuthContext) — run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleChannel = (ch: string) => {
    const alreadySelected = selectedChannels.includes(ch);
    onChangeChannels(
      alreadySelected ? selectedChannels.filter((c) => c !== ch) : [...selectedChannels, ch],
    );
    if (!alreadySelected && pendingPinLineRef.current) {
      pinLineToChannel(pendingPinLineRef.current, ch);
      pendingPinLineRef.current = null;
      setPickerOpen(false);
    }
  };

  const toggleBucket = (bucket: LevelBucket) => {
    setEnabledBuckets((prev) => {
      const next = new Set(prev);
      if (next.has(bucket)) {
        if (next.size > 1) next.delete(bucket); // never filter everything out
      } else {
        next.add(bucket);
      }
      return next;
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {/* Toolbar: channel picker + selection chips + level filter */}
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border bg-card px-2 select-none">
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <button className="flex h-6 shrink-0 items-center gap-1.5 rounded border border-border bg-background px-2 text-[11px] text-foreground transition-colors hover:bg-accent">
              <ListFilter className="h-3 w-3 text-muted-foreground" />
              Channels
              {selectedChannels.length > 0 && (
                <span className="rounded-sm bg-primary px-1 text-[9px] font-semibold tabular-nums text-primary-foreground">
                  {selectedChannels.length}
                </span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 border-border bg-popover p-0">
            <Command className="bg-transparent">
              <CommandInput placeholder="Filter channels & events…" className="h-8 text-xs" />
              <CommandList className="max-h-72">
                <CommandEmpty className="py-4 text-center text-xs text-muted-foreground">
                  No matching channels.
                </CommandEmpty>
                <CommandGroup heading="Log channels">
                  {channels.map((ch) => (
                    <CommandItem key={ch} value={ch} onSelect={() => toggleChannel(ch)} className="gap-2 font-mono text-xs">
                      <Check className={`h-3 w-3 ${selectedChannels.includes(ch) ? "text-primary" : "invisible"}`} />
                      {ch}
                    </CommandItem>
                  ))}
                </CommandGroup>
                <CommandGroup heading="Business events">
                  {BUSINESS_EVENT_TYPES.map((et) => (
                    <CommandItem key={et} value={et} onSelect={() => toggleChannel(et)} className="gap-2 font-mono text-xs">
                      <Check className={`h-3 w-3 ${selectedChannels.includes(et) ? "text-primary" : "invisible"}`} />
                      {et}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
            {selectedChannels.length > 0 && (
              <div className="border-t border-border p-1.5">
                <button
                  onClick={() => onChangeChannels([])}
                  className="w-full rounded px-2 py-1 text-left text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  Clear selection — back to the full firehose
                </button>
              </div>
            )}
          </PopoverContent>
        </Popover>

        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {selectedChannels.length === 0 ? (
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Radio className="h-3 w-3" />
              Firehose — every channel, every scope
            </span>
          ) : (
            selectedChannels.map((ch) => (
              <span
                key={ch}
                className="flex shrink-0 items-center gap-1 rounded-sm border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-foreground"
              >
                {ch}
                <button
                  onClick={() => toggleChannel(ch)}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                  title={`Remove ${ch}`}
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ))
          )}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {BUCKET_TOGGLES.map(({ key, label, activeClass }) => (
            <button
              key={key}
              onClick={() => toggleBucket(key)}
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold transition-colors ${
                enabledBuckets.has(key) ? `${activeClass} bg-accent` : "text-muted-foreground/50 hover:text-muted-foreground"
              }`}
              title={enabledBuckets.has(key) ? `Hide ${label.toLowerCase()} lines` : `Show ${label.toLowerCase()} lines`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Pane grid — one pane per selected channel, or a single firehose pane */}
      <div className="flex min-h-0 flex-1 divide-x divide-border overflow-x-auto">
        {selectedChannels.length === 0 ? (
          <LogPane
            channel="*"
            title="all channels"
            isFirehose
            enabledBuckets={enabledBuckets}
            pinnedLines={pinnedByChannel["*"] ?? []}
            onUnpin={(lineId) => unpinLineFromChannel("*", lineId)}
            paneTargets={[]}
            onSendToPane={pinLineToChannel}
            onSendToNewPane={handleSendToNewPane}
          />
        ) : (
          selectedChannels.map((ch) => (
            <LogPane
              key={ch}
              channel={ch}
              title={ch}
              isEventType={EVENT_TYPE_SET.has(ch)}
              enabledBuckets={enabledBuckets}
              onClose={selectedChannels.length > 1 ? () => toggleChannel(ch) : undefined}
              pinnedLines={pinnedByChannel[ch] ?? []}
              onUnpin={(lineId) => unpinLineFromChannel(ch, lineId)}
              paneTargets={selectedChannels.filter((other) => other !== ch).map((other) => ({ channel: other, title: other }))}
              onSendToPane={pinLineToChannel}
              onSendToNewPane={handleSendToNewPane}
            />
          ))
        )}
      </div>
    </div>
  );
}
