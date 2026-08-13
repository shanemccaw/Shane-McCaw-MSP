/**
 * customer-sla.tsx
 *
 * Customer-facing SLA compliance page.
 *
 * Displays a plain-language view of the customer's service-level agreement
 * compliance status, sourced from the SLA Engine via the customer API.
 * No raw scores, rule keys, or internal operator details are shown.
 *
 * Refreshes automatically every 30 seconds.
 */

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
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
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  RefreshCw,
  ShieldCheck,
  Timer,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type OverallStatus = "on_track" | "attention_needed" | "action_required";
type PerformanceStatus = "well_within" | "approaching_limit" | "overdue";

interface SlaStatus {
  overall: OverallStatus;
  headline: string;
  subtext: string;
  complianceLabel: string;
  activeWarnings: number;
  activeIssues: number;
  openRequests: number;
  responsePerformance: PerformanceStatus;
  responsePerformanceLabel: string;
  updatedAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

const STATUS_CONFIG: Record<
  OverallStatus,
  {
    icon: React.ElementType;
    badgeClass: string;
    bannerClass: string;
    iconClass: string;
    label: string;
  }
> = {
  on_track: {
    icon: CheckCircle2,
    badgeClass: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    bannerClass: "border-emerald-500/30 bg-emerald-500/8",
    iconClass: "text-emerald-400",
    label: "On Track",
  },
  attention_needed: {
    icon: AlertTriangle,
    badgeClass: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    bannerClass: "border-amber-500/30 bg-amber-500/8",
    iconClass: "text-amber-400",
    label: "Attention Needed",
  },
  action_required: {
    icon: AlertCircle,
    badgeClass: "bg-red-500/15 text-red-400 border-red-500/30",
    bannerClass: "border-red-500/30 bg-red-500/8",
    iconClass: "text-red-400",
    label: "Action Required",
  },
};

const PERFORMANCE_CONFIG: Record<
  PerformanceStatus,
  { dotClass: string; textClass: string }
> = {
  well_within: { dotClass: "bg-emerald-400", textClass: "text-emerald-400" },
  approaching_limit: { dotClass: "bg-amber-400", textClass: "text-amber-400" },
  overdue: { dotClass: "bg-red-400", textClass: "text-red-400" },
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function CustomerSlaPage() {
  const { fetchWithAuth } = useAuth();
  const [data, setData] = useState<SlaStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      else setRefreshing(true);
      setError(null);
      try {
        const res = await fetchWithAuth("/api/portal/customer/sla-status");
        if (!res.ok) {
          const body = (await res.json()) as { error?: string };
          throw new Error(body.error ?? "Failed to load status");
        }
        const json = (await res.json()) as SlaStatus;
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load status");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    void load();
    const interval = setInterval(() => void load(true), 30_000);
    return () => clearInterval(interval);
  }, [load]);

  const cfg = data ? STATUS_CONFIG[data.overall] : null;
  const perfCfg = data ? PERFORMANCE_CONFIG[data.responsePerformance] : null;
  const Icon = cfg?.icon ?? ShieldCheck;

  return (
    <AppShell title="Service Levels">
      <div className="p-6 space-y-6 max-w-3xl mx-auto">
        {/* Page header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Service Levels</h2>
            <p className="text-muted-foreground text-sm mt-1">
              How your requests are being handled
            </p>
          </div>
          {data && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {refreshing ? (
                <RefreshCw className="size-3 animate-spin" />
              ) : (
                <Clock className="size-3" />
              )}
              Updated {relativeTime(data.updatedAt)}
            </div>
          )}
        </div>

        {/* Loading state */}
        {loading && (
          <div className="space-y-4">
            <Skeleton className="h-28 w-full rounded-xl" />
            <div className="grid grid-cols-3 gap-4">
              <Skeleton className="h-24 rounded-xl" />
              <Skeleton className="h-24 rounded-xl" />
              <Skeleton className="h-24 rounded-xl" />
            </div>
          </div>
        )}

        {/* Error state */}
        {!loading && error && (
          <Card className="border-red-500/30 bg-red-500/8">
            <CardContent className="flex items-start gap-3 py-5">
              <AlertCircle className="size-5 text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-300">Unable to load status</p>
                <p className="text-xs text-muted-foreground mt-1">{error}</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Main status banner */}
        {!loading && data && cfg && (
          <>
            <Card className={`border ${cfg.bannerClass}`}>
              <CardContent className="flex items-start gap-4 py-6">
                <div className={`size-10 rounded-full flex items-center justify-center shrink-0 ${cfg.bannerClass} border ${cfg.badgeClass.split(" ").find(c => c.startsWith("border-"))}`}>
                  <Icon className={`size-5 ${cfg.iconClass}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <h3 className="text-base font-semibold">{data.headline}</h3>
                    <Badge className={`text-[10px] px-1.5 py-0 h-4 border ${cfg.badgeClass}`}>
                      {cfg.label}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {data.subtext}
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Metric cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Compliance */}
              <Card>
                <CardHeader className="pb-2 pt-5 px-5">
                  <CardDescription className="flex items-center gap-1.5 text-xs">
                    <ShieldCheck className="size-3.5" />
                    Compliance
                  </CardDescription>
                </CardHeader>
                <CardContent className="px-5 pb-5">
                  <p className="text-sm font-semibold leading-snug">
                    {data.complianceLabel}
                  </p>
                </CardContent>
              </Card>

              {/* Open requests */}
              <Card>
                <CardHeader className="pb-2 pt-5 px-5">
                  <CardDescription className="flex items-center gap-1.5 text-xs">
                    <Timer className="size-3.5" />
                    Open Requests
                  </CardDescription>
                </CardHeader>
                <CardContent className="px-5 pb-5">
                  <p className="text-2xl font-bold tabular-nums">
                    {data.openRequests}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    currently in progress
                  </p>
                </CardContent>
              </Card>

              {/* Response performance */}
              <Card>
                <CardHeader className="pb-2 pt-5 px-5">
                  <CardDescription className="flex items-center gap-1.5 text-xs">
                    <Clock className="size-3.5" />
                    Response Times
                  </CardDescription>
                </CardHeader>
                <CardContent className="px-5 pb-5">
                  {perfCfg && (
                    <div className="flex items-center gap-2">
                      <span
                        className={`size-2 rounded-full shrink-0 ${perfCfg.dotClass}`}
                      />
                      <p className={`text-sm font-medium ${perfCfg.textClass}`}>
                        {data.responsePerformanceLabel}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Warnings / issues callout — only shown when relevant */}
            {(data.activeWarnings > 0 || data.activeIssues > 0) && (
              <div className="space-y-2">
                {data.activeIssues > 0 && (
                  <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/8 px-4 py-3">
                    <AlertCircle className="size-4 text-red-400 shrink-0 mt-0.5" />
                    <p className="text-sm text-red-300">
                      <span className="font-semibold">{data.activeIssues}</span>{" "}
                      request{data.activeIssues === 1 ? " has" : "s have"} exceeded the
                      response time target. Our team is actively working on{" "}
                      {data.activeIssues === 1 ? "it" : "them"}.
                    </p>
                  </div>
                )}
                {data.activeWarnings > 0 && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/8 px-4 py-3">
                    <AlertTriangle className="size-4 text-amber-400 shrink-0 mt-0.5" />
                    <p className="text-sm text-amber-300">
                      <span className="font-semibold">{data.activeWarnings}</span>{" "}
                      request{data.activeWarnings === 1 ? " is" : "s are"} approaching
                      the response limit. Our team is prioritising{" "}
                      {data.activeWarnings === 1 ? "it" : "them"}.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* All-clear message */}
            {data.overall === "on_track" && data.openRequests === 0 && (
              <Card className="border-dashed bg-muted/10">
                <CardContent className="flex flex-col items-center justify-center py-10 text-center gap-2">
                  <CheckCircle2 className="size-8 text-emerald-400/60" />
                  <p className="text-sm text-muted-foreground">
                    All clear — no open requests at the moment.
                  </p>
                  <p className="text-xs text-muted-foreground/60">
                    This page refreshes automatically.
                  </p>
                </CardContent>
              </Card>
            )}

            {/* What this means section */}
            <Card className="bg-muted/10 border-dashed">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">What does this mean?</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground space-y-1.5 pb-5">
                <p>
                  <span className="text-foreground font-medium">Service levels</span>{" "}
                  measure how quickly your support requests are responded to and
                  resolved. Your agreement defines target times for each priority level.
                </p>
                <p>
                  We track every open request in real time and alert our team before
                  any target is missed. This page reflects the live picture — not
                  historical averages.
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppShell>
  );
}
