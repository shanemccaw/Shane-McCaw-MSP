import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useInbox } from "@/contexts/InboxContext";

interface InboxEmailAddress {
  name: string;
  address: string;
}

interface InboxRecipient {
  emailAddress: InboxEmailAddress;
}

export interface InboxMessage {
  id: string;
  subject: string | null;
  bodyPreview: string | null;
  receivedDateTime: string;
  sentDateTime: string | null;
  isRead: boolean;
  isDraft: boolean;
  importance: "low" | "normal" | "high";
  flag: { flagStatus: "notFlagged" | "flagged" | "complete" };
  from: InboxRecipient | null;
  toRecipients: InboxRecipient[];
  hasAttachments: boolean;
  conversationId: string | null;
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function initials(name: string, email: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
  return (parts[0]?.[0] ?? email[0] ?? "?").toUpperCase();
}

const AVATAR_COLORS = [
  "bg-blue-600", "bg-purple-600", "bg-emerald-600", "bg-amber-600",
  "bg-rose-600", "bg-teal-600", "bg-indigo-600", "bg-orange-600",
];

function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = seed.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]!;
}

function MessageRow({
  msg,
  active,
  onSelect,
  isLinked,
}: {
  msg: InboxMessage;
  active: boolean;
  onSelect: () => void;
  isLinked?: boolean;
}) {
  const senderName = msg.from?.emailAddress.name || msg.from?.emailAddress.address || "Unknown";
  const senderEmail = msg.from?.emailAddress.address ?? "";
  const color = avatarColor(senderEmail);
  const ini = initials(senderName, senderEmail);
  const ts = msg.receivedDateTime || msg.sentDateTime || "";
  const flagged = msg.flag?.flagStatus === "flagged";

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left px-3 py-2.5 flex gap-2.5 transition-colors ${
        active ? "bg-primary/10 border-l-2 border-primary" : "hover:bg-accent/60 border-l-2 border-transparent"
      }`}
    >
      <div className={`w-8 h-8 rounded-full ${color} flex items-center justify-center text-white text-[10px] font-bold shrink-0 mt-0.5`}>
        {ini}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1.5">
          <span className={`text-xs truncate ${!msg.isRead ? "font-semibold text-foreground" : "text-foreground/90"}`}>
            {senderName}
          </span>
          <div className="flex items-center gap-1 shrink-0">
            {isLinked && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" title="Linked to CRM" />
            )}
            {flagged && (
              <svg className="w-3 h-3 text-amber-400" fill="currentColor" viewBox="0 0 24 24">
                <path d="M3 3h18v12l-9 6-9-6V3z" />
              </svg>
            )}
            {msg.hasAttachments && (
              <svg className="w-3 h-3 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
            )}
            <span className="text-[10px] text-muted-foreground">{ts ? timeAgo(ts) : ""}</span>
          </div>
        </div>
        <p className={`text-xs truncate mt-0.5 ${!msg.isRead ? "font-medium text-foreground/90" : "text-muted-foreground"}`}>
          {msg.subject ?? "(no subject)"}
        </p>
        <p className="text-[11px] text-muted-foreground truncate mt-0.5 leading-tight">
          {msg.bodyPreview ?? ""}
        </p>
        {!msg.isRead && (
          <div className="mt-1">
            <span className="w-1.5 h-1.5 rounded-full bg-primary inline-block" />
          </div>
        )}
      </div>
    </button>
  );
}

export default function InboxMessageList({ searchResults }: { searchResults?: InboxMessage[] | null }) {
  const { fetchWithAuth } = useAuth();
  const {
    selectedFolder, activeFilters, selectedMessageId, setSelectedMessageId,
    isSearching, graphAvailable, messageListRefreshKey,
  } = useInbox();

  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextLink, setNextLink] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // IDs of messages that are linked to CRM entities (for filter + indicator)
  const [linkedIds, setLinkedIds] = useState<Set<string>>(new Set());
  const [loadingLinkedIds, setLoadingLinkedIds] = useState(false);

  const loaderRef = useRef<HTMLDivElement>(null);

  const isCrmView = selectedFolder.startsWith("crm:");
  const crmType = isCrmView ? selectedFolder.replace("crm:", "") : null;

  // Determine which linked-id types we need for active filters
  const needsLinkedLeadIds = activeFilters.has("linkedLead");
  const needsLinkedOppIds = activeFilters.has("linkedOpportunity");

  // Fetch linked IDs when filter is active
  useEffect(() => {
    if (!needsLinkedLeadIds && !needsLinkedOppIds) {
      setLinkedIds(new Set());
      return;
    }
    setLoadingLinkedIds(true);
    const fetchIds = async () => {
      const results = await Promise.allSettled([
        needsLinkedLeadIds ? fetchWithAuth("/api/inbox/linked-ids?type=lead").then(r => r.json() as Promise<{ ids: string[] }>) : Promise.resolve({ ids: [] }),
        needsLinkedOppIds ? fetchWithAuth("/api/inbox/linked-ids?type=opportunity").then(r => r.json() as Promise<{ ids: string[] }>) : Promise.resolve({ ids: [] }),
      ]);
      const ids = new Set<string>();
      for (const r of results) {
        if (r.status === "fulfilled") {
          for (const id of r.value.ids) ids.add(id);
        }
      }
      setLinkedIds(ids);
      setLoadingLinkedIds(false);
    };
    void fetchIds();
  }, [needsLinkedLeadIds, needsLinkedOppIds, fetchWithAuth]);

  // Also fetch all linked IDs for the green dot indicator (lightweight)
  const [allLinkedIds, setAllLinkedIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!graphAvailable) return;
    fetchWithAuth("/api/inbox/linked-ids?type=any")
      .then(r => r.json() as Promise<{ ids: string[] }>)
      .then(d => setAllLinkedIds(new Set(d.ids)))
      .catch(() => {});
  }, [graphAvailable, messageListRefreshKey, fetchWithAuth]);

  const buildUrl = useCallback((skipToken?: string) => {
    if (isCrmView) return null;
    const params = new URLSearchParams();
    params.set("folder", selectedFolder);
    params.set("pageSize", "50");
    if (skipToken) params.set("skipToken", skipToken);
    if (activeFilters.has("unread")) params.set("onlyUnread", "true");
    if (activeFilters.has("flagged")) params.set("onlyFlagged", "true");
    if (activeFilters.has("hasAttachments")) params.set("onlyHasAttachments", "true");
    return `/api/inbox/messages?${params.toString()}`;
  }, [selectedFolder, activeFilters, isCrmView]);

  // Fetch CRM-view messages from backend
  const fetchCrmMessages = useCallback(async () => {
    if (!isCrmView || !graphAvailable) { setMessages([]); return; }
    setLoading(true);
    setError(null);
    try {
      const typeMap: Record<string, string> = { leads: "leads", prospects: "prospects", customers: "customers" };
      const type = typeMap[crmType ?? "leads"] ?? "leads";
      const res = await fetchWithAuth(`/api/inbox/crm-messages?type=${type}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { messages: InboxMessage[] };
      setMessages(data.messages);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load CRM messages");
    } finally {
      setLoading(false);
    }
  }, [isCrmView, crmType, graphAvailable, fetchWithAuth]);

  const fetchMessages = useCallback(async () => {
    if (isSearching || searchResults !== undefined) return;
    if (!graphAvailable) { setMessages([]); return; }
    if (isCrmView) {
      await fetchCrmMessages();
      return;
    }
    const url = buildUrl();
    if (!url) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { messages: InboxMessage[]; nextLink: string | null };
      setMessages(data.messages);
      setNextLink(data.nextLink);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load messages");
    } finally {
      setLoading(false);
    }
  }, [buildUrl, fetchWithAuth, graphAvailable, isSearching, isCrmView, searchResults, fetchCrmMessages]);

  useEffect(() => {
    void fetchMessages();
  }, [fetchMessages, messageListRefreshKey]);

  const loadMore = useCallback(async () => {
    if (!nextLink || loadingMore || !graphAvailable || isCrmView) return;
    setLoadingMore(true);
    try {
      const url = buildUrl(nextLink);
      if (!url) return;
      const res = await fetchWithAuth(url);
      if (!res.ok) return;
      const data = await res.json() as { messages: InboxMessage[]; nextLink: string | null };
      setMessages(prev => {
        const ids = new Set(prev.map(m => m.id));
        return [...prev, ...data.messages.filter(m => !ids.has(m.id))];
      });
      setNextLink(data.nextLink);
    } finally {
      setLoadingMore(false);
    }
  }, [nextLink, loadingMore, graphAvailable, buildUrl, fetchWithAuth, isCrmView]);

  useEffect(() => {
    const el = loaderRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting) void loadMore();
    }, { threshold: 0.1 });
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore]);

  const displayMessages = searchResults ?? messages;

  // Apply linkedLead / linkedOpportunity filters — only show messages whose IDs are in linkedIds
  const needsLinkedFilter = needsLinkedLeadIds || needsLinkedOppIds;
  const filtered = needsLinkedFilter && linkedIds.size > 0
    ? displayMessages.filter(m => linkedIds.has(m.id))
    : needsLinkedFilter && !loadingLinkedIds
      ? [] // filter active but no linked messages
      : displayMessages;

  if (!graphAvailable && !searchResults) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 px-6 text-center">
        <div className="w-12 h-12 rounded-xl bg-card flex items-center justify-center">
          <svg className="w-6 h-6 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-medium text-foreground/90">Microsoft Graph not configured</p>
          <p className="text-xs text-muted-foreground mt-1">Set GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, and GRAPH_MAIL_USER_ID to connect your mailbox.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-card">
      {/* CRM view header */}
      {isCrmView && (
        <div className="px-3 py-2 bg-background border-b border-border shrink-0">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase">
            {crmType === "leads" ? "Emails linked to Leads" : crmType === "prospects" ? "Emails linked to Opportunities" : "Emails linked to Customers"}
          </p>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center items-center h-32">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="p-4 text-sm text-red-400">{error}</div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center px-4">
          <div className="w-10 h-10 bg-accent rounded-xl flex items-center justify-center">
            <svg className="w-5 h-5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
            </svg>
          </div>
          <p className="text-xs text-muted-foreground">
            {searchResults !== undefined
              ? "No messages match your search."
              : isCrmView
                ? `No emails linked to ${crmType} yet. Open an email and use "Link to CRM".`
                : needsLinkedFilter
                  ? "No messages linked to CRM for this filter."
                  : "No messages in this folder."}
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto divide-y divide-border">
          {filtered.map(msg => (
            <MessageRow
              key={msg.id}
              msg={msg}
              active={msg.id === selectedMessageId}
              onSelect={() => setSelectedMessageId(msg.id)}
              isLinked={allLinkedIds.has(msg.id)}
            />
          ))}
          <div ref={loaderRef} className="h-4" />
          {loadingMore && (
            <div className="flex justify-center py-3">
              <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
