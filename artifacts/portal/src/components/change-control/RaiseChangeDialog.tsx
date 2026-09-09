/**
 * The "Raise a change request" wizard (design's inline panel, recreated as a
 * dialog). Creation is unconditional — a real change always produces a real
 * CR whether or not the change_control add-on is bought (#1168) — so this
 * dialog is offered regardless of entitlement state.
 *
 * Fields mirror `createSchema` in `portal-change-control.ts:626-656` exactly.
 * Risk, workload, status, requester and the backup flag are all decided
 * server-side on submit — nothing client-computed is sent for them.
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
import { CHANGE_CLASSES, type ChangeClass } from "@/lib/change-control-types";
import { useRaiseChangeRequest } from "@/lib/change-control-api";
import { toast } from "sonner";

export function RaiseChangeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState("");
  const [changeClass, setChangeClass] = useState<ChangeClass>("Normal");
  const [impactedUsersCount, setImpactedUsersCount] = useState("");
  const [window, setWindowLabel] = useState("");
  const [ticket, setTicket] = useState("");
  const [pre, setPre] = useState("");
  const [post, setPost] = useState("");
  const [freezeJustification, setFreezeJustification] = useState("");
  const [raised, setRaised] = useState<string | null>(null);

  const raiseMutation = useRaiseChangeRequest();

  const reset = () => {
    setTitle("");
    setTarget("");
    setChangeClass("Normal");
    setImpactedUsersCount("");
    setWindowLabel("");
    setTicket("");
    setPre("");
    setPost("");
    setFreezeJustification("");
    setRaised(null);
    raiseMutation.reset();
  };

  const handleClose = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const impactedNum = Number(impactedUsersCount);
  const valid =
    title.trim().length > 0 &&
    target.trim().length > 0 &&
    window.trim().length > 0 &&
    post.trim().length > 0 &&
    Number.isInteger(impactedNum) &&
    impactedNum >= 0;

  const submit = () => {
    raiseMutation.mutate(
      {
        title: title.trim(),
        target: target.trim(),
        window: window.trim(),
        post: post.trim(),
        pre: pre.trim() || undefined,
        ticket: ticket.trim() || undefined,
        changeClass,
        impactedUsersCount: impactedNum,
        freezeException: freezeJustification.trim() ? { justification: freezeJustification.trim() } : undefined,
      },
      {
        onSuccess: (res) => setRaised(res.code),
        onError: (e) => toast.error((e as Error).message),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Raise a change request</DialogTitle>
          <DialogDescription>
            Creation is ungated — a real change produces a real CR whether or not the add-on is
            bought.
          </DialogDescription>
        </DialogHeader>

        {raised ? (
          <div className="flex flex-col gap-2.5 rounded-xl border border-status-green/30 bg-status-green/5 p-4">
            <span className="text-[13px] font-semibold text-foreground">{raised} raised.</span>
            <span className="text-[11.5px] leading-relaxed text-muted-foreground">
              Risk and required approval stages were computed server-side; the register now shows
              this change awaiting its decision.
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-3.5">
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor="cc-title" className="text-[11px] text-muted-foreground">
                  Title <span className="text-status-amber">required</span>
                </Label>
                <Input id="cc-title" value={title} onChange={(e) => setTitle(e.target.value.slice(0, 200))} placeholder="Block legacy authentication protocols" />
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor="cc-target" className="text-[11px] text-muted-foreground">
                  Target resource <span className="text-status-amber">required</span>
                </Label>
                <Input id="cc-target" value={target} onChange={(e) => setTarget(e.target.value.slice(0, 500))} placeholder="Conditional Access — all cloud apps" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-[11px] text-muted-foreground">
                  Change class <span className="text-status-amber">required</span>
                </Label>
                <div className="flex gap-1.5">
                  {CHANGE_CLASSES.map((c) => (
                    <Button
                      key={c}
                      type="button"
                      size="sm"
                      variant={changeClass === c ? "default" : "outline"}
                      onClick={() => setChangeClass(c)}
                    >
                      {c}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cc-impacted" className="text-[11px] text-muted-foreground">
                  Impacted users <span className="text-status-amber">required</span>
                </Label>
                <Input
                  id="cc-impacted"
                  type="number"
                  min={0}
                  max={10_000_000}
                  value={impactedUsersCount}
                  onChange={(e) => setImpactedUsersCount(e.target.value)}
                  placeholder="412"
                />
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor="cc-window" className="text-[11px] text-muted-foreground">
                  Window label <span className="text-status-amber">required</span>
                </Label>
                <Input
                  id="cc-window"
                  value={window}
                  onChange={(e) => setWindowLabel(e.target.value.slice(0, 200))}
                  placeholder="Saturday maintenance window, 02:00–05:00"
                />
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor="cc-ticket" className="text-[11px] text-muted-foreground">
                  PSA ticket <span className="text-muted-foreground/70">optional</span>
                </Label>
                <Input id="cc-ticket" value={ticket} onChange={(e) => setTicket(e.target.value.slice(0, 120))} placeholder="PSA-8841" />
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor="cc-pre" className="text-[11px] text-muted-foreground">
                  Before · pre-change state <span className="text-muted-foreground/70">optional</span>
                </Label>
                <Textarea id="cc-pre" value={pre} onChange={(e) => setPre(e.target.value.slice(0, 20_000))} placeholder="Paste the current configuration" className="min-h-[62px] resize-y font-mono text-xs" />
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor="cc-post" className="text-[11px] text-muted-foreground">
                  After · proposed payload <span className="text-status-amber">required</span>
                </Label>
                <Textarea id="cc-post" value={post} onChange={(e) => setPost(e.target.value.slice(0, 20_000))} placeholder="Paste the configuration you want" className="min-h-[62px] resize-y font-mono text-xs" />
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor="cc-freeze" className="text-[11px] text-muted-foreground">
                  Freeze exception justification <span className="text-muted-foreground/70">optional — the only way through an active freeze</span>
                </Label>
                <Textarea
                  id="cc-freeze"
                  value={freezeJustification}
                  onChange={(e) => setFreezeJustification(e.target.value.slice(0, 2_000))}
                  placeholder="Why this change must go ahead during the freeze"
                  className="min-h-[52px] resize-y"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5 rounded-lg border border-border/60 bg-muted/10 p-3">
              <span className="text-[11px] font-semibold text-foreground">Decided for you on submit — not fields on this form</span>
              <span className="text-[11px] leading-relaxed text-muted-foreground">
                Risk and workload are computed server-side from what you typed; status is always{" "}
                <b className="font-semibold text-foreground">Pending approval</b>. Three checks run
                on the server before anything is written: an active freeze refuses the change
                unless you include a justification, a booked span must sit entirely inside a
                maintenance window when your policy enforces it, and a span overlapping another
                open change on the same target is refused outright.
              </span>
            </div>
            {raiseMutation.isError && <p className="text-[12.5px] text-destructive">{(raiseMutation.error as Error).message}</p>}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)}>
            {raised ? "Close" : "Cancel"}
          </Button>
          {!raised && (
            <Button disabled={!valid || raiseMutation.isPending} onClick={submit}>
              {raiseMutation.isPending && <Loader2 className="size-3.5 animate-spin" />}
              Raise the change
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
