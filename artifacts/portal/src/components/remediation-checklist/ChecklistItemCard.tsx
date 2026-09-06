import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useRaiseChangeFromChecklistItem,
  useRevealFix,
  useUpdateChecklistItem,
} from "@/lib/remediation-checklist-api";
import {
  CHECKLIST_WRITABLE_STATUS,
  type RemediationChecklistItem,
  type RemediationFixRoute,
  type RemediationTrackerStepStatus,
} from "@/lib/remediation-checklist-types";
import { fixRouteVisual, severitySwatch, statusSwatch, verificationLabel } from "@/lib/remediation-checklist-visuals";
import { cn } from "@/lib/utils";

const WRITABLE_STATUS_LABEL: Record<Exclude<RemediationTrackerStepStatus, "accepted_risk">, string> = {
  not_started: "Not started",
  completed: "Completed",
  already_handled: "Already handled another way",
  not_applicable: "Not applicable to this tenant",
  deferred: "Deferring to a later phase",
  shane_handles: "Have Shane do this one",
};

type DialogKind = "affordance" | "reveal" | "raise" | null;

export function ChecklistItemCard({
  item,
  findingCapability,
}: {
  readonly item: RemediationChecklistItem;
  /** The finding-side authored ceiling from `GET /remediation/fix-routes`, when this check appears in that catalogue. */
  readonly findingCapability: RemediationFixRoute | null;
}) {
  const [dialog, setDialog] = useState<DialogKind>(null);
  const updateMutation = useUpdateChecklistItem();

  const sev = severitySwatch(item.severity);
  const status = statusSwatch(item.status);
  const verification = verificationLabel(item.verificationState);
  const route = fixRouteVisual(item.fixRoute);
  const capped = findingCapability !== null && findingCapability !== item.fixRoute;

  const primaryLabel = item.fixRoute === "you_must_run" ? "Get the script" : route.primaryLabel;
  const openPrimary = () => setDialog(item.fixRoute === "you_must_run" ? "reveal" : "affordance");

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-border/60 bg-muted/5 p-4">
      <div className="flex flex-wrap items-start gap-3">
        <Badge variant="outline" className={cn("mt-0.5 flex-none", sev.text, sev.bg, sev.border)}>
          {sev.label}
        </Badge>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-[13px] font-semibold text-foreground">{item.title}</span>
            <span className="font-mono text-[10px] text-muted-foreground/70">{item.checkKey}</span>
          </div>
          {item.description && <span className="text-[11.5px] leading-relaxed text-muted-foreground">{item.description}</span>}
        </div>
        <div className="flex w-[190px] flex-none flex-col items-end gap-1.5">
          <select
            value={item.status}
            disabled={updateMutation.isPending}
            onChange={(e) => updateMutation.mutate({ checkKey: item.checkKey, status: e.target.value as RemediationTrackerStepStatus })}
            className={cn(
              "w-full rounded-full border bg-transparent px-2.5 py-0.5 text-right text-[10.5px] font-semibold outline-none",
              status.text,
              status.border,
              status.bg,
            )}
            data-testid={`checklist-status-${item.checkKey}`}
          >
            {CHECKLIST_WRITABLE_STATUS.map((s) => (
              <option key={s} value={s} className="bg-background text-foreground">
                {WRITABLE_STATUS_LABEL[s]}
              </option>
            ))}
            {item.status === "accepted_risk" && (
              <option value="accepted_risk" disabled className="bg-background text-foreground">
                Accepted as a risk — signed
              </option>
            )}
          </select>
          <span className={cn("text-[10px]", verification.text)}>{verification.label}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border/40 pt-2.5">
        <Badge variant="outline" className={cn("text-[9.5px] font-bold tracking-wider", route.text, route.bg, route.border)}>
          {route.label}
        </Badge>
        {capped && (
          <span
            title="The finding itself could be run for you, but your tenant's write-back consent caps this check at a script you run."
            className="cursor-help text-[10px] text-status-amber"
          >
            capped by your write consent
          </span>
        )}
        {!item.hasVerifiedContent && (
          <span className="rounded-full border border-dashed border-border px-2 py-0.5 text-[10px] text-muted-foreground">
            no verified content yet
          </span>
        )}
        <div className="ml-auto flex flex-wrap gap-1.5">
          <Button size="sm" variant={item.fixRoute === "admin_center_only" ? "outline" : "default"} onClick={openPrimary} data-testid={`checklist-primary-${item.checkKey}`}>
            {primaryLabel}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDialog("raise")} data-testid={`checklist-raise-${item.checkKey}`}>
            Raise a change request
          </Button>
        </div>
      </div>

      {dialog === "affordance" && <AffordanceDialog item={item} onClose={() => setDialog(null)} />}
      {dialog === "reveal" && <RevealDialog item={item} onClose={() => setDialog(null)} />}
      {dialog === "raise" && <RaiseChangeDialog item={item} onClose={() => setDialog(null)} />}
    </div>
  );
}

