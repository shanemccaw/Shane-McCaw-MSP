import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  DollarSign,
  LayoutDashboard,
  LogOut,
  PercentCircle,
  Shield,
  Users,
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

const OFFBOARDING_LABELS: Record<string, string> = {
  cancellation_requested: "Cancellation Requested",
  export_ready: "Export Ready",
  archival_flagged: "Archived",
};

interface DashboardData {
  msp: {
    id: number;
    name: string;
    status: string;
    offboardingState: string | null;
    offboardingRequestedAt: string | null;
    exportReadyAt: string | null;
  } | null;
  customers: {
    total: number;
    active: number;
    inactive: number;
    onboarding: number;
  };
  signalsFiredThisMonth: number;
  offerAcceptanceRate: number;
  revenueCentsThisMonth: number;
  revenueUsdThisMonth: string;
  periodStart: string;
}

function StatCard({
  title,
  value,
  sub,
  icon: Icon,
  loading,
}: {
  title: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  loading?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-20 mt-1" />
        ) : (
          <div className="text-2xl font-bold">{value}</div>
        )}
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const { user, logout, fetchWithAuth } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    fetchWithAuth("/api/msp/dashboard")
      .then(async (res) => {
        if (!res.ok) return;
        const json = (await res.json()) as DashboardData;
        if (mounted) setData(json);
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const periodLabel = data?.periodStart
    ? new Date(data.periodStart).toLocaleString("default", {
        month: "long",
        year: "numeric",
      })
    : "This month";

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
          <NavItem icon={LayoutDashboard} label="Dashboard" href="/dashboard" active />
          <NavItem icon={Building2} label="MSPs" href="/msps" />
          <NavItem icon={Users} label="Customers" href="/customers" />
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

      {/* Main */}
      <main className="flex-1 overflow-auto">
        {/* Topbar */}
        <header className="h-14 border-b border-border bg-background flex items-center px-6">
          <h1 className="text-sm font-semibold text-foreground">Dashboard</h1>
        </header>

        <div className="p-6 space-y-6">
          {/* Welcome + offboarding banner */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold tracking-tight">
                Welcome back{user?.name ? `, ${user.name.split(" ")[0]}` : ""}
              </h2>
              <p className="text-muted-foreground text-sm mt-1">
                {data?.msp?.name
                  ? `${data.msp.name} — ${periodLabel}`
                  : "MSP Performance Dashboard"}
              </p>
            </div>
            {data?.msp?.offboardingState && (
              <Link href="/offboarding">
                <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm text-amber-700 cursor-pointer hover:bg-amber-50">
                  <AlertTriangle className="size-4 shrink-0" />
                  <span className="font-medium">
                    {OFFBOARDING_LABELS[data.msp.offboardingState] ?? data.msp.offboardingState}
                  </span>
                  <ArrowRight className="size-3.5 shrink-0" />
                </div>
              </Link>
            )}
          </div>

          {/* KPI stat cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard
              title="Signals Fired"
              value={data?.signalsFiredThisMonth ?? 0}
              sub={periodLabel}
              icon={Activity}
              loading={loading}
            />
            <StatCard
              title="Offer Acceptance"
              value={`${data?.offerAcceptanceRate ?? 0}%`}
              sub="Active customer rate"
              icon={PercentCircle}
              loading={loading}
            />
            <StatCard
              title="Monitoring Revenue"
              value={`$${data?.revenueUsdThisMonth ?? "0.00"}`}
              sub={periodLabel}
              icon={DollarSign}
              loading={loading}
            />
          </div>

          {/* Customer breakdown */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium">Total Customers</CardTitle>
                <Users className="size-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {loading ? (
                  <Skeleton className="h-8 w-12 mt-1" />
                ) : (
                  <div className="text-2xl font-bold">{data?.customers.total ?? 0}</div>
                )}
                <CardDescription className="text-xs mt-1">All organisations</CardDescription>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium">Active</CardTitle>
                <CheckCircle2 className="size-4 text-green-500" />
              </CardHeader>
              <CardContent>
                {loading ? (
                  <Skeleton className="h-8 w-12 mt-1" />
                ) : (
                  <div className="text-2xl font-bold text-green-600">
                    {data?.customers.active ?? 0}
                  </div>
                )}
                <CardDescription className="text-xs mt-1">
                  {data && data.customers.total > 0
                    ? `${Math.round((data.customers.active / data.customers.total) * 100)}% of total`
                    : "No customers yet"}
                </CardDescription>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium">Onboarding</CardTitle>
                <Activity className="size-4 text-blue-500" />
              </CardHeader>
              <CardContent>
                {loading ? (
                  <Skeleton className="h-8 w-12 mt-1" />
                ) : (
                  <div className="text-2xl font-bold text-blue-600">
                    {data?.customers.onboarding ?? 0}
                  </div>
                )}
                <CardDescription className="text-xs mt-1">In progress</CardDescription>
              </CardContent>
            </Card>
          </div>

          {/* Session + MSP info */}
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

          {/* Offboarding CTA — only shown to MSPAdmin when no offboarding in progress */}
          {(user?.mspRole === "MSPAdmin" || user?.role === "admin") &&
            !data?.msp?.offboardingState && (
              <Card className="border-dashed">
                <CardContent className="flex items-center justify-between py-4">
                  <div>
                    <p className="text-sm font-medium">Offboarding</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Export your customer data or request cancellation
                    </p>
                  </div>
                  <Link href="/offboarding">
                    <Button variant="outline" size="sm" className="gap-2">
                      Manage
                      <ArrowRight className="size-3.5" />
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            )}
        </div>
      </main>
    </div>
  );
}

function NavItem({
  icon: Icon,
  label,
  href,
  active,
}: {
  icon: React.ElementType;
  label: string;
  href?: string;
  active?: boolean;
}) {
  const cls = `w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors ${
    active
      ? "bg-sidebar-accent text-sidebar-foreground font-medium"
      : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
  }`;

  if (href && !active) {
    return (
      <Link href={href}>
        <button className={cls}>
          <Icon className="size-4 shrink-0" />
          <span>{label}</span>
        </button>
      </Link>
    );
  }

  return (
    <button className={cls}>
      <Icon className="size-4 shrink-0" />
      <span>{label}</span>
    </button>
  );
}
