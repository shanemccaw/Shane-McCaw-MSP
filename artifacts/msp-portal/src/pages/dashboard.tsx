import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useMspSlug } from "@/lib/slug-context";
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
  Package,
  PercentCircle,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Users,
  Zap,
  ClipboardList,
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

interface FinancialBreakdown {
  grossRevenueUsd: string;
  wholesaleCostUsd: string;
  mspMarginUsd: string;
  mspMarginPct: string;
}

interface TelemetryPayload {
  financials: {
    monitoringMrr: FinancialBreakdown;
    projectRevenue: FinancialBreakdown;
    remediationRevenue: FinancialBreakdown;
    offerRevenue: FinancialBreakdown;
    total: FinancialBreakdown;
  };
  metrics: {
    activeSignalsCount: number;
    offerAcceptanceRate: number;
    openFulfillmentTasksCount: number;
  };
}

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
  unacceptedOffersCents: number;
  unacceptedOffersCount: number;
  idleBundles: Array<{ bundleId: string; name: string; daysIdle: number }>;
  aiAlertThreshold: number | null;
  aiPeriodUsagePct: number | null;
  telemetry?: TelemetryPayload;
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
  const slug = useMspSlug();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [wasteData, setWasteData] = useState<LicenseWasteData | null>(null);

  useEffect(() => {
    let mounted = true;

    // For PlatformAdmin (no mspId on token), append ?slug= so the backend resolves the MSP.
    const isPlatformAdmin = user?.role === "admin" || user?.mspRole === "PlatformAdmin";
    const slugParam = isPlatformAdmin && slug ? `?slug=${encodeURIComponent(slug)}` : "";

    fetchWithAuth(`/api/msp/dashboard${slugParam}`)
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
    fetchWithAuth(`/api/msp/reports/license-waste${slugParam}`)
      .then(async (res) => {
        if (!res.ok) return;
        const json = (await res.json()) as LicenseWasteData;
        if (mounted) setWasteData(json);
      })
      .catch(() => {});

    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const periodLabel = data?.periodStart
    ? new Date(data.periodStart).toLocaleString("default", {
        month: "long",
        year: "numeric",
      })
    : "This month";

  // Determine if PlatformAdmin is viewing without an MSP context
  const isPlatformAdminNoMsp = !loading && !error && user?.role === "admin" && !data?.msp;

  const hasErrorOrNoMsp = error || isPlatformAdminNoMsp;

  const totalVal = parseFloat(data?.telemetry?.financials?.total?.grossRevenueUsd ?? "0");
  const mrrVal = parseFloat(data?.telemetry?.financials?.monitoringMrr?.grossRevenueUsd ?? "0");
  const projectVal = parseFloat(data?.telemetry?.financials?.projectRevenue?.grossRevenueUsd ?? "0");
  const remediationVal = parseFloat(data?.telemetry?.financials?.remediationRevenue?.grossRevenueUsd ?? "0");
  const offerVal = parseFloat(data?.telemetry?.financials?.offerRevenue?.grossRevenueUsd ?? "0");

  const oneTimeVal = projectVal + remediationVal + offerVal;
  const mrrPct = totalVal > 0 ? (mrrVal / totalVal) * 100 : 0;
  const oneTimePct = totalVal > 0 ? (oneTimeVal / totalVal) * 100 : 0;

  const signalCount = data?.telemetry?.metrics?.activeSignalsCount ?? data?.signalsFiredThisMonth ?? 0;
  const maxSignals = 100;
  const signalPct = Math.min(100, Math.round((signalCount / maxSignals) * 100));

  const acceptanceRate = data?.telemetry?.metrics?.offerAcceptanceRate ?? data?.offerAcceptanceRate ?? 0;
  const openTasks = data?.telemetry?.metrics?.openFulfillmentTasksCount ?? 0;

  const formatUsd = (valStr?: string) => {
    if (!valStr) return "—";
    const val = parseFloat(valStr);
    if (isNaN(val)) return "—";
    return `$${val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Total Gross Revenue Card */}
          <Card className="col-span-1 md:col-span-2 border-primary/20 bg-gradient-to-br from-card to-primary/5 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <div>
                <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Total Gross Revenue</CardTitle>
                <CardDescription className="text-xs mt-1">{periodLabel}</CardDescription>
              </div>
              <DollarSign className="size-5 text-primary" />
            </CardHeader>
            <CardContent className="space-y-4">
              {loading ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-36" />
                  <Skeleton className="h-2.5 w-full" />
                  <Skeleton className="h-4 w-48" />
                </div>
              ) : (
                <>
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-4xl font-extrabold tracking-tight">
                      {hasErrorOrNoMsp ? "—" : formatUsd(data?.telemetry?.financials?.total?.grossRevenueUsd)}
                    </span>
                    <Badge variant="outline" className="text-emerald-400 border-emerald-500/20 bg-emerald-500/10 animate-pulse">
                      {hasErrorOrNoMsp ? "—" : `${data?.telemetry?.financials?.total?.mspMarginPct ?? "0.0%"} Est. Margin`}
                    </Badge>
                  </div>

                  <div className="space-y-2 pt-2">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Full-Catalog Breakdown</span>
                      <span className="font-semibold text-emerald-400">
                        {hasErrorOrNoMsp ? "" : `Profit: ${formatUsd(data?.telemetry?.financials?.total?.mspMarginUsd)}`}
                      </span>
                    </div>
                    
                    <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden flex">
                      {hasErrorOrNoMsp || totalVal === 0 ? (
                        <div className="h-full w-full bg-muted-foreground/10" />
                      ) : (
                        <>
                          <div
                            className="h-full bg-primary transition-all duration-500"
                            style={{ width: `${mrrPct}%` }}
                            title={`MRR: ${mrrPct.toFixed(1)}%`}
                          />
                          <div
                            className="h-full bg-sky-500 transition-all duration-500"
                            style={{ width: `${oneTimePct}%` }}
                            title={`One-Time/Project: ${oneTimePct.toFixed(1)}%`}
                          />
                        </>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-4 text-xs pt-1">
                      <div className="flex items-center gap-1.5">
                        <span className="size-2 bg-primary rounded-full" />
                        <span className="text-muted-foreground">MRR:</span>
                        <span className="font-bold">
                          {hasErrorOrNoMsp ? "—" : formatUsd(data?.telemetry?.financials?.monitoringMrr?.grossRevenueUsd)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="size-2 bg-sky-500 rounded-full" />
                        <span className="text-muted-foreground">One-Time/Project:</span>
                        <span className="font-bold">
                          {hasErrorOrNoMsp ? "—" : `$${oneTimeVal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                        </span>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Signal Volume Gauge Card */}
          <Card className="flex flex-col justify-between">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-sm font-medium">Signal Volume</CardTitle>
              <Activity className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="flex-1 flex flex-col justify-center py-2">
              {loading ? (
                <div className="flex items-center justify-center h-24">
                  <Skeleton className="size-20 rounded-full animate-pulse" />
                </div>
              ) : (
                <div className="relative size-24 mx-auto flex items-center justify-center">
                  <svg viewBox="0 0 96 96" className="w-full h-full transform -rotate-90">
                    <circle
                      cx="48"
                      cy="48"
                      r="36"
                      stroke="currentColor"
                      strokeWidth="6"
                      fill="transparent"
                      className="text-muted-foreground/10"
                    />
                    <circle
                      cx="48"
                      cy="48"
                      r="36"
                      stroke="currentColor"
                      strokeWidth="6"
                      fill="transparent"
                      strokeDasharray={2 * Math.PI * 36}
                      strokeDashoffset={2 * Math.PI * 36 * (1 - signalPct / 100)}
                      className="text-primary transition-all duration-700 ease-out"
                    />
                  </svg>
                  <div className="absolute flex flex-col items-center justify-center text-center">
                    <span className="text-xl font-extrabold tracking-tight">
                      {hasErrorOrNoMsp ? "—" : signalCount}
                    </span>
                    <span className="text-[9px] text-muted-foreground font-semibold uppercase tracking-wider">fired</span>
                  </div>
                </div>
              )}
            </CardContent>
            <CardDescription className="px-6 pb-4 text-xs text-muted-foreground text-center">
              {hasErrorOrNoMsp ? "No activity logged" : `${signalCount} event signals processed this month`}
            </CardDescription>
          </Card>

          {/* Offer Acceptance Rate Card */}
          <Card className="flex flex-col justify-between">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-sm font-medium">Offer Acceptance</CardTitle>
              <PercentCircle className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="pt-2">
              {loading ? (
                <Skeleton className="h-8 w-20 animate-pulse" />
              ) : (
                <div className="text-3xl font-extrabold tracking-tight">
                  {hasErrorOrNoMsp ? "—" : `${acceptanceRate}%`}
                </div>
              )}
              
              <div className="mt-4 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Pipeline Conversion</span>
                {loading ? (
                  <Skeleton className="h-5 w-24" />
                ) : (
                  <Badge className={
                    hasErrorOrNoMsp
                      ? "bg-muted text-muted-foreground border-muted"
                      : acceptanceRate >= 70
                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/15"
                      : acceptanceRate >= 40
                      ? "bg-sky-500/10 text-sky-400 border-sky-500/20 hover:bg-sky-500/15"
                      : "bg-amber-500/10 text-amber-400 border-amber-500/20 hover:bg-amber-500/15"
                  }>
                    {hasErrorOrNoMsp ? "No Data" : acceptanceRate >= 60 ? "High Conversion" : "Optimal"}
                  </Badge>
                )}
              </div>
            </CardContent>
            <CardDescription className="px-6 pb-4 text-xs text-muted-foreground">
              {hasErrorOrNoMsp ? "No offers sent" : "Percentage of generated offers accepted"}
            </CardDescription>
          </Card>

          {/* Active Fulfillment Tasks Card */}
          <Card className="flex flex-col justify-between">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-sm font-medium">Active Fulfillment</CardTitle>
              <ClipboardList className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="pt-2">
              {loading ? (
                <Skeleton className="h-8 w-20 animate-pulse" />
              ) : (
                <div className="text-3xl font-extrabold tracking-tight">
                  {hasErrorOrNoMsp ? "—" : openTasks}
                </div>
              )}

              <div className="mt-4 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Queue Status</span>
                {loading ? (
                  <Skeleton className="h-5 w-24" />
                ) : (
                  <Badge className={
                    hasErrorOrNoMsp || openTasks === 0
                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                      : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                  }>
                    {hasErrorOrNoMsp || openTasks === 0 ? "Complete" : "Attention Needed"}
                  </Badge>
                )}
              </div>
            </CardContent>
            <CardDescription className="px-6 pb-4 text-xs text-muted-foreground">
              {hasErrorOrNoMsp ? "No active queue" : "Tasks pending in fulfillment kanban"}
            </CardDescription>
          </Card>

          {/* License Waste tile */}
          <Link href="/reports">
            <Card className="cursor-pointer hover:border-primary/40 transition-colors group h-full flex flex-col justify-between">
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium">License Waste</CardTitle>
                <TrendingDown className="size-4 text-amber-400" />
              </CardHeader>
              <CardContent className="pt-2">
                {loading || wasteData === null ? (
                  <Skeleton className="h-8 w-20 animate-pulse" />
                ) : (
                  <div className="text-3xl font-extrabold tracking-tight text-amber-400">
                    {wasteData.estimatedAnnualSavingsFormatted}
                  </div>
                )}
                
                <div className="mt-4 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Savings Found</span>
                  <FileBarChart2 className="size-3 text-muted-foreground/50 group-hover:text-primary transition-colors" />
                </div>
              </CardContent>
              <CardDescription className="px-6 pb-4 text-xs text-muted-foreground">
                {wasteData
                  ? `${wasteData.customersWithWaste} of ${wasteData.totalCustomers} customers`
                  : "Identifiable annual savings"}
              </CardDescription>
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

        {/* ── Growth & Engagement Widgets ────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">

          {/* Widget 1: Unaccepted Offers Value */}
          <Link href="/sales-offers">
            <Card className="cursor-pointer hover:border-primary/40 transition-colors group h-full">
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium">Pipeline Value</CardTitle>
                <DollarSign className="size-4 text-emerald-400" />
              </CardHeader>
              <CardContent>
                {loading ? (
                  <Skeleton className="h-8 w-24 mt-1" />
                ) : (data?.unacceptedOffersCount ?? 0) === 0 ? (
                  <div className="text-2xl font-bold text-muted-foreground">—</div>
                ) : (
                  <div className="text-2xl font-bold text-emerald-400">
                    ${((data?.unacceptedOffersCents ?? 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                  </div>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  {(data?.unacceptedOffersCount ?? 0) === 0
                    ? "No open offers"
                    : `${data?.unacceptedOffersCount} offer${data?.unacceptedOffersCount !== 1 ? "s" : ""} awaiting response`}
                </p>
              </CardContent>
            </Card>
          </Link>

          {/* Widget 2: AI Balance Momentum */}
          {(data?.aiPeriodUsagePct != null && data.aiPeriodUsagePct > 0) && (
            <Card className={`h-full ${(data.aiAlertThreshold ?? 0) >= 90 ? "border-amber-500/30 bg-amber-500/5" : "border-primary/20 bg-primary/5"}`}>
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium">AI Usage Momentum</CardTitle>
                <Zap className={`size-4 ${(data.aiAlertThreshold ?? 0) >= 90 ? "text-amber-400" : "text-primary"}`} />
              </CardHeader>
              <CardContent>
                {loading ? (
                  <Skeleton className="h-8 w-16 mt-1" />
                ) : (
                  <>
                    <div className={`text-2xl font-bold ${(data.aiAlertThreshold ?? 0) >= 90 ? "text-amber-400" : "text-primary"}`}>
                      {Math.round(data.aiPeriodUsagePct)}%
                    </div>
                    <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-700 ${(data.aiAlertThreshold ?? 0) >= 90 ? "bg-amber-400" : "bg-primary"}`}
                        style={{ width: `${Math.min(100, data.aiPeriodUsagePct)}%` }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground mt-1.5">
                      {(data.aiAlertThreshold ?? 0) >= 95
                        ? "Near capacity — consider a top-up"
                        : (data.aiAlertThreshold ?? 0) >= 80
                        ? "Strong utilisation this period"
                        : "AI tools actively delivering value"}
                    </p>
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {/* Widget 3: Idle Bundle Nudges */}
          {(data?.idleBundles?.length ?? 0) > 0 && (
            <Card className="border-amber-500/20 bg-amber-500/5 h-full">
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium">Idle Bundles</CardTitle>
                <Package className="size-4 text-amber-400" />
              </CardHeader>
              <CardContent>
                {loading ? (
                  <Skeleton className="h-8 w-16 mt-1" />
                ) : (
                  <>
                    <div className="text-2xl font-bold text-amber-400">
                      {data!.idleBundles.length}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 mb-2">
                      Bundle{data!.idleBundles.length !== 1 ? "s" : ""} with no new assignment in 30+ days
                    </p>
                    <div className="space-y-1">
                      {data!.idleBundles.slice(0, 3).map((b) => (
                        <div key={b.bundleId} className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground truncate mr-2">{b.name}</span>
                          <span className="text-amber-400 shrink-0">{b.daysIdle}d</span>
                        </div>
                      ))}
                    </div>
                    <Link href="/bundles">
                      <p className="text-xs text-primary mt-2 flex items-center gap-1 hover:underline">
                        <TrendingUp className="size-3" />
                        Assign to customers
                      </p>
                    </Link>
                  </>
                )}
              </CardContent>
            </Card>
          )}
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
