import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { Link } from "wouter";
import { AppShell } from "@/components/app-shell";
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
  CheckCircle2,
  DollarSign,
  PercentCircle,
  Users,
} from "lucide-react";

const ROLE_COLORS: Record<string, string> = {
  PlatformAdmin: "bg-primary text-primary-foreground",
  MSPAdmin: "bg-accent/20 text-accent",
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
  valueClass,
}: {
  title: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  loading?: boolean;
  valueClass?: string;
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
          <div className={`text-2xl font-bold ${valueClass ?? ""}`}>{value}</div>
        )}
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const { user, fetchWithAuth } = useAuth();
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
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const periodLabel = data?.periodStart
    ? new Date(data.periodStart).toLocaleString("default", {
        month: "long",
        year: "numeric",
      })
    : "This month";

  return (
    <AppShell title="Dashboard">
      <div className="p-6 space-y-6">
        {/* Welcome + offboarding banner */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">
              Welcome back{user?.name ? `, ${user.name.split(" ")[0]}` : ""}
            </h2>
            <p className="text-muted-foreground text-sm mt-1">
              {data?.msp?.name
                ? `${data.msp.name} — ${periodLabel}`
                : "MSP Performance Dashboard"}
            </p>
            {user?.mspRole && (
              <Badge
                className={`mt-2 text-[11px] px-2 py-0.5 ${ROLE_COLORS[user.mspRole] ?? "bg-muted"}`}
              >
                {user.mspRole}
              </Badge>
            )}
          </div>
          {data?.msp?.offboardingState && (
            <Link href="/offboarding">
              <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-400 cursor-pointer hover:bg-amber-500/15 transition-colors">
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
              {loading ? <Skeleton className="h-8 w-12 mt-1" /> : (
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
              {loading ? <Skeleton className="h-8 w-12 mt-1" /> : (
                <div className="text-2xl font-bold text-green-400">
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
              <Activity className="size-4 text-blue-400" />
            </CardHeader>
            <CardContent>
              {loading ? <Skeleton className="h-8 w-12 mt-1" /> : (
                <div className="text-2xl font-bold text-blue-400">
                  {data?.customers.onboarding ?? 0}
                </div>
              )}
              <CardDescription className="text-xs mt-1">In progress</CardDescription>
            </CardContent>
          </Card>
        </div>

        {/* Quick links */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card className="border-dashed">
            <CardContent className="flex items-center justify-between py-4">
              <div>
                <p className="text-sm font-medium">Customer List</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  View and manage your book of business
                </p>
              </div>
              <Link href="/customers">
                <Button variant="outline" size="sm" className="gap-2">
                  View
                  <ArrowRight className="size-3.5" />
                </Button>
              </Link>
            </CardContent>
          </Card>
          {(user?.mspRole === "MSPAdmin" || user?.role === "admin") &&
            !data?.msp?.offboardingState && (
              <Card className="border-dashed">
                <CardContent className="flex items-center justify-between py-4">
                  <div>
                    <p className="text-sm font-medium">Offboarding</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Export your data or request cancellation
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
      </div>
    </AppShell>
  );
}
