import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import { CheckCircle, ChevronRight, RotateCcw, ArrowRight, Loader2 } from "lucide-react";
import { CTAButton } from "./CTAButton";
import { useToast } from "@/hooks/use-toast";

// ── Types ──────────────────────────────────────────────────────────────────────

type Slug =
  | "tenant-health-audit"
  | "power-platform-quick-start"
  | "governance-foundations"
  | "migration-readiness-assessment"
  | "copilot-readiness-assessment"
  | "m365-training-enablement";

interface Answer {
  text: string;
  scores: Partial<Record<Slug, number>>;
}

interface Question {
  id: number;
  text: string;
  answers: Answer[];
}

// ── Package metadata ───────────────────────────────────────────────────────────

const PACKAGES: Record<Slug, { name: string; tagline: string; href: string }> = {
  "tenant-health-audit": {
    name: "M365 Tenant Health Audit",
    tagline:
      "A deep-dive audit of your entire tenant — security posture, licensing efficiency, governance gaps, and a prioritised remediation roadmap.",
    href: "/micro-offers/tenant-health-audit",
  },
  "power-platform-quick-start": {
    name: "Power Platform Quick-Start",
    tagline:
      "Get your first Power Automate flow or Power App live in days — automating a real business process with a proven delivery framework.",
    href: "/micro-offers/power-platform-quick-start",
  },
  "governance-foundations": {
    name: "Governance Foundations Package",
    tagline:
      "Establish policies, naming conventions, lifecycle rules, and a DLP framework that keeps your tenant compliant and manageable long-term.",
    href: "/micro-offers/governance-foundations",
  },
  "migration-readiness-assessment": {
    name: "Migration Readiness Assessment",
    tagline:
      "A structured pre-migration review covering your source environment, data risks, cutover plan, and the blockers most teams miss.",
    href: "/micro-offers/migration-readiness-assessment",
  },
  "copilot-readiness-assessment": {
    name: "Copilot for M365 Readiness Assessment",
    tagline:
      "Evaluate whether your tenant's data governance, identity, and adoption practices are ready for Copilot AI deployment.",
    href: "/micro-offers/copilot-readiness-assessment",
  },
  "m365-training-enablement": {
    name: "Microsoft 365 Training & Enablement",
    tagline:
      "Targeted end-user and admin training that closes the adoption gap and unlocks the ROI already sitting inside your M365 licences.",
    href: "/micro-offers/m365-training-enablement",
  },
};

// ── Quiz questions ─────────────────────────────────────────────────────────────

