import { useState, useRef, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Layout } from "@/components/Layout";
import { GlassPanel } from "@/components/design-system/GlassPanel";
import { GradientText } from "@/components/design-system/GradientText";
import { StatPanel } from "@/components/design-system/StatPanel";
import { WorkflowSteps } from "@/components/design-system/WorkflowSteps";
import {
  Brain,
  X,
  ChevronRight,
  CheckCircle,
  Loader2,
  BarChart3,
  Award,
  Zap,
  ShieldCheck,
  AlertTriangle,
  FileText,
  Target,
  Users,
  Building2,
  ArrowRight,
  Lock,
  Database,
  Globe,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { trackEvent } from "@/lib/analytics";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Message {
  role: "user" | "assistant";
  content: string;
}

interface QuizResults {
  leadId: number | null;
  resendToken: string | null;
  totalScore: number;
  tier: string;
  recommendedService: string;
  serviceDescription: string;
  categoryScores: Record<string, number>;
  whatThisMeans: string;
}

type QuizState =
  | "idle"
  | "intro"
  | "questioning"
  | "lead-capture"
  | "submitting"
  | "results";

// ─── Lead capture schema ───────────────────────────────────────────────────────
const leadSchema = z.object({
  name: z.string().min(2, "Please enter your full name"),
  email: z.string().email("Please enter a valid email address"),
  company: z.string().optional(),
});
type LeadForm = z.infer<typeof leadSchema>;

// ─── Fallback questions (used when AI call fails) ──────────────────────────────
// 10 unique questions, 2 per category, matching the system-prompt category order:
// Infrastructure & Identity (1-2), Data & Compliance (3-4), AI Literacy (5-6),
// Change Management (7-8), Business Process (9-10).
// startQuiz uses index 0; submitAnswer uses Math.min(questionIndex, length-1).
const FALLBACK_QUESTIONS = [
  // Infrastructure & Identity
  "Do you currently have a Microsoft 365 subscription with at least Business Standard or E3 licensing? Please describe your current licensing situation and how many users are covered.",
  "How would you describe your organisation's Azure Active Directory / Entra ID setup? Are all staff on managed, cloud-synced accounts, or do you have a mix of on-premises and cloud identities?",
  // Data & Compliance
  "What data classification or sensitivity labelling is in place today? For example, do you use Microsoft Purview Information Protection or any equivalent system to mark and protect confidential documents?",
  "How does your organisation currently handle data residency and regulatory compliance — for instance GDPR, ISO 27001, or sector-specific requirements — and are those policies enforced inside Microsoft 365?",
  // AI Literacy
  "How familiar are your staff with AI-assisted tools in their day-to-day work? Have any teams already used Copilot, ChatGPT, or similar assistants for tasks like drafting emails or summarising documents?",
  "Has your organisation run any formal AI literacy training, guidelines, or acceptable-use policies? If so, how widely understood are they across different departments?",
  // Change Management
  "When your organisation last introduced a significant new technology, how was adoption managed? Were there dedicated champions, structured training programmes, or did teams largely self-serve?",
  "What level of executive sponsorship and cross-department buy-in do you currently have for a Copilot rollout? Is there a named project owner, or is this still at the exploratory stage?",
  // Business Process
  "Which business processes consume the most time or are most prone to errors today — for example, report generation, meeting follow-ups, customer communications, or data entry?",
  "Are your key business processes documented and reasonably standardised, or do they vary significantly between teams and individuals? Consistent processes are often the best starting point for AI automation.",
] as const;

// ─── Category config ───────────────────────────────────────────────────────────
const CATEGORIES = [
  { key: "infrastructure", label: "Infrastructure & Identity" },
  { key: "data", label: "Data & Compliance" },
  { key: "aiLiteracy", label: "AI Literacy" },
  { key: "changeManagement", label: "Change Management" },
  { key: "businessProcess", label: "Business Process" },
];

const TIER_COLOURS: Record<string, string> = {
  Beginner: "bg-red-500",
  Developing: "bg-orange-500",
  Emerging: "bg-yellow-500",
  Advanced: "bg-blue-500",
  Ready: "bg-teal-500",
};

// ─── Tier-specific upsell config ───────────────────────────────────────────────
interface TierUpsell {
  badge: string;
  name: string;
  description: string;
  slug: string;
  ctaText: string;
  servicePath: string;
  servicePageLabel: string;
}

const TIER_UPSELLS: Record<string, TierUpsell> = {
  Beginner: {
    badge: "Start Here",
    name: "M365 Tenant Health Audit",
    description:
      "Before Copilot can succeed, your tenant needs a clean foundation. A comprehensive audit — using the same methodology Shane applies at NASA — identifies every configuration gap, licensing issue, and security risk, with a prioritised roadmap so you know exactly where to start.",
    slug: "m365-tenant-health-audit",
    ctaText: "Book Your Audit",
    servicePath: "/solutions/m365-health",
    servicePageLabel: "M365 Health",
  },
  Developing: {
    badge: "Recommended",
    name: "Copilot for M365 Readiness Assessment",
    description:
      "You're building the right habits, but gaps remain before Copilot is safe to deploy. A targeted readiness assessment pinpoints exactly what to fix — and in what order — so your rollout doesn't stall or expose sensitive data.",
    slug: "copilot-for-m365-readiness-assessment",
    ctaText: "Get Your Readiness Report",
    servicePath: "/solutions/copilot",
    servicePageLabel: "Copilot & AI",
  },
  Emerging: {
    badge: "Next Step",
    name: "Copilot for M365 Readiness Assessment",
    description:
      "You're making solid progress. A formal Copilot readiness assessment will validate your environment, surface the remaining gaps, and give you a prioritised rollout roadmap so you can deploy with confidence — not guesswork.",
    slug: "copilot-for-m365-readiness-assessment",
    ctaText: "Validate Your Readiness",
    servicePath: "/solutions/copilot",
    servicePageLabel: "Copilot & AI",
  },
  Advanced: {
    badge: "High Impact",
    name: "Power Platform Quick‑Start",
    description:
      "Your M365 environment is mature and you're ready to start automating. A focused 30-day sprint to design, build, and deploy one production-ready Power App or Power Automate flow — turning your Copilot investment into measurable business impact.",
    slug: "power-platform-quickstart",
    ctaText: "Start Automating",
    servicePath: "/solutions/power-platform",
    servicePageLabel: "Power Platform",
  },
  Ready: {
    badge: "Enterprise Grade",
    name: "Governance Foundations Package",
    description:
      "Your environment is Copilot-ready — now make sure it scales safely. A complete Microsoft 365 governance framework built to enterprise standards, ensuring your Copilot deployment remains secure, compliant, and audit-ready as adoption grows.",
    slug: "governance-foundations-package",
    ctaText: "Build Your Governance Framework",
    servicePath: "/solutions/governance",
    servicePageLabel: "Governance",
  },
};

// ─── Helper ────────────────────────────────────────────────────────────────────
async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const res = await fetch(`${base}/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json() as Promise<T>;
}

// ─── Progress Bar ──────────────────────────────────────────────────────────────
function ProgressBar({ step, total }: { step: number; total: number }) {
  const pct = Math.round((step / total) * 100);
  return (
    <div className="w-full">
      <div className="flex justify-between text-xs text-white/60 mb-1">
        <span>
          Question {step} of {total}
        </span>
        <span>{pct}%</span>
      </div>
      <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ─── Score Bar ─────────────────────────────────────────────────────────────────
function ScoreBar({ score, label }: { score: number; label: string }) {
  const pct = (score / 10) * 100;
  const colour =
    score >= 7 ? "bg-teal-400" : score >= 4 ? "bg-primary" : "bg-red-400";
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-white/80">{label}</span>
        <span className="text-white font-semibold">{score}/10</span>
      </div>
      <div className="h-2 bg-white/10 rounded-full overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-700",
            colour,
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ─── Quiz Modal ────────────────────────────────────────────────────────────────
function QuizModal({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<QuizState>("intro");
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState<string>("");
  const [answer, setAnswer] = useState("");
  const [questionIndex, setQuestionIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<QuizResults | null>(null);
  const [submitError, setSubmitError] = useState("");
  const [submittedEmail, setSubmittedEmail] = useState("");
  const [resendEmail, setResendEmail] = useState("");
  const [resendState, setResendState] = useState<
    "idle" | "sending" | "sent" | "error"
  >("idle");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LeadForm>({ resolver: zodResolver(leadSchema) });

  const TOTAL_QUESTIONS = 10;

  // Start the quiz — get first question from AI
  async function startQuiz() {
    setState("questioning");
    setLoading(true);
    try {
      const data = await apiPost<{ content: string }>("/quiz/chat", {
        messages: [],
      });
      setCurrentQuestion(data.content);
      setMessages([{ role: "assistant", content: data.content }]);
      setQuestionIndex(1);
    } catch {
      setCurrentQuestion(FALLBACK_QUESTIONS[0]);
      setQuestionIndex(1);
    } finally {
      setLoading(false);
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }

  // Submit an answer and get the next question
  async function submitAnswer() {
    if (!answer.trim() || loading) return;

    const userMsg: Message = { role: "user", content: answer.trim() };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setAnswer("");

    if (questionIndex >= TOTAL_QUESTIONS) {
      // Move to lead capture
      setState("lead-capture");
      return;
    }

    setLoading(true);
    try {
      const data = await apiPost<{ content: string }>("/quiz/chat", {
        messages: updatedMessages,
      });
      const assistantMsg: Message = {
        role: "assistant",
        content: data.content,
      };
      setMessages([...updatedMessages, assistantMsg]);
      setCurrentQuestion(data.content);
      setQuestionIndex((q) => q + 1);
    } catch {
      // Use slot-based fallback: questionIndex is the slot we just answered,
      // so the next question lives at that same index (0-based).
      setCurrentQuestion(
        FALLBACK_QUESTIONS[
          Math.min(questionIndex, FALLBACK_QUESTIONS.length - 1)
        ],
      );
      setQuestionIndex((q) => q + 1);
    } finally {
      setLoading(false);
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }

  // Submit lead + conversation for scoring
  async function onLeadSubmit(lead: LeadForm) {
    setState("submitting");
    setSubmitError("");
    try {
      const data = await apiPost<QuizResults & { success: boolean }>(
        "/quiz/submit",
        {
          name: lead.name,
          email: lead.email,
          company: lead.company,
          conversation: messages,
        },
      );
      setSubmittedEmail(lead.email);
      setResendEmail(lead.email);
      setResults(data);
      setState("results");
    } catch {
      setSubmitError("Something went wrong. Please try again.");
      setState("lead-capture");
    }
  }

  // Resend (or forward) the PDF report to another email
  async function handleResend(e: React.FormEvent) {
    e.preventDefault();
    if (
      !results?.leadId ||
      !results?.resendToken ||
      !resendEmail ||
      resendState === "sending"
    )
      return;
    setResendState("sending");
    try {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${base}/api/quiz/resend-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: results.leadId,
          resendToken: results.resendToken,
          email: resendEmail,
        }),
      });
      setResendState(res.ok ? "sent" : "error");
    } catch {
      setResendState("error");
    }
  }

  // Key handler for textarea
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submitAnswer();
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-2xl max-h-[90vh] flex flex-col bg-[#0A2540] rounded-2xl shadow-2xl border border-white/10 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-primary" />
            <span className="font-semibold text-white text-sm">
              Copilot Readiness Assessment
            </span>
          </div>
          {state === "questioning" && (
            <div className="flex-1 mx-6">
              <ProgressBar step={questionIndex} total={TOTAL_QUESTIONS} />
            </div>
          )}
          <button
            onClick={onClose}
            className="text-white/50 hover:text-white transition-colors ml-2 shrink-0"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-6 min-h-0">
          {/* Intro state */}
          {state === "intro" && (
            <div className="space-y-6 text-center py-4">
              <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center mx-auto">
                <Brain className="w-8 h-8 text-primary" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-white mb-2">
                  How Copilot-Ready Is Your Organisation?
                </h2>
                <p className="text-white/70 text-sm leading-relaxed max-w-md mx-auto">
                  Answer 10 AI-powered questions across 5 readiness dimensions.
                  Takes around 5 minutes. You'll receive a personalised PDF
                  report and service recommendation by email.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-3 text-left">
                {[
                  {
                    icon: <BarChart3 className="w-4 h-4" />,
                    label: "5 categories scored",
                  },
                  {
                    icon: <Award className="w-4 h-4" />,
                    label: "Maturity tier rating",
                  },
                  {
                    icon: <Zap className="w-4 h-4" />,
                    label: "PDF report emailed",
                  },
                ].map((item, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 bg-white/5 rounded-lg p-3"
                  >
                    <span className="text-primary">{item.icon}</span>
                    <span className="text-white/70 text-xs">{item.label}</span>
                  </div>
                ))}
              </div>
              <button
                onClick={() => void startQuiz()}
                className="w-full py-3 px-6 bg-primary hover:bg-primary/90 text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                Start the Assessment <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Questioning state */}
          {state === "questioning" && (
            <div className="space-y-6">
              {loading && !currentQuestion ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 text-primary animate-spin" />
                </div>
              ) : (
                <>
                  <div className="bg-white/5 rounded-xl p-5 border border-white/10">
                    <p className="text-white text-base leading-relaxed">
                      {currentQuestion}
                    </p>
                  </div>
                  <div className="space-y-3">
                    <textarea
                      ref={textareaRef}
                      value={answer}
                      onChange={(e) => setAnswer(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="Type your answer here… (Cmd/Ctrl+Enter to submit)"
                      rows={4}
                      className="w-full bg-white/5 border border-white/20 rounded-xl p-4 text-white placeholder:text-white/30 text-sm resize-none focus:outline-none focus:border-primary/60 transition-colors"
                      disabled={loading}
                    />
                    <button
                      onClick={() => void submitAnswer()}
                      disabled={!answer.trim() || loading}
                      className="w-full py-3 px-6 bg-primary hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
                    >
                      {loading ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />{" "}
                          Processing…
                        </>
                      ) : questionIndex >= TOTAL_QUESTIONS ? (
                        <>
                          See My Results <ChevronRight className="w-4 h-4" />
                        </>
                      ) : (
                        <>
                          Next Question <ChevronRight className="w-4 h-4" />
                        </>
                      )}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Lead capture state */}
          {state === "lead-capture" && (
            <form onSubmit={handleSubmit(onLeadSubmit)} className="space-y-5">
              <div className="text-center mb-2">
                <CheckCircle className="w-10 h-10 text-teal-400 mx-auto mb-3" />
                <h3 className="text-xl font-bold text-white">
                  Assessment Complete!
                </h3>
                <p className="text-white/60 text-sm mt-1">
                  Enter your details to receive your personalised PDF report by
                  email.
                </p>
              </div>
              {submitError && (
                <p className="text-red-400 text-sm text-center bg-red-400/10 rounded-lg p-3">
                  {submitError}
                </p>
              )}
              <div className="space-y-4">
                <div>
                  <label className="block text-white/70 text-sm mb-1.5">
                    Full Name *
                  </label>
                  <input
                    {...register("name")}
                    placeholder="Jane Smith"
                    className="w-full bg-white/5 border border-white/20 rounded-lg px-4 py-2.5 text-white placeholder:text-white/30 text-sm focus:outline-none focus:border-primary/60 transition-colors"
                  />
                  {errors.name && (
                    <p className="text-red-400 text-xs mt-1">
                      {errors.name.message}
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-white/70 text-sm mb-1.5">
                    Work Email *
                  </label>
                  <input
                    {...register("email")}
                    type="email"
                    placeholder="jane@company.com"
                    className="w-full bg-white/5 border border-white/20 rounded-lg px-4 py-2.5 text-white placeholder:text-white/30 text-sm focus:outline-none focus:border-primary/60 transition-colors"
                  />
                  {errors.email && (
                    <p className="text-red-400 text-xs mt-1">
                      {errors.email.message}
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-white/70 text-sm mb-1.5">
                    Company (optional)
                  </label>
                  <input
                    {...register("company")}
                    placeholder="Acme Corp"
                    className="w-full bg-white/5 border border-white/20 rounded-lg px-4 py-2.5 text-white placeholder:text-white/30 text-sm focus:outline-none focus:border-primary/60 transition-colors"
                  />
                </div>
              </div>
              <button
                type="submit"
                className="w-full py-3 px-6 bg-primary hover:bg-primary/90 text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                Get My Readiness Report <ChevronRight className="w-4 h-4" />
              </button>
              <p className="text-white/30 text-xs text-center">
                Your report will be emailed instantly. No spam, ever.
              </p>
            </form>
          )}

          {/* Submitting state */}
          {state === "submitting" && (
            <div className="flex flex-col items-center justify-center py-16 space-y-4">
              <Loader2 className="w-10 h-10 text-primary animate-spin" />
              <p className="text-white font-semibold">
                Analysing your responses…
              </p>
              <p className="text-white/50 text-sm">
                Generating your personalised readiness report
              </p>
            </div>
          )}

          {/* Results state */}
          {state === "results" && results && (
            <div className="space-y-6">
              <div className="text-center">
                <CheckCircle className="w-10 h-10 text-teal-400 mx-auto mb-3" />
                <h3 className="text-xl font-bold text-white">
                  Your Readiness Report
                </h3>
                {submittedEmail ? (
                  <p className="text-white/50 text-sm mt-1">
                    PDF report sent to{" "}
                    <span className="text-teal-400 font-medium">
                      {submittedEmail}
                    </span>
                  </p>
                ) : (
                  <p className="text-white/50 text-sm mt-1">
                    Check your inbox — your full PDF report has been emailed to
                    you.
                  </p>
                )}
              </div>

              {/* Forward report form — only shown when a valid resend token was issued */}
              {results.leadId && results.resendToken && (
                <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                  <p className="text-white/70 text-xs font-semibold uppercase tracking-wider mb-3">
                    Forward Report to Another Address
                  </p>
                  {resendState === "sent" ? (
                    <div className="flex items-center gap-2 text-teal-400 text-sm">
                      <CheckCircle className="w-4 h-4 flex-shrink-0" />
                      <span>
                        Report sent to{" "}
                        <span className="font-medium">{resendEmail}</span>
                      </span>
                    </div>
                  ) : (
                    <form
                      onSubmit={(e) => {
                        void handleResend(e);
                      }}
                      className="flex gap-2"
                    >
                      <input
                        type="email"
                        value={resendEmail}
                        onChange={(e) => {
                          setResendEmail(e.target.value);
                          setResendState("idle");
                        }}
                        placeholder="colleague@company.com"
                        required
                        className="flex-1 min-w-0 bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-primary"
                      />
                      <button
                        type="submit"
                        disabled={resendState === "sending" || !resendEmail}
                        className="flex items-center gap-1.5 bg-primary hover:bg-primary/90 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors whitespace-nowrap flex-shrink-0"
                      >
                        {resendState === "sending" ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />{" "}
                            Sending…
                          </>
                        ) : (
                          "Send PDF"
                        )}
                      </button>
                    </form>
                  )}
                  {resendState === "error" && (
                    <p className="text-red-400 text-xs mt-2">
                      Failed to send. Please try again.
                    </p>
                  )}
                </div>
              )}

              {/* Score + Tier */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-center">
                  <p className="text-white/50 text-xs mb-1">Total Score</p>
                  <p className="text-4xl font-bold text-primary">
                    {results.totalScore}
                  </p>
                  <p className="text-white/40 text-xs">out of 50</p>
                </div>
                <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-center">
                  <p className="text-white/50 text-xs mb-1">Maturity Tier</p>
                  <div
                    className={cn(
                      "inline-block px-3 py-1 rounded-full text-white text-sm font-bold mt-1",
                      TIER_COLOURS[results.tier] ?? "bg-primary",
                    )}
                  >
                    {results.tier}
                  </div>
                </div>
              </div>

              {/* Category breakdown */}
              <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
                <p className="text-white/70 text-xs font-semibold uppercase tracking-wider mb-3">
                  Category Breakdown
                </p>
                {CATEGORIES.map((cat) => (
                  <ScoreBar
                    key={cat.key}
                    label={cat.label}
                    score={results.categoryScores[cat.key] ?? 0}
                  />
                ))}
              </div>

              {/* What it means */}
              {results.whatThisMeans && (
                <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                  <p className="text-white/70 text-xs font-semibold uppercase tracking-wider mb-2">
                    What This Means
                  </p>
                  <p className="text-white/80 text-sm leading-relaxed">
                    {results.whatThisMeans}
                  </p>
                </div>
              )}

              {/* Recommended service */}
              <div className="bg-primary/10 border border-primary/30 rounded-xl p-4">
                <p className="text-primary text-xs font-semibold uppercase tracking-wider mb-1">
                  Recommended Next Step
                </p>
                <p className="text-white font-bold text-base">
                  {results.recommendedService}
                </p>
                {results.serviceDescription && (
                  <p className="text-white/60 text-sm mt-1">
                    {results.serviceDescription}
                  </p>
                )}
              </div>

              {/* Upsell: tier-personalised offer */}
              {(() => {
                const upsell =
                  TIER_UPSELLS[results.tier] ?? TIER_UPSELLS["Developing"];
                return (
                  <div className="bg-primary/10 border border-primary/30 rounded-xl p-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-primary text-xs font-bold uppercase tracking-wider">
                        Recommended Next Step
                      </p>
                      <span className="text-primary text-xs font-semibold bg-primary/10 px-2.5 py-1 rounded-full border border-primary/30">
                        {upsell.badge}
                      </span>
                    </div>
                    <p className="text-white font-bold text-base">
                      {upsell.name}
                    </p>
                    <p className="text-white/70 text-sm leading-relaxed">
                      {upsell.description}
                    </p>
                    <div className="flex flex-col sm:flex-row gap-2 pt-1">
                      <a
                        href={`/checkout/${upsell.slug}`}
                        className="flex-1 py-2.5 px-4 bg-primary hover:bg-primary/90 text-white font-semibold rounded-lg text-sm transition-colors flex items-center justify-center gap-1.5"
                        onClick={() =>
                          trackEvent("quiz_upsell_cta_click", {
                            quiz_type: "copilot",
                            tier: results.tier,
                            score: results.totalScore,
                            upsell_slug: upsell.slug,
                          })
                        }
                      >
                        {upsell.ctaText} <ArrowRight className="w-3.5 h-3.5" />
                      </a>
                      <a
                        href="/book"
                        className="flex-1 py-2.5 px-4 border border-white/20 hover:border-white/40 text-white/80 hover:text-white font-semibold rounded-lg text-sm transition-colors flex items-center justify-center gap-1.5"
                        onClick={() =>
                          trackEvent("quiz_upsell_book_click", {
                            quiz_type: "copilot",
                            tier: results.tier,
                            score: results.totalScore,
                          })
                        }
                      >
                        Book a Free Call
                      </a>
                    </div>
                    <div className="text-center pt-1">
                      <a
                        href={upsell.servicePath}
                        className="inline-flex items-center gap-1 text-primary/70 hover:text-primary text-sm transition-colors"
                        onClick={() =>
                          trackEvent("quiz_service_page_click", {
                            quiz_type: "copilot",
                            tier: results.tier,
                            score: results.totalScore,
                            service_path: upsell.servicePath,
                          })
                        }
                      >
                        Explore the {upsell.servicePageLabel} service{" "}
                        <ArrowRight className="w-3 h-3" />
                      </a>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
const GRADIENT_BG = { background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" };

export default function CopilotQuiz() {
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    if (modalOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [modalOpen]);

  return (
    <Layout>
      {/* Hero */}
      <section className="pt-32 sm:pt-40 pb-16 px-4 sm:px-6 lg:px-8 text-center">
        <div className="max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full glass-panel text-accent-blue text-xs font-semibold uppercase tracking-wider mb-6">
            <Brain className="w-4 h-4" />
            Copilot AI Readiness Assessment
          </div>

          <h1 className="font-display text-4xl sm:text-5xl md:text-6xl font-bold text-text-primary tracking-tight leading-tight mb-6">
            Most Copilot Deployments <GradientText>Fail.</GradientText>
            <br className="hidden md:block" /> Yours Doesn't Have To.
          </h1>

          <p className="text-text-secondary text-lg md:text-xl leading-relaxed max-w-2xl mx-auto mb-4">
            Copilot underperforms when governance, data classification, identity, and change management aren't ready. Most organizations skip the pre-deployment assessment and pay for it in adoption failures and compliance exposure.
          </p>
          <p className="text-text-secondary text-base md:text-lg leading-relaxed max-w-2xl mx-auto mb-10">
            This 10-question assessment — built on the same readiness framework Shane applies as Lead M365 Architect at NASA — identifies exactly where your deployment will break before it does.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-4 mb-12">
            {[
              { value: "10", label: "targeted questions" },
              { value: "5", label: "readiness dimensions" },
              { value: "Free", label: "personalized PDF report" },
            ].map((stat) => (
              <StatPanel key={stat.label} label={stat.label} value={stat.value} className="min-w-[170px] text-left" />
            ))}
          </div>

          <button
            onClick={() => setModalOpen(true)}
            data-track="cta"
            className="group inline-flex items-center gap-3 text-white font-semibold text-lg px-8 py-4 rounded-xl transition-opacity hover:opacity-90"
            style={GRADIENT_BG}
          >
            Take the Free Assessment
            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
          </button>

          <p className="text-text-tertiary text-sm mt-4">
            No account required · Results and PDF delivered instantly
          </p>
        </div>
      </section>

      {/* Why This Quiz Exists */}
      <section className="border-t border-white/[0.06] py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <p className="text-center text-xs font-bold uppercase tracking-widest text-accent-blue mb-3">
            Why This Assessment Exists
          </p>
          <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary text-center mb-4">
            Copilot readiness isn't optional — it's what separates a successful
            deployment from an expensive failure.
          </h2>
          <p className="text-text-secondary text-center max-w-2xl mx-auto mb-14 text-lg leading-relaxed">
            Microsoft Copilot doesn't run on intention. It runs on
            infrastructure. Organizations that skip pre-deployment readiness
            work consistently see the same outcome: low adoption, high support
            burden, and compliance exposure they didn't anticipate. This quiz
            identifies the gaps before you spend your deployment budget.
          </p>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                icon: ShieldCheck,
                title: "Governance must come first",
                body: "Copilot surfaces data from across your tenant. Without sensitivity labels, DLP policies, and information barriers, it surfaces the wrong data to the wrong people. Every time.",
              },
              {
                icon: Lock,
                title: "Identity and security must be in place",
                body: "MFA enforcement, device compliance, and Entra ID health directly affect what Copilot can access. Gaps in identity posture become Copilot vulnerabilities at scale.",
              },
              {
                icon: Users,
                title: "Change management determines adoption",
                body: "AI tools fail when change management is treated as an afterthought. Executive buy-in, training programmes, and pilot readiness predict success more reliably than any technical factor.",
              },
            ].map((item, i) => {
              const Icon = item.icon;
              return (
                <div key={i} className="bg-charcoal-1 rounded-2xl border border-white/[0.06] p-6">
                  <div className="w-11 h-11 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center mb-4 text-accent-blue">
                    <Icon className="w-5 h-5" />
                  </div>
                  <h3 className="font-display font-bold text-text-primary mb-2">
                    {item.title}
                  </h3>
                  <p className="text-text-secondary text-sm leading-relaxed">
                    {item.body}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Who This Is For */}
      <section className="border-t border-white/[0.06] py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <p className="text-center text-xs font-bold uppercase tracking-widest text-accent-blue mb-3">
            Who This Assessment Is For
          </p>
          <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary text-center mb-4">
            Built for organizations where a failed Copilot deployment is not an
            option.
          </h2>
          <p className="text-text-secondary text-center max-w-xl mx-auto mb-12 text-lg">
            If you're in any of these groups, you need this assessment before
            your deployment begins.
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              {
                icon: Building2,
                title: "Mid-market organizations",
                body: "200–2,000 employees planning or mid-stream on a Copilot rollout who need to know where their environment stands before committing more budget.",
              },
              {
                icon: ShieldCheck,
                title: "Regulated industries",
                body: "Healthcare, finance, insurance, and legal organizations where data governance gaps in a Copilot deployment create direct compliance exposure.",
              },
              {
                icon: Globe,
                title: "Multi-location organizations",
                body: "Organizations with distributed teams and inconsistent tenant configuration across sites, where a Copilot rollout would surface every unresolved permissions inconsistency at once.",
              },
              {
                icon: AlertTriangle,
                title: "Compliance and governance risk orgs",
                body: "Organizations that have received an audit finding, failed a security review, or know their M365 governance posture is undocumented — and are now evaluating Copilot.",
              },
              {
                icon: Target,
                title: "IT teams planning Copilot",
                body: "Technical leads who want an objective, scored framework to assess readiness across all five dimensions — not a vendor checklist, not a marketing scorecard.",
              },
              {
                icon: Database,
                title: "Organizations unsure of data readiness",
                body: "Any org that hasn't completed a data classification exercise but is being pushed toward Copilot deployment by business leadership. Know your risk before you proceed.",
              },
            ].map((item, i) => {
              const Icon = item.icon;
              return (
                <div key={i} className="bg-charcoal-1 border border-white/[0.06] rounded-2xl p-5">
                  <div className="w-10 h-10 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center mb-4">
                    <Icon className="w-5 h-5 text-accent-blue" />
                  </div>
                  <h3 className="font-display font-bold text-text-primary mb-1">
                    {item.title}
                  </h3>
                  <p className="text-text-secondary text-sm leading-relaxed">
                    {item.body}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="border-t border-white/[0.06] py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <p className="text-center text-xs font-bold uppercase tracking-widest text-accent-blue mb-3">
            How It Works
          </p>
          <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary text-center mb-4">
            From first question to PDF in under five minutes.
          </h2>
          <p className="text-text-secondary text-center max-w-xl mx-auto mb-14">
            Ten questions. Five readiness dimensions. A scoring model built
            from Shane's own Copilot deployment experience. An instant
            readiness score, a personalized PDF report, and a recommended next
            step — delivered to your inbox the moment you finish.
          </p>
          <div className="max-w-2xl mx-auto">
            <WorkflowSteps
              steps={[
                {
                  title: "Answer 10 targeted questions",
                  description: "Each question maps to one of five readiness dimensions. No generic questionnaire — these are the same diagnostics Shane uses in a paid Copilot Readiness Assessment engagement, compressed into a 5-minute format.",
                },
                {
                  title: "Receive an instant readiness score",
                  description: "Your answers are scored across all five dimensions using a 0–50 scoring model built from Shane's real Copilot deployment experience. You receive a total score, a maturity tier (Early / Developing / Ready / Advanced), and a per-dimension breakdown.",
                },
                {
                  title: "Get your personalized PDF report",
                  description: "A branded, personalized PDF lands in your inbox immediately. It includes your score, dimension analysis, the deployment risks specific to your environment, and Shane's recommended next step — no sales call required.",
                },
              ]}
            />
          </div>
          <div className="mt-14 text-center">
            <button
              onClick={() => setModalOpen(true)}
              data-track="cta"
              className="group inline-flex items-center gap-2 text-accent-blue font-semibold hover:text-accent-violet transition-colors"
            >
              Start the assessment now{" "}
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </button>
          </div>
        </div>
      </section>

      {/* The Five Dimensions */}
      <section className="border-t border-white/[0.06] py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <p className="text-center text-xs font-bold uppercase tracking-widest text-accent-blue mb-3">
            The Five Readiness Dimensions
          </p>
          <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary text-center mb-4">
            What the assessment <GradientText>measures</GradientText> — and why it matters.
          </h2>
          <p className="text-text-secondary text-center max-w-xl mx-auto mb-14">
            These five dimensions determine whether a Copilot deployment
            delivers value or creates liability. Each is scored independently so
            you know exactly where to focus before deployment begins.
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                colour: "bg-blue-500",
                label: "Dimension 1",
                title: "Infrastructure & Identity",
                measures:
                  "M365 licensing status, Entra ID health, MFA enforcement, device compliance policies, and Conditional Access coverage.",
                matters:
                  "Copilot's access scope is determined by your identity architecture. Misconfigured Conditional Access or incomplete MFA becomes an attack surface when Copilot begins indexing.",
                fail: "MFA not universally enforced; no device compliance baseline; Entra ID in hybrid with unmanaged devices.",
                ready:
                  "All users on MFA, Intune-managed devices, Conditional Access policies covering all apps, Entra ID health score above 80%.",
              },
              {
                colour: "bg-teal-500",
                label: "Dimension 2",
                title: "Data & Compliance",
                measures:
                  "Sensitivity label coverage, DLP policy maturity, data governance framework, information barriers, and retention policies.",
                matters:
                  "Copilot surfaces files, emails, and chats from across your tenant. Without classification, it surfaces everything — including what shouldn't be accessible to every user.",
                fail: "No sensitivity labels deployed; DLP policies absent or unenforced; no documented data governance framework.",
                ready:
                  "Labels applied to >80% of files, DLP policies enforced across Exchange and SharePoint, governance framework documented and current.",
              },
              {
                colour: "bg-violet-500",
                label: "Dimension 3",
                title: "AI Literacy",
                measures:
                  "Employee AI skills baseline, existence of a training programme, AI champion network, and adoption culture readiness.",
                matters:
                  "Copilot adoption correlates directly with AI literacy. Without a baseline and a structured enablement programme, licence utilization stays below 30%.",
                fail: "No AI training programme; no champions; employees unaware of Copilot capabilities; no adoption tracking.",
                ready:
                  "Structured enablement programme in place; AI champions identified; pilot group trained and reporting outcomes.",
              },
              {
                colour: "bg-orange-500",
                label: "Dimension 4",
                title: "Change Management",
                measures:
                  "Executive sponsorship, IT readiness for support burden, rollout planning maturity, and policy documentation.",
                matters:
                  "Change management failures are the most common cause of AI deployment failure — more common than technical issues. Without executive sponsorship and documented policy, pilots stall.",
                fail: "No executive sponsor; IT team not trained on Copilot support; no rollout plan; no acceptable use policy.",
                ready:
                  "Exec sponsor confirmed; IT trained on Copilot administration; rollout plan documented; AUP drafted and approved.",
              },
              {
                colour: "bg-green-500",
                label: "Dimension 5",
                title: "Business Process",
                measures:
                  "Identified priority use cases, success metrics, ROI tracking methodology, and process ownership accountability.",
                matters:
                  "Copilot delivers ROI when it's applied to specific, measurable use cases. Deployments without defined use cases produce vague outputs and no defensible business case.",
                fail: "No use cases identified; no success metrics; no owner accountable for adoption outcomes.",
                ready:
                  "Three or more priority use cases defined; success metrics agreed; ROI baseline established; named owner per use case.",
              },
            ].map((item) => (
              <div key={item.title} className="bg-charcoal-1 rounded-2xl border border-white/[0.06] p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className={`w-2 h-10 rounded-full ${item.colour}`} />
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-text-tertiary">
                      {item.label}
                    </p>
                    <h3 className="font-display font-bold text-lg text-text-primary">
                      {item.title}
                    </h3>
                  </div>
                </div>
                <div className="space-y-3 text-sm">
                  <div>
                    <p className="font-semibold text-text-primary text-xs uppercase tracking-wide mb-1">
                      What it measures
                    </p>
                    <p className="text-text-secondary leading-relaxed">
                      {item.measures}
                    </p>
                  </div>
                  <div>
                    <p className="font-semibold text-text-primary text-xs uppercase tracking-wide mb-1">
                      Why it matters
                    </p>
                    <p className="text-text-secondary leading-relaxed">
                      {item.matters}
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <div className="flex-1 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                      <p className="text-xs font-bold text-red-400 uppercase tracking-wide mb-1">
                        Failure looks like
                      </p>
                      <p className="text-xs text-text-secondary leading-relaxed">
                        {item.fail}
                      </p>
                    </div>
                    <div className="flex-1 bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3">
                      <p className="text-xs font-bold text-emerald-400 uppercase tracking-wide mb-1">
                        Readiness looks like
                      </p>
                      <p className="text-xs text-text-secondary leading-relaxed">
                        {item.ready}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
            <GlassPanel className="p-6 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-2 h-10 rounded-full" style={GRADIENT_BG} />
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-text-tertiary">Your Output</p>
                    <h3 className="font-display font-bold text-lg text-text-primary">Your Report</h3>
                  </div>
                </div>
                <p className="text-text-secondary text-sm leading-relaxed">
                  All five dimensions scored, ranked by risk level, and
                  mapped to a tailored service recommendation. Personalized
                  PDF delivered to your inbox the moment you finish.
                </p>
              </div>
              <button
                onClick={() => setModalOpen(true)}
                data-track="cta"
                className="mt-6 inline-flex items-center gap-1.5 text-accent-blue text-sm font-semibold hover:gap-2.5 transition-all"
              >
                Start Assessment <ArrowRight className="w-4 h-4" />
              </button>
            </GlassPanel>
          </div>
        </div>
      </section>

      {/* What You Receive */}
      <section className="border-t border-white/[0.06] py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <p className="text-center text-xs font-bold uppercase tracking-widest text-accent-blue mb-3">
            What You Receive
          </p>
          <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary text-center mb-4">
            A personalized deployment risk report. Free. Instant.
          </h2>
          <p className="text-text-secondary text-center max-w-xl mx-auto mb-14 text-lg">
            Not a generic score. Not a newsletter signup. A real report — the
            same diagnostic framework Shane applies in paid engagements —
            delivered to your inbox the moment you finish.
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              {
                icon: BarChart3,
                title: "Readiness score (0–50)",
                body: "A total score across all five dimensions with your maturity tier: Early, Developing, Ready, or Advanced.",
              },
              {
                icon: Target,
                title: "Dimension-by-dimension breakdown",
                body: "Each of the five dimensions scored independently so you know exactly where you're strong and where you're exposed.",
              },
              {
                icon: AlertTriangle,
                title: "Deployment risk summary",
                body: "The specific risks identified in your environment — the gaps that are most likely to cause adoption failure or compliance exposure in your deployment.",
              },
              {
                icon: Award,
                title: "Recommended next service",
                body: "Based on your score and risk profile, a specific Shane McCaw Consulting service recommended as the highest-value next step.",
              },
              {
                icon: FileText,
                title: "Personalized PDF report",
                body: "A branded, downloadable PDF with your full results — shareable with IT leadership, your procurement team, or your executive sponsor.",
              },
              {
                icon: Zap,
                title: "Clear action plan",
                body: "A prioritized list of the three to five actions that will most improve your readiness score — written for your specific environment, not a generic checklist.",
              },
            ].map((item, i) => {
              const Icon = item.icon;
              return (
                <div
                  key={i}
                  className="flex items-start gap-4 bg-charcoal-1 rounded-2xl border border-white/[0.06] p-5"
                >
                  <div className="w-10 h-10 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center flex-shrink-0">
                    <Icon className="w-5 h-5 text-accent-blue" />
                  </div>
                  <div>
                    <h3 className="font-display font-bold text-text-primary mb-1">
                      {item.title}
                    </h3>
                    <p className="text-text-secondary text-sm leading-relaxed">
                      {item.body}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="border-t border-white/[0.06] py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl mx-auto text-center">
          <p className="text-accent-blue text-xs font-bold uppercase tracking-widest mb-4">
            Don't Deploy Blind
          </p>
          <h2 className="font-display text-3xl md:text-4xl font-bold text-text-primary mb-4">
            Know your deployment risk before you spend your <GradientText>Copilot budget</GradientText>.
          </h2>
          <p className="text-text-secondary text-lg mb-3 leading-relaxed">
            Most organizations discover their readiness gaps after deployment —
            when adoption is low, support burden is high, and the business case
            is already under scrutiny.
          </p>
          <p className="text-text-secondary text-lg mb-10 leading-relaxed">
            This assessment takes five minutes. The PDF report is free. The gaps
            it surfaces are not.
          </p>
          <button
            onClick={() => setModalOpen(true)}
            data-track="cta"
            className="inline-flex items-center justify-center gap-2 text-white font-semibold text-base px-8 py-4 rounded-xl transition-opacity hover:opacity-90"
            style={GRADIENT_BG}
          >
            Take the Free Assessment Now
          </button>
          <p className="text-text-tertiary text-sm mt-4">
            No account required · No sales follow-up · Results delivered
            instantly
          </p>
        </div>
      </section>

      {/* Modal */}
      {modalOpen && <QuizModal onClose={() => setModalOpen(false)} />}
    </Layout>
  );
}
