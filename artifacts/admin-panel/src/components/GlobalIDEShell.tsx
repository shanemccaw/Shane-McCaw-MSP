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
  PanelLeftOpen,
  PanelRightOpen,
  Search,
  X,
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
  buildCmdKEntries,
  findWorkspace,
  isItemActive,
  resolveTabMeta,
  type TreeItem,
  type WorkspaceDef,
} from "@/components/shell/workspaceNav";
import { closeTab as engineCloseTab, openTab as engineOpenTab, type TabState } from "@/components/shell/tabEngine";
import { PropertyPanelContext, type PropertySelection } from "@/components/shell/PropertyPanelContext";
import PropertyPanel from "@/components/shell/PropertyPanel";
import StatusBar, { type CampaignBadge } from "@/components/shell/StatusBar";
import ViewAsSwitcher from "@/components/shell/ViewAsSwitcher";
import ConsolePanel from "@/components/shell/ConsolePanel";
import CmdKDialog from "@/components/shell/CmdKDialog";

const log = logger.child({ channel: "admin.shell" });

// ─── LocalStorage helpers ─────────────────────────────────────────────────────

const LS_EXPLORER_COLLAPSED = "ide_explorer_collapsed";
const LS_PROPS_COLLAPSED = "ide_props_collapsed";
const LS_BOTTOM_OPEN = "ide_bottom_open";
const LS_BOTTOM_HEIGHT = "ide_bottom_height";
const LS_EMAIL_LAST_SEEN = "emailActivityLastSeenAt";

function readBool(key: string, fallback: boolean): boolean {
  try { const v = localStorage.getItem(key); return v !== null ? v === "true" : fallback; } catch { return fallback; }
}
function readNum(key: string, fallback: number): number {
  try { const v = localStorage.getItem(key); return v !== null ? Number(v) : fallback; } catch { return fallback; }
}
function writeLs(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch {}
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

// ─── Activity Bar ─────────────────────────────────────────────────────────────

function ActivityBar({
  activeWorkspaceId,
  unreadEmailCount,
  onNavigate,
  onCmdK,
  userEmail,
  onLogout,
}: {
  activeWorkspaceId: string | null;
  unreadEmailCount: number;
  onNavigate: (path: string) => void;
  onCmdK: () => void;
  userEmail?: string;
  onLogout: () => void;
}) {
  return (
    <div className="shrink-0 w-12 flex flex-col items-center bg-card border-r border-border py-2 gap-0.5">
      {WORKSPACES.map(ws => {
        const Icon = ws.icon;
        const isActive = ws.id === activeWorkspaceId;
        const badge = ws.badgeKey === "unreadEmail" ? unreadEmailCount : 0;
        return (
          <Tooltip key={ws.id}>
            <TooltipTrigger asChild>
              <button
                onClick={() => onNavigate(ws.defaultPath)}
                aria-label={ws.label}
                className={`relative w-9 h-9 flex items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 ${
                  isActive
                    ? "text-primary bg-primary/10"
                    : "text-muted-foreground/70 hover:text-foreground hover:bg-accent"
                }`}
              >
                {isActive && (
                  <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-primary" />
                )}
                <Icon className="w-[18px] h-[18px]" />
                {badge > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] bg-destructive text-white text-[9px] font-bold rounded-full flex items-center justify-center px-0.5 leading-none">
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <span className="font-semibold">{ws.label}</span>
              <span className="block text-xs text-muted-foreground mt-0.5">{ws.description}</span>
            </TooltipContent>
          </Tooltip>
        );
      })}

      <div className="flex-1" />

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onCmdK}
            aria-label="Quick Jump (⌘K)"
            className="w-9 h-9 flex items-center justify-center rounded-md text-muted-foreground/70 hover:text-foreground hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <Search className="w-4 h-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">Quick Jump ⌘K</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <div className="w-7 h-7 my-1.5 bg-primary/15 border border-primary/30 rounded-full flex items-center justify-center cursor-default">
            <span className="text-[11px] font-bold text-primary uppercase leading-none">
              {userEmail?.[0] ?? "A"}
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="right">
          <span className="font-semibold">Shane McCaw</span>
          <span className="block text-xs text-muted-foreground mt-0.5">{userEmail ?? "Administrator"}</span>
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onLogout}
            aria-label="Sign out"
            className="w-9 h-9 flex items-center justify-center rounded-md text-muted-foreground/70 hover:text-foreground hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">Sign out</TooltipContent>
      </Tooltip>
    </div>
  );
}

