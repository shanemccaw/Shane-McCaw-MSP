import { useState } from "react";
import { Link } from "wouter";
import { CTAButton } from "./CTAButton";
import { ArrowRight, CheckCircle, ChevronLeft, Star, TrendingUp, Award } from "lucide-react";

type TierKey = "Essentials" | "Growth" | "Enterprise";

interface Question {
  text: string;
  options: [string, string, string];
}

const QUESTIONS: Question[] = [
  {
    text: "How many hours of expert M365 support do you realistically need each month?",
    options: [
      "A few focused hours — a monthly strategy call and async Q&A when questions arise",
      "Consistent weekly involvement to keep an active project or modernization moving",
      "Near-daily access — delays in getting expert input cost us time or create compliance risk",
    ],
  },
  {
    text: "How would you describe your current M365 environment?",
    options: [
      "Stable and largely configured — we need oversight and occasional expert guidance",
      "Actively modernizing — Copilot rollout, governance overhaul, or Teams/SharePoint rebuild in progress",
      "Complex and high-stakes — multi-workload, regulated, or enterprise-scale transformation underway",
    ],
  },
  {
    text: "How quickly do you need responses when a critical issue or urgent question arises?",
    options: [
      "Next business day is acceptable for most issues",
      "Within a few hours during business hours",
      "Same day, always — delays cost us operationally or put us at compliance risk",
    ],
  },
  {
    text: "What is your organization's compliance situation?",
    options: [
      "Standard requirements — periodic reviews and general good practices",
      "Active remediation — we're closing audit gaps or preparing for a certification",
      "Continuous obligation — HIPAA, CMMC, FedRAMP, ITAR, or equivalent regulatory scrutiny",
    ],
  },
  {
    text: "How large is your Microsoft 365 environment?",
    options: [
      "Under 500 users — relatively contained with manageable complexity",
      "500–2,000 users with multiple workloads in active use",
      "2,000+ users, multi-entity, or highly complex environment",
    ],
  },
  {
    text: "Do you need hands-on configuration work alongside architectural advice?",
    options: [
      "Primarily advice, documentation, and recommendations — no hands-on builds",
      "A mix — some configuration and policy work alongside strategic direction",
      "Significant hands-on involvement: policy authoring, CoE setup, governance builds",
    ],
  },
  {
    text: "How many Microsoft 365 workloads are you actively managing or modernizing?",
    options: [
      "One or two — primarily Exchange, Teams, or SharePoint in a steady state",
      "Three to five — including Power Platform, Purview, or early Copilot adoption",
      "Six or more — coordinated architectural oversight across all M365 workloads simultaneously",
    ],
  },
  {
    text: "How does your leadership engage with M365 governance today?",
    options: [
      "Informally — IT manages it day-to-day without formal board or leadership visibility",
      "Actively — leadership tracks modernization goals and expects progress updates",
      "Formally — governance is a board-level risk item with documented reporting obligations",
    ],
  },
  {
    text: "How often do you want direct strategic sessions with your architect?",
    options: [
      "Monthly — one strategy call to set priorities and review progress",
      "Twice monthly — staying aligned as projects evolve week to week",
      "Weekly — embedded leadership sessions across multiple active workstreams",
    ],
  },
  {
    text: "What is your primary reason for retaining an M365 architect right now?",
    options: [
      "Expert oversight and peace of mind — without the cost of a full-time hire",
      "Accelerating a specific modernization initiative with consistent senior support",
      "Embedding architectural leadership into a complex, regulated, or high-stakes programme",
    ],
  },
];

