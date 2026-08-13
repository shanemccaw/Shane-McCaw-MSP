import { useRef, useState, useEffect, type CSSProperties, type KeyboardEvent } from "react";
import { Send } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  buildContent,
  contentToText,
  suggestedRepliesFrom,
  type ChatMessageContent,
} from "@/lib/chat-content-blocks";

const GRADIENT_BG = { background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" };

const SESSION_KEY = "public-chat-session-id";

interface ChatMessage {
  role: "user" | "assistant";
  /**
   * Structured content blocks (#361) — text, plus suggested_replies when the
   * assistant offered chips. The union tolerates a bare string so a reply from
   * an api-server that predates #361 still renders.
   */
  content: ChatMessageContent;
}

interface ChatResponse {
  reply: string;
  content?: ChatMessageContent;
  suggestedReplies?: string[];
  sessionId?: string;
}

/**
 * Prefer the server's structured content; fall back to the flat `reply` so the
 * widget still works against an api-server that predates #361.
 */
function assistantContent(data: ChatResponse): ChatMessageContent {
  return data.content ?? buildContent(data.reply, data.suggestedReplies ?? []);
}

function getSessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `sess-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    return `sess-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
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
        {contentToText(message.content)}
      </div>
    </div>
  );
}

/**
 * Tappable follow-ups the assistant offered on its last turn (#361). Options
 * arrive as a `suggested_replies` content block; tapping one sends that exact
 * text as the next visitor message, so a chip is a shortcut for typing.
 */
function SuggestedReplies({
  options,
  disabled,
  onPick,
}: {
  options: string[];
  disabled: boolean;
  onPick: (text: string) => void;
}) {
  if (options.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 mb-4 ml-9" data-testid="chat-suggested-replies">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          disabled={disabled}
          onClick={() => onPick(option)}
          className="text-xs px-3 py-1.5 rounded-full border border-white/[0.14] bg-white/[0.04] text-text-primary hover:bg-white/[0.09] hover:border-accent-blue/50 transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {option}
        </button>
      ))}
    </div>
  );
}

interface PublicChatWidgetProps {
  className?: string;
  /** Applied to the widget's root card — e.g. `{ minHeight: "520px" }`. */
  style?: CSSProperties;
  /** Max height of the scrollable message list before it scrolls internally. */
  bodyMaxHeight?: string;
  /** Header subtitle. */
  subtitle?: string;
}

/**
 * The public site's AI assistant — the single "talk to a human" surface (the former
 * contact form and booking-calendar pages have been removed). Hits POST /api/public-chat, which is
 * grounded in the real services catalog, firmly declines anything about Shane
 * personally, stores every conversation, and — only on genuine purchase/service
 * intent — flags the conversation into a pull-based admin review queue.
 *
 * Distinct from the authenticated Portal support chat: assessment-tier visitors with
 * a resolved Portal are handed off to that separately (see PersistentChatBubble).
 */
export function PublicChatWidget({
  className,
  style,
  bodyMaxHeight = "440px",
  subtitle = "Ask about services, pricing, or getting started",
}: PublicChatWidgetProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [initError, setInitError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sessionIdRef = useRef<string>("");

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
      sessionIdRef.current = getSessionId();
      setIsLoading(true);
      try {
        const res = await fetch("/api/public-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: sessionIdRef.current, messages: [] }),
        });
        if (!res.ok) throw new Error("init failed");
        const data = (await res.json()) as ChatResponse;
        if (data.sessionId) sessionIdRef.current = data.sessionId;
        if (!cancelled) {
          setMessages([{ role: "assistant", content: assistantContent(data) }]);
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

  const sendMessage = async (override?: string) => {
    const text = (override ?? input).trim();
    if (!text || isLoading) return;

    const newMessages: ChatMessage[] = [...messages, { role: "user", content: buildContent(text) }];
    setMessages(newMessages);
    setInput("");
    setIsLoading(true);

    try {
      const res = await fetch("/api/public-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sessionIdRef.current, messages: newMessages }),
      });
      if (!res.ok) throw new Error("chat failed");
      const data = (await res.json()) as ChatResponse;
      if (data.sessionId) sessionIdRef.current = data.sessionId;
      setMessages([...newMessages, { role: "assistant", content: assistantContent(data) }]);
    } catch {
      setMessages([
        ...newMessages,
        {
          role: "assistant",
          content: buildContent("Sorry, something went wrong on my end. Please try again in a moment."),
        },
      ]);
    } finally {
      setIsLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
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
          <p className="text-sm font-semibold text-text-primary">Shane McCaw Consulting Assistant</p>
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
            Couldn't connect to the assistant just now. Please try again in a moment.
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i}>
            <ChatBubble message={msg} />
            {/* Chips only on the newest turn — older ones are answered history. */}
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
      </div>

      <div className="border-t border-white/[0.06] px-4 py-4">
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
            placeholder="Type your message…"
            className="flex-1 bg-white/[0.04] border border-white/[0.1] rounded-lg px-4 py-2.5 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent-blue/60 resize-none disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ maxHeight: "120px" }}
            data-testid="chat-input"
          />
          <button
            onClick={() => void sendMessage()}
            disabled={!input.trim() || isLoading}
            className="flex-shrink-0 w-10 h-10 rounded-lg text-white flex items-center justify-center transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
            style={GRADIENT_BG}
            data-testid="chat-send"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
        <p className="text-[10px] text-text-secondary mt-2 text-center">
          Press <kbd className="font-mono bg-white/[0.06] border border-white/[0.1] rounded px-1">Enter</kbd> to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
