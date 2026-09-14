/**
 * Public MSP SOW viewer and signer (#4001, Feature #1663).
 * Route: /sow/:shareToken — no authentication.
 *
 * Wired to `GET /api/public/sows/:shareToken` and
 * `POST /api/public/sows/:shareToken/sign` (contract pack §3–§4).
 * `signatureData` is never returned by the server (withheld deliberately) —
 * there is nothing to draw for an already-signed SOW beyond the recorded
 * signer name and timestamp. Two expiries are kept apart per the pack: the
 * share link's own 30-day `shareTokenExpiresAt` (checked server-side, not in
 * the response body — a 410 on GET means the link itself, not the SOW), and
 * the SOW's own lifecycle `expiresAt` (returned, drives the "expired" state
 * on this page).
 */
import { useCallback, useEffect, useState } from "react";
import { useParams } from "wouter";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SignaturePad } from "@/components/risk-register/SignaturePad";
import { PublicShareShell } from "@/components/public-share/PublicShareShell";
import { fetchPublicSow, signPublicSow, ShareFetchError } from "@/lib/public-share-api";
import type { PublicMspSow } from "@/lib/public-share-types";

const GONE_COPY: Record<"expired" | "not_found", { title: string; body: string; code: string }> = {
  expired: {
    title: "SOW not found or link has expired",
    body: "Share links to a statement of work last 30 days. The document itself may still be live on the provider's side; ask them to send a fresh link.",
    code: "410 · share link expired",
  },
  not_found: {
    title: "SOW not found or link has expired",
    body: "This link doesn't exist. Ask your provider to resend it.",
    code: "404",
  },
};