const TIER_CONFIG: Record<TierKey, {
  href: string;
  bookHref: string;
  price: string;
  hours: string;
  headline: string;
  explanation: string;
  icon: React.ReactNode;
  accentClass: string;
}> = {
  Essentials: {
    href: "/retainers/architect-essentials",
    bookHref: "/crm/portal/onboarding/select?service=architect-essentials",
    price: "$1,500",
    hours: "10 hrs / month",
    headline: "Architect Essentials",
    explanation:
      "Your answers point to an environment that's stable and well-managed — you need predictable senior access on demand, not weekly delivery pressure. Architect Essentials gives you 10 hours per month: a monthly strategy call, async support whenever questions arise, and a written summary at month-end. The right level of expert oversight without over-investing.",
    icon: <Star className="w-8 h-8 text-[#00B4D8]" />,
    accentClass: "text-[#00B4D8]",
  },
  Growth: {
    href: "/retainers/architect-growth",
    bookHref: "/crm/portal/onboarding/select?service=architect-growth",
    price: "$6,000",
    hours: "25 hrs / month",
    headline: "Architect Growth",
    explanation:
      "Your answers indicate an organization in active motion — modernizing M365, rolling out Copilot, or hardening governance while keeping the lights on. Architect Growth gives you 25 hours per month with 2-hour priority response, two strategy calls, and hands-on configuration support. Enough senior involvement to move your programme forward every week without stalling.",
    icon: <TrendingUp className="w-8 h-8 text-[#00B4D8]" />,
    accentClass: "text-[#00B4D8]",
  },
  Enterprise: {
    href: "/retainers/architect-enterprise",
    bookHref: "/crm/portal/onboarding/select?service=architect-enterprise",
    price: "$11,000",
    hours: "50 hrs / month",
    headline: "Architect Enterprise",
    explanation:
      "Your answers describe a complex, high-stakes environment where architectural decisions carry regulatory, operational, or organizational weight. Architect Enterprise gives you 50 hours per month with same-day response, weekly leadership sessions, governance builds, a dedicated communication channel, and quarterly roadmap reviews with your leadership team. The level of embedded senior oversight your environment demands.",
    icon: <Award className="w-8 h-8 text-[#00B4D8]" />,
    accentClass: "text-[#00B4D8]",
  },
};

function determineTier(scores: Record<TierKey, number>): TierKey {
  if (scores.Enterprise >= scores.Growth && scores.Enterprise >= scores.Essentials) return "Enterprise";
  if (scores.Growth >= scores.Essentials) return "Growth";
  return "Essentials";
}

