import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth-context";
import { useRbdDocument, useRbdVersions, useSignRbdDocument } from "@/lib/risk-register-api";
import { formatDate, formatDateTime } from "@/lib/risk-register-visuals";
import { cn } from "@/lib/utils";
import { SignaturePad } from "./SignaturePad";

/**
 * The whole-document RBD versioning + signature surface (contract pack
 * §1.5/§1.6, §6.1, #1512, wired here for #3058). Distinct from the per-line
 * accept above it: this signs the whole VERSIONED DOCUMENT as one act.
 * `GET .../versions` (version-history list), `GET .../document` (the
 * already-rendered document) and `POST .../sign` (drawn-signature capture)
 * are all wired below — no fabricated coverage, every state either comes
 * from a real response or is the contract pack's own honest-empty copy.
 */
export function RiskDocumentPanel({ rbdId, open }: { rbdId: string; open: boolean }) {
  const { data: versions, isLoading, isError } = useRbdVersions(rbdId, open);
  const [showDocModal, setShowDocModal] = useState(false);

  const current = versions?.[0];
  const needsDocSign = !!current && current.requiresSignature && !current.signed;

  return (
    <div className="rounded-lg border border-border/70 bg-muted/10">
      <div className="flex items-baseline gap-2.5 border-b border-border/60 px-3.5 py-2.5">
        <span className="text-xs font-semibold text-foreground">Signed document</span>
        <span className="text-[10.5px] text-muted-foreground">
          {isLoading
            ? "loading…"
            : versions && versions.length > 0
              ? `${versions.length} version${versions.length === 1 ? "" : "s"}`
              : "not prepared"}
        </span>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 px-3.5 py-4 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Reading document history…
        </div>
      )}

      {isError && (
        <div className="px-3.5 py-4 text-xs text-status-red">
          This document's version history could not be read.
        </div>
      )}

      {!isLoading && !isError && versions && versions.length === 0 && (
        <div className="flex flex-col gap-1 px-3.5 py-3.5">
          <span className="text-xs font-semibold text-foreground">No document prepared yet</span>
          <span className="max-w-[600px] text-[11.5px] leading-relaxed text-muted-foreground">
            The full risk decision document is prepared by your MSP, never generated on request
            from here — so it always carries a real author. Until they prepare it, there is
            nothing to read or sign as a whole.
          </span>
        </div>
      )}

      {!isLoading && !isError && versions && versions.length > 0 && (
        <div className="flex flex-col">
          {versions.map((v) => {
            const badge = v.signed
              ? { label: "Signed", className: "text-status-green border-status-green/30 bg-status-green/10" }
              : v.signatureInherited
                ? { label: "Carried forward", className: "text-status-blue border-status-blue/30 bg-status-blue/10" }
                : v.requiresSignature
                  ? { label: "Needs signing", className: "text-status-amber border-status-amber/30 bg-status-amber/10" }
                  : { label: "Not signed", className: "text-muted-foreground border-border" };
            const note = v.signed
              ? v.signatureInherited
                ? "Scope narrowed only, so the prior version's signature carried forward."
                : "Signed."
              : v.requiresSignature
                ? "Scope widened — this version needs a fresh signature."
                : "Not yet signed.";
            return (
              <div
                key={v.versionUid}
                className="flex items-center gap-3 border-b border-border/40 px-3.5 py-2.5 last:border-b-0"
              >
                <span className="w-[70px] flex-none text-[11.5px] font-semibold text-foreground">
                  Version {v.versionNumber}
                </span>
                <Badge variant="outline" className={cn("flex-none", badge.className)}>
                  {badge.label}
                </Badge>
                <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{note}</span>
                <span className="flex-none whitespace-nowrap text-[11px] text-muted-foreground">
                  {formatDate(v.createdAt)}
                </span>
              </div>
            );
          })}

          {needsDocSign && (
            <div className="flex flex-wrap items-center gap-3 px-3.5 py-3">
              <span className="max-w-[520px] text-[11.5px] leading-relaxed text-muted-foreground">
                The current version widened what it covers, so it needs a fresh signature. A
                version that only narrowed its scope carries the previous signature forward
                instead of asking again.
              </span>
              <Button
                size="sm"
                className="ml-auto"
                onClick={() => setShowDocModal(true)}
                data-testid={`rbd-read-sign-${rbdId}`}
              >
                Read and sign the document
              </Button>
            </div>
          )}
        </div>
      )}

      {current && (
        <RbdDocumentSignModal
          rbdId={rbdId}
          versionUid={current.versionUid}
          versionNumber={current.versionNumber}
          open={showDocModal}
          onOpenChange={setShowDocModal}
        />
      )}
    </div>
  );
}