const QUESTIONS: Question[] = [
  {
    id: 1,
    text: "What best describes your organization's biggest Microsoft 365 challenge right now?",
    answers: [
      {
        text: "We don't know what's misconfigured or where our security gaps are",
        scores: { "tenant-health-audit": 3 },
      },
      {
        text: "We have too many manual, repetitive processes we want to automate",
        scores: { "power-platform-quick-start": 3 },
      },
      {
        text: "Our governance is ad hoc — no naming conventions, policies, or lifecycle rules",
        scores: { "governance-foundations": 3 },
      },
      {
        text: "We're preparing to migrate or consolidate our environment",
        scores: { "migration-readiness-assessment": 3 },
      },
    ],
  },
  {
    id: 2,
    text: "When did you last conduct a formal audit of your Microsoft 365 tenant?",
    answers: [
      { text: "Never — we've never had a structured review", scores: { "tenant-health-audit": 3 } },
      {
        text: "A year or more ago",
        scores: { "tenant-health-audit": 2, "governance-foundations": 1 },
      },
      {
        text: "Within the last 6 months",
        scores: { "copilot-readiness-assessment": 1, "power-platform-quick-start": 1 },
      },
      {
        text: "We audit continuously — we're looking for what's next",
        scores: { "copilot-readiness-assessment": 2, "power-platform-quick-start": 1 },
      },
    ],
  },
  {
    id: 3,
    text: "Are you planning to deploy Microsoft Copilot for M365?",
    answers: [
      {
        text: "Yes — and we want to make sure we're ready before we roll it out",
        scores: { "copilot-readiness-assessment": 3 },
      },
      {
        text: "Interested, but we're not sure our environment is ready",
        scores: { "copilot-readiness-assessment": 2, "tenant-health-audit": 1 },
      },
      {
        text: "Not yet — we have more foundational issues to address first",
        scores: { "tenant-health-audit": 1, "governance-foundations": 1 },
      },
      {
        text: "Our staff barely use the tools we already have",
        scores: { "m365-training-enablement": 3 },
      },
    ],
  },
  {
    id: 4,
    text: "How would you describe your organization's data governance today?",
    answers: [
      {
        text: "No formal policies — it's grown organically with no structure",
        scores: { "governance-foundations": 3 },
      },
      {
        text: "Policies exist on paper but aren't consistently enforced",
        scores: { "governance-foundations": 2, "tenant-health-audit": 1 },
      },
      {
        text: "Reasonable governance in place, with some gaps",
        scores: { "tenant-health-audit": 1, "copilot-readiness-assessment": 1 },
      },
      {
        text: "Strong governance framework — we're ready to expand capabilities",
        scores: { "copilot-readiness-assessment": 2, "power-platform-quick-start": 1 },
      },
    ],
  },
  {
    id: 5,
    text: "Are you migrating to Microsoft 365 (from on-premises Exchange, Google Workspace, or another tenant)?",
    answers: [
      {
        text: "Yes — migration is on the roadmap for the next 12 months",
        scores: { "migration-readiness-assessment": 3 },
      },
      {
        text: "We're in the early evaluation phase",
        scores: { "migration-readiness-assessment": 2, "tenant-health-audit": 1 },
      },
      {
        text: "We've recently migrated and want to validate the result",
        scores: { "tenant-health-audit": 2, "governance-foundations": 1 },
      },
      {
        text: "No migration planned — we're already fully in M365",
        scores: { "power-platform-quick-start": 1, "m365-training-enablement": 1 },
      },
    ],
  },
  {
    id: 6,
    text: "How effectively is your team actually using Microsoft 365 tools day-to-day?",
    answers: [
      {
        text: "Poorly — most staff only use email and basic Teams calls",
        scores: { "m365-training-enablement": 3 },
      },
      {
        text: "Mixed — power users get value but most staff don't",
        scores: { "m365-training-enablement": 2, "power-platform-quick-start": 1 },
      },
      {
        text: "Reasonably well, though automation and Power Platform are underused",
        scores: { "power-platform-quick-start": 2, "m365-training-enablement": 1 },
      },
      {
        text: "Very effectively — we're looking to add advanced capabilities",
        scores: { "copilot-readiness-assessment": 2, "power-platform-quick-start": 1 },
      },
    ],
  },
  {
    id: 7,
    text: "Do you have manual, repetitive processes that could benefit from automation?",
    answers: [
      {
        text: "Yes — approvals, notifications, data entry happen manually every day",
        scores: { "power-platform-quick-start": 3 },
      },
      {
        text: "A few key workflows could be automated but we've never prioritised it",
        scores: { "power-platform-quick-start": 2, "governance-foundations": 1 },
      },
      {
        text: "We've tried Power Automate but it didn't stick",
        scores: { "power-platform-quick-start": 2, "m365-training-enablement": 1 },
      },
      {
        text: "Not really — automation isn't our immediate priority",
        scores: { "tenant-health-audit": 1, "governance-foundations": 1 },
      },
    ],
  },
  {
    id: 8,
    text: "How many users are in your Microsoft 365 tenant?",
    answers: [
      {
        text: "Fewer than 50",
        scores: { "tenant-health-audit": 1, "m365-training-enablement": 1 },
      },
      {
        text: "50–250",
        scores: {
          "governance-foundations": 1,
          "power-platform-quick-start": 1,
          "tenant-health-audit": 1,
        },
      },
      {
        text: "251–1,000",
        scores: { "migration-readiness-assessment": 1, "governance-foundations": 1 },
      },
      {
        text: "More than 1,000",
        scores: {
          "copilot-readiness-assessment": 1,
          "governance-foundations": 2,
          "migration-readiness-assessment": 1,
        },
      },
    ],
  },
  {
    id: 9,
    text: "Is your organization subject to compliance frameworks (HIPAA, FedRAMP, ISO 27001, GDPR, etc.)?",
    answers: [
      {
        text: "Yes — and we're not confident our M365 config meets those requirements",
        scores: { "governance-foundations": 3, "tenant-health-audit": 2 },
      },
      {
        text: "Yes — we have controls in place but want an independent review",
        scores: { "tenant-health-audit": 2, "governance-foundations": 1 },
      },
      {
        text: "No formal frameworks, but security matters a lot to us",
        scores: { "tenant-health-audit": 2 },
      },
      {
        text: "Not really — compliance is not a major driver for us right now",
        scores: { "power-platform-quick-start": 1, "m365-training-enablement": 1 },
      },
    ],
  },
  {
    id: 10,
    text: "What outcome would make this investment most worthwhile for you?",
    answers: [
      {
        text: "A clear picture of every risk and misconfiguration in our tenant",
        scores: { "tenant-health-audit": 3 },
      },
      {
        text: "A working automation that saves us real time each week",
        scores: { "power-platform-quick-start": 3 },
      },
      {
        text: "A governance framework that keeps our environment clean long-term",
        scores: { "governance-foundations": 3 },
      },
      {
        text: "Confidence that our AI or migration initiative won't fail at the foundation",
        scores: { "copilot-readiness-assessment": 2, "migration-readiness-assessment": 2 },
      },
    ],
  },
];

