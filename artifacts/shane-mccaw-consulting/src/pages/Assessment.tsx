import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";
import { useCatalog, type AssessmentOffer } from "@/hooks/useCatalog";
import { Button } from "@/components/ui/button";
import {
  Shield,
  Eye,
  Zap,
  CheckCircle2,
  ArrowRight,
  Loader2,
  AlertCircle,
} from "lucide-react";

export default function Assessment() {
  const { assessmentOffers, loading, error } = useCatalog();

  const sorted = [...assessmentOffers].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <Layout>
      <SEOMeta
        title="Microsoft 365 Assessments | Shane McCaw Consulting"
        description="NASA-informed Microsoft 365 assessments that reveal configuration drift, security gaps, licence waste, oversharing risks, and Copilot readiness blockers."
      />

      {/* Hero */}
      <section className="bg-[#0A2540] pt-[130px] pb-20 px-6 text-center">
        <div className="max-w-[860px] mx-auto">
          <div className="inline-flex items-center gap-2 bg-white/10 text-white text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-full mb-6">
            <Shield className="size-3.5 text-[#00B4D8]" />
            NASA-Informed Architecture
          </div>

          <h1 className="text-4xl md:text-5xl font-extrabold text-white mb-6 leading-tight">
            Microsoft 365 Assessments — Free and Paid Options
          </h1>

          <p className="text-white/70 text-lg max-w-2xl mx-auto leading-relaxed mb-8">
            Choose from free baseline assessments or deep-dive paid assessments.  
            All powered by the same signal engine used to secure NASA’s Copilot rollout.
          </p>

          <Link href="#catalog">
            <Button size="lg" className="px-10 py-4">
              View Assessment Catalog
            </Button>
          </Link>
        </div>
      </section>

      {/* Catalog */}
      <section id="catalog" className="bg-white py-20 px-6">
        <div className="max-w-[1200px] mx-auto">
          <h2 className="text-center text-2xl md:text-3xl font-extrabold text-[#0A2540] mb-10">
            Assessment Catalog
          </h2>

          {loading && (
            <div className="flex justify-center py-16">
              <Loader2 className="size-8 animate-spin text-[#0078D4]" />
            </div>
          )}

          {error && !loading && (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <AlertCircle className="size-8 text-destructive" />
              <p className="text-muted-foreground">
                Could not load assessments. Please refresh and try again.
              </p>
            </div>
          )}

          {!loading && !error && sorted.length === 0 && (
            <div className="text-center py-16 text-muted-foreground">
              No assessments available yet — check back soon.
            </div>
          )}

          {!loading && !error && sorted.length > 0 && (
            <div
              className={`grid gap-6 ${
                sorted.length === 1
                  ? "grid-cols-1 max-w-sm mx-auto"
                  : sorted.length === 2
                  ? "grid-cols-1 md:grid-cols-2 max-w-2xl mx-auto"
                  : "grid-cols-1 md:grid-cols-3"
              }`}
            >
              {sorted.map((offer) => (
                <AssessmentCard key={offer.id} offer={offer} />
              ))}
            </div>
          )}
        </div>
      </section>
    </Layout>
  );
}

function AssessmentCard({ offer }: { offer: AssessmentOffer }) {
  const isFree = offer.isFree;

  return (
    <div
      className={`relative flex flex-col rounded-2xl border p-8 h-full transition-all duration-300 hover:shadow-lg hover:-translate-y-1 ${
        offer.highlighted
          ? "bg-[#0A2540] border-[#0078D4]/60 shadow-xl ring-2 ring-[#0078D4]/20"
          : "bg-white border-border shadow-sm"
      }`}
    >
      {offer.badge && (
        <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
          <span className="bg-[#0078D4] text-white text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full whitespace-nowrap">
            {offer.badge}
          </span>
        </div>
      )}

      <div
        className={`inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider mb-4 ${
          offer.highlighted ? "text-[#00B4D8]" : "text-[#0078D4]"
        }`}
      >
        <Eye className="size-3.5" />
        {offer.name}
      </div>

      <p
        className={`text-sm mb-5 leading-relaxed ${
          offer.highlighted ? "text-white/60" : "text-foreground/70"
        }`}
      >
        {offer.tagline ?? offer.description}
      </p>

      {(offer.features?.length ?? 0) > 0 && (
        <ul className="space-y-2 mb-6 flex-1">
          {offer.features!.map((f, i) => (
            <li
              key={i}
              className={`flex items-start gap-2 text-sm ${
                offer.highlighted ? "text-white/80" : "text-foreground"
              }`}
            >
              <CheckCircle2 className="size-4 text-[#0078D4] shrink-0 mt-0.5" />
              {f}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-auto pt-4">
        {isFree ? (
          <Link href={`/checkout?product=${offer.slug}`}>
            <Button
              className={`w-full ${
                offer.highlighted ? "" : "bg-[#0A2540] hover:bg-[#0A2540]/90"
              }`}
            >
              Run Free Assessment <ArrowRight className="ml-2 size-4" />
            </Button>
          </Link>
        ) : (
          <Link href={`/assessment/details?product=${offer.slug}`}>
            <Button
              className={`w-full ${
                offer.highlighted ? "" : "bg-[#0A2540] hover:bg-[#0A2540]/90"
              }`}
            >
              View Details <ArrowRight className="ml-2 size-4" />
            </Button>
          </Link>
        )}
      </div>
    </div>
  );
}
