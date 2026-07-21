import { useRef, useState, useEffect, type CSSProperties, type KeyboardEvent } from "react";
import { Send } from "lucide-react";
import { identifyLead } from "@/lib/analytics";
import { cn } from "@/lib/utils";

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

interface ContactChatWidgetProps {
  className?: string;
  /** Applied to the widget's root card — e.g. `{ minHeight: "520px" }` on the full Contact page. */
  style?: CSSProperties;
  /** Max height of the scrollable message list before it scrolls internally — keeps the card's overall height stable as the conversation grows, instead of growing unbounded. */
  bodyMaxHeight?: string;
  /** Header subtitle — swap for tighter copy when the widget renders inside the compact bubble popup. */
  subtitle?: string;
}

/**
 * Shane's AI intake assistant — hits POST /api/contact-chat for conversation turns, then
 * POST /api/leads once the AI has extracted a complete name+email. Extracted out of
 * Contact.tsx so the persistent chat bubble (PersistentChatBubble.tsx) can open the exact
 * same live assistant instead of a second, divergent contact surface.
 */
export function ContactChatWidget({
  className,
  style,
  bodyMaxHeight = "440px",
  subtitle = "Here to gather the details so Shane can follow up personally",
}: ContactChatWidgetProps) {
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
          } catch {
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

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  };

  return (
    <div className={cn("bg-charcoal-1 rounded-2xl border border-white/[0.06] flex flex-col", className)} style={style}>
      <div className="border-b border-white/[0.06] px-6 py-4 flex items-center gap-3">
        <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0" style={GRADIENT_BG}>AI</div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text-primary">Shane's AI Assistant</p>
          <p className="text-xs text-text-secondary truncate">{subtitle}</p>
        </div>
        <span className="ml-auto flex items-center gap-1.5 text-xs text-emerald-400 font-medium flex-shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Online
        </span>
      </div>

      <div ref={containerRef} className="overflow-y-auto px-6 py-6" style={{ maxHeight: bodyMaxHeight }}>
        {initError && messages.length === 0 && !isLoading && (
          <div className="text-sm text-text-secondary text-center py-8">
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
            <p className="text-sm text-text-secondary">
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
              className="flex-1 bg-white/[0.04] border border-white/[0.1] rounded-lg px-4 py-2.5 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent-blue/60 resize-none disabled:opacity-50 disabled:cursor-not-allowed"
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
        <p className="text-[10px] text-text-secondary mt-2 text-center">
          Press <kbd className="font-mono bg-white/[0.06] border border-white/[0.1] rounded px-1">Enter</kbd> to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