// ── Component ──────────────────────────────────────────────────────────────────

type Phase = "intro" | "quiz" | "submitting" | "results";

const INITIAL_SCORES: Record<Slug, number> = {
  "tenant-health-audit": 0,
  "power-platform-quick-start": 0,
  "governance-foundations": 0,
  "migration-readiness-assessment": 0,
  "copilot-readiness-assessment": 0,
  "m365-training-enablement": 0,
};

export function QuickWinsSelectorQuiz() {
  const [phase, setPhase] = useState<Phase>("intro");
  const [currentQ, setCurrentQ] = useState(0);
  const [scores, setScores] = useState<Record<Slug, number>>({ ...INITIAL_SCORES });
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<number | null>(null);
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const total = QUESTIONS.length;
  const question = QUESTIONS[currentQ];

  function handleSelect(answerIdx: number) {
    setSelected(answerIdx);
  }

  async function handleNext() {
    if (selected === null) return;
    const answer = question.answers[selected];

    const nextScores = { ...scores };
    for (const [slug, pts] of Object.entries(answer.scores) as [Slug, number][]) {
      nextScores[slug] = (nextScores[slug] ?? 0) + pts;
    }
    const nextAnswers = { ...answers, [String(question.id)]: selected };

    setScores(nextScores);
    setAnswers(nextAnswers);
    setSelected(null);

    if (currentQ < total - 1) {
      setCurrentQ((q) => q + 1);
    } else {
      const rankedSlugs = (Object.entries(nextScores) as [Slug, number][])
        .sort(([, a], [, b]) => b - a)
        .filter(([, s]) => s > 0)
        .map(([slug]) => slug);

      setPhase("submitting");
      try {
        const res = await fetch("/api/quiz/quick-win/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answers: nextAnswers, scores: nextScores, rankedSlugs }),
        });
        if (!res.ok) throw new Error("Submit failed");
        const data = (await res.json()) as { resultId: number };
        navigate(`/quick-win/results/${data.resultId}`);
      } catch {
        toast({
          title: "Couldn't save your results",
          description: "Your recommendations are shown below — save or bookmark this page.",
          variant: "destructive",
        });
        setPhase("results");
      }
    }
  }

  function restart() {
    setPhase("intro");
    setCurrentQ(0);
    setSelected(null);
    setScores({ ...INITIAL_SCORES });
    setAnswers({});
  }

  const topSlugs = (Object.entries(scores) as [Slug, number][])
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .filter(([, s]) => s > 0)
    .map(([slug]) => slug);

  // Fire-and-forget: record recommended slugs when results phase first renders
  const recordedRef = useRef(false);
  useEffect(() => {
    if (phase !== "results" || topSlugs.length === 0 || recordedRef.current) return;
    recordedRef.current = true;
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    fetch(`${base}/api/quiz-selector/result`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slugs: topSlugs }),
    }).catch(() => {
      // silently ignore — analytics failure must not affect UX
    });
  }, [phase, topSlugs]);

  // ── Intro ──────────────────────────────────────────────────────────────────
  if (phase === "intro") {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="bg-white rounded-2xl border border-border shadow-sm p-10 text-center">
          <div className="w-14 h-14 rounded-2xl bg-[#0078D4]/10 flex items-center justify-center mx-auto mb-6">
            <CheckCircle className="w-7 h-7 text-[#0078D4]" />
          </div>
          <h2 className="text-2xl md:text-3xl font-extrabold text-[#0A2540] mb-4">
            Find Your Best-Fit Quick Win
          </h2>
          <p className="text-muted-foreground leading-relaxed mb-3">
            Answer 10 short questions about your Microsoft 365 environment and priorities. We'll
            recommend the Quick Win packages best matched to your situation — no discovery call
            required.
          </p>
          <p className="text-sm text-muted-foreground mb-8">
            Takes around <span className="font-semibold text-[#0A2540]">2–3 minutes</span>.
          </p>
          <button
            onClick={() => setPhase("quiz")}
            className="inline-flex items-center gap-2 bg-[#0078D4] hover:bg-[#0068BE] text-white font-bold px-8 py-3.5 rounded-xl transition-colors text-sm"
          >
            Start the Quiz <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  // ── Submitting ─────────────────────────────────────────────────────────────
  if (phase === "submitting") {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="bg-white rounded-2xl border border-border shadow-sm p-12 text-center">
          <Loader2 className="w-10 h-10 text-[#0078D4] animate-spin mx-auto mb-5" />
          <p className="text-[#0A2540] font-semibold text-base">Preparing your results…</p>
        </div>
      </div>
    );
  }

  // ── Inline Results (fallback when API submit fails) ────────────────────────
  if (phase === "results") {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 bg-[#0078D4]/10 text-[#0078D4] px-4 py-1.5 rounded-full text-sm font-semibold mb-4">
            <CheckCircle className="w-4 h-4" />
            Quiz complete
          </div>
          <h2 className="text-2xl md:text-3xl font-extrabold text-[#0A2540] mb-3">
            Your Recommended Quick Wins
          </h2>
          <p className="text-muted-foreground max-w-xl mx-auto leading-relaxed">
            Based on your answers, these packages are the best match for your current situation.
          </p>
        </div>

        <div className="space-y-4 mb-10">
          {topSlugs.map((slug, i) => {
            const pkg = PACKAGES[slug];
            return (
              <div
                key={slug}
                className={`bg-white rounded-2xl border shadow-sm p-6 flex flex-col sm:flex-row sm:items-start gap-5 ${
                  i === 0 ? "border-[#0078D4]/40 ring-1 ring-[#0078D4]/20" : "border-border"
                }`}
              >
                <div className="flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-xl bg-[#0A2540] text-white font-extrabold text-sm">
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  {i === 0 && (
                    <span className="inline-block text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-[#0078D4]/10 text-[#0078D4] border border-[#0078D4]/20 mb-2">
                      Best Match
                    </span>
                  )}
                  <h3 className="font-extrabold text-[#0A2540] text-base mb-1">{pkg.name}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed mb-4">{pkg.tagline}</p>
                  <Link
                    href={pkg.href}
                    className="inline-flex items-center gap-1.5 text-[#0078D4] font-semibold text-sm hover:underline"
                  >
                    View package details <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center mb-8">
          <CTAButton href="/micro-offers" className="px-7 py-3 text-sm">
            View All Quick Wins
          </CTAButton>
          <a
            href="/book"
            className="inline-flex items-center justify-center gap-2 text-[#0A2540] font-semibold hover:text-[#0078D4] transition-colors text-sm border border-border px-7 py-3 rounded-xl hover:border-[#0078D4]/40"
          >
            Book a Discovery Call <ArrowRight className="w-4 h-4" />
          </a>
        </div>

        <div className="text-center">
          <button
            onClick={restart}
            className="inline-flex items-center gap-2 text-muted-foreground hover:text-[#0A2540] text-sm transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Start over
          </button>
        </div>
      </div>
    );
  }

  // ── Quiz ───────────────────────────────────────────────────────────────────
  const progress = ((currentQ) / total) * 100;

  return (
    <div className="max-w-2xl mx-auto">
      {/* Progress */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Question {currentQ + 1} of {total}
          </span>
          <span className="text-xs font-semibold text-[#0078D4]">{Math.round(progress)}%</span>
        </div>
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-[#0078D4] rounded-full transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Question card */}
      <div className="bg-white rounded-2xl border border-border shadow-sm p-8">
        <h2 className="text-lg md:text-xl font-extrabold text-[#0A2540] mb-7 leading-snug">
          {question.text}
        </h2>

        <div className="space-y-3 mb-8">
          {question.answers.map((answer, i) => (
            <button
              key={i}
              onClick={() => handleSelect(i)}
              className={`w-full text-left px-5 py-4 rounded-xl border text-sm font-medium transition-all leading-relaxed ${
                selected === i
                  ? "border-[#0078D4] bg-[#0078D4]/5 text-[#0A2540] ring-1 ring-[#0078D4]/30"
                  : "border-border hover:border-[#0078D4]/40 hover:bg-[#F7F9FC] text-[#0A2540]"
              }`}
            >
              <span className="flex items-start gap-3">
                <span
                  className={`flex-shrink-0 mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                    selected === i ? "border-[#0078D4] bg-[#0078D4]" : "border-gray-300"
                  }`}
                >
                  {selected === i && (
                    <span className="w-2 h-2 rounded-full bg-white" />
                  )}
                </span>
                {answer.text}
              </span>
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between">
          <button
            onClick={restart}
            className="text-xs text-muted-foreground hover:text-[#0A2540] transition-colors flex items-center gap-1.5"
          >
            <RotateCcw className="w-3 h-3" />
            Start over
          </button>
          <button
            onClick={handleNext}
            disabled={selected === null}
            className="inline-flex items-center gap-2 bg-[#0078D4] hover:bg-[#0068BE] disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold px-6 py-2.5 rounded-xl transition-colors text-sm"
          >
            {currentQ < total - 1 ? "Next" : "See My Results"}
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
