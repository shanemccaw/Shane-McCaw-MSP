import type { ReactNode } from "react";
import {
  CheckCircle, Clock, Sparkles, Cloud, Bot, Shield, Zap, Server, Users,
  Layout as LayoutIcon, ShieldCheck, Lock, Globe, Settings, FileText,
  BarChart2, Award, Briefcase, Target, Code, Database, Monitor, Cpu,
  BookOpen, MessageSquare, Calendar, Star,
  Gavel, ArrowRightLeft, Compass, Layers, Building, GraduationCap, Hammer,
  type LucideIcon,
} from "lucide-react";

// ─── Icon resolution ──────────────────────────────────────────────────────────

const ICON_MAP: Record<string, LucideIcon> = {
  Cloud, Bot, Shield, Zap, Server, Users, Layout: LayoutIcon, Sparkles,
  ShieldCheck, Lock, Globe, Settings, FileText, BarChart2, Award,
  Briefcase, Target, Code, Database, Monitor, Cpu, BookOpen,
  MessageSquare, Calendar, Star, CheckCircle, Clock,
  Gavel, ArrowRightLeft, Compass, Layers, Building, GraduationCap, Hammer,
};

export function resolveIcon(name: string | null, fallback: LucideIcon = Sparkles): LucideIcon {
  if (!name) return fallback;
  const pascal = name.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join("");
  return ICON_MAP[pascal] ?? ICON_MAP[name] ?? fallback;
}

// ─── Badge helpers ────────────────────────────────────────────────────────────

export const BADGE_COLORS: Record<string, string> = {
  Popular: "bg-[#0078D4]/10 text-[#0078D4]",
  New: "bg-emerald-100 text-emerald-700",
  "Best Value": "bg-amber-100 text-amber-700",
  Featured: "bg-purple-100 text-purple-700",
};

export function badgeClass(badge: string): string {
  return BADGE_COLORS[badge] ?? "bg-[#0078D4]/10 text-[#0078D4]";
}

// ─── Price formatting ─────────────────────────────────────────────────────────

export function formatOfferPrice(basePrice: string | null, maxPrice: string | null): string {
  if (!basePrice) return "";
  const base = Number(basePrice);
  const max = maxPrice ? Number(maxPrice) : null;
  if (!max || max === base) return `$${base.toLocaleString()}`;
  return `$${base.toLocaleString()}–$${max.toLocaleString()}`;
}

// ─── Shared data type ─────────────────────────────────────────────────────────

export interface OfferCardData {
  id: number;
  slug: string | null;
  name: string;
  tagline: string | null;
  description: string | null;
  category: string | null;
  iconName: string | null;
  badge: string | null;
  highlighted: boolean;
  hoursPerMonth: string | null;
  turnaround: string | null;
  billingType: "one_time" | "recurring_monthly";
  targetAudience: string | null;
  deliverables: string[] | null;
  inclusions: string[] | null;
  features: string[] | null;
}

// ─── Shared card component ────────────────────────────────────────────────────

export interface SharedOfferCardProps {
  data: OfferCardData;
  priceDisplay: string;
  index: number;
  popLabel?: string;
  cta: ReactNode;
}

