import { type ReactNode, useState, useEffect, useCallback, useRef } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { EmailBadgeContext } from "@/contexts/EmailBadgeContext";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface NavItem {
  label: string;
  path: string;
  icon: ReactNode;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [
      {
        label: "Overview",
        path: "/overview",
        icon: (
          <svg className="w-4.5 h-4.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v2a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM14 13a1 1 0 011-1h4a1 1 0 011 1v6a1 1 0 01-1 1h-4a1 1 0 01-1-1v-6z" />
          </svg>
        ),
      },
    ],
  },
  {
    label: "Content",
    items: [
      {
        label: "Articles",
        path: "/articles",
        icon: (
          <svg className="w-4.5 h-4.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
          </svg>
        ),
      },
      {
        label: "Services",
        path: "/services",
        icon: (
          <svg className="w-4.5 h-4.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        ),
      },
    ],
  },
  {
    label: "Pipeline",
    items: [
      {
        label: "Leads",
        path: "/crm/leads",
        icon: (
          <svg className="w-4.5 h-4.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
          </svg>
        ),
      },
      {
        label: "Clients",
        path: "/crm/clients",
        icon: (
          <svg className="w-4.5 h-4.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        ),
      },
    ],
  },
  {
    label: "Delivery",
    items: [
      {
        label: "Projects",
        path: "/crm/projects",
        icon: (
          <svg className="w-4.5 h-4.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
        ),
      },
      {
        label: "Status Reports",
        path: "/crm/status-reports",
        icon: (
          <svg className="w-4.5 h-4.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        ),
      },
      {
        label: "Testimonials",
        path: "/crm/testimonials",
        icon: (
          <svg className="w-4.5 h-4.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
          </svg>
        ),
      },
      {
        label: "Contracts",
        path: "/crm/contracts",
        icon: (
          <svg className="w-4.5 h-4.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
          </svg>
        ),
      },
    ],
  },
  {
    label: "Finance",
    items: [
      {
        label: "Invoices",
        path: "/crm/invoices",
        icon: (
          <svg className="w-4.5 h-4.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
          </svg>
        ),
      },
      {
        label: "Purchases",
        path: "/crm/purchases",
        icon: (
          <svg className="w-4.5 h-4.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
        ),
      },
    ],
  },
  {
    label: "Comms",
    items: [
      {
        label: "Email Activity",
        path: "/email-activity",
        icon: (
          <svg className="w-4.5 h-4.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
          </svg>
        ),
      },
      {
        label: "Messages",
        path: "/crm/messages",
        icon: (
          <svg className="w-4.5 h-4.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        ),
      },
      {
        label: "Documents",
        path: "/crm/documents",
        icon: (
          <svg className="w-4.5 h-4.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
        ),
      },
      {
        label: "Reports",
        path: "/crm/reports",
        icon: (
          <svg className="w-4.5 h-4.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        ),
      },
    ],
  },
  {
    label: "System",
    items: [
      {
        label: "Activity Log",
        path: "/activity-log",
        icon: (
          <svg className="w-4.5 h-4.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0118 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
          </svg>
        ),
      },
    ],
  },
  {
    label: "Templates",
    items: [
      {
        label: "Workflows",
        path: "/workflows",
        icon: (
          <svg className="w-4.5 h-4.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
          </svg>
        ),
      },
      {
        label: "Contract Templates",
        path: "/contract-templates",
        icon: (
          <svg className="w-4.5 h-4.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        ),
      },
      {
        label: "Engagement Projects",
        path: "/engagement-projects",
        icon: (
          <svg className="w-4.5 h-4.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
          </svg>
        ),
      },
    ],
  },
];

const LS_SIDEBAR_COLLAPSED = "admin_sidebar_collapsed";
const LS_COLLAPSED_GROUPS = "admin_collapsed_groups";

function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(LS_SIDEBAR_COLLAPSED) === "true";
  } catch {
    return false;
  }
}

function readCollapsedGroups(): Set<string> {
  try {
    const raw = localStorage.getItem(LS_COLLAPSED_GROUPS);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed) : new Set();
  } catch {
    return new Set();
  }
}

function NavItemLink({
  item,
  isActive,
  collapsed,
  onClick,
  badge,
}: {
  item: NavItem;
  isActive: boolean;
  collapsed: boolean;
  onClick?: () => void;
  badge?: number;
}) {
  const linkEl = (
    <Link
      href={item.path}
      onClick={onClick}
      className={`flex items-center gap-3 rounded-xl text-sm font-medium transition-all ${
        collapsed ? "px-0 py-2.5 justify-center relative" : "px-3 py-2.5"
      } ${
        isActive
          ? "bg-[#0078D4] text-white"
          : "text-blue-200 hover:bg-[#1a3a5c] hover:text-white"
      }`}
    >
      <span className="relative shrink-0">
        {item.icon}
        {!!badge && collapsed && (
          <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-0.5 leading-none">
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </span>
      {!collapsed && <span className="truncate flex-1">{item.label}</span>}
      {!collapsed && !!badge && (
        <span className="ml-auto min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1 leading-none shrink-0">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </Link>
  );

  if (!collapsed) return linkEl;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{linkEl}</TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  );
}

function SignOutButton({
  collapsed,
  onLogout,
}: {
  collapsed: boolean;
  onLogout: () => void;
}) {
  const signOutIcon = (
    <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
    </svg>
  );

  const btn = (
    <button
      onClick={onLogout}
      className={`flex items-center gap-2 px-3 py-2 text-xs text-blue-300 hover:text-white hover:bg-[#1a3a5c] rounded-lg transition-colors ${
        collapsed ? "w-auto justify-center" : "w-full justify-center"
      }`}
    >
      {signOutIcon}
      {!collapsed && "Sign out"}
    </button>
  );

  if (!collapsed) return btn;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{btn}</TooltipTrigger>
      <TooltipContent side="right">Sign out</TooltipContent>
    </Tooltip>
  );
}

function SidebarContent({
  collapsed,
  collapsedGroups,
  onToggleGroup,
  location,
  user,
  onLogout,
  onClose,
  unreadEmailCount,
}: {
  collapsed: boolean;
  collapsedGroups: Set<string>;
  onToggleGroup: (label: string) => void;
  location: string;
  user: { email?: string } | null;
  onLogout: () => void;
  onClose?: () => void;
  unreadEmailCount: number;
}) {
  return (
    <div className="h-full flex flex-col bg-[#0A2540]">
      {/* Header / logo */}
      <div className={`border-b border-[#1a3a5c] transition-all duration-200 ${collapsed ? "px-0 py-4 flex justify-center" : "px-5 py-5"}`}>
        {collapsed ? (
          <div className="w-9 h-9 bg-[#0078D4] rounded-xl flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-[#0078D4] rounded-xl flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <div>
              <p className="font-bold text-white text-sm leading-tight">Admin Panel</p>
              <p className="text-xs text-blue-300 leading-tight">Shane McCaw Consulting</p>
            </div>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className={`flex-1 overflow-y-auto p-3 space-y-4 ${collapsed ? "overflow-x-hidden" : ""}`}>
        {NAV_GROUPS.map(group => {
          const isGroupCollapsed = !collapsed && collapsedGroups.has(group.label);

          return (
            <div key={group.label}>
              {/* Group header */}
              {collapsed ? (
                /* In rail mode: show a thin divider line between groups (skip for first) */
                group.label !== NAV_GROUPS[0].label && (
                  <div className="border-t border-[#1a3a5c] my-2" />
                )
              ) : (
                <button
                  onClick={() => onToggleGroup(group.label)}
                  className="w-full flex items-center justify-between px-3 mb-1 group"
                >
                  <p className="text-[10px] font-bold uppercase tracking-widest text-blue-400/70 group-hover:text-blue-300 transition-colors">
                    {group.label}
                  </p>
                  <svg
                    className={`w-3 h-3 text-blue-400/70 group-hover:text-blue-300 transition-transform duration-200 ${
                      isGroupCollapsed ? "-rotate-90" : "rotate-0"
                    }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              )}

              {/* Group items */}
              <div
                className={`space-y-0.5 overflow-hidden transition-all duration-200 ${
                  isGroupCollapsed ? "max-h-0 opacity-0" : "max-h-[2000px] opacity-100"
                }`}
              >
                {group.items.map(item => {
                  const isActive =
                    location === item.path || location.startsWith(item.path + "/");
                  const itemBadge = item.label === "Email Activity" ? unreadEmailCount : 0;
                  return (
                    <NavItemLink
                      key={item.label + item.path}
                      item={item}
                      isActive={isActive}
                      collapsed={collapsed}
                      onClick={onClose}
                      badge={itemBadge || undefined}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div className={`border-t border-[#1a3a5c] ${collapsed ? "p-3 flex flex-col items-center gap-2" : "p-4"}`}>
        {collapsed ? (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="w-8 h-8 bg-[#0078D4]/20 border border-[#0078D4]/30 rounded-full flex items-center justify-center cursor-default">
                  <span className="text-xs font-bold text-blue-300 uppercase">
                    {user?.email?.[0] ?? "A"}
                  </span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="right">{user?.email ?? "Administrator"}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <a
                  href="/crm"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center w-8 h-8 text-blue-300 hover:text-white hover:bg-[#1a3a5c] rounded-lg transition-colors"
                >
                  <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                </a>
              </TooltipTrigger>
              <TooltipContent side="right">View as Client</TooltipContent>
            </Tooltip>
            <SignOutButton collapsed={collapsed} onLogout={onLogout} />
          </>
        ) : (
          <>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 bg-[#0078D4]/20 border border-[#0078D4]/30 rounded-full flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-bold text-blue-300 uppercase">
                  {user?.email?.[0] ?? "A"}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-white font-medium truncate">{user?.email}</p>
                <p className="text-xs text-blue-400">Administrator</p>
              </div>
            </div>
            <a
              href="/crm"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-2 mb-1 text-xs text-blue-300 hover:text-white hover:bg-[#1a3a5c] rounded-lg transition-colors w-full justify-center"
            >
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              View as Client
            </a>
            <SignOutButton collapsed={collapsed} onLogout={onLogout} />
          </>
        )}
      </div>
    </div>
  );
}

const POLL_INTERVAL_MS = 60_000;
const LS_EMAIL_LAST_SEEN = "emailActivityLastSeenAt";

function readLastSeenAt(): number | null {
  try {
    const raw = localStorage.getItem(LS_EMAIL_LAST_SEEN);
    return raw ? parseInt(raw, 10) : null;
  } catch {
    return null;
  }
}

function saveLastSeenAt(ts: number): void {
  try {
    localStorage.setItem(LS_EMAIL_LAST_SEEN, String(ts));
  } catch {}
}

export default function DashboardShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() =>
    readSidebarCollapsed()
  );
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() =>
    readCollapsedGroups()
  );
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
    } catch {
      // non-fatal — silently ignore
    }
  }, []);

  const refreshUnreadCount = useCallback(() => {
    void fetchCount();
  }, [fetchCount]);

  // When on Email Activity: mark as viewed (watermark) and clear badge.
  // When away: poll the count using the watermark so already-seen emails stay cleared.
  useEffect(() => {
    if (location === "/email-activity") {
      saveLastSeenAt(Date.now());
      setUnreadEmailCount(0);
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }

    void fetchCount();
    pollTimerRef.current = setInterval(() => void fetchCount(), POLL_INTERVAL_MS);

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [location, fetchCount]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_SIDEBAR_COLLAPSED, String(sidebarCollapsed));
    } catch {}
  }, [sidebarCollapsed]);

  useEffect(() => {
    try {
      localStorage.setItem(
        LS_COLLAPSED_GROUPS,
        JSON.stringify(Array.from(collapsedGroups))
      );
    } catch {}
  }, [collapsedGroups]);

  const toggleGroup = useCallback((label: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(label)) {
        next.delete(label);
      } else {
        next.add(label);
      }
      return next;
    });
  }, []);

  const handleLogout = async () => {
    await logout();
  };

  const CollapseToggleButton = () => (
    <button
      onClick={() => setSidebarCollapsed(v => !v)}
      title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
      className="absolute -right-3 top-1/2 -translate-y-1/2 z-10 w-6 h-6 rounded-full bg-[#0078D4] text-white flex items-center justify-center shadow-md hover:bg-[#005fa3] transition-colors"
    >
      <svg
        className={`w-3 h-3 transition-transform duration-200 ${sidebarCollapsed ? "rotate-180" : "rotate-0"}`}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
      </svg>
    </button>
  );

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen overflow-hidden bg-gray-50">
        {/* Desktop sidebar */}
        <aside
          className={`hidden lg:flex lg:flex-col flex-shrink-0 relative transition-all duration-200 ${
            sidebarCollapsed ? "w-[60px]" : "w-64"
          }`}
        >
          <SidebarContent
            collapsed={sidebarCollapsed}
            collapsedGroups={collapsedGroups}
            onToggleGroup={toggleGroup}
            location={location}
            user={user}
            onLogout={handleLogout}
            unreadEmailCount={unreadEmailCount}
          />
          <CollapseToggleButton />
        </aside>

        {/* Mobile drawer */}
        {mobileOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div
              className="absolute inset-0 bg-black/50"
              onClick={() => setMobileOpen(false)}
            />
            <aside className="absolute left-0 top-0 bottom-0 w-64 flex flex-col">
              <SidebarContent
                collapsed={false}
                collapsedGroups={collapsedGroups}
                onToggleGroup={toggleGroup}
                location={location}
                user={user}
                onLogout={handleLogout}
                onClose={() => setMobileOpen(false)}
                unreadEmailCount={unreadEmailCount}
              />
            </aside>
          </div>
        )}

        {/* Main content */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Mobile top bar */}
          <div className="lg:hidden flex items-center gap-3 px-4 py-3 bg-[#0A2540] border-b border-[#1a3a5c]">
            <button onClick={() => setMobileOpen(true)} className="text-white p-1">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <p className="font-bold text-white text-sm">Admin Panel</p>
          </div>

          <main className="flex-1 overflow-y-auto">
            <EmailBadgeContext.Provider value={{ refreshUnreadCount }}>
              {children}
            </EmailBadgeContext.Provider>
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
