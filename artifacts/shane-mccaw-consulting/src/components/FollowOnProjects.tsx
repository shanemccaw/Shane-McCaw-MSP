import { useEngagementProjects } from "@/hooks/useEngagementProjects";
import { EngagementProjectCard } from "@/components/EngagementProjectCard";

interface FollowOnProjectsProps {
  triggerKeys: string[];
}

export function FollowOnProjects({ triggerKeys }: FollowOnProjectsProps) {
  const { projects, loading } = useEngagementProjects();

  const matched = projects.filter(
    (p) =>
      p.isVisible &&
      p.triggeredBy.some((t) => triggerKeys.includes(t))
  );

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-10">
        {[0, 1].map((i) => (
          <div key={i} className="rounded-xl border bg-white border-border p-8 h-56 animate-pulse" />
        ))}
      </div>
    );
  }

  if (matched.length === 0) return null;

  return (
    <div className="mb-10">
      <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-5">
        Project Engagements Commonly Triggered by This Assessment
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 items-stretch">
        {matched.map((project, i) => (
          <EngagementProjectCard key={project.id} project={project} index={i} />
        ))}
      </div>
    </div>
  );
}
