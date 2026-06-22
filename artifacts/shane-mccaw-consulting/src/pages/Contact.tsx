import { SEOMeta } from "@/components/SEOMeta";
import { useRef, useState, useEffect, type KeyboardEvent } from "react";
import { Layout } from "@/components/Layout";
import { CTAButton } from "@/components/CTAButton";
import { MicrosoftBookingsEmbed } from "@/components/MicrosoftBookingsEmbed";
import { Mail, MapPin, Clock, Send } from "lucide-react";

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
      <div className="w-7 h-7 rounded-full bg-[#0078D4] flex items-center justify-center flex-shrink-0 text-white text-xs font-bold">
        AI
      </div>
      <div className="bg-[#0078D4]/10 border border-[#0078D4]/20 rounded-2xl rounded-bl-sm px-4 py-3">
        <div className="flex gap-1.5 items-center h-4">
          <span className="w-1.5 h-1.5 rounded-full bg-[#0078D4] animate-bounce [animation-delay:0ms]" />
          <span className="w-1.5 h-1.5 rounded-full bg-[#0078D4] animate-bounce [animation-delay:150ms]" />
          <span className="w-1.5 h-1.5 rounded-full bg-[#0078D4] animate-bounce [animation-delay:300ms]" />
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
        <div className="w-7 h-7 rounded-full bg-[#0078D4] flex items-center justify-center flex-shrink-0 text-white text-xs font-bold">
          AI
        </div>
      ) : (
        <div className="w-7 h-7 rounded-full bg-[#0A2540] flex items-center justify-center flex-shrink-0 text-white text-xs font-bold">
          You
        </div>
      )}
      <div
        className={`max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
          isAI
            ? "bg-[#0078D4]/10 border border-[#0078D4]/20 rounded-bl-sm text-[#0A2540]"
            : "bg-[#0078D4] text-white rounded-br-sm"
        }`}
      >
        {message.content}
      </div>
    </div>
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
      <section className="bg-[#0A2540] pt-32 pb-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">Contact Shane McCaw</p>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-white leading-tight max-w-3xl">
            Get in Touch
          </h1>
          <p className="text-white/70 text-lg mt-6 max-w-2xl leading-relaxed">
            You're contacting the Lead M365 Architect at NASA — 30 years of Microsoft ecosystem experience, now available to mid&#8209;market and regulated&#8209;industry organizations.
          </p>
          <p className="text-white/50 text-base mt-4 max-w-xl leading-relaxed">
            Tell me what you're dealing with and you'll get a straight, senior&#8209;level answer on whether and how I can help — no fluff, no sales pitch.
          </p>
        </div>
      </section>

      <section className="bg-white py-14 border-b border-border">
        <div className="max-w-[1200px] mx-auto px-6">
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-6">Who I Work With</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { title: "Mid-Market Organizations", desc: "200–2,000 employees ready to modernize their Microsoft 365 environment at scale." },
              { title: "Regulated Industries", desc: "Healthcare, finance, legal, and defense organizations with strict compliance requirements." },
              { title: "Government Contractors", desc: "Teams preparing for CMMC, FedRAMP, ITAR, or other federal compliance frameworks." },
              { title: "Scaling Startups", desc: "Fast-growing organizations building a Microsoft 365 foundation that can handle compliance from day one." },
            ].map(({ title, desc }) => (
              <div key={title} className="flex items-start gap-3 p-5 border border-border rounded-xl bg-[#F7F9FC]">
                <div className="w-2 h-2 rounded-full bg-[#0078D4] mt-1.5 flex-shrink-0" />
                <div>
                  <p className="font-semibold text-[#0A2540] text-sm">{title}</p>
                  <p className="text-muted-foreground text-xs mt-1 leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">

            {/* Chat */}
            <div className="lg:col-span-2 flex flex-col">

              {/* Why People Contact Me */}
              <div className="mb-6">
                <h3 className="text-base font-bold text-[#0A2540] mb-3">Why People Contact Me</h3>
                <ul className="space-y-2">
                  {[
                    "Planning a Microsoft 365 migration, consolidation, or tenant-to-tenant move",
                    "Rolling out Copilot AI and need to get governance right before it becomes a liability",
                    "SharePoint has become a mess — sprawl, stale content, broken governance",
                    "Power Platform is growing ungoverned and nobody owns the strategy",
                    "Preparing for CMMC, FedRAMP, HIPAA, SOC 2, or similar compliance",
                    "Current Microsoft partner or consultant isn't delivering senior-level architecture thinking",
                  ].map((reason) => (
                    <li key={reason} className="flex items-start gap-2 text-sm text-[#0A2540]/80">
                      <span className="text-[#0078D4] font-bold leading-5 flex-shrink-0">·</span>
                      {reason}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Micro-positioning */}
              <p className="text-[#0A2540] text-sm font-medium border-l-4 border-[#0078D4] pl-4 py-1 mb-5">
                You'll speak directly with me — no account managers, no junior staff, no outsourcing.
              </p>

              <div className="bg-white rounded-xl border border-border flex flex-col" style={{ minHeight: "520px" }}>
                <div className="border-b border-border px-6 py-4 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-[#0078D4] flex items-center justify-center text-white text-xs font-bold">AI</div>
                  <div>
                    <p className="text-sm font-semibold text-[#0A2540]">Shane's AI Assistant</p>
                    <p className="text-xs text-muted-foreground">Here to gather the details so Shane can follow up personally</p>
                  </div>
                  <span className="ml-auto flex items-center gap-1.5 text-xs text-emerald-600 font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Online
                  </span>
                </div>

                <div ref={containerRef} className="flex-1 overflow-y-auto px-6 py-6" style={{ maxHeight: "440px" }}>
                  {initError && messages.length === 0 && !isLoading && (
                    <div className="text-sm text-muted-foreground text-center py-8">
                      Couldn't connect to the assistant.{" "}
                      <a href="mailto:info@shanemccaw.com" className="text-[#0078D4] hover:underline">
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

                <div className="border-t border-border px-4 py-4">
                  {isSubmitted ? (
                    <div className="text-center py-2">
                      <p className="text-sm text-muted-foreground">
                        Conversation complete.{" "}
                        <a href="/book" className="text-[#0078D4] hover:underline font-medium">
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
                        className="flex-1 border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] resize-none disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ maxHeight: "120px" }}
                        data-testid="chat-input"
                      />
                      <button
                        onClick={() => void sendMessage()}
                        disabled={!input.trim() || isLoading || isSubmitted}
                        className="flex-shrink-0 w-10 h-10 rounded-lg bg-[#0078D4] hover:bg-[#006BBE] disabled:opacity-40 disabled:cursor-not-allowed text-white flex items-center justify-center transition-colors"
                        data-testid="chat-send"
                      >
                        <Send className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                  <p className="text-[10px] text-muted-foreground mt-2 text-center">
                    Press <kbd className="font-mono bg-[#F7F9FC] border border-border rounded px-1">Enter</kbd> to send · Shift+Enter for new line
                  </p>
                </div>
              </div>

              {/* What Happens Next */}
              <div className="bg-white rounded-xl border border-border p-6 mt-6">
                <h4 className="font-bold text-[#0A2540] mb-4">What Happens Next</h4>
                <ol className="space-y-3">
                  <li className="flex items-start gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#0078D4] text-white text-xs font-bold flex items-center justify-center mt-0.5">1</span>
                    <div>
                      <p className="text-sm font-semibold text-[#0A2540]">Review</p>
                      <p className="text-muted-foreground text-sm">I read every message within 1 business day.</p>
                    </div>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#0078D4] text-white text-xs font-bold flex items-center justify-center mt-0.5">2</span>
                    <div>
                      <p className="text-sm font-semibold text-[#0A2540]">Clarity</p>
                      <p className="text-muted-foreground text-sm">You get a direct recommendation or a clear next step — no fluff.</p>
                    </div>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#0078D4] text-white text-xs font-bold flex items-center justify-center mt-0.5">3</span>
                    <div>
                      <p className="text-sm font-semibold text-[#0A2540]">Call</p>
                      <p className="text-muted-foreground text-sm">If it's a fit, we schedule a free 30-minute discovery call.</p>
                    </div>
                  </li>
                </ol>
              </div>

              {/* Microsoft Bookings Inline Embed — only shown when configured */}
              {import.meta.env.VITE_BOOKINGS_URL && (
                <div className="mt-10" data-testid="bookings-embed-contact">
                  <h3 className="text-xl font-bold text-[#0A2540] mb-4">Or Book Directly on My Calendar</h3>
                  <MicrosoftBookingsEmbed minHeight={630} />
                </div>
              )}
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              <div className="bg-white rounded-xl border border-border p-6">
                <div className="flex items-start gap-3 mb-4">
                  <Clock className="w-5 h-5 text-[#0078D4] mt-0.5 flex-shrink-0" />
                  <div>
                    <h4 className="font-bold text-[#0A2540] mb-1">Personal Response</h4>
                    <p className="text-muted-foreground text-sm">I personally respond to every inquiry within 1 business day.</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-border p-6">
                <div className="flex items-start gap-3 mb-4">
                  <Mail className="w-5 h-5 text-[#0078D4] mt-0.5 flex-shrink-0" />
                  <div>
                    <h4 className="font-bold text-[#0A2540] mb-1">Direct Email</h4>
                    <a href="mailto:info@shanemccaw.com" className="text-[#0078D4] text-sm hover:underline" data-testid="contact-email">
                      info@shanemccaw.com
                    </a>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-border p-6">
                <div className="flex items-start gap-3">
                  <MapPin className="w-5 h-5 text-[#0078D4] mt-0.5 flex-shrink-0" />
                  <div>
                    <h4 className="font-bold text-[#0A2540] mb-1">Location</h4>
                    <p className="text-muted-foreground text-sm">Based in Vero Beach, FL.</p>
                    <p className="text-muted-foreground text-sm">Serving clients nationwide via remote engagement.</p>
                  </div>
                </div>
              </div>

              <div className="bg-[#0078D4]/10 border border-[#0078D4]/30 rounded-xl p-6">
                <h4 className="font-bold text-[#0A2540] mb-2">Prefer to skip the form?</h4>
                <p className="text-muted-foreground text-sm mb-1">Book directly on my calendar.</p>
                <p className="text-muted-foreground text-xs mb-4">You'll speak directly with me — no junior staff.</p>
                <CTAButton href="/book" className="w-full justify-center text-sm" data-testid="contact-book-link">
                  Book a Free Call
                </CTAButton>
              </div>
            </div>
          </div>
        </div>
      </section>
      {/* Final CTA */}
      <section className="bg-[#0A2540] py-20">
        <div className="max-w-[1200px] mx-auto px-6 text-center">
          <p className="text-white text-2xl md:text-3xl font-bold mb-4">
            Your Microsoft 365 environment deserves senior expertise.
          </p>
          <p className="text-white/70 text-lg max-w-xl mx-auto mb-8">
            Reach out and get clarity from someone who architects at NASA scale.
          </p>
          <CTAButton href="/book">
            Book a Free Call
          </CTAButton>
        </div>
      </section>
    </Layout>
  );
}
