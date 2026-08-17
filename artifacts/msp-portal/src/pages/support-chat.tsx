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
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import {
  buildContent,
  contentToText,
  suggestedRepliesFrom,
  cardsFrom,
  type ChatMessageContent,
} from "@/lib/chat-content-blocks";
import { cardScrollTop } from "@/components/war-room/warRoomCardScroll";

// ── Types ─────────────────────────────────────────────────────────────────────

type MessageRole = "user" | "assistant" | "system";

interface ProposedRemediation {
  offerId: number;
  offerTitle: string;
  packKey: string;
}

type RemediationState = "pending" | "running" | "triggered" | "declined";

interface ChatMessage {
  id: string;
  role: MessageRole;
  /**
   * Structured content blocks (#361) — text, plus suggested_replies when the
   * assistant offered chips. Typed to allow a bare string so a transcript
   * restored from before #361 still renders (see contentToText).
   */
  content: ChatMessageContent;
  escalated?: boolean;
  timestamp: Date;
  /** Set on an assistant message when the AI offered an instant remediation. */
  proposedRemediation?: ProposedRemediation;
  /** Confirmation lifecycle for that proposal (button state on the card). */
  remediationState?: RemediationState;
}

// ── Starter prompts ───────────────────────────────────────────────────────────

const STARTER_PROMPTS = [
  "What is my current plan status?",
  "What signals have fired recently?",
  "What's the status of my active services?",
  "When is the next monitoring run?",
];

// ── Message bubble ────────────────────────────────────────────────────────────

