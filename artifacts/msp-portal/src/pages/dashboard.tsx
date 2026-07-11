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
  FileBarChart2,
  Info,
  PercentCircle,
  RefreshCw,
  TrendingDown,
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

interface LicenseWasteData {
  totalCustomers: number;
  customersWithWaste: number;
  estimatedAnnualSavings: number;
  estimatedAnnualSavingsFormatted: string;
  totalUnusedLicenses: number;
  reportsGenerated: number;
  hasData: boolean;
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
  const [error, setError] = useState(false);
  const [wasteData, setWasteData] = useState<LicenseWasteData | null>(null);

  useEffect(() => {
    let mounted = true;
    fetchWithAuth("/api/msp/dashboard")
      .then(async (res) => {
        if (!res.ok) {
          if (mounted) setError(true);
          return;
        }
        const json = (await res.json()) as DashboardData;
        if (mounted) setData(json);
      })
      .catch(() => {
        if (mounted) setError(true);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    // License waste tile — independent fetch
    fetchWithAuth("/api/msp/reports/license-waste")
      .then(async (res) => {
        if (!res.ok) return;
        const json = (await res.json()) as LicenseWasteData;
        if (mounted) setWasteData(json);
      })
      .catch(() => {});

    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const periodLabel = data?.periodStart
    ? new Date(data.periodStart).toLocaleString("default", {
        month: "long",
        year: "numeric",
      })
    : "This month";

  // Determine if PlatformAdmin is viewing without an MSP context
  const isPlatformAdminNoMsp = !loading && !error && user?.role === "admin" && !data?.msp;

  return (
    <AppShell title="Dashboard">
      <div className="p-6 space-y-6">

        {/* Error banner — shown when the dashboard API call fails */}
        {error && (
          <Card className="border-destructive/40 bg-destructive/10">
            <CardContent className="flex items-center gap-3 py-4">
              <RefreshCw className="size-4 text-destructive shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-destructive">Unable to load dashboard data</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Please refresh the page. If the problem persists, contact support.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.location.reload()}
                className="shrink-0 border-destructive/30 text-destructive hover:bg-destructive/10"
              >
                Refresh
              </Button>
            </CardContent>
          </Card>
        )}

        {/* PlatformAdmin no-MSP context info banner */}
        {isPlatformAdminNoMsp && (
          <Card className="border-blue-500/30 bg-blue-500/10">
            <CardContent className="flex items-center gap-3 py-4">
              <Info className="size-4 text-blue-400 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-blue-300">Viewing as Platform Admin — no MSP selected</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Metrics below show platform-wide totals. Select a specific MSP tenant to see per-MSP data.
                </p>
              </div>
              <Link href="/msps">
                <Button variant="outline" size="sm" className="shrink-0 border-blue-500/30 text-blue-300 hover:bg-blue-500/10">
                  MSPs list
                  <ArrowRight className="size-3.5 ml-1.5" />
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}

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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Signals Fired"
            value={error || isPlatformAdminNoMsp ? "—" : (data?.signalsFiredThisMonth ?? 0)}
            sub={periodLabel}
            icon={Activity}
            loading={loading}
          />
          <StatCard
            title="Offer Acceptance"
            value={error || isPlatformAdminNoMsp ? "—" : `${data?.offerAcceptanceRate ?? 0}%`}
            sub="Active customer rate"
            icon={PercentCircle}
            loading={loading}
          />
          <StatCard
            title="Monitoring Revenue"
            value={error || isPlatformAdminNoMsp ? "—" : `$${data?.revenueUsdThisMonth ?? "0.00"}`}
            sub={periodLabel}
            icon={DollarSign}
            loading={loading}
          />
          {/* License Waste tile */}
          <Link href="/reports">
            <Card className="cursor-pointer hover:border-primary/40 transition-colors group">
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium">License Waste</CardTitle>
                <TrendingDown className="size-4 text-amber-400" />
              </CardHeader>
              <CardContent>
                {loading || wasteData === null ? (
                  <Skeleton className="h-8 w-20 mt-1" />
                ) : (
                  <div className="text-2xl font-bold text-amber-400">
                    {wasteData.estimatedAnnualSavingsFormatted}
                  </div>
                )}
                <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                  {wasteData
                    ? `${wasteData.customersWithWaste} of ${wasteData.totalCustomers} customers`
                    : "Identifiable annual savings"}
                  <FileBarChart2 className="size-3 ml-auto text-muted-foreground/50 group-hover:text-primary transition-colors" />
                </p>
              </CardContent>
            </Card>
          </Link>
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
                <div className="text-2xl font-bold">
                  {error || isPlatformAdminNoMsp ? "—" : (data?.customers.total ?? 0)}
                </div>
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
                  {error || isPlatformAdminNoMsp ? "—" : (data?.customers.active ?? 0)}
                </div>
              )}
              <CardDescription className="text-xs mt-1">
                {error || isPlatformAdminNoMsp
                  ? "Select an MSP to view"
                  : data && data.customers.total > 0
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
                  {error || isPlatformAdminNoMsp ? "—" : (data?.customers.onboarding ?? 0)}
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
