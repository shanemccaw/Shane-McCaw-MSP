import { SEOMeta } from "@/components/SEOMeta";
import { useRef, useState, useEffect, type KeyboardEvent } from "react";
import { Layout } from "@/components/Layout";
import { GlassPanel } from "@/components/design-system/GlassPanel";
import { GradientText } from "@/components/design-system/GradientText";
import { Mail, MapPin, Clock, Send, MessageSquare, ArrowRight } from "lucide-react";
import { identifyLead, trackEvent } from "@/lib/analytics";
import { usePersonalizationState } from "@/hooks/usePersonalizationState";
import { usePortalUrl } from "@/hooks/usePersonalizationData";

const GRADIENT_BG = { background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" };

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface LeadPayload {
  name?: string;
  email?: string;
  company?: string;
  companySize?: string;
  serviceArea?: string;
  howFound?: string;
  message?: string;
}

function TypingIndicator() {
  return (
    <div className="flex items-end gap-2 mb-4">
      <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-white text-xs font-bold" style={GRADIENT_BG}>
        AI
      </div>
      <div className="bg-white/[0.06] border border-white/[0.1] rounded-2xl rounded-bl-sm px-4 py-3">
        <div className="flex gap-1.5 items-center h-4">
          <span className="w-1.5 h-1.5 rounded-full bg-accent-blue animate-bounce [animation-delay:0ms]" />
          <span className="w-1.5 h-1.5 rounded-full bg-accent-blue animate-bounce [animation-delay:150ms]" />
          <span className="w-1.5 h-1.5 rounded-full bg-accent-blue animate-bounce [animation-delay:300ms]" />
        </div>
      </div>
    </div>
  );
}

function ChatBubble({ message }: { message: ChatMessage }) {
  const isAI = message.role === "assistant";
  return (
    <div className={`flex items-end gap-2 mb-4 ${isAI ? "" : "flex-row-reverse"}`}>
      {isAI ? (
        <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-white text-xs font-bold" style={GRADIENT_BG}>
          AI
        </div>
      ) : (
        <div className="w-7 h-7 rounded-full bg-white/[0.1] border border-white/[0.12] flex items-center justify-center flex-shrink-0 text-text-primary text-xs font-bold">
          You
        </div>
      )}
      <div
        className={`max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
          isAI
            ? "bg-white/[0.06] border border-white/[0.1] rounded-bl-sm text-text-primary"
            : "text-white rounded-br-sm"
        }`}
        style={isAI ? undefined : GRADIENT_BG}
      >
        {message.content}
      </div>
    </div>
  );
}

/**
 * Assessment-tier Portal handoff (website-rebuild-reference-v2.md §3, Stage 4b): a
 * recognized, logged-in visitor with a real Portal account gets routed straight into
 * msp-portal's real AI support chat (support-chat.tsx, route /support, requireAuth-gated
 * POST /api/msp/support/chat) instead of the generic contact-chat form here — that AI
 * already has real tenant context and can propose real remediations, this one can't.
 * Cross-app link reuses the EXISTING POST /api/public/checkout/gate email→portalUrl
 * mechanism (usePortalUrl) — the same one Login.tsx/CheckoutGate.tsx already use for
 * this exact handoff. Only rendered when portalUrl actually resolved; the caller falls
 * back to the standard contact-chat form otherwise (see usePortalUrl's own doc comment
 * for why resolution can fail — confirmed via code read, not guessed).
 */
function PortalSupportHandoff({ portalUrl }: { portalUrl: string }) {
  return (
    <GlassPanel className="flex flex-col items-center justify-center text-center px-8 py-12" style={{ minHeight: "520px" }}>
      <div className="w-14 h-14 rounded-full bg-white/[0.06] border border-white/[0.08] flex items-center justify-center mb-5 text-accent-blue">
        <MessageSquare className="w-6 h-6" />
      </div>
      <h3 className="font-display text-lg font-bold text-text-primary mb-2">Skip the form — go straight to your Portal</h3>
      <p className="text-text-secondary text-sm max-w-sm mb-6">
        You already have an account. Your Portal's AI assistant knows your real tenant data and can
        propose actual fixes — not just gather details for a follow-up.
      </p>
      <a
        href={`${portalUrl}/support`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-white text-sm font-semibold transition-opacity hover:opacity-90"
        style={GRADIENT_BG}
        data-track="cta"
        data-testid="contact-portal-support-link"
        onClick={() => trackEvent("personalization_nudge_click", { tier: "assessment", surface: "contact_portal_handoff" })}
      >
        Open Portal Support Chat <ArrowRight className="w-4 h-4" />
      </a>
      <p className="text-xs text-text-tertiary mt-4">
        Prefer this form instead?{" "}
        <a href="mailto:info@shanemccaw.com" className="text-accent-blue hover:underline">
          Email Shane directly
        </a>
        .
      </p>
    </GlassPanel>
  );
}

export default function Contact() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [initError, setInitError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { tier } = usePersonalizationState();
  const { portalUrl } = usePortalUrl();

  const scrollToBottom = () => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      setIsLoading(true);
      try {
        const res = await fetch("/api/contact-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: [] }),
        });
        if (!res.ok) throw new Error("init failed");
        const data = (await res.json()) as { reply: string };
        if (!cancelled) {
          setMessages([{ role: "assistant", content: data.reply }]);
        }
      } catch {
        if (!cancelled) setInitError(true);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void init();
    return () => { cancelled = true; };
  }, []);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || isLoading || isSubmitted) return;

    const newMessages: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(newMessages);
    setInput("");
    setIsLoading(true);

    try {
      const res = await fetch("/api/contact-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages }),
      });

      if (!res.ok) throw new Error("chat failed");
      const data = (await res.json()) as { reply: string; lead?: LeadPayload };

      if (data.lead) {
        const lead = data.lead;

        if (!lead.name || !lead.email) {
          setMessages([
            ...newMessages,
            {
              role: "assistant",
              content: "I'm missing a couple of details — could you confirm your name and email address so I can send your info to Shane?",
            },
          ]);
        } else {
          let leadSaved = false;
          let leadError = "";
          try {
            const leadRes = await fetch("/api/leads", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                name: lead.name,
                email: lead.email,
                company: lead.company ?? null,
                companySize: lead.companySize ?? null,
                serviceArea: lead.serviceArea ?? null,
                message: lead.message ?? null,
                source: "contact_form",
                howFound: lead.howFound ?? null,
              }),
            });
            if (leadRes.ok) {
              leadSaved = true;
            } else {
              const body = await leadRes.json().catch(() => ({})) as { error?: string };
              leadError = body.error ?? `Server error ${leadRes.status}`;
            }
          } catch (networkErr) {
            leadError = "Network error";
          }

          if (leadSaved) {
            if (lead.email) void identifyLead(lead.email);
            const confirmMsg = data.reply ||
              "Thanks! Your information has been sent to Shane. He'll personally follow up within one business day.";
            setMessages([...newMessages, { role: "assistant", content: confirmMsg }]);
            setIsSubmitted(true);
          } else {
            setMessages([
              ...newMessages,
              {
                role: "assistant",
                content: `I wasn't able to save your message right now (${leadError}). Could you try again, or email Shane directly at info@shanemccaw.com?`,
              },
            ]);
          }
        }
      } else {
        setMessages([...newMessages, { role: "assistant", content: data.reply }]);
      }
    } catch {
      setMessages([
        ...newMessages,
        {
          role: "assistant",
          content: "Sorry, something went wrong on my end. Please try again or email info@shanemccaw.com directly.",
        },
      ]);
    } finally {
      setIsLoading(false);
      if (!isSubmitted) {
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    }
  };

  useEffect(() => {
    if (tier === "assessment" && portalUrl) {
      trackEvent("personalization_shown", { tier: "assessment", surface: "contact_portal_handoff" });
    }
  }, [tier, portalUrl]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  };

  return (
    <Layout>
      <SEOMeta
        title="Contact Shane McCaw | Microsoft 365 Consultant | Shane McCaw Consulting"
        description="Contact Shane McCaw — NASA's Lead Microsoft 365 Architect. Get expert answers about M365, Copilot AI, SharePoint, and governance. Expect a personal response within 1 business day."
      />

      {/* HERO */}
      <section className="pt-32 sm:pt-40 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <p className="text-xs uppercase tracking-widest text-text-tertiary mb-4">Contact Shane McCaw</p>
          <h1 className="font-display text-4xl sm:text-6xl font-bold text-text-primary tracking-tight leading-tight max-w-3xl mb-6">
            Get in <GradientText>Touch</GradientText>
          </h1>
          <p className="text-lg text-text-secondary max-w-2xl leading-relaxed mb-4">
            You're contacting the Lead M365 Architect at NASA — 30 years of Microsoft ecosystem
            experience, now available to mid&#8209;market and regulated&#8209;industry organizations.
          </p>
          <p className="text-text-tertiary max-w-xl leading-relaxed">
            Tell me what you're dealing with and you'll get a straight, senior&#8209;level answer on
            whether and how I can help — no fluff, no sales pitch.
          </p>
        </div>
      </section>

      {/* WHO I WORK WITH */}
      <section className="pb-16 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06] pt-16">
        <div className="max-w-5xl mx-auto">
          <p className="text-xs uppercase tracking-widest text-text-tertiary mb-6">Who I Work With</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { title: "Mid-Market Organizations", desc: "200–2,000 employees ready to modernize their Microsoft 365 environment at scale." },
              { title: "Regulated Industries", desc: "Healthcare, finance, and legal organizations with strict compliance requirements." },
              { title: "Growing IT Teams", desc: "Internal teams that need a senior architect's judgment without a full-time hire." },
              { title: "Scaling Startups", desc: "Fast-growing organizations building a Microsoft 365 foundation that can handle compliance from day one." },
            ].map(({ title, desc }) => (
              <div key={title} className="flex items-start gap-3 p-5 rounded-2xl bg-charcoal-1 border border-white/[0.06]">
                <div className="w-2 h-2 rounded-full bg-accent-blue mt-1.5 flex-shrink-0" />
                <div>
                  <p className="font-semibold text-text-primary text-sm">{title}</p>
                  <p className="text-text-tertiary text-xs mt-1 leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CHAT + SIDEBAR */}
      <section className="pb-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">

            {/* Chat */}
            <div className="lg:col-span-2 flex flex-col">

              {/* Why People Contact Me */}
              <div className="mb-6">
                <h3 className="font-display text-base font-bold text-text-primary mb-3">Why People Contact Me</h3>
                <ul className="space-y-2">
                  {[
                    "Planning a Microsoft 365 migration, consolidation, or tenant-to-tenant move",
                    "Rolling out Copilot AI and need to get governance right before it becomes a liability",
                    "SharePoint has become a mess — sprawl, stale content, broken governance",
                    "Power Platform is growing ungoverned and nobody owns the strategy",
                    "Preparing for a HIPAA, SOC 2, or similar compliance audit",
                    "Current Microsoft partner or consultant isn't delivering senior-level architecture thinking",
                  ].map((reason) => (
                    <li key={reason} className="flex items-start gap-2 text-sm text-text-secondary">
                      <span className="text-accent-blue font-bold leading-5 flex-shrink-0">·</span>
                      {reason}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Micro-positioning */}
              <p className="text-text-secondary text-sm font-medium border-l-4 border-accent-blue/40 pl-4 py-1 mb-5">
                You'll speak directly with me — no account managers, no junior staff, no outsourcing.
              </p>

              {tier === "assessment" && portalUrl ? (
                <PortalSupportHandoff portalUrl={portalUrl} />
              ) : (
              <div className="bg-charcoal-1 rounded-2xl border border-white/[0.06] flex flex-col" style={{ minHeight: "520px" }}>
                <div className="border-b border-white/[0.06] px-6 py-4 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold" style={GRADIENT_BG}>AI</div>
                  <div>
                    <p className="text-sm font-semibold text-text-primary">Shane's AI Assistant</p>
                    <p className="text-xs text-text-tertiary">Here to gather the details so Shane can follow up personally</p>
                  </div>
                  <span className="ml-auto flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Online
                  </span>
                </div>

                <div ref={containerRef} className="flex-1 overflow-y-auto px-6 py-6" style={{ maxHeight: "440px" }}>
                  {initError && messages.length === 0 && !isLoading && (
                    <div className="text-sm text-text-tertiary text-center py-8">
                      Couldn't connect to the assistant.{" "}
                      <a href="mailto:info@shanemccaw.com" className="text-accent-blue hover:underline">
                        Email Shane directly
                      </a>{" "}
                      instead.
                    </div>
                  )}
                  {messages.map((msg, i) => (
                    <ChatBubble key={i} message={msg} />
                  ))}
                  {isLoading && <TypingIndicator />}
                </div>

                <div className="border-t border-white/[0.06] px-4 py-4">
                  {isSubmitted ? (
                    <div className="text-center py-2">
                      <p className="text-sm text-text-tertiary">
                        Conversation complete.{" "}
                        <a href="/book" className="text-accent-blue hover:underline font-medium">
                          Book a call
                        </a>{" "}
                        if you'd like to connect sooner.
                      </p>
                    </div>
                  ) : (
                    <div className="flex gap-2 items-end">
                      <textarea
                        ref={inputRef}
                        rows={1}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        disabled={isLoading || isSubmitted}
                        placeholder="Type your reply…"
                        className="flex-1 bg-white/[0.04] border border-white/[0.1] rounded-lg px-4 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-blue/60 resize-none disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ maxHeight: "120px" }}
                        data-testid="chat-input"
                      />
                      <button
                        onClick={() => void sendMessage()}
                        disabled={!input.trim() || isLoading || isSubmitted}
                        className="flex-shrink-0 w-10 h-10 rounded-lg text-white flex items-center justify-center transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                        style={GRADIENT_BG}
                        data-testid="chat-send"
                      >
                        <Send className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                  <p className="text-[10px] text-text-tertiary mt-2 text-center">
                    Press <kbd className="font-mono bg-white/[0.06] border border-white/[0.1] rounded px-1">Enter</kbd> to send · Shift+Enter for new line
                  </p>
                </div>
              </div>
              )}

              {/* What Happens Next */}
              <div className="bg-charcoal-1 rounded-2xl border border-white/[0.06] p-6 mt-6">
                <h4 className="font-display font-bold text-text-primary mb-4">What Happens Next</h4>
                <ol className="space-y-3">
                  <li className="flex items-start gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full text-white text-xs font-bold flex items-center justify-center mt-0.5" style={GRADIENT_BG}>1</span>
                    <div>
                      <p className="text-sm font-semibold text-text-primary">Review</p>
                      <p className="text-text-secondary text-sm">I read every message within 1 business day.</p>
                    </div>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full text-white text-xs font-bold flex items-center justify-center mt-0.5" style={GRADIENT_BG}>2</span>
                    <div>
                      <p className="text-sm font-semibold text-text-primary">Clarity</p>
                      <p className="text-text-secondary text-sm">You get a direct recommendation or a clear next step — no fluff.</p>
                    </div>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full text-white text-xs font-bold flex items-center justify-center mt-0.5" style={GRADIENT_BG}>3</span>
                    <div>
                      <p className="text-sm font-semibold text-text-primary">Call</p>
                      <p className="text-text-secondary text-sm">If it's a fit, we schedule a free 30-minute discovery call.</p>
                    </div>
                  </li>
                </ol>
              </div>
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              <div className="bg-charcoal-1 rounded-2xl border border-white/[0.06] p-6">
                <div className="flex items-start gap-3 mb-4">
                  <Clock className="w-5 h-5 text-accent-blue mt-0.5 flex-shrink-0" />
                  <div>
                    <h4 className="font-display font-bold text-text-primary mb-1">Personal Response</h4>
                    <p className="text-text-secondary text-sm">I personally respond to every inquiry within 1 business day.</p>
                  </div>
                </div>
              </div>

              <div className="bg-charcoal-1 rounded-2xl border border-white/[0.06] p-6">
                <div className="flex items-start gap-3 mb-4">
                  <Mail className="w-5 h-5 text-accent-blue mt-0.5 flex-shrink-0" />
                  <div>
                    <h4 className="font-display font-bold text-text-primary mb-1">Direct Email</h4>
                    <a href="mailto:info@shanemccaw.com" className="text-accent-blue text-sm hover:underline" data-testid="contact-email">
                      info@shanemccaw.com
                    </a>
                  </div>
                </div>
              </div>

              <div className="bg-charcoal-1 rounded-2xl border border-white/[0.06] p-6">
                <div className="flex items-start gap-3">
                  <MapPin className="w-5 h-5 text-accent-blue mt-0.5 flex-shrink-0" />
                  <div>
                    <h4 className="font-display font-bold text-text-primary mb-1">Location</h4>
                    <p className="text-text-secondary text-sm">Based in Vero Beach, FL.</p>
                    <p className="text-text-secondary text-sm">Serving clients nationwide via remote engagement.</p>
                  </div>
                </div>
              </div>

              <GlassPanel className="p-6">
                <h4 className="font-display font-bold text-text-primary mb-2">Prefer to skip the form?</h4>
                <p className="text-text-secondary text-sm mb-1">Book directly on my calendar.</p>
                <p className="text-text-tertiary text-xs mb-4">You'll speak directly with me — no junior staff.</p>
                <a
                  href="/book"
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-white text-sm font-semibold transition-opacity hover:opacity-90"
                  style={GRADIENT_BG}
                  data-track="cta"
                  data-testid="contact-book-link"
                >
                  Book a Free Call
                </a>
              </GlassPanel>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="pb-24 px-4 sm:px-6 lg:px-8 text-center">
        <div className="max-w-3xl mx-auto">
          <GlassPanel className="p-8 sm:p-12">
            <h2 className="font-display text-3xl sm:text-4xl font-bold text-text-primary mb-4">
              Your Microsoft 365 environment deserves <GradientText>senior expertise</GradientText>.
            </h2>
            <p className="text-text-secondary max-w-xl mx-auto mb-8 text-sm sm:text-base">
              Reach out and get clarity from someone who architects at NASA scale.
            </p>
            <a
              href="/book"
              className="inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-xl font-semibold text-white transition-opacity hover:opacity-90"
              style={GRADIENT_BG}
              data-track="cta"
            >
              Book a Free Call
            </a>
          </GlassPanel>
        </div>
      </section>
    </Layout>
  );
}
