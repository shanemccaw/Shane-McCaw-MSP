/**
 * One phase's card in the Remediation Tracker's 28-step programme (#3037) —
 * groups that phase's two pillars, each with its own step rows. Phase/pillar
 * grouping is the tracker's own fixed catalogue key
 * (`REMEDIATION_PHASE_PILLARS`), not re-derived from anything on the wire.
 */
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { RemediationCataloguePhase } from "@/lib/remediation-tracker-catalogue";
import { REMEDIATION_PHASE_PILLARS, stepsForPhase } from "@/lib/remediation-tracker-catalogue";
import type { WireTrackerStep } from "@/lib/remediation-tracker-types";
import { StepRow } from "./StepRow";
import type { StepActionTarget } from "./StepActionDialog";

const READY_STATUSES = new Set(["completed", "already_handled", "not_applicable", "deferred", "accepted_risk"]);

export function PhaseGroup({
  phase,
  stepsById,
  onOpenAction,
}: {
  phase: RemediationCataloguePhase;
  stepsById: ReadonlyMap<string, WireTrackerStep>;
  onOpenAction: (target: StepActionTarget) => void;
}) {
  const pillars = REMEDIATION_PHASE_PILLARS[phase];
  const steps = stepsForPhase(phase);
  const ready = steps.every((s) => READY_STATUSES.has(stepsById.get(s.id)?.status ?? "not_started"));

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-5">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-[12.5px] font-bold text-foreground">Phase {phase}</span>
          <span className="text-[11px] text-muted-foreground">
            {pillars[0]} + {pillars[1]} · {steps.length} steps
          </span>
          <Badge
            variant="outline"
            className={cn(
              "ml-auto text-[9.5px] font-bold tracking-wider",
              ready ? "border-status-green/40 text-status-green" : "border-border text-muted-foreground",
            )}
          >
            {ready ? "PHASE READY" : "NOT READY"}
          </Badge>
        </div>

        {pillars.map((pillar) => {
          const pillarSteps = steps.filter((s) => s.pillar === pillar);
          return (
            <div key={pillar} className="flex flex-col border-t border-border/50 pt-2">
              <div className="flex items-center gap-2 pb-1">
                <span className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground/80">{pillar}</span>
                <span className="text-[10.5px] text-muted-foreground/60">{pillarSteps.length} steps</span>
              </div>
              {pillarSteps.map((s) => (
                <StepRow key={s.id} stepId={s.id} step={stepsById.get(s.id)} onOpenAction={onOpenAction} />
              ))}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
