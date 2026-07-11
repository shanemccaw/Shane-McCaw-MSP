import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Shield,
  LayoutDashboard,
  LogOut,
  Building2,
  Users,
  Bell,
  Link2,
} from "lucide-react";

const ROLE_COLORS: Record<string, string> = {
  PlatformAdmin: "bg-primary text-primary-foreground",
  MSPAdmin: "bg-accent text-accent-foreground",
  MSPOperator: "bg-secondary text-secondary-foreground",
  CustomerUser: "bg-muted text-muted-foreground",
  ServiceAccount: "bg-muted text-muted-foreground",
  Free: "bg-muted text-muted-foreground",
};

interface NavItemProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  href: string;
}

function NavItem({ icon: Icon, label, href }: NavItemProps) {
  const [location, navigate] = useLocation();
  const active = location === href;
  return (
    <button
      onClick={() => navigate(href)}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
          : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/60"
      }`}
    >
      <Icon className="size-4 shrink-0" />
      {label}
    </button>
  );
}

interface DashboardShellProps {
  children: React.ReactNode;
}

export function DashboardShell({ children }: DashboardShellProps) {
  const { user, logout } = useAuth();

  return (
    <div className="flex min-h-screen">
      <aside className="w-60 shrink-0 bg-sidebar text-sidebar-foreground flex flex-col border-r border-sidebar-border">
        <div className="px-5 py-5 border-b border-sidebar-border">
          <div className="flex items-center gap-2.5">
            <Shield className="size-5 text-sidebar-primary shrink-0" />
            <span className="font-semibold text-sm truncate">MSP Platform</span>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          <NavItem icon={LayoutDashboard} label="Dashboard" href="/dashboard" />
          <NavItem icon={Building2} label="MSPs" href="/msps" />
          <NavItem icon={Users} label="Customers" href="/customers" />
          <NavItem icon={Link2} label="Onboard Customer" href="/initiate-onboarding" />
          <NavItem icon={Bell} label="Events" href="/events" />
          <NavItem icon={Shield} label="Audit Logs" href="/audit" />
        </nav>

        <div className="px-3 py-4 border-t border-sidebar-border space-y-2">
          <div className="px-2 py-2 rounded-md bg-sidebar-accent/60">
            <p className="text-xs font-medium text-sidebar-foreground truncate">
              {user?.name ?? user?.email}
            </p>
            <p className="text-xs text-sidebar-foreground/60 truncate">{user?.email}</p>
            {user?.mspRole && (
              <Badge
                className={`mt-1 text-[10px] px-1.5 py-0 h-4 ${ROLE_COLORS[user.mspRole] ?? "bg-muted"}`}
              >
                {user.mspRole}
              </Badge>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
            onClick={() => void logout()}
          >
            <LogOut className="mr-2 size-4" />
            Sign out
          </Button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto bg-background">
        {children}
      </main>
    </div>
  );
}
