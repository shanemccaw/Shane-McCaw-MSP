/**
 * AppShell — shared layout for all authenticated MSP Portal pages.
 *
 * Provides:
 *   - Role-aware sidebar navigation
 *   - Tenant/customer switcher for MSPAdmins and PlatformAdmins
 *   - Real white-label branding from /api/msp/profile (MSP name, logo, primary color)
 *   - Persistent credibility footer (non-removable)
 *   - Cmd+K command palette
 *   - Mobile-responsive with collapsible sidebar
 */

import { useState, useEffect, useCallback, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useAuth, type MspRole } from "@/lib/auth-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CommandPalette } from "@/components/command-palette";
import {
  Activity,
  AlertCircle,
  Award,
  Bell,
  Building2,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Cog,
  FileText,
  Home,
  LayoutDashboard,
  ListTodo,
  LogOut,
  Menu,
  Play,
  Search,
  Shield,
  Users,
  Zap,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface NavSection {
  label: string;
  items: NavItem[];
}

interface NavItem {
  icon: React.ElementType;
  label: string;
  href: string;
  roles?: MspRole[];
}

interface MspProfile {
  id: number;
  name: string;
  logoUrl?: string;
  primaryColor?: string;
  status: string;
}

// ── Navigation config ─────────────────────────────────────────────────────────

const NAV_SECTIONS: NavSection[] = [
  {
    label: "Overview",
    items: [
      {
        icon: LayoutDashboard,
        label: "Dashboard",
        href: "/dashboard",
        roles: ["PlatformAdmin", "MSPAdmin", "MSPOperator"],
      },
    ],
  },
  {
    label: "My Portal",
    items: [
      {
        icon: Home,
        label: "Home",
        href: "/customer-home",
        roles: ["CustomerUser"],
      },
      {
        icon: FileText,
        label: "Documents",
        href: "/customer-documents",
        roles: ["CustomerUser"],
      },
      {
        icon: Zap,
        label: "Diagnostics & Offers",
        href: "/customer-diagnostics",
        roles: ["CustomerUser"],
      },
    ],
  },
  {
    label: "Management",
    items: [
      {
        icon: Building2,
        label: "MSPs",
        href: "/msps",
        roles: ["PlatformAdmin"],
      },
      {
        icon: Users,
        label: "Customers",
        href: "/customers",
        roles: ["PlatformAdmin", "MSPAdmin", "MSPOperator"],
      },
      {
        icon: Bell,
        label: "Events",
        href: "/events",
        roles: ["PlatformAdmin", "MSPAdmin", "MSPOperator"],
      },
      {
        icon: Shield,
        label: "Audit Logs",
        href: "/audit",
        roles: ["PlatformAdmin", "MSPAdmin"],
      },
    ],
  },
  {
    label: "Operations",
    items: [
      {
        icon: ListTodo,
        label: "Operator Tasks",
        href: "/operator-tasks",
        roles: ["PlatformAdmin", "MSPAdmin", "MSPOperator"],
      },
      {
        icon: Play,
        label: "Workflow Runs",
        href: "/runs",
        roles: ["PlatformAdmin", "MSPAdmin", "MSPOperator"],
      },
      {
        icon: AlertCircle,
        label: "Dead Letter Queue",
        href: "/dlq",
        roles: ["PlatformAdmin", "MSPAdmin"],
      },
    ],
  },
  {
    label: "Account",
    items: [
      {
        icon: FileText,
        label: "Offboarding",
        href: "/offboarding",
        roles: ["PlatformAdmin", "MSPAdmin"],
      },
      {
        icon: Cog,
        label: "Settings",
        href: "/settings",
        roles: ["PlatformAdmin", "MSPAdmin"],
      },
    ],
  },
];

const ROLE_COLORS: Record<MspRole, string> = {
  PlatformAdmin: "bg-primary text-primary-foreground",
  MSPAdmin: "bg-accent/20 text-accent",
  MSPOperator: "bg-secondary text-secondary-foreground",
  CustomerUser: "bg-muted text-muted-foreground",
  ServiceAccount: "bg-muted text-muted-foreground",
  Free: "bg-muted text-muted-foreground",
};

// ── Sidebar nav item ──────────────────────────────────────────────────────────

function SidebarNavItem({
  item,
  collapsed,
}: {
  item: NavItem;
  collapsed: boolean;
}) {
  const [location] = useLocation();
  const active =
    item.href === "/dashboard"
      ? location === "/dashboard" || location === "/"
      : location.startsWith(item.href);

  const cls = [
    "flex items-center gap-2.5 rounded-md text-sm transition-colors w-full",
    collapsed ? "px-2 py-2 justify-center" : "px-3 py-2",
    active
      ? "bg-sidebar-accent text-sidebar-foreground font-medium"
      : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
  ].join(" ");

  return (
    <Link href={item.href}>
      <button className={cls} title={collapsed ? item.label : undefined}>
        <item.icon className="size-4 shrink-0" />
        {!collapsed && <span>{item.label}</span>}
      </button>
    </Link>
  );
}

// ── Tenant/customer switcher ──────────────────────────────────────────────────

interface TenantEntry {
  id: number;
  name: string;
  type: "msp" | "customer";
}

function TenantSwitcher({
  profile,
  collapsed,
  fetchWithAuth,
  mspRole,
}: {
  profile: MspProfile | null;
  collapsed: boolean;
  fetchWithAuth: ReturnType<typeof useAuth>["fetchWithAuth"];
  mspRole: MspRole | undefined;
}) {
  const [, navigate] = useLocation();
  const [tenants, setTenants] = useState<TenantEntry[]>([]);
  const [open, setOpen] = useState(false);

  // PlatformAdmin can switch between MSPs; MSPAdmin can switch customer context
  const canSwitch = mspRole === "PlatformAdmin" || mspRole === "MSPAdmin";

  useEffect(() => {
    if (!open || !canSwitch) return;
    const endpoint =
      mspRole === "PlatformAdmin" ? "/api/admin/msps?limit=20" : "/api/msp/customers?limit=20";
    fetchWithAuth(endpoint)
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as {
          msps?: Array<{ id: number; name: string }>;
          customers?: Array<{ id: number; name: string }>;
        };
        const items: TenantEntry[] = [
          ...(data.msps ?? []).map((m) => ({ id: m.id, name: m.name, type: "msp" as const })),
          ...(data.customers ?? []).map((c) => ({
            id: c.id,
            name: c.name,
            type: "customer" as const,
          })),
        ];
        setTenants(items);
      })
      .catch(() => {});
  }, [open, canSwitch, mspRole, fetchWithAuth]);

  const displayName = profile?.name ?? "MSP Platform";

  if (!canSwitch || collapsed) {
    return (
      <div
        className={`px-3 py-2 rounded-md bg-sidebar-accent/40 ${collapsed ? "flex justify-center" : ""}`}
        title={collapsed ? displayName : undefined}
      >
        {collapsed ? (
          <Building2 className="size-4 text-sidebar-foreground/60" />
        ) : (
          <p className="text-xs font-medium text-sidebar-foreground truncate">{displayName}</p>
        )}
      </div>
    );
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button className="w-full flex items-center gap-2 px-3 py-2 rounded-md bg-sidebar-accent/40 hover:bg-sidebar-accent/70 transition-colors text-left">
          <Building2 className="size-3.5 text-sidebar-foreground/60 shrink-0" />
          <span className="flex-1 text-xs font-medium text-sidebar-foreground truncate">
            {displayName}
          </span>
          <ChevronDown className="size-3 text-sidebar-foreground/40 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="right"
        align="start"
        className="w-56"
        sideOffset={4}
      >
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          {mspRole === "PlatformAdmin" ? "Switch MSP" : "Switch Customer"}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {tenants.length === 0 ? (
          <DropdownMenuItem disabled className="text-xs text-muted-foreground">
            Loading…
          </DropdownMenuItem>
        ) : (
          tenants.slice(0, 10).map((t) => (
            <DropdownMenuItem
              key={`${t.type}-${t.id}`}
              className="text-sm gap-2"
              onSelect={() => {
                if (t.type === "msp") navigate("/msps");
                else navigate(`/customers/${t.id}`);
              }}
            >
              {t.type === "msp" ? (
                <Building2 className="size-3.5 text-muted-foreground" />
              ) : (
                <Users className="size-3.5 text-muted-foreground" />
              )}
              <span className="truncate">{t.name}</span>
              {profile && t.type === "msp" && t.id === profile.id && (
                <Check className="size-3.5 ml-auto text-primary" />
              )}
            </DropdownMenuItem>
          ))
        )}
        {mspRole === "PlatformAdmin" && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-xs text-muted-foreground gap-2"
              onSelect={() => navigate("/msps")}
            >
              <Building2 className="size-3.5" />
              View all MSPs
            </DropdownMenuItem>
          </>
        )}
        {mspRole === "MSPAdmin" && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-xs text-muted-foreground gap-2"
              onSelect={() => navigate("/customers")}
            >
              <Users className="size-3.5" />
              View all customers
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Main AppShell ─────────────────────────────────────────────────────────────

interface AppShellProps {
  children: ReactNode;
  title?: string;
  actions?: ReactNode;
}

export function AppShell({ children, title, actions }: AppShellProps) {
  const { user, logout, fetchWithAuth } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [profile, setProfile] = useState<MspProfile | null>(null);

  const mspRole = user?.mspRole;

  // Fetch MSP profile for real white-label branding
  useEffect(() => {
    if (!user) return;
    fetchWithAuth("/api/msp/profile")
      .then(async (res) => {
        if (res.ok) setProfile(await res.json() as MspProfile);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.mspId]);

  // Inject MSP primary color as CSS custom property (safe: server-controlled)
  useEffect(() => {
    if (!profile?.primaryColor) return;
    const safe = profile.primaryColor.replace(/[^a-zA-Z0-9#(),%.\s]/g, "");
    document.documentElement.style.setProperty("--msp-brand-color", safe);
    return () => {
      document.documentElement.style.removeProperty("--msp-brand-color");
    };
  }, [profile?.primaryColor]);

  function isVisible(item: NavItem) {
    if (!item.roles || item.roles.length === 0) return true;
    if (!mspRole) return false;
    return item.roles.includes(mspRole);
  }

  // Cmd+K global keyboard shortcut
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCmdOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const brandName = profile?.name ?? "MSP Platform";
  const sidebarWidth = collapsed ? "w-14" : "w-60";

  const sidebarContent = (
    <div
      className={`flex flex-col h-full bg-sidebar text-sidebar-foreground ${sidebarWidth} shrink-0 border-r border-sidebar-border transition-all duration-200`}
    >
      {/* Logo / brand */}
      <div
        className={`flex items-center border-b border-sidebar-border ${collapsed ? "px-2 py-4 justify-center" : "px-4 py-4 gap-2.5"}`}
      >
        {profile?.logoUrl ? (
          <img
            src={profile.logoUrl}
            alt={brandName}
            className="size-6 object-contain shrink-0"
          />
        ) : (
          <Shield className="size-5 text-sidebar-primary shrink-0" />
        )}
        {!collapsed && (
          <span className="font-semibold text-sm truncate flex-1">{brandName}</span>
        )}
        {!collapsed && (
          <button
            className="text-sidebar-foreground/40 hover:text-sidebar-foreground shrink-0"
            onClick={() => setCollapsed(true)}
            title="Collapse sidebar"
          >
            <ChevronLeft className="size-4" />
          </button>
        )}
      </div>

      {/* Tenant/customer switcher */}
      {!collapsed && (
        <div className="px-3 pt-3 pb-1">
          <TenantSwitcher
            profile={profile}
            collapsed={collapsed}
            fetchWithAuth={fetchWithAuth}
            mspRole={mspRole}
          />
        </div>
      )}
      {collapsed && (
        <div className="px-2 pt-3 pb-1">
          <TenantSwitcher
            profile={profile}
            collapsed={collapsed}
            fetchWithAuth={fetchWithAuth}
            mspRole={mspRole}
          />
        </div>
      )}

      {/* Search trigger */}
      {!collapsed && (
        <div className="px-3 pt-2 pb-1">
          <button
            className="w-full flex items-center gap-2 rounded-md border border-sidebar-border bg-sidebar-accent/40 px-2.5 py-1.5 text-xs text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/70 transition-colors"
            onClick={() => setCmdOpen(true)}
          >
            <Search className="size-3.5 shrink-0" />
            <span className="flex-1 text-left">Search customers…</span>
            <kbd className="text-[10px] bg-sidebar-border px-1 rounded">⌘K</kbd>
          </button>
        </div>
      )}
      {collapsed && (
        <div className="px-2 pt-2 pb-1">
          <button
            className="w-full flex justify-center rounded-md py-1.5 text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/60 transition-colors"
            onClick={() => setCmdOpen(true)}
            title="Search (⌘K)"
          >
            <Search className="size-4" />
          </button>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-4">
        {NAV_SECTIONS.map((section) => {
          const visibleItems = section.items.filter(isVisible);
          if (visibleItems.length === 0) return null;
          return (
            <div key={section.label}>
              {!collapsed && (
                <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/40">
                  {section.label}
                </p>
              )}
              <div className="space-y-0.5">
                {visibleItems.map((item) => (
                  <SidebarNavItem key={item.href} item={item} collapsed={collapsed} />
                ))}
              </div>
            </div>
          );
        })}
      </nav>

      {/* User / sign-out */}
      <div className="px-2 py-3 border-t border-sidebar-border space-y-1">
        {!collapsed && (
          <div className="px-3 py-2 rounded-md bg-sidebar-accent/40">
            <p className="text-xs font-medium text-sidebar-foreground truncate">
              {user?.name ?? user?.email}
            </p>
            <p className="text-[11px] text-sidebar-foreground/50 truncate">{user?.email}</p>
            {mspRole && (
              <Badge
                className={`mt-1 text-[10px] px-1.5 py-0 h-4 ${ROLE_COLORS[mspRole] ?? "bg-muted"}`}
              >
                {mspRole}
              </Badge>
            )}
          </div>
        )}
        <Button
          variant="ghost"
          size="sm"
          className={`text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent ${collapsed ? "w-full justify-center px-2" : "w-full justify-start"}`}
          onClick={() => void logout()}
          title={collapsed ? "Sign out" : undefined}
        >
          <LogOut className={`size-4 ${collapsed ? "" : "mr-2"}`} />
          {!collapsed && "Sign out"}
        </Button>
        {collapsed && (
          <button
            className="w-full flex justify-center py-1.5 text-sidebar-foreground/40 hover:text-sidebar-foreground"
            onClick={() => setCollapsed(false)}
            title="Expand sidebar"
          >
            <ChevronRight className="size-4" />
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop sidebar */}
      <div className="hidden md:flex flex-col">{sidebarContent}</div>

      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={() => setMobileOpen(false)}
        >
          <div
            className="absolute left-0 top-0 h-full flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {sidebarContent}
          </div>
        </div>
      )}

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar */}
        <header className="h-14 shrink-0 border-b border-border bg-background/80 backdrop-blur flex items-center gap-3 px-4 md:px-6 sticky top-0 z-10">
          <button
            className="md:hidden text-muted-foreground hover:text-foreground"
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="size-5" />
          </button>

          {title && (
            <h1 className="text-sm font-semibold text-foreground truncate">{title}</h1>
          )}

          <div className="ml-auto flex items-center gap-2">
            {actions}
            <button
              className="hidden sm:flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              onClick={() => setCmdOpen(true)}
            >
              <Search className="size-3.5" />
              <span>Search</span>
              <kbd className="text-[10px] bg-border px-1 rounded">⌘K</kbd>
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto">{children}</main>

        {/* Credibility footer — persistent, non-removable */}
        <footer className="shrink-0 border-t border-border bg-background/60 px-6 py-3">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <Award className="size-3.5 text-primary shrink-0" />
              <span>
                Modernization delivered by a{" "}
                <span className="text-foreground font-medium">
                  30-Year Microsoft Veteran &amp; M365 Architect for NASA
                </span>
              </span>
            </div>
            <span className="shrink-0">
              Powered by{" "}
              <span className="text-foreground font-medium">Shane McCaw Consulting</span>
            </span>
          </div>
        </footer>
      </div>

      <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} />
    </div>
  );
}
