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

// ─── 6 Focused Navigation Groups ─────────────────────────────────────────────

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Command",
    items: [
      {
        label: "Overview",
        path: "/overview",
        icon: (
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v2a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM14 13a1 1 0 011-1h4a1 1 0 011 1v6a1 1 0 01-1 1h-4a1 1 0 01-1-1v-6z" />
          </svg>
        ),
      },
      {
        label: "Messages",
        path: "/crm/messages",
        icon: (
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        ),
      },
      {
        label: "Projects",
        path: "/crm/projects",
        icon: (
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
        ),
      },
      {
        label: "Script Runner",
        path: "/script-runner",
        icon: (
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        ),
      },
      {
        label: "M365 Scripts",
        path: "/m365-scripts",
        icon: (
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v-.5a2.5 2.5 0 015 0V5" />
          </svg>
        ),
      },
      {
        label: "Run Results",
        path: "/m365-run-results",
        icon: (
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
        ),
      },
      {
        label: "Analytics",
        path: "/analytics",
        icon: (
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
          </svg>
        ),
      },
      {
        label: "Marketing",
        path: "/marketing-command-center",
        icon: (
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
          </svg>
        ),
      },
    ],
  },
  {
    label: "Clients",
    items: [
      {
        label: "Clients",
        path: "/crm/clients",
        icon: (
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        ),
      },
      {
        label: "Leads",
        path: "/crm/leads",
        icon: (
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
          </svg>
        ),
      },
      {
        label: "Opportunities",
        path: "/crm/opportunities",
        icon: (
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.562.562 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
          </svg>
        ),
      },
      {
        label: "Quiz Leads",
        path: "/crm/quiz-leads",
        icon: (
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
          </svg>
        ),
      },
      {
        label: "M365 Intelligence",
        path: "/crm/m365-intelligence",
        icon: (
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
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
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
          </svg>
        ),
      },
      {
        label: "Purchases",
        path: "/crm/purchases",
        icon: (
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
        ),
      },
      {
        label: "Contracts",
        path: "/crm/contracts",
        icon: (
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
          </svg>
        ),
      },
      {
        label: "Coupons",
        path: "/coupons",
        icon: (
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M17 17h.01M9 3H5a2 2 0 00-2 2v4l9.5 9.5a2 2 0 002.83 0l4.17-4.17a2 2 0 000-2.83L10 3H9z" />
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
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
          </svg>
        ),
      },
      {
        label: "Services",
        path: "/services",
        icon: (
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        ),
      },
      {
        label: "Service Triggers",
        path: "/service-page-triggers",
        icon: (
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a2 2 0 012-2z" />
          </svg>
        ),
      },
      {
        label: "Engagement Projects",
        path: "/engagement-projects",
        icon: (
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
          </svg>
        ),
      },
      {
        label: "Email Templates",
        path: "/email-templates",
        icon: (
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        ),
      },
      {
        label: "Contract Templates",
        path: "/contract-templates",
        icon: (
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        ),
      },
    ],
  },
  {
    label: "System",
    items: [
      {
        label: "Signal Mappings",
        path: "/crm/quiz-pain-config",
        icon: (
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        ),
      },
      {
        label: "Hub Storage",
        path: "/sharepoint",
        icon: (
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
        ),
      },
      {
        label: "Inbox",
        path: "/inbox",
        icon: (
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
          </svg>
        ),
      },
      {
        label: "Activity Log",
        path: "/activity-log",
        icon: (
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0118 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
          </svg>
        ),
      },
      {
        label: "Workflows",
        path: "/workflows",
        icon: (
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4h4v4H4zM16 4h4v4h-4zM4 16h4v4H4zM16 16h4v4h-4zM8 6h8M6 8v8M18 8v8M8 18h8" />
          </svg>
        ),
      },
      {
        label: "Template Library",
        path: "/templates/library",
        icon: (
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
          </svg>
        ),
      },
      {
        label: "Asset Library",
        path: "/asset-library/instruction-sets",
        icon: (
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
          </svg>
        ),
      },
      {
        label: "Security",
        path: "/security",
        icon: (
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
        ),
      },
    ],
  },
];

// ─── LocalStorage helpers ─────────────────────────────────────────────────────

const LS_SIDEBAR_COLLAPSED = "admin_sidebar_collapsed";
const LS_COLLAPSED_GROUPS = "admin_collapsed_groups";

