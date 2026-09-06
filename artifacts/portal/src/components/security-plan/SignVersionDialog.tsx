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
import { useSignSecurityPlanVersion } from "@/lib/security-plan-api";

/**
 * The customer's own sign action (#2949's backend, wired here at #3027).
 * Signing never edits plan content — it only attaches a signature to the
 * already-sealed version (contract pack §2.1/§2.4). `email` is never
 * collected here: the server derives it from the authenticated session.
 */
export function SignVersionDialog({
  open,
  onOpenChange,
  versionUid,
  versionLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  versionUid: string;
  versionLabel: string;
}) {
  const [fullName, setFullName] = useState("");
  const [title, setTitle] = useState("");
  const signMutation = useSignSecurityPlanVersion();

  const trimmedName = fullName.trim();
  const canSubmit = trimmedName.length >= 2 && !signMutation.isPending;

  const handleSubmit = () => {
    if (!canSubmit) return;
    signMutation.mutate(
      { versionUid, body: { fullName: trimmedName, title: title.trim() || undefined } },
      {
        onSuccess: () => {
          setFullName("");
          setTitle("");
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!signMutation.isPending) onOpenChange(next);
      }}
    >
      <DialogContent closeDisabled={signMutation.isPending}>
        <DialogHeader>
          <DialogTitle>Sign {versionLabel}</DialogTitle>
          <DialogDescription>
            Signing records that you have reviewed this sealed version. It does not change
            anything in the plan — content is fixed the moment a version is sealed.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="security-plan-sign-name">Your full name</Label>
            <Input
              id="security-plan-sign-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Jane Doe"
              data-testid="security-plan-sign-name-input"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="security-plan-sign-title">
              Title <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="security-plan-sign-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. IT Director"
              data-testid="security-plan-sign-title-input"
            />
          </div>
          {signMutation.isError && (
            <span className="text-xs text-status-red">
              {signMutation.error instanceof Error ? signMutation.error.message : "Could not sign this version."}
            </span>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={signMutation.isPending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit} data-testid="security-plan-sign-submit">
            {signMutation.isPending && <Loader2 className="size-3.5 animate-spin" />}
            Sign this version
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
