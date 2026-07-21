import { CheckCircle, Clock, DollarSign, Phone } from "lucide-react";
import { useServices, formatPriceDisplay, type PublicService } from "../hooks/useServices";
import { CTAButton } from "./CTAButton";

interface FixedPriceOfferCardProps {
  slug: string;
  variant?: "featured" | "compact";
  ctaLabel?: string;
  ctaHref?: string;
  accentColor?: string;
}

function PriceSkeleton({ variant }: { variant: "featured" | "compact" }) {
  if (variant === "compact") {
    return (
      <div className="bg-white rounded-2xl border border-border p-8 flex flex-col animate-pulse">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-gray-200" />
          <div className="h-3 w-24 bg-gray-200 rounded" />
        </div>
        <div className="h-6 w-3/4 bg-gray-200 rounded mb-3" />
        <div className="h-7 w-32 bg-gray-200 rounded mb-1" />
        <div className="h-3 w-20 bg-gray-200 rounded mb-6" />
        <div className="space-y-3 mb-8 flex-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex gap-3">
              <div className="w-4 h-4 rounded-full bg-gray-200 flex-shrink-0 mt-0.5" />
              <div className="h-3 bg-gray-200 rounded flex-1" />
            </div>
          ))}
        </div>
        <div className="h-10 bg-gray-200 rounded-xl" />
      </div>
    );
  }
  return (
    <div className="max-w-4xl mx-auto bg-white border border-border rounded-2xl overflow-hidden shadow-sm animate-pulse">
      <div className="bg-[#0A2540]/80 px-8 py-6 h-28" />
      <div className="px-8 py-8 border-b border-border">
        <div className="h-3 w-24 bg-gray-200 rounded mb-5" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex gap-3">
              <div className="w-4 h-4 rounded-full bg-gray-200 flex-shrink-0 mt-0.5" />
              <div className="h-3 bg-gray-200 rounded flex-1" />
            </div>
          ))}
        </div>
      </div>
      <div className="px-8 py-7 bg-[#0078D4]/5 h-20" />
    </div>
  );
}

