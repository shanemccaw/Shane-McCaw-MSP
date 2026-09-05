import { Link } from "wouter";
import { ArrowRight } from "lucide-react";

const GRADIENT_BG = { background: "linear-gradient(90deg,#3b82f6,#8b5cf6)" };

/**
 * Shared close panel — "Bring the decision. Leave with the answer." on the Solutions
 * index, "Bring the {topic} decision..." on each topic page (README §7–§8, Git #2961).
 */
export function SolutionsClosePanel({ headline }: { headline: string }) {
  return (
    <section className="max-w-[940px] mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-16 pb-[72px] sm:pb-[120px]">
      <div
        className="relative overflow-hidden rounded-3xl border border-[rgba(0,120,212,0.3)] px-5 sm:px-14 py-8 sm:py-16"
        style={{
          background:
            "radial-gradient(900px 380px at 8% -10%,rgba(0,120,212,.18),transparent 60%),linear-gradient(168deg,rgba(10,37,64,.5),#070d1e 64%)",
        }}
      >
        <div className="flex items-center gap-3">
          <span className="w-[26px] h-px" style={{ background: "linear-gradient(90deg,#00B4D8,rgba(0,180,216,.15))" }} />
          <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#00B4D8]">
            Direct Engagement
          </span>
        </div>
        <h2 className="text-[28px] sm:text-[42px] leading-[1.1] tracking-[-0.028em] font-extrabold text-[#f8fafc] mt-[18px] mb-4 max-w-[680px]">
          {headline}
        </h2>
        <p className="text-[17px] leading-[1.6] text-[#94a3b8] max-w-[560px] mb-[30px]">
          NASA's Lead Microsoft 365 Architect, 30 years in the Microsoft ecosystem, from $900 a month. No proposal,
          no SOW, no minimum term.
        </p>
        <div className="flex flex-wrap gap-3 items-center">
          <Link
            href="/#tiers"
            className="inline-flex items-center justify-center gap-2 min-h-[52px] px-[26px] rounded-xl text-base font-semibold text-white transition-opacity hover:opacity-90"
            style={GRADIENT_BG}
            data-track="cta"
          >
            Start at $900/mo <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            href="/contact"
            className="inline-flex items-center justify-center min-h-[52px] px-[22px] rounded-xl text-base font-semibold text-[#e2e8f0] border border-[rgba(148,163,184,0.3)] hover:border-[#00B4D8] hover:text-[#f8fafc] transition-colors"
            data-track="cta"
          >
            Ask Shane the question
          </Link>
        </div>
      </div>
    </section>
  );
}
