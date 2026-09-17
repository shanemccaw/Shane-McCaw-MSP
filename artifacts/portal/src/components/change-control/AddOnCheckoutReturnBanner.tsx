/**
 * AddOnCheckoutReturnBanner — the real return states from Stripe Checkout for
 * an add-on purchase (#4487, on top of #4462's endpoints):
 *
 *   ?addOnCheckout=success&session_id=cs_... → server-verify via
 *     POST /api/portal/add-ons/checkout-confirmed, then show confirmed/failed.
 *   ?addOnCheckout=cancelled → an honest cancelled state, nothing charged.
 *
 * Confirmation is fired at most once per landed session id (a React 18
 * double-effect or a re-render must not double-submit), and the query string
 * is stripped once the outcome is known so a refresh doesn't replay it.
 */
import { useEffect, useRef, useState } from "react";
import { useSearch } from "wouter";
import { AlertCircle, CheckCircle2, Info, Loader2 } from "lucide-react";
import { useConfirmAddOnCheckout } from "@/lib/portal-add-ons-api";

const REASON_COPY: Record<string, string> = {
  provisioned: "Your organisation now holds this add-on.",
  reactivated: "Your organisation's add-on entitlement has been reactivated.",
  already_active: "Your organisation already holds this add-on — nothing was double-charged.",
};

export function AddOnCheckoutReturnBanner({ onConfirmed }: { onConfirmed?: () => void }) {
  const search = useSearch();
  const confirm = useConfirmAddOnCheckout();
  const firedFor = useRef<string | null>(null);

  // Captured once from the URL that landed us here, then held in state —
  // stripping the query string (below) must not also erase the only signal
  // this component renders from, or the confirmed/failed outcome it just
  // fetched would vanish the instant the URL is cleaned up.
  const [captured] = useState(() => {
    const params = new URLSearchParams(search);
    return { outcome: params.get("addOnCheckout"), sessionId: params.get("session_id") };
  });
  const { outcome, sessionId } = captured;

  useEffect(() => {
    if (outcome !== "success" || !sessionId || firedFor.current === sessionId) return;
    firedFor.current = sessionId;
    confirm.mutate(sessionId, { onSuccess: () => onConfirmed?.() });
    // confirm/onConfirmed are stable across the one call this effect ever makes for a given sessionId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcome, sessionId]);

  useEffect(() => {
    if (!outcome) return;
    if (outcome === "cancelled" || confirm.isSuccess || confirm.isError) {
      window.history.replaceState(null, "", window.location.pathname);
    }
    // Runs once the real outcome resolves; re-stripping an already-clean URL is a no-op.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcome, confirm.isSuccess, confirm.isError]);

  if (!outcome) return null;

  if (outcome === "cancelled") {
    return (
      <div
        className="flex items-start gap-2.5 rounded-xl border border-dashed border-muted-foreground/35 bg-muted/10 p-3.5"
        data-testid="change-control-addon-checkout-cancelled"
      >
        <Info className="mt-0.5 size-4 flex-none text-muted-foreground" />
        <span className="text-xs leading-relaxed text-muted-foreground">
          Checkout was cancelled — nothing was charged and the add-on is not active.
        </span>
      </div>
    );
  }

  if (outcome !== "success" || !sessionId) return null;

  if (confirm.isPending || confirm.isIdle) {
    return (
      <div
        className="flex items-center gap-2.5 rounded-xl border border-border/70 bg-background/40 p-3.5 text-xs text-muted-foreground"
        data-testid="change-control-addon-checkout-confirming"
      >
        <Loader2 className="size-4 animate-spin" />
        Confirming your payment with Stripe…
      </div>
    );
  }

  if (confirm.isSuccess) {
    return (
      <div
        className="flex items-start gap-2.5 rounded-xl border border-status-green/35 bg-status-green/5 p-3.5"
        data-testid="change-control-addon-checkout-confirmed"
      >
        <CheckCircle2 className="mt-0.5 size-4 flex-none text-status-green" />
        <span className="text-xs leading-relaxed text-foreground/90">
          {REASON_COPY[confirm.data.reason] ?? "Your payment was confirmed."}
        </span>
      </div>
    );
  }

  return (
    <div
      className="flex items-start gap-2.5 rounded-xl border border-status-red/40 bg-status-red/5 p-3.5"
      data-testid="change-control-addon-checkout-failed"
    >
      <AlertCircle className="mt-0.5 size-4 flex-none text-status-red" />
      <span className="text-xs leading-relaxed text-foreground/90">
        {confirm.error instanceof Error
          ? confirm.error.message
          : "We could not confirm this payment. If you were charged, contact your MSP."}
      </span>
    </div>
  );
}