function RbdDocumentSignModal({
  rbdId,
  versionUid,
  versionNumber,
  open,
  onOpenChange,
}: {
  rbdId: string;
  versionUid: string;
  versionNumber: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { user } = useAuth();
  const { data: document, isLoading, isError } = useRbdDocument(rbdId, versionUid, open);
  const signMutation = useSignRbdDocument();

  const [signerName, setSignerName] = useState(user?.name ?? "");
  const [signerTitle, setSignerTitle] = useState("");
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const canSubmit = signerName.trim().length >= 2 && signatureData !== null && !signMutation.isPending;

  function reset() {
    setSignerName(user?.name ?? "");
    setSignerTitle("");
    setSignatureData(null);
    setConfirmOpen(false);
    signMutation.reset();
  }

  function handleClose(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  function handleSign() {
    setConfirmOpen(false);
    signMutation.mutate(
      {
        rbdId,
        versionUid,
        body: {
          signerName: signerName.trim(),
          signerTitle: signerTitle.trim() || undefined,
          signatureData: signatureData as string,
        },
      },
      {
        onSuccess: () => {
          reset();
          onOpenChange(false);
        },
      },
    );
  }

  if (confirmOpen) {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Sign version {versionNumber} as {signerName.trim()}?
            </DialogTitle>
            <DialogDescription>
              This document is recorded as signed the moment you confirm, along with your drawn
              signature, name, and the time and IP address of this action. It cannot be undone
              from here.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Back
            </Button>
            <Button onClick={handleSign} data-testid={`rbd-sign-confirm-${rbdId}`}>
              Confirm signature
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-[720px]">
        <DialogHeader>
          <DialogTitle>Version {versionNumber} — sign the whole document</DialogTitle>
          <DialogDescription>
            This signs the current version of the risk decision document as one act, separately
            from the per-line acceptances above. Read the document below, then draw your
            signature to sign it.
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Reading the prepared document…
          </div>
        )}

        {isError && (
          <p className="text-[11.5px] leading-relaxed text-status-red">
            The document could not be read. Try again in a moment.
          </p>
        )}

        {!isLoading && !isError && document === null && (
          <p className="text-[11.5px] leading-relaxed text-status-amber" data-testid="rbd-document-not-prepared">
            This document has not been prepared yet.
          </p>
        )}

        {!isLoading && !isError && document && (
          <div className="flex flex-col gap-4">
            <iframe
              title={`Risk decision document, version ${versionNumber}`}
              srcDoc={document.htmlContent}
              sandbox=""
              className="h-[360px] w-full rounded-md border border-border/70 bg-white"
              data-testid="rbd-document-frame"
            />
            <span className="text-[10.5px] text-muted-foreground">
              Prepared {formatDateTime(document.generatedAt)}.
            </span>

            <div className="flex flex-col gap-3 border-t border-border/60 pt-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="rbd-signer-name" className="text-[11px] text-muted-foreground">
                  Your full name
                </Label>
                <Input
                  id="rbd-signer-name"
                  value={signerName}
                  onChange={(e) => setSignerName(e.target.value)}
                  placeholder="Type your full name to sign this document"
                  disabled={signMutation.isPending}
                  data-testid="rbd-signer-name"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="rbd-signer-title" className="text-[11px] text-muted-foreground">
                  Your title (optional)
                </Label>
                <Input
                  id="rbd-signer-title"
                  value={signerTitle}
                  onChange={(e) => setSignerTitle(e.target.value)}
                  disabled={signMutation.isPending}
                  data-testid="rbd-signer-title"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-[11px] text-muted-foreground">Signature</Label>
                <SignaturePad onChange={setSignatureData} disabled={signMutation.isPending} />
              </div>
              {signMutation.isError && (
                <p className="text-[11.5px] text-status-red">
                  {signMutation.error instanceof Error ? signMutation.error.message : "Signing failed."}
                </p>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)}>
            Close
          </Button>
          {document && (
            <Button
              disabled={!canSubmit}
              onClick={() => setConfirmOpen(true)}
              data-testid={`rbd-sign-submit-${rbdId}`}
            >
              {signMutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : "Sign document"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
