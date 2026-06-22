import { CTAButton } from "@/components/CTAButton";
import { ArrowRight, CheckCircle } from "lucide-react";

export function CopilotQuizCTA() {
  return (
    <section className="bg-[#0A2540] py-20">
      <div className="max-w-[1200px] mx-auto px-6">
        <div className="max-w-3xl mx-auto text-center">
          <p className="text-[#00B4D8] text-sm font-semibold uppercase tracking-[0.12em] mb-4">Free 5-Minute Assessment</p>
          <h2 className="text-3xl md:text-4xl font-extrabold text-white mb-6 leading-tight">
            Not Sure Where You Stand?<br className="hidden sm:block" /> Take the Copilot Readiness Quiz.
          </h2>
          <p className="text-white/70 text-lg leading-relaxed mb-4">
            Before you enable a single Copilot license, you need to know your readiness across five dimensions: governance, identity, data hygiene, change management, and business process maturity.
          </p>
          <p className="text-white/60 leading-relaxed mb-10">
            Answer 10 targeted questions — built on the same framework Shane applied at NASA — and receive a personalised readiness score, dimension-by-dimension breakdown, and a recommended service path. Delivered instantly as a PDF. No account required.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <CTAButton href="/copilot-quiz" className="text-base px-8 py-3.5">
              Take the Free Assessment <ArrowRight className="w-4 h-4 ml-1" />
            </CTAButton>
            <div className="flex flex-wrap justify-center gap-x-6 gap-y-1 text-white/40 text-sm">
              <span className="flex items-center gap-1.5"><CheckCircle className="w-3.5 h-3.5 text-[#00B4D8]" /> 10 questions · ~5 minutes</span>
              <span className="flex items-center gap-1.5"><CheckCircle className="w-3.5 h-3.5 text-[#00B4D8]" /> PDF report emailed instantly</span>
              <span className="flex items-center gap-1.5"><CheckCircle className="w-3.5 h-3.5 text-[#00B4D8]" /> No sales follow-up</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
