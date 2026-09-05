import { Link, useRoute } from "wouter";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";
import { HowWorkingWithShaneGoes } from "@/components/solutions/HowWorkingWithShaneGoes";
import { SolutionsClosePanel } from "@/components/solutions/SolutionsClosePanel";
import { getSolutionTopic, accentRgba, type SolutionTopic } from "@/data/solutionsDeepDive";
import { SOLUTION_TOPICS } from "@/data/solutionsDeepDive";
import NotFound from "@/pages/not-found";

const GRADIENT_BG = { background: "linear-gradient(90deg,#3b82f6,#8b5cf6)" };

const CHECK_ROW_ITEMS = ["Read-only review, run by Shane", "Nothing installed", "NASA contractors and partners excluded"];

const ROW_COLORS = ["#60a5fa", "#fbbf24", "#f87171"] as const;

function heroBackground(topic: SolutionTopic): string {
  if (topic.isFlagship) {
    return "radial-gradient(circle 1100px at 80% -20%, rgba(59,130,246,.16), rgba(2,6,23,0) 62%), radial-gradient(circle 900px at 10% 100%, rgba(139,92,246,.14), rgba(2,6,23,0) 66%)";
  }
  return `radial-gradient(circle 1100px at 76% -20%, ${accentRgba(topic.accent, 0.12)}, rgba(2,6,23,0) 62%), radial-gradient(circle 800px at 6% 12%, rgba(0,120,212,.06), rgba(2,6,23,0) 66%)`;
}

function panelStyle(topic: SolutionTopic): React.CSSProperties {
  if (topic.isFlagship) {
    return {
      border: "1px solid rgba(139,92,246,.28)",
      background: "linear-gradient(160deg,rgba(59,130,246,.14),rgba(139,92,246,.10) 45%,rgba(11,21,36,.5) 80%)",
      boxShadow: "0 0 70px rgba(139,92,246,.18), inset 0 1px 0 rgba(148,163,184,.08)",
    };
  }
  return {
    border: `1px solid ${accentRgba(topic.accent, 0.22)}`,
    background: `linear-gradient(160deg,${accentRgba(topic.accent, 0.1)},rgba(11,21,36,.52) 55%,rgba(11,21,36,.34))`,
    boxShadow: `0 0 60px ${accentRgba(topic.accent, 0.13)}, inset 0 1px 0 rgba(148,163,184,.08)`,
  };
}

/**
 * Solution deep-dive topic page — Design/fractional_architecture/README.md §8, Git #2961.
 * One shared template, driven entirely by the SOLUTION_TOPICS data array — not eight
 * separate component builds. Route: /solutions/:slug.
 */