function FeaturedCard({
  svc,
  ctaLabel,
  ctaHref,
}: {
  svc: PublicService;
  ctaLabel: string;
  ctaHref: string;
}) {
  const price = formatPriceDisplay(svc);
  const inclusions = svc.inclusions ?? [];
  const deliverables = svc.deliverables ?? [];

  return (
    <div className="max-w-4xl mx-auto bg-white border border-border rounded-2xl overflow-hidden shadow-sm">
      <div className="bg-[#0A2540] px-8 py-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <p className="text-white font-bold text-xl">{svc.name}</p>
          {svc.tagline && (
            <p className="text-white/50 text-sm mt-1">{svc.tagline}</p>
          )}
        </div>
        <div className="flex-shrink-0 text-right">
          <div className="flex items-center gap-1.5 justify-end">
            <DollarSign className="w-4 h-4 text-[#0078D4]" />
            <span className="text-white font-extrabold text-2xl">{price}</span>
          </div>
          {svc.turnaround && (
            <div className="flex items-center gap-1.5 justify-end mt-1">
              <Clock className="w-3.5 h-3.5 text-white/40" />
              <span className="text-white/50 text-sm">{svc.turnaround}</span>
            </div>
          )}
        </div>
      </div>

      {inclusions.length > 0 && (
        <div className="px-8 py-8 border-b border-border">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-5">
            What's Included
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {inclusions.map((item) => (
              <div key={item} className="flex items-start gap-3">
                <CheckCircle className="w-4 h-4 text-[#0078D4] flex-shrink-0 mt-0.5" />
                <span className="text-[#0A2540] text-sm leading-snug">{item}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="px-8 py-7 bg-[#0078D4]/5 flex flex-col sm:flex-row sm:items-start gap-6">
        <div className="flex-1">
          <p className="text-xs font-bold uppercase tracking-widest text-[#0078D4] mb-2">
            Deliverables
          </p>
          {deliverables.length > 0 ? (
            <ul className="space-y-1">
              {deliverables.map((d) => (
                <li key={d} className="text-[#0A2540] text-sm font-semibold leading-snug flex items-start gap-2">
                  <span className="text-[#0078D4] mt-0.5">·</span>
                  {d}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="flex flex-col gap-3 flex-shrink-0 self-center">
          <CTAButton href={ctaHref} className="whitespace-nowrap">
            {ctaLabel}
          </CTAButton>
          <a
            href="/book"
            className="inline-flex items-center justify-center gap-2 border border-[#0078D4] text-[#0078D4] font-semibold px-6 py-3 rounded hover:bg-[#0078D4]/5 transition-colors text-sm whitespace-nowrap"
          >
            <Phone className="w-4 h-4" />
            Book a Call
          </a>
        </div>
      </div>
    </div>
  );
}

function CompactCard({
  svc,
  ctaLabel,
  ctaHref,
  accentColor,
}: {
  svc: PublicService;
  ctaLabel: string;
  ctaHref: string;
  accentColor: string;
}) {
  const price = formatPriceDisplay(svc);
  const inclusions = svc.inclusions ?? [];
  const deliverables = svc.deliverables ?? [];

  return (
    <div className="bg-white rounded-2xl border border-border p-8 flex flex-col">
      <div className="flex items-center gap-3 mb-5">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: `${accentColor}1A` }}
        >
          <DollarSign className="w-5 h-5" style={{ color: accentColor }} />
        </div>
        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: accentColor }}>
          Fixed-Price Project
        </p>
      </div>

      <h3 className="text-xl font-extrabold text-[#0A2540] mb-2">{svc.name}</h3>
      <div className="mb-1">
        <span className="text-2xl font-extrabold text-[#0A2540]">{price}</span>
      </div>
      {svc.turnaround && (
        <p className="text-sm text-muted-foreground mb-6">
          {svc.turnaround} · Fixed scope
        </p>
      )}

      {svc.tagline && (
        <p className="text-muted-foreground text-sm leading-relaxed mb-6 italic">
          "{svc.tagline}"
        </p>
      )}

      {inclusions.length > 0 && (
        <ul className="space-y-3 mb-6 flex-1">
          {inclusions.map((item) => (
            <li key={item} className="flex items-start gap-3">
              <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: accentColor }} />
              <span className="text-sm text-foreground">{item}</span>
            </li>
          ))}
        </ul>
      )}

      {deliverables.length > 0 && (
        <div
          className="rounded-xl p-4 mb-6 border"
          style={{ backgroundColor: `${accentColor}0D`, borderColor: `${accentColor}33` }}
        >
          <p className="text-sm font-semibold text-[#0A2540] mb-2">You Walk Away With</p>
          <ul className="space-y-1">
            {deliverables.map((d) => (
              <li key={d} className="text-sm text-muted-foreground flex items-start gap-1.5">
                <span className="mt-0.5" style={{ color: accentColor }}>·</span>
                {d}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-2 mt-auto">
        <a
          href={ctaHref}
          className="inline-flex items-center justify-center gap-2 text-white font-semibold px-5 py-3 rounded-xl transition-colors text-sm"
          style={{ backgroundColor: accentColor }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.9")}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
        >
          {ctaLabel}
        </a>
        <a
          href="/book"
          className="inline-flex items-center justify-center gap-2 font-semibold px-5 py-3 rounded-xl transition-colors text-sm border"
          style={{ color: accentColor, borderColor: accentColor }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = `${accentColor}10`)}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
        >
          <Phone className="w-4 h-4" />
          Book a Call
        </a>
      </div>
    </div>
  );
}

export default function FixedPriceOfferCard({
  slug,
  variant = "featured",
  ctaLabel,
  ctaHref,
  accentColor = "#0078D4",
}: FixedPriceOfferCardProps) {
  const { services, loading } = useServices("micro_offer");
  const svc = services.find((s) => s.slug === slug) ?? null;

  const resolvedCtaHref = ctaHref ?? `/checkout/${slug}`;
  const resolvedCtaLabel = ctaLabel ?? "Get Started";

  if (loading) return <PriceSkeleton variant={variant} />;
  if (!svc) return null;

  if (variant === "compact") {
    return (
      <CompactCard
        svc={svc}
        ctaLabel={resolvedCtaLabel}
        ctaHref={resolvedCtaHref}
        accentColor={accentColor}
      />
    );
  }

  return (
    <FeaturedCard
      svc={svc}
      ctaLabel={resolvedCtaLabel}
      ctaHref={resolvedCtaHref}
    />
  );
}
