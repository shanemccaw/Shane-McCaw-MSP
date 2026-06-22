import { useState, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { X, ChevronRight, CheckCircle, Loader2, BarChart3, Award, Zap, ArrowRight, Link2, Check } from "lucide-react";
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
  whyThisFits: string;
  roiProjection: string;
}

type QuizState = "intro" | "questioning" | "lead-capture" | "submitting" | "results";

export interface TierUpsell {
  badge: string;
  name: string;
  description: string;
  slug: string;
  ctaText: string;
}

export interface QuizConfig {
  quizType: string;
  title: string;
  categories: Array<{ key: string; label: string }>;
  fallbackQuestions: readonly string[];
  tierUpsells: Record<string, TierUpsell>;
  introTitle: string;
  introDescription: string;
  reportTitle: string;
  pdfFilename: string;
  introFeatureLabels?: [string, string, string];
}

// ─── Lead capture schema ───────────────────────────────────────────────────────
const leadSchema = z.object({
  name: z.string().min(2, "Please enter your full name"),
  email: z.string().email("Please enter a valid email address"),
  company: z.string().optional(),
});
type LeadForm = z.infer<typeof leadSchema>;

// ─── Tier colours ─────────────────────────────────────────────────────────────
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
        <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
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
        <div className={cn("h-full rounded-full transition-all duration-700", colour)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ─── Quiz Modal ────────────────────────────────────────────────────────────────
export function GenericQuizModal({ config, onClose }: { config: QuizConfig; onClose: () => void }) {
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
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [shareCopied, setShareCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { register, handleSubmit, formState: { errors } } = useForm<LeadForm>({ resolver: zodResolver(leadSchema) });
  const TOTAL_QUESTIONS = 10;

  async function startQuiz() {
    setState("questioning");
    setLoading(true);
    try {
      const data = await apiPost<{ content: string }>("/quiz/chat", { messages: [], quizType: config.quizType });
      setCurrentQuestion(data.content);
      setMessages([{ role: "assistant", content: data.content }]);
      setQuestionIndex(1);
    } catch {
      setCurrentQuestion(config.fallbackQuestions[0] as string);
      setQuestionIndex(1);
    } finally {
      setLoading(false);
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }

  async function submitAnswer() {
    if (!answer.trim() || loading) return;
    const userMsg: Message = { role: "user", content: answer.trim() };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setAnswer("");

    if (questionIndex >= TOTAL_QUESTIONS) {
      setState("lead-capture");
      return;
    }

    setLoading(true);
    try {
      const data = await apiPost<{ content: string }>("/quiz/chat", { messages: updatedMessages, quizType: config.quizType });
      const assistantMsg: Message = { role: "assistant", content: data.content };
      setMessages([...updatedMessages, assistantMsg]);
      setCurrentQuestion(data.content);
      setQuestionIndex((q) => q + 1);
    } catch {
      setCurrentQuestion(config.fallbackQuestions[Math.min(questionIndex, config.fallbackQuestions.length - 1)] as string);
      setQuestionIndex((q) => q + 1);
    } finally {
      setLoading(false);
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }

  async function onLeadSubmit(lead: LeadForm) {
    setState("submitting");
    setSubmitError("");
    try {
      const data = await apiPost<QuizResults & { success: boolean }>("/quiz/submit", {
        name: lead.name,
        email: lead.email,
        company: lead.company,
        conversation: messages,
        quizType: config.quizType,
      });
      setSubmittedEmail(lead.email);
      setResendEmail(lead.email);
      setResults(data);
      setState("results");
    } catch {
      setSubmitError("Something went wrong. Please try again.");
      setState("lead-capture");
    }
  }

  function copyShareLink() {
    if (!results?.leadId || !results?.resendToken) return;
    const url = `${window.location.origin}/quiz/results/${results.leadId}?token=${results.resendToken}`;
    navigator.clipboard.writeText(url).catch(() => {
      const ta = document.createElement("textarea");
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    });
    setShareCopied(true);
    setTimeout(() => setShareCopied(false), 2500);
  }

  async function handleResend(e: React.FormEvent) {
    e.preventDefault();
    if (!results?.leadId || !results?.resendToken || !resendEmail || resendState === "sending") return;
    setResendState("sending");
    try {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${base}/api/quiz/resend-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: results.leadId, resendToken: results.resendToken, email: resendEmail }),
      });
      setResendState(res.ok ? "sent" : "error");
    } catch {
      setResendState("error");
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submitAnswer();
    }
  }

  const upsell = results ? (TIER_COLOURS[results.tier] ? config.tierUpsells[results.tier] ?? config.tierUpsells["Developing"] : config.tierUpsells["Developing"]) : null;
  const tierColour = results ? (TIER_COLOURS[results.tier] ?? "bg-blue-500") : "bg-blue-500";
  const [feat1, feat2, feat3] = config.introFeatureLabels ?? ["5 categories scored", "Maturity tier rating", "PDF report emailed"];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-2xl max-h-[90vh] flex flex-col bg-[#0A2540] rounded-2xl shadow-2xl border border-white/10 overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
          <span className="font-semibold text-white text-sm">{config.title}</span>
          {state === "questioning" && (
            <div className="flex-1 mx-6">
              <ProgressBar step={questionIndex} total={TOTAL_QUESTIONS} />
            </div>
          )}
          <button onClick={onClose} className="text-white/50 hover:text-white transition-colors ml-2 shrink-0" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-6 min-h-0">

          {/* Intro */}
          {state === "intro" && (
            <div className="space-y-6 text-center py-4">
              <div>
                <h2 className="text-2xl font-bold text-white mb-2">{config.introTitle}</h2>
                <p className="text-white/70 text-sm leading-relaxed max-w-md mx-auto">{config.introDescription}</p>
              </div>
              <div className="grid grid-cols-3 gap-3 text-left">
                {[
                  { icon: <BarChart3 className="w-4 h-4" />, label: feat1 },
                  { icon: <Award className="w-4 h-4" />, label: feat2 },
                  { icon: <Zap className="w-4 h-4" />, label: feat3 },
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

          {/* Questioning */}
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

          {/* Lead capture */}
          {state === "lead-capture" && (
            <form onSubmit={handleSubmit(onLeadSubmit)} className="space-y-5">
              <div className="text-center mb-2">
                <CheckCircle className="w-10 h-10 text-teal-400 mx-auto mb-3" />
                <h3 className="text-xl font-bold text-white">Assessment Complete!</h3>
                <p className="text-white/60 text-sm mt-1">Enter your details to receive your personalised PDF report by email.</p>
              </div>
              {submitError && (
                <p className="text-red-400 text-sm text-center bg-red-400/10 rounded-lg p-3">{submitError}</p>
              )}
              <div className="space-y-4">
                <div>
                  <label className="block text-white/70 text-sm mb-1.5">Full Name *</label>
                  <input {...register("name")} placeholder="Jane Smith"
                    className="w-full bg-white/5 border border-white/20 rounded-lg px-4 py-2.5 text-white placeholder:text-white/30 text-sm focus:outline-none focus:border-primary/60 transition-colors" />
                  {errors.name && <p className="text-red-400 text-xs mt-1">{errors.name.message}</p>}
                </div>
                <div>
                  <label className="block text-white/70 text-sm mb-1.5">Work Email *</label>
                  <input {...register("email")} type="email" placeholder="jane@company.com"
                    className="w-full bg-white/5 border border-white/20 rounded-lg px-4 py-2.5 text-white placeholder:text-white/30 text-sm focus:outline-none focus:border-primary/60 transition-colors" />
                  {errors.email && <p className="text-red-400 text-xs mt-1">{errors.email.message}</p>}
                </div>
                <div>
                  <label className="block text-white/70 text-sm mb-1.5">Company (optional)</label>
                  <input {...register("company")} placeholder="Acme Corp"
                    className="w-full bg-white/5 border border-white/20 rounded-lg px-4 py-2.5 text-white placeholder:text-white/30 text-sm focus:outline-none focus:border-primary/60 transition-colors" />
                </div>
              </div>
              <button type="submit"
                className="w-full py-3 px-6 bg-primary hover:bg-primary/90 text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2">
                Get My Report <ChevronRight className="w-4 h-4" />
              </button>
              <p className="text-white/30 text-xs text-center">Your report will be emailed instantly. No spam, ever.</p>
            </form>
          )}

          {/* Submitting */}
          {state === "submitting" && (
            <div className="flex flex-col items-center justify-center py-16 space-y-4">
              <Loader2 className="w-10 h-10 text-primary animate-spin" />
              <p className="text-white font-semibold">Analysing your responses…</p>
              <p className="text-white/50 text-sm">Generating your personalised report</p>
            </div>
          )}

          {/* Results */}
          {state === "results" && results && (
            <div className="space-y-6">
              <div className="text-center">
                <CheckCircle className="w-10 h-10 text-teal-400 mx-auto mb-3" />
                <h3 className="text-xl font-bold text-white">Your Report</h3>
                {submittedEmail ? (
                  <p className="text-white/50 text-sm mt-1">PDF report sent to <span className="text-teal-400 font-medium">{submittedEmail}</span></p>
                ) : (
                  <p className="text-white/50 text-sm mt-1">Check your inbox — your full PDF report has been emailed.</p>
                )}
              </div>

              {/* Resend form */}
              {results.leadId && results.resendToken && (
                <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                  <p className="text-white/70 text-xs font-semibold uppercase tracking-wider mb-3">Forward Report to Another Address</p>
                  {resendState === "sent" ? (
                    <div className="flex items-center gap-2 text-teal-400 text-sm">
                      <CheckCircle className="w-4 h-4" /> Report sent!
                    </div>
                  ) : (
                    <form onSubmit={(e) => void handleResend(e)} className="flex gap-2">
                      <input
                        type="email"
                        value={resendEmail}
                        onChange={(e) => setResendEmail(e.target.value)}
                        placeholder="another@email.com"
                        className="flex-1 bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white placeholder:text-white/30 text-sm focus:outline-none focus:border-primary/60 transition-colors"
                      />
                      <button type="submit" disabled={resendState === "sending" || !resendEmail}
                        className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-40">
                        {resendState === "sending" ? <Loader2 className="w-4 h-4 animate-spin" /> : "Send"}
                      </button>
                    </form>
                  )}
                  {resendState === "error" && <p className="text-red-400 text-xs mt-2">Failed to send. Please try again.</p>}
                </div>
              )}

              {/* Share link */}
              {results.leadId && results.resendToken && (
                <div className="flex justify-center">
                  <button
                    onClick={copyShareLink}
                    className={cn(
                      "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all border",
                      shareCopied
                        ? "bg-teal-500/10 border-teal-500/30 text-teal-400"
                        : "bg-white/5 border-white/20 text-white/70 hover:bg-white/10 hover:text-white"
                    )}
                  >
                    {shareCopied ? <Check className="w-4 h-4" /> : <Link2 className="w-4 h-4" />}
                    {shareCopied ? "Link copied!" : "Share your results"}
                  </button>
                </div>
              )}

              {/* Score overview */}
              <div className="bg-white/5 border border-white/10 rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-white/50 text-xs font-semibold uppercase tracking-wider mb-1">Total Score</p>
                    <p className="text-white font-bold text-3xl">{results.totalScore}<span className="text-white/40 text-lg font-normal">/50</span></p>
                  </div>
                  <div className="text-right">
                    <p className="text-white/50 text-xs font-semibold uppercase tracking-wider mb-1">Maturity Tier</p>
                    <span className={cn("inline-block text-white text-sm font-bold px-3 py-1 rounded-full", tierColour)}>
                      {results.tier}
                    </span>
                  </div>
                </div>
                <div className="space-y-3 pt-2 border-t border-white/10">
                  {config.categories.map((cat) => (
                    <ScoreBar
                      key={cat.key}
                      label={cat.label}
                      score={results.categoryScores[cat.key] ?? 0}
                    />
                  ))}
                </div>
              </div>

              {/* AI analysis */}
              {results.whatThisMeans && (
                <div className="bg-white/5 border border-white/10 rounded-xl p-5 space-y-3">
                  <p className="text-white/50 text-xs font-semibold uppercase tracking-wider">What This Means For You</p>
                  <p className="text-white/80 text-sm leading-relaxed">{results.whatThisMeans}</p>
                </div>
              )}

              {/* Upsell */}
              {upsell && (
                <div className="bg-primary/10 border border-primary/30 rounded-xl p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-primary text-xs font-bold uppercase tracking-wider">Recommended Next Step</p>
                    <span className="text-primary text-xs font-semibold bg-primary/10 px-2.5 py-1 rounded-full border border-primary/30">
                      {upsell.badge}
                    </span>
                  </div>
                  <p className="text-white font-bold text-base">{upsell.name}</p>
                  <p className="text-white/70 text-sm leading-relaxed">
                    {results?.whyThisFits || upsell.description}
                  </p>
                  <div className="flex flex-col sm:flex-row gap-2 pt-1">
                    <a
                      href={`/crm/portal/onboarding/select?service=${upsell.slug}`}
                      className="flex-1 py-2.5 px-4 bg-primary hover:bg-primary/90 text-white font-semibold rounded-lg text-sm transition-colors flex items-center justify-center gap-1.5"
                      onClick={() => results && trackEvent("quiz_upsell_cta_click", { quiz_type: config.quizType, tier: results.tier, score: results.totalScore, upsell_slug: upsell.slug })}
                    >
                      {upsell.ctaText} <ArrowRight className="w-3.5 h-3.5" />
                    </a>
                    <a
                      href="/book"
                      className="flex-1 py-2.5 px-4 border border-white/20 hover:border-white/40 text-white/80 hover:text-white font-semibold rounded-lg text-sm transition-colors flex items-center justify-center gap-1.5"
                      onClick={() => results && trackEvent("quiz_upsell_details_click", { quiz_type: config.quizType, tier: results.tier, score: results.totalScore, destination: "book-call" })}
                    >
                      Book a Free Call
                    </a>
                  </div>
                </div>
              )}

              {results.roiProjection && (
                <div className="bg-white/5 border border-white/10 rounded-xl p-5">
                  <p className="text-white/50 text-xs font-semibold uppercase tracking-wider mb-2">ROI Projection</p>
                  <p className="text-white/80 text-sm leading-relaxed">{results.roiProjection}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
