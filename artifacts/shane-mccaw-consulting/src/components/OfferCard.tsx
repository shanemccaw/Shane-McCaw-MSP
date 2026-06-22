import { SharedOfferCard, formatOfferPrice, type OfferCardData } from "@workspace/offer-card";
export { resolveIcon, badgeClass, BADGE_COLORS, type OfferCardData } from "@workspace/offer-card";
import { CTAButton } from "@/components/CTAButton";
import { type PublicService } from "@/hooks/useServices";
import { Download } from "lucide-react";

interface OfferCardProps {
  offer: PublicService;
  index: number;
  ctaHref?: string;
  ctaLabel?: string;
  ctaOnClick?: () => void;
  ctaDisabled?: boolean;
  onDownloadOverview?: () => void;
}

export function OfferCard({
  offer,
  index,
  ctaHref,
  ctaLabel = "Get Started",
  ctaOnClick,
  ctaDisabled,
  onDownloadOverview,
}: OfferCardProps) {
  const resolvedHref = ctaHref ?? `/crm/portal/onboarding/select?service=${offer.slug ?? ""}`;
  const priceDisplay = formatOfferPrice(offer.basePrice, offer.maxPrice);
  const hl = offer.highlighted;

  const learnMoreBtn = offer.pageHref ? (
    <div className="text-center">
      <a
        href={offer.pageHref}
        className={`text-sm font-medium hover:underline transition-colors ${
          hl ? "text-[#00B4D8] hover:text-white" : "text-[#0078D4] hover:text-[#005A9E]"
        }`}
      >
        Learn More →
      </a>
    </div>
  ) : null;

  const primaryBtn = ctaOnClick ? (
    <button
      onClick={ctaOnClick}
      disabled={ctaDisabled}
      className="w-full flex items-center justify-center gap-2 bg-[#0078D4] hover:bg-[#006BBE] disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-semibold py-2.5 rounded transition-colors"
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
      className="w-full justify-center text-sm"
      data-testid={`offer-cta-${index}`}
    >
      {ctaLabel}
    </CTAButton>
  );

  const downloadBtn =
    offer.hasPdf && onDownloadOverview ? (
      <button
        type="button"
        onClick={onDownloadOverview}
        className="w-full flex items-center justify-center gap-1.5 text-[#0078D4] text-sm font-medium border border-[#0078D4]/30 py-2 rounded hover:bg-[#0078D4]/5 transition-colors"
      >
        <Download className="w-4 h-4" /> Download Overview
      </button>
    ) : null;

  const cta = (
    <div className="flex flex-col gap-2 mt-6">
      {primaryBtn}
      {downloadBtn}
      {learnMoreBtn}
    </div>
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
