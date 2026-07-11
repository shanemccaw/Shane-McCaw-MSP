/**
 * Customer Offers — Customer-facing offer view
 *
 * Customers see their recommended offers in plain language. Internal scoring,
 * rule keys, engine snapshots, and signal data are never shown here.
 *
 * Customers can:
 *   - View sent/pending offers with rationale and price
 *   - Accept an offer (triggers offer.accepted canonical event → Billing/SOW task)
 *   - Reject an offer with an optional reason
 *   - See their offer history (accepted / rejected / expired)
 *
 * Real-time: subscribes to the canonical event bus via SSE at
 * /api/portal/offers/sse. Falls back to 30 s polling when SSE is unavailable.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  DollarSign,
  Gift,
  Loader2,
  RefreshCw,
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCents(cents: number): string {
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

// ── Offer card (sent / pending) ───────────────────────────────────────────────

interface SentOfferCardProps {
  offer: CustomerOffer;
  onAccept: (offer: CustomerOffer) => void;
  onReject: (offer: CustomerOffer) => void;
  submitting: boolean;
}

function SentOfferCard({ offer, onAccept, onReject, submitting }: SentOfferCardProps) {
  const expiresDays = daysUntil(offer.expiresAt);
  const isExpiring = expiresDays !== null && expiresDays >= 0 && expiresDays <= 7;

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1 flex-1">
            <div className="flex items-center gap-2">
              <Sparkles className="size-3.5 text-primary shrink-0" />
              <CardTitle className="text-base leading-snug">{offer.title}</CardTitle>
            </div>
            {offer.expiresAt && (
              <p className={`text-xs ${isExpiring ? "text-amber-400" : "text-muted-foreground"}`}>
                {expiresDays !== null && expiresDays < 0
                  ? "This offer has expired"
                  : expiresDays === 0
                  ? "Expires today"
                  : `Expires in ${expiresDays} day${expiresDays !== 1 ? "s" : ""}`}
              </p>
            )}
          </div>
          <div className="text-right shrink-0">
            <p className="text-lg font-bold text-primary">{formatCents(offer.adjustedPriceCents)}</p>
            <p className="text-xs text-muted-foreground">one-time</p>
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
            onClick={() => onAccept(offer)}
            disabled={submitting}
          >
            {submitting ? <Loader2 className="size-3.5 animate-spin" /> : <ThumbsUp className="size-3.5" />}
            Accept offer
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
  const { fetchWithAuth, accessToken } = useAuth();
  const [offers, setOffers] = useState<CustomerOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<CustomerOffer | null>(null);
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

  async function handleAccept(offer: CustomerOffer) {
    setSubmitting(true);
    try {
      const res = await fetchWithAuth(`/api/portal/offers/${offer.id}/accept`, { method: "POST" });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) { toast.error(data.error ?? "Could not accept offer"); return; }
      toast.success("Offer accepted — your service team has been notified.");
      await loadOffers(true);
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
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
                    onAccept={handleAccept}
                    onReject={(o) => setRejectTarget(o)}
                    submitting={submitting}
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

      {/* Reject dialog */}
      <RejectDialog
        open={!!rejectTarget}
        offerTitle={rejectTarget?.title ?? ""}
        onConfirm={(reason) => rejectTarget && void handleReject(rejectTarget, reason)}
        onCancel={() => setRejectTarget(null)}
        submitting={submitting}
      />
    </AppShell>
  );
}
