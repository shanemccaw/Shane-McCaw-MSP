import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "wouter";
import { LifeBuoy, Loader2, Send, X } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import {
  buildContent,
  contentToText,
  suggestedRepliesFrom,
  type ChatMessageContent,
} from "@/lib/chat-content-blocks";
import { ChatBubble, type ChatMessage } from "@/components/support-chat/ChatBubble";
import { SuggestedReplies } from "@/components/support-chat/SuggestedReplies";
import { TypingIndicator } from "@/components/support-chat/TypingIndicator";

const HAIRLINE = "rgba(255,255,255,.09)";
const CARD_BG = "rgba(255,255,255,.02)";
const ACCENT = "#0078D4";

const STARTERS = [
  "What have I been invoiced for?",
  "What plan am I on?",
  "What is my Copilot readiness score?",
  "Show me everything on my account",
  "Can you turn on MFA for everyone?",
];

/** "What ShaneBot will not do" — real design copy, carried verbatim (Design/portal §ShaneBot). */
const LEDGER: Array<{ gap: string; where: string }> = [
  { gap: "It cannot change anything in your tenant. Every card is a read; nothing it shows came with a write.", where: "propose, never act" },
  { gap: "It never invents a card. If your account holds no invoices, you get a sentence saying so rather than an empty table.", where: "§4" },
  { gap: "It shows one card per answer, the most specific one that fits. The all-in-one account card is its last resort.", where: "§4.4" },
  { gap: "An answer it cannot ground in your own data is refused rather than guessed.", where: "§2" },
  { gap: "Nothing is remembered. The conversation is not stored on either side, so reloading starts empty.", where: "§6" },
  { gap: "It has no view of your tickets. It can raise one with Shane; it cannot then tell you what happened to it.", where: "§5.4" },
  { gap: "It answers only for your own tenant, and only when you are signed in as its customer.", where: "§2" },
];

interface ChatResponse {
  reply: string;
  content?: ChatMessageContent;
  suggestedReplies?: string[];
  escalated?: boolean;
  error?: string;
}

function assistantContent(data: ChatResponse): ChatMessageContent {
  return data.content ?? buildContent(data.reply ?? "", data.suggestedReplies ?? []);
}

/**
 * ShaneBot — the portal's AI support assistant (#2519, carried forward from
 * #1622; real design pack for #4114/#1741 at
 * `Design/portal/design_handoff_full_site/screens/ShaneBot.dc.html`). Wired
 * to the real `POST /api/msp/support/chat` (single-turn grounded answer,
 * this route is stateless — the client holds and re-sends the transcript
 * each turn, contract pack §6) and `POST /api/msp/support/escalate`
 * (explicit human handoff). Renders the real #361 structured content
 * blocks, including an Active Card (#366) when the model requests one and
 * real data backs it — a reply with no card is the normal case, not an
 * empty state (contract pack §8), so the layout must hold together either
 * way.
 */
