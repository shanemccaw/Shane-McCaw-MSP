import { CTAButton } from "@/components/CTAButton";
import { ArrowRight, CheckCircle } from "lucide-react";

interface StatBadge {
  label: string;
}

interface AssessmentCTAProps {
  label: string;
  title: string;
  description: string;
  supportingCopy?: string;
  quizUrl: string;
  ctaLabel?: string;
  stats?: StatBadge[];
}

export function AssessmentCTA({
  label,
  title,
  description,
  supportingCopy,
  quizUrl,
  ctaLabel = "Take the Free Assessment",
  stats = [],
}: AssessmentCTAProps) {
  return (
    <section className="bg-[#0A2540] py-20">
      <div className="max-w-[1200px] mx-auto px-6">
        <div className="max-w-3xl mx-auto text-center">
          <p className="text-[#00B4D8] text-sm font-semibold uppercase tracking-[0.12em] mb-4">{label}</p>
          <h2
            className="text-3xl md:text-4xl font-extrabold text-white mb-6 leading-tight"
            dangerouslySetInnerHTML={{ __html: title }}
          />
          <p className="text-white/70 text-lg leading-relaxed mb-4">{description}</p>
          {supportingCopy && (
            <p className="text-white/60 leading-relaxed mb-10">{supportingCopy}</p>
          )}
          <div className={`flex flex-col sm:flex-row gap-4 justify-center items-center ${supportingCopy ? "" : "mt-10"}`}>
            <CTAButton href={quizUrl} className="text-base px-8 py-3.5">
              {ctaLabel} <ArrowRight className="w-4 h-4 ml-1" />
            </CTAButton>
            {stats.length > 0 && (
              <div className="flex flex-wrap justify-center gap-x-6 gap-y-1 text-white/40 text-sm">
                {stats.map((s) => (
                  <span key={s.label} className="flex items-center gap-1.5">
                    <CheckCircle className="w-3.5 h-3.5 text-[#00B4D8]" /> {s.label}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
