import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

interface DriveItem {
  driveItemId: string;
  name: string;
  webUrl: string;
  mimeType: string | null;
  folder: boolean;
  lastModifiedDateTime: string | null;
}

interface BreadcrumbEntry {
  name: string;
  path: string;
}

type SiteConfig = {
  templateSiteUrl: string | null;
  templateSiteId: string | null;
  graphConfigured: boolean;
};

function fileTypeIcon(item: DriveItem): string {
  if (item.folder) return "folder";
  const mime = item.mimeType ?? "";
  const name = item.name.toLowerCase();
  if (name.endsWith(".docx") || name.endsWith(".doc") || mime.includes("word")) return "word";
  if (name.endsWith(".xlsx") || name.endsWith(".xls") || mime.includes("excel") || mime.includes("spreadsheet")) return "excel";
  if (name.endsWith(".pptx") || name.endsWith(".ppt") || mime.includes("powerpoint") || mime.includes("presentation")) return "powerpoint";
  if (name.endsWith(".pdf") || mime.includes("pdf")) return "pdf";
  if (name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".gif") || name.endsWith(".svg") || mime.startsWith("image/")) return "image";
  return "file";
}

function FileTypeIcon({ item, size = 18 }: { item: DriveItem; size?: number }) {
  const type = fileTypeIcon(item);
  const s = size;

  if (type === "folder") {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="#0078D4" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
      </svg>
    );
  }
  if (type === "word") {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
        <rect width="24" height="24" rx="3" fill="#2B579A" />
        <text x="5" y="17" fontSize="11" fontWeight="bold" fill="white">W</text>
      </svg>
    );
  }
  if (type === "excel") {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
        <rect width="24" height="24" rx="3" fill="#217346" />
        <text x="5" y="17" fontSize="11" fontWeight="bold" fill="white">X</text>
      </svg>
    );
  }
  if (type === "powerpoint") {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
        <rect width="24" height="24" rx="3" fill="#D24726" />
        <text x="5" y="17" fontSize="11" fontWeight="bold" fill="white">P</text>
      </svg>
    );
  }
  if (type === "pdf") {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
        <rect width="24" height="24" rx="3" fill="#E53E3E" />
        <text x="2" y="17" fontSize="9" fontWeight="bold" fill="white">PDF</text>
      </svg>
    );
  }
  if (type === "image") {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth={1.5}>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 15l-5-5L5 21" />
      </svg>
    );
  }
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
    </svg>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "—";
  }
}

