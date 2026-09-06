/**
 * The Remediation Tracker's per-step action dialog (#3037) — covers the four
 * §1a actions the design's "sh" sheet renders for the 28-step programme:
 * pointed re-verify, the verification guide, decline-to-risk, and the
 * permanent "no automated check" explanation. One dialog, four modes, so only
 * one step's action is ever open at a time (mirrors the design's own `sheet`
 * state, singular).
 */
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Link } from "wouter";
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
import { STEP_CHECK_GAPS } from "@/components/copilot-journey/remediationLiveGuide";
import {
  useDeclineRemediationStepToRisk,
  useRemediationVerificationGuide,
  useVerifyRemediationStep,
} from "@/lib/remediation-tracker-api";
import { toast } from "sonner";

const STATEMENT_MAX = 2000;

export type StepActionMode = "verify" | "guide" | "decline" | "nocheck";

export interface StepActionTarget {
  readonly mode: StepActionMode;
  readonly stepId: string;
  readonly title: string;
  /** Only meaningful for "verify": whether anything has been claimed on this step yet. */
  readonly claimed?: boolean;
}

export function StepActionDialog({
  target,
  onOpenChange,
}: {
  target: StepActionTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [statement, setStatement] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [declined, setDeclined] = useState<{ rbdId: string; by: string; on: string } | null>(null);

  const verifyMutation = useVerifyRemediationStep();
  const declineMutation = useDeclineRemediationStepToRisk();
  const guideQuery = useRemediationVerificationGuide(target?.mode === "guide" ? target.stepId : null);

  const reset = () => {
    setName("");
    setStatement("");
    setConfirmed(false);
    setDeclined(null);
    verifyMutation.reset();
    declineMutation.reset();
  };

  const handleClose = (open: boolean) => {
    if (!open) reset();
    onOpenChange(open);
  };

  if (!target) return null;

  return (
    <Dialog open={!!target} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        {target.mode === "verify" && (
          <>
            <DialogHeader>
              <DialogTitle>Re-verify {target.stepId}</DialogTitle>
              <DialogDescription>{target.title}</DialogDescription>
            </DialogHeader>
            {!target.claimed ? (
              <p className="text-[12.5px] leading-relaxed text-status-amber">
                Nothing has been claimed on this step yet. A re-verification confirms a claim; it
                does not make one.
              </p>
            ) : verifyMutation.isSuccess ? (
              <p className="text-[12.5px] leading-relaxed text-status-green">
                Requested. This runs as its own recorded job, and the verdict lands on this step
                when it finishes — there is nothing to wait on here.
              </p>
            ) : (
              <div className="flex flex-col gap-2 text-[12.5px] leading-relaxed text-muted-foreground">
                <p>
                  A pointed re-verification reads this step&apos;s mapped check(s) right now instead
                  of waiting for the next full scan. It returns verified if every mapped check comes
                  back clean, or drifted if any one of them does not — never a score.
                </p>
                <p>It will not change your claim, fix anything, or write to your tenant.</p>
                <p className="text-status-amber/90">
                  Needs a connected Microsoft 365 tenant — without one the request is refused rather
                  than queued and quietly dropped.
                </p>
              </div>
            )}
            {verifyMutation.isError && (
              <p className="text-[12.5px] text-destructive">{(verifyMutation.error as Error).message}</p>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => handleClose(false)}>
                Close
              </Button>
              {target.claimed && !verifyMutation.isSuccess && (
                <Button
                  disabled={verifyMutation.isPending}
                  onClick={() =>
                    verifyMutation.mutate(target.stepId, {
                      onError: (e) => toast.error((e as Error).message),
                    })
                  }
                >
                  {verifyMutation.isPending && <Loader2 className="size-3.5 animate-spin" />}
                  Request re-verification
                </Button>
              )}
            </DialogFooter>
          </>
        )}

        {target.mode === "guide" && (
          <>
            <DialogHeader>
              <DialogTitle>How to check {target.stepId} yourself</DialogTitle>
              <DialogDescription>{target.title}</DialogDescription>
            </DialogHeader>
            {guideQuery.isLoading && (
              <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Loading guidance…
              </div>
            )}
            {guideQuery.isError && (
              <p className="text-[12.5px] text-destructive">
                {(guideQuery.error as Error).message ?? "Could not load guidance"}
              </p>
            )}
            {guideQuery.data && (
              <div className="flex flex-col gap-3">
                {guideQuery.data.guidance.map((g) => (
                  <div key={g.checkKey} className="flex flex-col gap-1.5 rounded-lg border border-border/60 p-3">
                    <span className="font-mono text-[10.5px] text-muted-foreground">{g.checkKey}</span>
                    {g.validationStep ? (
                      <>
                        <span className="text-[12px] leading-relaxed text-foreground">{g.validationStep}</span>
                        {g.validationCommand && (
                          <pre className="overflow-x-auto rounded-md bg-muted/30 p-2 font-mono text-[11px] leading-relaxed text-foreground">
                            {g.validationCommand}
                          </pre>
                        )}
                        {g.expectedOutcome && (
                          <span className="text-[11px] leading-relaxed text-muted-foreground">
                            Expected: {g.expectedOutcome}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-[11.5px] text-muted-foreground">
                        No published, reviewed guidance exists for this check yet.
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => handleClose(false)}>
                Close
              </Button>
            </DialogFooter>
          </>
        )}

        {target.mode === "nocheck" && (
          <>
            <DialogHeader>
              <DialogTitle>{target.stepId} cannot be verified</DialogTitle>
              <DialogDescription>{target.title}</DialogDescription>
            </DialogHeader>
            <p className="text-[12.5px] leading-relaxed text-foreground">
              {STEP_CHECK_GAPS[target.stepId] ??
                "This is a decision or process step, not a configuration setting, so no automated check maps to it and none is planned. This is a permanent state, not a scan that has not happened yet. You can still claim it and record how you satisfied it, but it will never appear in the evidence pack, which carries only what a re-scan verified."}
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => handleClose(false)}>
                Close
              </Button>
            </DialogFooter>
          </>
        )}

        {target.mode === "decline" && (
          <>
            <DialogHeader>
              <DialogTitle>Accept the risk on {target.stepId}</DialogTitle>
              <DialogDescription>{target.title}</DialogDescription>
            </DialogHeader>
            {declined ? (
              <div className="flex flex-col gap-2.5 rounded-xl border border-violet-400/30 bg-violet-400/5 p-4">
                <span className="text-[12.5px] font-semibold text-foreground">
                  Recorded as {declined.rbdId} on your risk register, signed by {declined.by}.
                </span>
                <span className="text-[11.5px] leading-relaxed text-muted-foreground">
                  The step now reads as accepted rather than outstanding. It comes back for review on
                  a real clock — accepting is not the same as closing. No monetary exposure and no
                  technical detail are attached to this record; neither is known, so neither is
                  invented.
                </span>
                <Link href="/risk-register" className="text-[11.5px] font-semibold text-primary hover:underline">
                  View it on your Risk Register →
                </Link>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1 text-[11.5px] leading-relaxed text-muted-foreground">
                  <span>
                    Closes the step without fixing it, by putting a signed acceptance on your risk
                    register in its place. This is a terminal decision — the step stops being
                    outstanding, and its phase can price down.
                  </span>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`decline-name-${target.stepId}`} className="text-[11px] text-muted-foreground">
                    Your full name
                  </Label>
                  <Input
                    id={`decline-name-${target.stepId}`}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="As it should appear on the record"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`decline-statement-${target.stepId}`} className="text-[11px] text-muted-foreground">
                    Why this risk is being accepted
                  </Label>
                  <Textarea
                    id={`decline-statement-${target.stepId}`}
                    value={statement}
                    onChange={(e) => setStatement(e.target.value.slice(0, STATEMENT_MAX))}
                    placeholder="The reasoning that will be read at review, in your words"
                    className="min-h-[80px] resize-y"
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
                  <p className="text-[12.5px] text-destructive">{(declineMutation.error as Error).message}</p>
                )}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => handleClose(false)}>
                {declined ? "Close" : "Cancel"}
              </Button>
              {!declined && (
                <Button
                  disabled={name.trim().length < 2 || statement.trim().length === 0 || !confirmed || declineMutation.isPending}
                  onClick={() =>
                    declineMutation.mutate(
                      { stepId: target.stepId, body: { fullName: name.trim(), confirmed: true, statement: statement.trim() } },
                      {
                        onSuccess: (res) => setDeclined({ rbdId: res.rbdId, by: res.accepted.by, on: res.accepted.on }),
                        onError: (e) => toast.error((e as Error).message),
                      },
                    )
                  }
                >
                  {declineMutation.isPending && <Loader2 className="size-3.5 animate-spin" />}
                  Sign and accept
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
