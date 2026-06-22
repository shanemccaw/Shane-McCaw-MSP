import { AlertTriangle, CheckCircle, ArrowRight, FolderOpen, Clock } from "lucide-react";
import { type PublicService, formatPriceDisplay } from "@/hooks/useServices";
import { CTAButton } from "@/components/CTAButton";

interface ServiceProjectCardProps {
  service: PublicService;
  index: number;
}

export function ServiceProjectCard({ service, index }: ServiceProjectCardProps) {
  const price = formatPriceDisplay(service);
  const triggers = service.triggers ?? [];
  const deliverables = service.deliverables ?? [];
  const features = service.features ?? [];
  const workflowSteps = service.workflowSummary ?? [];

  return (
    <div
      className="rounded-xl border bg-white border-border p-8 flex flex-col hover:shadow-lg hover:-translate-y-1 transition-all duration-300 h-full"
      data-testid={`project-card-${index}`}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="w-11 h-11 rounded-lg flex items-center justify-center flex-shrink-0 bg-[#0078D4]/10">
          <FolderOpen className="w-5 h-5 text-[#0078D4]" />
        </div>
        <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-[#0078D4]/10 text-[#0078D4]">
          {price}
        </span>
      </div>

      <h3 className="text-xl font-bold text-[#0A2540] mb-1 leading-snug">{service.name}</h3>

      {service.turnaround && (
        <span className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border text-muted-foreground bg-[#F7F9FC] border-border mb-3 self-start">
          <Clock className="w-3.5 h-3.5 text-[#0078D4]" />
          {service.turnaround}
        </span>
      )}

      {service.description && (
        <p className="text-sm leading-relaxed mb-4 text-muted-foreground">{service.description}</p>
      )}

      {triggers.length > 0 && (
        <div className="border-t pt-4 mb-4 border-border">
          <p className="text-sm font-semibold mb-3 text-[#0A2540]">Triggered by</p>
          <ul className="space-y-2">
            {triggers.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                <AlertTriangle className="w-4 h-4 text-[#00B4D8] flex-shrink-0 mt-0.5" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      {deliverables.length > 0 && (
        <div className="border-t pt-4 mb-4 border-border">
          <p className="text-sm font-semibold mb-3 text-[#0A2540]">Deliverables</p>
          <ul className="space-y-2">
            {deliverables.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                <CheckCircle className="w-4 h-4 text-[#0078D4] flex-shrink-0 mt-0.5" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      {features.length > 0 && (
        <div className="border-t pt-4 mb-4 border-border">
          <p className="text-sm font-semibold mb-3 text-[#0A2540]">Features</p>
          <ul className="space-y-1.5">
            {features.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                <span className="w-1.5 h-1.5 rounded-full bg-[#0078D4] flex-shrink-0 mt-1.5" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      {workflowSteps.length > 0 && (
        <div className="border-t pt-4 mb-4 border-border">
          <p className="text-sm font-semibold mb-3 text-[#0A2540]">Engagement phases</p>
          <ol className="space-y-2">
            {workflowSteps.map((step, i) => (
              <li key={i} className="flex items-start gap-2.5 text-sm">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[#0078D4]/10 text-[#0078D4] text-[10px] font-bold flex items-center justify-center mt-0.5">
                  {i + 1}
                </span>
                <div>
                  <span className="font-medium text-[#0A2540]">{step.title}</span>
                  {step.description && (
                    <p className="text-xs text-muted-foreground mt-0.5">{step.description}</p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="mt-auto pt-4">
        <CTAButton
          href="/book"
          className="w-full justify-center text-sm"
          data-testid={`project-card-cta-${index}`}
        >
          Book a free scoping call <ArrowRight className="ml-1.5 w-4 h-4" />
        </CTAButton>
      </div>
    </div>
  );
}
