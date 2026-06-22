import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";
import { QuickWinsSelectorQuiz } from "@/components/QuickWinsSelectorQuiz";

export default function QuickWinQuiz() {
  return (
    <Layout>
      <SEOMeta
        title="Quick Win Selector Quiz — Find Your Best-Fit M365 Package | Shane McCaw Consulting"
        description="Answer 10 short questions and get a personalised recommendation for the Microsoft 365 Quick Win package that best fits your organisation's needs."
      />

      {/* Hero */}
      <section className="bg-[#0A2540] pt-32 pb-20 relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 800px 400px at 60% 0%, rgba(0,120,212,0.14) 0%, transparent 70%)",
          }}
        />
        <div className="max-w-[1200px] mx-auto px-6 relative text-center">
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">
            Quick Win Quiz
          </p>
          <h1 className="text-4xl md:text-5xl font-extrabold text-white leading-tight max-w-3xl mx-auto">
            Find the Right Quick Win for Your M365 Environment
          </h1>
          <p className="text-white/70 text-lg mt-5 max-w-xl mx-auto leading-relaxed">
            10 questions. 2–3 minutes. A personalised recommendation — no discovery call required.
          </p>
        </div>
      </section>

      {/* Quiz */}
      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <QuickWinsSelectorQuiz />
        </div>
      </section>
    </Layout>
  );
}
