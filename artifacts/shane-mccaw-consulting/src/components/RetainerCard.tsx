// Full-featured retainer card used on the Pricing page and the Services overview.
import { CheckCircle } from "lucide-react";
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
      className={`rounded-2xl p-8 border flex flex-col relative ${hl ? "bg-[#0A2540] border-[#0078D4]/60" : "bg-white border-border"}`}
      data-testid={`retainer-${index}`}
    >
      {hl && (
        <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-[#0078D4] text-white text-xs font-bold px-5 py-1.5 rounded-full uppercase tracking-wide whitespace-nowrap">
          Most Popular
        </div>
      )}
      <div className="mb-2">
        <h3 className={`text-lg font-extrabold mb-4 ${hl ? "text-white" : "text-[#0A2540]"}`}>{plan.name}</h3>
        <div className="flex items-baseline gap-1 mb-1">
          <span className="text-4xl font-extrabold text-[#0078D4]">{price}</span>
          <span className={`text-sm ${hl ? "text-white/50" : "text-muted-foreground"}`}>/month</span>
        </div>
        {plan.hoursPerMonth && (
          <p className={`text-sm mb-4 ${hl ? "text-[#00B4D8]" : "text-[#0078D4]"}`}>{plan.hoursPerMonth}/month</p>
        )}
        <p className={`text-xs leading-relaxed mb-6 ${hl ? "text-white/60" : "text-muted-foreground"}`}>{plan.tagline ?? plan.description}</p>
      </div>
      <ul className="space-y-3 mb-6">
        {features.map((f, j) => (
          <li key={j} className="flex items-start gap-2.5" data-testid={`retainer-${index}-feature-${j}`}>
            <CheckCircle className="w-4 h-4 text-[#0078D4] flex-shrink-0 mt-0.5" />
            <span className={`text-sm ${hl ? "text-white/80" : "text-foreground"}`}>{f}</span>
          </li>
        ))}
      </ul>
      {plan.targetAudience && (
        <div className="mb-4">
          <p className={`text-xs font-semibold uppercase tracking-wide mb-1 ${hl ? "text-white/50" : "text-[#0A2540]"}`}>Who it&apos;s for</p>
          <p className={`text-xs ${hl ? "text-white/60" : "text-muted-foreground"}`}>{plan.targetAudience}</p>
        </div>
      )}
      {plan.inclusions && plan.inclusions.length > 0 && (
        <div className="mb-4">
          <p className={`text-xs font-semibold uppercase tracking-wide mb-2 ${hl ? "text-white/50" : "text-[#0A2540]"}`}>Also included</p>
          <ul className="space-y-1.5">
            {plan.inclusions.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-xs">
                <CheckCircle className="w-3.5 h-3.5 text-[#0078D4] flex-shrink-0 mt-0.5" />
                <span className={hl ? "text-white/70" : "text-muted-foreground"}>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {plan.deliverables && plan.deliverables.length > 0 && (
        <div className="mb-3">
          <p className={`text-xs font-semibold uppercase tracking-wide mb-1 ${hl ? "text-white/50" : "text-[#0A2540]"}`}>Deliverables</p>
          <ul className="space-y-1">
            {plan.deliverables.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-xs">
                <CheckCircle className="w-3.5 h-3.5 text-[#0078D4] flex-shrink-0 mt-0.5" />
                <span className={hl ? "text-white/60" : "text-muted-foreground"}>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {plan.turnaround && (
        <div className="mb-4">
          <p className={`text-xs font-semibold uppercase tracking-wide mb-1 ${hl ? "text-white/50" : "text-[#0A2540]"}`}>Turnaround</p>
          <p className={`text-xs ${hl ? "text-white/60" : "text-muted-foreground"}`}>{plan.turnaround}</p>
        </div>
      )}
      <div className="mt-auto">
        <CTAButton href="/book" className="w-full justify-center text-sm" data-testid={`retainer-cta-${index}`}>
          Start a Retainer
        </CTAButton>
      </div>
    </div>
  );
}
