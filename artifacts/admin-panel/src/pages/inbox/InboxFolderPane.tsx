import { useInbox, type InboxFolder, type InboxFilter } from "@/contexts/InboxContext";

interface FolderItem {
  key: InboxFolder;
  label: string;
  icon: React.ReactNode;
  section?: string;
}

const MailIcon = () => (
  <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
  </svg>
);

const SendIcon = () => (
  <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
  </svg>
);

const DraftIcon = () => (
  <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
  </svg>
);

const ArchiveIcon = () => (
  <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
  </svg>
);

const TrashIcon = () => (
  <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
  </svg>
);

const CRMLeadIcon = () => (
  <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
  </svg>
);

const BriefcaseIcon = () => (
  <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 00.75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 00-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0112 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 01-.673-.38m0 0A2.18 2.18 0 013 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 013.413-.387m7.5 0V5.25A2.25 2.25 0 0013.5 3h-3a2.25 2.25 0 00-2.25 2.25v.894m7.5 0a48.667 48.667 0 00-7.5 0M12 12.75h.008v.008H12v-.008z" />
  </svg>
);

const SYSTEM_FOLDERS: FolderItem[] = [
  { key: "inbox", label: "Inbox", icon: <MailIcon /> },
  { key: "sent", label: "Sent", icon: <SendIcon /> },
  { key: "drafts", label: "Drafts", icon: <DraftIcon /> },
  { key: "archive", label: "Archive", icon: <ArchiveIcon /> },
  { key: "deleted", label: "Deleted", icon: <TrashIcon /> },
];

const CRM_FOLDERS: FolderItem[] = [
  { key: "crm:leads", label: "Leads", icon: <CRMLeadIcon /> },
  { key: "crm:prospects", label: "Prospects", icon: <CRMLeadIcon /> },
  { key: "crm:customers", label: "Customers", icon: <BriefcaseIcon /> },
];

const FILTERS: { key: InboxFilter; label: string; color: string }[] = [
  { key: "unread", label: "Unread", color: "bg-blue-500/20 text-blue-400 hover:bg-blue-500/30" },
  { key: "flagged", label: "Flagged", color: "bg-amber-500/20 text-amber-400 hover:bg-amber-500/30" },
  { key: "hasAttachments", label: "Has Attachments", color: "bg-purple-500/20 text-purple-400 hover:bg-purple-500/30" },
  { key: "linkedLead", label: "Linked to Lead", color: "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30" },
  { key: "linkedOpportunity", label: "Linked to Opp", color: "bg-rose-500/20 text-rose-400 hover:bg-rose-500/30" },
];

export default function InboxFolderPane({ onCompose }: { onCompose: () => void }) {
  const { selectedFolder, activeFilters, toggleFilter, clearFilters, setSelectedFolder } = useInbox();

  return (
    <div className="flex flex-col h-full bg-[#0D1117] border-r border-[#30363D] w-52 shrink-0 overflow-y-auto">
      {/* Compose button */}
      <div className="p-3 shrink-0">
        <button
          onClick={onCompose}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-[#0078D4] text-white text-sm font-medium hover:bg-[#1A90E0] transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Message
        </button>
      </div>

      {/* System folders */}
      <div className="px-2 pb-1">
        <p className="px-2 py-1 text-[10px] font-semibold text-[#7D8590] uppercase tracking-wide">Folders</p>
        {SYSTEM_FOLDERS.map(f => (
          <button
            key={f.key}
            onClick={() => setSelectedFolder(f.key)}
            className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm transition-colors ${
              selectedFolder === f.key
                ? "bg-[#0078D4]/15 text-[#0078D4] font-medium"
                : "text-[#C9D1D9] hover:bg-[#161B22]"
            }`}
          >
            {f.icon}
            <span>{f.label}</span>
          </button>
        ))}
      </div>

      {/* CRM Views */}
      <div className="px-2 pb-1 mt-2">
        <p className="px-2 py-1 text-[10px] font-semibold text-[#7D8590] uppercase tracking-wide">CRM Views</p>
        {CRM_FOLDERS.map(f => (
          <button
            key={f.key}
            onClick={() => setSelectedFolder(f.key)}
            className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm transition-colors ${
              selectedFolder === f.key
                ? "bg-[#0078D4]/15 text-[#0078D4] font-medium"
                : "text-[#C9D1D9] hover:bg-[#161B22]"
            }`}
          >
            {f.icon}
            <span>{f.label}</span>
          </button>
        ))}
      </div>

      {/* Filter chips */}
      <div className="px-3 pb-3 mt-2">
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-[10px] font-semibold text-[#7D8590] uppercase tracking-wide">Filters</p>
          {activeFilters.size > 0 && (
            <button onClick={clearFilters} className="text-[10px] text-[#7D8590] hover:text-[#C9D1D9]">Clear</button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => toggleFilter(f.key)}
              className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-all ${
                activeFilters.has(f.key)
                  ? f.color + " ring-1 ring-current"
                  : "bg-[#161B22] text-[#7D8590] hover:bg-[#1C2128] hover:text-[#C9D1D9]"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