export function RetainerSelectorQuiz() {
  const [step, setStep] = useState<"quiz" | "results">("quiz");
  const [currentQ, setCurrentQ] = useState(0);
  const [scores, setScores] = useState<Record<TierKey, number>>({ Essentials: 0, Growth: 0, Enterprise: 0 });
  const [selected, setSelected] = useState<number | null>(null);
  const [answers, setAnswers] = useState<number[]>([]);

  const TIERS: TierKey[] = ["Essentials", "Growth", "Enterprise"];

  function handleSelect(optionIdx: number) {
    setSelected(optionIdx);
  }

  function handleNext() {
    if (selected === null) return;
    const tier = TIERS[selected];
    const newScores = { ...scores, [tier]: scores[tier] + 1 };
    const newAnswers = [...answers, selected];

    if (currentQ + 1 >= QUESTIONS.length) {
      setScores(newScores);
      setAnswers(newAnswers);
      setStep("results");
    } else {
      setScores(newScores);
      setAnswers(newAnswers);
      setCurrentQ(currentQ + 1);
      setSelected(null);
    }
  }

  function handleBack() {
    if (currentQ === 0) return;
    const prevAnswers = [...answers];
    const lastAnswer = prevAnswers.pop()!;
    const tier = TIERS[lastAnswer];
    setScores((prev) => ({ ...prev, [tier]: prev[tier] - 1 }));
    setAnswers(prevAnswers);
    setCurrentQ(currentQ - 1);
    setSelected(lastAnswer);
  }

  function handleRestart() {
    setStep("quiz");
    setCurrentQ(0);
    setScores({ Essentials: 0, Growth: 0, Enterprise: 0 });
    setSelected(null);
    setAnswers([]);
  }

  if (step === "results") {
    const recommended = determineTier(scores);
    const config = TIER_CONFIG[recommended];

    return (
      <div className="max-w-[760px] mx-auto">
        <div className="bg-[#0A2540] rounded-2xl p-8 md:p-12 text-center border border-white/10">
          <div className="flex justify-center mb-6">
            {config.icon}
          </div>
          <p className="text-[#00B4D8] text-xs font-bold uppercase tracking-widest mb-3">Your Best-Fit Retainer</p>
          <h2 className="text-3xl md:text-4xl font-extrabold text-white mb-2">{config.headline}</h2>
          <p className="text-white/50 text-sm mb-2">{config.hours}</p>
          <p className="text-[#00B4D8] text-4xl font-extrabold mb-1">{config.price}</p>
          <p className="text-white/40 text-sm mb-8">/month · cancel with 30 days' notice</p>

          <p className="text-white/70 text-base leading-relaxed mb-10 max-w-2xl mx-auto">
            {config.explanation}
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
            <CTAButton href={config.href} className="px-8 py-4 text-base">
              See the {config.headline} Plan
            </CTAButton>
            <Link
              href="/book"
              className="inline-flex items-center justify-center gap-2 text-white/70 hover:text-white font-medium text-base transition-colors border border-white/20 px-8 py-4 rounded-xl hover:border-white/40"
            >
              Book a Discovery Call <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          <div className="border-t border-white/10 pt-8">
            <p className="text-white/40 text-sm mb-5">Compare all retainer tiers</p>
            <div className="grid grid-cols-3 gap-3">
              {(["Essentials", "Growth", "Enterprise"] as TierKey[]).map((tier) => {
                const cfg = TIER_CONFIG[tier];
                const isCurrent = tier === recommended;
                return (
                  <Link
                    key={tier}
                    href={cfg.href}
                    className={`rounded-xl border p-3 text-center transition-all ${
                      isCurrent
                        ? "bg-[#0078D4] border-[#0078D4] text-white shadow-md"
                        : "bg-white/5 border-white/10 text-white/70 hover:border-white/30 hover:text-white"
                    }`}
                  >
                    <p className={`text-[10px] font-bold uppercase tracking-wide mb-0.5 ${isCurrent ? "text-white/70" : "text-white/40"}`}>{cfg.hours}</p>
                    <p className="font-extrabold text-sm">{cfg.headline}</p>
                    <p className={`text-xs font-semibold mt-0.5 ${isCurrent ? "text-white/80" : "text-[#00B4D8]"}`}>{cfg.price}/mo</p>
                  </Link>
                );
              })}
            </div>
          </div>

          <button
            onClick={handleRestart}
            className="mt-6 text-white/30 hover:text-white/60 text-sm transition-colors"
          >
            Retake the quiz
          </button>
        </div>
      </div>
    );
  }

  const question = QUESTIONS[currentQ];
  const progress = ((currentQ) / QUESTIONS.length) * 100;

  return (
    <div className="max-w-[760px] mx-auto">
      {/* Progress bar */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <p className="text-white/50 text-sm font-medium">Question {currentQ + 1} of {QUESTIONS.length}</p>
          <p className="text-white/30 text-xs">{Math.round(progress)}% complete</p>
        </div>
        <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full bg-[#0078D4] rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Question card */}
      <div className="bg-white/5 border border-white/10 rounded-2xl p-8 md:p-10">
        <h3 className="text-xl md:text-2xl font-extrabold text-white mb-8 leading-snug">
          {question.text}
        </h3>

        <div className="space-y-3">
          {question.options.map((option, idx) => {
            const letter = ["A", "B", "C"][idx];
            const isSelected = selected === idx;
            return (
              <button
                key={idx}
                onClick={() => handleSelect(idx)}
                className={`w-full text-left flex items-start gap-4 p-5 rounded-xl border transition-all ${
                  isSelected
                    ? "border-[#0078D4] bg-[#0078D4]/10 text-white"
                    : "border-white/10 bg-white/3 text-white/70 hover:border-white/25 hover:text-white hover:bg-white/5"
                }`}
              >
                <span className={`flex-shrink-0 w-7 h-7 rounded-full border flex items-center justify-center text-xs font-bold transition-all ${
                  isSelected ? "border-[#0078D4] bg-[#0078D4] text-white" : "border-white/20 text-white/40"
                }`}>
                  {isSelected ? <CheckCircle className="w-4 h-4" /> : letter}
                </span>
                <span className="text-sm leading-relaxed pt-0.5">{option}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between mt-8">
          <button
            onClick={handleBack}
            disabled={currentQ === 0}
            className="flex items-center gap-1.5 text-white/40 hover:text-white/70 text-sm font-medium transition-colors disabled:opacity-0 disabled:pointer-events-none"
          >
            <ChevronLeft className="w-4 h-4" />
            Back
          </button>

          <button
            onClick={handleNext}
            disabled={selected === null}
            className="flex items-center gap-2 bg-[#0078D4] hover:bg-[#0066B8] disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold px-6 py-3 rounded-xl transition-colors text-sm"
          >
            {currentQ + 1 === QUESTIONS.length ? "See my result" : "Next question"}
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
