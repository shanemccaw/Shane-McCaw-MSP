import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useInbox } from "@/contexts/InboxContext";
import InboxFolderPane from "./InboxFolderPane";
import InboxMessageList, { type InboxMessage } from "./InboxMessageList";
import InboxMessageDetail from "./InboxMessageDetail";

function InboxSearch({ onResults }: { onResults: (msgs: InboxMessage[] | null, q: string) => void }) {
  const { fetchWithAuth } = useAuth();
  const { setSearchQuery, searchQuery, setIsSearching } = useInbox();
  const [localQ, setLocalQ] = useState("");
  const [searching, setSearching] = useState(false);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = localQ.trim();
    if (!q) {
      onResults(null, "");
      setSearchQuery("");
      setIsSearching(false);
      return;
    }
    setSearching(true);
    setIsSearching(true);
    setSearchQuery(q);
    try {
      const res = await fetchWithAuth(`/api/inbox/search?q=${encodeURIComponent(q)}`);
      if (res.ok) {
        const data = await res.json() as { messages: InboxMessage[] };
        onResults(data.messages, q);
      }
    } finally {
      setSearching(false);
    }
  }

  function handleClear() {
    setLocalQ("");
    onResults(null, "");
    setSearchQuery("");
    setIsSearching(false);
  }

  return (
    <form onSubmit={handleSearch} className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card">
      <div className="flex-1 relative">
        <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          value={localQ}
          onChange={e => setLocalQ(e.target.value)}
          placeholder="Search messages…"
          className="w-full pl-8 pr-3 py-1 bg-background border border-border rounded-md text-xs text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary"
        />
      </div>
      {searching ? (
        <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin shrink-0" />
      ) : (
        <button type="submit" className="px-2.5 py-1 bg-primary text-white text-xs rounded-md hover:bg-primary/90 shrink-0">
          Search
        </button>
      )}
      {searchQuery && (
        <button type="button" onClick={handleClear} className="text-[10px] text-muted-foreground hover:text-foreground/90 shrink-0">
          Clear
        </button>
      )}
    </form>
  );
}

function InboxShell() {
  const { fetchWithAuth } = useAuth();
  const { setGraphAvailable, openCompose, searchQuery, isSearching } = useInbox();
  const [searchResults, setSearchResults] = useState<InboxMessage[] | null>(null);

  useEffect(() => {
    async function checkGraph() {
      try {
        const res = await fetchWithAuth("/api/inbox/status");
        if (res.ok) {
          const data = await res.json() as { graphAvailable: boolean };
          setGraphAvailable(data.graphAvailable);
        }
      } catch { /* silent */ }
    }
    void checkGraph();
  }, [fetchWithAuth, setGraphAvailable]);

  const handleSearchResults = useCallback((msgs: InboxMessage[] | null, _q: string) => {
    setSearchResults(msgs);
  }, []);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left pane: folder nav */}
      <InboxFolderPane onCompose={() => openCompose("new")} />

      {/* Middle pane: message list + search */}
      <div className="flex flex-col w-72 shrink-0 border-r border-border overflow-hidden">
        <InboxSearch onResults={handleSearchResults} />
        {isSearching && searchResults !== null && (
          <div className="px-3 py-1.5 bg-background border-b border-border">
            <p className="text-[10px] text-muted-foreground">
              Search results for <span className="text-foreground/90 font-medium">"{searchQuery}"</span> — {searchResults.length} found
            </p>
          </div>
        )}
        <div className="flex-1 overflow-hidden">
          <InboxMessageList searchResults={isSearching ? searchResults : undefined} />
        </div>
      </div>

      {/* Right pane: message detail */}
      <div className="flex-1 overflow-hidden min-w-0">
        <InboxMessageDetail />
      </div>
    </div>
  );
}

export default function InboxPage() {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-6 py-4 border-b border-border bg-background shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center">
            <svg className="w-4 h-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
            </svg>
          </div>
          <div>
            <h1 className="text-base font-semibold text-foreground">Inbox</h1>
            <p className="text-xs text-muted-foreground">Microsoft 365 mailbox — CRM-integrated</p>
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        <InboxShell />
      </div>
    </div>
  );
}
