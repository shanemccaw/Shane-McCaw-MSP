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
import NotificationDrawer from "@/components/NotificationDrawer";
import { usePurchaseSound } from "@/hooks/usePurchaseSound";
import { playSoundFromParams } from "@/lib/playSound";

interface NavItem {
  label: string;
  path: string;
  icon: ReactNode;
  description?: string;
}

interface WorkspaceEntry {
  label: string;
  prefix: string;
  defaultPath: string;
  icon: ReactNode;
  hasBadge?: boolean;
  description: string;
}

// ─── Six Workspace Navigation Entries ────────────────────────────────────────

const WORKSPACES: WorkspaceEntry[] = [
  {
    label: "Command",
    prefix: "/command",
    defaultPath: "/command/overview",
    description: "Overview, analytics & AI tools",
    icon: (
      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v2a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM14 13a1 1 0 011-1h4a1 1 0 011 1v6a1 1 0 01-1 1h-4a1 1 0 01-1-1v-6z" />
      </svg>
    ),
  },
  {
    label: "Pipeline",
    prefix: "/pipeline",
    defaultPath: "/pipeline/leads",
    description: "Leads, clients & opportunities",
    icon: (
      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
      </svg>
    ),
  },
  {
    label: "Delivery",
    prefix: "/delivery",
    defaultPath: "/delivery/projects",
    description: "Projects, workflows & activity",
    icon: (
      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      </svg>
    ),
  },
  {
    label: "Finance",
    prefix: "/finance",
    defaultPath: "/finance/invoices",
    description: "Invoices, purchases & contracts",
    icon: (
      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
      </svg>
    ),
  },
  {
    label: "Content & Offers",
    prefix: "/content",
    defaultPath: "/content/articles",
    description: "Articles, services & templates",
    icon: (
      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
      </svg>
    ),
  },
  {
    label: "System",
    prefix: "/system",
    defaultPath: "/system/inbox",
    description: "Inbox, security & settings",
    hasBadge: true,
    icon: (
      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
      </svg>
    ),
  },
  {
    label: "Workflows",
    prefix: "/workflows",
    defaultPath: "/workflows/list",
    description: "Design, automate & monitor",
    icon: (
      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
      </svg>
    ),
  },
];

// ─── LocalStorage helpers ─────────────────────────────────────────────────────

const LS_SIDEBAR_COLLAPSED = "admin_sidebar_collapsed";

function readSidebarCollapsed(): boolean {
  try { return localStorage.getItem(LS_SIDEBAR_COLLAPSED) === "true"; } catch { return false; }
}

// ─── Breadcrumb helper ────────────────────────────────────────────────────────

// Explicit section-level labels keyed by exact workspace path
const SECTION_LABELS: Record<string, { group: string; label: string }> = {
  // Command
  "/command/overview":  { group: "Command", label: "Overview" },
  "/command/messages":  { group: "Command", label: "Messages" },
  "/command/analytics": { group: "Command", label: "Analytics" },
  "/command/marketing": { group: "Command", label: "Marketing" },
  "/command/prompts":   { group: "Command", label: "AI Prompts" },
  "/command/scripts":   { group: "Command", label: "M365 Scripts" },
  // Pipeline
  "/pipeline/leads":             { group: "Pipeline", label: "Leads" },
  "/pipeline/quiz-leads":        { group: "Pipeline", label: "Quiz Leads" },
  "/pipeline/opportunities":     { group: "Pipeline", label: "Opportunities" },
  "/pipeline/clients":           { group: "Pipeline", label: "Clients" },
  "/pipeline/m365-intelligence": { group: "Pipeline", label: "M365 Intelligence" },
  // Delivery
  "/delivery/projects":             { group: "Delivery", label: "Projects" },
  "/delivery/clients":              { group: "Delivery", label: "Clients" },
  "/delivery/engagement-projects":  { group: "Delivery", label: "Engagement Projects" },
  "/delivery/workflows":            { group: "Delivery", label: "Workflows" },
  "/delivery/activity-logs":        { group: "Delivery", label: "Activity Logs" },
  "/delivery/hub-storage":          { group: "Delivery", label: "Hub Storage" },
  // Finance
  "/finance/invoices":   { group: "Finance", label: "Invoices" },
  "/finance/purchases":  { group: "Finance", label: "Purchases" },
  "/finance/contracts":  { group: "Finance", label: "Contracts" },
  "/finance/coupons":    { group: "Finance", label: "Coupons" },
  "/finance/reports":    { group: "Finance", label: "Reports" },
  // Content & Offers
  "/content/articles":             { group: "Content & Offers", label: "Articles" },
  "/content/services":             { group: "Content & Offers", label: "Services" },
  "/content/engagement-projects":  { group: "Content & Offers", label: "Engagement Projects" },
  "/content/service-triggers":     { group: "Content & Offers", label: "Service Triggers" },
  "/content/email-templates":      { group: "Content & Offers", label: "Email Templates" },
  "/content/contract-templates":   { group: "Content & Offers", label: "Contract Templates" },
  "/content/template-library":     { group: "Content & Offers", label: "Template Library" },
  "/content/asset-library":        { group: "Content & Offers", label: "Asset Library" },
  // System
  "/system/inbox":            { group: "System", label: "Inbox" },
  "/system/security":         { group: "System", label: "Security" },
  "/system/signal-mappings":  { group: "System", label: "Signal Mappings" },
  "/system/integrations":     { group: "System", label: "Integrations" },
  "/system/environment":      { group: "System", label: "Environment Settings" },
  // Workflows
  "/workflows/list":          { group: "Workflows", label: "Workflows" },
  "/workflows/runs":          { group: "Workflows", label: "Run History" },
};

