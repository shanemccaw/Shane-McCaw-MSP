import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Bot, LifeBuoy, Loader2, Send } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  buildContent,
  contentToText,
  suggestedRepliesFrom,
  type ChatMessageContent,
} from "@/lib/chat-content-blocks";
import { ChatBubble, type ChatMessage } from "@/components/support-chat/ChatBubble";
import { SuggestedReplies } from "@/components/support-chat/SuggestedReplies";
import { TypingIndicator } from "@/components/support-chat/TypingIndicator";

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
 * #1622). Wired to the real `POST /api/msp/support/chat` (single-turn grounded
 * answer, this route is stateless — the client holds and re-sends the
 * transcript each turn, contract pack §6) and `POST /api/msp/support/escalate`
 * (explicit human handoff). Renders the real #361 structured content blocks,
 * including an Active Card (#366) when the model requests one and real data
 * backs it — a reply with no card is the normal case, not an empty state
 * (contract pack §8), so the layout must hold together either way.
 */
export default function SupportPage() {
  const { fetchWithAuth, user } = useAuth();
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

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  };

  const latestAssistantIndex = [...messages].map((m) => m.role).lastIndexOf("assistant");

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 py-4">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-foreground">Support</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ask ShaneBot about your billing, subscriptions, scores, or monitoring — grounded in
          your account's real data.
        </p>
      </div>

      <Card className="flex flex-col overflow-hidden">
        <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Bot className="size-4" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">ShaneBot</p>
              <p className="text-xs text-muted-foreground">AI support assistant</p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void escalate()}
            disabled={isEscalating}
            data-testid="support-chat-escalate"
          >
            {isEscalating ? <Loader2 className="size-4 animate-spin" /> : <LifeBuoy className="size-4" />}
            Talk to a human
          </Button>
        </CardHeader>

        <CardContent className="p-0">
          <div ref={containerRef} className="max-h-[520px] min-h-[320px] overflow-y-auto px-4 py-4">
            {fatalError ? (
              <p className="py-8 text-center text-sm text-muted-foreground">{fatalError}</p>
            ) : messages.length === 0 && !isLoading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {user?.name ? `Hi ${user.name.split(" ")[0]}, ` : "Hi — "}
                what can I help you with?
              </p>
            ) : (
              messages.map((msg, i) => (
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
              ))
            )}
            {isLoading && <TypingIndicator />}
          </div>

          {escalatedNotice && (
            <p className="border-t border-border bg-secondary/50 px-4 py-2 text-xs text-secondary-foreground">
              {escalatedNotice}
            </p>
          )}

          <div className="border-t border-border p-3">
            <div className="flex items-end gap-2">
              <Textarea
                ref={inputRef}
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isLoading || Boolean(fatalError)}
                placeholder="Type your message…"
                className="max-h-32 min-h-9 resize-none"
                data-testid="support-chat-input"
              />
              <Button
                type="button"
                size="icon"
                onClick={() => void sendMessage()}
                disabled={!input.trim() || isLoading || Boolean(fatalError)}
                data-testid="support-chat-send"
              >
                <Send className="size-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