function formatUsd(cents: number, currency: string): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: currency.toUpperCase() });
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function MspSowPublicPage() {
  const { shareToken } = useParams<{ shareToken: string }>();
  const [sow, setSow] = useState<PublicMspSow | null>(null);
  const [loading, setLoading] = useState(true);
  const [gone, setGone] = useState<"expired" | "not_found" | null>(null);
  const [signerName, setSignerName] = useState("");
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);

  const load = useCallback(async () => {
    if (!shareToken) {
      setGone("not_found");
      return;
    }
    try {
      const data = await fetchPublicSow(shareToken);
      setSow(data);
      setGone(null);
    } catch (e) {
      setGone(e instanceof ShareFetchError && e.kind === "expired" ? "expired" : "not_found");
    }
  }, [shareToken]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  async function handleSign() {
    if (!shareToken) return;
    if (signerName.trim().length < 1) {
      toast.error("Please enter your full name before signing.");
      return;
    }
    if (!signatureData) {
      toast.error("Please draw your signature before signing.");
      return;
    }
    setSigning(true);
    try {
      await signPublicSow(shareToken, signerName.trim(), signatureData);
      toast.success("Statement of work signed. Your provider has been notified.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to sign. Please try again.");
    } finally {
      setSigning(false);
    }
  }

  if (loading) {
    return (
      <PublicShareShell topLine="Shared statement of work · no sign-in needed">
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      </PublicShareShell>
    );
  }

  if (gone || !sow) {
    const copy = GONE_COPY[gone ?? "not_found"];
    return (
      <PublicShareShell topLine="Shared link">
        <div className="flex w-[720px] max-w-full flex-col gap-2 rounded-2xl border border-white/[.09] bg-white/[.02] p-6">
          <span className="text-lg font-bold tracking-tight text-foreground">{copy.title}</span>
          <span className="text-[12.5px] leading-relaxed text-muted-foreground">{copy.body}</span>
          <span className="pt-1 font-mono text-[11px] text-muted-foreground/70">{copy.code}</span>
        </div>
      </PublicShareShell>
    );
  }

  const canSign = sow.status === "sent" || sow.status === "draft";
  const alreadySigned = sow.status === "signed" || sow.status === "paid";
  const isExpired = sow.status === "expired";
  const isFailed = sow.status === "failed";

  const statusBadge: Record<string, { label: string; className: string }> = {
    draft: { label: "Awaiting signature", className: "bg-status-amber/10 text-status-amber border-status-amber/30" },
    sent: { label: "Awaiting signature", className: "bg-status-amber/10 text-status-amber border-status-amber/30" },
    signed: { label: "Signed", className: "bg-status-green/10 text-status-green border-status-green/30" },
    paid: { label: "Paid & confirmed", className: "bg-status-green/10 text-status-green border-status-green/30" },
    expired: { label: "Expired", className: "bg-muted text-muted-foreground border-border" },
    failed: { label: "Failed", className: "bg-destructive/10 text-destructive border-destructive/30" },
  };
  const badge = statusBadge[sow.status];

  return (
    <PublicShareShell topLine="Shared statement of work · no sign-in needed">
      <div className="flex w-[720px] max-w-full flex-col gap-3.5 rounded-2xl border border-white/[.09] bg-white/[.02] p-6">
        <div className="flex flex-wrap items-start gap-2.5">
          <div className="flex min-w-[220px] flex-1 flex-col gap-0.5">
            <span className="text-[11px] font-semibold tracking-widest text-status-blue uppercase">
              Statement of work
            </span>
            <span className="text-xl font-bold tracking-tight text-foreground">{sow.title}</span>
            {sow.description && (
              <span className="text-xs leading-relaxed text-muted-foreground">{sow.description}</span>
            )}
          </div>
          <Badge variant="outline" className={`shrink-0 text-[10px] font-semibold ${badge.className}`}>
            {badge.label}
          </Badge>
        </div>

        <div className="flex flex-wrap items-baseline gap-3 border-t border-white/[.07] pt-3">
          {sow.amountCents > 0 && (
            <span className="text-2xl font-bold tracking-tight tabular-nums text-foreground">
              {formatUsd(sow.amountCents, sow.currency)}
            </span>
          )}
          <span className="text-[11px] text-muted-foreground/70">
            {sow.currency.toUpperCase()}
            {sow.expiresAt && !alreadySigned && !isExpired ? ` · open for signature until ${formatDate(sow.expiresAt)}` : ""}
            {isExpired && sow.expiresAt ? ` · lapsed on ${formatDate(sow.expiresAt)}` : ""}
            {alreadySigned && sow.expiresAt ? ` · valid for payment until ${formatDate(sow.expiresAt)}` : ""}
          </span>
        </div>

        {sow.documentHtml && (
          <div className="overflow-hidden rounded-xl border border-white/[.07]">
            <iframe
              srcDoc={sow.documentHtml}
              title="Statement of Work"
              className="h-[420px] w-full border-0 bg-white"
              sandbox="allow-same-origin"
            />
          </div>
        )}

        {sow.customerAgreementText && (
          <div className="flex flex-col gap-1 border-l-2 border-muted-foreground/30 py-0.5 pl-3">
            <span className="text-[9px] font-bold tracking-widest text-muted-foreground/70 uppercase">
              Customer agreement · as written when this SOW was created
            </span>
            <span className="text-[11.5px] leading-relaxed text-muted-foreground">{sow.customerAgreementText}</span>
          </div>
        )}

        {canSign && (
          <div className="flex flex-col gap-2.5 border-t border-white/[.07] pt-3">
            <span className="text-[9px] font-bold tracking-widest text-muted-foreground/70 uppercase">
              Sign · your full name and a drawn signature
            </span>
            <input
              type="text"
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
              placeholder="Your full legal name"
              className="w-full rounded-md border border-white/[.12] bg-white/[.02] px-3 py-2.5 text-[12.5px] text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
              disabled={signing}
            />
            <SignaturePad onChange={setSignatureData} disabled={signing} />
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="max-w-[420px] text-[11px] leading-relaxed text-muted-foreground/70">
                No sign-in is needed — the link is the credential. Your name, signature, the time and
                your network address are recorded, and the signing is attributed to "customer via
                share link".
              </span>
              <Button className="ml-auto gap-2 whitespace-nowrap" onClick={() => void handleSign()} disabled={signing}>
                {signing ? <Loader2 className="size-4 animate-spin" /> : null}
                Sign statement of work
              </Button>
            </div>
          </div>
        )}

        {alreadySigned && (
          <div className="flex flex-col gap-1 rounded-xl border border-status-green/25 bg-status-green/[.06] p-3.5">
            <span className="text-[12.5px] font-semibold text-foreground">
              Signed by {sow.signerName ?? "the customer"}
              {sow.signedAt ? ` · ${formatDate(sow.signedAt)}` : ""}
            </span>
            <span className="text-[11.5px] leading-relaxed text-muted-foreground">
              This statement of work is signed and cannot be signed again from this link. The provider
              has been notified{sow.status === "paid" ? "; payment has been received and the project is now active." : "; invoicing follows on their side."}
            </span>
          </div>
        )}

        {(isExpired || isFailed) && (
          <div className="flex flex-col gap-1 rounded-xl border border-white/[.08] p-3.5">
            <span className="text-[12.5px] font-semibold text-foreground/90">
              {isExpired ? "This SOW has expired" : "This SOW cannot be signed"}
            </span>
            <span className="text-[11.5px] leading-relaxed text-muted-foreground">
              {isExpired
                ? "Its own validity period ended before it was signed, so signing is refused and the document is now marked expired. The provider can issue a new one."
                : `SOW cannot be signed in its current status: "${sow.status}".`}
            </span>
            <span className="pt-0.5 font-mono text-[10.5px] text-muted-foreground/60">
              {isExpired ? "410 · SOW expired" : "409 · sign refused"}
            </span>
          </div>
        )}
      </div>
    </PublicShareShell>
  );
}
