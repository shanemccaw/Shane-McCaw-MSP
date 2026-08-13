/**
 * Customer Offers — Customer-facing offer view
 *
 * Customers see their recommended offers in plain language. Internal scoring,
 * rule keys, engine snapshots, and signal data are never shown here.
 *
 * Customers can:
 *   - View sent/pending offers with rationale and price
 *   - Initiate checkout (branches by serviceClass on the server):
 *       add_on/subscription → redirected to Stripe checkout
 *       $0 free → service activated immediately (rate-limited)
 *       project → SOW created and customer sent to review/sign page
 *   - Reject an offer with an optional reason
 *   - See their offer history (accepted / rejected / expired)
 *
 * Real-time: subscribes to the canonical event bus via SSE at
 * /api/portal/offers/sse. Falls back to 30 s polling when SSE is unavailable.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  CreditCard,
  FileText,
  Gift,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CustomerOffer {
  id: number;
  title: string;
  rationale: string | null;
  adjustedPriceCents: number;
  state: string;
  expiresAt: string | null;
  sentAt: string | null;
  acceptedAt: string | null;
  closedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
}

interface PlatformAgreement {
  id: number;
  version: string;
  title: string;
  body: string;
}

type CheckoutOutcome =
  | { outcome: "checkout_required"; checkoutUrl: string; trialPeriodDays: number | null }
  | { outcome: "free_activated"; message: string }
  | { outcome: "sow_created"; sowId: string; shareUrl: string; message: string }
  | { outcome: "payment_processed"; transactionId?: string; processedAt?: string; message?: string }
  | { error: string; code?: string; requiredVersion?: string };

interface AgreementGateState {
  offer: CustomerOffer;
  agreement: PlatformAgreement | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCents(cents: number): string {
  if (cents === 0) return "Free";
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function relativeDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const diff = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return `${diff}d ago`;
  if (diff < 30) return `${Math.floor(diff / 7)}w ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const diff = Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
  return diff;
}

/**
 * Returns a live HH:MM:SS countdown string when expiresAt is within 24 hours,
 * or null otherwise. Ticks every second via setInterval.
 */
