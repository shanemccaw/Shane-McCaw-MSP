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
import { useRbdVersions } from "@/lib/risk-register-api";
import { formatDate } from "@/lib/risk-register-visuals";
import { cn } from "@/lib/utils";

/**
 * The whole-document RBD versioning surface (contract pack §1.5/§6.1, #1512).
 * Distinct from the per-line accept above it: this signs the whole VERSIONED
 * DOCUMENT as one act. `GET .../versions` is real and wired here. The
 * document render + drawn-signature capture UI (`GET .../document`,
 * `POST .../sign`) is a separate, larger surface (a rendered document view
 * plus a signature pad) not yet built — flagged honestly below rather than
 * silently omitted, matching this module's own "no fabricated coverage" rule.
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
              <Button size="sm" className="ml-auto" onClick={() => setShowDocModal(true)}>
                Read and sign the document
              </Button>
            </div>
          )}
        </div>
      )}

      <Dialog open={showDocModal} onOpenChange={setShowDocModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Signing the whole document</DialogTitle>
            <DialogDescription>
              This signs the current version of the risk decision document as one act, separately
              from the per-line acceptances above. It needs your drawn signature, so it opens the
              document view rather than completing here.
            </DialogDescription>
          </DialogHeader>
          <p className="text-[11.5px] leading-relaxed text-status-amber">
            The document viewer for this flow is not wired into the portal yet. The endpoint
            behind it is live, and refuses a version that has been superseded or already signed.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDocModal(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