export default function SupportPage() {
  const { fetchWithAuth } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isEscalating, setIsEscalating] = useState(false);
  const [escalatedNotice, setEscalatedNotice] = useState<string | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  const sendMessage = async (override?: string) => {
    const text = (override ?? input).trim();
    if (!text || isLoading) return;

    const newMessages: ChatMessage[] = [...messages, { role: "user", content: buildContent(text) }];
    setMessages(newMessages);
    setInput("");
    setIsLoading(true);
    setFatalError(null);

    try {
      const res = await fetchWithAuth(
        "/api/msp/support/chat",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
          }),
        },
        { silent: true },
      );

      if (res.status === 403) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setFatalError(data.error ?? "Support chat isn't available for this account.");
        setMessages(messages);
        return;
      }
      if (!res.ok) throw new Error(`request failed (${res.status})`);

      const data = (await res.json()) as ChatResponse;
      setMessages([...newMessages, { role: "assistant", content: assistantContent(data) }]);
      if (data.escalated) {
        setEscalatedNotice("This question was also sent to a human — you'll hear back by email or in your inbox.");
      }
    } catch {
      setMessages([
        ...newMessages,
        {
          role: "assistant",
          content: buildContent("Sorry, something went wrong reaching the AI assistant. Please try again shortly."),
        },
      ]);
    } finally {
      setIsLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const escalate = async () => {
    if (isEscalating) return;
    setIsEscalating(true);
    setEscalatedNotice(null);
    try {
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      const question = lastUser ? contentToText(lastUser.content) : "";
      const res = await fetchWithAuth("/api/msp/support/escalate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      setEscalatedNotice(data.message ?? "Your question has been sent to a human.");
    } finally {
      setIsEscalating(false);
    }
  };

  const clearConversation = () => {
    setMessages([]);
    setInput("");
    setFatalError(null);
    setEscalatedNotice(null);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  };

  const latestAssistantIndex = [...messages].map((m) => m.role).lastIndexOf("assistant");
  const canSend = input.trim().length > 0 && !isLoading && !fatalError;

  return (
    <div className="flex flex-col gap-4 p-6" data-testid="support-page">
      <div className="flex flex-wrap gap-4">
        <div
          className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border"
          style={{ borderColor: HAIRLINE, background: CARD_BG }}
        >
          <div className="flex flex-wrap items-center gap-3 border-b px-[26px] py-[16px]" style={{ borderColor: HAIRLINE }}>
            <div
              className="flex size-[30px] flex-none items-center justify-center rounded-[9px] text-[11.5px] font-extrabold text-white"
              style={{ background: "linear-gradient(135deg,#0078D4,#00B4D8)", letterSpacing: "-.02em" }}
            >
              SM
            </div>
            <div className="flex min-w-0 flex-col gap-px">
              <span className="text-[15px] font-bold" style={{ color: "#f8fafc", letterSpacing: "-.01em" }}>
                ShaneBot
              </span>
              <span className="text-[11px]" style={{ color: "#64748b" }}>
                Answers from your own tenant data ·{" "}
                <Link href="/requests" className="hover:underline" style={{ color: "#60a5fa" }} data-testid="support-view-requests-link">
                  View your requests →
                </Link>
              </span>
            </div>
            <button
              type="button"
              onClick={() => void escalate()}
              disabled={isEscalating}
              data-testid="support-chat-escalate"
              className="ml-auto flex flex-none items-center gap-2 whitespace-nowrap rounded-md px-[13px] py-[7px] text-[12px] font-semibold transition-colors"
              style={{ color: "#cbd5e1", border: `1px solid ${HAIRLINE}` }}
            >
              {isEscalating ? <Loader2 className="size-4 animate-spin" /> : <LifeBuoy className="size-4" />}
              Talk to a human
            </button>
            <button
              type="button"
              onClick={clearConversation}
              disabled={messages.length === 0 && !escalatedNotice}
              data-testid="support-chat-clear"
              className="flex-none whitespace-nowrap text-[12px] font-semibold disabled:cursor-default disabled:opacity-40"
              style={{ color: "#64748b" }}
            >
              Clear
            </button>
          </div>

          {escalatedNotice && (
            <div
              className="mx-[26px] mt-3 flex items-start gap-[10px] rounded-[10px] px-[14px] py-[11px]"
              style={{ border: "1px solid rgba(0,180,216,.35)", background: "rgba(0,180,216,.06)" }}
            >
              <span className="min-w-0 flex-1 text-[12px] leading-[1.55]" style={{ color: "#cbd5e1" }}>
                {escalatedNotice}
              </span>
              <button
                type="button"
                onClick={() => setEscalatedNotice(null)}
                className="flex-none text-[11px]"
                style={{ color: "#64748b" }}
                aria-label="Dismiss"
              >
                <X className="size-3.5" />
              </button>
            </div>
          )}

          <div
            ref={containerRef}
            className="flex h-[560px] flex-col gap-[14px] overflow-y-auto px-[26px] py-[18px]"
          >
            {fatalError ? (
              <p className="py-8 text-center text-sm" style={{ color: "#94a3b8" }}>
                {fatalError}
              </p>
            ) : (
              <>
                {messages.length === 0 && (
                  <div className="flex max-w-[640px] flex-col gap-[9px] pb-1 pt-1.5">
                    <span className="text-[14px] font-semibold" style={{ color: "#f8fafc" }}>
                      Ask about anything in your tenant
                    </span>
                    <span className="text-[12.5px] leading-[1.65]" style={{ color: "#94a3b8" }}>
                      Invoices, your plan, your Copilot readiness score. Answers are read from your own account at
                      the moment you ask — nothing is recalled from a previous session, because this conversation is
                      not stored anywhere. Closing this page ends it.
                    </span>
                  </div>
                )}

                {messages.map((msg, i) => (
                  <div key={i}>
                    <ChatBubble message={msg} latest={i === latestAssistantIndex} />
                    {i === messages.length - 1 && msg.role === "assistant" && (
                      <SuggestedReplies
                        options={suggestedRepliesFrom(msg.content)}
                        disabled={isLoading}
                        onPick={(text) => void sendMessage(text)}
                      />
                    )}
                  </div>
                ))}

                {isLoading && <TypingIndicator />}

                {messages.length === 0 && !isLoading && (
                  <div className="flex max-w-[640px] flex-wrap gap-[7px] pt-0.5">
                    {STARTERS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => void sendMessage(s)}
                        className="rounded-full text-[11.5px] transition-colors"
                        style={{ color: "#cbd5e1", border: "1px solid rgba(255,255,255,.13)", padding: "6px 12px" }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = "rgba(255,255,255,.05)";
                          e.currentTarget.style.borderColor = "rgba(0,120,212,.45)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "transparent";
                          e.currentTarget.style.borderColor = "rgba(255,255,255,.13)";
                        }}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="flex flex-none flex-col gap-2 border-t px-[26px] py-[14px]" style={{ borderColor: HAIRLINE }}>
            <div className="flex items-end gap-[9px]">
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isLoading || Boolean(fatalError)}
                placeholder="Ask about your invoices, your plan or your score"
                className="max-h-32 min-h-9 min-w-0 flex-1 resize-none rounded-lg px-[13px] py-[11px] text-[13px] outline-none disabled:opacity-60"
                style={{ background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.12)", color: "#f8fafc" }}
                data-testid="support-chat-input"
              />
              <button
                type="button"
                onClick={() => void sendMessage()}
                disabled={!canSend}
                data-testid="support-chat-send"
                className="flex flex-none items-center gap-2 rounded-lg px-[17px] py-[11px] text-[12.5px] font-semibold disabled:cursor-default"
                style={{
                  background: canSend ? ACCENT : "rgba(255,255,255,.06)",
                  color: canSend ? "#fff" : "#475569",
                }}
              >
                <Send className="size-4" />
                Send
              </button>
            </div>
            <span className="text-[10.5px] leading-[1.5]" style={{ color: "#475569" }}>
              This conversation is not saved. It exists for as long as this page is open, and reloading starts an
              empty one.
            </span>
          </div>
        </div>

        <div
          className="hidden w-[288px] flex-none flex-col gap-3 self-start overflow-y-auto rounded-2xl border px-5 py-[18px] xl:flex"
          style={{ borderColor: HAIRLINE, background: CARD_BG, maxHeight: 700 }}
          data-testid="support-chat-ledger"
        >
          <span className="text-[12.5px] font-semibold" style={{ color: "#f8fafc" }}>
            What ShaneBot will not do
          </span>
          <span className="text-[11.5px] leading-[1.6]" style={{ color: "#94a3b8" }}>
            It proposes, it never acts. Nothing it shows you is generated — every card is your own data, read at the
            moment you asked.
          </span>
          <div className="flex flex-col">
            {LEDGER.map((l) => (
              <div key={l.where + l.gap} className="flex flex-col gap-[3px] border-t py-[9px]" style={{ borderColor: "rgba(255,255,255,.05)" }}>
                <span className="text-[11.5px] leading-[1.5]" style={{ color: "#cbd5e1" }}>
                  {l.gap}
                </span>
                <span className="text-[10px]" style={{ color: "#475569", fontFamily: "ui-monospace, Menlo, monospace" }}>
                  {l.where}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
