import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";
import { GlassPanel } from "@/components/design-system/GlassPanel";
import { GradientText } from "@/components/design-system/GradientText";
import { SOLUTIONS_TOPICS } from "@/data/solutionsTopics";

export default function Solutions() {
  return (
    <Layout>
      <SEOMeta
        title="Solutions | Shane McCaw Consulting"
        description="Eight Microsoft 365 domains, each scored and monitored — Copilot, Security & Compliance, Governance, SharePoint, Power Platform, Teams, Migration, and M365 Health."
      />

      <section className="pt-32 sm:pt-40 pb-16 px-4 sm:px-6 lg:px-8 text-center">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs uppercase tracking-widest text-text-tertiary mb-4">Solutions</p>
          <h1 className="font-display text-4xl sm:text-5xl font-bold text-text-primary tracking-tight leading-tight mb-6">
            Every domain that <GradientText>matters</GradientText>, scored on its own
          </h1>
          <p className="text-lg text-text-secondary leading-relaxed">
            The same seven pillars the Architecture Health Engine tracks, broken out by domain. Each
            page is where a recognized visitor sees their real number — pick the one closest to
            what's keeping you up at night.
          </p>
        </div>
      </section>

      <section className="pb-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {SOLUTIONS_TOPICS.map((topic) => {
            const Icon = topic.icon;
            return (
              <Link key={topic.slug} href={`/solutions/${topic.slug}`} data-track="nav">
                <GlassPanel className="p-6 h-full flex flex-col hover:bg-white/[0.09] transition-colors group">
                  <div className="w-10 h-10 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center text-accent-blue mb-4">
                    <Icon className="w-5 h-5" />
                  </div>
                  <h2 className="font-display font-semibold text-text-primary mb-2">
                    {topic.title}
                  </h2>
                  <p className="text-sm text-text-secondary leading-relaxed flex-grow mb-4">
                    {topic.subhead}
                  </p>
                  <span className="flex items-center gap-1.5 text-sm font-medium text-accent-blue group-hover:gap-2.5 transition-all">
                    Explore <ArrowRight className="w-3.5 h-3.5" />
                  </span>
                </GlassPanel>
              </Link>
            );
          })}
        </div>
      </section>
    </Layout>
  );
}
