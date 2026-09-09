import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  useDeclineChecklistItemToRisk,
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

type DialogKind = "affordance" | "reveal" | "raise" | "decline" | null;

const STATEMENT_MAX = 2000;

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

  // #2869's signed exit to accepted_risk, offered only while the finding is still
  // outstanding — a plain status change to accepted_risk is refused server-side (400),
  // and a repeat decline once already accepted is refused server-side (409).
  const canDecline = item.status !== "accepted_risk" && item.verificationState !== "verified";

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
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant={item.fixRoute === "admin_center_only" ? "outline" : "default"} onClick={openPrimary} data-testid={`checklist-primary-${item.checkKey}`}>
            {primaryLabel}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDialog("raise")} data-testid={`checklist-raise-${item.checkKey}`}>
            Raise a change request
          </Button>
          {item.status === "accepted_risk" ? (
            <Badge
              variant="outline"
              className="h-8 items-center border-violet-400/40 bg-violet-400/10 text-violet-400"
              data-testid={`checklist-decline-status-${item.checkKey}`}
            >
              Signed acceptance
            </Badge>
          ) : (
            canDecline && (
              <Button size="sm" variant="outline" onClick={() => setDialog("decline")} data-testid={`checklist-decline-${item.checkKey}`}>
                Decline and accept the risk
              </Button>
            )
          )}
        </div>
      </div>

      {dialog === "affordance" && <AffordanceDialog item={item} onClose={() => setDialog(null)} />}
      {dialog === "reveal" && <RevealDialog item={item} onClose={() => setDialog(null)} />}
      {dialog === "raise" && <RaiseChangeDialog item={item} onClose={() => setDialog(null)} />}
      {dialog === "decline" && <DeclineToRiskDialog item={item} onClose={() => setDialog(null)} />}
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

/**
 * The checklist's own signed exit to accepted_risk (#2869, wired here per #3346 —
 * the Design export added this affordance after the page was already wired). Same
 * form and same `POST .../decline-to-risk` contract as the 28-step programme's own
 * decline flow (`StepActionDialog.tsx`'s "decline" mode), applied to a `checkKey`
 * instead of a `stepId`.
 */
function DeclineToRiskDialog({ item, onClose }: { readonly item: RemediationChecklistItem; readonly onClose: () => void }) {
  const [name, setName] = useState("");
  const [statement, setStatement] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const declineMutation = useDeclineChecklistItemToRisk();

  const result = declineMutation.data;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Accept the risk on {item.checkKey}</DialogTitle>
          <DialogDescription>{item.title}</DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="flex flex-col gap-2.5 rounded-xl border border-violet-400/30 bg-violet-400/5 p-4">
            <span className="text-[12.5px] font-semibold text-foreground">
              Recorded as {result.rbdId} on your risk register, signed by {result.accepted.by}.
            </span>
            <span className="text-[11.5px] leading-relaxed text-muted-foreground">
              This finding now reads as accepted rather than outstanding. It stays on your scan
              results until a re-scan clears it — acceptance is a decision about the risk, not
              about the reading. It comes back for review on a real clock; accepting is not the
              same as closing. No monetary exposure and no technical detail are attached to this
              record — neither is known, so neither is invented.
            </span>
            <Link href="/risk-register" className="text-[11.5px] font-semibold text-primary hover:underline">
              View it on your Risk Register →
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <span className="text-[11.5px] leading-relaxed text-muted-foreground">
              Closes this finding without fixing it, by putting a signed acceptance on your risk
              register in its place — the same signed route the 28-step programme uses. This is a
              terminal decision: the finding stops being outstanding.
            </span>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`decline-name-${item.checkKey}`} className="text-[11px] text-muted-foreground">
                Your full name
              </Label>
              <Input
                id={`decline-name-${item.checkKey}`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="As it should appear on the record"
                data-testid={`checklist-decline-name-${item.checkKey}`}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`decline-statement-${item.checkKey}`} className="text-[11px] text-muted-foreground">
                Why this risk is being accepted
              </Label>
              <Textarea
                id={`decline-statement-${item.checkKey}`}
                value={statement}
                onChange={(e) => setStatement(e.target.value.slice(0, STATEMENT_MAX))}
                placeholder="The reasoning that will be read at review, in your words"
                className="min-h-[80px] resize-y"
                data-testid={`checklist-decline-statement-${item.checkKey}`}
              />
              <span className="text-[10.5px] text-muted-foreground/70">
                {statement.length} of {STATEMENT_MAX} characters
              </span>
            </div>
            <label className="flex cursor-pointer items-start gap-2.5">
              <Checkbox checked={confirmed} onCheckedChange={(v) => setConfirmed(v === true)} className="mt-0.5" />
              <span className="text-xs leading-relaxed text-foreground">
                I accept this risk on behalf of my organisation. This is a permanent signed record
                with no expiry — it can be superseded, never deleted.
              </span>
            </label>
            {declineMutation.isError && (
              <p className="rounded-lg border border-status-red/30 bg-status-red/5 p-3 text-[12.5px] text-status-red">
                {(declineMutation.error as Error)?.message ?? "Failed to accept the risk."}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {result ? "Close" : "Cancel"}
          </Button>
          {!result && (
            <Button
              disabled={name.trim().length < 2 || statement.trim().length === 0 || !confirmed || declineMutation.isPending}
              onClick={() =>
                declineMutation.mutate({
                  checkKey: item.checkKey,
                  body: { fullName: name.trim(), confirmed: true, statement: statement.trim() },
                })
              }
              data-testid={`checklist-decline-submit-${item.checkKey}`}
            >
              {declineMutation.isPending && <Loader2 className="size-3.5 animate-spin" />}
              Sign and accept
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
