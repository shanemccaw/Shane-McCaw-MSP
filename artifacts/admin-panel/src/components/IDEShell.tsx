import {
  type ReactNode,
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import { Link } from "wouter";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ActivityItem {
  id: string;
  label: string;
  icon: ReactNode;
  href?: string;          // if set, clicking navigates to this URL
  isActive?: boolean;     // if true, this item is the "current domain"
}

export interface ExplorerItem {
  id: string;
  label: string;
  icon?: ReactNode;
  badge?: string;
  badgeColor?: "blue" | "green" | "yellow" | "red" | "gray";
}

export interface ExplorerSection {
  id: string;
  label: string;
  items: ExplorerItem[];
  defaultOpen?: boolean;
}

export interface IDETab {
  id: string;
  label: string;
  icon?: ReactNode;
  closeable?: boolean;
}

export interface CmdKItem {
  id: string;
  label: string;
  section?: string;
  icon?: ReactNode;
}

interface IDEShellProps {
  // Activity bar
  activityItems: ActivityItem[];

  // Explorer panel
  explorerTitle: string;
  explorerSections: ExplorerSection[];
  activeExplorerItem: string;
  onExplorerItemClick: (itemId: string) => void;

  // Tabs
  tabs: IDETab[];
  activeTabId: string;
  onTabSelect: (id: string) => void;
  onTabClose: (id: string) => void;

  // Bottom panel
  bottomPanel?: ReactNode;
  bottomPanelTitle?: string;

  // Cmd+K
  cmdKItems?: CmdKItem[];

  // Main content (parent renders all, shows/hides via CSS)
  children: ReactNode;
}

// ─── Badge helper ─────────────────────────────────────────────────────────────

function TreeBadge({ text, color = "gray" }: { text: string; color?: string }) {
  const colors: Record<string, string> = {
    blue: "bg-[#0078D4]/20 text-[#58A6FF]",
    green: "bg-emerald-500/20 text-emerald-400",
    yellow: "bg-amber-500/20 text-amber-400",
    red: "bg-red-500/20 text-red-400",
    gray: "bg-[#30363D] text-[#7D8590]",
  };
  return (
    <span className={`text-[9px] font-semibold px-1 py-0.5 rounded-full ml-auto flex-shrink-0 ${colors[color] ?? colors["gray"]}`}>
      {text}
    </span>
  );
}

// ─── Cmd+K dialog ─────────────────────────────────────────────────────────────

function CmdKDialog({
  items,
  onSelect,
  onClose,
}: {
  items: CmdKItem[];
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const filtered = items.filter(
    item =>
      !query ||
      item.label.toLowerCase().includes(query.toLowerCase()) ||
      (item.section ?? "").toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center pt-24 bg-black/60"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg bg-[#161B22] border border-[#30363D] rounded-xl shadow-2xl overflow-hidden">
        {/* Search input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[#30363D]">
          <svg className="w-4 h-4 text-[#7D8590] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Jump to…"
            className="flex-1 bg-transparent text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none"
          />
          <kbd className="text-[10px] text-[#484F58] px-1.5 py-0.5 border border-[#30363D] rounded bg-[#0D1117]">Esc</kbd>
        </div>
        {/* Results */}
        <div className="max-h-72 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <p className="text-xs text-[#484F58] text-center py-6">No results</p>
          ) : (
            filtered.map(item => (
              <button
                key={item.id}
                onClick={() => { onSelect(item.id); onClose(); }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-[#1C2128] transition-colors group"
              >
                {item.icon && (
                  <span className="text-sm flex-shrink-0">{item.icon}</span>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-[#E6EDF3] truncate">{item.label}</p>
                  {item.section && (
                    <p className="text-[10px] text-[#484F58] truncate">{item.section}</p>
                  )}
                </div>
                <svg className="w-3 h-3 text-[#30363D] group-hover:text-[#7D8590] flex-shrink-0 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            ))
          )}
        </div>
        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-[#30363D] flex items-center gap-3 text-[10px] text-[#484F58]">
          <span><kbd className="px-1 border border-[#30363D] rounded bg-[#0D1117] text-[9px]">↵</kbd> to jump</span>
          <span><kbd className="px-1 border border-[#30363D] rounded bg-[#0D1117] text-[9px]">Esc</kbd> to close</span>
        </div>
      </div>
    </div>
  );
}

// ─── Main IDEShell component ──────────────────────────────────────────────────

const LS_EXPLORER_COLLAPSED = "ide_explorer_collapsed";
const LS_BOTTOM_OPEN = "ide_bottom_open";
const LS_BOTTOM_HEIGHT = "ide_bottom_height";

function readBool(key: string, fallback: boolean): boolean {
  try { const v = localStorage.getItem(key); return v !== null ? v === "true" : fallback; } catch { return fallback; }
}
function readNum(key: string, fallback: number): number {
  try { const v = localStorage.getItem(key); return v !== null ? Number(v) : fallback; } catch { return fallback; }
}
function writeLs(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch {}
}

export default function IDEShell({
  activityItems,
  explorerTitle,
  explorerSections,
  activeExplorerItem,
  onExplorerItemClick,
  tabs,
  activeTabId,
  onTabSelect,
  onTabClose,
  bottomPanel,
  bottomPanelTitle = "Output",
  cmdKItems = [],
  children,
}: IDEShellProps) {
  const [explorerCollapsed, setExplorerCollapsed] = useState(() => readBool(LS_EXPLORER_COLLAPSED, false));
  const [openSections, setOpenSections] = useState<Set<string>>(() => {
    const defaults = explorerSections.filter(s => s.defaultOpen !== false).map(s => s.id);
    return new Set(defaults);
  });
  const [bottomOpen, setBottomOpen] = useState(() => readBool(LS_BOTTOM_OPEN, false));
  const [bottomHeight, setBottomHeight] = useState(() => readNum(LS_BOTTOM_HEIGHT, 200));
  const [cmdKOpen, setCmdKOpen] = useState(false);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);

  // Cmd+K keyboard shortcut
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCmdKOpen(o => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggleExplorer = useCallback(() => {
    setExplorerCollapsed(v => {
      writeLs(LS_EXPLORER_COLLAPSED, String(!v));
      return !v;
    });
  }, []);

  const toggleBottom = useCallback(() => {
    setBottomOpen(v => {
      writeLs(LS_BOTTOM_OPEN, String(!v));
      return !v;
    });
  }, []);

  const toggleSection = useCallback((id: string) => {
    setOpenSections(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // Bottom panel resize drag
  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startY: e.clientY, startH: bottomHeight };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = dragRef.current.startY - ev.clientY;
      const next = Math.max(100, Math.min(500, dragRef.current.startH + delta));
      setBottomHeight(next);
      writeLs(LS_BOTTOM_HEIGHT, String(next));
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [bottomHeight]);

  const handleCmdKSelect = useCallback((id: string) => {
    onExplorerItemClick(id);
  }, [onExplorerItemClick]);

  return (
    <TooltipProvider>
      <div className="flex h-full overflow-hidden bg-[#0D1117]">
        {/* ── Activity Bar ── */}
        <div className="flex-shrink-0 w-12 flex flex-col items-center bg-[#161B22] border-r border-[#30363D] py-2 gap-0.5">
          {activityItems.map(item => {
            const btn = (
              <button
                key={item.id}
                onClick={item.href ? undefined : toggleExplorer}
                className={`w-9 h-9 flex items-center justify-center rounded-lg transition-colors ${
                  item.isActive
                    ? "bg-[#0078D4]/20 text-[#58A6FF] border border-[#0078D4]/25"
                    : "text-[#484F58] hover:text-[#7D8590] hover:bg-[#1C2128] border border-transparent"
                }`}
              >
                {item.icon}
              </button>
            );

            const wrappedBtn = item.href ? (
              <Link key={item.id} href={item.href}>
                {btn}
              </Link>
            ) : btn;

            return (
              <Tooltip key={item.id}>
                <TooltipTrigger asChild>
                  {wrappedBtn}
                </TooltipTrigger>
                <TooltipContent side="right">
                  <span className="font-semibold">{item.label}</span>
                </TooltipContent>
              </Tooltip>
            );
          })}

          {/* Spacer + Cmd+K */}
          <div className="flex-1" />
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setCmdKOpen(true)}
                className="w-9 h-9 flex items-center justify-center rounded-lg text-[#484F58] hover:text-[#7D8590] hover:bg-[#1C2128] transition-colors border border-transparent"
                aria-label="Quick Jump (⌘K)"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Quick Jump ⌘K</TooltipContent>
          </Tooltip>
        </div>

        {/* ── Explorer Panel ── */}
        <div
          className={`flex-shrink-0 flex flex-col bg-[#0D1117] border-r border-[#30363D] transition-all duration-200 overflow-hidden ${
            explorerCollapsed ? "w-0 border-r-0" : "w-52"
          }`}
        >
          {/* Explorer header */}
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-[#30363D] flex-shrink-0">
            <span className="text-[9px] font-bold text-[#7D8590] uppercase tracking-widest truncate">
              {explorerTitle}
            </span>
            <button
              onClick={toggleExplorer}
              className="text-[#484F58] hover:text-[#7D8590] transition-colors flex-shrink-0 ml-1"
              title="Collapse explorer"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          </div>

          {/* Tree */}
          <nav className="flex-1 overflow-y-auto py-1">
            {explorerSections.map(section => {
              const isSectionOpen = openSections.has(section.id);
              return (
                <div key={section.id}>
                  {/* Section header */}
                  <button
                    onClick={() => toggleSection(section.id)}
                    className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[9px] font-bold text-[#484F58] uppercase tracking-widest hover:text-[#7D8590] transition-colors"
                  >
                    <svg
                      className={`w-2.5 h-2.5 flex-shrink-0 transition-transform duration-150 ${isSectionOpen ? "rotate-90" : ""}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={3}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                    {section.label}
                  </button>

                  {/* Items */}
                  {isSectionOpen && section.items.map(item => {
                    const isActive = activeExplorerItem === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => onExplorerItemClick(item.id)}
                        className={`w-full flex items-center gap-2 pl-6 pr-2 py-1.5 text-xs font-medium transition-colors ${
                          isActive
                            ? "bg-[#0078D4]/15 text-[#58A6FF]"
                            : "text-[#7D8590] hover:bg-[#1C2128] hover:text-[#E6EDF3]"
                        }`}
                      >
                        {item.icon && (
                          <span className="flex-shrink-0 text-base leading-none">{item.icon}</span>
                        )}
                        <span className="flex-1 truncate text-left">{item.label}</span>
                        {item.badge && (
                          <TreeBadge text={item.badge} color={item.badgeColor} />
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </nav>
        </div>

        {/* ── Main Workspace ── */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {/* Tab bar */}
          <div className="flex-shrink-0 flex items-center bg-[#161B22] border-b border-[#30363D] overflow-x-auto">
            {/* Explorer toggle when collapsed */}
            {explorerCollapsed && (
              <button
                onClick={toggleExplorer}
                className="flex-shrink-0 w-8 h-8 flex items-center justify-center text-[#484F58] hover:text-[#7D8590] transition-colors border-r border-[#30363D]"
                title="Show explorer"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            )}

            {/* Tabs */}
            <div className="flex items-stretch overflow-x-auto flex-1 min-w-0">
              {tabs.map(tab => {
                const isActive = tab.id === activeTabId;
                return (
                  <div
                    key={tab.id}
                    className={`flex items-center gap-1.5 px-3 py-2 border-r border-[#30363D] flex-shrink-0 cursor-pointer text-xs transition-colors ${
                      isActive
                        ? "bg-[#0D1117] text-[#E6EDF3] border-t-2 border-t-[#0078D4]"
                        : "text-[#7D8590] hover:text-[#C9D1D9] hover:bg-[#1C2128]"
                    }`}
                    onClick={() => onTabSelect(tab.id)}
                  >
                    {tab.icon && <span className="flex-shrink-0 leading-none">{tab.icon}</span>}
                    <span className="truncate max-w-[120px]">{tab.label}</span>
                    {tab.closeable !== false && (
                      <button
                        onClick={e => { e.stopPropagation(); onTabClose(tab.id); }}
                        className="flex-shrink-0 w-3.5 h-3.5 flex items-center justify-center rounded text-[#484F58] hover:text-[#E6EDF3] hover:bg-[#30363D] transition-colors ml-0.5"
                      >
                        <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Right actions */}
            <div className="flex items-center gap-0.5 px-2 flex-shrink-0 border-l border-[#30363D]">
              {/* Bottom panel toggle */}
              {bottomPanel && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={toggleBottom}
                      className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
                        bottomOpen ? "text-[#58A6FF] bg-[#0078D4]/15" : "text-[#484F58] hover:text-[#7D8590] hover:bg-[#1C2128]"
                      }`}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                      </svg>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{bottomOpen ? "Hide Panel" : "Show Panel"}</TooltipContent>
                </Tooltip>
              )}
              {/* Cmd+K */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setCmdKOpen(true)}
                    className="hidden md:flex w-7 h-7 items-center justify-center rounded text-[#484F58] hover:text-[#7D8590] hover:bg-[#1C2128] transition-colors"
                  >
                    <kbd className="text-[9px] font-medium">⌘K</kbd>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Quick Jump</TooltipContent>
              </Tooltip>
            </div>
          </div>

          {/* Content area + bottom panel */}
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            {/* Tab content */}
            <div className="flex-1 min-h-0 overflow-hidden">
              {children}
            </div>

            {/* Bottom panel */}
            {bottomPanel && bottomOpen && (
              <>
                {/* Drag handle */}
                <div
                  className="flex-shrink-0 h-1 bg-[#30363D] hover:bg-[#0078D4]/60 cursor-row-resize transition-colors"
                  onMouseDown={onResizeStart}
                />
                {/* Panel */}
                <div
                  className="flex-shrink-0 flex flex-col bg-[#161B22] border-t border-[#30363D] overflow-hidden"
                  style={{ height: bottomHeight }}
                >
                  {/* Panel header */}
                  <div className="flex items-center justify-between px-4 py-1.5 border-b border-[#30363D] flex-shrink-0">
                    <span className="text-[10px] font-semibold text-[#7D8590] uppercase tracking-wide">
                      {bottomPanelTitle}
                    </span>
                    <button
                      onClick={toggleBottom}
                      className="text-[#484F58] hover:text-[#7D8590] transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto">
                    {bottomPanel}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── Cmd+K Dialog ── */}
        {cmdKOpen && (
          <CmdKDialog
            items={cmdKItems}
            onSelect={handleCmdKSelect}
            onClose={() => setCmdKOpen(false)}
          />
        )}
      </div>
    </TooltipProvider>
  );
}