// Prefix-based labels for detail pages that don't match exact paths
const PREFIX_LABELS: Array<{ prefix: string; group: string; label: string }> = [
  { prefix: "/crm/leads/",        group: "Pipeline",  label: "Lead Detail" },
  { prefix: "/crm/clients/",      group: "Pipeline",  label: "Client Detail" },
  { prefix: "/crm/projects/",     group: "Delivery",  label: "Project Detail" },
  { prefix: "/crm/invoices/",     group: "Finance",   label: "Invoice Detail" },
  { prefix: "/crm/purchases/",    group: "Finance",   label: "Purchase Detail" },
  { prefix: "/crm/opportunities/", group: "Pipeline", label: "Opportunity Detail" },
  { prefix: "/crm/documents",     group: "Delivery",  label: "Documents" },
  { prefix: "/crm/status-reports", group: "Delivery", label: "Status Reports" },
  { prefix: "/crm/testimonials",  group: "Delivery",  label: "Testimonials" },
  { prefix: "/prompt-center/",    group: "Command",   label: "Edit Prompt" },
  { prefix: "/asset-library/",        group: "Content & Offers", label: "Asset Library" },
  { prefix: "/workflows/builder/",    group: "Workflows",       label: "Builder" },
  { prefix: "/workflows/triggers/",   group: "Workflows",       label: "Triggers" },
  { prefix: "/workflows/runs/",       group: "Workflows",       label: "Run Detail" },
];

