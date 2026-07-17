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

export interface SavedChat {
  id: string;
  title: string;
  messages: SupportChatMessage[];
  everEscalated: boolean;
  timestamp: number;
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
  activeChatId: string | null;
  savedChats: SavedChat[];
  sendMessage: (text: string) => Promise<void>;
  handleExplicitEscalate: () => Promise<void>;
  loadChat: (chatId: string) => void;
  startNewChat: () => void;
  deleteChat: (chatId: string) => void;
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
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [savedChats, setSavedChats] = useState<SavedChat[]>([]);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem("msp_support_chats");
      if (stored) {
        const parsed = JSON.parse(stored) as any[];
        const loaded: SavedChat[] = parsed.map(c => ({
          ...c,
          messages: c.messages.map((m: any) => ({
            ...m,
            timestamp: new Date(m.timestamp)
          }))
        }));
        setSavedChats(loaded);
      }
    } catch (e) {
      console.error("Failed to load saved chats", e);
    }
  }, []);

  // Initial greeting when opened for the first time with no active session
  useEffect(() => {
    if (supportOpen && messages.length === 0 && !activeChatId) {
      setMessages([
        {
          id: "init",
          role: "assistant",
          content: `Hi${user?.name ? ` ${user.name.split(" ")[0]}` : ""}! I'm your AI support assistant. I can answer questions about your account status, signals, services, and monitoring.\n\nHow can I help you today?`,
          timestamp: new Date(),
        },
      ]);
    }
  }, [supportOpen, user?.name, messages.length, activeChatId]);

  // Sync active chat state to localStorage savedChats list
  useEffect(() => {
    const hasUser = messages.some(m => m.role === "user");
    if (!hasUser) return;

    setSavedChats(prev => {
      let nextId = activeChatId;
      let isNew = false;
      if (!nextId) {
        nextId = `chat-${Date.now()}`;
        isNew = true;
      }

      const firstUserMsg = messages.find(m => m.role === "user")?.content || "Support Query";
      const updatedChat: SavedChat = {
        id: nextId,
        title: firstUserMsg.substring(0, 60),
        messages,
        everEscalated,
        timestamp: Date.now(),
      };

      let updatedList: SavedChat[];
      if (isNew) {
        updatedList = [updatedChat, ...prev];
        setTimeout(() => setActiveChatId(nextId), 0);
      } else {
        updatedList = prev.map(c => c.id === nextId ? updatedChat : c);
      }

      localStorage.setItem("msp_support_chats", JSON.stringify(updatedList));
      return updatedList;
    });
  }, [messages, everEscalated, activeChatId]);

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

  const loadChat = useCallback((chatId: string) => {
    const chat = savedChats.find(c => c.id === chatId);
    if (chat) {
      setActiveChatId(chat.id);
      setEverEscalated(chat.everEscalated);
      setMessages(chat.messages);
    }
  }, [savedChats]);

  const startNewChat = useCallback(() => {
    setActiveChatId(null);
    setEverEscalated(false);
    setMessages([
      {
        id: "init",
        role: "assistant",
        content: `Hi${user?.name ? ` ${user.name.split(" ")[0]}` : ""}! I'm your AI support assistant. I can answer questions about your account status, signals, services, and monitoring.\n\nHow can I help you today?`,
        timestamp: new Date(),
      },
    ]);
  }, [user?.name]);

  const deleteChat = useCallback((chatId: string) => {
    setSavedChats(prev => {
      const next = prev.filter(c => c.id !== chatId);
      localStorage.setItem("msp_support_chats", JSON.stringify(next));
      return next;
    });
    if (activeChatId === chatId) {
      startNewChat();
    }
  }, [activeChatId, startNewChat]);

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
        activeChatId,
        savedChats,
        sendMessage,
        handleExplicitEscalate,
        loadChat,
        startNewChat,
        deleteChat,
      }}
    >
      {children}
    </SupportChatContext.Provider>
  );
}

const defaultContextValue: SupportChatContextValue = {
  supportOpen: false,
  setSupportOpen: () => {},
  messages: [],
  input: "",
  setInput: () => {},
  sending: false,
  escalating: false,
  everEscalated: false,
  activeChatId: null,
  savedChats: [],
  sendMessage: async () => {},
  handleExplicitEscalate: async () => {},
  loadChat: () => {},
  startNewChat: () => {},
  deleteChat: () => {},
};

export function useSupportChat() {
  const ctx = useContext(SupportChatContext);
  return ctx ?? defaultContextValue;
}
