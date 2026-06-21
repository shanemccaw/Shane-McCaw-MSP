import { AlertTriangle, CheckCircle, ArrowRight, FolderOpen } from "lucide-react";
import { type EngagementProject } from "@/hooks/useEngagementProjects";

interface EngagementProjectCardProps {
  project: EngagementProject;
  index: number;
}

export function EngagementProjectCard({ project, index }: EngagementProjectCardProps) {
  return (
    <div
      className="rounded-xl border bg-white border-border p-8 flex flex-col hover:shadow-lg hover:-translate-y-1 transition-all duration-300 h-full"
      data-testid={`project-type-${index}`}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="w-11 h-11 rounded-lg flex items-center justify-center flex-shrink-0 bg-[#0078D4]/10">
          <FolderOpen className="w-5 h-5 text-[#0078D4]" />
        </div>
        <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-[#0078D4]/10 text-[#0078D4]">
          {project.priceRange}
        </span>
      </div>

      <h3 className="text-xl font-bold text-[#0A2540] mb-1 leading-snug">{project.title}</h3>

      {project.description && (
        <p className="text-sm leading-relaxed mb-4 text-muted-foreground">{project.description}</p>
      )}

      {project.triggeredBy.length > 0 && (
        <div className="border-t pt-4 mb-4 border-border">
          <p className="text-sm font-semibold mb-3 text-[#0A2540]">Triggered by</p>
          <ul className="space-y-2">
            {project.triggeredBy.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                <AlertTriangle className="w-4 h-4 text-[#00B4D8] flex-shrink-0 mt-0.5" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      {project.sowItems.length > 0 && (
        <div className="border-t pt-4 mb-4 border-border">
          <p className="text-sm font-semibold mb-3 text-[#0A2540]">Typical SOW includes</p>
          <ul className="space-y-2">
            {project.sowItems.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                <CheckCircle className="w-4 h-4 text-[#0078D4] flex-shrink-0 mt-0.5" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-auto pt-4">
        <a
          href="/book"
          className="inline-flex items-center justify-center w-full gap-2 bg-[#0078D4] hover:bg-[#006BBE] text-white font-semibold text-sm px-5 py-2.5 rounded transition-colors"
        >
          Book a free scoping call <ArrowRight className="w-4 h-4" />
        </a>
      </div>
    </div>
  );
}
