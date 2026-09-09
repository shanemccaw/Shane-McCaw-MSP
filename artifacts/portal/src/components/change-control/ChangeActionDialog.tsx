/**
 * Approve / reject / decline — the three real decision mutations on a change
 * request (#1496 approval model, #1534/#1514 decline-to-risk). One dialog,
 * three modes, mirroring `StepActionDialog`'s pattern elsewhere in this app.
 */
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { useApproveChange, useDeclineChange, useRejectChange } from "@/lib/change-control-api";
import { toast } from "sonner";

export type ChangeActionMode = "approve" | "reject" | "decline";

export interface ChangeActionTarget {
  readonly mode: ChangeActionMode;
  readonly code: string;
  readonly title: string;
}

export function ChangeActionDialog({ target, onOpenChange }: { target: ChangeActionTarget | null; onOpenChange: (open: boolean) => void }) {
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [fullName, setFullName] = useState("");
  const [statement, setStatement] = useState("");
  const [done, setDone] = useState<string | null>(null);

  const approveMutation = useApproveChange();
  const rejectMutation = useRejectChange();
  const declineMutation = useDeclineChange();

  const reset = () => {
    setNote("");
    setReason("");
    setFullName("");
    setStatement("");
    setDone(null);
    approveMutation.reset();
    rejectMutation.reset();
    declineMutation.reset();
  };

  const handleClose = (open: boolean) => {
    if (!open) reset();
    onOpenChange(open);
  };

  if (!target) return null;
  const pending = approveMutation.isPending || rejectMutation.isPending || declineMutation.isPending;

  return (
    <Dialog open={!!target} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        {target.mode === "approve" && (
          <>
            <DialogHeader>
              <DialogTitle>Approve {target.code}</DialogTitle>
              <DialogDescription>{target.title}</DialogDescription>
            </DialogHeader>
            {done ? (
              <p className="text-[12.5px] leading-relaxed text-status-green">{done}</p>
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                  Records a real approval on the next pending stage. The server re-checks your
                  authority, the stage order and separation of duties.
                </p>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="cc-approve-note" className="text-[11px] text-muted-foreground">
                    Note <span className="text-muted-foreground/70">optional</span>
                  </Label>
                  <Textarea id="cc-approve-note" value={note} onChange={(e) => setNote(e.target.value.slice(0, 2_000))} className="min-h-[70px] resize-y" />
                </div>
                {approveMutation.isError && <p className="text-[12.5px] text-destructive">{(approveMutation.error as Error).message}</p>}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => handleClose(false)}>
                {done ? "Close" : "Cancel"}
              </Button>
              {!done && (
                <Button
                  disabled={pending}
                  onClick={() =>
                    approveMutation.mutate(
                      { code: target.code, note: note.trim() || undefined },
                      {
                        onSuccess: (res) => setDone(res.complete ? "Approved — every required stage has now cleared." : `Approved — stage ${res.stage} recorded.`),
                        onError: (e) => toast.error((e as Error).message),
                      },
                    )
                  }
                >
                  {approveMutation.isPending && <Loader2 className="size-3.5 animate-spin" />}
                  Approve
                </Button>
              )}
            </DialogFooter>
          </>
        )}

        {target.mode === "reject" && (
          <>
            <DialogHeader>
              <DialogTitle>Reject {target.code} with a reason</DialogTitle>
              <DialogDescription>{target.title}</DialogDescription>
            </DialogHeader>
            {done ? (
              <p className="text-[12.5px] leading-relaxed text-status-green">{done}</p>
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                  A reason is required. Rejecting this change assigns the residual risk to your
                  side and records it on your risk register.
                </p>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="cc-reject-reason" className="text-[11px] text-muted-foreground">
                    Reason <span className="text-status-amber">required</span>
                  </Label>
                  <Textarea id="cc-reject-reason" value={reason} onChange={(e) => setReason(e.target.value.slice(0, 2_000))} className="min-h-[80px] resize-y" />
                </div>
                {rejectMutation.isError && <p className="text-[12.5px] text-destructive">{(rejectMutation.error as Error).message}</p>}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => handleClose(false)}>
                {done ? "Close" : "Cancel"}
              </Button>
              {!done && (
                <Button
                  variant="destructive"
                  disabled={reason.trim().length === 0 || pending}
                  onClick={() =>
                    rejectMutation.mutate(
                      { code: target.code, reason: reason.trim() },
                      {
                        onSuccess: (res) =>
                          setDone(
                            res.riskAssigned
                              ? "Rejected — recorded as an accepted risk on your register."
                              : "Rejected — no risk record was created for this rejection.",
                          ),
                        onError: (e) => toast.error((e as Error).message),
                      },
                    )
                  }
                >
                  {rejectMutation.isPending && <Loader2 className="size-3.5 animate-spin" />}
                  Reject
                </Button>
              )}
            </DialogFooter>
          </>
        )}

        {target.mode === "decline" && (
          <>
            <DialogHeader>
              <DialogTitle>Decline this Microsoft change</DialogTitle>
              <DialogDescription>{target.title}</DialogDescription>
            </DialogHeader>
            {done ? (
              <p className="text-[12.5px] leading-relaxed text-status-green">{done}</p>
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                  Declining a routed Microsoft change is declining a remediation: the change goes
                  to rejected and the residual risk becomes yours, recorded as an accepted risk
                  linked back to this CR.
                </p>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="cc-decline-name" className="text-[11px] text-muted-foreground">
                    Your full name
                  </Label>
                  <Input id="cc-decline-name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="As it should appear on the record" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="cc-decline-statement" className="text-[11px] text-muted-foreground">
                    Statement
                  </Label>
                  <Textarea id="cc-decline-statement" value={statement} onChange={(e) => setStatement(e.target.value.slice(0, 2_000))} className="min-h-[80px] resize-y" />
                </div>
                {declineMutation.isError && <p className="text-[12.5px] text-destructive">{(declineMutation.error as Error).message}</p>}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => handleClose(false)}>
                {done ? "Close" : "Cancel"}
              </Button>
              {!done && (
                <Button
                  disabled={fullName.trim().length < 2 || statement.trim().length === 0 || pending}
                  onClick={() =>
                    declineMutation.mutate(
                      { code: target.code, fullName: fullName.trim(), statement: statement.trim() },
                      {
                        onSuccess: () => setDone("Declined — recorded as an accepted risk against your register."),
                        onError: (e) => toast.error((e as Error).message),
                      },
                    )
                  }
                >
                  {declineMutation.isPending && <Loader2 className="size-3.5 animate-spin" />}
                  Decline
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
