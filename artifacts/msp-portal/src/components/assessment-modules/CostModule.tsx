import type { AssessmentModuleProps } from "./module-registry";
import { PillarModuleShell, findingBg } from "./PillarModuleShell";
import { DollarSign } from "lucide-react";

export default function CostModule({ results, loading, error }: AssessmentModuleProps) {
  const pillar = results?.pillars?.costLicensing ?? null;
  return (
    <PillarModuleShell
      label="Cost & Licensing"
      pillarKey="costLicensing"
      loading={loading}
      runStatus={results?.status ?? null}
      pillar={pillar}
    >
      {(p) => (
        <div className="space-y-4">
          {p.findings.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Cost Signals</p>
              <ul className="space-y-1.5">
                {p.findings.map((f, i) => (
                  <li key={i} className={`flex items-start gap-2 text-sm px-3 py-2 rounded-md border ${findingBg(i)}`}>
                    <DollarSign className="size-3.5 mt-0.5 shrink-0 text-green-400" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {p.recommendations.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Optimisation Opportunities</p>
              <ul className="space-y-1.5">
                {p.recommendations.map((r, i) => (
                  <li key={i} className="text-sm text-muted-foreground pl-3 border-l-2 border-green-500/40">{r}</li>
                ))}
              </ul>
            </div>
          )}
          {p.findings.length === 0 && p.recommendations.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">No cost or licensing findings recorded for this run.</p>
          )}
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
      )}
    </PillarModuleShell>
  );
}
