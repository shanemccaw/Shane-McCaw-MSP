import { CheckCircle2, ArrowRight, FolderOpen } from "lucide-react";
import { type EngagementProject } from "@/hooks/useEngagementProjects";

interface EngagementProjectCardProps {
  project: EngagementProject;
  index: number;
}

/**
 * SOW-gated project card — never a checkout button. `triggeredBy` now holds real
 * internal signal keys (`signal.copilot.*`, `trigger.quiz.*`, etc.), not
 * human-readable trigger copy, so that field is used for topic matching only
 * (see `FollowOnProjects`) and is deliberately not rendered here.
 */
export function EngagementProjectCard({ project, index }: EngagementProjectCardProps) {
  return (
    <div
      className="rounded-2xl border border-white/[0.06] bg-charcoal-1 p-8 flex flex-col hover:border-accent-blue/30 transition-colors h-full"
      data-testid={`project-type-${index}`}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="w-11 h-11 rounded-lg flex items-center justify-center flex-shrink-0 glass-panel">
          <FolderOpen className="w-5 h-5 text-accent-blue" />
        </div>
        <span className="text-[10px] font-numeric font-bold uppercase tracking-wider px-2.5 py-1 rounded-full glass-panel text-accent-blue">
          {project.priceRange}
        </span>
      </div>

      <h3 className="font-display text-xl font-bold text-text-primary mb-1 leading-snug">{project.title}</h3>

      {project.description && (
        <p className="text-sm leading-relaxed mb-4 text-text-secondary">{project.description}</p>
      )}

      {project.sowItems.length > 0 && (
        <div className="border-t border-white/[0.08] pt-4 mb-4">
          <p className="text-sm font-semibold mb-3 text-text-primary">Typical SOW includes</p>
          <ul className="space-y-2">
            {project.sowItems.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-text-secondary">
                <CheckCircle2 className="w-4 h-4 text-accent-blue flex-shrink-0 mt-0.5" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-auto pt-4">
        <a
          href="/book"
          className="inline-flex items-center justify-center w-full gap-2 border border-white/[0.12] hover:border-white/[0.2] text-text-secondary hover:text-text-primary font-semibold text-sm px-5 py-2.5 rounded-xl transition-colors"
          data-track="cta"
        >
          Request a scoped SOW <ArrowRight className="w-4 h-4" />
        </a>
      </div>
    </div>
  );
}
