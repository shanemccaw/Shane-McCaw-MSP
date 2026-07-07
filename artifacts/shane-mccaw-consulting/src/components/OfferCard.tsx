import { SharedOfferCard, formatOfferPrice, type OfferCardData } from "@workspace/offer-card";
export { resolveIcon, badgeClass, BADGE_COLORS, type OfferCardData } from "@workspace/offer-card";
import { CTAButton } from "@/components/CTAButton";
import { type PublicService } from "@/hooks/useServices";
import { AlertTriangle, Download } from "lucide-react";
import { Link } from "wouter";

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
  ctaLabel = "Buy Now",
  ctaOnClick,
  ctaDisabled,
  onDownloadOverview,
}: OfferCardProps) {
  const resolvedHref = ctaHref ?? `/crm/portal/onboarding/select?service=${offer.slug ?? ""}`;
  const priceDisplay = formatOfferPrice(offer.basePrice, offer.maxPrice);
  const hl = offer.highlighted;
  const triggers = offer.triggers ?? [];

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

  const triggersSection =
    triggers.length > 0 ? (
      <div className={`border-t pt-4 mb-4 ${hl ? "border-white/10" : "border-border"}`}>
        <p className={`text-sm font-semibold mb-2 ${hl ? "text-white/50" : "text-[#0A2540]"}`}>
          Triggered by
        </p>
        <ul className="space-y-1.5">
          {triggers.map((t, i) => (
            <li
              key={i}
              className={`flex items-start gap-2 text-sm ${hl ? "text-white/70" : "text-muted-foreground"}`}
            >
              <AlertTriangle className="w-4 h-4 text-[#00B4D8] flex-shrink-0 mt-0.5" />
              {t}
            </li>
          ))}
        </ul>
      </div>
    ) : null;

  const bookCallBtn = (
    <Link
      href="/book"
      className={`w-full flex items-center justify-center text-sm font-semibold py-2.5 rounded border transition-colors ${
        hl
          ? "border-white/30 text-white/80 hover:border-white/60 hover:text-white"
          : "border-[#0078D4]/40 text-[#0078D4] hover:border-[#0078D4] hover:bg-[#0078D4]/5"
      }`}
    >
      Book a Discovery Call
    </Link>
  );

  const cta = (
    <div>
      {triggersSection}
      <div className="flex flex-col gap-2 mt-2">
        {primaryBtn}
        {bookCallBtn}
        {downloadBtn}
        {learnMoreBtn}
      </div>
    </div>
  );

  const cardData: OfferCardData = {
    ...offer,
    targetAudience: offer.bestFor ?? offer.targetAudience,
  };

  return (
    <SharedOfferCard
      data={cardData}
      priceDisplay={priceDisplay}
      index={index}
      popLabel="Most Popular"
      cta={cta}
    />
  );
}
