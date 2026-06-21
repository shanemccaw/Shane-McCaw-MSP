import { SharedOfferCard, formatOfferPrice, type OfferCardData } from "@workspace/offer-card";
export { resolveIcon, badgeClass, BADGE_COLORS, type OfferCardData } from "@workspace/offer-card";
import { CTAButton } from "@/components/CTAButton";
import { type PublicService } from "@/hooks/useServices";

interface OfferCardProps {
  offer: PublicService;
  index: number;
  ctaHref?: string;
  ctaLabel?: string;
  ctaOnClick?: () => void;
  ctaDisabled?: boolean;
}

export function OfferCard({
  offer,
  index,
  ctaHref,
  ctaLabel = "Get Started",
  ctaOnClick,
  ctaDisabled,
}: OfferCardProps) {
  const resolvedHref = ctaHref ?? `/crm/portal/onboarding/select?service=${offer.slug ?? ""}`;
  const priceDisplay = formatOfferPrice(offer.basePrice, offer.maxPrice);

  const cta = ctaOnClick ? (
    <button
      onClick={ctaOnClick}
      disabled={ctaDisabled}
      className="w-full flex items-center justify-center gap-2 bg-[#0078D4] hover:bg-[#006BBE] disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-semibold py-2.5 rounded transition-colors mt-6"
      data-testid={`offer-cta-${index}`}
    >
      {ctaDisabled ? (
        <>
          <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          Processing…
        </>
      ) : (
        ctaLabel
      )}
    </button>
  ) : (
    <CTAButton
      href={resolvedHref}
      className="w-full justify-center text-sm mt-6"
      data-testid={`offer-cta-${index}`}
    >
      {ctaLabel}
    </CTAButton>
  );

  return (
    <SharedOfferCard
      data={offer as OfferCardData}
      priceDisplay={priceDisplay}
      index={index}
      popLabel="Most Popular"
      cta={cta}
    />
  );
}
