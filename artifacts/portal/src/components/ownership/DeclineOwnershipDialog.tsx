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
import { Textarea } from "@/components/ui/textarea";
import { useDeclineOwnership } from "@/lib/ownership-api";
import type { OwnRoleKey } from "@/lib/ownership-types";

export interface DeclineTarget {
  readonly objectId: string;
  readonly objectName: string;
  readonly roleKey: OwnRoleKey;
  readonly roleWord: string;
  readonly ownerPersonId: string;
}

/**
 * The customer-side decline (§1b, `POST /portal/ownership/decline`, #1519).
 * `reason` is optional here on purpose — a customer-side decline escalates to
 * whoever assigned the cell (`notifyOwnershipDeclined`) rather than requiring
 * a reason up front — but real words help whoever reads it later, so the
 * field is offered, not demanded.
 */
export function DeclineOwnershipDialog({
  target,
  onOpenChange,
}: {
  target: DeclineTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [reason, setReason] = useState("");
  const declineMutation = useDeclineOwnership();

  const handleSubmit = () => {
    if (!target) return;
    declineMutation.mutate(
      { objectId: target.objectId, roleKey: target.roleKey, ownerPersonId: target.ownerPersonId, reason: reason.trim() || undefined },
      {
        onSuccess: () => {
          setReason("");
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Dialog
      open={!!target}
      onOpenChange={(next) => {
        if (!declineMutation.isPending) {
          if (!next) setReason("");
          onOpenChange(next);
        }
      }}
    >
      <DialogContent closeDisabled={declineMutation.isPending}>
        <DialogHeader>
          <DialogTitle>
            Decline {target?.roleWord.toLowerCase()} on {target?.objectName}
          </DialogTitle>
          <DialogDescription>
            Your words are stored with the decline and shown to whoever assigned it. This is
            recorded, not removed quietly — the cell reads as unowned until someone else takes it.
          </DialogDescription>
        </DialogHeader>

        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why this is not yours to hold (optional)"
          data-testid="ownership-decline-reason-input"
          rows={3}
        />
        {declineMutation.isError && (
          <span className="text-xs text-status-red">
            {declineMutation.error instanceof Error ? declineMutation.error.message : "That decline could not be saved."}
          </span>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={declineMutation.isPending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleSubmit}
            disabled={declineMutation.isPending}
            data-testid="ownership-decline-confirm"
          >
            {declineMutation.isPending && <Loader2 className="size-3.5 animate-spin" />}
            Confirm decline
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
