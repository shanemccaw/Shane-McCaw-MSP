import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useSearch } from "wouter";
import {
  ChevronRight,
  LogOut,
  PanelRightOpen,
  Search,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAuth } from "@/contexts/AuthContext";
import { EmailBadgeContext } from "@/contexts/EmailBadgeContext";
import NotificationDrawer from "@/components/NotificationDrawer";
import { usePurchaseSound } from "@/hooks/usePurchaseSound";
import { playSoundFromParams } from "@/lib/playSound";
import { logger } from "@/lib/logger";
import {
  WORKSPACES,
  activeAncestorKeys,
  buildCmdKEntries,
  findWorkspace,
  groupNodeKey,
  isItemActive,
  resolveTabMeta,
  sectionNodeKey,
  type TreeItem,
} from "@/components/shell/workspaceNav";
import { PropertyPanelContext, type PropertySelection } from "@/components/shell/PropertyPanelContext";
import PropertyPanel from "@/components/shell/PropertyPanel";
import StatusBar, { type CampaignBadge } from "@/components/shell/StatusBar";
import ViewAsSwitcher from "@/components/shell/ViewAsSwitcher";
import ConsolePanel from "@/components/shell/ConsolePanel";
import CmdKDialog from "@/components/shell/CmdKDialog";

const log = logger.child({ channel: "admin.shell" });

// ─── LocalStorage helpers ─────────────────────────────────────────────────────

const LS_PROPS_COLLAPSED = "ide_props_collapsed";
const LS_BOTTOM_OPEN = "ide_bottom_open";
const LS_BOTTOM_HEIGHT = "ide_bottom_height";
const LS_EMAIL_LAST_SEEN = "emailActivityLastSeenAt";
// Set of expanded collapse-keys for the navigation tree. Absent/empty ⇒ every
// node starts collapsed (only the top-level workspace names are visible).
const LS_NAV_EXPANDED = "admin_nav_expanded";

function readBool(key: string, fallback: boolean): boolean {
  try { const v = localStorage.getItem(key); return v !== null ? v === "true" : fallback; } catch { return fallback; }
}
function readNum(key: string, fallback: number): number {
  try { const v = localStorage.getItem(key); return v !== null ? Number(v) : fallback; } catch { return fallback; }
}
function writeLs(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch {}
}

function readNavExpanded(): Set<string> {
  try {
    const raw = localStorage.getItem(LS_NAV_EXPANDED);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === "string"));
  } catch { return new Set(); }
}

function writeNavExpanded(set: Set<string>): void {
  try { localStorage.setItem(LS_NAV_EXPANDED, JSON.stringify([...set])); } catch {}
}

function readLastSeenAt(): number | null {
  try {
    const raw = localStorage.getItem(LS_EMAIL_LAST_SEEN);
    return raw ? parseInt(raw, 10) : null;
  } catch { return null; }
}

function saveLastSeenAt(ts: number): void {
  try { localStorage.setItem(LS_EMAIL_LAST_SEEN, String(ts)); } catch {}
}

// ─── Email badge polling ──────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 60_000;

// ─── Navigation tree ──────────────────────────────────────────────────────────