function MessageBubble({ message, testId }: { message: ChatMessage; testId?: string }) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  const text = contentToText(message.content);

  if (isSystem) {
    return (
      <div className="flex justify-center my-2">
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 border border-amber-500/20 rounded-full text-xs text-amber-400">
          <AlertCircle className="size-3" />
          {text}
        </div>
      </div>
    );
  }

  return (
    <div data-testid={testId} className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
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
          {text}
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

// ── Suggested-reply chips ─────────────────────────────────────────────────────

/**
 * Tappable follow-ups the assistant offered on its last turn (#361). The options
 * arrive as a `suggested_replies` content block; tapping one sends that exact
 * text as the next user message, so a chip is a shortcut for typing — nothing
 * more. Only ever rendered for the newest assistant message.
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
    <div className="ml-10 flex flex-wrap gap-2" data-testid="suggested-replies">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          disabled={disabled}
          onClick={() => onPick(option)}
          className="text-xs px-3 py-1.5 rounded-full border border-primary/30 bg-primary/5 text-foreground hover:bg-primary/10 hover:border-primary/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {option}
        </button>
      ))}
    </div>
  );
}

// ── Remediation confirmation card ─────────────────────────────────────────────

function RemediationCard({
  proposal,
  state,
  onConfirm,
  onDecline,
}: {
  proposal: ProposedRemediation;
  state: RemediationState;
  onConfirm: () => void;
  onDecline: () => void;
}) {
  if (state === "declined") return null;

  if (state === "triggered") {
    return (
      <div className="ml-10 max-w-[78%] flex items-start gap-2 px-3.5 py-2.5 bg-green-500/10 border border-green-500/20 rounded-xl text-xs text-green-400">
        <CheckCircle2 className="size-3.5 flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-medium">Remediation started</p>
          <p className="text-green-400/80">
            The configuration pack for “{proposal.offerTitle}” is being applied to your tenant.
          </p>
        </div>
      </div>
    );
  }

  const running = state === "running";
  return (
    <div className="ml-10 max-w-[78%] flex flex-col gap-2.5 px-3.5 py-3 bg-primary/5 border border-primary/25 rounded-xl">
      <div className="flex items-start gap-2">
        <Zap className="size-4 flex-shrink-0 mt-0.5 text-primary" />
        <div className="text-xs">
          <p className="font-medium text-foreground">Confirm instant remediation</p>
          <p className="text-muted-foreground">
            This will apply the “{proposal.offerTitle}” configuration pack to your tenant automatically. Nothing runs
            until you confirm.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" className="h-7 px-3 text-xs gap-1" disabled={running} onClick={onConfirm}>
          {running ? <Loader2 className="size-3 animate-spin" /> : <Zap className="size-3" />}
          {running ? "Starting…" : "Confirm & run"}
        </Button>
        <Button size="sm" variant="ghost" className="h-7 px-3 text-xs" disabled={running} onClick={onDecline}>
          Not now
        </Button>
      </div>
    </div>
  );
}

// ── Active Cards (#366) ───────────────────────────────────────────────────────
// Interactive data cards for the four v1 card types. `data` always came from a
// real, customer-scoped DB record resolved server-side (shanebot-engine.ts's
// card_router) — this layer only renders it, it never invents or reformats
// numbers from the model's own text.

function invoiceStatusVariant(status: string): "secondary" | "destructive" | "outline" {
  if (status === "paid") return "secondary";
  if (status === "overdue") return "destructive";
  return "outline";
}

function InvoiceCardBody({ data }: { data: Record<string, unknown> }) {
  const invoices = Array.isArray(data.invoices) ? (data.invoices as Array<Record<string, unknown>>) : [];
  if (invoices.length === 0) {
    return <p className="text-xs text-muted-foreground">No invoices on file.</p>;
  }
  return (
    <div className="divide-y divide-border/60">
      {invoices.map((inv, i) => (
        <div key={i} className="py-2 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-foreground truncate">{String(inv.invoiceNumber ?? "")}</p>
            {inv.description ? (
              <p className="text-[11px] text-muted-foreground truncate">{String(inv.description)}</p>
            ) : null}
          </div>
          <div className="flex-shrink-0 text-right">
            <p className="text-xs font-medium text-foreground">{String(inv.amount ?? "")}</p>
            <Badge variant={invoiceStatusVariant(String(inv.status ?? ""))} className="text-[10px] mt-0.5">
              {String(inv.status ?? "")}
            </Badge>
          </div>
        </div>
      ))}
    </div>
  );
}

function SubscriptionCardBody({ data }: { data: Record<string, unknown> }) {
  const subscriptions = Array.isArray(data.subscriptions) ? (data.subscriptions as Array<Record<string, unknown>>) : [];
  if (subscriptions.length === 0) {
    return <p className="text-xs text-muted-foreground">No active subscriptions or monitoring bundles.</p>;
  }
  return (
    <div className="divide-y divide-border/60">
      {subscriptions.map((sub, i) => (
        <div key={i} className="py-2 flex items-center justify-between gap-3">
          <p className="text-xs font-medium text-foreground truncate">{String(sub.name ?? "")}</p>
          <Badge variant={sub.status === "active" ? "secondary" : "outline"} className="text-[10px] flex-shrink-0">
            {String(sub.status ?? "")}
          </Badge>
        </div>
      ))}
    </div>
  );
}

const SCORE_PILLARS: Array<{ key: string; label: string }> = [
  { key: "identity", label: "Identity" },
  { key: "security", label: "Security" },
  { key: "collaboration", label: "Collaboration" },
  { key: "compliance", label: "Compliance" },
  { key: "copilotReadiness", label: "Copilot Readiness" },
];

function ScoreCardBody({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="flex flex-col gap-2">
      {SCORE_PILLARS.map(({ key, label }) => {
        const value = Math.max(0, Math.min(100, Number(data[key] ?? 0)));
        return (
          <div key={key} className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground w-28 flex-shrink-0">{label}</span>
            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full bg-primary" style={{ width: `${value}%` }} />
            </div>
            <span className="text-[11px] font-medium text-foreground w-7 text-right flex-shrink-0">{value}</span>
          </div>
        );
      })}
    </div>
  );
}

function DataAnswerCardBody({ data }: { data: Record<string, unknown> }) {
  const subscriptions = Array.isArray(data.subscriptions) ? (data.subscriptions as Array<Record<string, unknown>>) : [];
  const latestScan = data.latestScan as Record<string, unknown> | null | undefined;
  const purchases = Array.isArray(data.purchases) ? (data.purchases as Array<Record<string, unknown>>) : [];

  return (
    <div className="flex flex-col gap-3 text-xs">
      <div>
        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Subscriptions</p>
        {subscriptions.length === 0 ? (
          <p className="text-muted-foreground">None active.</p>
        ) : (
          subscriptions.map((sub, i) => (
            <div key={i} className="flex items-center justify-between py-0.5">
              <span className="text-foreground">{String(sub.name ?? "")}</span>
              <span className="text-muted-foreground">{String(sub.status ?? "")}</span>
            </div>
          ))
        )}
      </div>
      <div>
        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Latest scan</p>
        <p className="text-foreground">
          {latestScan ? `${String(latestScan.packageKey ?? "")} — ${String(latestScan.status ?? "")}` : "No scans have been run yet."}
        </p>
      </div>
      {purchases.length > 0 && (
        <div>
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Purchases</p>
          {purchases.map((p, i) => (
            <div key={i} className="flex items-center justify-between py-0.5">
              <span className="text-foreground truncate">{String(p.title ?? "")}</span>
              <span className="text-muted-foreground flex-shrink-0 ml-2">{String(p.amount ?? "")}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const CARD_TITLES: Record<string, string> = {
  invoice: "Invoices",
  subscription: "Subscription",
  score: "Copilot Readiness Score",
  "data-answer": "Your Data",
};

function ActiveCard({
  cardType,
  data,
  cardRef,
}: {
  cardType: string;
  data: Record<string, unknown>;
  cardRef?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={cardRef}
      className="ml-10 max-w-[78%] flex flex-col gap-2 px-3.5 py-3 bg-muted/40 border border-border rounded-xl"
      data-testid={`active-card-${cardType}`}
    >
      <p className="text-xs font-semibold text-foreground">{CARD_TITLES[cardType] ?? "Details"}</p>
      {cardType === "invoice" && <InvoiceCardBody data={data} />}
      {cardType === "subscription" && <SubscriptionCardBody data={data} />}
      {cardType === "score" && <ScoreCardBody data={data} />}
      {cardType === "data-answer" && <DataAnswerCardBody data={data} />}
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
  const containerRef = useRef<HTMLDivElement>(null);
  const latestCardRef = useRef<HTMLDivElement>(null);

  // Initial greeting
  useEffect(() => {
    const greeting: ChatMessage = {
      id: "init",
      role: "assistant",
      content: buildContent(
        `Hi${user?.name ? ` ${user.name.split(" ")[0]}` : ""}! I'm your AI support assistant, grounded in your real platform data. I can answer questions about your account status, signals, services, and monitoring.\n\nIf an eligible one-click remediation is available for one of your findings, I can also offer to run it — I'll always ask you to confirm first, and nothing happens until you click the button yourself.\n\nWhat can I help you with?`,
      ),
      timestamp: new Date(),
    };
    setMessages([greeting]);
  }, [user?.name]);

  // Auto-scroll to latest message. When the newest turn carries a card
  // (#366), land on it via the same scroll math War Room's briefing thread
  // uses (warRoomCardScroll.ts's cardScrollTop) — top of the card if it fits
  // the viewport, its bottom (where the interactive/later content is) if it
  // doesn't — rather than always jumping straight to the very bottom.
  useEffect(() => {
    const container = containerRef.current;
    const cardEl = latestCardRef.current;
    if (container && cardEl) {
      const containerRect = container.getBoundingClientRect();
      const cardRect = cardEl.getBoundingClientRect();
      const offsetTop = cardRect.top - containerRect.top + container.scrollTop;
      container.scrollTo({
        top: cardScrollTop(offsetTop, cardEl.offsetHeight, container.clientHeight),
        behavior: "smooth",
      });
      return;
    }
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Build API messages array (strip system messages). Content blocks go over the
  // wire as-is — the route normalizes whichever shape it receives.
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
        content: buildContent(trimmed),
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
            messages: [...apiMessages, { role: "user", content: buildContent(trimmed) }],
          }),
        });

        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }

        const data = (await res.json()) as {
          reply: string;
          content?: ChatMessageContent;
          suggestedReplies?: string[];
          escalated: boolean;
          proposedRemediation?: ProposedRemediation | null;
        };

        const assistantMsg: ChatMessage = {
          id: `a-${Date.now()}`,
          role: "assistant",
          // Prefer the structured content; fall back to the flat reply so the UI
          // still works against an api-server that predates #361.
          content: data.content ?? buildContent(data.reply, data.suggestedReplies ?? []),
          escalated: data.escalated,
          timestamp: new Date(),
          proposedRemediation: data.proposedRemediation ?? undefined,
          remediationState: data.proposedRemediation ? "pending" : undefined,
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
        body: JSON.stringify({
          question: contentToText(lastUserMsg?.content) || "(no question)",
        }),
      });

      const systemMsg: ChatMessage = {
        id: `sys-${Date.now()}`,
        role: "system",
        content: buildContent("Your question has been escalated to Shane. You'll hear back shortly."),
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

  // ── Remediation confirmation ──────────────────────────────────────────────
  // The AI only ever *proposes* a remediation (server-validated as genuinely
  // eligible). Nothing runs until the user clicks Confirm here, which calls the
  // real /portal/mission-control/remediate endpoint — the same one Mission
  // Control uses, with its testbed guard intact. A non-testbed tenant never
  // reaches this (no proposal is surfaced), and the endpoint 403s regardless.
  const setRemediationState = useCallback((messageId: string, state: RemediationState) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, remediationState: state } : m)),
    );
  }, []);

  const confirmRemediation = useCallback(
    async (message: ChatMessage) => {
      const proposal = message.proposedRemediation;
      if (!proposal || message.remediationState === "running" || message.remediationState === "triggered") return;

      setRemediationState(message.id, "running");
      try {
        const res = await fetchWithAuth("/api/portal/mission-control/remediate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ offerId: proposal.offerId }),
        });
        if (res.status === 202) {
          setRemediationState(message.id, "triggered");
          toast.success("Remediation started — the configuration pack is being applied to your tenant.");
        } else {
          // Includes the endpoint's own 403 for non-testbed accounts — surface
          // its real message rather than pretending it succeeded.
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setRemediationState(message.id, "pending");
          toast.error(body.error ?? "Failed to start remediation");
        }
      } catch {
        setRemediationState(message.id, "pending");
        toast.error("Failed to start remediation");
      }
    },
    [fetchWithAuth, setRemediationState],
  );

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
        <div ref={containerRef} className="flex-1 overflow-y-auto space-y-4 pb-4 min-h-0">
          {messages.map((msg, i) => (
            <div key={msg.id} className="space-y-2">
              <MessageBubble
                message={msg}
                testId={i === messages.length - 1 && msg.role === "assistant" ? "support-chat-latest-reply" : undefined}
              />
              {/* Data cards (#366) — rendered for every turn that carries one, not
                  just the newest, so a card stays visible as history scrolls by. */}
              {msg.role === "assistant" &&
                cardsFrom(msg.content).map((card, ci) => (
                  <ActiveCard
                    key={`${msg.id}-card-${ci}`}
                    cardType={card.cardType}
                    data={card.data}
                    cardRef={i === messages.length - 1 && ci === 0 ? latestCardRef : undefined}
                  />
                ))}
              {/* Chips only on the newest turn — older ones are answered history. */}
              {i === messages.length - 1 && msg.role === "assistant" && (
                <SuggestedReplies
                  options={suggestedRepliesFrom(msg.content)}
                  disabled={sending}
                  onPick={(text) => void sendMessage(text)}
                />
              )}
              {msg.proposedRemediation && msg.remediationState && (
                <RemediationCard
                  proposal={msg.proposedRemediation}
                  state={msg.remediationState}
                  onConfirm={() => void confirmRemediation(msg)}
                  onDecline={() => setRemediationState(msg.id, "declined")}
                />
              )}
            </div>
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
              data-testid="support-chat-input"
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
                data-testid="support-chat-send"
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
