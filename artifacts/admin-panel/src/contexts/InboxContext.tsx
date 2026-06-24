import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";

export type InboxFolder =
  | "inbox" | "sent" | "drafts" | "archive" | "deleted"
  | "crm:leads" | "crm:prospects" | "crm:customers";

export type InboxFilter = "unread" | "flagged" | "hasAttachments" | "linkedLead" | "linkedOpportunity";

export type ComposeMode = "new" | "reply" | "replyAll" | "forward" | null;

export interface ComposeDraft {
  mode: ComposeMode;
  replyToMessageId?: string;
  forwardMessageId?: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
}

export interface InboxCRMLink {
  leadId?: number | null;
  opportunityId?: number | null;
  customerId?: number | null;
  taskId?: number | null;
}

interface InboxContextValue {
  selectedFolder: InboxFolder;
  activeFilters: Set<InboxFilter>;
  selectedMessageId: string | null;
  searchQuery: string;
  isSearching: boolean;
  aiPanelOpen: boolean;
  composeMode: ComposeMode;
  composeDraft: ComposeDraft | null;
  graphAvailable: boolean;

  setSelectedFolder: (folder: InboxFolder) => void;
  toggleFilter: (filter: InboxFilter) => void;
  clearFilters: () => void;
  setSelectedMessageId: (id: string | null) => void;
  setSearchQuery: (q: string) => void;
  setIsSearching: (v: boolean) => void;
  toggleAIPanel: () => void;
  openCompose: (mode: ComposeMode, draft?: Partial<ComposeDraft>) => void;
  closeCompose: () => void;
  setComposeDraft: (d: Partial<ComposeDraft>) => void;
  setGraphAvailable: (v: boolean) => void;
  refreshMessageList: () => void;
  messageListRefreshKey: number;
}

const InboxContext = createContext<InboxContextValue | null>(null);

const SS_FOLDER = "inbox_selected_folder";

export function InboxProvider({ children }: { children: ReactNode }) {
  const [selectedFolder, setSelectedFolderState] = useState<InboxFolder>(() => {
    try { return (sessionStorage.getItem(SS_FOLDER) as InboxFolder) ?? "inbox"; } catch { return "inbox"; }
  });
  const [activeFilters, setActiveFilters] = useState<Set<InboxFilter>>(new Set());
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [composeMode, setComposeMode] = useState<ComposeMode>(null);
  const [composeDraft, setComposeDraftState] = useState<ComposeDraft | null>(null);
  const [graphAvailable, setGraphAvailable] = useState(false);
  const [messageListRefreshKey, setMessageListRefreshKey] = useState(0);

  const setSelectedFolder = useCallback((folder: InboxFolder) => {
    setSelectedFolderState(folder);
    setSelectedMessageId(null);
    setSearchQuery("");
    setIsSearching(false);
    try { sessionStorage.setItem(SS_FOLDER, folder); } catch {}
  }, []);

  const toggleFilter = useCallback((filter: InboxFilter) => {
    setActiveFilters(prev => {
      const next = new Set(prev);
      next.has(filter) ? next.delete(filter) : next.add(filter);
      return next;
    });
    setSelectedMessageId(null);
  }, []);

  const clearFilters = useCallback(() => {
    setActiveFilters(new Set());
    setSelectedMessageId(null);
  }, []);

  const toggleAIPanel = useCallback(() => setAiPanelOpen(v => !v), []);

  const openCompose = useCallback((mode: ComposeMode, draft?: Partial<ComposeDraft>) => {
    setComposeMode(mode);
    setComposeDraftState({
      mode,
      to: "",
      cc: "",
      bcc: "",
      subject: "",
      body: "",
      ...draft,
    });
  }, []);

  const closeCompose = useCallback(() => {
    setComposeMode(null);
    setComposeDraftState(null);
  }, []);

  const setComposeDraft = useCallback((d: Partial<ComposeDraft>) => {
    setComposeDraftState(prev => prev ? { ...prev, ...d } : null);
  }, []);

  const refreshMessageList = useCallback(() => {
    setMessageListRefreshKey(k => k + 1);
  }, []);

  return (
    <InboxContext.Provider value={{
      selectedFolder,
      activeFilters,
      selectedMessageId,
      searchQuery,
      isSearching,
      aiPanelOpen,
      composeMode,
      composeDraft,
      graphAvailable,
      setSelectedFolder,
      toggleFilter,
      clearFilters,
      setSelectedMessageId,
      setSearchQuery,
      setIsSearching,
      toggleAIPanel,
      openCompose,
      closeCompose,
      setComposeDraft,
      setGraphAvailable,
      refreshMessageList,
      messageListRefreshKey,
    }}>
      {children}
    </InboxContext.Provider>
  );
}

export function useInbox(): InboxContextValue {
  const ctx = useContext(InboxContext);
  if (!ctx) throw new Error("useInbox must be used within InboxProvider");
  return ctx;
}