/** A leaf or a group node inside a section (recursive on `children`). */
function NavItem({
  item,
  depth,
  parentKey,
  pathname,
  search,
  isOpen,
  onToggle,
  onNavigate,
  unreadEmailCount,
}: {
  item: TreeItem;
  depth: number;
  parentKey: string;
  pathname: string;
  search: string;
  isOpen: (key: string) => boolean;
  onToggle: (key: string) => void;
  onNavigate: (item: TreeItem) => void;
  unreadEmailCount: number;
}) {
  const Icon = item.icon;
  const badge = item.badgeKey === "unreadEmail" ? unreadEmailCount : 0;

  if (item.children) {
    const key = groupNodeKey(parentKey, item.id);
    const open = isOpen(key);
    return (
      <div>
        <button
          onClick={() => onToggle(key)}
          className="w-full flex items-center gap-1.5 pr-2 py-1 text-xs font-medium transition-colors text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60"
          style={{ paddingLeft: `${depth * 12 + 22}px` }}
        >
          <ChevronRight
            className={`w-3 h-3 shrink-0 transition-transform duration-150 ${open ? "rotate-90" : ""}`}
          />
          {Icon && <Icon className="w-3.5 h-3.5 shrink-0" />}
          <span className="flex-1 truncate text-left">{item.label}</span>
        </button>
        {open && item.children.map(child => (
          <NavItem
            key={child.id}
            item={child}
            depth={depth + 1}
            parentKey={key}
            pathname={pathname}
            search={search}
            isOpen={isOpen}
            onToggle={onToggle}
            onNavigate={onNavigate}
            unreadEmailCount={unreadEmailCount}
          />
        ))}
      </div>
    );
  }

  const active = isItemActive(item, pathname, search);
  return (
    <button
      onClick={() => onNavigate(item)}
      className={`w-full flex items-center gap-2 pr-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60 ${
        active
          ? "bg-primary/10 text-primary border-r-2 border-primary"
          : "text-muted-foreground hover:bg-accent hover:text-foreground border-r-2 border-transparent"
      }`}
      style={{ paddingLeft: `${depth * 12 + 34}px` }}
    >
      {Icon && <Icon className="w-3.5 h-3.5 shrink-0" />}
      <span className="flex-1 truncate text-left">{item.label}</span>
      {badge > 0 && (
        <span className="min-w-[16px] h-4 bg-destructive text-white text-[9px] font-bold rounded-full flex items-center justify-center px-0.5 leading-none shrink-0">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </button>
  );
}

/** The single always-visible tree: every workspace → section → item, nested. */
function NavTree({
  pathname,
  search,
  isOpen,
  onToggle,
  onNavigate,
  unreadEmailCount,
}: {
  pathname: string;
  search: string;
  isOpen: (key: string) => boolean;
  onToggle: (key: string) => void;
  onNavigate: (item: TreeItem) => void;
  unreadEmailCount: number;
}) {
  return (
    <nav className="flex-1 overflow-y-auto py-1">
      {WORKSPACES.map(ws => {
        const WsIcon = ws.icon;
        const wsOpen = isOpen(ws.id);
        const wsBadge = ws.badgeKey === "unreadEmail" ? unreadEmailCount : 0;
        return (
          <div key={ws.id} className="mb-0.5">
            <button
              onClick={() => onToggle(ws.id)}
              className="w-full flex items-center gap-1.5 pl-2 pr-2 py-1.5 text-xs font-semibold text-foreground/90 hover:text-foreground hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60"
            >
              <ChevronRight
                className={`w-3.5 h-3.5 shrink-0 transition-transform duration-150 ${wsOpen ? "rotate-90" : ""}`}
              />
              <WsIcon className="w-4 h-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate text-left">{ws.label}</span>
              {wsBadge > 0 && (
                <span className="min-w-[16px] h-4 bg-destructive text-white text-[9px] font-bold rounded-full flex items-center justify-center px-0.5 leading-none shrink-0">
                  {wsBadge > 99 ? "99+" : wsBadge}
                </span>
              )}
            </button>

            {wsOpen && ws.sections.map(section => {
              const secKey = sectionNodeKey(ws.id, section.id);
              const secOpen = isOpen(secKey);
              return (
                <div key={section.id}>
                  <button
                    onClick={() => onToggle(secKey)}
                    className="w-full flex items-center gap-1.5 py-1 pr-2 text-[10px] font-mono font-semibold text-muted-foreground/80 uppercase tracking-widest hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60"
                    style={{ paddingLeft: "20px" }}
                  >
                    <ChevronRight
                      className={`w-2.5 h-2.5 shrink-0 transition-transform duration-150 ${secOpen ? "rotate-90" : ""}`}
                    />
                    <span className="flex-1 truncate text-left">{section.label}</span>
                  </button>
                  {secOpen && section.items.map(item => (
                    <NavItem
                      key={item.id}
                      item={item}
                      depth={0}
                      parentKey={secKey}
                      pathname={pathname}
                      search={search}
                      isOpen={isOpen}
                      onToggle={onToggle}
                      onNavigate={onNavigate}
                      unreadEmailCount={unreadEmailCount}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}

// ─── Main shell ───────────────────────────────────────────────────────────────

export default function GlobalIDEShell({ children }: { children: ReactNode }) {
  const { user, logout, fetchWithAuth, accessToken } = useAuth();
  const [location, navigate] = useLocation();
  const search = useSearch();
  const pathname = location;

  const workspace = useMemo(() => findWorkspace(pathname), [pathname]);
  const tabMeta = useMemo(() => resolveTabMeta(pathname), [pathname]);

  // ─── Panels ────────────────────────────────────────────────────────────────
  const [propsCollapsed, setPropsCollapsed] = useState(() => readBool(LS_PROPS_COLLAPSED, false));
  const [consoleOpen, setConsoleOpen] = useState(() => readBool(LS_BOTTOM_OPEN, false));
  const [consoleHeight, setConsoleHeight] = useState(() => readNum(LS_BOTTOM_HEIGHT, 200));
  const [cmdKOpen, setCmdKOpen] = useState(false);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);

  const toggleProps = useCallback(() => {
    setPropsCollapsed(v => { writeLs(LS_PROPS_COLLAPSED, String(!v)); return !v; });
  }, []);
  const toggleConsole = useCallback(() => {
    setConsoleOpen(v => { writeLs(LS_BOTTOM_OPEN, String(!v)); return !v; });
  }, []);

  // ─── Navigation tree expand/collapse state ─────────────────────────────────
  // `expanded` is the user's persisted, per-node choice (empty ⇒ all collapsed).
  // `forcedOpen` is the ancestor chain of the active leaf — force-expanded so a
  // deep-linked/refreshed page always reveals its own location, without mutating
  // the persisted state. A node is open when it is in either set.
  const [expanded, setExpanded] = useState<Set<string>>(() => readNavExpanded());
  const forcedOpen = useMemo(() => new Set(activeAncestorKeys(pathname, search)), [pathname, search]);

  const isNodeOpen = useCallback(
    (key: string) => expanded.has(key) || forcedOpen.has(key),
    [expanded, forcedOpen],
  );

  const toggleNode = useCallback((key: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      writeNavExpanded(next);
      return next;
    });
  }, []);

  const handleNavigate = useCallback((path: string) => {
    navigate(path);
  }, [navigate]);

  // ─── Workspace switch logging ──────────────────────────────────────────────
  const prevWsRef = useRef<string | null>(null);
  useEffect(() => {
    const id = workspace?.id ?? null;
    if (id && id !== prevWsRef.current) {
      log.info({ workspace: id }, `workspace: ${workspace?.label}`);
    }
    prevWsRef.current = id;
  }, [workspace]);

  // ─── Cmd+K / console keyboard shortcuts ────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdKOpen(o => !o);
      } else if (e.ctrlKey && e.key === "`") {
        e.preventDefault();
        toggleConsole();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleConsole]);

  const cmdKEntries = useMemo(() => buildCmdKEntries(), []);

  // ─── Console resize drag ───────────────────────────────────────────────────
  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startY: e.clientY, startH: consoleHeight };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = dragRef.current.startY - ev.clientY;
      const next = Math.max(100, Math.min(500, dragRef.current.startH + delta));
      setConsoleHeight(next);
      writeLs(LS_BOTTOM_HEIGHT, String(next));
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [consoleHeight]);

  // ─── Purchase sound ────────────────────────────────────────────────────────
  const { playPurchaseSound, muted: soundMuted, toggleMute } = usePurchaseSound();

  // ─── Sale flash toast ──────────────────────────────────────────────────────
  const [flashVisible, setFlashVisible] = useState(false);
  const [flashExiting, setFlashExiting] = useState(false);
  const [flashAmount, setFlashAmount] = useState<number | undefined>(undefined);
  const [flashServiceName, setFlashServiceName] = useState<string | undefined>(undefined);
  const flashEnterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashExitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerSaleFlash = useCallback((amount?: number, serviceName?: string) => {
    if (flashEnterTimerRef.current) clearTimeout(flashEnterTimerRef.current);
    if (flashExitTimerRef.current) clearTimeout(flashExitTimerRef.current);
    setFlashAmount(amount);
    setFlashServiceName(serviceName);
    setFlashExiting(false);
    setFlashVisible(true);
    flashEnterTimerRef.current = setTimeout(() => {
      setFlashExiting(true);
      flashExitTimerRef.current = setTimeout(() => {
        setFlashVisible(false);
        setFlashExiting(false);
      }, 350);
    }, 2800);
  }, []);

  // ─── Lead flash toast ──────────────────────────────────────────────────────
  const [leadFlashVisible, setLeadFlashVisible] = useState(false);
  const [leadFlashExiting, setLeadFlashExiting] = useState(false);
  const leadFlashEnterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leadFlashExitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerLeadFlash = useCallback(() => {
    if (leadFlashEnterTimerRef.current) clearTimeout(leadFlashEnterTimerRef.current);
    if (leadFlashExitTimerRef.current) clearTimeout(leadFlashExitTimerRef.current);
    setLeadFlashExiting(false);
    setLeadFlashVisible(true);
    leadFlashEnterTimerRef.current = setTimeout(() => {
      setLeadFlashExiting(true);
      leadFlashExitTimerRef.current = setTimeout(() => {
        setLeadFlashVisible(false);
        setLeadFlashExiting(false);
      }, 350);
    }, 2800);
  }, []);

  // ─── Email badge (unread count + polling) ──────────────────────────────────
  const [unreadEmailCount, setUnreadEmailCount] = useState(0);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchCount = useCallback(async () => {
    const lastSeen = readLastSeenAt();
    const url = lastSeen
      ? `/api/admin/emails/unread-count?since=${lastSeen}`
      : "/api/admin/emails/unread-count";
    try {
      const res = await fetch(url, { credentials: "include" });
      if (res.ok) {
        const data = await res.json() as { count: number };
        setUnreadEmailCount(data.count);
      }
    } catch {}
  }, []);

  const refreshUnreadCount = useCallback(() => { void fetchCount(); }, [fetchCount]);

  useEffect(() => {
    const isInbox = pathname === "/inbox" || pathname === "/system/inbox";
    if (isInbox) {
      saveLastSeenAt(Date.now());
      setUnreadEmailCount(0);
      if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null; }
      return;
    }
    void fetchCount();
    pollTimerRef.current = setInterval(() => void fetchCount(), POLL_INTERVAL_MS);
    return () => {
      if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null; }
    };
  }, [pathname, fetchCount]);

  // ─── Live visitors (SSE with polling fallback) ─────────────────────────────
  const [liveVisitors, setLiveVisitors] = useState<number | null>(null);
  const liveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLiveVisitors = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/admin/analytics/live");
      if (res.ok) {
        const d = await res.json() as { live: number };
        setLiveVisitors(d.live);
      }
    } catch {}
  }, [fetchWithAuth]);

  const startLiveSSE = useCallback(async (signal: AbortSignal) => {
    try {
      const res = await fetchWithAuth("/api/admin/analytics/live-stream", { signal });
      if (!res.ok || !res.body) return false;

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        if (signal.aborted) break;
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const dataLine = part.split("\n").find(l => l.startsWith("data: "));
          if (!dataLine) continue;
          try {
            const parsed = JSON.parse(dataLine.slice(6)) as { live: number };
            setLiveVisitors(parsed.live);
          } catch {}
        }
      }
      return true;
    } catch {
      // An intentional abort (proactive reconnect or unmount) must be treated as
      // a clean close (true) so the connect loop schedules a reconnect instead of
      // falling back to polling.
      return signal.aborted;
    }
  }, [fetchWithAuth]);

  // ─── Campaign badges (SSE with polling fallback) ───────────────────────────
  const [campaignBadges, setCampaignBadges] = useState<CampaignBadge[]>([]);
  const campaignTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchCampaignBadges = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/admin/marketing/active-campaign-badges");
      if (res.ok) {
        const d = await res.json() as CampaignBadge[];
        setCampaignBadges(d);
      }
    } catch {}
  }, [fetchWithAuth]);

  const startCampaignSSE = useCallback(async (signal: AbortSignal) => {
    try {
      const res = await fetchWithAuth("/api/admin/marketing/campaign-badges-stream", { signal });
      if (!res.ok || !res.body) return false;

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        if (signal.aborted) break;
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const dataLine = part.split("\n").find(l => l.startsWith("data: "));
          if (!dataLine) continue;
          try {
            const parsed = JSON.parse(dataLine.slice(6)) as CampaignBadge[];
            setCampaignBadges(parsed);
          } catch {}
        }
      }
      return true;
    } catch {
      return signal.aborted;
    }
  }, [fetchWithAuth]);

  // ─── Workflow sound SSE consumer ───────────────────────────────────────────
  // Connects to the admin workflow events stream and plays sounds when the
  // play_sound node (Browser target) fires during a workflow run.
  const startWorkflowSoundSSE = useCallback(async (signal: AbortSignal) => {
    try {
      const res = await fetchWithAuth("/api/admin/workflows/sound-events", { signal });
      if (!res.ok || !res.body) return false;

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        if (signal.aborted) break;
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const dataLine = part.split("\n").find(l => l.startsWith("data: "));
          if (!dataLine) continue;
          try {
            const parsed = JSON.parse(dataLine.slice(6)) as { type?: string; source?: unknown };
            if (parsed.type === "play_sound" && parsed.source) {
              log.info("workflow sound event received");
              void playSoundFromParams(parsed.source as Parameters<typeof playSoundFromParams>[0]);
            }
          } catch {}
        }
      }
      return true;
    } catch {
      return signal.aborted;
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    const outerAbort = new AbortController();
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let streamAbort: AbortController | null = null;

    const connect = async () => {
      if (outerAbort.signal.aborted) return;
      streamAbort = new AbortController();
      const ok = await startWorkflowSoundSSE(streamAbort.signal);
      if (!outerAbort.signal.aborted) {
        retryTimer = setTimeout(connect, ok ? 1000 : 5000);
      }
    };

    void connect();
    return () => {
      outerAbort.abort();
      streamAbort?.abort();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [startWorkflowSoundSSE]);

  // ─── Service worker PLAY_WORKFLOW_SOUND handler ────────────────────────────
  // Handles sounds delivered via desktop push notification.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const handleSwMessage = (event: MessageEvent) => {
      if (event.data?.type !== "PLAY_WORKFLOW_SOUND") return;
      try {
        const source = JSON.parse(event.data.source as string) as Parameters<typeof playSoundFromParams>[0];
        void playSoundFromParams(source);
      } catch {}
    };
    navigator.serviceWorker.addEventListener("message", handleSwMessage);
    return () => navigator.serviceWorker.removeEventListener("message", handleSwMessage);
  }, []);

  // Returns how many ms until 1 minute before the JWT's exp claim.
  // Returns null if the token is missing or malformed.
  const getProactiveReconnectDelayMs = useCallback((token: string | null): number | null => {
    if (!token) return null;
    try {
      const payload = JSON.parse(atob(token.split(".")[1])) as { exp?: number };
      if (typeof payload.exp !== "number") return null;
      const ms = payload.exp * 1000 - Date.now() - 60_000;
      return ms > 0 ? ms : null;
    } catch { return null; }
  }, []);

  useEffect(() => {
    const outerAbort = new AbortController();

    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let proactiveTimer: ReturnType<typeof setTimeout> | null = null;
    let streamAbort: AbortController | null = null;

    const connect = async () => {
      if (outerAbort.signal.aborted) return;

      const localAbort = new AbortController();
      streamAbort = localAbort;

      // Forward the outer (unmount) abort into the per-stream controller
      const forwardAbort = () => { if (!localAbort.signal.aborted) localAbort.abort(); };
      outerAbort.signal.addEventListener("abort", forwardAbort);

      // Proactively abort 1 minute before the current token expires so the
      // stream reconnects while the token is still valid.
      const delay = getProactiveReconnectDelayMs(accessToken);
      if (delay !== null) {
        proactiveTimer = setTimeout(() => { if (!localAbort.signal.aborted) localAbort.abort(); }, delay);
      }

      const ok = await startLiveSSE(localAbort.signal);

      if (proactiveTimer) { clearTimeout(proactiveTimer); proactiveTimer = null; }
      outerAbort.signal.removeEventListener("abort", forwardAbort);

      if (outerAbort.signal.aborted) return;

      if (!ok) {
        log.warn("live-visitor stream unavailable — falling back to polling");
        void fetchLiveVisitors();
        liveTimerRef.current = setInterval(() => void fetchLiveVisitors(), 30_000);
      } else {
        retryTimer = setTimeout(() => void connect(), 3_000);
      }
    };

    void connect();

    return () => {
      outerAbort.abort();
      streamAbort?.abort();
      if (retryTimer) clearTimeout(retryTimer);
      if (proactiveTimer) clearTimeout(proactiveTimer);
      if (liveTimerRef.current) { clearInterval(liveTimerRef.current); liveTimerRef.current = null; }
    };
  }, [startLiveSSE, fetchLiveVisitors, accessToken, getProactiveReconnectDelayMs]);

  useEffect(() => {
    const outerAbort = new AbortController();

    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let proactiveTimer: ReturnType<typeof setTimeout> | null = null;
    let streamAbort: AbortController | null = null;

    const connect = async () => {
      if (outerAbort.signal.aborted) return;

      const localAbort = new AbortController();
      streamAbort = localAbort;

      // Forward the outer (unmount) abort into the per-stream controller
      const forwardAbort = () => { if (!localAbort.signal.aborted) localAbort.abort(); };
      outerAbort.signal.addEventListener("abort", forwardAbort);

      // Proactively abort 1 minute before the current token expires so the
      // stream reconnects while the token is still valid.
      const delay = getProactiveReconnectDelayMs(accessToken);
      if (delay !== null) {
        proactiveTimer = setTimeout(() => { if (!localAbort.signal.aborted) localAbort.abort(); }, delay);
      }

      const ok = await startCampaignSSE(localAbort.signal);

      if (proactiveTimer) { clearTimeout(proactiveTimer); proactiveTimer = null; }
      outerAbort.signal.removeEventListener("abort", forwardAbort);

      if (outerAbort.signal.aborted) return;

      if (!ok) {
        log.warn("campaign-badge stream unavailable — falling back to polling");
        void fetchCampaignBadges();
        campaignTimerRef.current = setInterval(() => void fetchCampaignBadges(), 15_000);
      } else {
        retryTimer = setTimeout(() => void connect(), 3_000);
      }
    };

    void connect();

    return () => {
      outerAbort.abort();
      streamAbort?.abort();
      if (retryTimer) clearTimeout(retryTimer);
      if (proactiveTimer) clearTimeout(proactiveTimer);
      if (campaignTimerRef.current) { clearInterval(campaignTimerRef.current); campaignTimerRef.current = null; }
    };
  }, [startCampaignSSE, fetchCampaignBadges, accessToken, getProactiveReconnectDelayMs]);

  // ─── Notification drawer ───────────────────────────────────────────────────
  const [notifDrawerOpen, setNotifDrawerOpen] = useState(false);
  const [unreadNotifCount, setUnreadNotifCount] = useState(0);

  const handleLogout = async () => { await logout(); };

  // ─── Property Panel selection ──────────────────────────────────────────────
  const [propertySelection, setPropertySelection] = useState<PropertySelection | null>(null);
  const propertyCtx = useMemo(
    () => ({ selection: propertySelection, setSelection: setPropertySelection }),
    [propertySelection],
  );

  const explorerFallback: PropertySelection | null = useMemo(() => ({
    source: "tab",
    title: tabMeta.label,
    subtitle: workspace?.description,
    properties: [
      { label: "Workspace", value: workspace?.label ?? "—" },
      { label: "Route", value: pathname, mono: true },
    ],
  }), [tabMeta.label, workspace, pathname]);

  const handleNavItemClick = useCallback((item: TreeItem) => {
    if (!item.path) return;
    setPropertySelection({
      source: "explorer",
      title: item.label,
      subtitle: workspace ? `${workspace.label} workspace` : undefined,
      properties: [
        { label: "Workspace", value: workspace?.label ?? "—" },
        { label: "Route", value: item.path, mono: true },
        { label: "Kind", value: "Navigation item" },
      ],
    });
    navigate(item.path);
  }, [navigate, workspace]);

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <TooltipProvider delayDuration={300}>
      <PropertyPanelContext.Provider value={propertyCtx}>
        <div className="flex flex-col h-full overflow-hidden bg-background">
          <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* ── Sidebar: single full navigation tree ── */}
            <div className="shrink-0 w-64 flex flex-col bg-card border-r border-border overflow-hidden">
              {/* Header: brand + property-panel reopen + Cmd+K */}
              <div className="flex items-center gap-1 pl-3 pr-1.5 py-2 border-b border-border shrink-0">
                <span className="flex-1 text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-widest truncate">
                  Admin Console
                </span>
                {propsCollapsed && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={toggleProps}
                        aria-label="Show properties"
                        className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground/70 hover:text-foreground hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                      >
                        <PanelRightOpen className="w-3.5 h-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Show properties</TooltipContent>
                  </Tooltip>
                )}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => setCmdKOpen(true)}
                      aria-label="Quick Jump (⌘K)"
                      className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground/70 hover:text-foreground hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                    >
                      <Search className="w-3.5 h-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Quick Jump ⌘K</TooltipContent>
                </Tooltip>
              </div>

              {/* The tree */}
              <NavTree
                pathname={pathname}
                search={search}
                isOpen={isNodeOpen}
                onToggle={toggleNode}
                onNavigate={handleNavItemClick}
                unreadEmailCount={unreadEmailCount}
              />

              {/* Footer: user identity + sign out */}
              <div className="flex items-center gap-2 px-2.5 py-2 border-t border-border shrink-0">
                <div className="w-7 h-7 bg-primary/15 border border-primary/30 rounded-full flex items-center justify-center shrink-0">
                  <span className="text-[11px] font-bold text-primary uppercase leading-none">
                    {user?.email?.[0] ?? "A"}
                  </span>
                </div>
                <div className="flex-1 min-w-0 leading-tight">
                  <p className="text-xs font-semibold text-foreground truncate">Shane McCaw</p>
                  <p className="text-[10px] text-muted-foreground truncate">{user?.email ?? "Administrator"}</p>
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={handleLogout}
                      aria-label="Sign out"
                      className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground/70 hover:text-foreground hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 shrink-0"
                    >
                      <LogOut className="w-4 h-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">Sign out</TooltipContent>
                </Tooltip>
              </div>
            </div>

            {/* ── Center: content + console ── */}
            <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
              <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                <main className="flex-1 min-h-0 overflow-hidden relative bg-background">
                  <EmailBadgeContext.Provider value={{ refreshUnreadCount }}>
                    <div className="absolute inset-0 overflow-y-auto">
                      {children}
                    </div>
                  </EmailBadgeContext.Provider>
                </main>

                {consoleOpen && (
                  <>
                    <div
                      className="shrink-0 h-1 bg-border hover:bg-primary/60 cursor-row-resize transition-colors"
                      onMouseDown={onResizeStart}
                    />
                    <div
                      className="shrink-0 border-t border-border overflow-hidden"
                      style={{ height: consoleHeight }}
                    >
                      <ConsolePanel onClose={toggleConsole} />
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* ── Property Panel ── */}
            <div
              className={`shrink-0 border-l border-border transition-all duration-200 overflow-hidden ${
                propsCollapsed ? "w-0 border-l-0" : "w-64"
              }`}
            >
              <PropertyPanel fallback={explorerFallback} onCollapse={toggleProps} />
            </div>
          </div>

          {/* ── Status bar ── */}
          <StatusBar
            workspaceLabel={workspace?.label ?? null}
            sectionLabel={tabMeta.label}
            liveVisitors={liveVisitors}
            campaignBadges={campaignBadges}
            unreadEmailCount={unreadEmailCount}
            unreadNotifCount={unreadNotifCount}
            onBellClick={() => setNotifDrawerOpen(true)}
            soundMuted={soundMuted}
            onToggleMute={toggleMute}
            consoleOpen={consoleOpen}
            onToggleConsole={toggleConsole}
            rightExtra={<ViewAsSwitcher />}
          />
        </div>

        {/* ── Cmd+K ── */}
        {cmdKOpen && (
          <CmdKDialog
            entries={cmdKEntries}
            onSelect={handleNavigate}
            onClose={() => setCmdKOpen(false)}
          />
        )}

        {/* ── Notification drawer ── */}
        <NotificationDrawer
          open={notifDrawerOpen}
          onOpenChange={setNotifDrawerOpen}
          unreadCount={unreadNotifCount}
          onUnreadCountChange={setUnreadNotifCount}
          onPurchaseSound={playPurchaseSound}
          onPurchaseFlash={triggerSaleFlash}
          onLeadFlash={triggerLeadFlash}
        />

        {/* ── Sale flash toast ── */}
        {flashVisible && (
          <button
            onClick={() => {
              if (flashEnterTimerRef.current) clearTimeout(flashEnterTimerRef.current);
              if (flashExitTimerRef.current) clearTimeout(flashExitTimerRef.current);
              setFlashVisible(false);
              setFlashExiting(false);
              navigate("/finance/purchases");
            }}
            className={`fixed top-4 right-4 z-[9999] flex items-center gap-2.5 px-4 py-3 rounded-lg shadow-2xl border border-emerald-500/30 bg-popover/95 backdrop-blur-sm cursor-pointer hover:border-emerald-500/50 transition-colors ${
              flashExiting ? "sale-flash-exit" : "sale-flash-enter"
            }`}
          >
            <span className="text-xl leading-none">💰</span>
            <div className="leading-tight text-left">
              <p className="text-sm font-bold text-emerald-300">New sale!</p>
              <p className="text-[11px] text-emerald-500/80 font-medium font-mono tabular-nums">
                {flashServiceName && flashAmount !== undefined
                  ? `${flashServiceName} — $${flashAmount.toLocaleString()}`
                  : flashServiceName
                    ? flashServiceName
                    : flashAmount !== undefined
                      ? `$${flashAmount.toLocaleString()}`
                      : "A purchase just came in"}
              </p>
            </div>
          </button>
        )}

        {/* ── Lead flash toast ── */}
        {leadFlashVisible && (
          <button
            onClick={() => {
              if (leadFlashEnterTimerRef.current) clearTimeout(leadFlashEnterTimerRef.current);
              if (leadFlashExitTimerRef.current) clearTimeout(leadFlashExitTimerRef.current);
              setLeadFlashVisible(false);
              setLeadFlashExiting(false);
              navigate("/pipeline/leads");
            }}
            style={{ top: flashVisible ? "88px" : "16px" }}
            className={`fixed right-4 z-[9999] flex items-center gap-2.5 px-4 py-3 rounded-lg shadow-2xl border border-primary/30 bg-popover/95 backdrop-blur-sm cursor-pointer hover:border-primary/50 transition-[background-color,border-color,top] ${
              leadFlashExiting ? "sale-flash-exit" : "sale-flash-enter"
            }`}
          >
            <span className="text-xl leading-none">👤</span>
            <div className="leading-tight text-left">
              <p className="text-sm font-bold text-primary">New lead!</p>
              <p className="text-[11px] text-primary/80 font-medium">A new lead just came in</p>
            </div>
          </button>
        )}
      </PropertyPanelContext.Provider>
    </TooltipProvider>
  );
}