function AffordanceDialog({ item, onClose }: { readonly item: RemediationChecklistItem; readonly onClose: () => void }) {
  const executing = item.fixRoute === "we_can_run";
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{executing ? "We can run this for you" : "Open the admin centre"}</DialogTitle>
          <DialogDescription>{item.title}</DialogDescription>
        </DialogHeader>
        {executing ? (
          <div className="flex flex-col gap-2 text-[12.5px] leading-relaxed text-foreground">
            <p className="rounded-lg border border-status-green/30 bg-status-green/5 p-3 text-status-green">
              Your tenant has granted write-back consent and a reviewed pack exists for this check,
              so this one can be run for you.
            </p>
            <p><span className="font-semibold">What runs:</span> A reviewed configuration pack scoped to this check alone.</p>
            <p><span className="font-semibold">Still gated:</span> Execution goes through change control. Consent makes it possible; approval makes it happen.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2 text-[12.5px] leading-relaxed text-foreground">
            <p className="rounded-lg border border-border bg-muted/10 p-3 text-muted-foreground">
              This setting has no scriptable route at all. It is changed by hand in the admin centre.
            </p>
            <p><span className="font-semibold">Where:</span> {item.adminCenterPath ?? "Not published yet for this check"}</p>
            {item.validationCommand && (
              <p><span className="font-semibold">Confirm with:</span> <span className="font-mono text-[11px]">{item.validationCommand}</span></p>
            )}
          </div>
        )}
        <DialogFooter>
          {!executing && item.adminCenterUrl && (
            <Button variant="outline" asChild>
              <a href={item.adminCenterUrl} target="_blank" rel="noreferrer">
                Open admin centre
              </a>
            </Button>
          )}
          <Button variant={executing ? "outline" : "default"} onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RevealDialog({ item, onClose }: { readonly item: RemediationChecklistItem; readonly onClose: () => void }) {
  const revealMutation = useRevealFix();

  useEffect(() => {
    revealMutation.mutate(item.checkKey);
    // Fire exactly once when the dialog mounts for this check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.checkKey]);

  const outcome = revealMutation.data;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>The script for this fix</DialogTitle>
          <DialogDescription>{item.title}</DialogDescription>
        </DialogHeader>

        {revealMutation.isPending && (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Checking your change request…
          </div>
        )}

        {outcome && outcome.status === 200 && (
          <div className="flex flex-col gap-3">
            <p className="rounded-lg border border-status-green/30 bg-status-green/5 p-3 text-[12.5px] text-status-green">
              Released under {outcome.data.changeRequestCode}. This release is recorded against the
              change request, including who read it and when.
            </p>
            {outcome.data.prerequisites.length > 0 && (
              <div className="text-[12.5px] text-foreground">
                <span className="font-semibold">Before you run it:</span> {outcome.data.prerequisites.join(" ")}
              </div>
            )}
            <div className="text-[12.5px] text-foreground"><span className="font-semibold">Expected outcome:</span> {outcome.data.expectedOutcome}</div>
            <div className="flex flex-col gap-1 overflow-x-auto rounded-lg border border-border bg-muted/20 p-3 font-mono text-[11px] leading-relaxed">
              {outcome.data.remediationSteps.map((s, i) => (
                <div key={i} className="flex flex-col gap-0.5">
                  <span className="text-muted-foreground">{s.text}</span>
                  {s.code && <span className="text-foreground">{s.code}</span>}
                </div>
              ))}
            </div>
            <div className="text-[12.5px] text-foreground"><span className="font-semibold">Validate with:</span> {outcome.data.validationStep}</div>
          </div>
        )}

        {outcome && outcome.status !== 200 && (
          <div className="flex flex-col gap-2">
            <p
              className={cn(
                "rounded-lg border p-3 text-[12.5px]",
                outcome.status === 404
                  ? "border-border bg-muted/10 text-muted-foreground"
                  : "border-status-amber/30 bg-status-amber/5 text-status-amber",
              )}
            >
              {outcome.error}
            </p>
            {outcome.status === 403 && (
              <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                A script that changes your tenant is released against an approved change request,
                never on request alone. Raise a change request from this item; when it is approved,
                the script is released here.
              </p>
            )}
          </div>
        )}

        {revealMutation.isError && (
          <p className="rounded-lg border border-status-red/30 bg-status-red/5 p-3 text-[12.5px] text-status-red">
            {(revealMutation.error as Error)?.message ?? "Failed to check the reveal gate."}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RaiseChangeDialog({ item, onClose }: { readonly item: RemediationChecklistItem; readonly onClose: () => void }) {
  const raiseMutation = useRaiseChangeFromChecklistItem();

  useEffect(() => {
    raiseMutation.mutate(item.checkKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.checkKey]);

  const result = raiseMutation.data;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change request</DialogTitle>
          <DialogDescription>{item.title}</DialogDescription>
        </DialogHeader>

        {raiseMutation.isPending && (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Raising the change request…
          </div>
        )}

        {result && (
          <div className="flex flex-col gap-2.5">
            <p className="rounded-lg border border-status-green/30 bg-status-green/5 p-3 text-[12.5px] text-status-green">
              {result.code} raised against this finding and waiting for approval. It carries the
              check key, so an approval releases exactly this fix and nothing else.
            </p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11.5px]">
              <span className="text-muted-foreground">Classification</span>
              <span className="text-foreground">{result.risk}</span>
              <span className="text-muted-foreground">Workload</span>
              <span className="text-foreground">{result.workload}</span>
              <span className="text-muted-foreground">Freeze exception</span>
              <span className="text-foreground">{result.freezeException ? "Yes — an exception was needed" : "None active"}</span>
              <span className="text-muted-foreground">Linked risk</span>
              <span className="text-foreground">{result.riskDischarged ? "Discharges an existing risk" : "None discharged by this request"}</span>
            </div>
            <span className="text-[10.5px] leading-relaxed text-muted-foreground">
              A change request can only be raised while the finding is still open on your latest
              scan. Once it is resolved, this route closes rather than raising an empty request.
            </span>
          </div>
        )}

        {raiseMutation.isError && (
          <p className="rounded-lg border border-status-red/30 bg-status-red/5 p-3 text-[12.5px] text-status-red">
            {(raiseMutation.error as Error)?.message ?? "Failed to raise the change request."}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
