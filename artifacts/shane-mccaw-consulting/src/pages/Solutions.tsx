import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";
import { HowWorkingWithShaneGoes } from "@/components/solutions/HowWorkingWithShaneGoes";
import { SolutionsClosePanel } from "@/components/solutions/SolutionsClosePanel";
import { SOLUTION_TOPICS, accentRgba } from "@/data/solutionsDeepDive";

/**
 * Solutions index — Design/fractional_architecture/README.md §7, Git #2961.
 * Hero + 8-link-card grid (Copilot highlighted) driven entirely by SOLUTION_TOPICS,
 * then the shared "How working with Shane goes" section and close panel.
 */
export default function Solutions() {
  return (
    <Layout>
      <SEOMeta
        title="Solutions | Shane McCaw Consulting"
        description="Eight Microsoft 365 deep dives — Copilot & AI, Security & Compliance, Governance, SharePoint, Power Platform, Teams, Migration, M365 Health. What Shane's read-only review typically finds, and the projects it leads to."
      />

      {/* Hero */}
      <section
        className="relative overflow-hidden pt-32 sm:pt-40 pb-7 sm:pb-10 px-4 sm:px-6 lg:px-8"
        style={{
          background:
            "radial-gradient(circle 1100px at 76% -20%, rgba(139,92,246,.12), rgba(2,6,23,0) 62%), radial-gradient(circle 800px at 6% 12%, rgba(0,120,212,.06), rgba(2,6,23,0) 66%)",
        }}
      >
        <div className="max-w-[1160px] mx-auto relative">
          <div className="flex items-center gap-3">
            <span className="w-[26px] h-px" style={{ background: "linear-gradient(90deg,#00B4D8,rgba(0,180,216,.15))" }} />
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#00B4D8]">
              Solutions · Eight Deep Dives
            </span>
          </div>
          <h1 className="text-[28px] sm:text-[34px] lg:text-[42px] leading-[1.1] tracking-[-0.022em] font-extrabold text-[#f8fafc] mt-[22px] mb-5 max-w-[820px]">
            Pick the part of the tenant that is keeping you up.{" "}
            <span className="text-[#a78bfa]">Shane has run it at NASA scale.</span>
          </h1>
          <p className="text-base sm:text-lg leading-relaxed text-[#94a3b8] max-w-[720px]">
            Each deep dive shows what Shane's read-only review typically finds, how the work usually goes wrong,
            how it goes with him, and the projects that surface after the review. Same architect, same retainer,
            from $900 a month.
          </p>
        </div>
      </section>

      {/* 8-link-card grid, Copilot highlighted */}
      <section className="max-w-[1160px] mx-auto px-4 sm:px-6 lg:px-8 pt-5 sm:pt-8 pb-12 sm:pb-20">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {SOLUTION_TOPICS.map((topic) => {
            const Icon = topic.icon;
            return (
              <Link
                key={topic.slug}
                href={`/solutions/${topic.slug}`}
                className="flex flex-col gap-3 rounded-2xl p-6 no-underline transition-[border-color,transform] duration-200 hover:-translate-y-[3px]"
                style={
                  topic.isFlagship
                    ? {
                        border: "1px solid rgba(139,92,246,.3)",
                        background:
                          "linear-gradient(160deg,rgba(59,130,246,.12),rgba(139,92,246,.08) 45%,rgba(15,23,42,.5) 80%)",
                      }
                    : {
                        border: "1px solid rgba(30,41,59,.9)",
                        background: "rgba(15,23,42,.5)",
                      }
                }
                data-testid={`solution-card-${topic.slug}`}
                data-track="nav"
              >
                <div className="flex items-center gap-3">
                  <span
                    className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                    style={{
                      background: accentRgba(topic.accent, 0.1),
                      border: `1px solid ${accentRgba(topic.accent, 0.25)}`,
                      color: topic.accent,
                    }}
                  >
                    <Icon className="w-5 h-5" />
                  </span>
                  <span
                    className="text-[11px] font-bold uppercase tracking-[0.14em]"
                    style={{ color: topic.accent }}
                  >
                    {topic.label}
                  </span>
                </div>
                <span className="text-[19px] font-bold tracking-[-0.015em] text-[#f8fafc] leading-[1.3]">
                  {topic.indexHeadline}
                </span>
                <span className="text-sm leading-[1.6] text-[#94a3b8] flex-1">{topic.indexExcerpt}</span>
                <span className="flex items-center gap-1.5 text-[13px] font-semibold text-[#00B4D8] mt-1">
                  {topic.indexLinkWord} deep dive <ArrowRight className="w-3.5 h-3.5" />
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      <HowWorkingWithShaneGoes />

      <SolutionsClosePanel headline="Bring the decision. Leave with the answer." />
    </Layout>
  );
}
