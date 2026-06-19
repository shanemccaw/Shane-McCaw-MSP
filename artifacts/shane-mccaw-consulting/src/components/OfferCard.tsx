import { CheckCircle, Clock, Sparkles, Cloud, Bot, Shield, Zap, Server, Users,
  Layout as LayoutIcon, ShieldCheck, Lock, Globe, Settings, FileText,
  BarChart2, Award, Briefcase, Target, Code, Database, Monitor, Cpu,
  BookOpen, MessageSquare, Calendar, Star, type LucideIcon } from "lucide-react";
import { CTAButton } from "@/components/CTAButton";
import { type PublicService, formatPriceDisplay } from "@/hooks/useServices";

const ICON_MAP: Record<string, LucideIcon> = {
  Cloud, Bot, Shield, Zap, Server, Users, Layout: LayoutIcon, Sparkles,
  ShieldCheck, Lock, Globe, Settings, FileText, BarChart2, Award,
  Briefcase, Target, Code, Database, Monitor, Cpu, BookOpen,
  MessageSquare, Calendar, Star, CheckCircle, Clock,
};

export function resolveIcon(name: string | null, fallback: LucideIcon = Sparkles): LucideIcon {
  if (!name) return fallback;
  const pascal = name.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join("");
  return ICON_MAP[pascal] ?? ICON_MAP[name] ?? fallback;
}

export const BADGE_COLORS: Record<string, string> = {
  Popular: "bg-[#0078D4]/10 text-[#0078D4]",
  New: "bg-emerald-100 text-emerald-700",
  "Best Value": "bg-amber-100 text-amber-700",
  Featured: "bg-purple-100 text-purple-700",
};

export function badgeClass(badge: string): string {
  return BADGE_COLORS[badge] ?? "bg-[#0078D4]/10 text-[#0078D4]";
}

interface OfferCardProps {
  offer: PublicService;
  index: number;
  ctaHref?: string;
  ctaLabel?: string;
}

export function OfferCard({ offer, index, ctaHref, ctaLabel = "Get Started" }: OfferCardProps) {
  const Icon = resolveIcon(offer.iconName);
  const priceDisplay = formatPriceDisplay(offer);
  const inclusions = offer.inclusions ?? [];
  const features = offer.features ?? [];
  const billingLabel = offer.billingType === "recurring_monthly" ? "Monthly retainer" : "One-time";
  const resolvedHref = ctaHref ?? `/crm/portal/onboarding/select?service=${offer.slug ?? ""}`;

  return (
    <div
      className="bg-white rounded-xl border border-border p-8 flex flex-col hover:shadow-lg hover:-translate-y-1 transition-all duration-300"
      data-testid={`offer-card-${index}`}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="w-11 h-11 rounded-lg bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0">
          <Icon className="w-5 h-5 text-[#0078D4]" />
        </div>
        {offer.badge && (
          <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${badgeClass(offer.badge)}`}>
            {offer.badge}
          </span>
        )}
      </div>

      {offer.category && (
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-2">
          {offer.category}
        </p>
      )}

      <p className="text-[#0078D4] text-3xl font-extrabold mb-1" data-testid={`offer-price-${index}`}>
        {priceDisplay}
      </p>

      <h3 className="text-xl font-bold text-[#0A2540] mb-1">{offer.name}</h3>

      {offer.tagline && (
        <p className="text-sm italic text-muted-foreground mb-3">{offer.tagline}</p>
      )}

      {offer.description && (
        <p className="text-sm text-foreground leading-relaxed mb-4">{offer.description}</p>
      )}

      <div className="flex flex-wrap gap-3 mb-4">
        {offer.turnaround && (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground bg-[#F7F9FC] px-3 py-1.5 rounded-full border border-border">
            <Clock className="w-3.5 h-3.5 text-[#0078D4]" />
            {offer.turnaround}
          </span>
        )}
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground bg-[#F7F9FC] px-3 py-1.5 rounded-full border border-border">
          {billingLabel}
        </span>
      </div>

      {offer.targetAudience && (
        <p className="text-sm text-muted-foreground italic mb-4">
          <span className="font-semibold not-italic text-[#0A2540]">Best for:</span> {offer.targetAudience}
        </p>
      )}

      {offer.deliverables && (
        <div className="mb-4">
          <p className="text-sm font-semibold text-[#0A2540] mb-1.5">Deliverables:</p>
          <ul className="space-y-1">
            {offer.deliverables.split("\n").filter(line => line.trim()).map((line, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#0078D4] flex-shrink-0" />
                {line.trim()}
              </li>
            ))}
          </ul>
        </div>
      )}

      {inclusions.length > 0 && (
        <div className="border-t border-border pt-4 mb-4">
          <p className="text-sm font-semibold text-[#0A2540] mb-3">What's Included:</p>
          <ul className="space-y-2">
            {inclusions.map((item, j) => (
              <li key={j} className="flex items-start gap-2 text-sm text-foreground" data-testid={`offer-${index}-inclusion-${j}`}>
                <CheckCircle className="w-4 h-4 text-[#0078D4] flex-shrink-0 mt-0.5" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      {features.length > 0 && features !== offer.inclusions && (
        <div className="border-t border-border pt-4 mb-4">
          <p className="text-sm font-semibold text-[#0A2540] mb-3">Features:</p>
          <ul className="space-y-1.5">
            {features.map((item, j) => (
              <li key={j} className="flex items-start gap-2 text-sm text-muted-foreground" data-testid={`offer-${index}-feature-${j}`}>
                <span className="w-1.5 h-1.5 rounded-full bg-[#0078D4] flex-shrink-0 mt-1.5" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex-grow" />

      <CTAButton
        href={resolvedHref}
        className="w-full justify-center text-sm mt-6"
        data-testid={`offer-cta-${index}`}
      >
        {ctaLabel}
      </CTAButton>
    </div>
  );
}
