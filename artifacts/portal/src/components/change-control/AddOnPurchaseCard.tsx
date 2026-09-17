/**
 * AddOnPurchaseCard — the real purchase control for a not-yet-active add-on
 * (#4487, Feature #1486), stubbed in against #4462's already-shipped
 * endpoints per Shane's stub-over-nothing authorization (no Design export
 * exists yet for this control). Visual pattern follows this page's own
 * shadcn/Tailwind idiom — the same selectable-option-list + CTA structure
 * `artifacts/shane-mccaw-consulting`'s Buy page uses for its tier picker,
 * adapted to the portal's existing tokens rather than that page's dark
 * marketing chrome.
 *
 * Shown only when the caller holds `customer:billing.manage` — anyone else
 * keeps the existing "ask your MSP" text, unchanged.
 */
import { useState } from "react";
import { AlertCircle, CreditCard, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCents } from "@/components/overview/overviewDisplay";
import { cn } from "@/lib/utils";
import { useAddOnOffers, useStartAddOnCheckout, type WireAddOnOffer } from "@/lib/portal-add-ons-api";

export function AddOnPurchaseCard({ featureKey, returnPath }: { featureKey: string; returnPath: string }) {
  const offers = useAddOnOffers();
  const startCheckout = useStartAddOnCheckout();
  const entry = offers.data?.addOns.find((a) => a.featureKey === featureKey) ?? null;
  const brackets = entry?.offers ?? [];
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const selected: WireAddOnOffer | null = brackets.find((b) => b.slug === selectedSlug) ?? brackets[0] ?? null;

  if (offers.isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="change-control-addon-purchase-loading">
        <Loader2 className="size-3.5 animate-spin" />
        Loading purchase options…
      </div>
    );
  }

  // Entitled already resolved elsewhere (register would 200), or a genuine
  // read failure, or nothing sellable for this feature key — the "ask your
  // MSP" text this control sits beside is the honest fallback for all three.
  if (offers.isError || brackets.length === 0 || entry?.entitled) return null;

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-border/70 bg-background/40 p-3.5" data-testid="change-control-addon-purchase">
      <span className="text-[12.5px] font-semibold text-foreground">Buy the change control add-on for your organisation</span>
      <span className="text-xs leading-relaxed text-muted-foreground">
        Priced by tenant size, billed monthly through Stripe. Choose the bracket that matches your seat count.
      </span>
      <div className="flex flex-col gap-1.5">
        {brackets.map((b) => {
          const isOn = selected?.slug === b.slug;
          return (
            <button
              key={b.slug ?? b.serviceId}
              type="button"
              data-testid={`change-control-addon-bracket-${b.slug}`}
              onClick={() => setSelectedSlug(b.slug)}
              className={cn(
                "flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-colors",
                isOn ? "border-primary/50 bg-primary/5" : "border-border/60 hover:bg-muted/20",
              )}
            >
              <span className="flex flex-col">
                <span className="text-[12.5px] font-medium text-foreground">
                  {b.bracketLabel ?? b.name}
                  {b.seatMin !== null ? (
                    <span className="ml-1.5 font-normal text-muted-foreground">
                      ({b.seatMin}
                      {b.seatMax !== null ? `–${b.seatMax}` : "+"} seats)
                    </span>
                  ) : null}
                </span>
              </span>
              <span className="whitespace-nowrap text-[12.5px] font-semibold text-foreground">
                {formatCents(b.priceCents)}/mo
              </span>
            </button>
          );
        })}
      </div>

      {startCheckout.isError ? (
        <div className="flex items-start gap-2 rounded-md border border-dashed border-status-red/45 bg-status-red/[0.06] p-2.5">
          <AlertCircle className="mt-0.5 size-3.5 flex-none text-status-red" />
          <span className="text-[11.5px] leading-relaxed text-foreground/90">
            {startCheckout.error instanceof Error ? startCheckout.error.message : "Could not start checkout. Please try again."}
          </span>
        </div>
      ) : null}

      <Button
        size="sm"
        className="w-fit"
        disabled={!selected || startCheckout.isPending}
        data-testid="change-control-addon-buy-button"
        onClick={() => {
          if (!selected?.slug) return;
          startCheckout.mutate(
            { serviceSlug: selected.slug, returnPath },
            { onSuccess: (data) => { window.location.href = data.url; } },
          );
        }}
      >
        {startCheckout.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <CreditCard className="size-3.5" />}
        {startCheckout.isPending ? "Starting checkout…" : `Buy ${selected ? formatCents(selected.priceCents) + "/mo" : ""}`}
      </Button>
    </div>
  );
}
