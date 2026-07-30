/**
 * FrameworkGapListModule.tsx
 *
 * Renders results for the `framework_gap_list` Results Template family
 * (SOC 2 / NIST CSF / ISO 27001 / CMMC — results_templates.family, #162,
 * parent #161). These products audit against a named compliance framework's
 * own control taxonomy, not the platform's 7-pillar health score, so this
 * renders a flat control-by-control gap list instead of the pillar
 * score-bar layout PillarModuleShell.tsx's modules use.
 *
 * Data source: the same `results.pillars` payload every pillar module reads
 * (module-registry.ts's AssessmentResultsPayload) — there is no dedicated
 * framework-control-catalogue data source yet. results_templates.config is
 * seeded empty ('{}') for all 4 framework_gap_list products (see the #162
 * migration's seed block), so this deliberately does not attempt to render
 * framework-native control IDs (e.g. SOC 2 "CC6.1") — doing so would mean
 * fabricating a control mapping that doesn't exist in real data. Each
 * present pillar's findings/recommendations become one gap-list section
 * instead, honestly labelled by the platform's own pillar name. Wiring a
 * true per-framework control catalogue is unscoped follow-up (flagged in
 * #163's completion comment), not solved here.
 *
 * Free-tier redaction: PillarModuleShell.tsx's redaction check (getLockedCounts)
 * is a private, unexported helper, and #163's brief explicitly scopes
 * redaction for this family out ("note as unscoped follow-up, do not attempt
 * to solve it here") — this module renders findings/recommendations arrays
 * as-is, unredacted, matching that instruction.
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, CheckCircle2, AlertTriangle, ClipboardList } from "lucide-react";
import type { AssessmentModuleProps, PillarResult } from "./module-registry";
import { PillarPendingState } from "./PillarModuleShell";

const DOMAIN_LABELS: Record<string, string> = {
  governance: "Governance",
  security: "Security",
  compliance: "Compliance",
  adoption: "Adoption",
  copilot: "Copilot",
  architecture: "Architecture",
  costLicensing: "Cost & Licensing",
};

interface DomainSection {
  key: string;
  label: string;
  hasGaps: boolean;
  findings: string[];
  recommendations: string[];
}

function buildDomainSections(
  pillars: NonNullable<AssessmentModuleProps["results"]>["pillars"],
): DomainSection[] {
  if (!pillars) return [];
  const out: DomainSection[] = [];
  for (const [key, val] of Object.entries(pillars)) {
    const p = val as PillarResult | undefined;
    if (!p || p.status !== "complete") continue;
    const findings = p.findings ?? [];
    const recommendations = p.recommendations ?? [];
    out.push({
      key,
      label: DOMAIN_LABELS[key] ?? key,
      hasGaps: findings.length > 0,
      findings,
      recommendations,
    });
  }
  return out;
}

export default function FrameworkGapListModule({ results, loading }: AssessmentModuleProps) {
  const runStatus = results?.status ?? null;
  const sections = buildDomainSections(results?.pillars ?? null);
  const gapCount = sections.reduce((n, s) => n + s.findings.length, 0);
  const metCount = sections.filter((s) => !s.hasGaps).length;

  return (
    <Card className="border-border/50 md:col-span-2">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <ShieldCheck className="size-4 text-primary" />
          <CardTitle className="text-base font-semibold">Framework Compliance Gap List</CardTitle>
          {sections.length > 0 && (
            <div className="ml-auto flex items-center gap-1.5">
              {gapCount > 0 && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 border-amber-500/30 text-amber-400">
                  {gapCount} gap{gapCount === 1 ? "" : "s"}
                </Badge>
              )}
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 border-green-500/30 text-green-400">
                {metCount}/{sections.length} domains clear
              </Badge>
            </div>
          )}
        </div>
        {results?.summary?.compositeScore != null && (
          <p className="text-xs text-muted-foreground mt-1">
            Overall control coverage:{" "}
            <span className="font-semibold text-foreground">{Math.round(results.summary.compositeScore)}%</span>
          </p>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-md" />
            ))}
          </div>
        ) : !results || runStatus === "pending" || runStatus === "running" ? (
          <PillarPendingState status={runStatus ?? "pending"} label="Framework Compliance Gap List" />
        ) : sections.length === 0 ? (
          <div className="flex flex-col items-center py-10 gap-2 text-center">
            <ClipboardList className="size-7 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">
              Framework control data has not been collected yet for this assessment.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {sections.map((section) => (
              <div
                key={section.key}
                className={`rounded-lg border px-3.5 py-3 ${
                  section.hasGaps ? "border-amber-500/20 bg-amber-500/5" : "border-green-500/20 bg-green-500/5"
                }`}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  {section.hasGaps ? (
                    <AlertTriangle className="size-3.5 text-amber-400 shrink-0" />
                  ) : (
                    <CheckCircle2 className="size-3.5 text-green-400 shrink-0" />
                  )}
                  <span className="text-sm font-semibold text-foreground">{section.label}</span>
                  <Badge variant="outline" className="ml-auto text-[9px] px-1.5 py-0 h-4 border-current/20">
                    {section.hasGaps ? `${section.findings.length} gap${section.findings.length === 1 ? "" : "s"}` : "No gaps identified"}
                  </Badge>
                </div>
                {section.findings.length > 0 && (
                  <ul className="space-y-1 pl-5.5 list-disc marker:text-amber-400/60">
                    {section.findings.map((f, i) => (
                      <li key={i} className="text-sm text-foreground/80">{f}</li>
                    ))}
                  </ul>
                )}
                {section.recommendations.length > 0 && (
                  <ul className="space-y-1 pl-5.5 list-disc marker:text-primary/60 mt-1.5">
                    {section.recommendations.map((r, i) => (
                      <li key={i} className="text-sm text-primary/90">{r}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
