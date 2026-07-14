/**
 * PillarModuleShell.tsx
 *
 * Shared inner shell for all pillar-scoped modules (Governance, Security,
 * Compliance, Copilot, Architecture, Cost). Handles the loading skeleton,
 * pending/not_applicable/failed states, and score bar — so individual pillar
 * modules only need to supply their pillar-specific content slot.
 */

import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle2, Clock, Info, MinusCircle } from "lucide-react";
import type { PillarResult, AssessmentRunStatus } from "./module-registry";

// ── Shared severity colour helper ─────────────────────────────────────────────
// Used by all pillar modules that render findings/recommendations lists.
export function findingBg(index: number): string {
  // Alternate subtle row tints; no meaning attached to colour — purely aesthetic.
  return index % 2 === 0
    ? "bg-muted/40 border-border/40"
    : "bg-transparent border-border/30";
}

// ── Score bar ─────────────────────────────────────────────────────────────────

function ScoreBar({ score }: { score: number }) {
  const pct = Math.min(100, Math.max(0, score));
  const color =
    pct >= 75
      ? "bg-green-500"
      : pct >= 50
      ? "bg-amber-500"
      : pct >= 25
      ? "bg-orange-500"
      : "bg-red-500";
  const textColor =
    pct >= 75
      ? "text-green-400"
      : pct >= 50
      ? "text-amber-400"
      : pct >= 25
      ? "text-orange-400"
      : "text-red-400";

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground font-medium">Score</span>
        <span className={`font-bold ${textColor}`}>{Math.round(pct)}/100</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: AssessmentRunStatus | string }) {
  const map: Record<string, { label: string; icon: React.ElementType; color: string }> = {
    complete:       { label: "Complete",       icon: CheckCircle2, color: "text-green-400" },
    pending:        { label: "Pending",        icon: Clock,        color: "text-amber-400" },
    running:        { label: "Running",        icon: Clock,        color: "text-blue-400"  },
    failed:         { label: "Failed",         icon: AlertCircle,  color: "text-red-400"   },
    not_applicable: { label: "Not applicable", icon: MinusCircle,  color: "text-muted-foreground" },
  };
  const cfg = map[status] ?? { label: status, icon: Info, color: "text-muted-foreground" };
  const Icon = cfg.icon;
  return (
    <Badge
      variant="outline"
      className={`gap-1 text-[10px] px-1.5 py-0 h-4 border-current/20 ${cfg.color}`}
    >
      <Icon className="size-2.5" />
      {cfg.label}
    </Badge>
  );
}

// ── Pending / not-applicable / failed placeholder ─────────────────────────────

export function PillarPendingState({ status, label }: { status: string; label: string }) {
  const isNA = status === "not_applicable";
  const Icon = isNA ? MinusCircle : Clock;
  const message = isNA
    ? "This pillar is not applicable for this assessment type."
    : status === "failed"
    ? "Analysis failed for this pillar. Please contact your service provider."
    : "Analysis is pending. Results will appear here once the assessment run is complete.";

  return (
    <div className="flex flex-col items-center justify-center py-10 text-center gap-2">
      <Icon className="size-7 text-muted-foreground/40" />
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <p className="text-xs text-muted-foreground/60 max-w-xs">{message}</p>
    </div>
  );
}

// ── Shared loading skeleton ───────────────────────────────────────────────────

export function PillarSkeleton() {
  return (
    <div className="space-y-3 p-5">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-2 w-full rounded-full" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-4/5" />
      <Skeleton className="h-3 w-3/5" />
    </div>
  );
}

// ── Main shell ────────────────────────────────────────────────────────────────

interface PillarModuleShellProps {
  label: string;
  pillarKey: keyof NonNullable<import("./module-registry").AssessmentResultsPayload["pillars"]>;
  loading: boolean;
  runStatus: AssessmentRunStatus | null;
  pillar: PillarResult | null | undefined;
  children: (pillar: PillarResult) => React.ReactNode;
}

export function PillarModuleShell({
  label,
  pillarKey: _pillarKey,
  loading,
  runStatus,
  pillar,
  children,
}: PillarModuleShellProps) {
  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base font-semibold">{label}</CardTitle>
          {!loading && runStatus && <StatusBadge status={runStatus} />}
        </div>
      </CardHeader>

      <CardContent>
        {loading ? (
          <PillarSkeleton />
        ) : !pillar || pillar.status === "pending" || pillar.status === "not_applicable" ? (
          <PillarPendingState
            status={pillar?.status ?? "pending"}
            label={label}
          />
        ) : (
          <div className="space-y-4">
            {pillar.score !== null && <ScoreBar score={pillar.score} />}
            {children(pillar)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
