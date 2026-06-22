import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";
import { RetainerSelectorQuiz } from "@/components/RetainerSelectorQuiz";

export default function RetainerQuiz() {
  return (
    <Layout>
      <SEOMeta
        title="Retainer Selector Quiz — Find Your Best-Fit M365 Architect Plan | Shane McCaw Consulting"
        description="Not sure which retainer plan is right for you? Answer 10 questions and get an instant recommendation — Architect Essentials, Growth, or Enterprise — based on your organization's needs."
      />

      <section className="bg-[#0A2540] pt-32 pb-24 px-6">
        <div className="max-w-[1100px] mx-auto">
          <div className="text-center mb-12">
            <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.12em] mb-4">2-Minute Quiz</p>
            <h1 className="text-4xl md:text-5xl font-extrabold text-white mb-5 leading-tight">
              Which Retainer Plan Is Right for You?
            </h1>
            <p className="text-white/65 text-lg max-w-2xl mx-auto leading-relaxed">
              Answer 10 questions about your organization's M365 environment and support needs. We'll recommend the Architect Essentials, Growth, or Enterprise plan — and explain exactly why.
            </p>
            <div className="flex flex-wrap justify-center gap-6 mt-6 text-sm text-white/40">
              {["10 questions", "Instant recommendation", "No sign-up required"].map((item) => (
                <span key={item} className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#0078D4]" />
                  {item}
                </span>
              ))}
            </div>
          </div>

          <RetainerSelectorQuiz />
        </div>
      </section>
    </Layout>
  );
}
