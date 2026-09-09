/**
 * One row of the Remediation Tracker's 28-step programme (#3037, §1a of
 * docs/portal/remediation-tracking-contract-pack.md). Renders the step's real claim
 * (`status`), real verification (`verificationState`), and derived
 * `terminalState` — three related but distinct facts, never collapsed (see
 * the contract pack §4b).
 */
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { catalogueStep, REMEDIATION_STEPS_WITH_NO_CHECK } from "@/lib/remediation-tracker-catalogue";
import { STEP_CHECK_KEYS } from "@/components/copilot-journey/remediationLiveGuide";
import { useSetRemediationTrackerStep } from "@/lib/remediation-tracker-api";
import {
  REMEDIATION_TRACKER_STEP_STATUS_WRITABLE,
  REMEDIATION_TRACKER_STEP_STATUS_LABELS,
  type WireTrackerStep,
} from "@/lib/remediation-tracker-types";
import { statusSwatch, terminalDisplay, verificationDisplay } from "@/lib/remediation-tracker-visuals";
import type { StepActionTarget } from "./StepActionDialog";

const NOT_STARTED: WireTrackerStep = {
  stepId: "",
  status: "not_started",
  completedAt: null,
  updatedAt: null,
  verificationState: "unverified",
  verifiedAt: null,
  terminalState: "outstanding",
};

/** The action-picker's non-checkbox choices — every writable status except `completed`, which is the checkbox's own job. */
const PICKER_STATUSES = REMEDIATION_TRACKER_STEP_STATUS_WRITABLE.filter((s) => s !== "completed" && s !== "not_started");

export function StepRow({
  stepId,
  step,
  onOpenAction,
}: {
  stepId: string;
  step: WireTrackerStep | undefined;
  onOpenAction: (target: StepActionTarget) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const catalogue = catalogueStep(stepId);
  const row = step ?? { ...NOT_STARTED, stepId };
  const setStepMutation = useSetRemediationTrackerStep();

  const hasCheck = !REMEDIATION_STEPS_WITH_NO_CHECK.has(stepId);
  const mappedChecks = STEP_CHECK_KEYS[stepId] ?? [];
  const claimed = row.status !== "not_started";

  const statusSw = statusSwatch(row.status);
  const vDisplay = verificationDisplay(row.verificationState, hasCheck);
  const term = terminalDisplay(row.terminalState);

  const pending = setStepMutation.isPending && setStepMutation.variables?.stepId === stepId;

  const write = (status: (typeof REMEDIATION_TRACKER_STEP_STATUS_WRITABLE)[number]) => {
    setStepMutation.mutate({ stepId, status });
    setPickerOpen(false);
  };

  return (
    <div className="flex flex-col gap-2 border-t border-border/40 py-2.5 first:border-t-0">
      <div className="flex items-start gap-3">
        <Checkbox
          checked={row.status === "completed"}
          disabled={pending}
          onCheckedChange={(v) => write(v === true ? "completed" : "not_started")}
          className="mt-0.5"
          data-testid={`remediation-step-toggle-${stepId}`}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="font-mono text-[10px] text-muted-foreground">{stepId}</span>
            <span className={cn("text-[12.5px] font-semibold", row.status === "not_started" ? "text-foreground/90" : "text-foreground")}>
              {catalogue?.title ?? stepId}
            </span>
          </div>
          <span className="text-[10.5px] text-muted-foreground">
            {mappedChecks.length > 0 ? `Mapped checks: ${mappedChecks.join(", ")}` : "No automated check maps to this step"}
          </span>
        </div>
        <div className="flex flex-none flex-col items-end gap-1">
          <Badge variant="outline" className={cn(statusSw.text, statusSw.bg, statusSw.border, "w-[210px] justify-center text-center")}>
            {statusSw.label}
          </Badge>
          <span className={cn("flex items-center gap-1.5 text-[10px]", vDisplay.text)}>
            <span className={cn("size-1.5 rounded-full", vDisplay.dashed ? "border border-current bg-transparent" : "bg-current")} />
            {vDisplay.label}
          </span>
          <span className={cn("text-[9.5px] font-bold tracking-wider", term.text)}>{term.label}</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 pl-7">
        {!hasCheck ? (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[11px]"
            onClick={() => onOpenAction({ mode: "nocheck", stepId, title: catalogue?.title ?? stepId })}
          >
            Why this can never be verified
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px]"
              onClick={() => onOpenAction({ mode: "verify", stepId, title: catalogue?.title ?? stepId, claimed })}
            >
              Re-verify now
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px]"
              onClick={() => onOpenAction({ mode: "guide", stepId, title: catalogue?.title ?? stepId })}
            >
              How to check it yourself
            </Button>
          </>
        )}

        {row.status === "accepted_risk" ? (
          <Badge variant="outline" className="h-7 items-center border-violet-400/40 bg-violet-400/10 text-violet-400">
            Signed acceptance on record
          </Badge>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[11px]"
            onClick={() => onOpenAction({ mode: "decline", stepId, title: catalogue?.title ?? stepId })}
          >
            Decline and accept the risk
          </Button>
        )}

        <div className="relative">
          <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => setPickerOpen((o) => !o)} disabled={pending}>
            {pending && <Loader2 className="size-3 animate-spin" />}
            Other action…
          </Button>
          {pickerOpen && (
            <div className="absolute left-0 top-full z-10 mt-1 flex w-56 flex-col overflow-hidden rounded-md border border-border bg-popover shadow-md">
              {PICKER_STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="px-3 py-2 text-left text-[11.5px] text-foreground hover:bg-accent"
                  onClick={() => write(s)}
                >
                  {REMEDIATION_TRACKER_STEP_STATUS_LABELS[s]}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
