/**
 * FindingsModule.tsx
 *
 * Universal module — aggregates findings and recommendations across ALL pillars
 * into one flat, sorted list. Pillar label is shown as a tag on each item.
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ListChecks } from "lucide-react";
import type { AssessmentModuleProps, PillarResult } from "./module-registry";
import { PillarPendingState } from "./PillarModuleShell";

const PILLAR_LABELS: Record<string, string> = {
  governance:    "Governance",
  security:      "Security",
  compliance:    "Compliance",
  adoption:      "Adoption",
  copilot:       "Copilot",
  architecture:  "Architecture",
  costLicensing: "Cost & Licensing",
};

const PILLAR_COLORS: Record<string, string> = {
  governance:    "border-purple-500/30 text-purple-400",
  security:      "border-red-500/30 text-red-400",
  compliance:    "border-amber-500/30 text-amber-400",
  adoption:      "border-sky-500/30 text-sky-400",
  copilot:       "border-primary/30 text-primary",
  architecture:  "border-blue-500/30 text-blue-400",
  costLicensing: "border-green-500/30 text-green-400",
};

interface FlatFinding {
  pillar: string;
  text: string;
  type: "finding" | "recommendation";
}

function flattenPillars(
  pillars: NonNullable<AssessmentModuleProps["results"]>["pillars"],
): FlatFinding[] {
  if (!pillars) return [];
  const out: FlatFinding[] = [];
  for (const [key, val] of Object.entries(pillars)) {
    const p = val as PillarResult | undefined;
    if (!p || p.status !== "complete") continue;
    for (const f of p.findings ?? []) out.push({ pillar: key, text: f, type: "finding" });
    for (const r of p.recommendations ?? []) out.push({ pillar: key, text: r, type: "recommendation" });
  }
  return out;
}

export default function FindingsModule({ results, loading }: AssessmentModuleProps) {
  const runStatus = results?.status ?? null;
  const flat = flattenPillars(results?.pillars ?? null);

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <ListChecks className="size-4 text-primary" />
          <CardTitle className="text-base font-semibold">Findings & Recommendations</CardTitle>
          {flat.length > 0 && (
            <Badge variant="secondary" className="ml-auto text-xs">{flat.length}</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full rounded-md" />
            ))}
          </div>
        ) : !results || runStatus === "pending" || runStatus === "running" ? (
          <PillarPendingState status={runStatus ?? "pending"} label="Findings & Recommendations" />
        ) : flat.length === 0 ? (
          <div className="flex flex-col items-center py-8 gap-2 text-center">
            <ListChecks className="size-7 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">
              {runStatus === "complete"
                ? "No findings recorded for this assessment run."
                : "Results will appear here once the assessment is complete."}
            </p>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {flat.map((item, i) => (
              <li
                key={i}
                className={`flex items-start gap-2.5 px-3 py-2 rounded-md text-sm border ${
                  i % 2 === 0 ? "bg-muted/40 border-border/40" : "bg-transparent border-border/30"
                }`}
              >
                <Badge
                  variant="outline"
                  className={`shrink-0 text-[9px] px-1.5 py-0 h-4 mt-0.5 border ${PILLAR_COLORS[item.pillar] ?? "text-muted-foreground border-border"}`}
                >
                  {PILLAR_LABELS[item.pillar] ?? item.pillar}
                </Badge>
                <span className="text-foreground/80">{item.text}</span>
                {item.type === "recommendation" && (
                  <Badge variant="outline" className="shrink-0 text-[9px] px-1.5 py-0 h-4 mt-0.5 ml-auto text-primary border-primary/30">
                    Action
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
