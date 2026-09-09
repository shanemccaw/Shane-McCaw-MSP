/**
 * The Remediation Tracker's "28-step programme" surface (#3037, Feature
 * #1489) — wires §1a of docs/portal/remediation-tracking-contract-pack.md
 * (`portal-remediation-tracker.ts`: GET tracker + pricing, PUT step status,
 * POST verify, GET verification-guide, POST decline-to-risk) to the real
 * Design export
 * (`Design/portal/design_handoff_full_site/screens/Remediation Tracking.dc.html`,
 * the "28-step programme" tab).
 *
 * Deliberately does NOT cover the "Your findings" checklist tab or the
 * "Fixed outside change control" bypass tab (§1b-1e, #3038) — a separate,
 * real functional unit dispatched as its own issue under the same Feature.
 *
 * The pillar scores panel and CSV/PDF/evidence-pack exports (§1f-1g, #3039)
 * are mounted here — real functional units of their own, but on the same
 * "28-step programme" tab per the design's own layout.
 */
import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PillarScoresCard } from "@/components/remediation-tracker/PillarScoresCard";
import { RemediationExportControls } from "@/components/remediation-tracker/RemediationExportControls";
import { REMEDIATION_TRACKER_CATALOGUE } from "@/lib/remediation-tracker-catalogue";
import { useRemediationTracker } from "@/lib/remediation-tracker-api";
import type { WireTrackerStep } from "@/lib/remediation-tracker-types";
import { PhaseGroup } from "./PhaseGroup";
import { PricingPanel } from "./PricingPanel";
import { StepActionDialog, type StepActionTarget } from "./StepActionDialog";

export function RemediationProgrammeTab() {
  const { data, isLoading, isError, refetch, isRefetching } = useRemediationTracker();
  const [actionTarget, setActionTarget] = useState<StepActionTarget | null>(null);

  const stepsById: ReadonlyMap<string, WireTrackerStep> = new Map((data?.steps ?? []).map((s) => [s.stepId, s]));

  const verifiedCount = data?.steps.filter((s) => s.verificationState === "verified").length ?? 0;
  const acceptedCount = data?.steps.filter((s) => s.status === "accepted_risk").length ?? 0;
  const noCheckCount = 3; // s18, s27, s30 — permanent, see remediation-tracker-catalogue.ts

  return (
    <div className="flex flex-col gap-3">
      {isLoading && (
        <div className="flex flex-col gap-2.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex animate-pulse flex-col gap-2 rounded-xl border border-border/60 bg-muted/10 p-4">
              <div className="h-2.5 w-2/5 rounded-full bg-muted-foreground/20" />
              <div className="h-2 w-1/2 rounded-full bg-muted-foreground/10" />
            </div>
          ))}
        </div>
      )}

      {isError && (
        <div className="flex gap-2.5 rounded-xl border border-dashed border-status-red/45 bg-status-red/[.06] p-4">
          <AlertTriangle className="mt-0.5 size-4 flex-none text-status-red" />
          <div className="flex flex-col gap-1">
            <span className="text-[13px] font-semibold text-foreground">The 28-step programme could not be read</span>
            <span className="max-w-[620px] text-xs leading-relaxed text-muted-foreground">
              This is a failed read, not an empty tracker. Anything already claimed or verified is
              unaffected.
            </span>
            <Button variant="link" size="sm" className="h-auto w-fit p-0 text-[11.5px]" onClick={() => void refetch()} disabled={isRefetching}>
              {isRefetching && <Loader2 className="size-3 animate-spin" />}
              Try again
            </Button>
          </div>
        </div>
      )}

      {data && (
        <>
          <PillarScoresCard />

          <PricingPanel pricing={data.pricing} stepsById={stepsById} />

          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-[13.5px] font-semibold text-foreground">The 28-step programme</span>
            <span className="text-[11px] text-muted-foreground">
              {verifiedCount} verified by a re-scan · {acceptedCount} accepted as a signed risk · {noCheckCount} can never be verified
            </span>
            <div className="ml-auto">
              <RemediationExportControls verifiedCount={verifiedCount} />
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-dashed border-muted-foreground/30 p-3">
            <span className="mt-0.5 flex-none rounded-full border border-muted-foreground/40 px-1.5 py-0.5 text-[8.5px] font-bold tracking-wider text-muted-foreground">
              FIXED CATALOGUE
            </span>
            <span className="text-[11.5px] leading-relaxed text-muted-foreground">
              Step titles are the same fixed {REMEDIATION_TRACKER_CATALOGUE.length} for every tenant.
              Only the status you set, whether a re-scan verified it, and how it resolved are yours.
            </span>
          </div>

          <PhaseGroup phase={1} stepsById={stepsById} onOpenAction={setActionTarget} />
          <PhaseGroup phase={2} stepsById={stepsById} onOpenAction={setActionTarget} />
          <PhaseGroup phase={3} stepsById={stepsById} onOpenAction={setActionTarget} />

          <span className="text-[10.5px] leading-relaxed text-muted-foreground">
            {REMEDIATION_TRACKER_CATALOGUE.length} steps. Steps 24 and 25 were removed from the
            catalogue and cannot be set. Three steps — s18, s27 and s30 — have no automated check
            and will never be verifiable; that is permanent, not pending.
          </span>
        </>
      )}

      <StepActionDialog target={actionTarget} onOpenChange={(open) => !open && setActionTarget(null)} />
    </div>
  );
}
