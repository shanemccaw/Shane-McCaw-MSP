import type { AssessmentModuleProps } from "./module-registry";
import { PillarModuleShell, findingBg } from "./PillarModuleShell";
import { Sparkles, CheckCircle2, XCircle } from "lucide-react";
import { EngineTrendChart } from "@/components/charts/EngineTrendChart";
import { useAuth } from "@/lib/auth-context";

export default function CopilotModule({ results, loading, error }: AssessmentModuleProps) {
  const pillar = results?.pillars?.copilot ?? null;
  const { user } = useAuth();
  return (
    <PillarModuleShell
      label="Copilot AI Readiness"
      pillarKey="copilot"
      loading={loading}
      runStatus={results?.status ?? null}
      pillar={pillar}
    >
      {(p) => (
        <div className="space-y-4">
          {user?.customerId != null && (
            // Copilot readiness is a pillar within the Health Engine, not a
            // standalone engine key — engine-history.ts tracks whole-engine
            // trends only, so this shows the Health Engine's overall series
            // (of which Copilot readiness is one contributing pillar).
            <EngineTrendChart engineKey="health" title="Tenant Health Trend" height={180} />
          )}
          {p.findings.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Readiness Blockers</p>
              <ul className="space-y-1.5">
                {p.findings.map((f, i) => (
                  <li key={i} className={`flex items-start gap-2 text-sm px-3 py-2 rounded-md border ${findingBg(i)}`}>
                    <XCircle className="size-3.5 mt-0.5 shrink-0 text-amber-400" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {p.recommendations.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Enablement Steps</p>
              <ul className="space-y-1.5">
                {p.recommendations.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <CheckCircle2 className="size-3.5 mt-0.5 shrink-0 text-primary" />
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {p.findings.length === 0 && p.recommendations.length === 0 && (
            <div className="flex flex-col items-center py-6 gap-2 text-center">
              <Sparkles className="size-6 text-primary/60" />
              <p className="text-sm text-muted-foreground">No Copilot readiness blockers detected.</p>
            </div>
          )}
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
      )}
    </PillarModuleShell>
  );
}
