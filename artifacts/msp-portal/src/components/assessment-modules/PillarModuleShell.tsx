/**
 * PillarModuleShell.tsx
 *
 * Shared inner shell for all pillar-scoped modules (Governance, Security,
 * Compliance, Copilot, Architecture, Cost). Handles the loading skeleton,
 * pending/not_applicable/failed states, and score bar — so individual pillar
 * modules only need to supply their pillar-specific content slot.
 */

import { useLocation } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertCircle, CheckCircle2, Clock, Info, Lock, MinusCircle } from "lucide-react";
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

// ── Free-tier locked-content detection ─────────────────────────────────────────
// Server-side redaction (#164, Phase 3 of #161) replaces a pillar's `findings`/
// `recommendations` string arrays with `findingsCount`/`recommendationsCount`
// integers when the customer has no paid/free_activated assessment SOW
// (portal-customer-engines.ts's `GET /api/portal/dashboard`). PillarResult's
// declared type still says `findings: string[]` — module-registry.ts's own
// comment says to keep these flexible since the backend shape "may shift" — so
// this checks the actual runtime shape rather than trusting the static type.

interface LockedPillarCounts {
  findingsCount: number;
  recommendationsCount: number;
}

function getLockedCounts(pillar: PillarResult): LockedPillarCounts | null {
  const raw = pillar as unknown as Record<string, unknown>;
  if (Array.isArray(raw["findings"])) return null;
  const findingsCount = raw["findingsCount"];
  const recommendationsCount = raw["recommendationsCount"];
  if (typeof findingsCount !== "number" && typeof recommendationsCount !== "number") return null;
  return {
    findingsCount: typeof findingsCount === "number" ? findingsCount : 0,
    recommendationsCount: typeof recommendationsCount === "number" ? recommendationsCount : 0,
  };
}

// ── Locked block ──────────────────────────────────────────────────────────────
// Contextual per-pillar upgrade CTA — deliberately not a page-level banner.
// Score is unaffected (rendered by the shell above this), only the findings/
// recommendations detail is gated. CTA goes to /assessment, which resolves the
// customer's active SOW server-side and drives them to its "payment" step
// (AssessmentWizard -> AssessmentPaymentPlan) — the real, existing checkout
// entry point for unlocking assessment results; there is no per-pillar or
// per-service checkout, since the redaction gate itself is customer-wide
// ("has this customer paid/activated ANY assessment SOW"), not per-document.

export function PillarLockedState({ label, counts }: { label: string; counts: LockedPillarCounts }) {
  const [, navigate] = useLocation();
  const parts: string[] = [];
  if (counts.findingsCount > 0) {
    parts.push(`${counts.findingsCount} finding${counts.findingsCount === 1 ? "" : "s"}`);
  }
  if (counts.recommendationsCount > 0) {
    parts.push(`${counts.recommendationsCount} recommendation${counts.recommendationsCount === 1 ? "" : "s"}`);
  }

  return (
    <div className="flex flex-col items-center text-center gap-3 py-6 px-4 rounded-lg border border-dashed border-border/60 bg-muted/20">
      <Lock className="size-6 text-muted-foreground/50" />
      <p className="text-sm font-medium text-foreground">
        {parts.length > 0
          ? `${parts.join(" and ")} identified in ${label} — locked`
          : `${label} results are locked`}
      </p>
      <p className="text-xs text-muted-foreground max-w-xs">
        Unlock your full assessment to see the detailed {label.toLowerCase()} findings and
        recommended next steps.
      </p>
      <Button size="sm" className="mt-1" onClick={() => navigate("/assessment")}>
        Unlock full {label} results
      </Button>
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
            {(() => {
              const lockedCounts = getLockedCounts(pillar);
              return lockedCounts
                ? <PillarLockedState label={label} counts={lockedCounts} />
                : children(pillar);
            })()}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
