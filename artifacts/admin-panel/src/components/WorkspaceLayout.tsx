import { useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export interface WorkspaceNavItem {
  label: string;
  path: string;
  icon: ReactNode;
  comingSoon?: boolean;
  badge?: number;
}

interface WorkspaceLayoutProps {
  title: string;
  subtitle: string;
  navItems: WorkspaceNavItem[];
  /** Optional action buttons rendered in the workspace content header (right side) */
  headerActions?: ReactNode;
  children: ReactNode;
}

const LS_KEY = "ws_inner_collapsed";

function readInnerCollapsed(): boolean {
  try { return localStorage.getItem(LS_KEY) === "true"; } catch { return false; }
}

export default function WorkspaceLayout({
  title,
  subtitle,
  navItems,
  headerActions,
  children,
}: WorkspaceLayoutProps) {
  const [location] = useLocation();
  const [collapsed, setCollapsed] = useState<boolean>(() => readInnerCollapsed());

  function toggle() {
    setCollapsed(v => {
      const next = !v;
      try { localStorage.setItem(LS_KEY, String(next)); } catch {}
      return next;
    });
  }

  // Find active nav item for the workspace content header
  const activeItem = navItems.find(
    item => location === item.path || location.startsWith(item.path + "/")
  );

  return (
    <div className="flex min-h-full">
      {/* ── Inner workspace sidebar ── */}
      <aside
        className={`flex-shrink-0 flex flex-col bg-[#0D1117] border-r border-[#30363D] transition-all duration-200 ${
          collapsed ? "w-12" : "w-48"
        }`}
      >
        {/* Sidebar header + collapse toggle */}
        <div
          className={`flex items-center gap-2 border-b border-[#30363D] py-3 flex-shrink-0 ${
            collapsed ? "px-2 justify-center" : "px-3"
          }`}
        >
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold text-[#E6EDF3] truncate uppercase tracking-widest leading-tight">
                {title}
              </p>
              <p className="text-[9px] text-[#7D8590] truncate mt-0.5 leading-tight">{subtitle}</p>
            </div>
          )}
          <button
            onClick={toggle}
            title={collapsed ? "Expand workspace nav" : "Collapse workspace nav"}
            className="flex-shrink-0 p-1 text-[#484F58] hover:text-[#7D8590] rounded transition-colors"
          >
            <svg
              className={`w-3.5 h-3.5 transition-transform duration-200 ${collapsed ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        </div>

        {/* Nav items — all items are navigable; coming-soon shows a badge */}
        <nav className={`flex-1 overflow-y-auto p-2 space-y-0.5 ${collapsed ? "overflow-x-hidden" : ""}`}>
          {navItems.map(item => {
            const isActive = location === item.path || location.startsWith(item.path + "/");

            const linkEl = (
              <Link
                href={item.path}
                className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium transition-all duration-150 border ${
                  collapsed ? "justify-center" : ""
                } ${
                  isActive
                    ? "bg-[#0078D4]/15 text-[#58A6FF] border-[#0078D4]/25"
                    : item.comingSoon
                    ? "text-[#484F58] border-transparent hover:bg-[#1C2128] hover:text-[#7D8590]"
                    : "text-[#7D8590] hover:bg-[#1C2128] hover:text-[#E6EDF3] border-transparent"
                }`}
              >
                <span className={`shrink-0 ${item.comingSoon ? "opacity-50" : ""}`}>{item.icon}</span>
                {!collapsed && <span className="truncate flex-1">{item.label}</span>}
                {!collapsed && item.comingSoon && (
                  <span className="text-[8px] font-semibold text-[#484F58] bg-[#1C2128] px-1.5 py-0.5 rounded-full uppercase tracking-wide flex-shrink-0">
                    Soon
                  </span>
                )}
                {!collapsed && !!item.badge && !item.comingSoon && (
                  <span className="ml-auto min-w-[16px] h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-0.5 leading-none shrink-0">
                    {item.badge > 99 ? "99+" : item.badge}
                  </span>
                )}
              </Link>
            );

            if (!collapsed) return <div key={item.label}>{linkEl}</div>;

            return (
              <Tooltip key={item.label}>
                <TooltipTrigger asChild>
                  <div>{linkEl}</div>
                </TooltipTrigger>
                <TooltipContent side="right">
                  {item.comingSoon ? `${item.label} — Coming Soon` : item.label}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </nav>
      </aside>

      {/* ── Main content area ── */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Workspace content header */}
        <div className="flex items-center justify-between gap-4 px-6 py-3 border-b border-[#21262D] bg-[#161B22] flex-shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-[#E6EDF3] truncate">
                {activeItem?.label ?? title}
              </h2>
              {activeItem?.comingSoon && (
                <span className="text-[9px] font-bold text-[#484F58] bg-[#1C2128] border border-[#30363D] px-1.5 py-0.5 rounded-full uppercase tracking-wide flex-shrink-0">
                  Coming Soon
                </span>
              )}
            </div>
            <p className="text-[10px] text-[#7D8590] mt-0.5 leading-tight">{subtitle}</p>
          </div>
          {headerActions && (
            <div className="flex items-center gap-2 flex-shrink-0">
              {headerActions}
            </div>
          )}
        </div>

        {/* Page content */}
        <div className="flex-1 min-w-0">
          {children}
        </div>
      </div>
    </div>
  );
}