// ─── Explorer tree ────────────────────────────────────────────────────────────

function ExplorerTreeItem({
  item,
  depth,
  pathname,
  search,
  openGroups,
  onToggleGroup,
  onItemClick,
  unreadEmailCount,
}: {
  item: TreeItem;
  depth: number;
  pathname: string;
  search: string;
  openGroups: Set<string>;
  onToggleGroup: (id: string) => void;
  onItemClick: (item: TreeItem) => void;
  unreadEmailCount: number;
}) {
  const Icon = item.icon;
  const badge = item.badgeKey === "unreadEmail" ? unreadEmailCount : 0;

  if (item.children) {
    const childActive = item.children.some(c => isItemActive(c, pathname, search));
    const isOpen = openGroups.has(item.id) || childActive;
    return (
      <div>
        <button
          onClick={() => onToggleGroup(item.id)}
          className={`w-full flex items-center gap-1.5 pr-2 py-1 text-xs font-medium transition-colors text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60`}
          style={{ paddingLeft: `${depth * 12 + 10}px` }}
        >
          <ChevronRight
            className={`w-3 h-3 shrink-0 transition-transform duration-150 ${isOpen ? "rotate-90" : ""}`}
          />
          {Icon && <Icon className="w-3.5 h-3.5 shrink-0" />}
          <span className="flex-1 truncate text-left">{item.label}</span>
        </button>
        {isOpen && item.children.map(child => (
          <ExplorerTreeItem
            key={child.id}
            item={child}
            depth={depth + 1}
            pathname={pathname}
            search={search}
            openGroups={openGroups}
            onToggleGroup={onToggleGroup}
            onItemClick={onItemClick}
            unreadEmailCount={unreadEmailCount}
          />
        ))}
      </div>
    );
  }

  const active = isItemActive(item, pathname, search);
  return (
    <button
      onClick={() => onItemClick(item)}
      className={`w-full flex items-center gap-2 pr-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60 ${
        active
          ? "bg-primary/10 text-primary border-r-2 border-primary"
          : "text-muted-foreground hover:bg-accent hover:text-foreground border-r-2 border-transparent"
      }`}
      style={{ paddingLeft: `${depth * 12 + 22}px` }}
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

function Explorer({
  workspace,
  pathname,
  search,
  onItemClick,
  onCollapse,
  unreadEmailCount,
}: {
  workspace: WorkspaceDef | null;
  pathname: string;
  search: string;
  onItemClick: (item: TreeItem) => void;
  onCollapse: () => void;
  unreadEmailCount: number;
}) {
  // Section + group open state, reset per workspace
  const [openSections, setOpenSections] = useState<Set<string>>(() => new Set());
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set());
  const wsIdRef = useRef<string | null>(null);

  if (workspace && wsIdRef.current !== workspace.id) {
    wsIdRef.current = workspace.id;
    // Re-derive defaults when the workspace changes (render-time derivation
    // keeps first paint correct).
    const defaults = workspace.sections.filter(s => s.defaultOpen !== false).map(s => s.id);
    setOpenSections(new Set(defaults));
    setOpenGroups(new Set());
  }

  const toggleSection = useCallback((id: string) => {
    setOpenSections(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleGroup = useCallback((id: string) => {
    setOpenGroups(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  return (
    <div className="h-full flex flex-col bg-card">
      <div className="flex items-center justify-between pl-3 pr-2 py-2 border-b border-border shrink-0">
        <span className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-widest truncate">
          {workspace?.label ?? "Explorer"}
        </span>
        <button
          onClick={onCollapse}
          title="Collapse explorer"
          className="p-1 rounded text-muted-foreground/70 hover:text-foreground hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <ChevronRight className="w-3.5 h-3.5 rotate-180" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto py-1">
        {workspace?.sections.map(section => {
          const isOpen = openSections.has(section.id) ||
            section.items.some(i => isItemActive(i, pathname, search) || (i.children?.some(c => isItemActive(c, pathname, search)) ?? false));
          return (
            <div key={section.id} className="mb-0.5">
              <button
                onClick={() => toggleSection(section.id)}
                className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-mono font-semibold text-muted-foreground/80 uppercase tracking-widest hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60"
              >
                <ChevronRight
                  className={`w-2.5 h-2.5 shrink-0 transition-transform duration-150 ${isOpen ? "rotate-90" : ""}`}
                />
                {section.label}
              </button>
              {isOpen && section.items.map(item => (
                <ExplorerTreeItem
                  key={item.id}
                  item={item}
                  depth={0}
                  pathname={pathname}
                  search={search}
                  openGroups={openGroups}
                  onToggleGroup={toggleGroup}
                  onItemClick={onItemClick}
                  unreadEmailCount={unreadEmailCount}
                />
              ))}
            </div>
          );
        })}
        {!workspace && (
          <p className="text-xs text-muted-foreground/70 px-3 py-4">No workspace selected.</p>
        )}
      </nav>
    </div>
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
  const [explorerCollapsed, setExplorerCollapsed] = useState(() => readBool(LS_EXPLORER_COLLAPSED, false));
  const [propsCollapsed, setPropsCollapsed] = useState(() => readBool(LS_PROPS_COLLAPSED, false));
  const [consoleOpen, setConsoleOpen] = useState(() => readBool(LS_BOTTOM_OPEN, false));
  const [consoleHeight, setConsoleHeight] = useState(() => readNum(LS_BOTTOM_HEIGHT, 200));
  const [cmdKOpen, setCmdKOpen] = useState(false);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);

  const toggleExplorer = useCallback(() => {
    setExplorerCollapsed(v => { writeLs(LS_EXPLORER_COLLAPSED, String(!v)); return !v; });
  }, []);
  const toggleProps = useCallback(() => {
    setPropsCollapsed(v => { writeLs(LS_PROPS_COLLAPSED, String(!v)); return !v; });
  }, []);
  const toggleConsole = useCallback(() => {
    setConsoleOpen(v => { writeLs(LS_BOTTOM_OPEN, String(!v)); return !v; });
  }, []);

  // ─── Tabs — URL is the source of truth for the active tab ──────────────────
  const [tabState, setTabState] = useState<TabState>({ tabs: [], activeId: null });
  const tabContentRef = useRef(new Map<string, ReactNode>());
  // Last full href per tab (pathname key) so re-activating a tab restores its
  // internal ?tab= state (Marketing sections, Baseline Templates sections).
  const lastHrefRef = useRef(new Map<string, string>());

  // Cache the current route's element under its tab key (render-time so the
  // active tab always renders fresh props).
  tabContentRef.current.set(pathname, children);
  lastHrefRef.current.set(pathname, search ? `${pathname}?${search}` : pathname);

  useEffect(() => {
    setTabState(prev => {
      const next = engineOpenTab(prev, pathname, tabMeta.label);
      if (next.tabs.length !== prev.tabs.length) {
        log.info({ path: pathname }, `tab opened: ${tabMeta.label}`);
      }
      return next;
    });
  }, [pathname, tabMeta.label]);

  const handleTabClose = useCallback((id: string) => {
    setTabState(prev => {
      const { state, nextActiveId } = engineCloseTab(prev, id);
      tabContentRef.current.delete(id);
      lastHrefRef.current.delete(id);
      log.info({ path: id }, "tab closed");
      if (prev.activeId === id || id === pathname) {
        // Closing the active tab: move to the next tab or the workspace default
        const fallback = findWorkspace(pathname)?.defaultPath ?? "/command/overview";
        const target = nextActiveId ?? fallback;
        navigate(lastHrefRef.current.get(target) ?? target);
      }
      return state;
    });
  }, [navigate, pathname]);

  const handleNavigate = useCallback((path: string) => {
    navigate(path);
  }, [navigate]);

  const handleTabSelect = useCallback((id: string) => {
    navigate(lastHrefRef.current.get(id) ?? id);
  }, [navigate]);

  // Prune cached content for tabs that no longer exist (safety net)
  useEffect(() => {
    const live = new Set(tabState.tabs.map(t => t.id));
    live.add(pathname);
    for (const key of [...tabContentRef.current.keys()]) {
      if (!live.has(key)) tabContentRef.current.delete(key);
    }
  }, [tabState.tabs, pathname]);

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
      { label: "Open tabs", value: tabState.tabs.length, mono: true },
    ],
  }), [tabMeta.label, workspace, pathname, tabState.tabs.length]);

  const handleExplorerItemClick = useCallback((item: TreeItem) => {
    if (!item.path) return;
    setPropertySelection({
      source: "explorer",
      title: item.label,
      subtitle: workspace ? `${workspace.label} workspace` : undefined,
      properties: [
        { label: "Workspace", value: workspace?.label ?? "—" },
        { label: "Route", value: item.path, mono: true },
        { label: "Kind", value: "Explorer item" },
      ],
    });
    navigate(item.path);
  }, [navigate, workspace]);

  // ─── Render ────────────────────────────────────────────────────────────────
  const renderedTabs = useMemo(() => {
    const list = tabState.tabs.map(t => t.id);
    if (!list.includes(pathname)) list.push(pathname);
    return list;
  }, [tabState.tabs, pathname]);

  return (
    <TooltipProvider delayDuration={300}>
      <PropertyPanelContext.Provider value={propertyCtx}>
        <div className="flex flex-col h-full overflow-hidden bg-background">
          <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* ── Activity Bar ── */}
            <ActivityBar
              activeWorkspaceId={workspace?.id ?? null}
              unreadEmailCount={unreadEmailCount}
              onNavigate={handleNavigate}
              onCmdK={() => setCmdKOpen(true)}
              userEmail={user?.email}
              onLogout={handleLogout}
            />

            {/* ── Explorer ── */}
            <div
              className={`shrink-0 border-r border-border transition-all duration-200 overflow-hidden ${
                explorerCollapsed ? "w-0 border-r-0" : "w-56"
              }`}
            >
              <Explorer
                workspace={workspace}
                pathname={pathname}
                search={search}
                onItemClick={handleExplorerItemClick}
                onCollapse={toggleExplorer}
                unreadEmailCount={unreadEmailCount}
              />
            </div>

            {/* ── Center: tab bar + content + console ── */}
            <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
              {/* Tab bar */}
              <div className="shrink-0 flex items-center bg-card border-b border-border">
                {explorerCollapsed && (
                  <button
                    onClick={toggleExplorer}
                    title="Show explorer"
                    className="shrink-0 w-8 h-8 flex items-center justify-center text-muted-foreground/70 hover:text-foreground transition-colors border-r border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60"
                  >
                    <PanelLeftOpen className="w-3.5 h-3.5" />
                  </button>
                )}

                <div className="flex items-stretch overflow-x-auto flex-1 min-w-0">
                  {renderedTabs.map(id => {
                    const tab = tabState.tabs.find(t => t.id === id);
                    const label = tab?.label ?? resolveTabMeta(id).label;
                    const isActive = id === pathname;
                    return (
                      <div
                        key={id}
                        role="tab"
                        aria-selected={isActive}
                        tabIndex={0}
                        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleTabSelect(id); } }}
                        className={`group relative flex items-center gap-1.5 pl-3 pr-1.5 border-r border-border shrink-0 cursor-pointer text-xs font-mono transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60 ${
                          isActive
                            ? "bg-background text-foreground"
                            : "text-muted-foreground hover:text-foreground hover:bg-accent"
                        }`}
                        onClick={() => handleTabSelect(id)}
                      >
                        {isActive && (
                          <span className="absolute top-0 left-0 right-0 h-0.5 bg-primary" />
                        )}
                        <span className="truncate max-w-[140px] py-2">{label}</span>
                        <button
                          onClick={e => { e.stopPropagation(); handleTabClose(id); }}
                          title="Close tab"
                          className={`shrink-0 w-4 h-4 flex items-center justify-center rounded text-muted-foreground/50 hover:text-foreground hover:bg-border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 ${
                            isActive ? "" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                          }`}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>

                {/* Right actions */}
                <div className="flex items-center gap-0.5 px-1.5 shrink-0 border-l border-border">
                  {propsCollapsed && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={toggleProps}
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
                        className="hidden md:flex w-7 h-7 items-center justify-center rounded text-muted-foreground/70 hover:text-foreground hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                      >
                        <kbd className="text-[9px] font-mono font-medium">⌘K</kbd>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Quick Jump</TooltipContent>
                  </Tooltip>
                </div>
              </div>

              {/* Content + console */}
              <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                <main className="flex-1 min-h-0 overflow-hidden relative bg-background">
                  <EmailBadgeContext.Provider value={{ refreshUnreadCount }}>
                    {renderedTabs.map(id => (
                      <div
                        key={id}
                        className="absolute inset-0 overflow-y-auto"
                        style={{ display: id === pathname ? undefined : "none" }}
                      >
                        {tabContentRef.current.get(id) ?? null}
                      </div>
                    ))}
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
