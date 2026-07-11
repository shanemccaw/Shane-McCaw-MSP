import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Building2,
  Users,
  Shield,
  LayoutDashboard,
  LogOut,
  Bell,
} from "lucide-react";

const ROLE_COLORS: Record<string, string> = {
  PlatformAdmin: "bg-primary text-primary-foreground",
  MSPAdmin: "bg-accent text-accent-foreground",
  MSPOperator: "bg-secondary text-secondary-foreground",
  CustomerUser: "bg-muted text-muted-foreground",
  ServiceAccount: "bg-muted text-muted-foreground",
  Free: "bg-muted text-muted-foreground",
};

export default function DashboardPage() {
  const { user, logout } = useAuth();

  const cards = [
    {
      title: "MSPs",
      description: "Managed service provider organisations",
      icon: Building2,
      value: "—",
      href: "/msps",
    },
    {
      title: "Customers",
      description: "End-customer organisations",
      icon: Users,
      value: "—",
      href: "/customers",
    },
    {
      title: "Audit Logs",
      description: "Platform event history",
      icon: Shield,
      value: "—",
      href: "/audit",
    },
  ];

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="w-60 shrink-0 bg-sidebar text-sidebar-foreground flex flex-col border-r border-sidebar-border">
        <div className="px-5 py-5 border-b border-sidebar-border">
          <div className="flex items-center gap-2.5">
            <Shield className="size-5 text-sidebar-primary shrink-0" />
            <span className="font-semibold text-sm truncate">MSP Platform</span>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          <NavItem icon={LayoutDashboard} label="Dashboard" active />
          <NavItem icon={Building2} label="MSPs" />
          <NavItem icon={Users} label="Customers" />
          <NavItem icon={Bell} label="Events" />
          <NavItem icon={Shield} label="Audit Logs" />
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

      {/* Main */}
      <main className="flex-1 overflow-auto">
        {/* Topbar */}
        <header className="h-14 border-b border-border bg-background flex items-center px-6">
          <h1 className="text-sm font-semibold text-foreground">Dashboard</h1>
        </header>

        <div className="p-6 space-y-6">
          {/* Welcome */}
          <div>
            <h2 className="text-2xl font-bold tracking-tight">
              Welcome back{user?.name ? `, ${user.name.split(" ")[0]}` : ""}
            </h2>
            <p className="text-muted-foreground text-sm mt-1">
              MSP Platform foundation — data model, auth, and event bus are live.
            </p>
          </div>

          {/* Stat cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {cards.map((card) => (
              <Card key={card.title} className="hover:shadow-md transition-shadow cursor-pointer">
                <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                  <CardTitle className="text-sm font-medium">{card.title}</CardTitle>
                  <card.icon className="size-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{card.value}</div>
                  <CardDescription className="text-xs mt-1">{card.description}</CardDescription>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Auth info */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Session Info</CardTitle>
              <CardDescription>Your current authentication context</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">User ID</dt>
                  <dd className="font-mono font-medium">{user?.id}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Role (legacy)</dt>
                  <dd className="font-medium capitalize">{user?.role}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">MSP Role</dt>
                  <dd className="font-medium">{user?.mspRole ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">MSP ID</dt>
                  <dd className="font-medium">{user?.mspId ?? "—"}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}

function NavItem({
  icon: Icon,
  label,
  active,
}: {
  icon: React.ElementType;
  label: string;
  active?: boolean;
}) {
  return (
    <button
      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors ${
        active
          ? "bg-sidebar-accent text-sidebar-foreground font-medium"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
      }`}
    >
      <Icon className="size-4 shrink-0" />
      <span>{label}</span>
    </button>
  );
}
