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
import { useAddOwnershipRow } from "@/lib/ownership-api";

/**
 * "Add a row" (§1b, `POST /portal/ownership/rows`, `source: "custom"`). A row
 * added here holds cells exactly like a live one — it does not create the
 * underlying object, and no cell is filled in automatically (the design's
 * own copy, carried verbatim).
 */
export function AddOwnershipRowDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [name, setName] = useState("");
  const [objType, setObjType] = useState("");
  const [sub, setSub] = useState("");
  const addRowMutation = useAddOwnershipRow();

  const trimmedName = name.trim();
  const trimmedType = objType.trim();
  const canSubmit = trimmedName.length > 0 && trimmedType.length > 0 && !addRowMutation.isPending;

  const reset = () => {
    setName("");
    setObjType("");
    setSub("");
  };

  const handleSubmit = () => {
    if (!canSubmit) return;
    addRowMutation.mutate(
      { rowId: `custom-${crypto.randomUUID()}`, objType: trimmedType, name: trimmedName, sub: sub.trim() || undefined },
      {
        onSuccess: () => {
          reset();
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!addRowMutation.isPending) {
          if (!next) reset();
          onOpenChange(next);
        }
      }}
    >
      <DialogContent closeDisabled={addRowMutation.isPending}>
        <DialogHeader>
          <DialogTitle>Add a row</DialogTitle>
          <DialogDescription>
            A row you add holds cells exactly like a live one. It does not create the underlying
            object, and no cell is filled in for you.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ownership-add-row-name">Row name</Label>
            <Input
              id="ownership-add-row-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Conditional Access baseline"
              data-testid="ownership-add-row-name-input"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ownership-add-row-type">Type</Label>
            <Input
              id="ownership-add-row-type"
              value={objType}
              onChange={(e) => setObjType(e.target.value)}
              placeholder="workload · service · change request · hold · control"
              data-testid="ownership-add-row-type-input"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ownership-add-row-sub">
              Sub-line <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="ownership-add-row-sub"
              value={sub}
              onChange={(e) => setSub(e.target.value)}
              placeholder="What this row is, in one line"
              data-testid="ownership-add-row-sub-input"
            />
          </div>
          {addRowMutation.isError && (
            <span className="text-xs text-status-red">
              {addRowMutation.error instanceof Error ? addRowMutation.error.message : "That row could not be saved."}
            </span>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={addRowMutation.isPending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit} data-testid="ownership-add-row-submit">
            {addRowMutation.isPending && <Loader2 className="size-3.5 animate-spin" />}
            Add row
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