function computeBreadcrumb(location: string): { group: string; label: string } | null {
  // 1. Exact workspace path match
  if (SECTION_LABELS[location]) return SECTION_LABELS[location];
  // 2. Prefix match for workspace paths (e.g. /command/overview/sub)
  for (const [path, crumb] of Object.entries(SECTION_LABELS)) {
    if (location.startsWith(path + "/")) return crumb;
  }
  // 3. Prefix match for legacy detail pages
  for (const { prefix, group, label } of PREFIX_LABELS) {
    if (location.startsWith(prefix)) return { group, label };
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
  const showDescription = !collapsed && !isActive && !!item.description;
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
      {!collapsed && (
        <span className="flex-1 min-w-0 flex flex-col">
          <span className="truncate leading-snug">{item.label}</span>
          {showDescription && (
            <span className="text-[10px] font-normal text-[#484F58] truncate leading-snug mt-0.5">
              {item.description}
            </span>
          )}
        </span>
      )}
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
      <TooltipContent side="right">
        <span className="font-semibold">{item.label}</span>
        {item.description && (
          <span className="block text-xs text-muted-foreground mt-0.5">{item.description}</span>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

// ─── Campaign badge type ──────────────────────────────────────────────────────

interface CampaignBadge {
  id: number;
  name: string;
  slug: string;
  liveCount: number;
}

// ─── TopHeader ────────────────────────────────────────────────────────────────

function TopHeader({
  onMobileMenuClick,
  location,
  user,
  onLogout,
  unreadEmailCount,
  liveVisitors,
  campaignBadges,
  unreadNotifCount,
  onBellClick,
  soundMuted,
  onToggleMute,
}: {
  onMobileMenuClick: () => void;
  location: string;
  user: { email?: string } | null;
  onLogout: () => void;
  unreadEmailCount: number;
  liveVisitors: number | null;
  campaignBadges: CampaignBadge[];
  unreadNotifCount: number;
  onBellClick: () => void;
  soundMuted: boolean;
  onToggleMute: () => void;
}) {
  const breadcrumb = computeBreadcrumb(location);

  return (
    <header className="h-14 bg-[#161B22] border-b border-[#30363D] flex items-center px-4 gap-3 flex-shrink-0 overflow-x-auto">
      {/* Mobile hamburger */}
      <button
        onClick={onMobileMenuClick}
        className="lg:hidden p-1.5 text-[#7D8590] hover:text-[#E6EDF3] rounded-lg hover:bg-[#1C2128] transition-colors flex-shrink-0"
        aria-label="Open navigation"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Breadcrumb — desktop */}
      <div className="hidden lg:flex items-center gap-1.5 text-xs min-w-0 flex-shrink-0">
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
      <span className="lg:hidden font-bold text-[#E6EDF3] text-sm flex-shrink-0">Admin Panel</span>

      {/* Live & campaign badges — left of search, flex-wrap to handle many campaigns */}
      <div className="hidden md:flex items-center gap-1.5 flex-wrap flex-1 min-w-0">
        {liveVisitors !== null && (
          liveVisitors > 0 ? (
            <span className="flex items-center gap-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-semibold px-2 py-1 rounded-full whitespace-nowrap flex-shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span key={liveVisitors} className="count-pop tabular-nums">{liveVisitors}</span>{" live now"}
            </span>
          ) : (
            <span className="flex items-center gap-1 bg-[#161B22] border border-[#30363D] text-[#484F58] text-[10px] font-semibold px-2 py-1 rounded-full whitespace-nowrap flex-shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-[#30363D]" />
              0 live now
            </span>
          )
        )}
        {campaignBadges.map(c => (
          <span
            key={c.id}
            title={`Landing page: /landing-pages/${c.slug}`}
            className="flex items-center gap-1 bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] font-semibold px-2 py-1 rounded-full whitespace-nowrap flex-shrink-0 cursor-default"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            {c.name}
            {c.liveCount > 0 && (
              <>
                {" — "}
                <span key={c.liveCount} className="count-pop tabular-nums">{c.liveCount}</span>
                {" live"}
              </>
            )}
          </span>
        ))}
        {/* Spacer so search box is pushed right */}
        <div className="flex-1" />
      </div>

      {/* flex-1 for mobile (no badges showing) */}
      <div className="md:hidden flex-1" />

      {/* Global search */}
      <div className="hidden md:flex items-center gap-2 bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-1.5 w-52 focus-within:border-[#0078D4]/60 transition-colors flex-shrink-0">
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

      {/* Purchase sound mute toggle */}
      <button
        onClick={onToggleMute}
        className="p-1.5 text-[#7D8590] hover:text-[#E6EDF3] rounded-lg hover:bg-[#1C2128] transition-colors flex-shrink-0"
        title={soundMuted ? "Unmute purchase alerts" : "Mute purchase alerts"}
      >
        {soundMuted ? (
          <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
          </svg>
        ) : (
          <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072M12 6v12m0 0l-4.243-4.243M12 18l4.243-4.243M12 6l-4.243 4.243M12 6l4.243 4.243" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
          </svg>
        )}
      </button>

      {/* Notification bell — opens notification drawer */}
      <button
        onClick={onBellClick}
        className="relative p-1.5 text-[#7D8590] hover:text-[#E6EDF3] rounded-lg hover:bg-[#1C2128] transition-colors flex-shrink-0"
        title="Notifications"
      >
        <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unreadNotifCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-0.5 leading-none">
            {unreadNotifCount > 99 ? "99+" : unreadNotifCount}
          </span>
        )}
      </button>

      {/* Identity chip */}
      <div className="flex items-center gap-2.5 pl-3 border-l border-[#30363D] flex-shrink-0">
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
  location,
  user,
  onClose,
  unreadEmailCount,
}: {
  collapsed: boolean;
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

      {/* Workspace nav — 6 items */}
      <nav className={`flex-1 overflow-y-auto p-2 space-y-0.5 ${collapsed ? "overflow-x-hidden" : ""}`}>
        {!collapsed && (
          <p className="text-[9px] font-bold uppercase tracking-widest text-[#484F58] px-2.5 py-1.5 mt-1">
            Workspaces
          </p>
        )}
        {WORKSPACES.map(ws => {
          const isActive = location === ws.prefix || location.startsWith(ws.prefix + "/");
          const badge = ws.hasBadge ? unreadEmailCount : 0;
          const navItem: NavItem = { label: ws.label, path: ws.defaultPath, icon: ws.icon, description: ws.description };
          return (
            <NavItemLink
              key={ws.label}
              item={navItem}
              isActive={isActive}
              collapsed={collapsed}
              onClick={onClose}
              badge={badge || undefined}
            />
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
  const { user, logout, fetchWithAuth, accessToken } = useAuth();
  const [location, navigate] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => readSidebarCollapsed());
  const [unreadEmailCount, setUnreadEmailCount] = useState(0);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── Purchase sound ─────────────────────────────────────────────────────────
  const { playPurchaseSound, muted: soundMuted, toggleMute } = usePurchaseSound();

  // ─── Sale flash toast ────────────────────────────────────────────────────────
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

  // ─── Lead flash toast ────────────────────────────────────────────────────────
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

  // ─── Live visitors ──────────────────────────────────────────────────────────
  const [liveVisitors, setLiveVisitors] = useState<number | null>(null);
  const liveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── Campaign badges ────────────────────────────────────────────────────────
  const [campaignBadges, setCampaignBadges] = useState<CampaignBadge[]>([]);
  const campaignTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── Notification drawer ────────────────────────────────────────────────────
  const [notifDrawerOpen, setNotifDrawerOpen] = useState(false);
  const [unreadNotifCount, setUnreadNotifCount] = useState(0);

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

  const fetchCampaignBadges = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/admin/marketing/active-campaign-badges");
      if (res.ok) {
        const d = await res.json() as CampaignBadge[];
        setCampaignBadges(d);
      }
    } catch {}
  }, [fetchWithAuth]);

  // ─── Workflow sound SSE consumer ────────────────────────────────────────────
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

  // ─── Service worker PLAY_WORKFLOW_SOUND handler ───────────────────────────
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
      // An intentional abort (proactive reconnect or unmount) must be treated as
      // a clean close (true) so the connect loop schedules a reconnect instead of
      // falling back to polling.
      return signal.aborted;
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    const isInbox = location === "/inbox" || location === "/system/inbox";
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
  }, [location, fetchCount]);

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

  useEffect(() => {
    try { localStorage.setItem(LS_SIDEBAR_COLLAPSED, String(sidebarCollapsed)); } catch {}
  }, [sidebarCollapsed]);

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
            sidebarCollapsed ? "w-[60px]" : "w-48"
          }`}
        >
          <SidebarContent
            collapsed={sidebarCollapsed}
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
            <aside className="absolute left-0 top-0 bottom-0 w-48 flex flex-col">
              <SidebarContent
                collapsed={false}
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
          <TopHeader
            onMobileMenuClick={() => setMobileOpen(true)}
            location={location}
            user={user}
            onLogout={handleLogout}
            unreadEmailCount={unreadEmailCount}
            liveVisitors={liveVisitors}
            campaignBadges={campaignBadges}
            unreadNotifCount={unreadNotifCount}
            onBellClick={() => setNotifDrawerOpen(true)}
            soundMuted={soundMuted}
            onToggleMute={toggleMute}
          />

          <main className="flex-1 overflow-y-auto bg-[#0D1117]">
            <EmailBadgeContext.Provider value={{ refreshUnreadCount }}>
              {children}
            </EmailBadgeContext.Provider>
          </main>
        </div>
      </div>

      {/* Notification drawer */}
      <NotificationDrawer
        open={notifDrawerOpen}
        onOpenChange={setNotifDrawerOpen}
        unreadCount={unreadNotifCount}
        onUnreadCountChange={setUnreadNotifCount}
        onPurchaseSound={playPurchaseSound}
        onPurchaseFlash={triggerSaleFlash}
        onLeadFlash={triggerLeadFlash}
      />

      {/* Sale flash toast */}
      {flashVisible && (
        <button
          onClick={() => {
            if (flashEnterTimerRef.current) clearTimeout(flashEnterTimerRef.current);
            if (flashExitTimerRef.current) clearTimeout(flashExitTimerRef.current);
            setFlashVisible(false);
            setFlashExiting(false);
            navigate("/finance/purchases");
          }}
          className={`fixed top-4 right-4 z-[9999] flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-2xl border border-emerald-500/30 bg-[#0D2818]/95 backdrop-blur-sm cursor-pointer hover:bg-[#0D2818] hover:border-emerald-500/50 transition-colors ${
            flashExiting ? "sale-flash-exit" : "sale-flash-enter"
          }`}
        >
          <span className="text-xl leading-none">💰</span>
          <div className="leading-tight text-left">
            <p className="text-sm font-bold text-emerald-300">New sale!</p>
            <p className="text-[11px] text-emerald-500/80 font-medium">
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

      {/* Lead flash toast */}
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
          className={`fixed right-4 z-[9999] flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-2xl border border-blue-500/30 bg-[#081828]/95 backdrop-blur-sm cursor-pointer hover:bg-[#081828] hover:border-blue-500/50 transition-[background-color,border-color,top] ${
            leadFlashExiting ? "sale-flash-exit" : "sale-flash-enter"
          }`}
        >
          <span className="text-xl leading-none">👤</span>
          <div className="leading-tight text-left">
            <p className="text-sm font-bold text-blue-300">New lead!</p>
            <p className="text-[11px] text-blue-500/80 font-medium">A new lead just came in</p>
          </div>
        </button>
      )}
    </TooltipProvider>
  );
}