function readSidebarCollapsed(): boolean {
  try { return localStorage.getItem(LS_SIDEBAR_COLLAPSED) === "true"; } catch { return false; }
}

function readCollapsedGroups(): Set<string> {
  try {
    const raw = localStorage.getItem(LS_COLLAPSED_GROUPS);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed) : new Set();
  } catch { return new Set(); }
}

// ─── Group badge helper ───────────────────────────────────────────────────────

function getGroupBadgeCount(group: NavGroup, unreadEmailCount: number): number {
  return group.items.reduce((sum, item) => {
    if (item.label === "Inbox") return sum + unreadEmailCount;
    return sum;
  }, 0);
}

// ─── Breadcrumb helper ────────────────────────────────────────────────────────

function computeBreadcrumb(location: string): { group: string; label: string } | null {
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if (location === item.path || location.startsWith(item.path + "/")) {
        return { group: group.label, label: item.label };
      }
    }
  }
  return null;
}

// ─── NavItemLink ──────────────────────────────────────────────────────────────

function NavItemLink({
  item,
  isActive,
  collapsed,
  onClick,
  badge,
  href,
}: {
  item: NavItem;
  isActive: boolean;
  collapsed: boolean;
  onClick?: () => void;
  badge?: number;
  href?: string;
}) {
  const linkEl = (
    <Link
      href={href ?? item.path}
      onClick={onClick}
      className={`flex items-center gap-2.5 rounded-lg text-sm font-medium transition-all duration-150 border ${
        collapsed ? "px-0 py-2 justify-center relative w-full" : "px-2.5 py-2"
      } ${
        isActive
          ? "bg-[#0078D4]/15 text-[#58A6FF] border-[#0078D4]/25"
          : "text-[#7D8590] hover:bg-[#1C2128] hover:text-[#E6EDF3] border-transparent"
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

// ─── TopHeader ────────────────────────────────────────────────────────────────

function TopHeader({
  onMobileMenuClick,
  location,
  user,
  onLogout,
  unreadEmailCount,
}: {
  onMobileMenuClick: () => void;
  location: string;
  user: { email?: string } | null;
  onLogout: () => void;
  unreadEmailCount: number;
}) {
  const breadcrumb = computeBreadcrumb(location);

  return (
    <header className="h-14 bg-[#161B22] border-b border-[#30363D] flex items-center px-4 gap-4 flex-shrink-0">
      {/* Mobile hamburger */}
      <button
        onClick={onMobileMenuClick}
        className="lg:hidden p-1.5 text-[#7D8590] hover:text-[#E6EDF3] rounded-lg hover:bg-[#1C2128] transition-colors"
        aria-label="Open navigation"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Breadcrumb — desktop */}
      <div className="hidden lg:flex items-center gap-1.5 text-xs min-w-0">
        {breadcrumb ? (
          <>
            <span className="text-[#7D8590] font-medium truncate">{breadcrumb.group}</span>
            <svg className="w-3 h-3 text-[#484F58] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            <span className="text-[#E6EDF3] font-semibold truncate">{breadcrumb.label}</span>
          </>
        ) : (
          <span className="text-[#E6EDF3] font-semibold">Admin Panel</span>
        )}
      </div>

      {/* Mobile title */}
      <span className="lg:hidden font-bold text-[#E6EDF3] text-sm">Admin Panel</span>

      <div className="flex-1" />

      {/* Global search */}
      <div className="hidden md:flex items-center gap-2 bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-1.5 w-52 focus-within:border-[#0078D4]/60 transition-colors">
        <svg className="w-3.5 h-3.5 text-[#7D8590] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          placeholder="Search…"
          className="flex-1 bg-transparent text-sm text-[#E6EDF3] placeholder-[#484F58] outline-none min-w-0 cursor-default"
          readOnly
        />
        <kbd className="hidden lg:flex items-center gap-0.5 text-[10px] font-medium text-[#484F58] px-1 py-0.5 bg-[#1C2128] border border-[#30363D] rounded">
          ⌘K
        </kbd>
      </div>

      {/* Notification bell — inbox badge */}
      <Link href="/inbox">
        <button
          className="relative p-1.5 text-[#7D8590] hover:text-[#E6EDF3] rounded-lg hover:bg-[#1C2128] transition-colors"
          title="Inbox"
        >
          <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          {unreadEmailCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-0.5 leading-none">
              {unreadEmailCount > 99 ? "99+" : unreadEmailCount}
            </span>
          )}
        </button>
      </Link>

      {/* Identity chip */}
      <div className="flex items-center gap-2.5 pl-3 border-l border-[#30363D]">
        <div className="w-7 h-7 bg-[#0078D4]/20 border border-[#0078D4]/30 rounded-full flex items-center justify-center flex-shrink-0">
          <span className="text-xs font-bold text-[#0078D4] uppercase leading-none">
            {user?.email?.[0] ?? "A"}
          </span>
        </div>
        <div className="hidden md:block leading-tight">
          <p className="text-xs font-semibold text-[#E6EDF3]">Shane McCaw</p>
          <p className="text-[10px] text-[#7D8590]">Administrator</p>
        </div>
        <button
          onClick={onLogout}
          className="p-1.5 text-[#7D8590] hover:text-[#E6EDF3] rounded-lg hover:bg-[#1C2128] transition-colors"
          title="Sign out"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
        </button>
      </div>
    </header>
  );
}

// ─── SidebarContent ───────────────────────────────────────────────────────────

function SidebarContent({
  collapsed,
  collapsedGroups,
  onToggleGroup,
  location,
  user,
  onClose,
  unreadEmailCount,
}: {
  collapsed: boolean;
  collapsedGroups: Set<string>;
  onToggleGroup: (label: string) => void;
  location: string;
  user: { email?: string } | null;
  onClose?: () => void;
  unreadEmailCount: number;
}) {
  return (
    <div className="h-full flex flex-col bg-[#161B22] border-r border-[#30363D]">
      {/* Logo / brand */}
      <div className={`border-b border-[#30363D] transition-all duration-200 ${collapsed ? "px-0 py-4 flex justify-center" : "px-4 py-4"}`}>
        {collapsed ? (
          <div className="w-8 h-8 bg-[#0078D4] rounded-lg flex items-center justify-center">
            <svg className="w-4.5 h-4.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
        ) : (
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-[#0078D4] rounded-lg flex items-center justify-center flex-shrink-0">
              <svg className="w-4.5 h-4.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <div>
              <p className="font-bold text-[#E6EDF3] text-sm leading-tight">Admin Panel</p>
              <p className="text-[10px] text-[#7D8590] leading-tight">Shane McCaw Consulting</p>
            </div>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className={`flex-1 overflow-y-auto p-2.5 space-y-3.5 ${collapsed ? "overflow-x-hidden" : ""}`}>
        {NAV_GROUPS.map(group => {
          const isGroupCollapsed = !collapsed && collapsedGroups.has(group.label);
          const groupBadgeCount = getGroupBadgeCount(group, unreadEmailCount);

          return (
            <div key={group.label}>
              {/* Group header */}
              {collapsed ? (
                group.label !== NAV_GROUPS[0].label && (
                  <div className="relative border-t border-[#30363D] my-2">
                    {groupBadgeCount > 0 && (
                      <span className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-[#F85149]" />
                    )}
                  </div>
                )
              ) : (
                <button
                  onClick={() => onToggleGroup(group.label)}
                  className="w-full flex items-center justify-between px-2.5 mb-1 group"
                >
                  <span className="flex items-center gap-1.5">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[#484F58] group-hover:text-[#7D8590] transition-colors">
                      {group.label}
                    </p>
                    {groupBadgeCount > 0 && isGroupCollapsed && (
                      <span className="w-2 h-2 rounded-full bg-[#F85149] flex-shrink-0" />
                    )}
                  </span>
                  <svg
                    className={`w-3 h-3 text-[#484F58] group-hover:text-[#7D8590] transition-transform duration-200 ${isGroupCollapsed ? "-rotate-90" : "rotate-0"}`}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24"
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
                  const isActive = location === item.path || location.startsWith(item.path + "/");
                  const itemBadge = item.label === "Inbox" ? unreadEmailCount : 0;
                  const search = typeof window !== "undefined" ? window.location.search : "";
                  const effectiveHref = isActive && search ? item.path + search : undefined;
                  return (
                    <NavItemLink
                      key={item.label + item.path}
                      item={item}
                      isActive={isActive}
                      collapsed={collapsed}
                      onClick={onClose}
                      badge={itemBadge || undefined}
                      href={effectiveHref}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      {/* Footer — identity (compact) */}
      <div className={`border-t border-[#30363D] ${collapsed ? "p-3 flex flex-col items-center gap-2" : "px-4 py-3"}`}>
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="w-7 h-7 bg-[#0078D4]/20 border border-[#0078D4]/30 rounded-full flex items-center justify-center cursor-default">
                <span className="text-xs font-bold text-[#0078D4] uppercase leading-none">
                  {user?.email?.[0] ?? "A"}
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent side="right">{user?.email ?? "Administrator"}</TooltipContent>
          </Tooltip>
        ) : (
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 bg-[#0078D4]/20 border border-[#0078D4]/30 rounded-full flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-bold text-[#0078D4] uppercase leading-none">
                {user?.email?.[0] ?? "A"}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-[#E6EDF3] font-medium truncate">Shane McCaw</p>
              <p className="text-[10px] text-[#7D8590] truncate">{user?.email ?? "Administrator"}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Email badge polling ──────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 60_000;
const LS_EMAIL_LAST_SEEN = "emailActivityLastSeenAt";

function readLastSeenAt(): number | null {
  try {
    const raw = localStorage.getItem(LS_EMAIL_LAST_SEEN);
    return raw ? parseInt(raw, 10) : null;
  } catch { return null; }
}

function saveLastSeenAt(ts: number): void {
  try { localStorage.setItem(LS_EMAIL_LAST_SEEN, String(ts)); } catch {}
}

// ─── DashboardShell ───────────────────────────────────────────────────────────

export default function DashboardShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => readSidebarCollapsed());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => readCollapsedGroups());
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
    if (location === "/inbox") {
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
  }, [location, fetchCount]);

  useEffect(() => {
    try { localStorage.setItem(LS_SIDEBAR_COLLAPSED, String(sidebarCollapsed)); } catch {}
  }, [sidebarCollapsed]);

  useEffect(() => {
    try { localStorage.setItem(LS_COLLAPSED_GROUPS, JSON.stringify(Array.from(collapsedGroups))); } catch {}
  }, [collapsedGroups]);

  const toggleGroup = useCallback((label: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      next.has(label) ? next.delete(label) : next.add(label);
      return next;
    });
  }, []);

  const handleLogout = async () => { await logout(); };

  const CollapseToggleButton = () => (
    <button
      onClick={() => setSidebarCollapsed(v => !v)}
      title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
      className="absolute -right-3 top-1/2 -translate-y-1/2 z-10 w-6 h-6 rounded-full bg-[#0078D4] text-white flex items-center justify-center shadow-lg hover:bg-[#1A90E0] transition-colors"
    >
      <svg
        className={`w-3 h-3 transition-transform duration-200 ${sidebarCollapsed ? "rotate-180" : "rotate-0"}`}
        fill="none" stroke="currentColor" viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
      </svg>
    </button>
  );

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full overflow-hidden bg-[#0D1117]">

        {/* Desktop sidebar */}
        <aside
          className={`hidden lg:flex lg:flex-col flex-shrink-0 relative transition-all duration-200 ${
            sidebarCollapsed ? "w-[60px]" : "w-56"
          }`}
        >
          <SidebarContent
            collapsed={sidebarCollapsed}
            collapsedGroups={collapsedGroups}
            onToggleGroup={toggleGroup}
            location={location}
            user={user}
            unreadEmailCount={unreadEmailCount}
          />
          <CollapseToggleButton />
        </aside>

        {/* Mobile drawer */}
        {mobileOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div
              className="absolute inset-0 bg-black/60"
              onClick={() => setMobileOpen(false)}
            />
            <aside className="absolute left-0 top-0 bottom-0 w-56 flex flex-col">
              <SidebarContent
                collapsed={false}
                collapsedGroups={collapsedGroups}
                onToggleGroup={toggleGroup}
                location={location}
                user={user}
                onClose={() => setMobileOpen(false)}
                unreadEmailCount={unreadEmailCount}
              />
            </aside>
          </div>
        )}

        {/* Main content */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Unified top header bar */}
          <TopHeader
            onMobileMenuClick={() => setMobileOpen(true)}
            location={location}
            user={user}
            onLogout={handleLogout}
            unreadEmailCount={unreadEmailCount}
          />

          {/* Page content */}
          <main className="flex-1 overflow-y-auto bg-[#0D1117]">
            <EmailBadgeContext.Provider value={{ refreshUnreadCount }}>
              {children}
            </EmailBadgeContext.Provider>
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
