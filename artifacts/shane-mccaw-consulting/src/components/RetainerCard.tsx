import { Calendar, CheckCircle } from "lucide-react";
import { Link } from "wouter";
import { CTAButton } from "@/components/CTAButton";
import { formatPriceDisplay, type PublicService } from "@/hooks/useServices";

interface RetainerCardProps {
  plan: PublicService;
  index: number;
}

export function RetainerCard({ plan, index }: RetainerCardProps) {
  const price = formatPriceDisplay(plan);
  const features = plan.features ?? [];
  const hl = plan.highlighted;
  return (
    <div
      className={`rounded-xl border p-8 flex flex-col hover:shadow-lg hover:-translate-y-1 transition-all duration-300 h-full ${hl ? "bg-[#0A2540] border-[#0078D4]/60" : "bg-white border-border"}`}
      data-testid={`retainer-${index}`}
    >
      <div className="flex items-start justify-between mb-4">
        <div className={`w-11 h-11 rounded-lg flex items-center justify-center flex-shrink-0 ${hl ? "bg-white/10" : "bg-[#0078D4]/10"}`}>
          <Calendar className="w-5 h-5 text-[#0078D4]" />
        </div>
        {hl && (
          <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-[#0078D4] text-white">
            Most Popular
          </span>
        )}
      </div>

      <p className="text-[#0078D4] text-3xl font-extrabold mb-1" data-testid={`retainer-price-${index}`}>{price}</p>
      <span className={`text-sm mb-1 block ${hl ? "text-white/50" : "text-muted-foreground"}`}>/month</span>

      {plan.hoursPerMonth && (
        <p className={`text-sm mb-1 ${hl ? "text-[#00B4D8]" : "text-[#0078D4]"}`}>{plan.hoursPerMonth}/month</p>
      )}

      <h3 className={`text-xl font-bold mb-1 leading-snug ${hl ? "text-white" : "text-[#0A2540]"}`}>{plan.name}</h3>

      {(plan.tagline ?? plan.description) && (
        <p className={`text-sm italic mb-4 ${hl ? "text-white/60" : "text-muted-foreground"}`}>{plan.tagline ?? plan.description}</p>
      )}

      {features.length > 0 && (
        <ul className="space-y-2 mb-4">
          {features.map((f, j) => (
            <li key={j} className="flex items-start gap-2 text-sm" data-testid={`retainer-${index}-feature-${j}`}>
              <CheckCircle className="w-4 h-4 text-[#0078D4] flex-shrink-0 mt-0.5" />
              <span className={hl ? "text-white/80" : "text-foreground"}>{f}</span>
            </li>
          ))}
        </ul>
      )}

      {plan.targetAudience && (
        <div className="mb-4">
          <p className={`text-xs font-semibold uppercase tracking-wide mb-1 ${hl ? "text-white/50" : "text-[#0A2540]"}`}>Who it&apos;s for</p>
          <p className={`text-sm ${hl ? "text-white/60" : "text-muted-foreground"}`}>{plan.targetAudience}</p>
        </div>
      )}

      {plan.inclusions && plan.inclusions.length > 0 && (
        <div className={`border-t pt-4 mb-4 ${hl ? "border-white/10" : "border-border"}`}>
          <p className={`text-sm font-semibold mb-3 ${hl ? "text-white/50" : "text-[#0A2540]"}`}>Also included</p>
          <ul className="space-y-2">
            {plan.inclusions.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <CheckCircle className="w-4 h-4 text-[#0078D4] flex-shrink-0 mt-0.5" />
                <span className={hl ? "text-white/70" : "text-muted-foreground"}>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {plan.deliverables && plan.deliverables.length > 0 && (
        <div className={`border-t pt-4 mb-4 ${hl ? "border-white/10" : "border-border"}`}>
          <p className={`text-sm font-semibold mb-3 ${hl ? "text-white/50" : "text-[#0A2540]"}`}>Deliverables</p>
          <ul className="space-y-2">
            {plan.deliverables.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <CheckCircle className="w-4 h-4 text-[#0078D4] flex-shrink-0 mt-0.5" />
                <span className={hl ? "text-white/60" : "text-muted-foreground"}>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {plan.turnaround && (
        <div className="mb-4">
          <p className={`text-xs font-semibold uppercase tracking-wide mb-1 ${hl ? "text-white/50" : "text-[#0A2540]"}`}>Turnaround</p>
          <p className={`text-sm ${hl ? "text-white/60" : "text-muted-foreground"}`}>{plan.turnaround}</p>
        </div>
      )}

      <div className="mt-auto space-y-3">
        <CTAButton href={`/checkout/${plan.slug}`} className="w-full justify-center text-sm" data-testid={`retainer-cta-${index}`}>
          Get Started
        </CTAButton>
        <div className="text-center">
          <Link href={`/retainers/${plan.slug}`} className={`text-sm font-medium hover:underline transition-colors ${hl ? "text-[#00B4D8] hover:text-white" : "text-[#0078D4] hover:text-[#005A9E]"}`}>
            Learn More →
          </Link>
        </div>
      </div>
    </div>
  );
}
