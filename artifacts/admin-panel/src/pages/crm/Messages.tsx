import { useEffect, useState, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";

interface ClientSummary {
  id: number;
  email: string;
  name: string | null;
  company: string | null;
  unread: number;
  lastMessage: string | null;
}

interface Message {
  id: number;
  senderUserId: number;
  body: string;
  readByAdmin: boolean;
  createdAt: string;
}

export default function MessagesPage() {
  const { fetchWithAuth, user } = useAuth();
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [selectedClient, setSelectedClient] = useState<ClientSummary | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingClients, setLoadingClients] = useState(true);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadClients = async () => {
    const res = await fetchWithAuth("/api/admin/messages/clients");
    if (res.ok) setClients(await res.json() as ClientSummary[]);
    setLoadingClients(false);
  };

  const loadMessages = async (clientId: number) => {
    setLoadingMsgs(true);
    const res = await fetchWithAuth(`/api/portal/messages?clientId=${clientId}`);
    if (res.ok) {
      setMessages(await res.json() as Message[]);
      await loadClients();
    }
    setLoadingMsgs(false);
  };

  useEffect(() => { void loadClients(); }, []);

  useEffect(() => {
    if (!selectedClient) return;
    void loadMessages(selectedClient.id);
    const interval = setInterval(() => void loadMessages(selectedClient.id), 8000);
    return () => clearInterval(interval);
  }, [selectedClient?.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSelectClient = (c: ClientSummary) => {
    setSelectedClient(c);
    setMessages([]);
    setBody("");
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim() || !selectedClient || sending) return;
    setSending(true);
    try {
      const res = await fetchWithAuth("/api/portal/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: body.trim(), clientId: selectedClient.id }),
      });
      if (res.ok) {
        setBody("");
        await loadMessages(selectedClient.id);
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="p-6 max-w-[1400px]">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[#0A2540]">Messages</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Communicate with clients directly.</p>
      </div>

      <div className="flex flex-col md:flex-row gap-4 md:h-[600px]">
        <div className={`md:w-64 flex-shrink-0 bg-white border border-border rounded-xl overflow-hidden flex flex-col ${selectedClient ? "hidden md:flex" : "flex"} max-h-52 md:max-h-none`}>
          <div className="px-4 py-3 border-b border-border">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Clients</p>
          </div>
          {loadingClients ? (
            <div className="flex items-center justify-center py-8"><div className="w-5 h-5 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin" /></div>
          ) : clients.length === 0 ? (
            <p className="text-xs text-muted-foreground p-4">No client accounts yet.</p>
          ) : (
            <div className="flex-1 overflow-y-auto divide-y divide-border">
              {clients.map(c => (
                <button key={c.id} onClick={() => handleSelectClient(c)}
                  className={`w-full text-left px-4 py-3 hover:bg-[#F7F9FC] transition-colors ${selectedClient?.id === c.id ? "bg-[#0078D4]/5 border-l-2 border-[#0078D4]" : ""}`}>
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-[#0A2540] truncate">{c.name ?? c.email}</p>
                    {c.unread > 0 && (
                      <span className="w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                        {c.unread > 9 ? "9+" : c.unread}
                      </span>
                    )}
                  </div>
                  {c.company && <p className="text-xs text-muted-foreground truncate">{c.company}</p>}
                  {c.lastMessage && <p className="text-xs text-muted-foreground truncate mt-0.5">{new Date(c.lastMessage).toLocaleDateString()}</p>}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className={`flex-1 bg-white border border-border rounded-xl overflow-hidden flex flex-col min-w-0 min-h-[400px] md:min-h-0 ${selectedClient ? "flex" : "hidden md:flex"}`}>
          {selectedClient && (
            <button onClick={() => setSelectedClient(null)}
              className="md:hidden flex items-center gap-1.5 px-4 py-2.5 border-b border-border text-xs font-semibold text-muted-foreground hover:bg-[#F7F9FC] transition-colors text-left">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
              Back to clients
            </button>
          )}
          {!selectedClient ? (
            <div className="flex-1 flex items-center justify-center text-center">
              <div>
                <svg className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                <p className="text-sm text-muted-foreground">Select a client to view messages</p>
              </div>
            </div>
          ) : (
            <>
              <div className="px-5 py-3 border-b border-border flex-shrink-0">
                <p className="text-sm font-bold text-[#0A2540]">{selectedClient.name ?? selectedClient.email}</p>
                <p className="text-xs text-muted-foreground">{selectedClient.email}</p>
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
                {loadingMsgs ? (
                  <div className="flex items-center justify-center py-8"><div className="w-6 h-6 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" /></div>
                ) : messages.length === 0 ? (
                  <div className="text-center py-8 text-sm text-muted-foreground">No messages yet. Send the first message.</div>
                ) : messages.map(msg => {
                  const fromAdmin = msg.senderUserId === user?.id;
                  return (
                    <div key={msg.id} className={`flex ${fromAdmin ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${fromAdmin ? "bg-[#0078D4] text-white rounded-br-md" : "bg-[#F7F9FC] border border-border text-[#0A2540] rounded-bl-md"}`}>
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.body}</p>
                        <p className={`text-xs mt-1 ${fromAdmin ? "text-white/60" : "text-muted-foreground"}`}>
                          {new Date(msg.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                        </p>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>
              <div className="px-5 py-3 border-t border-border flex-shrink-0">
                <form onSubmit={handleSend} className="flex gap-2">
                  <input value={body} onChange={e => setBody(e.target.value)}
                    placeholder="Type a message…"
                    className="flex-1 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]" />
                  <button type="submit" disabled={!body.trim() || sending}
                    className="bg-[#0078D4] text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[#0078D4]/90 disabled:opacity-50 transition-colors flex items-center gap-1.5">
                    {sending ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : "Send"}
                  </button>
                </form>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
