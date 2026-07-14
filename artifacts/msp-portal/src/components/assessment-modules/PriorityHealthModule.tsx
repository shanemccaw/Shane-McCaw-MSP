/**
 * PriorityHealthModule.tsx
 *
 * Universal module — composite health score and highest-priority action items.
 * Reads from results.summary (not a specific pillar).
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, CheckCircle2, Clock, Gauge } from "lucide-react";
import type { AssessmentModuleProps } from "./module-registry";
import { PillarPendingState } from "./PillarModuleShell";

function CompositeScoreRing({ score }: { score: number }) {
  const pct = Math.min(100, Math.max(0, score));
  const color =
    pct >= 75 ? "text-green-400" : pct >= 50 ? "text-amber-400" : pct >= 25 ? "text-orange-400" : "text-red-400";
  const trackColor =
    pct >= 75 ? "stroke-green-500" : pct >= 50 ? "stroke-amber-500" : pct >= 25 ? "stroke-orange-500" : "stroke-red-500";
  const r = 36;
  const circumference = 2 * Math.PI * r;
  const dashoffset = circumference * (1 - pct / 100);

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="100" height="100" viewBox="0 0 100 100" className="-rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" strokeWidth="8" className="stroke-muted" />
        <circle
          cx="50" cy="50" r={r} fill="none" strokeWidth="8"
          strokeDasharray={circumference}
          strokeDashoffset={dashoffset}
          strokeLinecap="round"
          className={`${trackColor} transition-all duration-700`}
        />
      </svg>
      <div className="absolute flex flex-col items-center" style={{ marginTop: "-68px" }}>
        <span className={`text-2xl font-bold tabular-nums ${color}`}>{Math.round(pct)}</span>
        <span className="text-[10px] text-muted-foreground">/100</span>
      </div>
    </div>
  );
}

export default function PriorityHealthModule({ results, loading }: AssessmentModuleProps) {
  const runStatus = results?.status ?? null;
  const summary = results?.summary ?? null;

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Gauge className="size-4 text-primary" />
          <CardTitle className="text-base font-semibold">Priority & Health Score</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-24 rounded-full mx-auto" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        ) : !summary || runStatus === "pending" || runStatus === "running" ? (
          <PillarPendingState
            status={runStatus ?? "pending"}
            label="Priority & Health Score"
          />
        ) : (
          <div className="space-y-5">
            {/* Score ring */}
            <div className="flex justify-center relative">
              {summary.compositeScore !== null ? (
                <CompositeScoreRing score={summary.compositeScore} />
              ) : (
                <div className="flex flex-col items-center gap-1 py-4">
                  <Gauge className="size-8 text-muted-foreground/40" />
                  <span className="text-sm text-muted-foreground">Score not yet available</span>
                </div>
              )}
            </div>

            {/* Priority items */}
            {summary.priorityItems.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Highest Priority Items
                </p>
                <ul className="space-y-1.5">
                  {summary.priorityItems.map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <AlertTriangle className="size-3.5 mt-0.5 shrink-0 text-amber-400" />
                      <span className="text-foreground/80">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {summary.priorityItems.length === 0 && (
              <div className="flex items-center gap-2 justify-center text-sm text-green-400">
                <CheckCircle2 className="size-4" />
                <span>No high-priority items identified.</span>
              </div>
            )}

            {/* Generated at */}
            {results?.generatedAt && (
              <p className="text-[10px] text-muted-foreground/50 flex items-center gap-1 justify-end">
                <Clock className="size-2.5" />
                Generated {new Date(results.generatedAt).toLocaleDateString("en-US", {
                  month: "short", day: "numeric", year: "numeric",
                })}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