export default function TemplateLibraryPage() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();

  const [config, setConfig] = useState<SiteConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [siteInput, setSiteInput] = useState("");
  const [saving, setSaving] = useState(false);

  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbEntry[]>([{ name: "Root", path: "" }]);
  const [items, setItems] = useState<DriveItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsError, setItemsError] = useState<string | null>(null);

  const currentPath = breadcrumbs[breadcrumbs.length - 1]?.path ?? "";

  const loadItems = useCallback(async (path: string) => {
    setItemsLoading(true);
    setItemsError(null);
    try {
      const qs = path ? `?folder=${encodeURIComponent(path)}` : "";
      const res = await fetchWithAuth(`/api/admin/sharepoint/templates/items${qs}`);
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        setItemsError(d.error ?? "Failed to load files");
        setItems([]);
        return;
      }
      const d = await res.json() as { items: DriveItem[] };
      setItems((d.items ?? []).sort((a, b) => {
        if (a.folder && !b.folder) return -1;
        if (!a.folder && b.folder) return 1;
        return a.name.localeCompare(b.name);
      }));
    } catch {
      setItemsError("Network error loading files");
      setItems([]);
    } finally {
      setItemsLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetchWithAuth("/api/admin/sharepoint/template-site");
        if (res.ok) {
          const d = await res.json() as SiteConfig;
          setConfig(d);
          setSiteInput(d.templateSiteUrl ?? "");
          if (d.templateSiteId) {
            void loadItems("");
          }
        }
      } finally {
        setConfigLoading(false);
      }
    })();
  }, [fetchWithAuth, loadItems]);

  const handleSaveUrl = async () => {
    if (!siteInput.trim()) return;
    setSaving(true);
    try {
      const res = await fetchWithAuth("/api/admin/sharepoint/template-site", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateSiteUrl: siteInput.trim() }),
      });
      if (res.ok) {
        const d = await res.json() as SiteConfig;
        setConfig(d);
        toast({ title: "Template site URL saved" });
        if (d.templateSiteId) {
          setBreadcrumbs([{ name: "Root", path: "" }]);
          void loadItems("");
        } else if (!d.graphConfigured) {
          toast({ title: "URL saved (Graph not configured)", description: "Configure GRAPH_* credentials to browse files." });
        } else {
          toast({ title: "URL saved but site not resolved", description: "Check the URL and Graph permissions.", variant: "destructive" });
        }
      } else {
        const d = await res.json() as { error?: string };
        toast({ title: d.error ?? "Error saving URL", variant: "destructive" });
      }
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const navigateInto = (item: DriveItem) => {
    const newPath = currentPath ? `${currentPath}/${item.name}` : item.name;
    setBreadcrumbs(prev => [...prev, { name: item.name, path: newPath }]);
    void loadItems(newPath);
  };

  const navigateTo = (entry: BreadcrumbEntry, idx: number) => {
    setBreadcrumbs(prev => prev.slice(0, idx + 1));
    void loadItems(entry.path);
  };

  if (configLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const configured = Boolean(config?.templateSiteId);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#0A2540]">Template Library</h1>
          <p className="text-sm text-muted-foreground mt-1">Browse files from the Template Team SharePoint site</p>
        </div>
        {config?.templateSiteUrl && (
          <a
            href={config.templateSiteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-sm text-[#0078D4] hover:underline flex-shrink-0"
          >
            Open in SharePoint
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
            </svg>
          </a>
        )}
      </div>

      {/* ── Site URL config ─────────────────────────────────────────────────── */}
      <div className="bg-white border border-border rounded-xl p-5 mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Template Team Site URL</p>
        <div className="flex gap-2">
          <input
            type="url"
            value={siteInput}
            onChange={e => setSiteInput(e.target.value)}
            placeholder="https://tenant.sharepoint.com/sites/TemplateTeam"
            className="flex-1 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]/40"
          />
          <button
            onClick={() => void handleSaveUrl()}
            disabled={saving || !siteInput.trim()}
            className="flex items-center gap-1.5 bg-[#0A2540] text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[#0A2540]/90 disabled:opacity-50 transition-colors flex-shrink-0"
          >
            {saving ? (
              <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            ) : null}
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
        {!config?.graphConfigured && (
          <p className="text-xs text-amber-600 mt-2">
            Graph credentials not configured — set <code className="font-mono bg-amber-50 px-1 rounded">GRAPH_TENANT_ID</code>, <code className="font-mono bg-amber-50 px-1 rounded">GRAPH_CLIENT_ID</code>, and <code className="font-mono bg-amber-50 px-1 rounded">GRAPH_CLIENT_SECRET</code> to browse files.
          </p>
        )}
      </div>

      {/* ── Empty state: not configured ─────────────────────────────────────── */}
      {!configured && (
        <div className="bg-white border border-border rounded-xl p-12 flex flex-col items-center text-center">
          <div className="w-16 h-16 rounded-2xl bg-[#0078D4]/10 flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-[#0078D4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-[#0A2540] mb-2">Template site not connected</h2>
          <p className="text-sm text-muted-foreground max-w-sm">
            Paste the URL of your Template Team SharePoint site above and click Save. Once connected, all documents and folders will appear here.
          </p>
          {!config?.graphConfigured && (
            <p className="text-xs text-amber-600 mt-3 max-w-sm">
              You'll also need Graph API credentials configured before file browsing is available.
            </p>
          )}
        </div>
      )}

      {/* ── File browser ────────────────────────────────────────────────────── */}
      {configured && (
        <div className="bg-white border border-border rounded-xl overflow-hidden">
          {/* Breadcrumb */}
          <div className="flex items-center gap-1 px-4 py-3 border-b border-border text-sm bg-[#F7F9FC]">
            {breadcrumbs.map((entry, idx) => (
              <div key={entry.path + idx} className="flex items-center gap-1">
                {idx > 0 && (
                  <svg className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                )}
                {idx < breadcrumbs.length - 1 ? (
                  <button
                    onClick={() => navigateTo(entry, idx)}
                    className="text-[#0078D4] hover:underline font-medium truncate max-w-[160px]"
                  >
                    {entry.name}
                  </button>
                ) : (
                  <span className="text-[#0A2540] font-semibold truncate max-w-[200px]">{entry.name}</span>
                )}
              </div>
            ))}
            {breadcrumbs.length > 1 && (
              <button
                onClick={() => navigateTo(breadcrumbs[0], 0)}
                className="ml-auto text-xs text-muted-foreground hover:text-[#0A2540] flex items-center gap-1"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
                Root
              </button>
            )}
          </div>

          {/* Items list */}
          {itemsLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-7 h-7 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : itemsError ? (
            <div className="flex flex-col items-center py-16 text-center px-6">
              <svg className="w-10 h-10 text-red-400 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              <p className="text-sm font-semibold text-[#0A2540]">{itemsError}</p>
              <button
                onClick={() => void loadItems(currentPath)}
                className="mt-3 text-sm text-[#0078D4] hover:underline"
              >
                Try again
              </button>
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center py-16 text-center">
              <svg className="w-10 h-10 text-muted-foreground/40 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              <p className="text-sm text-muted-foreground">This folder is empty</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {/* Header row */}
              <div className="grid grid-cols-[auto_1fr_auto_auto] gap-4 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground bg-[#F7F9FC]/60">
                <span className="w-5" />
                <span>Name</span>
                <span className="text-right w-28">Modified</span>
                <span className="w-12" />
              </div>
              {items.map(item => (
                <div
                  key={item.driveItemId}
                  className={`grid grid-cols-[auto_1fr_auto_auto] gap-4 px-4 py-3 items-center transition-colors ${item.folder ? "hover:bg-[#F7F9FC] cursor-pointer" : "hover:bg-[#F7F9FC]/50"}`}
                  onClick={item.folder ? () => navigateInto(item) : undefined}
                >
                  <span className="w-5 flex-shrink-0 flex items-center justify-center">
                    <FileTypeIcon item={item} size={18} />
                  </span>
                  <span className="truncate text-sm font-medium text-[#0A2540] min-w-0">
                    {item.name}
                  </span>
                  <span className="text-xs text-muted-foreground text-right w-28 flex-shrink-0">
                    {formatDate(item.lastModifiedDateTime)}
                  </span>
                  <span className="w-12 flex justify-end flex-shrink-0">
                    {item.folder ? (
                      <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    ) : (
                      <a
                        href={item.webUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="flex items-center gap-1 text-xs text-[#0078D4] hover:underline font-medium"
                      >
                        Open
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                        </svg>
                      </a>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