export default function SolutionTopicPage() {
  const [, params] = useRoute("/solutions/:slug");
  const topic = getSolutionTopic(params?.slug);

  if (!topic) return <NotFound />;

  const Icon = topic.icon;

  return (
    <Layout>
      <SEOMeta
        title={`${topic.label} Deep Dive | Shane McCaw Consulting`}
        description={topic.indexExcerpt}
      />

      {/* Hero */}
      <section className="relative overflow-hidden" style={{ background: heroBackground(topic) }}>
        <span
          className="absolute pointer-events-none"
          style={{
            right: -60,
            top: "50%",
            transform: "translateY(-50%)",
            opacity: topic.isFlagship ? 0.16 : 0.11,
            color: topic.accent,
            filter: topic.isFlagship
              ? "drop-shadow(0 0 30px rgba(139,92,246,.4))"
              : `drop-shadow(0 0 26px ${accentRgba(topic.accent, 0.3)})`,
          }}
          aria-hidden="true"
        >
          <Icon width={470} height={470} strokeWidth={0.8} />
        </span>

        <div className="relative max-w-[1160px] mx-auto px-4 sm:px-6 lg:px-8 pt-32 sm:pt-40 pb-10 sm:pb-16 grid grid-cols-1 xl:grid-cols-2 gap-9 sm:gap-16 items-center">
          <div className="max-w-[600px]">
            <div className="flex items-center gap-3">
              <span className="w-[26px] h-px" style={{ background: "linear-gradient(90deg,#00B4D8,rgba(0,180,216,.15))" }} />
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#00B4D8]">
                Deep dive · {topic.label}
              </span>
            </div>
            <h1 className="text-[26px] sm:text-[32px] lg:text-[38px] leading-[1.12] tracking-[-0.022em] font-extrabold text-[#f8fafc] mt-[22px] mb-[18px]">
              {topic.h1}{" "}
              {topic.isFlagship ? (
                <span
                  style={{
                    background: "linear-gradient(90deg,#3b82f6,#8b5cf6)",
                    WebkitBackgroundClip: "text",
                    backgroundClip: "text",
                    color: "transparent",
                  }}
                >
                  {topic.h1Accent}
                </span>
              ) : (
                <span style={{ color: topic.accent }}>{topic.h1Accent}</span>
              )}
            </h1>
            <p className="text-[15px] sm:text-[17px] leading-[1.65] text-[#94a3b8] mb-3">{topic.lead}</p>
            <p className="text-sm leading-[1.65] text-[#94a3b8] mb-7">{topic.sub}</p>
            <div className="flex flex-wrap gap-3 items-center">
              <Link
                href="/#tiers"
                className="inline-flex items-center justify-center gap-2 min-h-[52px] px-[26px] rounded-xl text-base font-semibold text-white transition-opacity hover:opacity-90"
                style={GRADIENT_BG}
                data-track="cta"
              >
                Work with Shane on this · from $900/mo <ArrowRight className="w-4 h-4" />
              </Link>
              <Link
                href="/contact"
                className="inline-flex items-center justify-center min-h-[52px] px-[22px] rounded-xl text-base font-semibold text-[#e2e8f0] border border-[rgba(148,163,184,0.3)] hover:border-[#00B4D8] hover:text-[#f8fafc] transition-colors"
                data-track="cta"
              >
                Talk to Shane first
              </Link>
            </div>
            <div className="flex flex-wrap gap-x-[22px] gap-y-2.5 mt-[26px] text-[13px] text-[#94a3b8]">
              {CHECK_ROW_ITEMS.map((item) => (
                <span key={item} className="flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 text-[#00B4D8]" strokeWidth={2.5} />
                  {item}
                </span>
              ))}
            </div>
          </div>

          <div
            className="justify-self-end w-full max-w-[500px] rounded-[18px] p-[22px_24px] backdrop-blur-[3px]"
            style={panelStyle(topic)}
          >
            <div className="flex items-center justify-between gap-2.5 mb-[18px] flex-wrap">
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#00B4D8]">
                What Shane's review typically finds
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#94a3b8]">
                Illustrative, not your tenant
              </span>
            </div>
            <div className="flex flex-col gap-4">
              {topic.rows.map((row, i) => (
                <div key={row.label} className="flex flex-col gap-1.5">
                  <div className="flex items-baseline justify-between gap-2.5">
                    <span className="text-[13px] font-semibold text-[#e2e8f0]">{row.label}</span>
                    <b className="text-[15px] font-extrabold tabular-nums" style={{ color: ROW_COLORS[i] }}>
                      {row.value}
                    </b>
                  </div>
                  <div className="h-2.5 rounded-full bg-[rgba(2,6,23,0.7)] overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${row.pct}%`,
                        background: `linear-gradient(90deg, ${accentRgba(ROW_COLORS[i], 0.25)}, ${ROW_COLORS[i]})`,
                      }}
                    />
                  </div>
                  <span className="text-xs leading-[1.5] text-[#94a3b8]">{row.sub}</span>
                </div>
              ))}
            </div>
            <p className="mt-[18px] pt-3.5 border-t border-[rgba(30,41,59,0.9)] text-[12.5px] leading-[1.55] text-[#94a3b8]">
              {topic.panelNote}
            </p>
          </div>
        </div>
      </section>

      {/* Two paths */}
      <section className="border-t border-b border-[rgba(30,41,59,0.8)] bg-[rgba(15,23,42,0.4)]">
        <div className="max-w-[1160px] mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-16">
          <div className="max-w-[720px] mb-[26px]">
            <div className="flex items-center gap-3">
              <span className="w-[26px] h-px" style={{ background: "linear-gradient(90deg,#00B4D8,rgba(0,180,216,.15))" }} />
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#00B4D8]">
                {topic.pathsEyebrow}
              </span>
            </div>
            <h2 className="text-[24px] sm:text-[34px] leading-[1.14] tracking-[-0.025em] font-extrabold text-[#f8fafc] mt-[14px] mb-3">
              {topic.pathsH2}
            </h2>
            <p className="text-[15px] leading-[1.65] text-[#94a3b8]">{topic.pathsLead}</p>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-[rgba(248,113,113,0.28)] bg-[rgba(15,23,42,0.6)] p-[22px]">
              <span className="inline-flex px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-[0.12em] bg-[rgba(248,113,113,0.1)] border border-[rgba(248,113,113,0.3)] text-[#f87171] mb-4">
                How it usually goes
              </span>
              <div className="flex flex-col">
                {topic.badPath.map((step, i) => {
                  const isLast = i === topic.badPath.length - 1;
                  return (
                    <div key={step.title} className="flex gap-3">
                      <div className="flex flex-col items-center flex-none">
                        {isLast ? (
                          <span
                            className="w-[11px] h-[11px] rounded-full flex-none mt-1"
                            style={{ background: "#f87171", boxShadow: "0 0 0 3px rgba(248,113,113,.15)" }}
                          />
                        ) : (
                          <span className="w-[11px] h-[11px] rounded-full flex-none mt-1 border-2 border-[#94a3b8] bg-transparent" />
                        )}
                        {!isLast && <span className="w-px flex-1 min-h-[18px] bg-[rgba(148,163,184,0.18)]" />}
                      </div>
                      <div className="pb-4 min-w-0">
                        <div className="text-sm font-bold text-[#f8fafc]">{step.title}</div>
                        <div className="text-[13px] text-[#94a3b8] leading-[1.55] mt-0.5">{step.body}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="rounded-2xl border border-[rgba(0,180,216,0.35)] bg-[rgba(15,23,42,0.6)] p-[22px]">
              <span className="inline-flex px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-[0.12em] bg-[rgba(0,180,216,0.1)] border border-[rgba(0,180,216,0.3)] text-[#00B4D8] mb-4">
                How it goes with Shane
              </span>
              <div className="flex flex-col">
                {topic.goodPath.map((step, i) => {
                  const isLast = i === topic.goodPath.length - 1;
                  return (
                    <div key={step.title} className="flex gap-3">
                      <div className="flex flex-col items-center flex-none">
                        {isLast ? (
                          <span
                            className="w-[11px] h-[11px] rounded-full flex-none mt-1"
                            style={{ background: "#00B4D8", boxShadow: "0 0 0 3px rgba(0,180,216,.18)" }}
                          />
                        ) : (
                          <span
                            className="w-[11px] h-[11px] rounded-full flex-none mt-1"
                            style={{ background: "#0078D4", boxShadow: "0 0 0 3px rgba(0,120,212,.18)" }}
                          />
                        )}
                        {!isLast && <span className="w-px flex-1 min-h-[18px] bg-[rgba(148,163,184,0.18)]" />}
                      </div>
                      <div className="pb-4 min-w-0">
                        <div className="text-sm font-bold text-[#f8fafc]">{step.title}</div>
                        <div className="text-[13px] text-[#94a3b8] leading-[1.55] mt-0.5">{step.body}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* The work, by name */}
      <section className="max-w-[1160px] mx-auto px-4 sm:px-6 lg:px-8 pt-12 sm:pt-[72px] pb-6 sm:pb-10">
        <div className="max-w-[760px] mb-6">
          <div className="flex items-center gap-3">
            <span className="w-[26px] h-px" style={{ background: "linear-gradient(90deg,#00B4D8,rgba(0,180,216,.15))" }} />
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#00B4D8]">
              The work, by name
            </span>
          </div>
          <h2 className="text-[24px] sm:text-[34px] leading-[1.14] tracking-[-0.025em] font-extrabold text-[#f8fafc] mt-[14px] mb-3">
            {topic.workH2}
          </h2>
          <p className="text-[15px] leading-[1.65] text-[#94a3b8]">
            Retainer hours are advisory: reviews, decisions, the call on which of two designs to ship. Delivery
            work becomes a fixed-price statement of work you approve before it starts. The price depends on what
            the review finds and how many people it touches, so it is quoted after the review, not before.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          {topic.projects.map((project) => (
            <div
              key={project.name}
              className="rounded-2xl border border-[rgba(30,41,59,0.9)] bg-[rgba(15,23,42,0.5)] p-5 flex flex-col gap-2 hover:border-[rgba(0,120,212,0.4)] transition-colors"
            >
              <span className="text-[15px] font-bold text-[#f8fafc] leading-[1.35] tracking-[-0.01em]">
                {project.name}
              </span>
              <span className="text-[13px] text-[#94a3b8] leading-[1.6] flex-grow">{project.body}</span>
              <div className="mt-2 pt-3 border-t border-[rgba(30,41,59,0.9)]">
                <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#00B4D8]">
                  {project.when}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Deep dive switcher */}
      <section className="max-w-[1160px] mx-auto px-4 sm:px-6 lg:px-8 pb-10 sm:pb-16">
        <div className="flex items-center gap-2.5 flex-wrap rounded-[14px] border border-[rgba(30,41,59,0.9)] bg-[rgba(15,23,42,0.5)] px-[18px] py-3.5">
          <Link
            href="/solutions"
            className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#94a3b8] hover:text-[#f8fafc] mr-1 no-underline"
          >
            <ArrowLeft className="w-3 h-3" /> All solutions
          </Link>
          {SOLUTION_TOPICS.map((p) => {
            const active = p.slug === topic.slug;
            return active ? (
              <span
                key={p.slug}
                className="px-3.5 py-2 rounded-full text-xs font-bold text-[#f8fafc] whitespace-nowrap"
                style={{ border: "1px solid rgba(0,180,216,.5)", background: "rgba(0,180,216,.1)" }}
              >
                {p.label}
              </span>
            ) : (
              <Link
                key={p.slug}
                href={`/solutions/${p.slug}`}
                className="px-3.5 py-2 rounded-full text-xs font-semibold text-[#cbd5e1] border border-[rgba(30,41,59,0.9)] hover:text-[#f8fafc] hover:border-[rgba(0,180,216,0.4)] whitespace-nowrap no-underline transition-colors"
              >
                {p.label}
              </Link>
            );
          })}
        </div>
      </section>

      <HowWorkingWithShaneGoes />

      <SolutionsClosePanel headline={`Bring the ${topic.short} decision. Leave with the answer.`} />
    </Layout>
  );
}
