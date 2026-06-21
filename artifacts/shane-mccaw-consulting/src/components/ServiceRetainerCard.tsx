import { CheckCircle } from "lucide-react";
import { CTAButton } from "@/components/CTAButton";

interface ServiceRetainerCardProps {
  name: string;
  price: string;
  hours: string;
  description: string;
  highlight?: boolean;
  index?: number;
}

export function ServiceRetainerCard({
  name,
  price,
  hours,
  description,
  highlight = false,
  index = 0,
}: ServiceRetainerCardProps) {
  const hl = highlight;
  return (
    <div
      className={`rounded-2xl p-8 border flex flex-col relative ${
        hl ? "bg-[#0A2540] border-[#0078D4]/60" : "bg-white border-border"
      }`}
      data-testid={`retainer-card-${index}`}
    >
      {hl && (
        <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-[#0078D4] text-white text-xs font-bold px-5 py-1.5 rounded-full uppercase tracking-wide whitespace-nowrap">
          Most Popular
        </div>
      )}
      <div className="mb-2">
        <h3 className={`text-lg font-extrabold mb-4 ${hl ? "text-white" : "text-[#0A2540]"}`}>
          {name}
        </h3>
        <div className="flex items-baseline gap-1 mb-1">
          <span className="text-4xl font-extrabold text-[#0078D4]">{price}</span>
          <span className={`text-sm ${hl ? "text-white/50" : "text-muted-foreground"}`}>/month</span>
        </div>
        <p className={`text-sm mb-4 ${hl ? "text-[#00B4D8]" : "text-[#0078D4]"}`}>{hours}</p>
        <p className={`text-xs leading-relaxed mb-6 ${hl ? "text-white/60" : "text-muted-foreground"}`}>
          {description}
        </p>
      </div>
      <ul className="space-y-3 mb-6 flex-1">
        {[
          "Direct access to Shane McCaw",
          "Architecture reviews & advisory",
          "Strategic planning & roadmap support",
          "Cancel with 30 days' notice",
        ].map((f, j) => (
          <li key={j} className="flex items-start gap-2.5">
            <CheckCircle className="w-4 h-4 text-[#0078D4] flex-shrink-0 mt-0.5" />
            <span className={`text-sm ${hl ? "text-white/80" : "text-foreground"}`}>{f}</span>
          </li>
        ))}
      </ul>
      <div className="mt-auto">
        <CTAButton
          href="/book"
          className="w-full justify-center text-sm"
          data-testid={`retainer-cta-${index}`}
        >
          Start a Retainer
        </CTAButton>
      </div>
    </div>
  );
}
