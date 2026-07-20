import { useMemo } from "react";
import { Link } from "wouter";
import { Loader2, AlertCircle, ArrowRight } from "lucide-react";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";
import { GradientText } from "@/components/design-system/GradientText";
import { OfferCard } from "@/components/OfferCard";
import { useServices } from "@/hooks/useServices";

/**
 * Quick-Start Packs — proactive "build your tenant" configuration packs, sold standalone,
 * no prerequisite scan (website-rebuild-reference-v2.md §1/§2/§5). Signal-triggered packs
 * generated from real diagnostic findings stay Portal-side (Sales Offer Engine) and are not
 * duplicated here. Catalog-driven — the "entry" tier is the same real, non-hardcoded data
 * already powering the /services directory, just given its own dedicated page per the sitemap.
 */
export default function Products() {
  const { services, loading, error } = useServices();

  const packs = useMemo(
    () =>
      services
        .filter((s) => s.tier?.toLowerCase() === "entry" && s.billingType !== "recurring_monthly")
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [services],
  );

  return (
    <Layout>
      <SEOMeta
        title="Quick-Start Packs | Shane McCaw Consulting"
        description="Fixed-price, fixed-scope Microsoft 365 configuration packs — build your tenant baseline without a prerequisite scan or a drawn-out proposal cycle."
      />

      <section className="pt-32 sm:pt-40 pb-16 px-4 sm:px-6 lg:px-8 text-center">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs uppercase tracking-widest text-text-tertiary mb-4">
            Quick-Start Packs
          </p>
          <h1 className="font-display text-4xl sm:text-5xl font-bold text-text-primary tracking-tight leading-tight mb-6">
            Fixed scope. Fixed price. <GradientText>No scan required.</GradientText>
          </h1>
          <p className="text-lg text-text-secondary leading-relaxed">
            Productized configuration packs that build your tenant baseline directly — no
            assessment prerequisite, no open-ended proposal. Break-glass credential delivery and
            baseline apply included where noted.
          </p>
        </div>
      </section>

      <section className="pb-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          {loading && (
            <div className="flex justify-center py-20">
              <Loader2 className="size-8 animate-spin text-accent-blue" />
            </div>
          )}

          {error && !loading && (
            <div className="flex flex-col items-center gap-3 py-20 text-center">
              <AlertCircle className="size-8 text-accent-violet" />
              <p className="text-text-secondary">
                Could not load the product catalog. Please{" "}
                <Link href="/contact" className="text-accent-blue hover:underline">
                  contact us
                </Link>{" "}
                directly.
              </p>
            </div>
          )}

          {!loading && !error && packs.length === 0 && (
            <div className="text-center py-20 text-text-secondary">
              No packs are published yet.{" "}
              <Link href="/contact" className="text-accent-blue hover:underline">
                Get in touch
              </Link>{" "}
              and we'll scope one directly.
            </div>
          )}

          {!loading && !error && packs.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 items-stretch">
              {packs.map((pack, i) => (
                <OfferCard key={pack.slug ?? pack.id} offer={pack} index={i} />
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="pb-24 px-4 sm:px-6 lg:px-8 text-center">
        <div className="max-w-2xl mx-auto">
          <p className="text-text-secondary mb-6">
            Already have scan findings? Signal-triggered packs are generated from your real
            diagnostic results and checked out from inside the Portal.
          </p>
          <Link
            href="/assessment"
            className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl font-semibold text-white transition-opacity hover:opacity-90"
            style={{ background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" }}
            data-track="cta"
          >
            Start a Free Assessment <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </section>
    </Layout>
  );
}
