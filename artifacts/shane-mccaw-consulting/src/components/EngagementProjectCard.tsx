import { AlertTriangle, CheckCircle, ArrowRight } from "lucide-react";
import { type EngagementProject } from "@/hooks/useEngagementProjects";

interface EngagementProjectCardProps {
  project: EngagementProject;
  index: number;
}

export function EngagementProjectCard({ project, index }: EngagementProjectCardProps) {
  return (
    <div
      className="bg-white rounded-xl border border-border p-6 flex flex-col hover:border-[#0078D4]/30 hover:shadow-sm transition-all duration-200"
      data-testid={`project-type-${index}`}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <h3 className="font-extrabold text-[#0A2540] text-base leading-snug">{project.title}</h3>
        <span className="text-[#0078D4] font-extrabold text-sm flex-shrink-0 whitespace-nowrap">{project.priceRange}</span>
      </div>
      {project.description && (
        <p className="text-muted-foreground text-sm leading-relaxed mb-4">{project.description}</p>
      )}
      {project.triggeredBy.length > 0 && (
        <div className="mb-4">
          <p className="text-xs font-semibold text-[#0A2540] uppercase tracking-wide mb-2">Triggered by</p>
          <ul className="space-y-1">
            {project.triggeredBy.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                <AlertTriangle className="w-3.5 h-3.5 text-[#00B4D8] flex-shrink-0 mt-0.5" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {project.sowItems.length > 0 && (
        <div className="mb-4">
          <p className="text-xs font-semibold text-[#0A2540] uppercase tracking-wide mb-2">Typical SOW includes</p>
          <ul className="space-y-1">
            {project.sowItems.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                <CheckCircle className="w-3.5 h-3.5 text-[#0078D4] flex-shrink-0 mt-0.5" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-auto pt-4 border-t border-border">
        <a
          href="/book"
          className="text-[#0078D4] text-sm font-semibold hover:underline flex items-center gap-1"
        >
          Book a free scoping call <ArrowRight className="w-3.5 h-3.5" />
        </a>
      </div>
    </div>
  );
}
