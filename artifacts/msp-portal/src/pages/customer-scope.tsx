/**
 * customer-scope.tsx
 *
 * Customer-facing Scope Status page.
 *
 * Displays a plain-language view of the customer's project scope health:
 * deliverable changes, scope additions, and timeline status — sourced from
 * the Scope Creep Engine via the customer API.
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
  Calendar,
  CheckCircle2,
  Clock,
  FilePen,
  FolderSync,
  RefreshCw,
  Layers,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type OverallStatus = "on_track" | "attention_needed" | "action_required";
type ItemStatus = "ok" | "notice" | "alert";

interface ScopeArea {
  key: string;
  label: string;
  status: ItemStatus;
  message: string;
}

interface ScopeStatus {
  overall: OverallStatus;
  headline: string;
  subtext: string;
  openItems: number;
  areas: ScopeArea[];
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

const OVERALL_CONFIG: Record<
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
    label: "On Scope",
  },
  attention_needed: {
    icon: AlertTriangle,
    badgeClass: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    bannerClass: "border-amber-500/30 bg-amber-500/8",
    iconClass: "text-amber-400",
    label: "Under Review",
  },
  action_required: {
    icon: AlertCircle,
    badgeClass: "bg-red-500/15 text-red-400 border-red-500/30",
    bannerClass: "border-red-500/30 bg-red-500/8",
    iconClass: "text-red-400",
    label: "Review Required",
  },
};

const ITEM_CONFIG: Record<
  ItemStatus,
  { icon: React.ElementType; iconClass: string; rowClass: string; dotClass: string }
> = {
  ok: {
    icon: CheckCircle2,
    iconClass: "text-emerald-400",
    rowClass: "border-border",
    dotClass: "bg-emerald-400",
  },
  notice: {
    icon: AlertTriangle,
    iconClass: "text-amber-400",
    rowClass: "border-amber-500/30",
    dotClass: "bg-amber-400",
  },
  alert: {
    icon: AlertCircle,
    iconClass: "text-red-400",
    rowClass: "border-red-500/30",
    dotClass: "bg-red-400",
  },
};

const AREA_ICONS: Record<string, React.ElementType> = {
  deliverables: FilePen,
  scope: Layers,
  timeline: Calendar,
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function CustomerScopePage() {
  const { fetchWithAuth } = useAuth();
  const [data, setData] = useState<ScopeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      else setRefreshing(true);
      setError(null);
      try {
        const res = await fetchWithAuth("/api/portal/customer/scope-status");
        if (!res.ok) {
          const body = (await res.json()) as { error?: string };
          throw new Error(body.error ?? "Failed to load status");
        }
        const json = (await res.json()) as ScopeStatus;
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

  const cfg = data ? OVERALL_CONFIG[data.overall] : null;
  const Icon = cfg?.icon ?? FolderSync;

  return (
    <AppShell title="Project Scope">
      <div className="p-6 space-y-6 max-w-3xl mx-auto">
        {/* Page header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Project Scope</h2>
            <p className="text-muted-foreground text-sm mt-1">
              How your project is tracking against the agreed plan
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
            <div className="space-y-3">
              <Skeleton className="h-20 rounded-xl" />
              <Skeleton className="h-20 rounded-xl" />
              <Skeleton className="h-20 rounded-xl" />
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
                <div
                  className={`size-10 rounded-full flex items-center justify-center shrink-0 ${cfg.bannerClass} border`}
                >
                  <Icon className={`size-5 ${cfg.iconClass}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <h3 className="text-base font-semibold">{data.headline}</h3>
                    <Badge
                      className={`text-[10px] px-1.5 py-0 h-4 border ${cfg.badgeClass}`}
                    >
                      {cfg.label}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {data.subtext}
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Per-area breakdown */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Area Breakdown</h3>
              {data.areas.map((area) => {
                const itemCfg = ITEM_CONFIG[area.status];
                const ItemIcon = itemCfg.icon;
                const AreaIcon = AREA_ICONS[area.key] ?? Layers;
                return (
                  <Card key={area.key} className={`border ${itemCfg.rowClass}`}>
                    <CardContent className="flex items-start gap-4 py-4 px-5">
                      <div className="size-8 rounded-lg bg-muted/50 flex items-center justify-center shrink-0 mt-0.5">
                        <AreaIcon className="size-4 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <p className="text-sm font-medium">{area.label}</p>
                          <div className="flex items-center gap-1">
                            <span
                              className={`size-1.5 rounded-full ${itemCfg.dotClass}`}
                            />
                            <ItemIcon className={`size-3 ${itemCfg.iconClass}`} />
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          {area.message}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Open items callout — only when relevant */}
            {data.openItems > 0 && (
              <div
                className={`flex items-start gap-2 rounded-lg border px-4 py-3 ${
                  data.overall === "action_required"
                    ? "border-red-500/30 bg-red-500/8"
                    : "border-amber-500/30 bg-amber-500/8"
                }`}
              >
                {data.overall === "action_required" ? (
                  <AlertCircle className="size-4 text-red-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="size-4 text-amber-400 shrink-0 mt-0.5" />
                )}
                <p
                  className={`text-sm ${
                    data.overall === "action_required"
                      ? "text-red-300"
                      : "text-amber-300"
                  }`}
                >
                  <span className="font-semibold">{data.openItems}</span> scope{" "}
                  {data.openItems === 1 ? "item requires" : "items require"} attention.
                  Your service manager will be in touch to discuss next steps.
                </p>
              </div>
            )}

            {/* All-clear state */}
            {data.overall === "on_track" && (
              <Card className="border-dashed bg-muted/10">
                <CardContent className="flex flex-col items-center justify-center py-10 text-center gap-2">
                  <CheckCircle2 className="size-8 text-emerald-400/60" />
                  <p className="text-sm text-muted-foreground">
                    Everything is on track. No scope changes detected.
                  </p>
                  <p className="text-xs text-muted-foreground/60">
                    This page refreshes automatically.
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Explainer */}
            <Card className="bg-muted/10 border-dashed">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">What does this mean?</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground space-y-1.5 pb-5">
                <p>
                  <span className="text-foreground font-medium">Scope tracking</span>{" "}
                  monitors whether the project is staying within the boundaries agreed
                  in your Statement of Work. We look at three things:
                </p>
                <ul className="list-disc list-inside space-y-1 pl-1">
                  <li>
                    <span className="text-foreground">Deliverable changes</span> —
                    additions or alterations to the originally agreed outcomes.
                  </li>
                  <li>
                    <span className="text-foreground">Scope additions</span> — new
                    work requested beyond what was originally agreed.
                  </li>
                  <li>
                    <span className="text-foreground">Timeline</span> — whether key
                    milestones are being reached on schedule.
                  </li>
                </ul>
                <p>
                  If anything changes, your service manager will reach out before
                  proceeding — nothing happens without your agreement.
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppShell>
  );
}
