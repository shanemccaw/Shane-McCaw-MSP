/**
 * Support Chat — AI-first support for MSP and customer users.
 *
 * Grounded answers from real platform data (signals, status, fulfillment).
 * Falls through to human when AI can't answer — notification goes to Shane's
 * Admin Panel inbox via SSE, and a reply thread is created for CustomerUser.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Bot,
  Send,
  User,
  Loader2,
  AlertCircle,
  ArrowRight,
  MessageCircle,
  CheckCircle2,
  Lock,
} from "lucide-react";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────────

type MessageRole = "user" | "assistant" | "system";

interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  escalated?: boolean;
  timestamp: Date;
}

// ── Starter prompts ───────────────────────────────────────────────────────────

const STARTER_PROMPTS = [
  "What is my current plan status?",
  "What signals have fired recently?",
  "What's the status of my active services?",
  "When is the next monitoring run?",
];

// ── Message bubble ────────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  if (isSystem) {
    return (
      <div className="flex justify-center my-2">
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 border border-amber-500/20 rounded-full text-xs text-amber-400">
          <AlertCircle className="size-3" />
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      {/* Avatar */}
      <div
        className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${
          isUser ? "bg-primary/20" : "bg-muted"
        }`}
      >
        {isUser ? (
          <User className="size-3.5 text-primary" />
        ) : (
          <Bot className="size-3.5 text-muted-foreground" />
        )}
      </div>

      {/* Bubble */}
      <div className={`flex flex-col gap-1 max-w-[78%] ${isUser ? "items-end" : "items-start"}`}>
        <div
          className={`px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
            isUser
              ? "bg-primary text-primary-foreground rounded-tr-sm"
              : "bg-muted text-foreground rounded-tl-sm"
          }`}
        >
          {message.content}
          {message.escalated && (
            <div className="mt-2 pt-2 border-t border-amber-500/30 flex items-center gap-1.5 text-xs text-amber-400">
              <AlertCircle className="size-3" />
              Escalated to a human — Shane will follow up
            </div>
          )}
        </div>
        <span className="text-[10px] text-muted-foreground/50 px-1">
          {message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SupportChatPage() {
  const { user, fetchWithAuth } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [escalating, setEscalating] = useState(false);
  const [everEscalated, setEverEscalated] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Initial greeting
  useEffect(() => {
    const greeting: ChatMessage = {
      id: "init",
      role: "assistant",
      content: `Hi${user?.name ? ` ${user.name.split(" ")[0]}` : ""}! I'm your AI support assistant, grounded in your real platform data. I can answer questions about your account status, signals, services, and monitoring — but I can't take actions on your behalf.\n\nWhat can I help you with?`,
      timestamp: new Date(),
    };
    setMessages([greeting]);
  }, [user?.name]);

  // Auto-scroll to latest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Build API messages array (strip system messages)
  const apiMessages = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || sending) return;

      const userMsg: ChatMessage = {
        id: `u-${Date.now()}`,
        role: "user",
        content: trimmed,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setSending(true);

      try {
        const res = await fetchWithAuth("/api/msp/support/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [...apiMessages, { role: "user", content: trimmed }],
          }),
        });

        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }

        const data = (await res.json()) as { reply: string; escalated: boolean };

        const assistantMsg: ChatMessage = {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: data.reply,
          escalated: data.escalated,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, assistantMsg]);

        if (data.escalated) {
          setEverEscalated(true);
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to send message");
        // Remove the optimistic user message on error
        setMessages((prev) => prev.filter((m) => m.id !== userMsg.id));
      } finally {
        setSending(false);
        textareaRef.current?.focus();
      }
    },
    [sending, fetchWithAuth, apiMessages],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(input);
    }
  };

  const handleExplicitEscalate = async () => {
    if (escalating) return;
    setEscalating(true);
    try {
      const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
      await fetchWithAuth("/api/msp/support/escalate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: lastUserMsg?.content ?? "(no question)" }),
      });

      const systemMsg: ChatMessage = {
        id: `sys-${Date.now()}`,
        role: "system",
        content: "Your question has been escalated to Shane. You'll hear back shortly.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, systemMsg]);
      setEverEscalated(true);
    } catch {
      toast.error("Failed to escalate. Please try again.");
    } finally {
      setEscalating(false);
    }
  };

  const isEmpty = messages.filter((m) => m.role === "user").length === 0;

  // Support chat is tenant-scoped; PlatformAdmin has no MSP context to ground
  // answers in (the backend rejects chat/escalate with 403). Show a clear
  // notice instead of the chat UI — matches the settings-page convention.
  // Placed after all hooks so hook order stays stable across renders.
  const isPlatformAdmin = user?.role === "admin" || user?.mspRole === "PlatformAdmin";
  if (isPlatformAdmin) {
    return (
      <AppShell>
        <div className="max-w-md mx-auto mt-16 rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
          <Lock className="h-10 w-10 mx-auto text-destructive mb-3" />
          <h3 className="text-lg font-semibold text-foreground mb-1">Support chat isn't available for PlatformAdmin</h3>
          <p className="text-sm text-muted-foreground">
            Support chat is scoped to a specific MSP's data. Select or impersonate an MSP to use it.
          </p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="flex flex-col h-full max-h-[calc(100vh-4rem)] max-w-2xl mx-auto w-full px-4">
        {/* Header */}
        <div className="py-5 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/15 flex items-center justify-center">
              <MessageCircle className="size-4.5 text-primary" />
            </div>
            <div>
              <h1 className="text-base font-semibold">Support</h1>
              <p className="text-xs text-muted-foreground">
                AI-assisted • grounded in your platform data
              </p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Badge variant="secondary" className="text-[10px] gap-1">
                <Bot className="size-2.5" />
                AI-first
              </Badge>
            </div>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto space-y-4 pb-4 min-h-0">
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}

          {sending && (
            <div className="flex gap-3">
              <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                <Bot className="size-3.5 text-muted-foreground" />
              </div>
              <div className="bg-muted rounded-2xl rounded-tl-sm px-3.5 py-2.5 flex items-center gap-2">
                <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Thinking…</span>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Starter prompts — shown when no messages sent yet */}
        {isEmpty && !sending && (
          <div className="flex-shrink-0 pb-3">
            <p className="text-xs text-muted-foreground mb-2">Try asking:</p>
            <div className="flex flex-wrap gap-2">
              {STARTER_PROMPTS.map((p) => (
                <button
                  key={p}
                  onClick={() => void sendMessage(p)}
                  className="text-xs px-3 py-1.5 rounded-full border border-border hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Escalation CTA — shown after AI escalated or user wants human */}
        {everEscalated && (
          <div className="flex-shrink-0 mb-2 flex items-center gap-2 px-3.5 py-2.5 bg-green-500/10 border border-green-500/20 rounded-xl text-xs text-green-400">
            <CheckCircle2 className="size-3.5 flex-shrink-0" />
            Shane has been notified and will follow up with you directly.
          </div>
        )}

        {/* Input area */}
        <div className="flex-shrink-0 pb-4">
          <div className="relative flex gap-2 items-end border border-border rounded-xl bg-muted/30 focus-within:border-primary/40 transition-colors p-2">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask a question… (Shift+Enter for new line)"
              rows={1}
              className="flex-1 resize-none border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 text-sm min-h-[36px] max-h-[160px] py-1.5 px-1 placeholder:text-muted-foreground/50"
              disabled={sending}
            />
            <div className="flex flex-col gap-1.5 flex-shrink-0">
              <Button
                size="sm"
                onClick={() => void sendMessage(input)}
                disabled={!input.trim() || sending}
                className="h-8 px-3"
              >
                {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
              </Button>
            </div>
          </div>

          {/* Escalate to human link */}
          {!everEscalated && messages.some((m) => m.role === "user") && (
            <div className="mt-2 flex justify-end">
              <button
                onClick={() => void handleExplicitEscalate()}
                disabled={escalating}
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
              >
                {escalating ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <ArrowRight className="size-3" />
                )}
                Talk to a human instead
              </button>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
