import { useEngagementProjects } from "@/hooks/useEngagementProjects";
import { EngagementProjectCard } from "@/components/EngagementProjectCard";
import { projectMatchesTopic } from "@/data/solutionsTopics";

interface FollowOnProjectsProps {
  topicSlug: string;
}

/**
 * Solutions/Topic page "we can do this too" section (Real Projects + Assessments
 * CTAs on Topic Pages task). Projects live separately from `services` and are
 * SOW-gated, not checkout — this only ever surfaces real `engagement_projects`
 * rows whose `triggeredBy` signal-key domain matches this topic
 * (`projectMatchesTopic`, website-rebuild-reference-v2.md-adjacent data model).
 * Renders nothing at all when zero real projects match — no empty state, per
 * this task's explicit rule.
 */
export function FollowOnProjects({ topicSlug }: FollowOnProjectsProps) {
  const { projects, loading } = useEngagementProjects();

  const matched = projects.filter(
    (p) => p.isVisible && projectMatchesTopic(p.triggeredBy, topicSlug)
  );

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[0, 1].map((i) => (
          <div key={i} className="rounded-2xl border border-white/[0.06] bg-charcoal-1 p-8 h-56 animate-pulse" />
        ))}
      </div>
    );
  }

  if (matched.length === 0) return null;

  return (
    <section className="py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto">
        <h2 className="font-display text-2xl font-bold text-text-primary mb-3">
          Projects We Can Scope for You
        </h2>
        <p className="text-text-secondary leading-relaxed mb-8 max-w-2xl">
          These aren't self-checkout — once an Assessment surfaces a real gap in this area, this
          is the kind of scoped engagement it can turn into. Every project here starts with a
          conversation, not a cart.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 items-stretch">
          {matched.map((project, i) => (
            <EngagementProjectCard key={project.id} project={project} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}
