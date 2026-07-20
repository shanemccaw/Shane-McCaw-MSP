import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";
import { GlassPanel } from "@/components/design-system/GlassPanel";
import { GradientText } from "@/components/design-system/GradientText";

interface StubPageProps {
  title: string;
  description?: string;
}

/**
 * Stage 1 placeholder — routing skeleton only. Real content lands in Stage 2
 * (website-rebuild-reference-v2.md §7). Not linked from meta robots as noindex
 * would need per-page control; kept minimal so nothing looks like a finished page.
 */
export function StubPage({ title, description }: StubPageProps) {
  return (
    <Layout>
      <SEOMeta
        title={`${title} | Shane McCaw Consulting`}
        description={description ?? `${title} — Shane McCaw Consulting.`}
      />
      <section className="pt-40 pb-24 px-6">
        <div className="max-w-2xl mx-auto text-center">
          <GlassPanel className="p-10">
            <p className="text-xs uppercase tracking-widest text-text-tertiary mb-4">Coming soon</p>
            <h1 className="font-display text-3xl sm:text-4xl font-bold text-text-primary mb-4">
              <GradientText>{title}</GradientText>
            </h1>
            <p className="text-text-secondary leading-relaxed mb-8">
              This page is part of the site rebuild and is on its way. In the meantime, start with an assessment
              or reach out directly.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/assessment"
                className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
                style={{ background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" }}
                data-track="cta"
              >
                Start an Assessment
              </Link>
              <Link
                href="/"
                className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-sm font-medium text-text-secondary hover:text-text-primary transition-colors"
              >
                <ArrowLeft className="w-4 h-4" /> Back home
              </Link>
            </div>
          </GlassPanel>
        </div>
      </section>
    </Layout>
  );
}

export default StubPage;
