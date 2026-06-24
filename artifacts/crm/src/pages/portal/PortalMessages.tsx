import { useEffect, useState, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import PortalLayout from "@/components/PortalLayout";

interface Message {
  id: number;
  senderUserId: number;
  body: string;
  readByClient: boolean;
  createdAt: string;
}

export default function PortalMessages() {
  const { fetchWithAuth, user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [composerRows, setComposerRows] = useState(2);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const loadMessages = async () => {
    try {
      const res = await fetchWithAuth("/api/portal/messages");
      if (res.ok) {
        const data = await res.json() as Message[];
        setMessages(data);
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => {
    void loadMessages();
    const interval = setInterval(() => void loadMessages(), 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim() || sending) return;
    setSending(true);
    try {
      const res = await fetchWithAuth("/api/portal/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: body.trim() }),
      });
      if (res.ok) {
        setBody("");
        setComposerRows(2);
        await loadMessages();
      }
    } catch { /* ignore */ }
    setSending(false);
    textareaRef.current?.focus();
  };

  const isFromMe = (msg: Message) => msg.senderUserId === user?.id;

  return (
    <PortalLayout>
      {/* h-[calc(100vh-4rem)] accounts for the 64px mobile bottom nav (pb-16 on main);
          md:h-screen takes over once the sidebar replaces the bottom nav */}
      <div className="flex flex-col h-[calc(100vh-4rem)] md:h-screen">

        {/* Header */}
        <div className="px-4 sm:px-6 py-3 sm:py-5 border-b border-border bg-white flex-shrink-0">
          <div className="flex items-center gap-3">
            {/* Mobile back button — visible only on small screens */}
            <button
              onClick={() => window.history.back()}
              className="md:hidden flex items-center justify-center w-11 h-11 -ml-2 rounded-xl text-[#0A2540] hover:bg-[#0A2540]/5 active:bg-[#0A2540]/10 transition-colors flex-shrink-0"
              aria-label="Go back"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            <div className="w-10 h-10 rounded-xl bg-[#0078D4] flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-[#0A2540]">Shane McCaw</p>
              <p className="text-xs text-muted-foreground truncate">
                <span className="hidden sm:inline">Microsoft 365 Architect · </span>Usually responds same day
              </p>
            </div>
          </div>
        </div>

        {/* Messages — flex-1 + min-h-0 lets this shrink and scroll inside the fixed-height outer container */}
        <div className="flex-1 overflow-y-auto min-h-0 px-4 sm:px-6 py-4 sm:py-6 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-6 h-6 border-3 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-16 h-16 rounded-full bg-[#0078D4]/10 flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <h3 className="text-[#0A2540] font-bold mb-1">Start a conversation</h3>
              <p className="text-muted-foreground text-sm">Send Shane a message about your project.</p>
            </div>
          ) : messages.map(msg => {
            const fromMe = isFromMe(msg);
            return (
              <div key={msg.id} className={`flex ${fromMe ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-3 ${
                  fromMe
                    ? "bg-[#0078D4] text-white rounded-br-md"
                    : "bg-white border border-border text-[#0A2540] rounded-bl-md shadow-sm"
                }`}>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.body}</p>
                  <p className={`text-xs mt-1.5 ${fromMe ? "text-white/60" : "text-muted-foreground"}`}>
                    {new Date(msg.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} · {new Date(msg.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </p>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        {/* Composer */}
        <div className="px-4 sm:px-6 py-3 sm:py-4 border-t border-border bg-white flex-shrink-0">
          <form onSubmit={handleSend} className="flex items-end gap-2 sm:gap-3">
            <textarea
              ref={textareaRef}
              value={body}
              onChange={e => setBody(e.target.value)}
              onFocus={() => setComposerRows(3)}
              onBlur={() => { if (!body.trim()) setComposerRows(2); }}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend(e as unknown as React.FormEvent);
                }
              }}
              placeholder="Type a message…"
              rows={composerRows}
              className="flex-1 border border-border rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#0078D4] transition-all"
            />
            <button
              type="submit"
              disabled={!body.trim() || sending}
              className="w-11 h-11 min-w-[44px] min-h-[44px] rounded-xl bg-[#0078D4] text-white flex items-center justify-center hover:bg-[#0078D4]/90 active:scale-95 transition-all disabled:opacity-40 flex-shrink-0"
              aria-label="Send message"
            >
              {sending ? (
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              )}
            </button>
          </form>
          <p className="mt-2 text-xs text-muted-foreground hidden sm:block">Enter to send · Shift+Enter for a new line</p>
        </div>

      </div>
    </PortalLayout>
  );
}