function useCountdown(expiresAt: string | null | undefined): string | null {
  const [now, setNow] = useState(() => Date.now());

  const expiresMs = useMemo(
    () => (expiresAt ? new Date(expiresAt).getTime() : null),
    [expiresAt],
  );

  const withinDay = expiresMs !== null && expiresMs - now <= 86_400_000 && expiresMs > now;

  useEffect(() => {
    if (!withinDay) return;
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [withinDay]);

  if (!withinDay || expiresMs === null) return null;

  const remaining = Math.max(0, expiresMs - now);
  const h = Math.floor(remaining / 3_600_000);
  const m = Math.floor((remaining % 3_600_000) / 60_000);
  const s = Math.floor((remaining % 60_000) / 1_000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// ── Agreement Gate Dialog ─────────────────────────────────────────────────────

interface AgreementGateDialogProps {
  open: boolean;
  state: AgreementGateState | null;
  onConfirm: (offer: CustomerOffer, agreementVersion: string) => void;
  onCancel: () => void;
  submitting: boolean;
}

function AgreementGateDialog({ open, state, onConfirm, onCancel, submitting }: AgreementGateDialogProps) {
  const [checked, setChecked] = useState(false);
  const [showBody, setShowBody] = useState(false);

  useEffect(() => {
    if (!open) {
      setChecked(false);
      setShowBody(false);
    }
  }, [open]);

  const agreement = state?.agreement ?? null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <ShieldCheck className="size-5 text-primary shrink-0" />
            <DialogTitle>Review &amp; Accept Platform Agreement</DialogTitle>
          </div>
          <DialogDescription>
            Before proceeding to payment, you must accept the platform agreement that governs
            this service.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {agreement ? (
            <>
              <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-3">
                <FileText className="size-5 text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{agreement.title}</p>
                  <p className="text-xs text-muted-foreground">Version {agreement.version}</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-xs shrink-0"
                  onClick={() => setShowBody((v) => !v)}
                >
                  {showBody ? "Hide" : "Read"}
                </Button>
              </div>

              {showBody && (
                <div className="max-h-48 overflow-y-auto rounded border border-border bg-muted/20 p-3 text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">
                  {agreement.body}
                </div>
              )}

              <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
                <Checkbox
                  id="agreement-checkbox"
                  checked={checked}
                  onCheckedChange={(v) => setChecked(v === true)}
                  className="mt-0.5 shrink-0"
                />
                <Label htmlFor="agreement-checkbox" className="text-sm leading-snug cursor-pointer">
                  I have read and agree to the{" "}
                  <span className="font-semibold text-foreground">{agreement.title}</span>{" "}
                  (version {agreement.version}).
                </Label>
              </div>
            </>
          ) : (
            <div className="rounded-lg border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
              No platform agreement is currently published. You may proceed to checkout.
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (!state) return;
              if (agreement && !checked) {
                toast.error("Please check the box to confirm you have read and accept the agreement.");
                return;
              }
              onConfirm(state.offer, agreement?.version ?? "");
            }}
            disabled={submitting || (!!agreement && !checked)}
            className="gap-1.5"
          >
            {submitting && <Loader2 className="size-4 animate-spin" />}
            {agreement ? "Accept & Proceed" : "Continue to Payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Reject Dialog ─────────────────────────────────────────────────────────────

interface RejectDialogProps {
  open: boolean;
  offerTitle: string;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
  submitting: boolean;
}

function RejectDialog({ open, offerTitle, onConfirm, onCancel, submitting }: RejectDialogProps) {
  const [reason, setReason] = useState("");

  useEffect(() => { if (!open) setReason(""); }, [open]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Decline this offer?</DialogTitle>
          <DialogDescription>
            You're about to decline "{offerTitle}". You can optionally tell us why — it helps us
            make better recommendations in the future.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5 py-2">
          <Label htmlFor="rejection-reason">Reason (optional)</Label>
          <Textarea
            id="rejection-reason"
            placeholder="e.g. Budget constraints, not a priority right now…"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={submitting}>Keep open</Button>
          <Button variant="destructive" onClick={() => onConfirm(reason)} disabled={submitting}>
            {submitting && <Loader2 className="size-4 animate-spin mr-2" />}
            Decline offer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── MSP Consent Dialog ────────────────────────────────────────────────────────

interface MspConsentDialogProps {
  open: boolean;
  offerTitle: string;
  onConfirm: () => void;
  onCancel: () => void;
  submitting: boolean;
}

function MspConsentDialog({ open, offerTitle, onConfirm, onCancel, submitting }: MspConsentDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <CreditCard className="size-5 text-primary shrink-0" />
            <DialogTitle>Managed Service Billing</DialogTitle>
          </div>
          <DialogDescription>
            You are about to accept the offer "{offerTitle}".
          </DialogDescription>
        </DialogHeader>
        <div className="py-2 text-sm text-muted-foreground">
          Any charges associated with this offer will be billed directly through your Managed Service Provider (MSP). You will not be charged directly here.
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={submitting}>
            {submitting && <Loader2 className="size-4 animate-spin mr-2" />}
            I Agree
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Receipt Dialog ────────────────────────────────────────────────────────────

interface ReceiptDialogProps {
  open: boolean;
  state: { title: string; amountCents: number; date: string; transactionId: string } | null;
  onClose: () => void;
}

function ReceiptDialog({ open, state, onClose }: ReceiptDialogProps) {
  if (!state) return null;
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle2 className="size-5 text-green-500 shrink-0" />
            <DialogTitle>Payment Processed</DialogTitle>
          </div>
          <DialogDescription>
            Your payment was successfully processed.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Service:</span>
            <span className="font-medium text-right max-w-[200px] truncate" title={state.title}>{state.title}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Amount:</span>
            <span className="font-medium">{formatCents(state.amountCents)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Date:</span>
            <span className="font-medium">{new Date(state.date).toLocaleDateString()}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Transaction ID:</span>
            <span className="font-medium text-right break-all">{state.transactionId}</span>
          </div>
        </div>
        <DialogFooter className="flex-col sm:flex-row gap-2 mt-2">
          <Button variant="outline" className="w-full sm:w-auto" onClick={() => {
            window.location.href = "/customer/billing";
          }}>
            View Receipts
          </Button>
          <Button className="w-full sm:w-auto" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Offer card (sent / pending) ───────────────────────────────────────────────

interface SentOfferCardProps {
  offer: CustomerOffer;
  onCheckout: (offer: CustomerOffer) => void;
  onReject: (offer: CustomerOffer) => void;
  submitting: boolean;
}

function SentOfferCard({ offer, onCheckout, onReject, submitting }: SentOfferCardProps) {
  const expiresDays = daysUntil(offer.expiresAt);
  const isExpiring = expiresDays !== null && expiresDays >= 0 && expiresDays <= 7;
  const countdown = useCountdown(offer.expiresAt);
  const isFree = offer.adjustedPriceCents === 0;

  return (
    <Card className={`${countdown ? "border-amber-500/40 bg-amber-500/5" : "border-primary/30 bg-primary/5"}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1 flex-1">
            <div className="flex items-center gap-2">
              <Sparkles className="size-3.5 text-primary shrink-0" />
              <CardTitle className="text-base leading-snug">{offer.title}</CardTitle>
            </div>
            {countdown ? (
              <div className="flex items-center gap-1.5">
                <Clock className="size-3 text-amber-400" />
                <p className="text-xs text-amber-400 font-mono font-semibold">
                  Offer expires in {countdown}
                </p>
              </div>
            ) : offer.expiresAt ? (
              <p className={`text-xs ${isExpiring ? "text-amber-400" : "text-muted-foreground"}`}>
                {expiresDays !== null && expiresDays < 0
                  ? "This offer has expired"
                  : expiresDays === 0
                  ? "Expires today"
                  : `Expires in ${expiresDays} day${expiresDays !== 1 ? "s" : ""}`}
              </p>
            ) : null}
          </div>
          <div className="text-right shrink-0">
            <p className="text-lg font-bold text-primary">{formatCents(offer.adjustedPriceCents)}</p>
            {isFree ? (
              <Badge variant="secondary" className="text-xs mt-0.5">Free assessment</Badge>
            ) : (
              <p className="text-xs text-muted-foreground">one-time</p>
            )}
          </div>
        </div>
      </CardHeader>
      {offer.rationale && (
        <CardContent className="pt-0 pb-3">
          <CardDescription className="text-sm leading-relaxed">{offer.rationale}</CardDescription>
        </CardContent>
      )}
      <CardContent className="pt-0 pb-4">
        <div className="flex gap-2 flex-wrap">
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => onCheckout(offer)}
            disabled={submitting}
          >
            {submitting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : isFree ? (
              <ThumbsUp className="size-3.5" />
            ) : (
              <CreditCard className="size-3.5" />
            )}
            {isFree ? "Activate free" : "Proceed to payment"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 text-muted-foreground"
            onClick={() => onReject(offer)}
            disabled={submitting}
          >
            <ThumbsDown className="size-3.5" />
            Not right now
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── History card ──────────────────────────────────────────────────────────────

function HistoryCard({ offer }: { offer: CustomerOffer }) {
  const stateIcon = {
    accepted: <CheckCircle2 className="size-3.5 text-green-400" />,
    rejected: <XCircle className="size-3.5 text-red-400" />,
    expired: <AlertCircle className="size-3.5 text-amber-400" />,
  }[offer.state] ?? <Clock className="size-3.5 text-muted-foreground" />;

  const stateLabel = {
    accepted: "Accepted",
    rejected: "Declined",
    expired: "Expired",
  }[offer.state] ?? offer.state;

  return (
    <Card className="bg-muted/20">
      <CardContent className="py-3 px-4">
        <div className="flex items-center gap-3">
          {stateIcon}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{offer.title}</p>
            <p className="text-xs text-muted-foreground">
              {stateLabel} · {formatCents(offer.adjustedPriceCents)}
              {offer.rejectionReason && ` · "${offer.rejectionReason}"`}
            </p>
          </div>
          <p className="text-xs text-muted-foreground shrink-0">
            {relativeDate(offer.acceptedAt ?? offer.closedAt ?? offer.createdAt)}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function CustomerOffersPage() {
  const { user, fetchWithAuth, accessToken } = useAuth();
  const [offers, setOffers] = useState<CustomerOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<CustomerOffer | null>(null);
  const [agreementGateState, setAgreementGateState] = useState<AgreementGateState | null>(null);
  const [consentModal, setConsentModal] = useState<{ isOpen: boolean; offer: CustomerOffer | null }>({ isOpen: false, offer: null });
  const [receiptModal, setReceiptModal] = useState<{ isOpen: boolean; title: string; amountCents: number; date: string; transactionId: string } | null>(null);
  const [agreementLoading, setAgreementLoading] = useState(false);
  const sseRef = useRef<EventSource | null>(null);

  const loadOffers = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      else setRefreshing(true);
      try {
        const res = await fetchWithAuth("/api/portal/offers");
        if (!res.ok) return;
        const data = (await res.json()) as { offers: CustomerOffer[] };
        setOffers(data.offers ?? []);
      } catch {
        // ignore
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [fetchWithAuth],
  );

  useEffect(() => {
    void loadOffers();
  }, [loadOffers]);

  // SSE subscription — canonical event bus for real-time offer changes
  useEffect(() => {
    if (!accessToken) return;
    const url = `/api/portal/offers/sse?token=${encodeURIComponent(accessToken)}`;
    const es = new EventSource(url);

    es.onmessage = (e: MessageEvent<string>) => {
      try {
        const data = JSON.parse(e.data) as { type: string };
        if (data.type === "offer_changed") {
          void loadOffers(true);
        }
      } catch { }
    };

    es.onerror = () => {
      es.close();
      sseRef.current = null;
    };

    sseRef.current = es;
    return () => {
      es.close();
      sseRef.current = null;
    };
  }, [accessToken, loadOffers]);

  // Fallback: poll every 30 s when SSE is not connected
  useEffect(() => {
    const id = setInterval(() => {
      if (!sseRef.current || sseRef.current.readyState === EventSource.CLOSED) {
        void loadOffers(true);
      }
    }, 30_000);
    return () => clearInterval(id);
  }, [loadOffers]);

  /** Show the agreement gate dialog before paid checkout, or proceed directly for free offers. */
  async function handleCheckout(offer: CustomerOffer) {
    if (offer.adjustedPriceCents === 0) {
      // Free offer — bypass the agreement gate (server also skips the gate for this path)
      await doCheckout(offer, null);
      return;
    }

    const isMspUser = (user as any)?.role === "CustomerUser" || user?.mspRole === "CustomerUser" || (user as any)?.isManagedTenant;
    if (isMspUser) {
      setConsentModal({ isOpen: true, offer });
    } else {
      await showAgreementGate(offer);
    }
  }

  async function showAgreementGate(offer: CustomerOffer) {
    setAgreementLoading(true);
    try {
      const res = await fetchWithAuth("/api/platform/agreement/current");
      let agreement: PlatformAgreement | null = null;
      if (res.ok) {
        const data = (await res.json()) as { agreement: PlatformAgreement | null };
        agreement = data.agreement ?? null;
      }
      setAgreementGateState({ offer, agreement });
    } catch {
      // If we can't fetch the agreement, show the gate with null — server will still
      // pass through if no agreement is published.
      setAgreementGateState({ offer, agreement: null });
    } finally {
      setAgreementLoading(false);
    }
  }

  /** Execute the checkout API call with optional agreement acceptance payload. */
  async function doCheckout(offer: CustomerOffer, agreementVersion: string | null) {
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {};
      if (agreementVersion) {
        body["agreementVersion"] = agreementVersion;
        body["checkboxConfirmed"] = true;
        body["acceptedAt"] = new Date().toISOString();
      }

      const res = await fetchWithAuth(`/api/portal/offers/${offer.id}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as CheckoutOutcome;

      if (!res.ok || "error" in data) {
        const msg = "error" in data ? data.error : "Could not process your request.";
        if (res.status === 429) {
          toast.error(msg);
        } else if (res.status === 422 && "error" in data && data.code === "agreement_required") {
          // Server rejected because agreement wasn't accepted — re-open the gate
          toast.error("Please accept the platform agreement before proceeding.");
          setAgreementGateState((s) => s ?? { offer, agreement: null });
        } else {
          toast.error(msg ?? "Could not initiate checkout. Please try again.");
        }
        return;
      }

      if ("outcome" in data) {
        if (data.outcome === "checkout_required") {
          window.location.href = data.checkoutUrl;
          return;
        }

        if (data.outcome === "free_activated") {
          toast.success("Service activated — your team has been notified and will be in touch shortly.");
          await loadOffers(true);
          return;
        }

        if (data.outcome === "sow_created") {
          toast.success("Your Statement of Work is ready. Redirecting you to review and sign…");
          await loadOffers(true);
          setTimeout(() => {
            window.location.href = data.shareUrl;
          }, 1500);
          return;
        }

        if (data.outcome === "payment_processed") {
          setReceiptModal({
            isOpen: true,
            title: offer.title,
            amountCents: offer.adjustedPriceCents,
            date: data.processedAt || new Date().toISOString(),
            transactionId: data.transactionId || "N/A"
          });
          await loadOffers(true);
          return;
        }
      }

      toast.success("Offer accepted — your service team has been notified.");
      await loadOffers(true);
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
      setAgreementGateState(null);
      setConsentModal({ isOpen: false, offer: null });
    }
  }

  async function handleReject(offer: CustomerOffer, reason: string) {
    setSubmitting(true);
    try {
      const res = await fetchWithAuth(`/api/portal/offers/${offer.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rejectionReason: reason || undefined }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) { toast.error(data.error ?? "Could not decline offer"); return; }
      toast.success("Offer declined. We'll keep an eye out for better timing.");
      setRejectTarget(null);
      await loadOffers(true);
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const sentOffers = offers.filter((o) => o.state === "sent");
  const historyOffers = offers.filter((o) => o.state !== "sent");

  return (
    <AppShell title="My Offers">
      <div className="p-6 space-y-6 max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Recommended Offers</h2>
            <p className="text-muted-foreground text-sm mt-1">
              Personalised recommendations based on your Microsoft 365 environment.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => void loadOffers(true)}
            disabled={refreshing}
          >
            {refreshing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Refresh
          </Button>
        </div>

        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-52 w-full rounded-xl" />
            <Skeleton className="h-20 w-full rounded-xl" />
          </div>
        ) : (
          <>
            {/* Active offers */}
            {sentOffers.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-14 gap-3">
                  <Gift className="size-10 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">No offers right now</p>
                  <p className="text-xs text-muted-foreground/60 text-center max-w-xs">
                    We'll notify you when we have a personalised recommendation based on your
                    Microsoft 365 environment.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <div className="size-2 rounded-full bg-primary animate-pulse" />
                  <p className="text-sm font-semibold">
                    {sentOffers.length} active offer{sentOffers.length !== 1 ? "s" : ""} for you
                  </p>
                </div>
                {sentOffers.map((offer) => (
                  <SentOfferCard
                    key={offer.id}
                    offer={offer}
                    onCheckout={handleCheckout}
                    onReject={(o) => setRejectTarget(o)}
                    submitting={submitting || agreementLoading}
                  />
                ))}
              </div>
            )}

            {/* History */}
            {historyOffers.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Offer History
                </p>
                <div className="space-y-2">
                  {historyOffers.map((offer) => (
                    <HistoryCard key={offer.id} offer={offer} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Agreement gate dialog — shown before paid checkout */}
      <AgreementGateDialog
        open={!!agreementGateState}
        state={agreementGateState}
        onConfirm={(offer, agreementVersion) => void doCheckout(offer, agreementVersion || null)}
        onCancel={() => setAgreementGateState(null)}
        submitting={submitting}
      />

      {/* Reject dialog */}
      <RejectDialog
        open={!!rejectTarget}
        offerTitle={rejectTarget?.title ?? ""}
        onConfirm={(reason) => rejectTarget && void handleReject(rejectTarget, reason)}
        onCancel={() => setRejectTarget(null)}
        submitting={submitting}
      />

      {/* MSP Consent Dialog */}
      <MspConsentDialog
        open={consentModal.isOpen}
        offerTitle={consentModal.offer?.title ?? ""}
        onConfirm={() => {
          if (consentModal.offer) {
            void doCheckout(consentModal.offer, null);
          }
        }}
        onCancel={() => setConsentModal({ isOpen: false, offer: null })}
        submitting={submitting}
      />

      {/* Receipt Dialog */}
      <ReceiptDialog
        open={receiptModal?.isOpen ?? false}
        state={receiptModal}
        onClose={() => setReceiptModal(null)}
      />
    </AppShell>
  );
}
