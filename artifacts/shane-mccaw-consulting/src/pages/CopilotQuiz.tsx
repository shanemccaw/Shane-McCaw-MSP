import { useState, useRef, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Layout } from "@/components/Layout";
import { CTAButton } from "@/components/CTAButton";
import { Brain, X, ChevronRight, CheckCircle, Loader2, BarChart3, Award, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Message {
  role: "user" | "assistant";
  content: string;
}

interface QuizResults {
  totalScore: number;
  tier: string;
  recommendedService: string;
  serviceDescription: string;
  categoryScores: Record<string, number>;
  whatThisMeans: string;
}

type QuizState = "idle" | "intro" | "questioning" | "lead-capture" | "submitting" | "results";

// ─── Lead capture schema ───────────────────────────────────────────────────────
const leadSchema = z.object({
  name: z.string().min(2, "Please enter your full name"),
  email: z.string().email("Please enter a valid email address"),
  company: z.string().optional(),
});
type LeadForm = z.infer<typeof leadSchema>;

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
        <span>Question {step} of {total}</span>
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
  const colour = score >= 7 ? "bg-teal-400" : score >= 4 ? "bg-primary" : "bg-red-400";
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-white/80">{label}</span>
        <span className="text-white font-semibold">{score}/10</span>
      </div>
      <div className="h-2 bg-white/10 rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-700", colour)}
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
      const data = await apiPost<{ content: string }>("/quiz/chat", { messages: [] });
      setCurrentQuestion(data.content);
      setMessages([{ role: "assistant", content: data.content }]);
      setQuestionIndex(1);
    } catch {
      setCurrentQuestion("Welcome! Let's begin. Do you currently have a Microsoft 365 subscription with at least Business Standard or E3 licensing? Please describe your current licensing situation.");
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
      const data = await apiPost<{ content: string }>("/quiz/chat", { messages: updatedMessages });
      const assistantMsg: Message = { role: "assistant", content: data.content };
      setMessages([...updatedMessages, assistantMsg]);
      setCurrentQuestion(data.content);
      setQuestionIndex((q) => q + 1);
    } catch {
      setCurrentQuestion("Thank you for that. Could you tell me more about your organisation's current approach to AI training and employee readiness?");
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
      const data = await apiPost<QuizResults & { success: boolean }>("/quiz/submit", {
        name: lead.name,
        email: lead.email,
        company: lead.company,
        conversation: messages,
      });
      setResults(data);
      setState("results");
    } catch {
      setSubmitError("Something went wrong. Please try again.");
      setState("lead-capture");
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
            <span className="font-semibold text-white text-sm">Copilot Readiness Assessment</span>
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
                <h2 className="text-2xl font-bold text-white mb-2">How Copilot-Ready Is Your Organisation?</h2>
                <p className="text-white/70 text-sm leading-relaxed max-w-md mx-auto">
                  Answer 10 AI-powered questions across 5 readiness dimensions. Takes around 5 minutes.
                  You'll receive a personalised PDF report and service recommendation by email.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-3 text-left">
                {[
                  { icon: <BarChart3 className="w-4 h-4" />, label: "5 categories scored" },
                  { icon: <Award className="w-4 h-4" />, label: "Maturity tier rating" },
                  { icon: <Zap className="w-4 h-4" />, label: "PDF report emailed" },
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-2 bg-white/5 rounded-lg p-3">
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
                    <p className="text-white text-base leading-relaxed">{currentQuestion}</p>
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
                        <><Loader2 className="w-4 h-4 animate-spin" /> Processing…</>
                      ) : questionIndex >= TOTAL_QUESTIONS ? (
                        <>See My Results <ChevronRight className="w-4 h-4" /></>
                      ) : (
                        <>Next Question <ChevronRight className="w-4 h-4" /></>
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
                <h3 className="text-xl font-bold text-white">Assessment Complete!</h3>
                <p className="text-white/60 text-sm mt-1">
                  Enter your details to receive your personalised PDF report by email.
                </p>
              </div>
              {submitError && (
                <p className="text-red-400 text-sm text-center bg-red-400/10 rounded-lg p-3">{submitError}</p>
              )}
              <div className="space-y-4">
                <div>
                  <label className="block text-white/70 text-sm mb-1.5">Full Name *</label>
                  <input
                    {...register("name")}
                    placeholder="Jane Smith"
                    className="w-full bg-white/5 border border-white/20 rounded-lg px-4 py-2.5 text-white placeholder:text-white/30 text-sm focus:outline-none focus:border-primary/60 transition-colors"
                  />
                  {errors.name && <p className="text-red-400 text-xs mt-1">{errors.name.message}</p>}
                </div>
                <div>
                  <label className="block text-white/70 text-sm mb-1.5">Work Email *</label>
                  <input
                    {...register("email")}
                    type="email"
                    placeholder="jane@company.com"
                    className="w-full bg-white/5 border border-white/20 rounded-lg px-4 py-2.5 text-white placeholder:text-white/30 text-sm focus:outline-none focus:border-primary/60 transition-colors"
                  />
                  {errors.email && <p className="text-red-400 text-xs mt-1">{errors.email.message}</p>}
                </div>
                <div>
                  <label className="block text-white/70 text-sm mb-1.5">Company (optional)</label>
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
              <p className="text-white font-semibold">Analysing your responses…</p>
              <p className="text-white/50 text-sm">Generating your personalised readiness report</p>
            </div>
          )}

          {/* Results state */}
          {state === "results" && results && (
            <div className="space-y-6">
              <div className="text-center">
                <CheckCircle className="w-10 h-10 text-teal-400 mx-auto mb-3" />
                <h3 className="text-xl font-bold text-white">Your Readiness Report</h3>
                <p className="text-white/50 text-sm mt-1">Check your inbox — your full PDF report has been emailed to you.</p>
              </div>

              {/* Score + Tier */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-center">
                  <p className="text-white/50 text-xs mb-1">Total Score</p>
                  <p className="text-4xl font-bold text-primary">{results.totalScore}</p>
                  <p className="text-white/40 text-xs">out of 50</p>
                </div>
                <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-center">
                  <p className="text-white/50 text-xs mb-1">Maturity Tier</p>
                  <div className={cn("inline-block px-3 py-1 rounded-full text-white text-sm font-bold mt-1", TIER_COLOURS[results.tier] ?? "bg-primary")}>
                    {results.tier}
                  </div>
                </div>
              </div>

              {/* Category breakdown */}
              <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
                <p className="text-white/70 text-xs font-semibold uppercase tracking-wider mb-3">Category Breakdown</p>
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
                  <p className="text-white/70 text-xs font-semibold uppercase tracking-wider mb-2">What This Means</p>
                  <p className="text-white/80 text-sm leading-relaxed">{results.whatThisMeans}</p>
                </div>
              )}

              {/* Recommended service */}
              <div className="bg-primary/10 border border-primary/30 rounded-xl p-4">
                <p className="text-primary text-xs font-semibold uppercase tracking-wider mb-1">Recommended Next Step</p>
                <p className="text-white font-bold text-base">{results.recommendedService}</p>
                {results.serviceDescription && (
                  <p className="text-white/60 text-sm mt-1">{results.serviceDescription}</p>
                )}
              </div>

              <a
                href="/contact"
                className="w-full py-3 px-6 bg-primary hover:bg-primary/90 text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                Book a Strategy Call <ChevronRight className="w-4 h-4" />
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function CopilotQuiz() {
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    if (modalOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [modalOpen]);

  return (
    <Layout>
      {/* Hero */}
      <section className="relative min-h-[90vh] flex items-center justify-center overflow-hidden bg-[#0A2540]">
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#0A2540] via-[#0d2f50] to-[#0A2540]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_50%,rgba(0,120,212,0.15),transparent_60%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_20%,rgba(0,180,216,0.1),transparent_50%)]" />

        {/* Decorative dots grid */}
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage: "radial-gradient(circle, #ffffff 1px, transparent 1px)",
            backgroundSize: "32px 32px",
          }}
        />

        <div className="relative z-10 max-w-[900px] mx-auto px-6 text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 bg-primary/20 border border-primary/30 rounded-full px-4 py-1.5 mb-8">
            <Brain className="w-4 h-4 text-primary" />
            <span className="text-primary text-sm font-medium">AI-Powered Assessment</span>
          </div>

          <h1 className="text-4xl md:text-6xl font-bold text-white leading-tight mb-6">
            Is Your Organisation{" "}
            <span className="text-primary">Copilot-Ready?</span>
          </h1>
          <p className="text-white/70 text-lg md:text-xl leading-relaxed max-w-2xl mx-auto mb-10">
            Take our free 10-question AI assessment to benchmark your Microsoft 365 Copilot readiness
            across five dimensions. Receive a personalised PDF report and expert recommendation instantly.
          </p>

          {/* Stats */}
          <div className="flex flex-wrap items-center justify-center gap-8 mb-12 text-sm">
            {[
              { value: "5 min", label: "to complete" },
              { value: "5", label: "readiness categories" },
              { value: "Free", label: "personalised PDF report" },
            ].map((stat) => (
              <div key={stat.label} className="text-center">
                <p className="text-2xl font-bold text-primary">{stat.value}</p>
                <p className="text-white/50">{stat.label}</p>
              </div>
            ))}
          </div>

          <button
            onClick={() => setModalOpen(true)}
            className="group inline-flex items-center gap-3 bg-primary hover:bg-primary/90 text-white font-semibold text-lg px-8 py-4 rounded-xl transition-all duration-200 shadow-lg shadow-primary/25 hover:shadow-primary/40 hover:-translate-y-0.5"
          >
            Start the Free Assessment
            <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
          </button>

          <p className="text-white/30 text-sm mt-4">No account required · Results emailed instantly</p>
        </div>
      </section>

      {/* How it works */}
      <section className="py-20 bg-white">
        <div className="max-w-[1200px] mx-auto px-6">
          <h2 className="text-3xl font-bold text-[#0A2540] text-center mb-4">How the Assessment Works</h2>
          <p className="text-slate-500 text-center max-w-xl mx-auto mb-12">
            Our AI evaluates your answers across five critical readiness dimensions used by Microsoft's own deployment framework.
          </p>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                step: "01",
                title: "Answer 10 Questions",
                desc: "Our AI asks targeted questions about your M365 environment, data governance, team skills, and business readiness.",
              },
              {
                step: "02",
                title: "Get Scored Instantly",
                desc: "Receive a 0–50 readiness score with a breakdown across all five dimensions and your maturity tier.",
              },
              {
                step: "03",
                title: "Receive Your PDF Report",
                desc: "A branded PDF report lands in your inbox with your score, analysis, recommended service, and ROI projection.",
              },
            ].map((item) => (
              <div key={item.step} className="relative">
                <div className="text-6xl font-black text-primary/10 mb-4">{item.step}</div>
                <h3 className="text-xl font-bold text-[#0A2540] mb-2">{item.title}</h3>
                <p className="text-slate-500 text-sm leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What's assessed */}
      <section className="py-20 bg-[#F7F9FC]">
        <div className="max-w-[1200px] mx-auto px-6">
          <h2 className="text-3xl font-bold text-[#0A2540] text-center mb-4">What Gets Assessed</h2>
          <p className="text-slate-500 text-center max-w-xl mx-auto mb-12">
            Five critical dimensions that determine whether Copilot will deliver value or get stuck at rollout.
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                title: "Infrastructure & Identity",
                desc: "M365 licensing status, Entra ID health, MFA deployment, device compliance policies.",
                colour: "bg-blue-500",
              },
              {
                title: "Data & Compliance",
                desc: "Sensitivity labels, DLP policies, data governance maturity, information barriers.",
                colour: "bg-teal-500",
              },
              {
                title: "AI Literacy",
                desc: "Employee AI skills baseline, training programmes, adoption culture, AI champions.",
                colour: "bg-violet-500",
              },
              {
                title: "Change Management",
                desc: "Executive buy-in, policy documentation, pilot programme readiness, rollout planning.",
                colour: "bg-orange-500",
              },
              {
                title: "Business Process",
                desc: "Identified use cases, success metrics, ROI tracking plans, process ownership.",
                colour: "bg-green-500",
              },
              {
                title: "Your Report",
                desc: "All five dimensions scored, ranked, and mapped to a tailored service recommendation.",
                colour: "bg-primary",
                cta: true,
              },
            ].map((item) => (
              <div
                key={item.title}
                className={cn(
                  "bg-white rounded-xl p-6 border border-slate-100 shadow-sm",
                  item.cta && "bg-[#0A2540] border-[#0A2540]"
                )}
              >
                <div className={cn("w-2 h-8 rounded-full mb-4", item.colour)} />
                <h3 className={cn("font-bold text-lg mb-2", item.cta ? "text-white" : "text-[#0A2540]")}>
                  {item.title}
                </h3>
                <p className={cn("text-sm leading-relaxed", item.cta ? "text-white/60" : "text-slate-500")}>
                  {item.desc}
                </p>
                {item.cta && (
                  <button
                    onClick={() => setModalOpen(true)}
                    className="mt-4 text-primary text-sm font-semibold flex items-center gap-1 hover:gap-2 transition-all"
                  >
                    Start Assessment <ChevronRight className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-[#0A2540]">
        <div className="max-w-[700px] mx-auto px-6 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
            Don't Leave Your Copilot Rollout to Chance
          </h2>
          <p className="text-white/60 text-lg mb-8">
            Most Copilot deployments underperform because organisations skip the readiness work.
            Know exactly where you stand before you spend a dollar.
          </p>
          <CTAButton onClick={() => setModalOpen(true)} className="text-base px-8 py-4">
            Take the Free Assessment Now
          </CTAButton>
        </div>
      </section>

      {/* Modal */}
      {modalOpen && <QuizModal onClose={() => setModalOpen(false)} />}
    </Layout>
  );
}
