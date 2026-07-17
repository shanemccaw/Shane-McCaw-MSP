import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";

export interface SupportChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  escalated?: boolean;
  timestamp: Date;
}

interface SupportChatContextValue {
  supportOpen: boolean;
  setSupportOpen: React.Dispatch<React.SetStateAction<boolean>>;
  messages: SupportChatMessage[];
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  sending: boolean;
  escalating: boolean;
  everEscalated: boolean;
  sendMessage: (text: string) => Promise<void>;
  handleExplicitEscalate: () => Promise<void>;
}

const SupportChatContext = createContext<SupportChatContextValue | null>(null);

export function SupportChatProvider({ children }: { children: ReactNode }) {
  const { user, fetchWithAuth } = useAuth();
  const [supportOpen, setSupportOpen] = useState(false);
  const [messages, setMessages] = useState<SupportChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [escalating, setEscalating] = useState(false);
  const [everEscalated, setEverEscalated] = useState(false);

  // Initial greeting when opened for the first time
  useEffect(() => {
    if (supportOpen && messages.length === 0) {
      setMessages([
        {
          id: "init",
          role: "assistant",
          content: `Hi${user?.name ? ` ${user.name.split(" ")[0]}` : ""}! I'm your AI support assistant. I can answer questions about your account status, signals, services, and monitoring.\n\nHow can I help you today?`,
          timestamp: new Date(),
        },
      ]);
    }
  }, [supportOpen, user?.name, messages.length]);

  const apiMessages = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || sending) return;

      const userMsg: SupportChatMessage = {
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
        const assistantMsg: SupportChatMessage = {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: data.reply,
          escalated: data.escalated,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
        if (data.escalated) setEverEscalated(true);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to send message");
        setMessages((prev) => prev.filter((m) => m.id !== userMsg.id));
      } finally {
        setSending(false);
      }
    },
    [sending, fetchWithAuth, apiMessages]
  );

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

      const systemMsg: SupportChatMessage = {
        id: `sys-${Date.now()}`,
        role: "system",
        content: "Your request has been escalated to human support. We will follow up shortly.",
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

  return (
    <SupportChatContext.Provider
      value={{
        supportOpen,
        setSupportOpen,
        messages,
        input,
        setInput,
        sending,
        escalating,
        everEscalated,
        sendMessage,
        handleExplicitEscalate,
      }}
    >
      {children}
    </SupportChatContext.Provider>
  );
}

export function useSupportChat() {
  const ctx = useContext(SupportChatContext);
  if (!ctx) {
    throw new Error("useSupportChat must be used within SupportChatProvider");
  }
  return ctx;
}