export function SharedOfferCard({
  data,
  priceDisplay,
  index,
  popLabel = "Most Popular",
  cta,
}: SharedOfferCardProps) {
  const Icon = resolveIcon(data.iconName);
  const inclusions = data.inclusions ?? [];
  const features = data.features ?? [];
  const deliverables = data.deliverables ?? [];
  const billingLabel = data.billingType === "recurring_monthly" ? "Monthly retainer" : "One-time";
  const hl = data.highlighted;

  return (
    <div className={hl ? "relative mt-4 h-full" : "h-full"}>
      {hl && (
        <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-[#0078D4] text-white text-xs font-bold px-5 py-1.5 rounded-full uppercase tracking-wide whitespace-nowrap z-10">
          {popLabel}
        </div>
      )}
      <div
        className={`rounded-xl border p-8 flex flex-col hover:shadow-lg hover:-translate-y-1 transition-all duration-300 h-full ${
          hl ? "bg-[#0A2540] border-[#0078D4]/60" : "bg-white border-border"
        }`}
        data-testid={`offer-card-${index}`}
      >
        <div className="flex items-start justify-between mb-4">
          <div className={`w-11 h-11 rounded-lg flex items-center justify-center flex-shrink-0 ${hl ? "bg-white/10" : "bg-[#0078D4]/10"}`}>
            <Icon className="w-5 h-5 text-[#0078D4]" />
          </div>
          {data.badge && (
            <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${hl ? "bg-[#0078D4] text-white" : badgeClass(data.badge)}`}>
              {data.badge}
            </span>
          )}
        </div>

        {data.category && (
          <p className={`text-xs font-medium uppercase tracking-wider mb-2 ${hl ? "text-white/50" : "text-muted-foreground"}`}>
            {data.category}
          </p>
        )}

        <p className="text-[#0078D4] text-3xl font-extrabold mb-1" data-testid={`offer-price-${index}`}>
          {priceDisplay}
        </p>

        {data.hoursPerMonth && (
          <p className={`text-sm mb-1 ${hl ? "text-[#00B4D8]" : "text-[#0078D4]"}`}>{data.hoursPerMonth}/month</p>
        )}

        <h3 className={`text-xl font-bold mb-1 ${hl ? "text-white" : "text-[#0A2540]"}`}>{data.name}</h3>

        {data.tagline && (
          <p className={`text-sm italic mb-3 ${hl ? "text-white/60" : "text-muted-foreground"}`}>{data.tagline}</p>
        )}

        {data.description && (
          <p className={`text-sm leading-relaxed mb-4 ${hl ? "text-white/60" : "text-foreground"}`}>{data.description}</p>
        )}

        <div className="flex flex-wrap gap-3 mb-4">
          {data.turnaround && (
            <span className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border ${hl ? "bg-white/10 text-white/70 border-white/20" : "text-muted-foreground bg-[#F7F9FC] border-border"}`}>
              <Clock className="w-3.5 h-3.5 text-[#0078D4]" />
              {data.turnaround}
            </span>
          )}
          <span className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border ${hl ? "bg-white/10 text-white/70 border-white/20" : "text-muted-foreground bg-[#F7F9FC] border-border"}`}>
            {billingLabel}
          </span>
        </div>

        {data.targetAudience && (
          <p className={`text-sm italic mb-4 ${hl ? "text-white/60" : "text-muted-foreground"}`}>
            <span className={`font-semibold not-italic ${hl ? "text-white/80" : "text-[#0A2540]"}`}>Best for:</span> {data.targetAudience}
          </p>
        )}

        {deliverables.length > 0 && (
          <div className="mb-4">
            <p className={`text-sm font-semibold mb-1.5 ${hl ? "text-white/50" : "text-[#0A2540]"}`}>Deliverables:</p>
            <ul className="space-y-1">
              {deliverables.map((line, i) => (
                <li key={i} className={`flex items-start gap-2 text-sm ${hl ? "text-white/80" : "text-muted-foreground"}`}>
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#0078D4] flex-shrink-0" />
                  {line}
                </li>
              ))}
            </ul>
          </div>
        )}

        {inclusions.length > 0 && (
          <div className={`border-t pt-4 mb-4 ${hl ? "border-white/10" : "border-border"}`}>
            <p className={`text-sm font-semibold mb-3 ${hl ? "text-white/50" : "text-[#0A2540]"}`}>What's Included:</p>
            <ul className="space-y-2">
              {inclusions.map((item, j) => (
                <li key={j} className={`flex items-start gap-2 text-sm ${hl ? "text-white/80" : "text-foreground"}`} data-testid={`offer-${index}-inclusion-${j}`}>
                  <CheckCircle className="w-4 h-4 text-[#0078D4] flex-shrink-0 mt-0.5" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}

        {features.length > 0 && (
          <div className={`border-t pt-4 mb-4 ${hl ? "border-white/10" : "border-border"}`}>
            <p className={`text-sm font-semibold mb-3 ${hl ? "text-white/50" : "text-[#0A2540]"}`}>Features:</p>
            <ul className="space-y-1.5">
              {features.map((item, j) => (
                <li key={j} className={`flex items-start gap-2 text-sm ${hl ? "text-white/80" : "text-muted-foreground"}`} data-testid={`offer-${index}-feature-${j}`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-[#0078D4] flex-shrink-0 mt-1.5" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex-grow" />

        {cta}
      </div>
    </div>
  );
}
