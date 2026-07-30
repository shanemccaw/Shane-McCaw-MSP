/**
 * ReadinessLogisticsModule.tsx
 *
 * Renders results for the `readiness_logistics` Results Template family
 * (Migration Readiness, Conditional Access, License Waste Audit, License &
 * Cost Optimization — results_templates.family, #162, parent #161). Per
 * #161's architecture doc, these products are deliberately "not pillar-
 * scored... shows decision-relevant data directly (mailbox sizes, CA policy
 * tiers, license SKU waste)" — so unlike PillarModuleShell.tsx's modules,
 * this does not lead with a composite score/percentage.
 *
 * Data source: same `results.pillars` / `results.summary` payload every
 * other module reads. There is no dedicated decision-field data source yet
 * (results_templates.config is seeded empty for all 4 readiness_logistics
 * products — see the #162 migration's seed block) — concrete fields like
 * "mailbox size" or "CA policy tier" aren't in real data anywhere yet, so
 * this deliberately renders the real findings/recommendations text as a
 * flat decision-item list rather than fabricating structured columns that
 * don't exist. Wiring real per-field decision data is unscoped follow-up
 * (flagged in #163's completion comment), not solved here.
 *
 * Free-tier redaction: same known gap as FrameworkGapListModule.tsx — #163's
 * brief explicitly scopes redaction for this family out ("do not attempt to
 * solve it here"). Renders findings/recommendations arrays as-is.
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Route, CheckCircle2, ArrowRight, ListTodo } from "lucide-react";
import type { AssessmentModuleProps, PillarResult } from "./module-registry";
import { PillarPendingState } from "./PillarModuleShell";

interface DecisionItem {
  signal: string;
  action: string | null;
}

function buildDecisionItems(
  pillars: NonNullable<AssessmentModuleProps["results"]>["pillars"],
): DecisionItem[] {
  if (!pillars) return [];
  const out: DecisionItem[] = [];
  for (const val of Object.values(pillars)) {
    const p = val as PillarResult | undefined;
    if (!p || p.status !== "complete") continue;
    const findings = p.findings ?? [];
    const recommendations = p.recommendations ?? [];
    const max = Math.max(findings.length, recommendations.length);
    for (let i = 0; i < max; i++) {
      const signal = findings[i];
      const action = recommendations[i] ?? null;
      if (signal) out.push({ signal, action });
    }
    // Any recommendations left over with no paired finding still surface as
    // decision items — the action itself is decision-relevant on its own.
    if (recommendations.length > findings.length) {
      for (let i = findings.length; i < recommendations.length; i++) {
        out.push({ signal: recommendations[i], action: null });
      }
    }
  }
  return out;
}

export default function ReadinessLogisticsModule({ results, loading }: AssessmentModuleProps) {
  const runStatus = results?.status ?? null;
  const items = buildDecisionItems(results?.pillars ?? null);
  const priorityItems = results?.summary?.priorityItems ?? [];

  return (
    <Card className="border-border/50 md:col-span-2">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Route className="size-4 text-primary" />
          <CardTitle className="text-base font-semibold">Readiness & Decision Data</CardTitle>
          {items.length > 0 && (
            <Badge variant="secondary" className="ml-auto text-xs">
              {items.length} item{items.length === 1 ? "" : "s"}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-full rounded-md" />
            ))}
          </div>
        ) : !results || runStatus === "pending" || runStatus === "running" ? (
          <PillarPendingState status={runStatus ?? "pending"} label="Readiness & Decision Data" />
        ) : items.length === 0 && priorityItems.length === 0 ? (
          <div className="flex flex-col items-center py-10 gap-2 text-center">
            <ListTodo className="size-7 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">
              {runStatus === "complete"
                ? "No decision-relevant items recorded for this assessment run."
                : "Readiness data will appear here once the assessment is complete."}
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {priorityItems.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Top Priorities
                </p>
                <ul className="space-y-1.5">
                  {priorityItems.map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <ArrowRight className="size-3.5 mt-0.5 shrink-0 text-primary" />
                      <span className="text-foreground/80">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {items.length > 0 && (
              <div>
                {priorityItems.length > 0 && (
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                    All Decision Data
                  </p>
                )}
                <ul className="space-y-1.5">
                  {items.map((item, i) => (
                    <li
                      key={i}
                      className={`flex flex-col gap-1 px-3 py-2.5 rounded-md text-sm border ${
                        i % 2 === 0 ? "bg-muted/40 border-border/40" : "bg-transparent border-border/30"
                      }`}
                    >
                      <span className="text-foreground/80">{item.signal}</span>
                      {item.action && (
                        <span className="flex items-center gap-1.5 text-xs text-primary/90">
                          <ArrowRight className="size-3 shrink-0" />
                          {item.action}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {items.length === 0 && priorityItems.length > 0 && (
              <div className="flex items-center gap-2 justify-center text-sm text-green-400">
                <CheckCircle2 className="size-4" />
                <span>No additional decision items identified.</span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
